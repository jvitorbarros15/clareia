import {parse} from 'parse5';
import {canonical,cents,expenseSchema,hash} from './model.ts';
import type {ExpenseSource} from './expense-intermediate.ts';
import type {PeopleCapture} from './people-discovery.ts';

export type PortalScope={personId:number;portalId:number;year:number;month:number};
export type PortalRow={position:number;documentHash:string;numberHash:string;providerHash:string;date:string;face:number;deductions:number|null;net:number};
export type PortalSnapshot={rows:PortalRow[];total:number};
export type PortalCheck={personId:number;year:number;month:number;portalId:number|null;status:'unavailable'|'changed'|'mismatch'|'matched';sources:ExpenseSource[];count:number|null;totalCents:number|null;signatureSha256:string|null};
// Category codes of the portal form; 'todas' lists every category of the month, each row linking to its own code.
export const PORTAL_CATEGORIES=new Set(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','40','119','120','121','122','123','137','145','996','998','999']);
export const portalUrl=(s:PortalScope,despesa='998')=>`https://www.camara.leg.br/cota-parlamentar/analitico?nuDeputadoId=${s.portalId}&dataInicio=${s.month}%2F${s.year}&dataFim=${s.month}%2F${s.year}&despesa=${despesa}&nomeHospede=&nomePassageiro=&nomeFornecedor=&cnpjFornecedor=&numDocumento=&sguf=`;
// Syntax infrastructure only. It does not execute HTML, scripts or fetch assets.
export function portalDom(bytes:Uint8Array):any{
  if(bytes.length>12_000_000)throw Error('HTML da cota acima do limite');
  try{return parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('HTML da cota inválido');}
}
export function portalNodes(root:any):any[]{
  const stack=[{node:root,depth:0}],nodes:any[]=[];
  while(stack.length){const {node,depth}=stack.pop()!;if(depth>200||nodes.length>=100_000)throw Error('HTML da cota complexo demais');nodes.push(node);for(const child of [...(node.childNodes??[])].reverse())stack.push({node:child,depth:depth+1});}return nodes;
}
export const portalAttr=(node:any,key:string):string|undefined=>node.attrs?.find((a:any)=>a.name===key)?.value;
export const portalText=(node:any):string=>portalNodes(node).filter(n=>n.nodeName==='#text').map(n=>n.value).join(' ').replace(/\s+/g,' ').trim();
export function portalMoney(value:string):number{
  let s=value.replace(/\s/g,''),negative=false;
  if(s.startsWith('(')&&s.endsWith(')')){negative=true;s=s.slice(1,-1);}
  if(s.startsWith('-')){if(negative)throw Error('Sinal monetário ambíguo');negative=true;s=s.slice(1);}
  if(!s.startsWith('R$'))throw Error('Moeda da cota mudou');s=s.slice(2);
  if(s.startsWith('-')){if(negative)throw Error('Sinal monetário ambíguo');negative=true;s=s.slice(1);}
  if(!/^(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}$/.test(s))throw Error('Valor da cota inválido');
  return cents((negative?'-':'')+s.replace(/\./g,'').replace(',','.'));
}
function date(value:string):string{
  const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);if(!m)throw Error('Data da cota inválida');const iso=`${m[3]}-${m[2]}-${m[1]}`,d=new Date(iso+'T00:00:00Z');if(Number.isNaN(d.valueOf())||d.toISOString().slice(0,10)!==iso)throw Error('Data da cota inválida');return iso;
}
const headers=['Fornecedor','Data de emissão','Número do documento','Valor','Detalhe','Nome','CNPJ / CPF','Despesa','Deduções','Reembolso'];
export function parsePortal(bytes:Uint8Array,scope:PortalScope,despesa='998'):PortalSnapshot{
  const nodes=portalNodes(portalDom(bytes)),tables=nodes.filter(n=>n.tagName==='table'&&(portalAttr(n,'class')||'').split(/\s/).includes('tabela-2'));
  if(tables.length!==1)throw Error('Tabela analítica da cota ausente ou ambígua');
  const tableNodes=portalNodes(tables[0]);if(tableNodes.filter(n=>n.tagName==='table').length!==1||canonical(tableNodes.filter(n=>n.tagName==='th').map(portalText))!==canonical(headers))throw Error('Contrato da tabela da cota mudou');
  const rows:PortalRow[]=[];let total:number|null=null;
  for(const tr of tableNodes.filter(n=>n.tagName==='tr')){
    const td=(tr.childNodes??[]).filter((n:any)=>n.tagName==='td');if(!td.length)continue;
    if(td.length!==8)throw Error('Colunas da cota mudaram');const id=portalAttr(td[6],'id');
    if(id==='totalFinalAnalitico'){if(total!==null||portalText(td[0])!=='Total')throw Error('Total da cota ambíguo');total=portalMoney(portalText(td[6]));continue;}
    if(id!==`analitico${rows.length}`||total!==null)throw Error('Sequência da cota inválida');
    const links=portalNodes(td[7]).filter(n=>n.tagName==='a');if(links.length!==1)throw Error('Referência da cota ambígua');
    const link=new URL(portalAttr(links[0],'href')||'',portalUrl(scope,despesa)),params=link.searchParams;
    if(link.origin!=='https://www.camara.leg.br'||link.pathname!=='/cota-parlamentar/documento'||link.username||link.password||link.hash||[...params.keys()].sort().join(',')!=='cnpjFornecedor,despesa,idDocumento,idDocumentoFiscal,nuDeputadoId,numAno,numMes'||params.get('nuDeputadoId')!==String(scope.portalId)||params.get('numAno')!==String(scope.year)||params.get('numMes')!==String(scope.month)||(despesa==='todas'?!PORTAL_CATEGORIES.has(params.get('despesa')??''):params.get('despesa')!==despesa))throw Error('Identidade ou competência da cota diverge');
    const provider=portalText(td[1]).replace(/\D/g,''),number=portalText(td[3]),fiscal=params.get('idDocumentoFiscal')||'';
    if(![11,14].includes(provider.length)||params.get('cnpjFornecedor')?.replace(/\D/g,'')!==provider||params.get('idDocumento')!==number||! /^(?:\d{1,18}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(fiscal))throw Error('Documento ou fornecedor da cota diverge');
    const deduction=portalText(td[5]);rows.push({position:rows.length,documentHash:hash(fiscal),numberHash:hash(number),providerHash:hash(provider),date:date(portalText(td[2])),face:portalMoney(portalText(td[4])),deductions:deduction?portalMoney(deduction):null,net:portalMoney(portalText(td[6]))});
  }
  if(total===null||!rows.length||rows.reduce((sum,r)=>sum+BigInt(r.net),0n)!==BigInt(total))throw Error('Linhas e total da cota não fecham');return {rows,total};
}
// The portal answers an empty category with HTTP 500 and the table skeleton: no row and a blank total. An error page has no table at all.
export function portalCategoryEmpty(bytes:Uint8Array):boolean{
  const nodes=portalNodes(portalDom(bytes)),tables=nodes.filter(n=>n.tagName==='table'&&(portalAttr(n,'class')||'').split(/\s/).includes('tabela-2'));
  if(tables.length!==1)return false;
  const cells=portalNodes(tables[0]).filter(n=>n.tagName==='td'),total=cells.filter(n=>portalAttr(n,'id')==='totalFinalAnalitico');
  return total.length===1&&portalText(total[0])===''&&!cells.some(n=>/^analitico\d+$/.test(portalAttr(n,'id')||''));
}
export function portalSignature(snapshot:PortalSnapshot):string{return hash(canonical({total:snapshot.total,rows:snapshot.rows.map(({position:_position,...r})=>canonical(r)).sort()}));}
function apiRow(raw:unknown,scope:PortalScope):PortalRow{
  const r=expenseSchema.parse(raw),provider=(r.cnpjCpfFornecedor||'').replace(/\D/g,''),d=r.dataDocumento?.slice(0,10)||'';
  if(r.ano!==scope.year||r.mes!==scope.month||r.tipoDespesa!=='PASSAGEM AÉREA - SIGEPA'||![11,14].includes(provider.length)||!/^\d{4}-\d{2}-\d{2}$/.test(d))throw Error('Registro API incompatível com a cota');
  date(d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4));
  if(r.valorGlosa===null||r.codDocumento==='')throw Error('Registro API sem glosa ou documento não confirma a cota');
  const face=cents(r.valorDocumento),deductions=cents(r.valorGlosa),net=cents(r.valorLiquido);if(face-deductions!==net)throw Error('Equação SIGEPA não confirmada');
  return {position:0,documentHash:hash(r.codDocumento),numberHash:hash(r.numDocumento),providerHash:hash(provider),date:d,face,deductions,net};
}
export function portalAgrees(snapshot:PortalSnapshot,rawApi:unknown[],scope:PortalScope):boolean{
  try{
    const api=rawApi.map(r=>apiRow(r,scope));if(api.length!==snapshot.rows.length||api.reduce((sum,r)=>sum+BigInt(r.net),0n)!==BigInt(snapshot.total))return false;
    const key=({position:_position,deductions:_deductions,...row}:PortalRow)=>canonical(row),pool=new Map<string,PortalRow[]>();for(const row of snapshot.rows)pool.set(key(row),[...(pool.get(key(row))??[]),row]);
    for(const row of api){const list=pool.get(key(row));if(!list?.length)return false;const observed=list.shift()!;if(observed.deductions===null?(row.deductions!==0||row.face!==row.net):observed.deductions!==row.deductions)return false;}
    return [...pool.values()].every(rows=>rows.length===0);
  }catch{return false;}
}
export function mapPortalIdentity(personId:number,first:{raw:Record<string,string>}[],second:{raw:Record<string,string>}[],legislature:number):number|null{
  const ids=[];
  for(const rows of [first,second]){const selected=rows.filter(r=>Number(r.raw.ideCadastro)===personId);if(!selected.length||selected.some(r=>Number(r.raw.codLegislatura)!==legislature||!/^[1-9]\d{0,8}$/.test(r.raw.nuDeputadoId||'')))return null;const set=new Set(selected.map(r=>Number(r.raw.nuDeputadoId)));if(set.size!==1)return null;ids.push([...set][0]);}
  return ids[0]===ids[1]?ids[0]:null;
}
export async function checkPortal(scope:PortalScope,api:unknown[],one:PeopleCapture,two:PeopleCapture):Promise<PortalCheck>{
  const result:PortalCheck={personId:scope.personId,year:scope.year,month:scope.month,portalId:scope.portalId,status:'unavailable',sources:[],count:null,totalCents:null,signatureSha256:null},snapshots:PortalSnapshot[]=[];
  for(const [index,capture] of [one,two].entries())try{const {bytes,source}=await capture.get(portalUrl(scope));result.sources.push({...source,pass:(index+1) as 1|2});snapshots.push(parsePortal(bytes,scope));}catch{return result;}
  if(portalSignature(snapshots[0])!==portalSignature(snapshots[1])){result.status='changed';return result;}
  result.count=snapshots[1].rows.length;result.totalCents=snapshots[1].total;result.signatureSha256=portalSignature(snapshots[1]);result.status=portalAgrees(snapshots[1],api,scope)?'matched':'mismatch';return result;
}
