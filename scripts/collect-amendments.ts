import fs from 'node:fs/promises';
import path from 'node:path';
import {lock as acquireLock} from '../src/lock.ts';
import {auditAmendments} from '../src/amendments-audit.ts';
import {AMENDMENTS_URL,amendmentsCsv,amendmentsReport,deriveAmendments} from '../src/amendments.ts';
import type {AmendmentSource,KnownPerson} from '../src/amendments.ts';
import {findCpfs} from '../src/cpf-scan.ts';
import {canonical} from '../src/model.ts';
import {PeopleCapture} from '../src/people-discovery.ts';
import {readLocalPeopleKey} from '../src/people-history.ts';
import {open,vaultKey} from '../src/vault.ts';

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log('npm run collect:amendments -- --local --from AAAA --history-run ID --run ID [--offline]\nDois passes do arquivo da CGU. Ligações autor-deputado apenas propostas para revisão; nada é atribuído nem publicado.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--local','--offline'].includes(args[i]))continue;if(['--from','--run','--history-run'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}throw new Error('Argumento inválido');}
const fromYear=Number(value('--from')),runId=value('--run'),historyRun=value('--history-run');
if(!/^20\d{2}$/.test(String(fromYear))||[runId,historyRun].some(id=>!/^[a-zA-Z0-9-]{1,80}$/.test(id)))throw new Error('Parâmetros inválidos');
const key=args.includes('--local')?await readLocalPeopleKey():vaultKey(),root=path.resolve('data/private/amendments',runId);
await fs.mkdir(root,{recursive:true});
const release=await acquireLock(path.join(root,'running.lock'));
try{
  const history=JSON.parse(await fs.readFile(path.resolve('data/private/people-history',historyRun,'history.json'),'utf8'));
  const people:KnownPerson[]=history.people.filter((p:{profile:{name?:string}|null})=>p.profile?.name).map((p:{id:number;profile:{name:string}})=>({id:p.id,name:p.profile.name}));
  const passes=[];
  for(const pass of [1,2]){
    const c=new PeopleCapture(path.join(root,'pass-'+pass),key,args.includes('--offline')?async()=>new Response('',{status:404}):undefined),{bytes}=await c.get(AMENDMENTS_URL);
    passes.push({derived:await deriveAmendments(amendmentsCsv(bytes),fromYear,people),sources:c.captures.map(s=>({...s,pass})) as AmendmentSource[]});
  }
  if(canonical(passes[0].derived)!==canonical(passes[1].derived))throw new Error('Arquivo mudou entre os passes; nada foi aprovado');
  const report=amendmentsReport(fromYear,passes[1].derived,passes.flatMap(p=>p.sources),new Date().toISOString());
  if(findCpfs(JSON.stringify(report),new Set()))throw new Error('Identificador privado no relatório');
  const audit=await auditAmendments(report,async s=>open(await fs.readFile(path.join(root,'pass-'+s.pass,s.file)),key));
  await fs.writeFile(path.join(root,'amendments.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'audit.json'),JSON.stringify(audit,null,2));
  const links:Record<string,number>={};for(const l of report.links)links[l.status]=(links[l.status]??0)+1;
  console.log(JSON.stringify({audit:audit.status,failures:audit.failures,metrics:report.metrics,authors:report.authors.length,links,excluded:Object.fromEntries(Object.entries(report.excluded).map(([k,t])=>[k,t.rows])),publicationEligible:report.publicationEligible}));
  if(audit.status!=='passed')process.exitCode=1;
}catch(e){console.error('Coleta de emendas recusada: '+(e instanceof Error?e.message.slice(0,200):'erro'));process.exitCode=1;}
finally{await release();}
