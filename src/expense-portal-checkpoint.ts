import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {canonical} from './model.ts';
import type {Competence,MonthComparison} from './expense-portal-sample.ts';

const integer=z.number().int().safe(),count=integer.nonnegative();
const comparisonSchema=z.object({
  personId:integer.positive(),month:integer.min(1).max(12),
  status:z.enum(['matched','mismatch','portal-unavailable']),
  oursCents:integer,oursRecords:count,portalCents:integer.nullable(),portalRows:count.nullable(),
  categories:count,emptyCategories:count,failedCategories:z.array(z.string())
}).strict();
export type PortalComparison=MonthComparison&{categories:number;emptyCategories:number;failedCategories:string[]};
export type PortalRun={versionId:string;seed:string;size:number;sample:Competence[]};

export function portalDelay(value:string|undefined):number{
  const delay=value===undefined?700:Number(value);
  if(!Number.isSafeInteger(delay)||delay<0||(value!==undefined&&!value.trim()))throw Error('Intervalo inválido');
  return delay;
}

// Persist only completed month totals, never source HTML or supplier identities.
// An interrupted month is retried; completed unavailable results keep their original meaning.
export async function resumePortalSample(root:string,run:PortalRun,check:(c:Competence)=>Promise<PortalComparison>,log:(line:string)=>void=console.log):Promise<PortalComparison[]>{
  const file=path.join(root,'checkpoint.json');
  let comparisons:PortalComparison[]=[];
  let saved:string|undefined;
  try{saved=await fs.readFile(file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(saved!==undefined){
    const checkpoint=z.object({schema:z.literal('clareia.expense-portal-checkpoint.v1'),run:z.unknown(),comparisons:z.array(comparisonSchema)}).strict().parse(JSON.parse(saved));
    if(canonical(checkpoint.run)!==canonical(run))throw Error('Checkpoint incompatível com a versão, semente ou amostra; use outro --run');
    comparisons=checkpoint.comparisons;
    if(comparisons.length>run.sample.length||comparisons.some((c,i)=>c.personId!==run.sample[i].personId||c.month!==run.sample[i].month))throw Error('Competências inválidas no checkpoint');
  }
  for(const c of comparisons)log(`${c.personId}/${String(c.month).padStart(2,'0')}: retomado (${c.status})`);
  for(const competence of run.sample.slice(comparisons.length)){
    const result=comparisonSchema.parse(await check(competence));
    if(result.personId!==competence.personId||result.month!==competence.month)throw Error('Resultado fora da competência solicitada');
    comparisons.push(result);
    await fs.mkdir(root,{recursive:true});
    const temporary=file+'.tmp';
    await fs.writeFile(temporary,JSON.stringify({schema:'clareia.expense-portal-checkpoint.v1',run,comparisons},null,2));
    await fs.rename(temporary,file);
    log(`${result.personId}/${String(result.month).padStart(2,'0')}: ${result.status} (nosso ${result.oursCents}, portal ${result.portalCents})`);
  }
  return comparisons;
}
