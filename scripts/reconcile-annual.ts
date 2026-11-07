import fs from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {unzipSync} from 'fflate';
import {parse} from 'csv-parse';
import {createHash} from 'node:crypto';
import {openDB,readSnapshot,recordAudit} from '../src/store.ts';
import type {AuditReport} from '../src/store.ts';
import {withLock} from '../src/lock.ts';

// Reads the database directly: a version must be auditable before the site is allowed to serve it. Stop the server first.
const withDB=<T>(task:(db:Awaited<ReturnType<typeof openDB>>)=>Promise<T>)=>withLock(async()=>{const db=await openDB();try{return await task(db);}finally{await db.close();}});
const {initial,runId}=await withDB(async db=>{const initial=await readSnapshot(db);if(!initial)throw new Error('Nenhuma versão publicada para conferir');const run=await db.query<{id:string}>(`SELECT id FROM runs WHERE snapshot_id=$1 AND status='published' ORDER BY finished_at DESC LIMIT 1`,[initial.id]);if(!run.rows[0])throw new Error('Nenhuma execução publicada produziu esta versão');return {initial,runId:run.rows[0].id};});
const snapshotId=initial.id,records=initial.records.filter(r=>r.origin!=='api'),apiOnly=initial.records.length-records.length;
// The run's own copy: the file on the Câmara site changes, and the audit is about what this version was built from.
const directory=path.join('data/runs',runId),source=JSON.parse(await fs.readFile(path.join(directory,'annual-2.meta.json'),'utf8'));
const archive=await fs.readFile(path.join(directory,source.file));
const files=unzipSync(archive),file=Object.entries(files).find(([name])=>name.endsWith('.csv'));if(!file)throw new Error('CSV oficial ausente');
const bytes=file[1],csvSha256=createHash('sha256').update(bytes).digest('hex');
const sourceSha256=[...new Set(records.map(r=>r.source.sha256))];
if(sourceSha256.length!==1||sourceSha256[0]!==csvSha256)throw new Error('O CSV preservado na execução não é o mesmo arquivo da versão publicada');
const stream=Readable.from((function*(){for(let i=0;i<bytes.length;i+=65536)yield bytes.subarray(i,i+65536);})()).pipe(parse({columns:true,delimiter:';',bom:true,skip_empty_lines:true}));
const apiGroups=new Map<string,{count:number;cents:bigint}>(),bulkGroups=new Map<string,{count:number;cents:bigint}>();
const apiRows=new Map<string,number>(),bulkRows=new Map<string,number>();
const add=(map:Map<string,{count:number;cents:bigint}>,key:string,n:bigint)=>{const v=map.get(key)||{count:0,cents:0n};v.count++;v.cents+=n;map.set(key,v);};
const occurrence=(map:Map<string,number>,key:string)=>map.set(key,(map.get(key)||0)+1);
for(const r of records){add(apiGroups,`${r.personId}/${r.month}/${r.category}`,BigInt(r.cents));occurrence(apiRows,JSON.stringify([r.personId,r.year,r.month,r.documentId,r.category,String(r.cents)]));}
let scanned=0,selected=0,refundCents=0n,missingDocumentOrGlosa=0;
// Independent parser: CSV decimal strings -> BigInt, no shared metric code.
function decimal(text:string){const clean=text.trim().replace(',','.');if(!/^-?\d+(\.\d{1,2})?$/.test(clean))throw new Error('Unexpected CSV money: '+JSON.stringify(text));const [whole,part='']=clean.replace('-','').split('.');return(BigInt(whole)*100n+BigInt(part.padEnd(2,'0')))*(clean.startsWith('-')?-1n:1n);}
for await(const r of stream){scanned++;const id=Number(r.ideCadastro),month=Number(r.numMes);if(!initial.scope.ids.includes(id)||Number(r.numAno)!==initial.scope.year||!initial.scope.months.includes(month))continue;selected++;
  const net=decimal(r.vlrLiquido);add(bulkGroups,`${id}/${month}/${r.txtDescricao}`,net);
  occurrence(bulkRows,JSON.stringify([id,Number(r.numAno),month,String(r.ideDocumento),r.txtDescricao,String(net)]));
  if(!r.vlrDocumento?.trim()||!r.vlrGlosa?.trim())missingDocumentOrGlosa++;
  if(r.vlrRestituicao?.trim())refundCents+=decimal(r.vlrRestituicao);
}
const differences=[];
for(const key of new Set([...apiGroups.keys(),...bulkGroups.keys()])){const a=apiGroups.get(key),b=bulkGroups.get(key);if(a?.count!==b?.count||a?.cents!==b?.cents)differences.push({group:key,api:a?{count:a.count,cents:String(a.cents)}:null,annual:b?{count:b.count,cents:String(b.cents)}:null});}
let mismatchedOccurrences=0;for(const key of new Set([...apiRows.keys(),...bulkRows.keys()]))if(apiRows.get(key)!==bulkRows.get(key))mismatchedOccurrences++;
// API-only records have no CSV row: each one must be found, value included, in the API pages preserved by the same run.
const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8')),pageRows=new Map<string,number>();
for(const page of manifest.pages.filter((p:{pass:number;url:string})=>p.pass===1&&p.url.includes('/despesas'))){
  const text=await fs.readFile(path.join(directory,page.file),'utf8');if(createHash('sha256').update(text).digest('hex')!==page.sha256)throw new Error('Página preservada alterada: '+page.file);
  const personId=Number(new URL(page.url).pathname.split('/')[4]);
  for(const r of JSON.parse(text).dados)occurrence(pageRows,JSON.stringify([personId,r.ano,r.mes,String(r.codDocumento),r.tipoDespesa,String(decimal(String(r.valorLiquido)))]));
}
let apiOnlyUnconfirmed=0;for(const r of initial.records.filter(r=>r.origin==='api')){const key=JSON.stringify([r.personId,r.year,r.month,r.documentId,r.category,String(r.cents)]),n=pageRows.get(key)||0;if(n)pageRows.set(key,n-1);else apiOnlyUnconfirmed++;}
const report={status:!differences.length&&!mismatchedOccurrences&&!apiOnlyUnconfirmed&&apiOnly===(initial.validation.apiComparison?.extraInApi||0)?'passed':'failed',apiOnly,apiOnlyUnconfirmed,runId,snapshotId,checkedAt:new Date().toISOString(),source,archiveSha256:createHash('sha256').update(archive).digest('hex'),scanned,selected,csvSha256,servedCount:records.length,groupsCompared:apiGroups.size,mismatchedOccurrences,differences,annualRefundCents:String(refundCents),missingDocumentOrGlosa,note:'Releitura independente do mesmo arquivo anual usado na versão (hash conferido), por parser separado, contra os registros gravados no banco. Registros só da API são conferidos nas páginas preservadas da mesma execução. A comparação completa com a API fica em npm run verify:api-annual. Contagem e valor líquido por pessoa/mês/categoria, e multiconjunto por pessoa/ano/mês/documento/categoria/valor líquido. Campos documento/glosa vazios no CSV permanecem desconhecidos. Restituições informadas separadamente, sem nova subtração. Não é auditoria da legitimidade da despesa.'};
await fs.mkdir('output/qa',{recursive:true});await fs.writeFile('output/qa/real-source-audit.json',JSON.stringify(report,null,2));
await withDB(db=>recordAudit(db,report as AuditReport));
console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;
