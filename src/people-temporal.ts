import {canonical,hash} from './model.ts';
import type {HistoryReport,HistoryPerson,HistoryEvent} from './people-history.ts';

export type Dimension={status:'known'|'unknown'|'conflict';value:string|null;rows:number[];reasons:string[]};
export type TemporalInterval={start:string;end:string;exercise:Dimension;party:Dimension;uf:Dimension};
export type MonthlyDimension={status:'single'|'changed'|'unknown'|'conflict'|'not-applicable';value:string|null;values:string[];rows:number[]};
export type MonthlyCoverage={year:number;month:number;start:string;end:string;partialScope:boolean;exercise:'full'|'partial'|'outside'|'unknown'|'conflict';party:MonthlyDimension;uf:MonthlyDimension;financialCollection:'not-collected'};
export type NormalizedEvent={row:number;original:HistoryEvent;time:string|null;precision:'minute'|'second'|'unsupported';disposition:'usable'|'other-legislature'|'outside-legislature'|'invalid-date'};
export type TemporalPerson={id:number;collectionStatus:HistoryPerson['status'];events:NormalizedEvent[];intervals:TemporalInterval[];months:MonthlyCoverage[];issues:string[]};
export type TemporalReport={schema:'clareia.people-temporal.v1';ruleVersion:'camara.history-reported-change.v1';historySha256:string;scope:HistoryReport['scope'];createdAt:string;status:'review-required';publicAttributionEnabled:false;people:TemporalPerson[]};
const unknown=(reason:string,rows:number[]=[]):Dimension=>({status:'unknown',value:null,rows,reasons:[reason]});
const unique=(values:number[])=>[...new Set(values)].sort((a,b)=>a-b);
const UFS=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
const fold=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const STATES:Record<string,'in-office'|'out-of-office'|null>={
  exercicio:'in-office',afastado:'out-of-office',licenca:'out-of-office',suplencia:'out-of-office',suspenso:'out-of-office',vacancia:'out-of-office','fim de mandato':'out-of-office',fim_mandato:'out-of-office',convocado:null
};
// Civil timestamps stay in the source's calendar. No implicit timezone conversion.
export function historyTime(value:string|null):{time:string|null;precision:'minute'|'second'|'unsupported'}{
  if(!value)return {time:null,precision:'unsupported'};
  const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if(!m||Number(m[2])>23||Number(m[3])>59||Number(m[4]||0)>59)return {time:null,precision:'unsupported'};
  const day=new Date(m[1]+'T00:00:00Z');
  if(Number.isNaN(day.valueOf())||day.toISOString().slice(0,10)!==m[1])return {time:null,precision:'unsupported'};
  return {time:value.length===16?value+':00':value,precision:m[4]===undefined?'minute':'second'};
}
export function nextDay(day:string):string{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
const midnight=(day:string)=>day+'T00:00:00';
function join(values:Dimension[]):Dimension{
  const rows=unique(values.flatMap(v=>v.rows)),reasons=[...new Set(values.flatMap(v=>v.reasons))].sort(),known=[...new Set(values.filter(v=>v.status==='known').map(v=>v.value!))];
  if(known.length>1||values.some(v=>v.status==='conflict'))return {status:'conflict',value:null,rows,reasons:[...reasons,'simultaneous-conflicting-values']};
  if(values.some(v=>v.status==='unknown')||known.length!==1)return {status:'unknown',value:null,rows,reasons};
  return {status:'known',value:known[0],rows,reasons};
}
function stateFor(events:NormalizedEvent[],references:Set<string>){
  const exercise=events.map(({row,original:e})=>{
    if(!e.situacao)return unknown('missing-exercise-state',[row]);
    const raw=fold(e.situacao),isAlias=raw==='fim_mandato'&&references.has('fim de mandato');
    if(!references.has(raw)&&!isAlias)return unknown('unrecognized-exercise-state',[row]);
    const value=Object.hasOwn(STATES,raw)?STATES[raw]:null;
    return value?{status:'known' as const,value,rows:[row],reasons:[]}:unknown('unconfirmed-exercise-state',[row]);
  });
  const party=events.map(({row,original:e})=>e.siglaPartido?.trim()?{status:'known' as const,value:e.siglaPartido.trim(),rows:[row],reasons:[]}:unknown('missing-party',[row]));
  const uf=events.map(({row,original:e})=>e.siglaUf&&UFS.has(e.siglaUf)?{status:'known' as const,value:e.siglaUf,rows:[row],reasons:[]}:unknown('missing-or-invalid-uf',[row]));
  return {exercise:join(exercise),party:join(party),uf:join(uf)};
}
function monthlyDimension(intervals:TemporalInterval[],key:'party'|'uf',exercise:MonthlyCoverage['exercise']):MonthlyDimension{
  if(exercise==='outside')return {status:'not-applicable',value:null,values:[],rows:[]};
  // Unconfirmed exercise windows may conceal a different affiliation; they cannot
  // be discarded to improve apparent coverage or manufacture a single value.
  const relevant=intervals.filter(i=>i.exercise.status!=='known'||i.exercise.value==='in-office');
  const dimensions=relevant.map(i=>i[key]),values=[...new Set(dimensions.filter(d=>d.status==='known').map(d=>d.value!))].sort(),rows=unique(dimensions.flatMap(d=>d.rows));
  let status:MonthlyDimension['status'];
  if(dimensions.some(d=>d.status==='conflict'))status='conflict';
  else if(values.length>1)status='changed';
  else if(!dimensions.length||dimensions.some(d=>d.status==='unknown')||exercise==='unknown'||exercise==='conflict')status='unknown';
  else status=values.length===1?'single':'unknown';
  return {status,value:status==='single'?values[0]:null,values,rows};
}
export function deriveTemporalPerson(person:HistoryPerson,report:Pick<HistoryReport,'scope'|'legislature'|'references'>):TemporalPerson{
  const {scope,legislature}=report,start=midnight(scope.start),end=midnight(nextDay(scope.end)),legStart=midnight(legislature.start),legEnd=midnight(nextDay(legislature.end));
  const events:NormalizedEvent[]=person.events.map((original,row)=>{
    const {time,precision}=historyTime(original.dataHora);
    const disposition=original.idLegislatura!==scope.legislature?'other-legislature':!time?'invalid-date':time<legStart||time>=legEnd?'outside-legislature':'usable';
    return {row,original,time,precision,disposition};
  });
  const issues=[...person.issues];
  if(events.some(e=>e.disposition==='outside-legislature'))issues.push('selected-legislature-date-mismatch');
  const blocked=person.status!=='stable'||events.some(e=>e.disposition==='invalid-date'||e.disposition==='outside-legislature');
  const references=new Set(report.references.states.map(s=>fold(s.nome)));
  const usable=events.filter(e=>e.disposition==='usable').sort((a,b)=>a.time!.localeCompare(b.time!)||a.row-b.row),groups=new Map<string,NormalizedEvent[]>();
  for(const e of usable)groups.set(e.time!,[...(groups.get(e.time!)||[]),e]);
  const points=[...new Set([start,end,...groups.keys()].filter(t=>t>=start&&t<=end))].sort();
  const intervals:TemporalInterval[]=[];
  for(let i=0;i<points.length-1;i++){
    const since=points[i],until=points[i+1];
    const preceding=[...groups.keys()].filter(t=>t<=since).sort().at(-1);
    const reason=blocked?'history-not-eligible-for-derivation':'no-prior-history-event';
    const state=blocked||!preceding?{exercise:unknown(reason),party:unknown(reason),uf:unknown(reason)}:stateFor(groups.get(preceding)!,references);
    intervals.push({start:since,end:until,...state});
  }
  const months:MonthlyCoverage[]=[];
  for(let year=Number(scope.start.slice(0,4));year<=Number(scope.end.slice(0,4));year++)for(let month=1;month<=12;month++){
    const monthStart=`${year}-${String(month).padStart(2,'0')}-01T00:00:00`,monthEnd=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10)+'T00:00:00';
    const first=monthStart<start?start:monthStart,last=monthEnd>end?end:monthEnd;if(first>=last)continue;
    const slices=intervals.filter(i=>i.start<last&&i.end>first);
    let exercise:MonthlyCoverage['exercise'];
    if(slices.some(i=>i.exercise.status==='conflict'))exercise='conflict';
    else if(!slices.length||slices.some(i=>i.exercise.status!=='known'))exercise='unknown';
    else {const values=new Set(slices.map(i=>i.exercise.value));exercise=values.size>1?'partial':values.has('in-office')?'full':'outside';}
    months.push({year,month,start:first,end:last,partialScope:first!==monthStart||last!==monthEnd,exercise,party:monthlyDimension(slices,'party',exercise),uf:monthlyDimension(slices,'uf',exercise),financialCollection:'not-collected'});
  }
  return {id:person.id,collectionStatus:person.status,events,intervals,months,issues:[...new Set(issues)].sort()};
}
export function deriveTemporalHistory(history:HistoryReport):TemporalReport{
  return {schema:'clareia.people-temporal.v1',ruleVersion:history.ruleVersion,historySha256:hash(canonical(history)),scope:history.scope,createdAt:new Date().toISOString(),status:'review-required',publicAttributionEnabled:false,people:history.people.map(p=>deriveTemporalPerson(p,history))};
}
