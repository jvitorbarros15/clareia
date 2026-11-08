import fs from 'node:fs/promises';
import path from 'node:path';
import {PeopleCapture} from '../src/people-discovery.ts';
import type {DiscoveryReport} from '../src/people-discovery.ts';
import {collectHistory,readLocalPeopleKey,readAuditedPeopleDiscovery} from '../src/people-history.ts';
import {canonical,hash} from '../src/model.ts';
import {vaultKey} from '../src/vault.ts';

const args=process.argv.slice(2),value=(name:string,fallback:string)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
if(args.includes('--help')){console.log('npm run collect:people -- --local --discovery-run ID --run ID [--workers 1|2|3]\nDois passes de histórico, originais cifrados, resultados apenas para revisão.');process.exit(0);}
for(let i=0;i<args.length;i++){if(args[i]==='--local')continue;if(['--discovery-run','--run','--workers'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}throw new Error('Argumento inválido');}
const discoveryId=value('--discovery-run',''),runId=value('--run',''),workers=Number(value('--workers','2'));
if([runId,discoveryId].some(id=>!/^[a-zA-Z0-9-]{1,80}$/.test(id)))throw new Error('Identificador inválido');
if(!Number.isInteger(workers)||workers<1||workers>3)throw new Error('Concorrência inválida');
const key=args.includes('--local')?await readLocalPeopleKey():vaultKey();
const root=path.resolve('data/private/people-history',runId),manifestFile=path.join(root,'run.json');
await fs.mkdir(root,{recursive:true});
const lock=await fs.open(path.join(root,'running.lock'),'wx',0o600);
let manifest:{runId:string;discoveryRun:string;discoverySha256:string;scope:DiscoveryReport['scope'];startedAt:string;status:string};
try{
  const existing=await fs.readFile(manifestFile,'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;return null;});
  const previous=existing?JSON.parse(existing):null;
  if(previous?.discoveryRun&&previous.discoveryRun!==discoveryId)throw new Error('Não retomar com outra descoberta');
  const discovery=await readAuditedPeopleDiscovery(discoveryId,previous?.discoverySha256),discoverySha256=hash(canonical(discovery));
  if(previous){if(previous.discoverySha256!==discoverySha256)throw new Error('Não retomar com outra descoberta');manifest={...previous,discoveryRun:discoveryId,status:'collecting'};}
  else manifest={runId,discoveryRun:discoveryId,discoverySha256,scope:discovery.scope,startedAt:new Date().toISOString(),status:'collecting'};
  // Scope mismatch above must never overwrite the old manifest.
  await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2));
  try{
    const pass1=new PeopleCapture(path.join(root,'pass-1'),key),pass2=new PeopleCapture(path.join(root,'pass-2'),key);
    const report=await collectHistory(discovery,pass1,pass2,{workers,progress:(pass,done,total)=>{if(done%20===0||done===total)console.log(`Históricos: passe ${pass}, ${done}/${total}`);}});
    const reportHash=hash(canonical(report)),reports=path.join(root,'reports');await fs.mkdir(reports,{recursive:true});
    await fs.writeFile(path.join(reports,reportHash+'.json'),JSON.stringify(report,null,2));
    await fs.writeFile(path.join(root,'history.json'),JSON.stringify(report,null,2));
    await fs.writeFile(manifestFile,JSON.stringify({...manifest,status:report.coverage.failed||report.coverage.changed?'review-required':'collected',finishedAt:new Date().toISOString(),reportSha256:reportHash,coverage:report.coverage},null,2));
    console.log(JSON.stringify({runId,status:report.status,coverage:report.coverage,publicAttribution:'disabled'},null,2));
    if(report.coverage.failed||report.coverage.changed)process.exitCode=1;
  }catch{
    await fs.writeFile(manifestFile,JSON.stringify({...manifest,status:'failed',failedAt:new Date().toISOString()},null,2));
    console.error(`Coleta ${runId} não concluída; originais cifrados preservados. Retome com o mesmo --run.`);process.exitCode=1;
  }
}finally{await lock.close();await fs.unlink(path.join(root,'running.lock'));}
