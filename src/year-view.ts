export type YearManifest={base:string;defaultYear?:number;years?:{year:number;months:number[];collectedAt?:string}[]};
const SHORT=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const FULL=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const COLLECTION_DATE=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'});
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

export function cutoffLine(months:number[],year:number,collectedAt?:string|null):string{
  const last=FULL[Math.max(...months)-1];
  const timestamp=collectedAt??'';
  // Interpret ISO date-times without an offset as UTC, like ISO dates.
  const collected=Date.parse(/[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(timestamp)?`${timestamp}Z`:timestamp);
  return `${last?`Dados até ${last} de ${year}`:'Dados sem mês informado'} · ${Number.isNaN(collected)?'data de coleta não informada':`coletados em ${COLLECTION_DATE.format(collected)}`}`;
}

// setUTCFullYear avoids Date.UTC remapping years 0000–0099 to 1900–1999.
const utcDay=(y:number,mo:number,d:number):number=>{const dt=new Date(0);dt.setUTCFullYear(y,mo,d);return dt.getTime();};

export function provisionalMonths(months:number[],year:number,collectedAt:string):number[]{
  if(typeof collectedAt!=='string'||!Number.isInteger(year))return [];
  const m=/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:([Zz])|([+-])(\d{2}):?(\d{2}))?)?$/.exec(collectedAt);
  if(!m)return [];
  const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]);
  const hh=m[4]?Number(m[4]):0,mi=m[5]?Number(m[5]):0,ss=m[6]?Number(m[6]):0,ms=m[7]?Number(m[7].slice(0,3).padEnd(3,'0')):0;
  const oh=m[10]?Number(m[10]):0,om=m[11]?Number(m[11]):0;
  const endOfDay=hh===24&&mi===0&&ss===0&&(!m[7]||/^0+$/.test(m[7]));
  if((hh>23&&!endOfDay)||mi>59||ss>59||oh>23||om>59)return [];
  const dt=new Date(0);
  dt.setUTCFullYear(y,mo-1,d);
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)return [];
  dt.setUTCHours(hh,mi,ss,ms);
  const offsetMs=m[9]?(m[9]==='+'?1:-1)*(oh*60+om)*60_000:0;
  const utc=new Date(dt.getTime()-offsetMs);
  const collectedDay=utcDay(utc.getUTCFullYear(),utc.getUTCMonth(),utc.getUTCDate());
  return months.filter(month=>Number.isInteger(month)&&month>=1&&month<=12&&collectedDay-utcDay(year,month,0)<90*DAY_MS);
}
