import {canonical,hash} from './model.ts';
import type {DiscoveryReport} from './people-discovery.ts';
import type {HistoryReport} from './people-history.ts';
import type {TemporalReport} from './people-temporal.ts';
import {legacyDay} from './people-legacy.ts';
import type {LegacyReport,CrosscheckReport} from './people-legacy.ts';

// This is a reproducible proposal, not a mandate/expense approval. A month absent
// from the annual identity index is a test target, never a confirmed zero.
export function proposeIntermediate(discovery:DiscoveryReport,history:HistoryReport,temporal:TemporalReport,legacy:LegacyReport,cross:CrosscheckReport){
  if(history.discoverySha256!==hash(canonical(discovery))||temporal.historySha256!==hash(canonical(history))||legacy.historySha256!==temporal.historySha256||cross.legacySha256!==hash(canonical(legacy))||cross.temporalSha256!==hash(canonical(temporal)))throw Error('Versões divergentes para amostra');
  const year=2025;if(history.scope.start>'2025-01-01'||history.scope.end<'2025-12-31')throw Error('Amostra exige 2025 inteiro na descoberta');
  if(discovery.scope.sampleIds.length>20)throw Error('Piloto obrigatório excede o limite da carga intermediária');
  const expected=discovery.candidates.map(p=>p.id).sort((a,b)=>a-b);
  if(!expected.length||new Set(expected).size!==expected.length)throw Error('Universo inválido para amostra');
  for(const list of [history.people,temporal.people,legacy.people,cross.people])if(canonical(list.map(p=>p.id).sort((a,b)=>a-b))!==canonical(expected))throw Error('Universo divergente para amostra');
  const annual=discovery.annuals.find(a=>a.year===year);if(!annual)throw Error('Índice anual de 2025 ausente');
  const candidates=expected.map(id=>{
    const h=history.people.find(p=>p.id===id)!,t=temporal.people.find(p=>p.id===id)!,l=legacy.people.find(p=>p.id===id)!,c=cross.people.find(p=>p.id===id)!,financial=annual.people.find(p=>p.id===id),months=t.months.filter(m=>m.year===year),reasons:string[]=[];
    if(discovery.scope.sampleIds.includes(id))reasons.push('pilot-regression');
    if(months.some(m=>m.party.status==='changed'))reasons.push('intramonth-party-change');
    if(l.first?.periods.some(p=>p.situacaoExercicio==='Suplente'&&legacyDay(p.dataInicio)!<'2026-01-01'&&(!p.dataFim||legacyDay(p.dataFim)!>='2025-01-01')))reasons.push('explicit-substitute-period');
    if(months.some(m=>m.exercise==='partial'))reasons.push('exercise-transition');
    if(months.some(m=>m.exercise==='outside'))reasons.push('reported-outside-exercise');
    if(c.months.some(m=>m.year===year&&m.comparison==='corroborating-unknown'))reasons.push('v2-unknown-with-legacy-period');
    if(c.months.some(m=>m.year===year&&m.comparison==='potential-conflict'))reasons.push('exercise-source-conflict');
    if(c.partyChanges.some(p=>p.day.startsWith(String(year))&&p.status==='same-day-time-differs'))reasons.push('party-time-disagreement');
    if(t.issues.includes('selected-legislature-date-mismatch'))reasons.push('v2-invalid-legislature-date');
    if(financial&&financial.months.length<12)reasons.push('annual-month-absent-not-zero');
    if(!financial)reasons.push('annual-person-absent-not-zero');
    return {id,name:h.profile?.name??null,historyStatus:h.status,legacyStatus:l.status,annualMonths:financial?.months??[],annualRows:financial?.rows??0,reasons,reviewRequired:true};
  });
  const selected=new Map<number,typeof candidates[number]>(),unmet:string[]=[];
  const add=(p:typeof candidates[number])=>{if(selected.size<20)selected.set(p.id,p);};
  for(const id of discovery.scope.sampleIds){const p=candidates.find(p=>p.id===id);if(p)add(p);else unmet.push('missing-pilot-'+id);}
  const criteria=['intramonth-party-change','explicit-substitute-period','exercise-transition','reported-outside-exercise','v2-unknown-with-legacy-period','exercise-source-conflict','party-time-disagreement','v2-invalid-legislature-date','annual-month-absent-not-zero','annual-person-absent-not-zero'];
  for(const reason of criteria){
    if([...selected.values()].some(p=>p.historyStatus==='stable'&&p.legacyStatus==='stable'&&p.reasons.includes(reason)))continue;
    const match=candidates.find(p=>p.historyStatus==='stable'&&p.legacyStatus==='stable'&&p.reasons.includes(reason));
    if(match&&selected.size<20)add(match);else unmet.push(reason);
  }
  for(const p of candidates.filter(p=>p.historyStatus==='stable'&&p.legacyStatus==='stable'&&p.annualRows>0).sort((a,b)=>b.annualRows-a.annualRows||a.id-b.id))if(selected.size<16)add(p);
  if(selected.size<12)unmet.push('minimum-size');
  return {schema:'clareia.expense-intermediate-proposal.v1',status:'proposed-not-approved',publicAttributionEnabled:false,year,months:Array.from({length:12},(_,i)=>i+1),discoverySha256:hash(canonical(discovery)),historySha256:hash(canonical(history)),temporalSha256:hash(canonical(temporal)),legacySha256:hash(canonical(legacy)),crosscheckSha256:hash(canonical(cross)),people:[...selected.values()],unmetCriteria:unmet,limitations:['Seleção para revisão de casos; não libera coleta financeira completa ou ranking nacional.','Ausência de pessoa/mês no índice anual não confirma ausência de despesas na API.','Datas de fronteira e fins abertos não foram arbitrados; conflitos e lacunas permanecem explícitos.']};
}
