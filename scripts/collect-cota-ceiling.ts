import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {auditCeiling} from '../src/cota-ceiling-audit.ts';
import {CEILING_SOURCES,ceilingReport,deriveCeiling} from '../src/cota-ceiling.ts';
import type {CeilingFiles,CeilingSource,CeilingSourceKey} from '../src/cota-ceiling.ts';
import {hash} from '../src/model.ts';

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log('npm run collect:cota-ceiling -- --year AAAA --run ID [--offline]\nDois passes dos atos da Mesa que fixam o limite mensal da cota por UF. Resultado apenas para revisão, sem publicação.');process.exit(0);}
for(let i=0;i<args.length;i++){if(args[i]==='--offline')continue;if(['--year','--run'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}throw new Error('Argumento inválido');}
const year=Number(value('--year')),runId=value('--run');
if(!/^20\d{2}$/.test(String(year))||!/^[a-zA-Z0-9-]{1,80}$/.test(runId))throw new Error('Ano ou execução inválidos');
const root=path.resolve('data/private/cota-ceiling',runId),run=promisify(execFile),keys=Object.keys(CEILING_SOURCES) as CeilingSourceKey[];
await fs.mkdir(root,{recursive:true});
// Node's fetch is interrupted by the Câmara portal from some networks; curl is the reliable client.
async function capture(pass:number):Promise<{files:CeilingFiles;sources:CeilingSource[]}>{
  const dir=path.join(root,'pass-'+pass),files={} as CeilingFiles,sources:CeilingSource[]=[];
  await fs.mkdir(dir,{recursive:true});
  for(const key of keys){
    const url=CEILING_SOURCES[key],file=path.join(dir,key+'.html');
    if(!args.includes('--offline'))await run('curl',['-sL','--fail','--max-time','90','--retry','3','-o',file,url]);
    const bytes=new Uint8Array(await fs.readFile(file));files[key]=bytes;
    sources.push({key,url,sha256:hash(bytes),bytes:bytes.length,fetchedAt:new Date().toISOString()});
  }
  return {files,sources};
}
const first=await capture(1),second=await capture(2);
if(keys.some(k=>hash(first.files[k])!==hash(second.files[k])))throw new Error('Atos mudaram entre os passes; nada foi aprovado');
const report=ceilingReport(year,deriveCeiling(year,second.files),second.sources,new Date().toISOString());
const audit=auditCeiling(report,s=>second.files[s.key]);
await fs.writeFile(path.join(root,`cota-ceiling-${year}.json`),JSON.stringify(report,null,2));await fs.writeFile(path.join(root,'audit.json'),JSON.stringify(audit,null,2));
console.log(JSON.stringify({audit:audit.status,failures:audit.failures,metrics:report.metrics,publicationEligible:report.publicationEligible},null,2));
if(audit.status!=='passed')process.exitCode=1;
