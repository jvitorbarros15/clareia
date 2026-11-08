import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {PeopleCapture,discoverPeople,parseDiscoveryScope} from '../src/people-discovery.ts';
import {auditPeopleDiscovery} from '../src/people-discovery-audit.ts';
import {open,vaultKey} from '../src/vault.ts';
import {hash,canonical} from '../src/model.ts';

const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('npm run discover:people -- --local [--run ID] [--config config/people-discovery.json]\nSem --local, exige CLAREIA_VAULT_KEY. Originais sempre cifrados. Nenhuma alteração no banco ou site.');
  process.exit(0);
}
for(let i=0;i<args.length;i++){
  if(args[i]==='--local')continue;
  if(['--run','--config'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}
  throw new Error('Argumento inválido; consulte --help');
}
const value=(name:string,fallback:string)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
const runId=value('--run',randomUUID());
if(!/^[a-zA-Z0-9-]{1,80}$/.test(runId))throw new Error('Identificador de execução inválido');
const scope=parseDiscoveryScope(JSON.parse(await fs.readFile(value('--config','config/people-discovery.json'),'utf8')));
const root=path.resolve('data/private/people-discovery'),directory=path.join(root,runId);
await fs.mkdir(root,{recursive:true});
let key:Buffer;
if(args.includes('--local')){
  const keyFile=path.join(root,'local-vault-key');
  try{key=await fs.readFile(keyFile);}catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    try{await fs.writeFile(keyFile,randomBytes(32),{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    key=await fs.readFile(keyFile);
  }
  if(key.length!==32)throw new Error('Chave local inválida');
}else key=vaultKey();
await fs.mkdir(directory,{recursive:true});
// Exclusive lock keeps two resumes from mixing captures or overwriting reports.
const lock=await fs.open(path.join(directory,'running.lock'),'wx',0o600);
const manifestFile=path.join(directory,'run.json');
let phase='preparing',startedAt=new Date().toISOString();
try{
  let prior;
  try{prior=JSON.parse(await fs.readFile(manifestFile,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(prior&&JSON.stringify(prior.scope)!==JSON.stringify(scope))throw new Error('Não retomar com outro escopo');
  startedAt=prior?.startedAt||startedAt;
  await fs.writeFile(manifestFile,JSON.stringify({runId,scope,startedAt,status:'collecting'},null,2));
  console.log(`Descoberta ${runId}; originais cifrados em data/private/people-discovery/${runId}`);
  const capture=new PeopleCapture(path.join(directory,'originals'),key);
  const report=await discoverPeople(scope,capture,message=>{phase=message;console.log(message);});
  phase='independent-audit';
  const audit=await auditPeopleDiscovery(report,async source=>{
    if(path.basename(source.file)!==source.file)throw new Error('Caminho de original inválido');
    return open(await fs.readFile(path.join(capture.directory,source.file)),key);
  });
  const versions=path.join(directory,'reports');await fs.mkdir(versions,{recursive:true});
  const oldReport=await fs.readFile(path.join(directory,'discovery.json'),'utf8').catch(()=>null);
  if(oldReport){const previous=JSON.parse(oldReport);await fs.writeFile(path.join(versions,hash(canonical(previous))+'.json'),oldReport);}
  await fs.writeFile(path.join(versions,audit.reportSha256+'.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(versions,audit.reportSha256+'.audit.json'),JSON.stringify(audit,null,2));
  await fs.writeFile(path.join(directory,'discovery.json'),JSON.stringify(report,null,2));
  await fs.writeFile(path.join(directory,'audit.json'),JSON.stringify(audit,null,2));
  await fs.writeFile(manifestFile,JSON.stringify({runId,scope,startedAt,finishedAt:new Date().toISOString(),status:audit.status==='passed'?'discovered':'audit-failed',reportSha256:audit.reportSha256},null,2));
  await fs.rm(path.join(directory,'failure.json'),{force:true});
  console.log(JSON.stringify({status:audit.status,runId,historical:report.sets.period.length,legislature:report.sets.legislature.length,combinedFilters:report.sets.combined.length,candidates:report.candidates.length,annuals:report.annuals.map(a=>({year:a.year,people:a.people.length,records:a.selected,issues:a.issues.length})),financialOnly:report.candidates.filter(c=>c.classification==='financial-only').length,sampleIssues:report.samples.map(s=>({id:s.id,issues:s.issues})),publication:'unchanged'},null,2));
  if(audit.status!=='passed')process.exitCode=1;
}catch{
  // Original payloads and parser exception text must not leak personal data to CI logs.
  const failure={runId,scope,startedAt,phase,failedAt:new Date().toISOString(),status:'failed',message:'Descoberta não concluída. Capturas cifradas preservadas; retome com o mesmo --run após revisar a fonte e o contrato.'};
  await fs.writeFile(path.join(directory,'failure.json'),JSON.stringify(failure,null,2));
  await fs.writeFile(manifestFile,JSON.stringify(failure,null,2));
  console.error(`Descoberta ${runId} falhou; publicação preservada. Consulte failure.json e retome com --run ${runId}.`);
  process.exitCode=1;
}finally{
  await lock.close();await fs.unlink(path.join(directory,'running.lock'));
}
