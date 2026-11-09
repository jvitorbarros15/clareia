import fs from 'node:fs/promises';
import path from 'node:path';
import {lock as acquireLock} from '../src/lock.ts';
import {auditVotes} from '../src/votes-audit.ts';
import {deriveVotes,voteFileUrl,votesReport} from '../src/votes.ts';
import type {VoteSource} from '../src/votes.ts';
import {findCpfs} from '../src/cpf-scan.ts';
import {canonical} from '../src/model.ts';
import {PeopleCapture} from '../src/people-discovery.ts';
import {readLocalPeopleKey} from '../src/people-history.ts';
import {open,vaultKey} from '../src/vault.ts';

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log('npm run collect:votes -- --local --year AAAA --run ID [--offline]\nDois passes de votações, votos e objetos. Resultado apenas para revisão, sem publicação.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--local','--offline'].includes(args[i]))continue;if(['--year','--run'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}throw new Error('Argumento inválido');}
const year=Number(value('--year')),runId=value('--run');
if(!/^20\d{2}$/.test(String(year))||!/^[a-zA-Z0-9-]{1,80}$/.test(runId))throw new Error('Ano ou execução inválidos');
const key=args.includes('--local')?await readLocalPeopleKey():vaultKey(),root=path.resolve('data/private/votes',runId);
await fs.mkdir(root,{recursive:true});
const release=await acquireLock(path.join(root,'running.lock'));
try{
  const passes=[];
  for(const pass of [1,2]){
    const c=new PeopleCapture(path.join(root,'pass-'+pass),key,args.includes('--offline')?async()=>new Response('',{status:404}):undefined);
    const votes=await c.get(voteFileUrl('votacoes',year)),ballots=await c.get(voteFileUrl('votacoesVotos',year)),objects=await c.get(voteFileUrl('votacoesObjetos',year));
    passes.push({derived:await deriveVotes(year,votes.bytes,ballots.bytes,objects.bytes),sources:c.captures.map(s=>({...s,pass})) as VoteSource[]});
  }
  if(canonical(passes[0].derived)!==canonical(passes[1].derived))throw new Error('Arquivos mudaram entre os passes; nada foi aprovado');
  const report=votesReport(year,passes[1].derived,passes.flatMap(p=>p.sources),new Date().toISOString());
  if(findCpfs(JSON.stringify(report),new Set()))throw new Error('Identificador privado no relatório');
  const audit=await auditVotes(report,passes[1].derived.ballots,async s=>open(await fs.readFile(path.join(root,'pass-'+s.pass,s.file)),key));
  await fs.writeFile(path.join(root,'votes.json'),JSON.stringify(report));await fs.writeFile(path.join(root,'ballots.json'),JSON.stringify(passes[1].derived.ballots));await fs.writeFile(path.join(root,'audit.json'),JSON.stringify(audit,null,2));
  const issues:Record<string,number>={};for(const v of report.votes)for(const i of v.issues)issues[i]=(issues[i]??0)+1;
  console.log(JSON.stringify({audit:audit.status,failures:audit.failures.length,metrics:report.metrics,issues,publicationEligible:report.publicationEligible}));
  if(audit.status!=='passed')process.exitCode=1;
}catch(e){console.error('Coleta de votações recusada: '+(e instanceof Error?e.message.slice(0,200):'erro'));process.exitCode=1;}
finally{await release();}
