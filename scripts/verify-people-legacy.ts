import {lock as acquireLock} from '../src/lock.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import {canonical,hash} from '../src/model.ts';
import {readAuditedPeopleDiscovery,readLocalPeopleKey} from '../src/people-history.ts';
import {compareLegacy} from '../src/people-legacy.ts';
import {auditLegacy} from '../src/people-legacy-audit.ts';
import {proposeIntermediate} from '../src/people-intermediate.ts';
import {open,vaultKey} from '../src/vault.ts';

const args=process.argv.slice(2),i=args.indexOf('--run'),runId=i<0?'':args[i+1];
if(args.includes('--help')){console.log('npm run verify:people:legacy -- --local --run ID\nCruza fontes e audita os XML preservados, sem publicar ou preencher lacunas.');process.exit(0);}
for(let n=0;n<args.length;n++){if(args[n]==='--local')continue;if(args[n]==='--run'&&args[n+1]&&!args[n+1].startsWith('--')){n++;continue;}throw Error('Argumento inválido');}
if(!/^[a-zA-Z0-9-]{1,80}$/.test(runId))throw Error('Execução inválida');
const root=path.resolve('data/private/people-legacy',runId),key=args.includes('--local')?await readLocalPeopleKey():vaultKey();
const lock=await acquireLock(path.join(root,'running.lock'));
try{
  const load=async(file:string)=>JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
  const manifest=await load('run.json'),legacy=await load('legacy.json'),history=await load('input-history.json'),temporal=await load('input-temporal.json'),inputAudit=await load('input-audit.json');
  if(manifest.status!=='review-required'||manifest.legacySha256!==hash(canonical(legacy))||manifest.historySha256!==hash(canonical(history))||manifest.temporalSha256!==hash(canonical(temporal))||manifest.discoverySha256!==history.discoverySha256||inputAudit.schema!=='clareia.people-temporal-audit.v1'||inputAudit.status!=='passed'||inputAudit.historySha256!==manifest.historySha256||inputAudit.temporalSha256!==manifest.temporalSha256||inputAudit.discoverySha256!==manifest.discoverySha256)throw Error('Versões divergem');
  const discovery=await readAuditedPeopleDiscovery(manifest.discoveryRun,legacy.discoverySha256);
  const cross=compareLegacy(legacy,history,temporal),audit=await auditLegacy(legacy,cross,history,temporal,discovery,async source=>{
    if(![1,2].includes(source.pass)||source.file!==hash(source.url)+'.sealed')throw Error('Original inválido');
    return open(await fs.readFile(path.join(root,'pass-'+source.pass,source.file)),key);
  });
  const folder=path.join(root,'reports');await fs.mkdir(folder,{recursive:true});
  await fs.writeFile(path.join(folder,audit.crosscheckSha256+'.audit.json'),JSON.stringify(audit,null,2));
  await fs.writeFile(path.join(root,'crosscheck-audit.json'),JSON.stringify(audit,null,2));
  if(audit.status==='passed'){
    await fs.writeFile(path.join(folder,audit.crosscheckSha256+'.crosscheck.json'),JSON.stringify(cross,null,2));
    await fs.writeFile(path.join(root,'crosscheck.json'),JSON.stringify(cross,null,2));
    const proposal=proposeIntermediate(discovery,history,temporal,legacy,cross);
    await fs.writeFile(path.join(root,'intermediate-proposal.json'),JSON.stringify(proposal,null,2));
  }else process.exitCode=1;
  const months=cross.people.flatMap(p=>p.months),parties=cross.people.flatMap(p=>p.partyChanges),counts=(rows:any[],field:string)=>rows.reduce<Record<string,number>>((out,row)=>{out[row[field]]=(out[row[field]]||0)+1;return out;},{});
  console.log(JSON.stringify({audit,exerciseComparison:counts(months,'comparison'),partyComparison:counts(parties,'status')},null,2));
}catch{console.error('Conferência legada recusada; originais preservados e atribuição pública desativada.');process.exitCode=1;}
finally{await lock();}
