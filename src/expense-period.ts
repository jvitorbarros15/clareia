import type {Scope} from './model.ts';
import type {TemporalReport} from './people-temporal.ts';

export const ANNUAL_MONTHS=Array.from({length:12},(_,i)=>i+1);

// A financial competence is a closed calendar month, not the date of a receipt.
// Keep this existing rule explicit: an open month is not a confirmed zero.
export function expensePeriod(year:number,months:number[],today=new Date()){
  if(!Number.isInteger(year)||year<2009||year>today.getUTCFullYear()||!months.length||months.length>12||months.some((m,i)=>!Number.isInteger(m)||m<1||m>12||(i>0&&m!==months[i-1]+1)||Date.UTC(year,m,1)>today.valueOf()))throw Error('Período financeiro inválido ou mês não encerrado');
  return {start:`${year}-${String(months[0]).padStart(2,'0')}-01`,end:new Date(Date.UTC(year,months.at(-1)!,0)).toISOString().slice(0,10)};
}

export function validateExpenseTemporal(scope:Scope,temporal:TemporalReport){
  const {start,end}=expensePeriod(scope.year,scope.months);
  if(scope.legislature!==temporal.scope.legislature||temporal.scope.start>start||temporal.scope.end<end||!temporal.scope.start||!temporal.scope.end)throw Error('Período financeiro fora do histórico');
  for(const id of scope.ids)for(const month of scope.months){
    const cells=temporal.people.filter(p=>p.id===id).flatMap(p=>p.months.filter(m=>m.year===scope.year&&m.month===month));
    if(cells.length!==1||cells[0].partialScope)throw Error('Competência temporal ausente, duplicada ou parcial');
  }
}

export function parseExpensePeriodArgs(args:string[]){
  const value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
  for(const flag of ['--year','--months'])if(args.filter(a=>a===flag).length>1)throw Error('Período financeiro repetido');
  const rawYear=value('--year')??'2025',rawMonths=value('--months')??ANNUAL_MONTHS.join(',');
  if(!/^\d{4}$/.test(rawYear)||!/^\d{1,2}(,\d{1,2})*$/.test(rawMonths))throw Error('Período financeiro inválido');
  const year=Number(rawYear),months=rawMonths.split(',').map(Number);expensePeriod(year,months);return {year,months};
}
