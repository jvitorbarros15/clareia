import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { collect,RunCache } from './collector.ts';
import { openDB } from './store.ts';
import { activePublication,publishDomain,readPublication } from './publications.ts';
import { withLock } from './lock.ts';
import type { Scope } from './model.ts';
import {annualSnapshot,annualUrl,HeldPublication} from './annual.ts';
import {changedSources,fingerprint,recordSource} from './sources.ts';
import type {Fingerprint} from './sources.ts';
import {storeFromEnv} from './object-store.ts';
import {archiveRun,runKey,vaultKey} from './vault.ts';

const resumeIndex=process.argv.indexOf('--resume');
const onlyIfChanged=process.argv.includes('--if-changed');
const output=async(changed:boolean)=>{if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`changed=${changed}\n`);};
// The first thing to fail in a misconfigured job must be the key, before anything is collected.
const store=storeFromEnv(),key=store?vaultKey():null;
const archive=async(directory:string,runId:string)=>{if(store&&key)await archiveRun(store,directory,runId,key);};
const runId=resumeIndex>=0?process.argv[resumeIndex+1]:randomUUID();
if(!runId||!/^[a-zA-Z0-9-]{1,80}$/.test(runId))throw new Error('Identificador de execução inválido');
await withLock(async()=>{
const directory=path.resolve('data/runs',runId),cache=new RunCache(directory);
let db;let annual:Fingerprint|undefined;
try{
  const scope=JSON.parse(await fs.readFile('config/pilot.json','utf8')) as Scope;
  db=await openDB();
  annual=await fingerprint(annualUrl(scope.year));
  if(onlyIfChanged){
    const changed=(await changedSources(db,[annual])).length>0;
    await output(changed);
    if(!changed){console.log('Nenhuma fonte mudou.');return;}
  }
  await fs.mkdir(directory,{recursive:true});
  const manifestPath=path.join(directory,'manifest.json');
  if(resumeIndex>=0){const previous=JSON.parse(await fs.readFile(manifestPath,'utf8'));if(JSON.stringify(previous.scope)!==JSON.stringify(scope))throw new Error('Não retomar execução com outro recorte');}
  const start=new Date().toISOString();
  await fs.writeFile(manifestPath,JSON.stringify({runId,scope,status:'collecting',startedAt:start},null,2));
  await db.query('INSERT INTO publication_runs(id,status,started_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET status=excluded.status, started_at=excluded.started_at, finished_at=NULL, error=NULL',[runId,'collecting',start]);
  console.log(`Coleta ${runId}: ${scope.ids.length} pessoas / ${scope.year} / meses ${scope.months.join(', ')}. Originais: data/runs/${runId}`);
  const api=await collect(scope,cache);
  const active=await activePublication(db,'despesas');
  const snapshot=await annualSnapshot(api,directory,active&&await readPublication(db,active.id),process.argv.includes('--accept-removed'));
  await publishDomain(db,'despesas',snapshot);
  const annualHref=annual.url,sha256=snapshot.pages.findLast(p=>p.url===annualHref)?.sha256;
  if(!sha256)throw new Error('Versão sem registro do arquivo anual');
  await archive(directory,runId);
  await recordSource(db,annual,sha256,runKey(runId,'annual-2.csv.zip'));
  await db.query('UPDATE publication_runs SET status=$2,finished_at=now(),publication_id=$3 WHERE id=$1',[runId,'published',snapshot.id]);
  await fs.writeFile(manifestPath,JSON.stringify({runId,scope,status:'published',startedAt:start,finishedAt:new Date().toISOString(),snapshotId:snapshot.id,pages:snapshot.pages,validation:snapshot.validation},null,2));
  console.log(JSON.stringify({status:'published',snapshotId:snapshot.id,records:snapshot.records.length,totalCents:snapshot.validation.totalCents,pages:snapshot.pages.length},null,2));
}catch(error){
  const message=error instanceof Error?error.message:String(error);
  if(db)await db.query('UPDATE publication_runs SET status=$2,finished_at=now(),error=$3 WHERE id=$1',[runId,'failed',message]);
  if(error instanceof HeldPublication&&db&&annual){const {sha256}=JSON.parse(await fs.readFile(path.join(directory,'annual-2.meta.json'),'utf8'));await archive(directory,runId);await recordSource(db,annual,sha256,runKey(runId,'annual-2.csv.zip'));}
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'failure.json'),JSON.stringify({runId,error:message,failedAt:new Date().toISOString(),pages:cache.pages},null,2));
  const manifestPath=path.join(directory,'manifest.json');
  const previous=JSON.parse(await fs.readFile(manifestPath,'utf8').catch(()=>'{}'));
  await fs.writeFile(manifestPath,JSON.stringify({...previous,status:'failed',error:message,failedAt:new Date().toISOString(),pages:cache.pages},null,2));
  console.error(`Execução falhou; confira o manifesto antes de retomar. ${message}\nRetomar: npm run collect -- --resume ${runId}`);process.exitCode=1;
}finally{if(db)await db.close();}
});
