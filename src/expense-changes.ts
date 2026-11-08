import {canonical,hash} from './model.ts';
import type {Expense} from './model.ts';
import {expenseBatchContentId} from './expense-intermediate.ts';
import type {ExpenseBatch,ExpenseCell} from './expense-intermediate.ts';

type Difference={financialKey:string;count:number;unitCents:number};
export type ExpenseChanges={schema:'clareia.expense-changes.v1';id:string;createdAt:string;status:'review-required';publicationEligible:false;beforeReportSha256:string;afterReportSha256:string;scope:ExpenseBatch['scope'];reasons:string[];cells:{personId:number;year:number;month:number;beforeStatus:ExpenseCell['status'];afterStatus:ExpenseCell['status'];comparable:boolean;coverageChanged:boolean;metadataChanged:boolean;added:Difference[]|null;removed:Difference[]|null;beforeCents:string|null;afterCents:string|null;deltaCents:string|null}[];summary:{comparable:number;notComparable:number;financiallyChanged:number;coverageChanged:number;metadataChanged:number;addedOccurrences:number;removedOccurrences:number;beforeCents:string|null;afterCents:string|null;deltaCents:string|null}};
const scopeKey=(r:ExpenseBatch)=>canonical({...r.scope,ids:[...r.scope.ids].sort((a,b)=>a-b),months:[...r.scope.months].sort((a,b)=>a-b)});
const complete=(c:ExpenseCell)=>c.status==='complete'||c.status==='no-expenses-confirmed';
// An arithmetic multiset, not a cross-version identifier of a real-world payment.
// Source order, raw-row IDs and capture times cannot manufacture a withdrawal.
const blank=(s:string)=>s==='Não informado'?'':s;
const financialKey=(r:Expense)=>hash(canonical([r.personId,r.year,r.month,blank(r.documentId),blank(r.documentNumber),r.category,r.cents,r.documentCents,r.disallowedCents,r.date?.slice(0,10)||null,r.lot||'',r.supplierVerified?r.supplierKey:null]));
const metadata=(records:Expense[])=>canonical(records.map(({id:_id,source:_source,supplierKey,occurrenceOrdinal:_ordinal,...r})=>canonical({...r,supplierKey:r.supplierVerified?supplierKey:null})).sort());
const coverage=(c:ExpenseCell)=>canonical([c.status,[...c.reasons].sort(),c.exercise,...[c.party,c.uf].map(d=>({status:d.status,value:d.value,values:[...d.values].sort()}))]);
const sum=(records:Expense[])=>records.reduce((n,r)=>n+BigInt(r.cents),0n);
function validate(r:ExpenseBatch):void{
  const s=r.scope;
  if(r.schema!=='clareia.expense-intermediate.v1'||r.status!=='review-required'||r.publicationEligible!==false||r.contentSha256!==expenseBatchContentId(r)||!s.ids.length||!s.months.length||new Set(s.ids).size!==s.ids.length||new Set(s.months).size!==s.months.length)throw Error('Versão financeira inválida para comparação');
  const cells=new Map(r.cells.map(c=>[c.personId+':'+c.month,c]));if(cells.size!==r.cells.length||r.cells.length!==s.ids.length*s.months.length)throw Error('Universo de competências incompleto');
  const allRecords=r.cells.flatMap(c=>c.records);if(new Set(allRecords.map(row=>row.id)).size!==allRecords.length)throw Error('Identificador de ocorrência repetido');
  for(const id of s.ids)for(const month of s.months){
    const c=cells.get(id+':'+month);if(!c||c.year!==s.year||!['complete','no-expenses-confirmed','held-review','source-failure'].includes(c.status))throw Error('Competência ausente ou inválida');
    if(c.records.some(row=>row.personId!==id||row.year!==s.year||row.month!==month||!Number.isSafeInteger(row.cents))||new Set(c.records.map(row=>row.id)).size!==c.records.length)throw Error('Ocorrências inválidas para comparação');
    if(complete(c)){if(!Number.isSafeInteger(c.totalCents)||sum(c.records)!==BigInt(c.totalCents!)||(c.status==='no-expenses-confirmed')!==(c.records.length===0))throw Error('Total ou cobertura inválidos');}
    else if(c.records.length||c.totalCents!==null)throw Error('Competência retida contém valor aprovado');
  }
  const total=r.cells.every(complete)?sum(r.cells.flatMap(c=>c.records)):null;
  if(total===null?r.totalCents!==null:!Number.isSafeInteger(r.totalCents)||BigInt(r.totalCents!)!==total)throw Error('Total geral inválido');
}
function subtract(left:Expense[],right:Expense[]):Difference[]{
  const counts=new Map<string,number>();for(const r of right){const key=financialKey(r);counts.set(key,(counts.get(key)??0)+1);}
  const result=new Map<string,Difference>();for(const r of left){const key=financialKey(r),count=counts.get(key)??0;if(count){counts.set(key,count-1);continue;}const difference=result.get(key)??{financialKey:key,count:0,unitCents:r.cents};difference.count++;result.set(key,difference);}
  return [...result.values()].sort((a,b)=>a.financialKey.localeCompare(b.financialKey));
}
export function compareExpenseBatches(before:ExpenseBatch,after:ExpenseBatch):ExpenseChanges{
  validate(before);validate(after);if(scopeKey(before)!==scopeKey(after))throw Error('Escopos diferentes não permitem inferir retiradas');
  const old=new Map(before.cells.map(c=>[c.personId+':'+c.month,c])),cells:ExpenseChanges['cells']=[];
  for(const current of after.cells){
    const previous=old.get(current.personId+':'+current.month)!,comparable=complete(previous)&&complete(current),added=comparable?subtract(current.records,previous.records):null,removed=comparable?subtract(previous.records,current.records):null;
    cells.push({personId:current.personId,year:current.year,month:current.month,beforeStatus:previous.status,afterStatus:current.status,comparable,coverageChanged:coverage(previous)!==coverage(current),metadataChanged:comparable&&!added!.length&&!removed!.length&&metadata(previous.records)!==metadata(current.records),added,removed,beforeCents:complete(previous)?String(sum(previous.records)):null,afterCents:complete(current)?String(sum(current.records)):null,deltaCents:comparable?String(sum(current.records)-sum(previous.records)):null});
  }
  cells.sort((a,b)=>a.personId-b.personId||a.month-b.month);
  const all=cells.every(c=>c.comparable),beforeTotal=all?cells.reduce((n,c)=>n+BigInt(c.beforeCents!),0n):null,afterTotal=all?cells.reduce((n,c)=>n+BigInt(c.afterCents!),0n):null;
  const summary={comparable:cells.filter(c=>c.comparable).length,notComparable:cells.filter(c=>!c.comparable).length,financiallyChanged:cells.filter(c=>(c.added?.length??0)>0||(c.removed?.length??0)>0).length,coverageChanged:cells.filter(c=>c.coverageChanged).length,metadataChanged:cells.filter(c=>c.metadataChanged).length,addedOccurrences:cells.reduce((n,c)=>n+(c.added??[]).reduce((m,r)=>m+r.count,0),0),removedOccurrences:cells.reduce((n,c)=>n+(c.removed??[]).reduce((m,r)=>m+r.count,0),0),beforeCents:beforeTotal===null?null:String(beforeTotal),afterCents:afterTotal===null?null:String(afterTotal),deltaCents:all?String(afterTotal!-beforeTotal!):null};
  const reasons:string[]=[];if(summary.notComparable)reasons.push('financial-coverage-incomplete');if(summary.financiallyChanged)reasons.push('financial-occurrences-changed');if(summary.coverageChanged)reasons.push('coverage-changed');if(summary.metadataChanged)reasons.push('record-metadata-changed');if(before.peopleVersion!==after.peopleVersion)reasons.push('people-version-changed');if(before.proposalSha256!==after.proposalSha256)reasons.push('selection-version-changed');
  if(canonical([before.equationRule,before.multiplicityRule,before.portalRule,before.portalRequested])!==canonical([after.equationRule,after.multiplicityRule,after.portalRule,after.portalRequested]))reasons.push('rules-changed');
  const evidence=(r:ExpenseBatch)=>canonical(r.sources.map(s=>canonical([s.pass,s.url,s.sha256])).sort());if(evidence(before)!==evidence(after))reasons.push('source-evidence-changed');
  const body={schema:'clareia.expense-changes.v1' as const,status:'review-required' as const,publicationEligible:false as const,beforeReportSha256:hash(canonical(before)),afterReportSha256:hash(canonical(after)),scope:after.scope,reasons,cells,summary};
  return {...body,id:hash(canonical(body)),createdAt:new Date().toISOString()};
}
