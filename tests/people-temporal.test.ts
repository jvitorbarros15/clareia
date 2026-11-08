import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTemporalPerson,deriveTemporalHistory,historyTime} from '../src/people-temporal.ts';
import type {HistoryReport,HistoryPerson,HistoryEvent} from '../src/people-history.ts';

const source={url:'https://dadosabertos.camara.leg.br/api/v2/legislaturas/57',sha256:'synthetic',file:'synthetic.sealed',fetchedAt:'2026-11-07T00:00:00Z',bytes:1,pass:1 as const};
const context={scope:{legislature:57,start:'2025-01-01',end:'2025-12-31',sampleIds:[1]},legislature:{id:57,start:'2023-02-01',end:'2027-01-31',source},references:{source,states:['Exercício','Afastado','Licença','Suplência','Suspenso','Vacância','Fim de Mandato','Convocado'].map((nome,i)=>({sigla:String(i),nome}))}};
const event=(overrides:Partial<HistoryEvent>={}):HistoryEvent=>({id:1,idLegislatura:57,dataHora:'2023-02-01T12:05',situacao:'Exercício',condicaoEleitoral:'Titular',siglaPartido:'PL',siglaUf:'SP',descricaoStatus:'Posse',...overrides});
const person=(events:HistoryEvent[],status:HistoryPerson['status']='stable'):HistoryPerson=>({id:1,profile:null,events,sources:[],status,issues:[]});
const month=(events:HistoryEvent[],number:number)=>deriveTemporalPerson(person(events),context).months.find(m=>m.month===number)!;

test('mid-month party change keeps UF independent and never chooses the beginning or end of the month',()=>{
  const events=[event({dataHora:'2025-11-13T09:00',siglaPartido:'PSD',descricaoStatus:'Alteração de partido'}),event()];
  const november=month(events,11);assert.equal(november.party.status,'changed');assert.equal(november.party.value,null);assert.deepEqual(november.party.values,['PL','PSD']);assert.equal(november.uf.status,'single');assert.equal(november.uf.value,'SP');assert.equal(november.exercise,'full');
  assert.equal(month(events,10).party.value,'PL');assert.equal(month(events,12).party.value,'PSD');
});
test('a change exactly at month boundary belongs to the new month without leaking backwards',()=>{
  const events=[event(),event({dataHora:'2025-02-01T00:00',siglaPartido:'B'})];assert.equal(month(events,1).party.value,'PL');assert.equal(month(events,2).party.value,'B');assert.equal(month(events,2).party.status,'single');
});
test('suplente exercising, leave and return are separate from electoral condition',()=>{
  const events=[event({condicaoEleitoral:'Suplente'}),event({dataHora:'2025-02-10T12:00',situacao:'Licença',condicaoEleitoral:'Suplente'}),event({dataHora:'2025-04-15T12:00',condicaoEleitoral:'Suplente'})];
  assert.equal(month(events,1).exercise,'full');assert.equal(month(events,2).exercise,'partial');assert.equal(month(events,3).exercise,'outside');assert.equal(month(events,3).party.status,'not-applicable');assert.equal(month(events,4).exercise,'partial');assert.equal(month(events,5).exercise,'full');
});
test('unknown exercise before the first event is not treated as outside or retrofilled from a later status',()=>{
  const result=deriveTemporalPerson(person([event({dataHora:'2025-03-15T12:00'})]),context);
  assert.equal(result.months[0].exercise,'unknown');assert.equal(result.months[0].party.status,'unknown');assert.equal(result.months[2].exercise,'unknown');assert.equal(result.months[3].exercise,'full');assert.equal(result.intervals[0].exercise.value,null);
});
test('simultaneous conflicting party snapshots do not contaminate a consistently reported UF or exercise',()=>{
  const january=month([event(),event({siglaPartido:'B'})],1);assert.equal(january.exercise,'full');assert.equal(january.party.status,'conflict');assert.equal(january.uf.value,'SP');assert.deepEqual(january.party.rows,[0,1]);
});
test('a missing simultaneous value stays unknown rather than adopting another row arbitrarily',()=>{
  assert.equal(month([event(),event({siglaPartido:null})],1).party.status,'unknown');
  assert.equal(month([event(),event({siglaUf:'XX'})],1).uf.status,'unknown');
});
test('timestamps are validated without rolling impossible dates or guessing day-only precision',()=>{
  assert.deepEqual(historyTime('2025-02-03T12:05'),{time:'2025-02-03T12:05:00',precision:'minute'});
  assert.deepEqual(historyTime('2025-02-03T12:05:20'),{time:'2025-02-03T12:05:20',precision:'second'});
  for(const value of [null,'2025-02-30T12:05','2025-01-01T24:00','2025-01-01T12:60','2025-01-01','2025-01-01T00:00Z'])assert.equal(historyTime(value).time,null);
});
test('invalid selected-legislature dates hold the timeline while other legislatures remain separate',()=>{
  assert.equal(month([event(),event({dataHora:'2025-02-30T12:00'})],1).exercise,'unknown');
  const other=deriveTemporalPerson(person([event(),event({idLegislatura:58,dataHora:'2023-02-01T00:00',siglaPartido:'WRONG'})]),context);
  assert.equal(other.months[0].party.value,'PL');assert.equal(other.events[1].disposition,'other-legislature');assert.equal(other.events[1].original.siglaPartido,'WRONG');
  const misplaced=deriveTemporalPerson(person([event({dataHora:'2022-01-01T00:00'})]),context);assert.equal(misplaced.months[0].exercise,'unknown');assert.ok(misplaced.issues.includes('selected-legislature-date-mismatch'));
});
test('unknown source situations and Convocado do not imply actual exercise or absence',()=>{
  for(const situacao of ['Convocado','NEW_SOURCE_STATE',null]){const m=month([event({situacao})],1);assert.equal(m.exercise,'unknown');assert.equal(m.party.status,'unknown');}
  assert.equal(month([event({situacao:'FIM_MANDATO'})],1).exercise,'outside');
  const ctx={...context,references:{...context.references,states:[...context.references.states,{sigla:'X',nome:'constructor'}]}};
  const unexpected=deriveTemporalPerson(person([event({situacao:'constructor'})]),ctx);assert.equal(unexpected.months[0].exercise,'unknown');
});
test('uncollected, changed and failed histories never produce a known monthly affiliation',()=>{
  for(const status of ['changed','failed'] as const){const result=deriveTemporalPerson(person([event()],status),context);assert.ok(result.months.every(m=>m.exercise==='unknown'&&m.party.value===null));}
  assert.equal(month([],1).exercise,'unknown');assert.equal(month([event()],1).financialCollection,'not-collected');
});
test('partial scope is explicit, and gaps and endpoints cover only the contracted window',()=>{
  const ctx={...context,scope:{...context.scope,start:'2025-01-10',end:'2025-02-20'}};
  const result=deriveTemporalPerson(person([event()]),ctx);assert.equal(result.months.length,2);assert.ok(result.months.every(m=>m.partialScope));assert.equal(result.intervals[0].start,'2025-01-10T00:00:00');assert.equal(result.intervals.at(-1)?.end,'2025-02-21T00:00:00');
});
test('party changes confined to confirmed non-exercise periods are not falsely assigned to active periods',()=>{
  const events=[event(),event({dataHora:'2025-01-10T12:00',situacao:'Licença',siglaPartido:'B'}),event({dataHora:'2025-01-20T12:00'})];
  assert.equal(month(events,1).party.value,'PL');assert.equal(month(events,1).exercise,'partial');
});
test('derivation remains staged and carries the exact input history version',()=>{
  const history={...context,schema:'clareia.people-history.v1',discoverySha256:'discovery',createdAt:'now',ruleVersion:'camara.history-reported-change.v1',status:'review-required',dateMeaning:'reported-change-not-independently-confirmed',people:[person([event()])],sources:[],coverage:{expected:1,stable:1,changed:0,failed:0}} as HistoryReport;
  const report=deriveTemporalHistory(history);assert.equal(report.publicAttributionEnabled,false);assert.equal(report.status,'review-required');assert.equal(report.historySha256.length,64);
});
