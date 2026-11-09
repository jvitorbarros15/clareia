import {lock as acquireLock} from '../src/lock.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import {canonical,hash} from '../src/model.ts';
import {PeopleCapture} from '../src/people-discovery.ts';
import {readAuditedPeopleDiscovery,readLocalPeopleKey} from '../src/people-history.ts';
import {proposeIntermediate} from '../src/people-intermediate.ts';
import {collectExpenseBatch} from '../src/expense-intermediate.ts';
import {vaultKey} from '../src/vault.ts';

const args=process.argv.slice(2),value=(flag:string)=>{const i=args.indexOf(flag);return i<0?'':args[i+1];};
if(args.includes('--help')){console.log('npm run collect:expenses:intermediate -- --local --selection-run ID --run ID [--offline] [--portal] [--workers 1|2|3]\nCaptura financeira intermediária cifrada, sem publicação. --portal confere o relatório oficial SIGEPA e permanece ativo nas retomadas. --offline não consulta a rede.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--local','--offline','--portal'].includes(args[i]))continue;if(['--selection-run','--run','--workers'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}throw Error('Argumento inválido');}
const runId=value('--run'),selectionId=value('--selection-run'),workers=Number(value('--workers')||'2');
if([runId,selectionId].some(id=>!/^[a-zA-Z0-9-]{1,80}$/.test(id))||!Number.isInteger(workers)||workers<1||workers>3)throw Error('Execução inválida');
const root=path.resolve('data/private/expense-intermediate',runId),selectionRoot=path.resolve('data/private/people-legacy',selectionId),key=args.includes('--local')?await readLocalPeopleKey():vaultKey();
await fs.mkdir(root,{recursive:true});const lock=await acquireLock(path.join(root,'running.lock'));
try{
  const previous=await fs.readFile(path.join(root,'run.json'),'utf8').then(JSON.parse).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;return null;});
  if(previous&&previous.selectionRun!==selectionId)throw Error('Outra seleção não pode retomar esta execução');
  let input:any;
  if(previous){input=JSON.parse(await fs.readFile(path.join(root,'input.json'),'utf8'));if(hash(canonical(input))!==previous.inputSha256)throw Error('Entrada preservada diverge');}
  else{
    const selectionLock=await acquireLock(path.join(selectionRoot,'running.lock'));
    try{
      const load=async(file:string)=>JSON.parse(await fs.readFile(path.join(selectionRoot,file),'utf8'));
      const manifest=await load('run.json'),legacy=await load('legacy.json'),cross=await load('crosscheck.json'),audit=await load('crosscheck-audit.json'),history=await load('input-history.json'),temporal=await load('input-temporal.json'),proposal=await load('intermediate-proposal.json');
      if(audit.schema!=='clareia.people-legacy-audit.v1'||audit.status!=='passed'||audit.legacySha256!==hash(canonical(legacy))||audit.crosscheckSha256!==hash(canonical(cross))||audit.historySha256!==hash(canonical(history))||audit.temporalSha256!==hash(canonical(temporal))||audit.discoverySha256!==history.discoverySha256)throw Error('Cruzamento sem auditoria correspondente');
      const discovery=await readAuditedPeopleDiscovery(manifest.discoveryRun,audit.discoverySha256);
      if(canonical(proposeIntermediate(discovery,history,temporal,legacy,cross))!==canonical(proposal)||proposal.people.length<12||proposal.people.length>20||proposal.unmetCriteria.length)throw Error('Seleção intermediária incompleta ou divergente');
      input={schema:'clareia.expense-intermediate-input.v1',selectionRun:selectionId,proposal,temporal,originAudit:audit};
      const priorInput=await fs.readFile(path.join(root,'input.json'),'utf8').catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;return null;});
      if(priorInput&&canonical(JSON.parse(priorInput))!==canonical(input))throw Error('Entrada órfã diferente; revisar sem sobrescrever');
      if(!priorInput)await fs.writeFile(path.join(root,'input.json'),JSON.stringify(input,null,2),{flag:'wx',mode:0o600});
    }finally{await selectionLock();}
  }
  const {proposal,temporal}=input,scope={year:proposal.year,legislature:temporal.scope.legislature,ids:proposal.people.map((p:any)=>p.id),months:proposal.months};
  if(proposal.temporalSha256!==hash(canonical(temporal))||input.originAudit.temporalSha256!==proposal.temporalSha256||input.originAudit.crosscheckSha256!==proposal.crosscheckSha256)throw Error('Origem temporal diverge');
  const firstAttempt=previous?.firstAttempt??(previous?.reportSha256&&previous.metrics?{reportSha256:previous.reportSha256,metrics:previous.metrics}:undefined);
  const portalRequested=args.includes('--portal')||previous?.portalRequested===true;
  const manifest={runId,selectionRun:selectionId,inputSha256:hash(canonical(input)),proposalSha256:hash(canonical(proposal)),scope,portalRequested,startedAt:previous?.startedAt??new Date().toISOString(),firstAttempt};
  await fs.writeFile(path.join(root,'run.json'),JSON.stringify({...manifest,status:'collecting'},null,2));
  try{
    const offline=args.includes('--offline'),capture=(pass:number)=>new PeopleCapture(path.join(root,'pass-'+pass),key,offline?async()=>new Response('',{status:404}):undefined);
    const report=await collectExpenseBatch(scope,temporal,hash(canonical(proposal)),capture(1),capture(2),{workers,portal:portalRequested,wait:offline?async()=>{}:undefined,progress:(pass,done,total)=>{if(done%12===0||done===total)console.log(`Despesas 2025: passe ${pass}, ${done}/${total} competências`);}});
    const version=hash(canonical(report)),folder=path.join(root,'reports');await fs.mkdir(folder,{recursive:true});
    await fs.writeFile(path.join(folder,version+'.batch.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'batch.json'),JSON.stringify(report,null,2));
    const coverage=report.cells.reduce<Record<string,number>>((out,c)=>{out[c.status]=(out[c.status]||0)+1;return out;},{});
    await fs.writeFile(path.join(root,'run.json'),JSON.stringify({...manifest,status:'review-required',finishedAt:new Date().toISOString(),reportSha256:version,contentSha256:report.contentSha256,coverage,metrics:report.metrics,firstAttempt:firstAttempt??{reportSha256:version,metrics:report.metrics}},null,2));
    console.log(JSON.stringify({runId,people:scope.ids.length,coverage,metrics:report.metrics,publicationEligible:false},null,2));
  }catch{await fs.writeFile(path.join(root,'run.json'),JSON.stringify({...manifest,status:'failed'},null,2));console.error('Carga intermediária não concluída; originais cifrados preservados. Retome a mesma execução.');process.exitCode=1;}
}catch{console.error('Execução financeira recusada; confira seleção, auditorias, versões e locks.');process.exitCode=1;}
finally{await lock();}
