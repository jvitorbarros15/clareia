import fs from 'node:fs/promises';
import path from 'node:path';
import {withLock} from '../src/lock.ts';
import {auditBillsVersion,buildBillsVersion,reobserveBillsVersion,storeBillsVersion} from '../src/bills-publication.ts';
import {activePublication,recordDomainAudit} from '../src/publications.ts';
import {openDB} from '../src/store.ts';

const args=process.argv.slice(2),runs:string[]=[];
if(args.includes('--help')){console.log('npm run publish:bills -- --run ID [--run ID...] [--dry-run] [--approve [--local]]\nSem --approve a versão fica gravada e inativa. --dry-run não abre o banco. Sem DATABASE_URL, --approve exige --local.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--dry-run','--approve','--local'].includes(args[i]))continue;if(args[i]==='--run'&&/^[a-zA-Z0-9-]{1,80}$/.test(args[i+1]??'')){runs.push(args[++i]);continue;}throw new Error('Argumento inválido');}
const dryRun=args.includes('--dry-run'),approve=args.includes('--approve'),database=process.env.DATABASE_URL?'DATABASE_URL':'local';
if(!runs.length)throw new Error('Informe ao menos um --run');
if(dryRun&&approve)throw new Error('--dry-run e --approve são exclusivos');
if(args.includes('--local')&&process.env.DATABASE_URL)throw new Error('--local não pode ser usado com DATABASE_URL definida');
// The scheduled build restores its database from R2, so a local approval never reaches it.
if(approve&&database==='local'&&!args.includes('--local'))throw new Error('Aprovação sem DATABASE_URL só vale para o banco local: confirme com --local');
const load=async(run:string,file:string)=>JSON.parse(await fs.readFile(path.resolve('data/private/bills',run,file),'utf8'));
const pairs=await Promise.all(runs.map(async run=>({report:await load(run,'bills.json'),audit:await load(run,'audit.json')})));
const version=buildBillsVersion(pairs,new Date().toISOString());
const summary={id:version.id,years:version.scope.years,bills:version.bills.length,held:version.bills.filter(b=>b.issues.length).length,deputies:version.people.length,norms:version.bills.filter(b=>b.normStatus==='resolved').length,normsUnresolved:version.bills.filter(b=>b.normStatus==='unresolved').length};
if(dryRun){console.log(JSON.stringify({...summary,stored:false},null,2));process.exit(0);}
await withLock(async()=>{
  const db=await openDB();
  try{
    await storeBillsVersion(db,version);
    const audit=await auditBillsVersion(db,version.id,pairs.map(p=>p.report));
    if(audit.status!=='passed'){await recordDomainAudit(db,version.id,'failed',audit);console.error(JSON.stringify({id:version.id,failures:audit.failures}));process.exitCode=1;}
    else if(approve){await db.query('BEGIN');try{await reobserveBillsVersion(db,version.id);await recordDomainAudit(db,version.id,'passed',audit);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}}
    console.log(JSON.stringify({...summary,database,stored:true,audit:audit.status,active:(await activePublication(db,'projetos'))?.id===version.id},null,2));
  }finally{await db.close();}
});
