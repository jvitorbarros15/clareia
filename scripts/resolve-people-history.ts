import {lock as acquireLock} from '../src/lock.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import {canonical,hash} from '../src/model.ts';
import {open,vaultKey} from '../src/vault.ts';
import {readLocalPeopleKey,readAuditedPeopleDiscovery} from '../src/people-history.ts';
import type {HistoryReport} from '../src/people-history.ts';
import {deriveTemporalHistory} from '../src/people-temporal.ts';
import {auditTemporalHistory} from '../src/people-temporal-audit.ts';

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1];},runId=value('--run');
if(args.includes('--help')){console.log('npm run resolve:people -- --local --run ID [--discovery-run ID]\nExecuções antigas precisam informar --discovery-run. Confere o universo aprovado e os originais cifrados. Não publica filiações.');process.exit(0);}
for(let n=0;n<args.length;n++){if(args[n]==='--local')continue;if(['--run','--discovery-run'].includes(args[n])&&args[n+1]&&!args[n+1].startsWith('--')){n++;continue;}throw new Error('Argumento inválido');}
if(!/^[a-zA-Z0-9-]{1,80}$/.test(runId))throw new Error('Identificador inválido');
const root=path.resolve('data/private/people-history',runId);
const key=args.includes('--local')?await readLocalPeopleKey():vaultKey();
const lock=await acquireLock(path.join(root,'running.lock'));
try{
  const manifest=JSON.parse(await fs.readFile(path.join(root,'run.json'),'utf8'));
  const history=JSON.parse(await fs.readFile(path.join(root,'history.json'),'utf8')) as HistoryReport;
  if(!['collected','review-required'].includes(manifest.status)||manifest.reportSha256!==hash(canonical(history)))throw new Error('Histórico não corresponde à execução concluída');
  const discoveryId=value('--discovery-run')||manifest.discoveryRun;
  if(!discoveryId||manifest.discoveryRun&&manifest.discoveryRun!==discoveryId)throw new Error('Informe a descoberta correspondente à execução');
  const discovery=await readAuditedPeopleDiscovery(discoveryId,history.discoverySha256);
  const temporal=deriveTemporalHistory(history);
  const audit=await auditTemporalHistory(history,temporal,async source=>{
    if(![1,2].includes(source.pass)||source.file!==hash(source.url)+'.sealed')throw new Error('Referência de original inválida');
    return open(await fs.readFile(path.join(root,'pass-'+source.pass,source.file)),key);
  },discovery);
  const versions=path.join(root,'reports');await fs.mkdir(versions,{recursive:true});
  await fs.writeFile(path.join(versions,audit.temporalSha256+'.audit.json'),JSON.stringify(audit,null,2));
  await fs.writeFile(path.join(root,'temporal-audit.json'),JSON.stringify(audit,null,2));
  if(audit.status!=='passed'){
    console.error(JSON.stringify({status:'failed',failures:audit.failures,publicAttribution:'disabled'},null,2));process.exitCode=1;
  }else{
    await fs.writeFile(path.join(versions,audit.temporalSha256+'.temporal.json'),JSON.stringify(temporal,null,2));
    await fs.writeFile(path.join(root,'temporal.json'),JSON.stringify(temporal,null,2));
    const months=temporal.people.flatMap(p=>p.months),count=(key:'exercise'|'party'|'uf')=>months.reduce<Record<string,number>>((out,m)=>{const status=key==='exercise'?m.exercise:m[key].status;out[status]=(out[status]||0)+1;return out;},{});
    console.log(JSON.stringify({status:audit.status,people:temporal.people.length,competences:months.length,exercise:count('exercise'),party:count('party'),uf:count('uf'),publicAttribution:'disabled',reviewRequired:true},null,2));
  }
}catch{
  // Parser and original data exceptions must not expose source payloads.
  console.error('Resolução não concluída; originais preservados e atribuição pública desativada.');process.exitCode=1;
}finally{await lock();}
