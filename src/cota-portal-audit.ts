import {canonical,hash} from './model.ts';
import {portalDom,portalNodes,portalAttr,portalText} from './cota-portal.ts';
import type {PortalCheck} from './cota-portal.ts';
import type {ExpenseSource} from './expense-intermediate.ts';

// DOM syntax helpers are shared. Identity, amounts, table interpretation and
// correlation below do not call the collector's financial/parser decisions.
type Row={documentHash:string;numberHash:string;providerHash:string;date:string;face:number;deductions:number|null;net:number};
type Ledger={rows:Row[];total:number};
const cash=(value:string)=>{
  const s=value.replace(/\s/g,''),match=/^(\()?(-)?R\$(-)?((?:\d{1,3}(?:\.\d{3})*|\d+)),(\d{2})(\))?$/.exec(s);
  if(!match||Boolean(match[1])!==Boolean(match[6])||[match[1],match[2],match[3]].filter(Boolean).length>1)throw Error('Moeda analítica independente inválida');
  const n=(BigInt(match[4].replace(/\./g,''))*100n+BigInt(match[5]))*(match[1]||match[2]||match[3]?-1n:1n);
  if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw Error('Centavos analíticos independentes fora do limite');return Number(n);
};
const decimal=(value:unknown)=>{
  if(typeof value!=='number'||!Number.isFinite(value)||! /^-?\d+(\.\d{1,2})?$/.test(String(value)))throw Error('Centavos API independentes inválidos');
  const [whole,fraction='']=String(value).replace('-','').split('.'),n=(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')))*(value<0?-1n:1n);
  if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw Error();return Number(n);
};
const validDate=(iso:string)=>{const d=new Date(iso+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==iso)throw Error('Data analítica independente inválida');return iso;};
export function isAnalyticUrl(u:URL):boolean{
  const p=u.searchParams;
  return u.origin==='https://www.camara.leg.br'&&u.pathname==='/cota-parlamentar/analitico'&&!u.username&&!u.password&&!u.hash&&[...p.keys()].sort().join(',')==='cnpjFornecedor,dataFim,dataInicio,despesa,nomeFornecedor,nomeHospede,nomePassageiro,nuDeputadoId,numDocumento,sguf'&&/^[1-9]\d{0,8}$/.test(p.get('nuDeputadoId')||'')&&/^(?:[1-9]|1[0-2])\/\d{4}$/.test(p.get('dataInicio')||'')&&p.get('dataInicio')===p.get('dataFim')&&p.get('despesa')==='998'&&['cnpjFornecedor','nomeFornecedor','nomeHospede','nomePassageiro','numDocumento','sguf'].every(k=>p.get(k)==='');
}
function ledger(bytes:Uint8Array,portalId:number,year:number,month:number):Ledger{
  const all=portalNodes(portalDom(bytes)),tables=all.filter(n=>n.tagName==='table'&&(portalAttr(n,'class')||'').split(/\s+/).includes('tabela-2'));
  if(tables.length!==1)throw Error();const nodes=portalNodes(tables[0]),labels=['Fornecedor','Data de emissão','Número do documento','Valor','Detalhe','Nome','CNPJ / CPF','Despesa','Deduções','Reembolso'];
  if(nodes.filter(n=>n.tagName==='table').length!==1||canonical(nodes.filter(n=>n.tagName==='th').map(portalText))!==canonical(labels))throw Error();
  const rows:Row[]=[];let total:number|null=null;
  for(const tr of nodes.filter(n=>n.tagName==='tr')){
    const columns=(tr.childNodes??[]).filter((n:any)=>n.tagName==='td');if(!columns.length)continue;if(columns.length!==8)throw Error();
    const id=portalAttr(columns[6],'id');
    if(id==='totalFinalAnalitico'){if(total!==null||portalText(columns[0])!=='Total')throw Error();total=cash(portalText(columns[6]));continue;}
    if(total!==null||id!=='analitico'+rows.length)throw Error();
    const anchors=portalNodes(columns[7]).filter(n=>n.tagName==='a');if(anchors.length!==1)throw Error();
    const u=new URL(portalAttr(anchors[0],'href')||'','https://www.camara.leg.br'),p=u.searchParams;
    if(u.origin!=='https://www.camara.leg.br'||u.pathname!=='/cota-parlamentar/documento'||u.username||u.password||u.hash||[...p.keys()].sort().join(',')!=='cnpjFornecedor,despesa,idDocumento,idDocumentoFiscal,nuDeputadoId,numAno,numMes'||p.get('nuDeputadoId')!==String(portalId)||p.get('numAno')!==String(year)||p.get('numMes')!==String(month)||p.get('despesa')!=='998')throw Error();
    const provider=portalText(columns[1]).replace(/\D/g,''),number=portalText(columns[3]),document=p.get('idDocumentoFiscal')||'',date=portalText(columns[2]),deductions=portalText(columns[5]);
    if(![11,14].includes(provider.length)||p.get('cnpjFornecedor')?.replace(/\D/g,'')!==provider||p.get('idDocumento')!==number||! /^(?:[0-9]{1,18}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i.test(document)||!/^\d{2}\/\d{2}\/\d{4}$/.test(date))throw Error();
    rows.push({documentHash:hash(document),numberHash:hash(number),providerHash:hash(provider),date:validDate(date.slice(6)+'-'+date.slice(3,5)+'-'+date.slice(0,2)),face:cash(portalText(columns[4])),deductions:deductions?cash(deductions):null,net:cash(portalText(columns[6]))});
  }
  if(total===null||!rows.length||rows.reduce((n,r)=>n+BigInt(r.net),0n)!==BigInt(total))throw Error();return {rows,total};
}
const signature=(l:Ledger)=>hash(canonical({total:l.total,rows:l.rows.map(canonical).sort()}));
function agrees(l:Ledger,api:any[],year:number,month:number):boolean{
  try{
    const expected=api.map(r=>{
      if(!r||r.ano!==year||r.mes!==month||r.tipoDespesa!=='PASSAGEM AÉREA - SIGEPA'||typeof r.cnpjCpfFornecedor!=='string'||typeof r.numDocumento!=='string'||typeof r.dataDocumento!=='string'||typeof r.codDocumento!=='string'&&!Number.isInteger(r.codDocumento))throw Error();
      const provider=r.cnpjCpfFornecedor.replace(/\D/g,''),face=decimal(r.valorDocumento),deductions=decimal(r.valorGlosa),net=decimal(r.valorLiquido);
      if(![11,14].includes(provider.length)||BigInt(face)-BigInt(deductions)!==BigInt(net))throw Error();
      return {documentHash:hash(String(r.codDocumento)),numberHash:hash(r.numDocumento),providerHash:hash(provider),date:validDate(r.dataDocumento.slice(0,10)),face,deductions,net};
    });
    if(expected.length!==l.rows.length||expected.reduce((n,r)=>n+BigInt(r.net),0n)!==BigInt(l.total))return false;
    const remaining=[...l.rows];for(const r of expected){const index=remaining.findIndex(v=>v.documentHash===r.documentHash&&v.numberHash===r.numberHash&&v.providerHash===r.providerHash&&v.date===r.date&&v.face===r.face&&v.net===r.net&&(v.deductions===null?r.deductions===0&&r.face===r.net:v.deductions===r.deductions));if(index<0)return false;remaining.splice(index,1);}return remaining.length===0;
  }catch{return false;}
}
export async function independentPortalReview(personId:number,year:number,month:number,legislature:number,annuals:{raw:any}[][],api:any[],read:(pass:1|2,url:string)=>Promise<{source:ExpenseSource;bytes:Uint8Array}|null>):Promise<PortalCheck>{
  const ids=annuals.map(rows=>{const selected=rows.filter(r=>Number(r.raw.ideCadastro)===personId);if(!selected.length||selected.some(r=>Number(r.raw.codLegislatura)!==legislature||!/^[1-9]\d{0,8}$/.test(r.raw.nuDeputadoId||'')))return null;const values=[...new Set(selected.map(r=>Number(r.raw.nuDeputadoId)))];return values.length===1?values[0]:null;});
  const portalId=ids.length===2&&ids[0]!==null&&ids[0]===ids[1]?ids[0]:null;
  const result:PortalCheck={personId,year,month,portalId,status:'unavailable',sources:[],count:null,totalCents:null,signatureSha256:null};if(portalId===null)return result;
  const url=`https://www.camara.leg.br/cota-parlamentar/analitico?nuDeputadoId=${portalId}&dataInicio=${month}%2F${year}&dataFim=${month}%2F${year}&despesa=998&nomeHospede=&nomePassageiro=&nomeFornecedor=&cnpjFornecedor=&numDocumento=&sguf=`,passes:Ledger[]=[];
  for(const pass of [1,2] as const){try{const capture=await read(pass,url);if(!capture)return result;result.sources.push(capture.source);passes.push(ledger(capture.bytes,portalId,year,month));}catch{return result;}}
  if(signature(passes[0])!==signature(passes[1])){result.status='changed';return result;}
  result.count=passes[1].rows.length;result.totalCents=passes[1].total;result.signatureSha256=signature(passes[1]);result.status=agrees(passes[1],api,year,month)?'matched':'mismatch';return result;
}
