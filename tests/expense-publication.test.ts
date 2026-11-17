import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,hash,snapshotId} from '../src/model.ts';
import type {Expense} from '../src/model.ts';
import {buildExpenseVersion} from '../src/expense-publication.ts';
import type {ExpenseLotRun} from '../src/expense-publication.ts';

const history={people:[1,2,3].map(id=>({id,profile:{name:'Pessoa '+id,photo:null,source:{fetchedAt:'2026-11-07T00:00:00Z'}}}))} as any;
const temporal={historySha256:hash(canonical(history)),scope:{legislature:57,end:'2025-12-31'},people:[1,2,3].map(id=>({id,events:[],months:[{year:2025,month:1,uf:{status:'single',value:'SP'},party:{status:'single',value:'X'}}]}))} as any;
const record=(personId:number,cents:number,i:number):Expense=>({id:`r${personId}-${i}`,personId,year:2025,month:1,category:'C',supplier:'S',supplierKey:'k',supplierVerified:false,documentId:'1',documentNumber:'1',date:null,receipt:null,cents,documentCents:cents,disallowedCents:0,source:{url:'https://www.camara.leg.br/cotas/Ano-2025.csv.zip',sha256:'s',row:i,fetchedAt:'2026-11-09T00:00:00Z'}});
const universe=[1,2,3];
function lot(n:number,ids:number[],cells:any[]):ExpenseLotRun{
  const proposal={schema:'clareia.expense-lot.v1',year:2025,months:[1],lot:n,lotSize:2,lots:2,universeSize:3,universeSha256:hash(canonical(universe)),people:ids.map(id=>({id})),temporalSha256:hash(canonical(temporal)),crosscheckSha256:'c'};
  const proposalSha256=hash(canonical(proposal)),input={schema:'clareia.expense-lot-input.v1',selectionRun:'s',proposal,temporal,originAudit:{}};
  const report={scope:{year:2025,months:[1],ids,legislature:57},proposalSha256,createdAt:`2026-11-09T0${n}:00:00Z`,contentSha256:'c'+n,cells} as any;
  const reportSha256=hash(canonical(report));
  return {runId:'run'+n,manifest:{runId:'run'+n,status:'review-required',reportSha256,proposalSha256,inputSha256:hash(canonical(input))},input:input as any,report,audit:{status:'passed',reportSha256,proposalSha256,checkedAt:'2026-11-09T10:00:00Z',competences:cells.length}};
}
const cell=(personId:number,status:string,records:Expense[]=[])=>({personId,year:2025,month:1,status,records,reasons:status==='held-review'?['sigepa-unit-unconfirmed']:[],totalCents:status==='complete'||status==='no-expenses-confirmed'?records.reduce((n,r)=>n+r.cents,0):null});
const lots=()=>[lot(0,[1,2],[cell(1,'complete',[record(1,100,0),record(1,-30,1)]),cell(2,'held-review')]),lot(1,[3],[cell(3,'no-expenses-confirmed')])];

test('all audited lots of one universe become one version with held months counted',()=>{
  const v=buildExpenseVersion(lots(),history,'2026-11-09T12:00:00Z');
  assert.equal(v.id,snapshotId(v));
  assert.deepEqual(v.scope.ids,[1,2,3]);
  assert.equal(v.records.length,2);assert.equal(v.validation.totalCents,70);assert.equal(v.validation.independentTotalCents,'70');
  assert.deepEqual(v.validation.heldMonths,{2:1});
  assert.deepEqual(v.validation.heldCompetences,[{personId:2,month:1,reasons:['sigepa-unit-unconfirmed']}]);
  assert.equal(v.validation.sourceKind,'annual-api-union');
  assert.deepEqual(v.people.map(p=>[p.name,p.uf,p.party]),[['Pessoa 1','SP','X'],['Pessoa 2','SP','X'],['Pessoa 3','SP','X']]);
  assert.equal(v.collectedAt,'2026-11-09T01:00:00Z');
});
test('the version id ignores lot order and publication time',()=>{
  const a=buildExpenseVersion(lots(),history,'2026-11-09T12:00:00Z'),b=buildExpenseVersion(lots().reverse(),history,'2026-11-10T12:00:00Z');
  assert.equal(a.id,b.id);
});
test('a missing or repeated lot is refused',()=>{
  assert.throws(()=>buildExpenseVersion([lots()[0]],history,'t'),/incompletos ou repetidos/);
  assert.throws(()=>buildExpenseVersion([lots()[0],lots()[0]],history,'t'),/incompletos ou repetidos/);
});
test('a lot without a passing audit of the same report is refused',()=>{
  const failed=lots();failed[1].audit.status='failed';
  assert.throws(()=>buildExpenseVersion(failed,history,'t'),/sem auditoria aprovada/);
  const changed=lots();changed[0].report.cells[0].records[0].cents=101;
  assert.throws(()=>buildExpenseVersion(changed,history,'t'),/sem auditoria aprovada/);
});
test('lots from another universe or with overlapping people are refused',()=>{
  const other=lots();other[1].input.proposal.universeSha256='x';
  assert.throws(()=>buildExpenseVersion(other,history,'t'));
  const overlap=[lots()[0],lot(1,[2],[cell(2,'no-expenses-confirmed')])];
  assert.throws(()=>buildExpenseVersion(overlap,history,'t'),/universo declarado/);
});
test('a held cell carrying records or a complete total that disagrees is refused',()=>{
  assert.throws(()=>buildExpenseVersion([lot(0,[1,2],[cell(1,'complete',[record(1,100,0)]),{...cell(2,'held-review'),records:[record(2,5,0)]}]),lots()[1]],history,'t'),/retida com registros/);
  assert.throws(()=>buildExpenseVersion([lot(0,[1,2],[{...cell(1,'complete',[record(1,100,0)]),totalCents:99},cell(2,'held-review')]),lots()[1]],history,'t'),/diverge das células/);
});
test('a history other than the one used in the collection is refused',()=>{
  assert.throws(()=>buildExpenseVersion(lots(),{people:[]} as any,'t'),/Histórico/);
});

test('storing an older version without approval never makes it active again after a later audit',async()=>{
  const {openDB}=await import('../src/store.ts'),{activePublication,publishDomain,recordDomainAudit,reobservePublication}=await import('../src/publications.ts');
  const snap=(cents:number)=>{const records=[record(1,cents,0)],body={metric:'m',scope:{year:2025,months:[1],ids:[1],legislature:57},people:[{id:1,name:'P',photo:null,sourceUrl:'https://x',profileFetchedAt:'2026-01-01T00:00:00Z'}],records,collectedAt:'2026-01-01T00:00:00Z',publishedAt:'2026-01-01T00:00:00Z',pages:[],validation:{stablePasses:2,recordCount:1,totalCents:cents,independentTotalCents:String(cents),duplicatePolicy:'x',limitations:[]}};return {...body,id:snapshotId(body)};};
  const db=await openDB(true),ok={checkedAt:'2026-01-01T00:00:00Z'};
  try{
    const a=snap(100),b=snap(200);
    await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',ok);
    await publishDomain(db,'despesas',b);await recordDomainAudit(db,b.id,'passed',ok);
    await publishDomain(db,'despesas',a,{reobserve:false});
    await recordDomainAudit(db,b.id,'passed',ok);
    assert.equal((await activePublication(db,'despesas'))?.id,b.id);
    await reobservePublication(db,a.id);await recordDomainAudit(db,a.id,'passed',ok);
    assert.equal((await activePublication(db,'despesas'))?.id,a.id,'an explicit approval does make it newest');
  }finally{await db.close();}
});

test('the party comes from the publication year, never from a later month of the history',()=>{
  const later=structuredClone(lots());
  for(const l of later){l.input.temporal.people[0].months.push({year:2026,month:3,uf:{status:'single',value:'SP'},party:{status:'single',value:'Y'}} as any);}
  const t=later[0].input.temporal;for(const l of later){l.input.temporal=t;const p=l.input.proposal;p.temporalSha256=hash(canonical(t));l.manifest.proposalSha256=hash(canonical(p));l.report.proposalSha256=l.manifest.proposalSha256;l.audit.proposalSha256=l.manifest.proposalSha256;l.manifest.inputSha256=hash(canonical(l.input));const r=hash(canonical(l.report));l.manifest.reportSha256=r;l.audit.reportSha256=r;}
  const h={...history};const v=buildExpenseVersion(later,{...h,people:h.people} as any,'t');
  assert.deepEqual([v.people[0].uf,v.people[0].party],['SP','X']);
});

test('a party change in the year keeps the uf of the latest month where the uf is single',()=>{
  const changed=structuredClone(lots());
  const t=changed[0].input.temporal;t.people[0].months=[{year:2025,month:1,uf:{status:'single',value:'SP'},party:{status:'single',value:'X'}},{year:2025,month:2,uf:{status:'single',value:'SP'},party:{status:'changed',value:null}}] as any;
  for(const l of changed){l.input.temporal=t;const p=l.input.proposal;p.temporalSha256=hash(canonical(t));l.manifest.proposalSha256=hash(canonical(p));l.report.proposalSha256=l.manifest.proposalSha256;l.audit.proposalSha256=l.manifest.proposalSha256;l.manifest.inputSha256=hash(canonical(l.input));const r=hash(canonical(l.report));l.manifest.reportSha256=r;l.audit.reportSha256=r;}
  const v=buildExpenseVersion(changed,history,'t');
  assert.deepEqual([v.people[0].uf,v.people[0].party],['SP','X']);
});

const ev=(idLegislatura:number,siglaUf:string)=>({original:{idLegislatura,siglaUf}});
function withFirst(months:any[],events:any[]){
  const changed=structuredClone(lots()),t=changed[0].input.temporal,h=structuredClone(history);t.people[0].months=months;t.people[0].events=events;t.historySha256=hash(canonical(h));
  for(const l of changed){const p=l.input.proposal;l.input.temporal=t;p.temporalSha256=hash(canonical(t));l.manifest.proposalSha256=hash(canonical(p));l.report.proposalSha256=l.manifest.proposalSha256;l.audit.proposalSha256=l.manifest.proposalSha256;l.manifest.inputSha256=hash(canonical(l.input));const r=hash(canonical(l.report));l.manifest.reportSha256=r;l.audit.reportSha256=r;}
  const v=buildExpenseVersion(changed,h,'t');return [v.people[0].uf,v.people[0].ufNote??null,v.people[1].uf,v.people[1].ufNote??null];
}
const unknown=[{year:2025,month:1,uf:{status:'unknown',value:null},party:{status:'single',value:'X'}}];
test('without a confirmed month the uf all legislature events agree on is used and marked; other legislatures are ignored',()=>{
  assert.deepEqual(withFirst(unknown,[ev(57,'RS'),ev(57,'RS'),ev(58,'PR')]),['RS','UF dos eventos da legislatura','SP',null]);
});
test('events of the legislature that disagree, or none, leave the uf empty',()=>{
  assert.deepEqual(withFirst(unknown,[ev(57,'RS'),ev(57,'SC')]).slice(0,2),[null,null]);
  assert.deepEqual(withFirst(unknown,[ev(56,'RS')]).slice(0,2),[null,null]);
});
test('a month showing two UFs is never settled by the events',()=>{
  assert.deepEqual(withFirst([{year:2025,month:1,uf:{status:'changed',value:null},party:{status:'single',value:'X'}}],[ev(57,'RS')]).slice(0,2),[null,null]);
  assert.deepEqual(withFirst([{year:2025,month:1,uf:{status:'conflict',value:null},party:{status:'single',value:'X'}}],[ev(57,'RS')]).slice(0,2),[null,null]);
});
test('a confirmed month keeps its uf over the events and is not marked',()=>{
  assert.deepEqual(withFirst([{year:2025,month:1,uf:{status:'single',value:'SP'},party:{status:'single',value:'X'}}],[ev(57,'RS')]).slice(0,2),['SP',null]);
});

const pev=(siglaPartido:string|null,dataHora:string|null,idLegislatura=57)=>({original:{idLegislatura,siglaPartido,dataHora}});
const noParty=[{year:2025,month:1,uf:{status:'single',value:'SP'},party:{status:'unknown',value:null}}];
const partyOf=(months:any[],events:any[])=>{const v=withFirstPeople(months,events);return [v[0].party,v[0].partyNote??null,v[1].party,v[1].partyNote??null];};
function withFirstPeople(months:any[],events:any[]){
  const changed=structuredClone(lots()),t=changed[0].input.temporal,h=structuredClone(history);t.people[0].months=months;t.people[0].events=events;t.historySha256=hash(canonical(h));
  for(const l of changed){const p=l.input.proposal;l.input.temporal=t;p.temporalSha256=hash(canonical(t));l.manifest.proposalSha256=hash(canonical(p));l.report.proposalSha256=l.manifest.proposalSha256;l.audit.proposalSha256=l.manifest.proposalSha256;l.manifest.inputSha256=hash(canonical(l.input));const r=hash(canonical(l.report));l.manifest.reportSha256=r;l.audit.reportSha256=r;}
  return buildExpenseVersion(changed,h,'t').people;
}
test('without a confirmed party month, events that agree give the party, marked; other legislatures are ignored',()=>{
  assert.deepEqual(partyOf(noParty,[pev('PL','2023-02-01T10:00'),pev('PL','2024-05-01T10:00'),pev('PT','2019-01-01T10:00',56)]).slice(0,2),['PL','partido dos eventos da legislatura']);
});
test('events that switch party give the latest one up to the end of the scope, with its month',()=>{
  assert.deepEqual(partyOf(noParty,[pev('PL','2023-02-01T10:00'),pev('PP','2024-05-10T10:00'),pev('PP','2024-06-10T10:00')]).slice(0,2),['PP','partido em jan/2025 (eventos da legislatura)']);
  assert.deepEqual(partyOf(noParty,[pev('PL','2023-02-01T10:00'),pev('PP','2024-05-10T10:00'),pev('PT','2025-02-10T10:00')]).slice(0,2),['PP','partido em jan/2025 (eventos da legislatura)']);
});
test('no events, a missing party or an unreadable date leave the party empty',()=>{
  assert.deepEqual(partyOf(noParty,[]).slice(0,2),[null,null]);
  assert.deepEqual(partyOf(noParty,[pev('PL','2023-02-01T10:00'),pev(null,'2024-05-01T10:00')]).slice(0,2),[null,null]);
  assert.deepEqual(partyOf(noParty,[pev('PL','2023-02-01T10:00'),pev('PP',null)]).slice(0,2),[null,null]);
});
test('a confirmed party month keeps its party over the events and is not marked',()=>{
  assert.deepEqual(partyOf([{year:2025,month:1,uf:{status:'single',value:'SP'},party:{status:'single',value:'X'}}],[pev('PL','2023-02-01T10:00')]).slice(0,2),['X',null]);
});
test('a switch after the expense period keeps the earlier party, marked as unanimous up to the period end',()=>{
  assert.deepEqual(partyOf(noParty,[pev('PL','2023-02-01T10:00'),pev('PP','2025-06-10T10:00')]).slice(0,2),['PL','partido dos eventos da legislatura']);
  assert.deepEqual(partyOf(noParty,[pev('PP','2025-06-10T10:00')]).slice(0,2),[null,null]);
});
