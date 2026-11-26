export type YearManifest={base:string;defaultYear?:number;years?:{year:number;months:number[];collectedAt?:string}[]};
const SHORT=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const FULL=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const DAY_MS=86_400_000;

// An unknown or malformed ?ano= falls back to the default year, silently.
export function yearFolder(manifest:YearManifest,requested:string|null):{year:number|null;folder:string;isDefault:boolean}{
  const fallback=manifest.defaultYear??null,wanted=requested&&/^\d{4}$/.test(requested)?Number(requested):null;
  const year=wanted!==null&&manifest.years?.some(y=>y.year===wanted)?wanted:fallback;
  const isDefault=year===fallback;
  return {year,folder:isDefault||year===null?manifest.base:`${manifest.base}/${year}`,isDefault};
}

export function yearFolderOf(manifest:YearManifest,year:number|string):string{return Number(year)===manifest.defaultYear?manifest.base:`${manifest.base}/${year}`;}

export function partialLabel(months:number[],year:number):string{
  const sorted=[...months].sort((a,b)=>a-b),first=sorted[0],last=sorted.at(-1);
  if(first===undefined||last===undefined)return `parcial · ${year}`;
  const range=first===last?`${SHORT[first-1]} ${year}`:`${SHORT[first-1]}–${SHORT[last-1]} ${year}`;
  const contiguous=sorted.every((m,i)=>m===first+i);
  return `parcial · ${range}${contiguous&&last<12?` (${FULL[last]} ainda não fechado)`:''}`;
}

export function provisionalMonths(months:number[],year:number,collectedAt:string):number[]{
  if(typeof collectedAt!=='string')return [];
  const m=/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(collectedAt);
  if(!m)return [];
  const parsed=new Date(collectedAt);
  if(Number.isNaN(parsed.getTime()))return [];
  const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]),check=new Date(Date.UTC(y,mo-1,d));
  if(check.getUTCFullYear()!==y||check.getUTCMonth()!==mo-1||check.getUTCDate()!==d)return [];
  const collectedDay=Date.UTC(parsed.getUTCFullYear(),parsed.getUTCMonth(),parsed.getUTCDate());
  return months.filter(month=>Number.isInteger(month)&&month>=1&&month<=12&&collectedDay-Date.UTC(year,month,0)<90*DAY_MS);
}
