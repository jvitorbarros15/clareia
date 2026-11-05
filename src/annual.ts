import fs from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {parse} from 'csv-parse';
import {unzipSync} from 'fflate';
import {canonical,hash,cents,snapshotId,validCnpj,officialUrl,stableDigest,maskPersonalId,readLimited} from './model.ts';
import type {Snapshot,Scope,Expense,SourceRef} from './model.ts';

export type AnnualRow=Record<string,string>;
export function normalizeAnnual(r:AnnualRow,scope:Scope,source:SourceRef):Expense {
  const personId=Number(r.ideCadastro),year=Number(r.numAno),month=Number(r.numMes);
  if(!scope.ids.includes(personId)||year!==scope.year||!scope.months.includes(month)||Number(r.codLegislatura)!==scope.legislature)throw new Error('Linha anual fora do escopo');
  const required=['txtDescricao','vlrLiquido'];for(const field of required)if(!r[field]?.trim())throw new Error('Campo anual obrigatório ausente: '+field);
  const money=(field:string)=>r[field]?.trim()?cents(r[field].trim().replace(',','.')):null;
  const net=money('vlrLiquido')!,face=money('vlrDocumento'),glosa=money('vlrGlosa');
  if(face!==null&&glosa!==null&&face-glosa!==net)throw new Error('Equação financeira anual diverge');
  const id=hash(canonical({personId,raw:r})),supplierId=(r.txtCNPJCPF||'').replace(/\D/g,'');const verified=validCnpj(supplierId);
  return {id,personId,year,month,category:r.txtDescricao,supplier:maskPersonalId(r.txtFornecedor||'Fornecedor não informado'),supplierKey:verified?hash('cnpj:'+supplierId):id,supplierVerified:verified,documentId:r.ideDocumento||'Não informado',documentNumber:r.txtNumero||'Não informado',date:r.datEmissao||null,receipt:r.urlDocumento?officialUrl(r.urlDocumento,'receipt'):null,cents:net,documentCents:face,disallowedCents:glosa,source};
}
export async function parseAnnual(bytes:Uint8Array,scope:Scope):Promise<{rows:{raw:AnnualRow;row:number}[];scanned:number}> {
  const stream=Readable.from((function*(){for(let i=0;i<bytes.length;i+=65536)yield bytes.subarray(i,i+65536);})()).pipe(parse({columns:(headers:string[])=>{for(const field of ['ideCadastro','numAno','numMes','codLegislatura','txtDescricao','vlrLiquido','vlrDocumento','vlrGlosa','ideDocumento'])if(!headers.includes(field))throw new Error('Contrato CSV mudou: coluna ausente '+field);return headers;},delimiter:';',bom:true,skip_empty_lines:true}));
  const rows=[];let scanned=0;
  for await(const raw of stream){const row=scanned++;if(scope.ids.includes(Number(raw.ideCadastro))&&Number(raw.numAno)===scope.year&&scope.months.includes(Number(raw.numMes)))rows.push({raw,row});}
  if(scanned===0)throw new Error('Arquivo anual vazio');
  return {rows,scanned};
}
async function download(url:string):Promise<Uint8Array>{
  let last:unknown;for(let i=0;i<3;i++)try{const r=await fetch(url,{signal:AbortSignal.timeout(60000),redirect:'error'});if(!r.ok)throw new Error('HTTP '+r.status);return await readLimited(r,100_000_000);}catch(e){last=e;if(i<2)await new Promise(r=>setTimeout(r,1000*(i+1)));}throw last;
}
export async function annualSnapshot(api:Snapshot,directory:string):Promise<Snapshot>{
  const scope=api.scope,url=`https://www.camara.leg.br/cotas/Ano-${scope.year}.csv.zip`;
  const passes=[];
  for(const pass of [1,2]){
    const archive=await download(url),archiveHash=hash(archive);
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
  const key=(r:Expense)=>canonical([r.personId,r.year,r.month,r.documentId,r.category,r.cents]);
  const counts=(rows:Expense[])=>{const map=new Map<string,number>();for(const r of rows)map.set(key(r),(map.get(key(r))||0)+1);return map;};
  const annualCounts=counts(records),apiCounts=counts(api.records);let missingInApi=0,extraInApi=0;
  for(const k of new Set([...annualCounts.keys(),...apiCounts.keys()])){const diff=(annualCounts.get(k)||0)-(apiCounts.get(k)||0);if(diff>0)missingInApi+=diff;else extraInApi-=diff;}
  if(extraInApi)throw new Error('A API contém ocorrências não reconciliadas no arquivo anual; publicação retida');
  const metric='camara.ceap.valor-liquido-arquivo-anual.v1';
  const body={...api,metric,records,collectedAt:selected.meta.fetchedAt,publishedAt:new Date().toISOString(),pages:[...api.pages,...passes.map(p=>({...p.meta,count:p.scanned}))],validation:{sourceKind:'annual-csv',stablePasses:2,recordCount:records.length,totalCents:total,independentTotalCents:String(independent),duplicatePolicy:'Documento não é chave. Ocorrências do CSV preservadas; conteúdo idêntico ambíguo retém publicação.',apiComparison:{apiRecords:api.records.length,annualRecords:records.length,missingInApi,extraInApi,netDifferenceCents:total-api.validation.totalCents},limitations:[`Fonte dos valores: arquivo anual CEAP. A API omitiu ${missingInApi} ocorrências deste recorte; não foi usada para completar ou substituir valores do CSV.`,'Amostra técnica de três deputados, janeiro–fevereiro de 2025; sem ranking nacional.','Campos financeiros vazios no arquivo permanecem desconhecidos, sem conversão automática para zero.','Valores negativos são preservados. A soma usa vlrLiquido, sem nova subtração de restituições.','Nome/retrato são os da consulta atual; não há atribuição histórica de partido/UF nem média por exercício.','Fornecedores sem CNPJ com dígitos válidos não são agrupados por identidade.','Conferência de integridade e aritmética não é auditoria da legitimidade das despesas.']}};
  return {...body,id:snapshotId(body)};
}
