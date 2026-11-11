import fs from 'node:fs/promises';
import path from 'node:path';
import {buildExpenseAnnualCandidate} from '../src/expense-annual-candidate.ts';
import {parseExpensePeriodArgs} from '../src/expense-period.ts';
import {canonical} from '../src/model.ts';
import type {ExpenseLotRun} from '../src/expense-publication.ts';

// Explicit segments: --segment HISTORY_RUN:LOT_RUN,LOT_RUN [...]. This command
// only writes a content-addressed private artifact, never opens a database.
const args=process.argv.slice(2),specs:string[]=[];
if(args.includes('--help')){console.log('tsx scripts/compose-expense-annual.ts --year YYYY [--months 1,2,...] --segment HISTORY_RUN:LOT_RUN,LOT_RUN [--segment ...]\nExporta candidato privado em data/private/expense-annual-candidates; sem publicação. O padrão exige 12 meses; recorte parcial deve ser explícito.');process.exit(0);}
for(let i=0;i<args.length;i++){
  const next=args[i+1]??'';
  if(args[i]==='--segment'&&/^[a-zA-Z0-9-]{1,80}:[a-zA-Z0-9-]{1,80}(,[a-zA-Z0-9-]{1,80})*$/.test(next)){specs.push(next);i++;continue;}
  if(['--year','--months'].includes(args[i])&&next&&!next.startsWith('--')){i++;continue;}
  throw Error('Argumento inválido');
}
if(!args.includes('--year')||!specs.length)throw Error('Informe ano e segmentos');
const period=parseExpensePeriodArgs(args),load=async(folder:string,file:string)=>JSON.parse(await fs.readFile(path.join(folder,file),'utf8'));
const groups=await Promise.all(specs.map(async spec=>{
  const [historyRun,runList]=spec.split(':');
  const lots:ExpenseLotRun[]=await Promise.all(runList.split(',').map(async runId=>{
    const folder=path.resolve('data/private/expense-intermediate',runId);
    return {runId,manifest:await load(folder,'run.json'),input:await load(folder,'input.json'),report:await load(folder,'batch.json'),audit:await load(folder,'audit.json')};
  }));
  return {lots,history:await load(path.resolve('data/private/people-history',historyRun),'history.json')};
}));
const candidate=buildExpenseAnnualCandidate(groups,new Date().toISOString(),period.months);
if(candidate.year!==period.year)throw Error('Ano solicitado diverge dos segmentos');
const folder=path.resolve('data/private/expense-annual-candidates');await fs.mkdir(folder,{recursive:true});
const file=path.join(folder,candidate.id+'.json');
// Identity excludes publication timestamps. Never replace an existing candidate.
const stable=(value:typeof candidate)=>canonical({...value,segments:value.segments.map(s=>({...s,snapshot:{...s.snapshot,publishedAt:null}}))});
try{await fs.writeFile(file,JSON.stringify(candidate,null,2),{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const existing=await load(folder,candidate.id+'.json');if(stable(existing)!==stable(candidate))throw Error('Candidato existente diverge');}
console.log(JSON.stringify({id:candidate.id,file,year:candidate.year,months:candidate.months,completeCalendarYear:candidate.completeCalendarYear,publicationEligible:false,totalCents:candidate.totalCents,recordCount:candidate.recordCount},null,2));
