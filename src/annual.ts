import fs from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {parse} from 'csv-parse';
import {unzipSync} from 'fflate';
import {canonical,hash,cents,snapshotId,validCnpj,officialUrl,stableDigest,publicSupplier,readLimited,RETRY_WAITS,retryWait,sourceError} from './model.ts';
import {pairOccurrences} from './reconcile.ts';
import {assertArchive} from './sources.ts';
import type {Snapshot,Scope,Expense,SourceRef} from './model.ts';

// Which record types may exist in one source only. Rule and rationale: real/README.md.
const ANNUAL_ONLY=new Set(['TELEFONIA','COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA']),API_ONLY=new Set(['PASSAGEM AÉREA - SIGEPA']);
// normalizeAnnual fills blanks with this label; the API keeps them empty, and a blank must not read as a conflict.
const raw=(text:string)=>text==='Não informado'?'':text;
const occurrence=(r:Expense)=>({personId:r.personId,month:r.month,documentId:raw(r.documentId),category:r.category,cents:BigInt(r.cents),number:raw(r.documentNumber),date:r.date?.slice(0,10)||null,lot:r.lot||'',record:r});
export function unionRecords(annual:Expense[],api:Expense[]) {
  const pairing=pairOccurrences(annual.map(occurrence),api.map(occurrence));
  if(pairing.fieldMismatches.length)throw new Error(`${pairing.fieldMismatches.length} pares divergem em número ou data; publicação retida`);
  const blocked=(rows:{category:string}[],allowed:Set<string>)=>[...new Set(rows.map(r=>r.category))].filter(c=>!allowed.has(c));
  const unknownAnnual=blocked(pairing.onlyAnnual,ANNUAL_ONLY),unknownApi=blocked(pairing.onlyApi,API_ONLY);
  if(unknownApi.length)throw new Error(`A API contém ocorrências não reconciliadas no arquivo anual (${unknownApi.join(', ')}); publicação retida`);
  if(unknownAnnual.length)throw new Error(`O arquivo anual contém tipos sem par na API e sem revisão (${unknownAnnual.join(', ')}); publicação retida`);
  if(!pairing.balanced)throw new Error('União das fontes não fecha em centavos; publicação retida');
  const records:Expense[]=[...pairing.matched.map(m=>({...m.annual.record,origin:'both' as const})),...pairing.onlyAnnual.map(o=>({...o.record,origin:'annual' as const})),...pairing.onlyApi.map(o=>({...o.record,origin:'api' as const}))];
  const sum=(origin:Expense['origin'])=>records.filter(r=>r.origin===origin).reduce((n,r)=>n+r.cents,0);
  return {records,paired:pairing.matched.length,onlyAnnual:pairing.onlyAnnual.length,onlyApi:pairing.onlyApi.length,onlyApiCents:pairing.onlyApiCents,originCents:{both:sum('both'),annual:sum('annual'),api:sum('api')}};
}
// Records a previous version published that no source carries anymore, counted per occurrence.
export function removedRecords(previous:Snapshot,current:Expense[],scope:Scope):Expense[] {
  const key=(r:Expense)=>canonical([r.personId,r.year,r.month,r.documentId,r.category,r.cents]),left=new Map<string,number>();
  for(const r of current)left.set(key(r),(left.get(key(r))||0)+1);
  return previous.records.filter(r=>scope.ids.includes(r.personId)&&r.year===scope.year&&scope.months.includes(r.month)).filter(r=>{const n=left.get(key(r))||0;if(n)left.set(key(r),n-1);return !n;});
}

export type AnnualRow=Record<string,string>;
export function normalizeAnnual(r:AnnualRow,scope:Scope,source:SourceRef):Expense {
  const personId=Number(r.ideCadastro),year=Number(r.numAno),month=Number(r.numMes);
  if(!scope.ids.includes(personId)||year!==scope.year||!scope.months.includes(month)||Number(r.codLegislatura)!==scope.legislature)throw new Error('Linha anual fora do escopo');
  const required=['txtDescricao','vlrLiquido'];for(const field of required)if(!r[field]?.trim())throw new Error('Campo anual obrigatório ausente: '+field);
  const money=(field:string)=>r[field]?.trim()?cents(r[field].trim().replace(',','.')):null;
  const net=money('vlrLiquido')!,face=money('vlrDocumento'),glosa=money('vlrGlosa');
  if(face!==null&&glosa!==null&&face-glosa!==net)throw new Error('Equação financeira anual diverge');
  const id=hash(canonical({personId,raw:r})),supplierId=(r.txtCNPJCPF||'').replace(/\D/g,'');const verified=validCnpj(supplierId),supplier=publicSupplier(r.txtFornecedor||'',supplierId);
  return {id,personId,year,month,category:r.txtDescricao,supplier:supplier.name,supplierKey:verified?hash('cnpj:'+supplierId):id,supplierVerified:verified,documentId:r.ideDocumento||'Não informado',documentNumber:r.txtNumero||'Não informado',date:r.datEmissao||null,lot:r.numLote||'',receipt:r.urlDocumento&&supplier.key!=='person'?officialUrl(r.urlDocumento,'receipt'):null,cents:net,documentCents:face,disallowedCents:glosa,source};
}
export async function parseAnnual(bytes:Uint8Array,scope:Scope,observe?:(row:AnnualRow)=>void):Promise<{rows:{raw:AnnualRow;row:number}[];scanned:number}> {
  const stream=Readable.from((function*(){for(let i=0;i<bytes.length;i+=65536)yield bytes.subarray(i,i+65536);})()).pipe(parse({columns:(headers:string[])=>{if(new Set(headers).size!==headers.length)throw new Error('Contrato CSV mudou: coluna duplicada');for(const field of ['ideCadastro','numAno','numMes','codLegislatura','txtDescricao','vlrLiquido','vlrDocumento','vlrGlosa','ideDocumento','txtFornecedor','txtCNPJCPF','urlDocumento','txtNumero','datEmissao','numLote'])if(!headers.includes(field))throw new Error('Contrato CSV mudou: coluna ausente '+field);return headers;},delimiter:';',bom:true,skip_empty_lines:true}));
  const rows=[];let scanned=0;
  for await(const raw of stream){const row=scanned++;observe?.(raw);if(scope.ids.includes(Number(raw.ideCadastro))&&Number(raw.numAno)===scope.year&&scope.months.includes(Number(raw.numMes)))rows.push({raw,row});}
  if(scanned===0)throw new Error('Arquivo anual vazio');
  return {rows,scanned};
}
async function download(url:string):Promise<Uint8Array>{
  let last:unknown;for(let i=0;i<=RETRY_WAITS.length;i++)try{const r=await fetch(url,{signal:AbortSignal.timeout(60000),redirect:'error'});if(!r.ok)throw new Error('HTTP '+r.status);return await readLimited(r,100_000_000);}catch(e){last=e;if(i<RETRY_WAITS.length)await new Promise(r=>setTimeout(r,retryWait(i)));}throw sourceError(url,last);
}
export const annualUrl=(year:number)=>`https://www.camara.leg.br/cotas/Ano-${year}.csv.zip`;
// A deliberate hold, not a failure of the run: the same source would hold again, so it must not be collected again until it changes.
export class HeldPublication extends Error {}
export async function annualSnapshot(api:Snapshot,directory:string,previous:Snapshot|null=null,acceptRemoved=false):Promise<Snapshot>{
  const scope=api.scope,url=annualUrl(scope.year);
  const passes=[];
  for(const pass of [1,2]){
    const archive=await download(url),archiveHash=hash(archive);assertArchive(archive,22);
    const name=`Ano-${scope.year}.csv`,files=unzipSync(archive,{filter:file=>{if(file.name!==name)return false;if(file.originalSize>200_000_000)throw new Error('CSV acima do limite');return true;}});const bytes=files[name];if(!bytes)throw new Error('CSV ausente');
    const fetchedAt=new Date().toISOString(),sha256=hash(bytes),file=`annual-${pass}.csv.zip`;
    await fs.writeFile(path.join(directory,file),archive);
    const meta={url,file,fetchedAt,sha256,archiveHash,pass};await fs.writeFile(path.join(directory,`annual-${pass}.meta.json`),JSON.stringify(meta,null,2));
    const parsed=await parseAnnual(bytes,scope);const digest=stableDigest(parsed.rows.map(r=>({personId:Number(r.raw.ideCadastro),raw:r.raw})));
    passes.push({...parsed,digest,meta});
  }
  if(passes[0].digest!==passes[1].digest)throw new Error('Arquivo anual mudou no recorte entre capturas');
  const selected=passes[1];for(const id of scope.ids)for(const month of scope.months)if(!selected.rows.some(r=>Number(r.raw.ideCadastro)===id&&Number(r.raw.numMes)===month))throw new Error('Recorte anual vazio exige revisão');
  const records=selected.rows.map(({raw,row})=>normalizeAnnual(raw,scope,{url,sha256:selected.meta.sha256,row,fetchedAt:selected.meta.fetchedAt}));
  // Separate decimal accumulator from the raw CSV, before normalization.
  let independent=0n;for(const {raw}of selected.rows){const s=raw.vlrLiquido.trim().replace(',','.'),[whole,fraction='']=s.replace('-','').split('.');independent+=(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')))*(s.startsWith('-')?-1n:1n);}
  const total=records.reduce((n,r)=>n+r.cents,0);if(!Number.isSafeInteger(total)||BigInt(total)!==independent)throw new Error('Conferência independente anual diverge');
  const union=unionRecords(records,api.records),missingInApi=union.onlyAnnual,extraInApi=union.onlyApi;
  const unionTotal=union.records.reduce((n,r)=>n+r.cents,0),independentUnion=independent+union.onlyApiCents;
  if(!Number.isSafeInteger(unionTotal)||BigInt(unionTotal)!==independentUnion)throw new Error('Conferência independente da união diverge');
  const removed=previous?removedRecords(previous,union.records,scope):[];
  if(removed.length&&!acceptRemoved)throw new HeldPublication(`${removed.length} ocorrências da versão publicada não aparecem em nenhuma fonte atual (${[...new Set(removed.map(r=>r.category))].join(', ')}); publicação retida. Revise e use --accept-removed para publicar sem elas`);
  const metric='camara.ceap.valor-liquido-uniao-fontes.v1';
  // The zip hash stays out of the version: the Câmara repacks the same CSV into different zip bytes. The CSV hash identifies the content.
  const annualPages=passes.map(({meta:{url,file,fetchedAt,sha256,pass},scanned})=>({url,file,fetchedAt,sha256,pass,count:scanned}));
  const body={...api,metric,records:union.records,collectedAt:selected.meta.fetchedAt,publishedAt:new Date().toISOString(),pages:[...api.pages,...annualPages],validation:{sourceKind:'annual-api-union',stablePasses:2,recordCount:union.records.length,totalCents:unionTotal,independentTotalCents:String(independentUnion),duplicatePolicy:'Documento não é chave. Ocorrências do CSV preservadas; conteúdo idêntico ambíguo retém publicação.',apiComparison:{apiRecords:api.records.length,annualRecords:records.length,missingInApi,extraInApi,paired:union.paired,originCents:union.originCents,netDifferenceCents:total-api.validation.totalCents},removedFromPrevious:removed.map(r=>({personId:r.personId,month:r.month,category:r.category,cents:r.cents})),limitations:[`Fonte dos valores: união do arquivo anual CEAP com a API. ${union.paired} ocorrências estão nas duas fontes e usam os valores do arquivo; ${missingInApi} estão só no arquivo; ${extraInApi} estão só na API, ausentes do arquivo capturado nesta versão.`,...(removed.length?[`${removed.length} ocorrências da versão anterior não aparecem em nenhuma fonte desta captura e foram retiradas após revisão.`]:[]),'Amostra técnica de três deputados, janeiro–fevereiro de 2025; sem ranking nacional.','Campos financeiros vazios no arquivo permanecem desconhecidos, sem conversão automática para zero.','Valores negativos são preservados. A soma usa vlrLiquido, sem nova subtração de restituições.','Nome/retrato são os da consulta atual; não há atribuição histórica de partido/UF nem média por exercício.','Fornecedores sem CNPJ com dígitos válidos não são agrupados por identidade.','Conferência de integridade e aritmética não é auditoria da legitimidade das despesas.']}};
  return {...body,id:snapshotId(body)};
}
