import fs from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {unzipSync} from 'fflate';
import {parse} from 'csv-parse';
import {createHash} from 'node:crypto';
import {decimalCents,pairOccurrences} from '../src/reconcile.ts';

// Record-by-record comparison of the API pages and annual file preserved by one published run.
// Independent of the collector/normalizer: money parsing and pairing live in src/reconcile.ts.
const runs=path.resolve('data/runs');
async function latestPublished(){
  const found=[];
  for(const id of await fs.readdir(runs)){const m=JSON.parse(await fs.readFile(path.join(runs,id,'manifest.json'),'utf8').catch(()=>'{}'));if(m.status==='published'&&m.validation?.sourceKind?.startsWith('annual'))found.push(m);}
  found.sort((a,b)=>Date.parse(b.finishedAt)-Date.parse(a.finishedAt));if(!found[0])throw new Error('Nenhuma execução publicada com arquivo anual');return found[0].runId as string;
}
const runId=process.argv[2]||await latestPublished();
if(!/^[a-zA-Z0-9-]{1,80}$/.test(runId))throw new Error('Identificador de execução inválido');
const directory=path.join(runs,runId);
const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
const scope=manifest.scope as {year:number;months:number[];ids:number[];legislature:number};
const sha=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
const brl=(c:bigint)=>(Number(c)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

const api=[];
const apiPages=manifest.pages.filter((p:{pass:number;url:string})=>p.pass===1&&p.url.includes('/despesas'));
for(const page of apiPages){
  if(path.basename(page.file)!==page.file)throw new Error('Caminho inválido no manifesto');const text=await fs.readFile(path.join(directory,page.file),'utf8');if(sha(text)!==page.sha256)throw new Error('Página preservada alterada: '+page.file);
  const personId=Number(new URL(page.url).pathname.split('/')[4]);
  for(const [row,r] of (JSON.parse(text).dados as Record<string,unknown>[]).entries())api.push({personId,month:Number(r.mes),documentId:String(r.codDocumento),category:String(r.tipoDespesa),cents:decimalCents(String(r.valorLiquido)),supplier:String(r.nomeFornecedor),number:String(r.numDocumento),date:(r.dataDocumento as string)||null,lot:String(r.codLote),page:page.url,row});
}
const annualMeta=JSON.parse(await fs.readFile(path.join(directory,'annual-2.meta.json'),'utf8'));
if(path.basename(annualMeta.file)!==annualMeta.file)throw new Error('Caminho inválido no manifesto');const archive=await fs.readFile(path.join(directory,annualMeta.file));
const [csvName,bytes]=Object.entries(unzipSync(archive)).find(([n])=>n.endsWith('.csv'))||[];if(!bytes)throw new Error('CSV ausente');
if(sha(bytes)!==annualMeta.sha256)throw new Error('CSV preservado não confere com o hash registrado');
const annual=[];let scanned=0;
const stream=Readable.from((function*(){for(let i=0;i<bytes.length;i+=65536)yield bytes.subarray(i,i+65536);})()).pipe(parse({columns:true,delimiter:';',bom:true,skip_empty_lines:true}));
for await(const r of stream){const row=scanned++;const personId=Number(r.ideCadastro),month=Number(r.numMes);
  if(!scope.ids.includes(personId)||Number(r.numAno)!==scope.year||!scope.months.includes(month))continue;
  annual.push({personId,month,documentId:r.ideDocumento||'',category:r.txtDescricao as string,cents:decimalCents(r.vlrLiquido),vlrDocumento:r.vlrDocumento as string,vlrGlosa:r.vlrGlosa as string,supplier:r.txtFornecedor as string,supplierId:r.txtCNPJCPF as string,number:r.txtNumero as string,date:(r.datEmissao as string)||null,lot:r.numLote as string,restitution:r.vlrRestituicao as string,row,legislature:Number(r.codLegislatura)});}

const result=pairOccurrences(annual,api);
const groups=new Map<string,typeof annual>();
for(const r of result.onlyAnnual){const k=`${r.category} · ${r.supplier}`;groups.set(k,[...(groups.get(k)||[]),r]);}
const report={
  runId,snapshotId:manifest.snapshotId,checkedAt:new Date().toISOString(),scope,
  sources:{apiPages:apiPages.length,apiPagesFetchedAt:[...new Set(apiPages.map((p:{fetchedAt:string})=>p.fetchedAt))].sort(),annualFile:csvName,annualSha256:annualMeta.sha256,annualFetchedAt:annualMeta.fetchedAt,scannedRows:scanned},
  counts:{annual:annual.length,api:api.length,matched:result.matched.length,onlyAnnual:result.onlyAnnual.length,onlyApi:result.onlyApi.length,matchedFieldMismatches:result.fieldMismatches.length},
  cents:{annual:String(result.annualCents),api:String(result.apiCents),onlyAnnual:String(result.onlyAnnualCents),onlyApi:String(result.onlyApiCents),annualMinusApi:String(result.annualCents-result.apiCents)},
  balanced:result.balanced,
  onlyAnnualByGroup:[...groups].map(([group,rows])=>({group,count:rows.length,cents:String(rows.reduce((n,r)=>n+r.cents,0n)),negatives:rows.filter(r=>r.cents<0n).length,documentIdZero:rows.filter(r=>r.documentId==='0').length,missingGlosa:rows.filter(r=>!r.vlrGlosa?.trim()).length})),
  onlyAnnual:result.onlyAnnual.map(r=>({...r,cents:String(r.cents),brl:brl(r.cents)})),
  onlyApi:result.onlyApi.map(r=>({...r,cents:String(r.cents)})),
  fieldMismatches:result.fieldMismatches.map(({annual:a,api:b})=>({personId:a.personId,month:a.month,documentId:a.documentId,annual:{number:a.number,date:a.date,lot:a.lot},api:{number:b.number,date:b.date,lot:b.lot}})),
  note:'Pareamento por pessoa/competência/documento/categoria/valor líquido, respeitando a quantidade de ocorrências; número, emissão e lote conferidos em cada par. Usa os arquivos preservados da execução, não uma nova consulta. Não é auditoria da legitimidade das despesas.'
};
await fs.mkdir('output/qa',{recursive:true});await fs.writeFile('output/qa/api-annual-reconciliation.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,onlyAnnual:undefined,onlyApi:undefined},null,2));
for(const r of result.onlyAnnual)console.log([r.personId,r.month,r.category,r.supplier,'doc '+(r.documentId||'(vazio)'),'nº '+(r.number||'(vazio)'),'vlrDocumento '+(r.vlrDocumento||'(vazio)'),'vlrGlosa '+(r.vlrGlosa||'(vazio)'),brl(r.cents)].join(' | '));
if(result.onlyApi.length||result.fieldMismatches.length||!result.balanced)process.exitCode=1;
