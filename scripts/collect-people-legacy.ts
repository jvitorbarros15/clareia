import fs from 'node:fs/promises';
import path from 'node:path';
import {canonical,hash} from '../src/model.ts';
import {PeopleCapture} from '../src/people-discovery.ts';
import {readAuditedPeopleDiscovery,readLocalPeopleKey} from '../src/people-history.ts';
import type {HistoryReport} from '../src/people-history.ts';
import type {TemporalReport} from '../src/people-temporal.ts';
import {collectLegacy} from '../src/people-legacy.ts';
import {vaultKey} from '../src/vault.ts';

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1];};
if(args.includes('--help')){console.log('npm run collect:people:legacy -- --local --discovery-run ID --history-run ID --run ID [--workers 1|2|3] [--offline]\nColeta XML em dois passes cifrados para revisão. --offline reprocessa originais existentes sem rede. Não altera dados publicados.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--local','--offline'].includes(args[i]))continue;if(['--discovery-run','--history-run','--run','--workers'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}throw Error('Argumento inválido');}
const discoveryId=value('--discovery-run'),historyId=value('--history-run'),runId=value('--run'),workers=Number(value('--workers')||'2');
if([runId,discoveryId,historyId].some(id=>!/^[a-zA-Z0-9-]{1,80}$/.test(id))||!Number.isInteger(workers)||workers<1||workers>3)throw Error('Execução ou concorrência inválida');
const root=path.resolve('data/private/people-legacy',runId),historyRoot=path.resolve('data/private/people-history',historyId);
const key=args.includes('--local')?await readLocalPeopleKey():vaultKey();
await fs.mkdir(root,{recursive:true});const lock=await fs.open(path.join(root,'running.lock'),'wx',0o600);
try{
  const previous=await fs.readFile(path.join(root,'run.json'),'utf8').then(JSON.parse).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;return null;});
  if(previous&&(previous.historyRun!==historyId||previous.discoveryRun!==discoveryId))throw Error('Outra origem não pode retomar esta execução');
  // Pin normalized input versions before releasing the history lock. Resuming
  // an older run uses these immutable copies instead of mutable current files.
  let history:HistoryReport,temporal:TemporalReport;
  if(previous){
    history=JSON.parse(await fs.readFile(path.join(root,'input-history.json'),'utf8'));
    temporal=JSON.parse(await fs.readFile(path.join(root,'input-temporal.json'),'utf8'));
    if(hash(canonical(history))!==previous.historySha256||hash(canonical(temporal))!==previous.temporalSha256)throw Error('Entradas preservadas divergiram');
  }else{
    const inputLock=await fs.open(path.join(historyRoot,'running.lock'),'wx',0o600);
    try{
      history=JSON.parse(await fs.readFile(path.join(historyRoot,'history.json'),'utf8'));
      temporal=JSON.parse(await fs.readFile(path.join(historyRoot,'temporal.json'),'utf8'));
      const audit=JSON.parse(await fs.readFile(path.join(historyRoot,'temporal-audit.json'),'utf8'));
      if(audit.schema!=='clareia.people-temporal-audit.v1'||audit.status!=='passed'||audit.historySha256!==hash(canonical(history))||audit.temporalSha256!==hash(canonical(temporal))||audit.discoverySha256!==history.discoverySha256)throw Error('Auditoria temporal ausente ou divergente');
      await fs.writeFile(path.join(root,'input-history.json'),JSON.stringify(history,null,2));
      await fs.writeFile(path.join(root,'input-temporal.json'),JSON.stringify(temporal,null,2));
      await fs.writeFile(path.join(root,'input-audit.json'),JSON.stringify(audit,null,2));
    }finally{await inputLock.close();await fs.unlink(path.join(historyRoot,'running.lock'));}
  }
  const inputAudit=JSON.parse(await fs.readFile(path.join(root,'input-audit.json'),'utf8'));
  if(inputAudit.schema!=='clareia.people-temporal-audit.v1'||inputAudit.status!=='passed'||inputAudit.historySha256!==hash(canonical(history))||inputAudit.temporalSha256!==hash(canonical(temporal))||inputAudit.discoverySha256!==history.discoverySha256)throw Error('Auditoria preservada diverge');
  const discovery=await readAuditedPeopleDiscovery(discoveryId,history.discoverySha256);
  if(temporal.historySha256!==hash(canonical(history))||temporal.publicAttributionEnabled!==false||canonical(temporal.scope)!==canonical(history.scope))throw Error('Entrada temporal incompatível');
  const manifest={runId,historyRun:historyId,discoveryRun:discoveryId,historySha256:hash(canonical(history)),temporalSha256:hash(canonical(temporal)),discoverySha256:history.discoverySha256,scope:history.scope,startedAt:previous?.startedAt??new Date().toISOString()};
  await fs.writeFile(path.join(root,'run.json'),JSON.stringify({...manifest,status:'collecting'},null,2));
  try{
    const offline=args.includes('--offline'),capture=(pass:number)=>new PeopleCapture(path.join(root,'pass-'+pass),key,offline?async()=>new Response('',{status:404}):undefined);
    const report=await collectLegacy(discovery,history,capture(1),capture(2),{workers,wait:offline?async()=>{}:undefined,progress:(pass,done,total)=>{if(done%30===0||done===total)console.log(`Legado: passe ${pass}, ${done}/${total}`);}});
    const version=hash(canonical(report));await fs.mkdir(path.join(root,'reports'),{recursive:true});
    await fs.writeFile(path.join(root,'reports',version+'.legacy.json'),JSON.stringify(report,null,2));
    await fs.writeFile(path.join(root,'legacy.json'),JSON.stringify(report,null,2));
    const counts={stable:report.people.filter(p=>p.status==='stable').length,changed:report.people.filter(p=>p.status==='changed').length,failed:report.people.filter(p=>p.status==='failed').length};
    await fs.writeFile(path.join(root,'run.json'),JSON.stringify({...manifest,status:'review-required',finishedAt:new Date().toISOString(),legacySha256:version,counts},null,2));
    console.log(JSON.stringify({runId,people:report.people.length,...counts,publicAttributionEnabled:false}));
    if(counts.failed||counts.changed)process.exitCode=1;
  }catch{
    await fs.writeFile(path.join(root,'run.json'),JSON.stringify({...manifest,status:'failed'},null,2));
    console.error('Coleta XML não concluída; originais cifrados preservados. Retome a mesma execução.');process.exitCode=1;
  }
}catch{console.error('Execução legada recusada: confira origens, versões, auditoria e locks.');process.exitCode=1;}
finally{await lock.close();await fs.unlink(path.join(root,'running.lock'));}
