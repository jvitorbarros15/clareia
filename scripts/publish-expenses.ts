import fs from 'node:fs/promises';
import path from 'node:path';
import {withLock} from '../src/lock.ts';
import {buildExpenseVersion} from '../src/expense-publication.ts';
import type {ExpenseLotRun} from '../src/expense-publication.ts';
import {activePublication,publishDomain,readPublication,recordDomainAudit} from '../src/publications.ts';
import {snapshotId} from '../src/model.ts';
import {openDB} from '../src/store.ts';

const args=process.argv.slice(2),runs:string[]=[];let historyRun='';
if(args.includes('--help')){console.log('npm run publish:expenses -- --history-run ID --run ID [--run ID...] [--dry-run] [--approve [--local]]\nReúne todos os lotes auditados de despesas numa versão. Sem --approve a versão fica gravada e inativa. --dry-run não abre o banco. Sem DATABASE_URL, --approve exige --local.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--dry-run','--approve','--local'].includes(args[i]))continue;const next=args[i+1]??'';if(args[i]==='--run'&&/^[a-zA-Z0-9-]{1,80}$/.test(next)){runs.push(next);i++;continue;}if(args[i]==='--history-run'&&/^[a-zA-Z0-9-]{1,80}$/.test(next)&&!historyRun){historyRun=next;i++;continue;}throw new Error('Argumento inválido');}
const dryRun=args.includes('--dry-run'),approve=args.includes('--approve'),database=process.env.DATABASE_URL?'DATABASE_URL':'local';
if(!runs.length||!historyRun)throw new Error('Informe --history-run e ao menos um --run');
if(new Set(runs).size!==runs.length)throw new Error('Lote repetido');
if(dryRun&&approve)throw new Error('--dry-run e --approve são exclusivos');
if(args.includes('--local')&&process.env.DATABASE_URL)throw new Error('--local não pode ser usado com DATABASE_URL definida');
if(approve&&database==='local'&&!args.includes('--local'))throw new Error('Aprovação sem DATABASE_URL só vale para o banco local: confirme com --local');
const load=async(folder:string,file:string)=>JSON.parse(await fs.readFile(path.resolve(folder,file),'utf8'));
const lots:ExpenseLotRun[]=await Promise.all(runs.map(async runId=>{const folder=path.join('data/private/expense-intermediate',runId);return {runId,manifest:await load(folder,'run.json'),input:await load(folder,'input.json'),report:await load(folder,'batch.json'),audit:await load(folder,'audit.json')};}));
const history=await load(path.join('data/private/people-history',historyRun),'history.json');
const version=buildExpenseVersion(lots,history,new Date().toISOString());
const held=version.validation.heldMonths??{};
const summary={id:version.id,deputies:version.scope.ids.length,records:version.records.length,totalCents:version.validation.totalCents,heldCompetences:Object.values(held).reduce((a,b)=>a+b,0),deputiesWithHeld:Object.keys(held).length,lots:runs.length};
if(dryRun){console.log(JSON.stringify({...summary,stored:false},null,2));process.exit(0);}
await withLock(async()=>{
  const db=await openDB();
  try{
    await publishDomain(db,'despesas',version);
    // Re-read what the database now holds; the lot audits already re-derived every competence from the sealed originals.
    const stored=await readPublication(db,version.id),failures:string[]=[];
    if(!stored)failures.push('not-stored');
    else{
      if(snapshotId(stored)!==version.id)failures.push('content-id');
      if(stored.records.length!==version.validation.recordCount)failures.push('record-count');
      if(String(stored.records.reduce((n,r)=>n+BigInt(r.cents),0n))!==version.validation.independentTotalCents)failures.push('total');
    }
    const report={checkedAt:new Date().toISOString(),status:failures.length?'failed':'passed',failures,lots:lots.length,competences:lots.reduce((n,l)=>n+l.audit.competences,0),selected:version.records.length,groupsCompared:lots.reduce((n,l)=>n+l.audit.competences,0)};
    if(failures.length){await recordDomainAudit(db,version.id,'failed',report);console.error(JSON.stringify({id:version.id,failures}));process.exitCode=1;}
    else if(approve)await recordDomainAudit(db,version.id,'passed',report);
    console.log(JSON.stringify({...summary,database,stored:true,audit:report.status,active:(await activePublication(db,'despesas'))?.id===version.id},null,2));
  }finally{await db.close();}
});
