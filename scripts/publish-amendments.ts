import fs from 'node:fs/promises';
import path from 'node:path';
import {withLock} from '../src/lock.ts';
import {auditAmendmentsVersion,buildAmendmentsVersion,reobserveAmendmentsVersion,storeAmendmentsVersion} from '../src/amendments-publication.ts';
import {activePublication,recordDomainAudit} from '../src/publications.ts';
import {openDB} from '../src/store.ts';

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log('npm run publish:amendments -- --run ID --links ARQUIVO [--dry-run] [--approve [--local]]\nSó ligações revisadas atribuem emendas. Sem --approve a versão fica inativa.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--dry-run','--approve','--local'].includes(args[i]))continue;if(['--run','--links'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}throw new Error('Argumento inválido');}
const run=value('--run'),linksFile=value('--links'),dryRun=args.includes('--dry-run'),approve=args.includes('--approve'),database=process.env.DATABASE_URL?'DATABASE_URL':'local';
if(!/^[a-zA-Z0-9-]{1,80}$/.test(run)||!linksFile)throw new Error('Informe --run e --links');
if(dryRun&&approve)throw new Error('--dry-run e --approve são exclusivos');
if(args.includes('--local')&&process.env.DATABASE_URL)throw new Error('--local não pode ser usado com DATABASE_URL definida');
if(approve&&database==='local'&&!args.includes('--local'))throw new Error('Aprovação sem DATABASE_URL só vale para o banco local: confirme com --local');
const load=async(file:string)=>JSON.parse(await fs.readFile(path.resolve('data/private/amendments',run,file),'utf8'));
const report=await load('amendments.json'),audit=await load('audit.json'),version=buildAmendmentsVersion(report,audit,JSON.parse(await fs.readFile(path.resolve(linksFile),'utf8')),new Date().toISOString());
const summary={id:version.id,rows:version.rows.length,linkedAuthors:version.scope.linkedAuthors,authors:version.scope.authors};
if(dryRun){console.log(JSON.stringify({...summary,stored:false}));process.exit(0);}
await withLock(async()=>{
  const db=await openDB();
  try{
    await storeAmendmentsVersion(db,version);
    const result=await auditAmendmentsVersion(db,version.id,report);
    if(result.status!=='passed'){await recordDomainAudit(db,version.id,'failed',result);process.exitCode=1;}
    else if(approve){await db.query('BEGIN');try{await reobserveAmendmentsVersion(db,version.id);await recordDomainAudit(db,version.id,'passed',result);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}}
    console.log(JSON.stringify({...summary,database,stored:true,audit:result.status,active:(await activePublication(db,'emendas'))?.id===version.id}));
  }finally{await db.close();}
});
