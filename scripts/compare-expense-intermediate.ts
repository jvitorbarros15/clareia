import {lock as acquireLock} from '../src/lock.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import {canonical,hash} from '../src/model.ts';
import {readLocalPeopleKey} from '../src/people-history.ts';
import {open,vaultKey} from '../src/vault.ts';
import {auditExpenseBatch} from '../src/expense-intermediate-audit.ts';
import {compareExpenseBatches} from '../src/expense-changes.ts';
import type {ExpenseBatch} from '../src/expense-intermediate.ts';

const args=process.argv.slice(2),value=(flag:string)=>{const n=args.indexOf(flag);return n<0?'':args[n+1];};
if(args.includes('--help')){console.log('npm run compare:expenses:intermediate -- --local --before-run ID --before-version SHA256 --after-run ID --after-version SHA256\nRelê e audita duas versões preservadas, compara sem rede e grava somente relatório privado de revisão. Não publica.');process.exit(0);}
for(let n=0;n<args.length;n++){if(args[n]==='--local')continue;if(['--before-run','--after-run','--before-version','--after-version'].includes(args[n])&&args[n+1]&&!args[n+1].startsWith('--')){n++;continue;}throw Error('Argumento inválido');}
const runs=[value('--before-run'),value('--after-run')],versions=[value('--before-version'),value('--after-version')];
if(runs.some(v=>!/^[a-zA-Z0-9-]{1,80}$/.test(v))||versions.some(v=>!/^[a-f0-9]{64}$/.test(v)))throw Error('Execuções ou versões inválidas');
const key=args.includes('--local')?await readLocalPeopleKey():vaultKey(),locks:(()=>Promise<void>)[]=[],loaded=new Map<string,ExpenseBatch>();
try{
  for(const run of [...new Set(runs)].sort()){const file=path.resolve('data/private/expense-intermediate',run,'running.lock');locks.push(await acquireLock(file));}
  async function load(run:string,version:string):Promise<ExpenseBatch>{
    const identity=run+':'+version;if(loaded.has(identity))return loaded.get(identity)!;
    const root=path.resolve('data/private/expense-intermediate',run),input=JSON.parse(await fs.readFile(path.join(root,'input.json'),'utf8')),report=JSON.parse(await fs.readFile(path.join(root,'reports',version+'.batch.json'),'utf8')) as ExpenseBatch;
    if(hash(canonical(report))!==version||input.proposal.temporalSha256!==hash(canonical(input.temporal))||input.originAudit.status!=='passed'||input.originAudit.temporalSha256!==input.proposal.temporalSha256||input.originAudit.crosscheckSha256!==input.proposal.crosscheckSha256)throw Error('Origem de versão diverge');
    const scope={year:input.proposal.year,legislature:input.temporal.scope.legislature,ids:input.proposal.people.map((p:any)=>p.id),months:input.proposal.months};
    const audit=await auditExpenseBatch(report,input.temporal,scope,hash(canonical(input.proposal)),async s=>{if(![1,2].includes(s.pass)||s.file!==hash(s.url)+'.sealed')throw Error('Original inválido');return open(await fs.readFile(path.join(root,'pass-'+s.pass,s.file)),key);});
    if(audit.status!=='passed')throw Error('Versão não passou na releitura independente');loaded.set(identity,report);return report;
  }
  const before=await load(runs[0],versions[0]),after=await load(runs[1],versions[1]),report=compareExpenseBatches(before,after),folder=path.resolve('data/private/expense-comparisons');await fs.mkdir(folder,{recursive:true});const file=path.join(folder,report.id+'.json');
  try{await fs.writeFile(file,JSON.stringify(report,null,2),{flag:'wx',mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const old=JSON.parse(await fs.readFile(file,'utf8')),{createdAt:_created,...body}=old,{createdAt:_now,...next}=report;if(canonical(body)!==canonical(next))throw Error('Relatório preservado diverge');}
  console.log(JSON.stringify({id:report.id,status:report.status,reasons:report.reasons,summary:report.summary,publicationEligible:false},null,2));
}catch{console.error('Comparação recusada; confira versões, auditorias, escopo e locks. Nenhuma publicação foi alterada.');process.exitCode=1;}
finally{for(const release of locks.reverse())await release();}
