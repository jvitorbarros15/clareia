import {canonical,hash} from './model.ts';
import {buildExpenseVersion} from './expense-publication.ts';
import type {ExpenseLotRun} from './expense-publication.ts';
import type {HistoryReport} from './people-history.ts';
import {ANNUAL_MONTHS,expensePeriod} from './expense-period.ts';

// Deliberately not a Snapshot: Scope.legislature still means ONE legislature.
// This review artifact cannot enter publishDomain or activate a public pointer.
export function buildExpenseAnnualCandidate(groups:{lots:ExpenseLotRun[];history:HistoryReport}[],now:string,expectedMonths=ANNUAL_MONTHS){
  if(!groups.length)throw Error('Nenhum segmento anual');
  const segments=groups.map(g=>({historySha256:hash(canonical(g.history)),temporalSha256:hash(canonical(g.lots[0]?.input.temporal)),snapshot:buildExpenseVersion(g.lots,g.history,now)})).sort((a,b)=>a.snapshot.scope.months[0]-b.snapshot.scope.months[0]);
  const year=segments[0].snapshot.scope.year,months=segments.flatMap(s=>s.snapshot.scope.months);
  expensePeriod(year,expectedMonths);
  if(expectedMonths[0]!==1||segments.some(s=>s.snapshot.scope.year!==year)||canonical(months)!==canonical(expectedMonths))throw Error('Ano incompleto, repetido ou divergente');
  const runIds=groups.flatMap(g=>g.lots.map(l=>l.runId));if(new Set(runIds).size!==runIds.length)throw Error('Execução reutilizada em segmentos');
  const ids=[...new Set(segments.flatMap(s=>s.snapshot.scope.ids))].sort((a,b)=>a-b);
  const coverage=ids.map(personId=>({personId,months:expectedMonths.map(month=>{
    const segment=segments.find(s=>s.snapshot.scope.months.includes(month))!,snapshot=segment.snapshot;
    // Absence from this segment's audited universe is not a financial zero.
    if(!snapshot.scope.ids.includes(personId))return {month,legislature:snapshot.scope.legislature,status:'not-in-segment-universe' as const,totalCents:null};
    const cell=groups.flatMap(g=>g.lots).flatMap(l=>l.report.cells).find(c=>c.personId===personId&&c.month===month)!;
    return {month,legislature:snapshot.scope.legislature,status:cell.status,totalCents:cell.totalCents};
  })}));
  // Sum the original audited cells independently from the segment snapshot records.
  const perPerson=ids.map(personId=>{
    const records=segments.flatMap(s=>s.snapshot.records).filter(r=>r.personId===personId),total=records.reduce((n,r)=>n+BigInt(r.cents),0n);
    const cells=coverage.find(c=>c.personId===personId)!.months;
    const independent=cells.filter(c=>c.status==='complete'||c.status==='no-expenses-confirmed').reduce((n,c)=>n+BigInt(c.totalCents!),0n);
    if(total!==independent||!Number.isSafeInteger(Number(total)))throw Error('Soma anual por pessoa diverge');
    return {personId,totalCents:Number(total),recordCount:records.length};
  });
  const total=perPerson.reduce((n,p)=>n+BigInt(p.totalCents),0n);if(!Number.isSafeInteger(Number(total)))throw Error('Soma anual fora do limite');
  const body={schema:'clareia.expense-annual-candidate.v1' as const,year,months,period:expensePeriod(year,months),completeCalendarYear:months.length===12,ids,publicationEligible:false as const,status:'review-required' as const,segments,coverage,perPerson,totalCents:Number(total),recordCount:perPerson.reduce((n,p)=>n+p.recordCount,0),limitations:['Candidato privado segmentado; aprovação pública multilegislatura exige contrato próprio.','Ausência no universo de um segmento não significa despesa zero.']};
  // Publication timestamps must not change the candidate identity.
  const identity={...body,segments:segments.map(({snapshot,...origin})=>({...origin,snapshotId:snapshot.id}))};
  return {...body,id:hash(canonical(identity))};
}
