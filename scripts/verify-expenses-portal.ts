import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {unzipSync} from 'fflate';
import {annualUrl,parseAnnual} from '../src/annual.ts';
import {PORTAL_CATEGORIES,mapPortalIdentity,parsePortal,portalCategoryEmpty,portalUrl} from '../src/cota-portal.ts';
import {compareMonth,drawCompetences} from '../src/expense-portal-sample.ts';
import {portalDelay,resumePortalSample} from '../src/expense-portal-checkpoint.ts';
import {activePublication,readPublication} from '../src/publications.ts';
import {openDB} from '../src/store.ts';

const args=process.argv.slice(2),value=(flag:string)=>{const i=args.indexOf(flag);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log('npm run verify:expenses:portal -- --run ID --seed TEXTO [--size 30] [--delay-ms 700] [--local]\nSorteia competências publicadas (deputado × mês) e compara o total líquido com o portal da cota da Câmara, categoria por categoria. Não guarda HTML nem CPF.');process.exit(0);}
for(let i=0;i<args.length;i++){if(args[i]==='--local')continue;if(['--run','--seed','--size','--delay-ms'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}throw Error('Argumento inválido');}
const runId=value('--run'),seed=value('--seed'),size=Number(value('--size')||'30');
if(!/^[a-zA-Z0-9-]{1,80}$/.test(runId)||!seed.trim()||!Number.isInteger(size)||size<1||size>200)throw Error('Execução, semente ou tamanho inválido');
if(args.includes('--local')&&process.env.DATABASE_URL)throw Error('--local não pode ser usado com DATABASE_URL definida');
const delayMs=portalDelay(args.includes('--delay-ms')?value('--delay-ms'):undefined);
const root=path.resolve('data/private/expense-portal-sample',runId);await fs.mkdir(root,{recursive:true});
if(await fs.access(path.join(root,'report.json')).then(()=>true,()=>false))throw Error('Execução já concluída; use outro --run');
const curl=promisify(execFile);
// The portal drops Node's fetch connections; curl reads it reliably. One request at a time, spaced, with one retry.
async function get(url:string,file:string):Promise<{status:number;bytes:Uint8Array}>{
  for(let attempt=0;attempt<2;attempt++){
    try{const {stdout}=await curl('curl',['-s','-A','Clareia verificacao (clareia.clareia.workers.dev)','-o',file,'-w','%{http_code}',url],{timeout:60000});const bytes=new Uint8Array(await fs.readFile(file));await fs.rm(file,{force:true});return {status:Number(stdout),bytes};}
    catch{await new Promise(r=>setTimeout(r,3000));}
  }
  return {status:0,bytes:new Uint8Array()};
}
const pause=()=>new Promise(r=>setTimeout(r,delayMs));
const db=await openDB();let version;
try{const active=await activePublication(db,'despesas');if(!active)throw Error('Nenhuma versão de despesas ativa');version=await readPublication(db,active.id);}finally{await db.close();}
if(!version)throw Error('Versão ativa ilegível');
const publication=version;
// Months published without expenses are drawn too: a wrong zero is the error that matters most.
const held=new Set((publication.validation.heldCompetences??[]).map(c=>c.personId+':'+c.month));
const candidates=publication.scope.ids.flatMap(personId=>publication.scope.months.filter(month=>!held.has(personId+':'+month)).map(month=>({personId,month})));
const sample=drawCompetences(candidates,seed,size),ids=[...new Set(sample.map(c=>c.personId))];
const tmp=path.join(root,'download.tmp');
let annualRows:Awaited<ReturnType<typeof parseAnnual>>['rows']|undefined;
async function loadAnnual(){
  if(annualRows)return annualRows;
  const zip=await get(annualUrl(publication.scope.year),tmp);if(zip.status!==200)throw Error('Arquivo anual indisponível');
  const name=`Ano-${publication.scope.year}.csv`,csv=unzipSync(zip.bytes,{filter:f=>f.name===name})[name];if(!csv)throw Error('CSV anual ausente');
  annualRows=(await parseAnnual(csv,{...publication.scope,ids})).rows;
  return annualRows;
}
const comparisons=await resumePortalSample(root,{versionId:publication.id,seed,size,sample},async competence=>{
  const annual=await loadAnnual();
  const portalId=mapPortalIdentity(competence.personId,annual,annual,publication.scope.legislature);
  let total=0,rows=0,empty=0;const failed:string[]=[];
  if(portalId!==null)for(const code of [...PORTAL_CATEGORIES].sort((a,b)=>Number(a)-Number(b))){
    const scope={personId:competence.personId,portalId,year:publication.scope.year,month:competence.month},page=await get(portalUrl(scope,code),tmp);await pause();
    try{const s=parsePortal(page.bytes,scope,code);total+=s.total;rows+=s.rows.length;}
    catch{if(page.status===500&&portalCategoryEmpty(page.bytes))empty++;else failed.push(code);}
  }
  const result=compareMonth(competence,publication.records,portalId===null||failed.length?null:{total,rows});
  return {...result,categories:PORTAL_CATEGORIES.size,emptyCategories:empty,failedCategories:failed};
});
const count=(s:string)=>comparisons.filter(c=>c.status===s).length;
const report={schema:'clareia.expense-portal-sample.v1',checkedAt:new Date().toISOString(),versionId:publication.id,seed,size,candidates:candidates.length,sample,comparisons,summary:{matched:count('matched'),mismatch:count('mismatch'),unavailable:count('portal-unavailable')},note:'Compara o total líquido mensal publicado com a soma das categorias do portal analítico da cota. Competências retidas ficam fora do sorteio; meses publicados sem despesa entram.'};
await fs.writeFile(path.join(root,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({versionId:publication.id,...report.summary,candidates:candidates.length},null,2));
if(report.summary.mismatch||report.summary.unavailable)process.exitCode=1;
