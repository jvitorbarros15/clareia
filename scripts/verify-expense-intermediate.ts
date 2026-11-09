import {lock as acquireLock} from '../src/lock.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import {canonical,hash} from '../src/model.ts';
import {readLocalPeopleKey} from '../src/people-history.ts';
import {auditExpenseBatch} from '../src/expense-intermediate-audit.ts';
import {open,vaultKey} from '../src/vault.ts';

const args=process.argv.slice(2),i=args.indexOf('--run'),runId=i<0?'':args[i+1];
if(args.includes('--help')){console.log('npm run verify:expenses:intermediate -- --local --run ID\nAuditoria independente das capturas financeiras cifradas, sem publicação.');process.exit(0);}
for(let n=0;n<args.length;n++){if(args[n]==='--local')continue;if(args[n]==='--run'&&args[n+1]&&!args[n+1].startsWith('--')){n++;continue;}throw Error('Argumento inválido');}
if(!/^[a-zA-Z0-9-]{1,80}$/.test(runId))throw Error('Execução inválida');
const root=path.resolve('data/private/expense-intermediate',runId),key=args.includes('--local')?await readLocalPeopleKey():vaultKey(),lock=await acquireLock(path.join(root,'running.lock'));
try{
  const load=async(name:string)=>JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
  const manifest=await load('run.json'),input=await load('input.json'),report=await load('batch.json');
  if(manifest.runId!==runId||manifest.status!=='review-required'||manifest.portalRequested!==report.portalRequested||hash(canonical(input))!==manifest.inputSha256||hash(canonical(report))!==manifest.reportSha256||hash(canonical(input.proposal))!==manifest.proposalSha256)throw Error('Versões financeiras divergem');
  const scope={year:input.proposal.year,legislature:input.temporal.scope.legislature,ids:input.proposal.people.map((p:any)=>p.id),months:input.proposal.months};
  if(canonical(scope)!==canonical(manifest.scope)||input.proposal.temporalSha256!==hash(canonical(input.temporal))||input.originAudit.status!=='passed'||input.originAudit.temporalSha256!==input.proposal.temporalSha256||input.originAudit.crosscheckSha256!==input.proposal.crosscheckSha256)throw Error('Seleção financeira diverge');
  const audit=await auditExpenseBatch(report,input.temporal,scope,manifest.proposalSha256,async source=>{
    if(![1,2].includes(source.pass)||source.file!==hash(source.url)+'.sealed')throw Error('Referência financeira inválida');
    return open(await fs.readFile(path.join(root,'pass-'+source.pass,source.file)),key);
  });
  await fs.writeFile(path.join(root,'reports',audit.reportSha256+'.audit.json'),JSON.stringify(audit,null,2));await fs.writeFile(path.join(root,'audit.json'),JSON.stringify(audit,null,2));
  console.log(JSON.stringify({audit,coverage:manifest.coverage,records:report.cells.reduce((n:number,c:any)=>n+c.records.length,0),metrics:report.metrics},null,2));if(audit.status!=='passed')process.exitCode=1;
}catch{console.error('Auditoria financeira recusada; originais preservados e publicação desativada.');process.exitCode=1;}
finally{await lock();}
