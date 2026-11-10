import {hash} from './model.ts';
import type {Expense} from './model.ts';

export type Competence={personId:number;month:number};
// Reproducible from the published seed: anyone can redraw the same competences.
export function drawCompetences(candidates:Competence[],seed:string,size:number):Competence[]{
  if(!seed.trim()||!Number.isInteger(size)||size<1)throw Error('Amostra inválida');
  const unique=[...new Map(candidates.map(c=>[c.personId+':'+c.month,c])).values()];
  return unique.map(c=>({c,key:hash(seed+':'+c.personId+':'+c.month)})).sort((a,b)=>a.key.localeCompare(b.key)).slice(0,size).map(x=>x.c).sort((a,b)=>a.personId-b.personId||a.month-b.month);
}
export type MonthComparison=Competence&{status:'matched'|'mismatch'|'portal-unavailable';oursCents:number;oursRecords:number;portalCents:number|null;portalRows:number|null};
export function compareMonth({personId,month}:Competence,records:Expense[],portal:{total:number;rows:number}|null):MonthComparison{
  const own=records.filter(r=>r.personId===personId&&r.month===month),oursCents=Number(own.reduce((n,r)=>n+BigInt(r.cents),0n)),base={personId,month,oursCents,oursRecords:own.length,portalCents:portal?.total??null,portalRows:portal?.rows??null};
  if(!portal)return {...base,status:'portal-unavailable'};
  return {...base,status:portal.total===oursCents?'matched':'mismatch'};
}
