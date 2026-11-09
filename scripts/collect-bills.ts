import fs from 'node:fs/promises';
import path from 'node:path';
import {lock as acquireLock} from '../src/lock.ts';
import {auditBills} from '../src/bills-audit.ts';
import {billAuthorsUrl,billsReport,billsUrl,billTramitacoesUrl,deriveBills} from '../src/bills.ts';
import type {BillSource} from '../src/bills.ts';
import {findCpfs} from '../src/cpf-scan.ts';
import {canonical} from '../src/model.ts';
import {PeopleCapture} from '../src/people-discovery.ts';
import {readLocalPeopleKey} from '../src/people-history.ts';
import {open,vaultKey} from '../src/vault.ts';

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log('npm run collect:bills -- --local --year AAAA --run ID [--offline]\nDois passes dos arquivos de proposições e autores. Resultado apenas para revisão, sem publicação.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--local','--offline'].includes(args[i]))continue;if(['--year','--run'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}throw new Error('Argumento inválido');}
const year=Number(value('--year')),runId=value('--run');
if(!/^20\d{2}$/.test(String(year))||!/^[a-zA-Z0-9-]{1,80}$/.test(runId))throw new Error('Ano ou execução inválidos');
const key=args.includes('--local')?await readLocalPeopleKey():vaultKey(),root=path.resolve('data/private/bills',runId);
await fs.mkdir(root,{recursive:true});
const release=await acquireLock(path.join(root,'running.lock'));
try{
  const capture=(pass:number)=>new PeopleCapture(path.join(root,'pass-'+pass),key,args.includes('--offline')?async()=>new Response('',{status:404}):undefined);
  const passes=[];for(const pass of [1,2])passes.push(await (async()=>{const c=capture(pass),bills=await c.get(billsUrl(year)),authors=await c.get(billAuthorsUrl(year));const derived=await deriveBills(year,bills.bytes,authors.bytes,async id=>JSON.parse(Buffer.from((await c.get(billTramitacoesUrl(id))).bytes).toString()).dados);return {derived,sources:c.captures.map(s=>({...s,pass})) as BillSource[]};})());
  if(canonical(passes[0].derived)!==canonical(passes[1].derived))throw new Error('Arquivos mudaram entre os passes; nada foi aprovado');
  const report=billsReport(year,passes[1].derived,passes.flatMap(p=>p.sources),new Date().toISOString());
  if(findCpfs(JSON.stringify(report),new Set()))throw new Error('Identificador privado no relatório');
  const audit=await auditBills(report,async s=>open(await fs.readFile(path.join(root,'pass-'+s.pass,s.file)),key));
  await fs.writeFile(path.join(root,'bills.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'audit.json'),JSON.stringify(audit,null,2));
  const issues:Record<string,number>={},types:Record<string,number>={};for(const b of report.bills){types[b.type]=(types[b.type]??0)+1;for(const i of b.issues)issues[i]=(issues[i]??0)+1;}
  console.log(JSON.stringify({audit:audit.status,failures:audit.failures.length,metrics:report.metrics,types,issues,deputiesWithBills:report.people.length,publicationEligible:report.publicationEligible},null,2));
  if(audit.status!=='passed')process.exitCode=1;
}catch(e){console.error('Coleta de proposições recusada: '+(e instanceof Error?e.message.slice(0,200):'erro'));process.exitCode=1;}
finally{await release();}
