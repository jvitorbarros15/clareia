import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,hash} from '../src/model.ts';
import {openDB} from '../src/store.ts';
import {activePublication,recordDomainAudit} from '../src/publications.ts';
import {auditPeopleCoverage,buildPeopleCoverage,readPeopleCoverage,reobservePeopleCoverage,storePeopleCoverage} from '../src/people-publication.ts';
import type {TemporalReport} from '../src/people-temporal.ts';
import type {CrosscheckReport} from '../src/people-legacy.ts';

const dimension=(value:string)=>({status:'single' as const,value,values:[value],rows:[0]});
function temporal():TemporalReport{
  const months=[1,2].map(month=>({year:2025,month,start:'',end:'',partialScope:false,exercise:'full' as const,party:dimension('PL'),uf:dimension('SP'),financialCollection:'not-collected' as const}));
  return {schema:'clareia.people-temporal.v1',ruleVersion:'camara.history-reported-change.v1',historySha256:hash('h'),scope:{legislature:57,start:'2025-01-01',end:'2025-02-28',sampleIds:[1]},createdAt:'2026-11-08T12:00:00Z',status:'review-required',publicAttributionEnabled:false,people:[{id:1,collectionStatus:'stable',events:[],intervals:[],months,issues:[]}]};
}
function crosscheck(t:TemporalReport,comparison:CrosscheckReport['people'][number]['months'][number]['comparison']='no-automatic-resolution',partyChanges:CrosscheckReport['people'][number]['partyChanges']=[]):CrosscheckReport{
  return {schema:'clareia.people-crosscheck.v1',legacySha256:hash('l'),temporalSha256:hash(canonical(t)),historySha256:hash('h'),discoverySha256:hash('d'),scope:t.scope,createdAt:'2026-11-08T12:00:00Z',status:'review-required',publicAttributionEnabled:false,dateSemantics:'boundary-days-and-open-ends-unconfirmed',people:[{id:1,legacyStatus:'stable',partyComparisonStatus:'compared',partyChanges,months:[1,2].map(month=>({year:2025,month,v2Exercise:'full',legacy:'reported-exercise' as const,periodRows:[0],openEnd:false,comparison}))}]};
}
const passed=(t:TemporalReport)=>({status:'passed',temporalSha256:hash(canonical(t))});
const published='2026-11-08T13:00:00Z';

test('coverage refuses a temporal version without a matching passed audit or crosscheck',()=>{
  const t=temporal(),c=crosscheck(t);
  assert.throws(()=>buildPeopleCoverage(t,c,{status:'failed',temporalSha256:hash(canonical(t))},published));
  assert.throws(()=>buildPeopleCoverage(t,c,{status:'passed',temporalSha256:hash('other')},published));
  assert.throws(()=>buildPeopleCoverage(t,{...c,temporalSha256:hash('other')},passed(t),published));
});
test('a month the sources dispute publishes no party or UF as fact',()=>{
  const t=temporal(),coverage=buildPeopleCoverage(t,crosscheck(t,'potential-conflict'),passed(t),published);
  assert.deepEqual([coverage.rows[0].party,coverage.rows[0].uf,coverage.rows[0].partyStatus,coverage.rows[0].review],[null,null,'review',true]);
  assert.equal(coverage.rows[0].exercise,'full');
});
test('a party change only one source reports puts that month and every later month in review, keeping the UF',()=>{
  const t=temporal(),coverage=buildPeopleCoverage(t,crosscheck(t,'no-automatic-resolution',[{legacyRow:0,v2Row:null,day:'2025-01-10',before:'PL',after:'PSD',status:'legacy-only-change'}]),passed(t),published);
  assert.deepEqual(coverage.rows.map(r=>[r.month,r.party,r.uf,r.review]),[[1,null,'SP',true],[2,null,'SP',true]]);
  const later=temporal(),rows=buildPeopleCoverage(later,crosscheck(later,'no-automatic-resolution',[{legacyRow:0,v2Row:null,day:'2025-02-10',before:'PL',after:'PSD',status:'v2-only-change'}]),passed(later),published).rows;
  assert.deepEqual(rows.map(r=>[r.month,r.party,r.review]),[[1,'PL',false],[2,null,true]]);
});
test('a month the cross-check could not run publishes no party or UF, unless the person was outside',()=>{
  const t=temporal();t.people[0].months[1].exercise='outside';t.people[0].months[1].party={status:'not-applicable',value:null,values:[],rows:[]};t.people[0].months[1].uf={status:'not-applicable',value:null,values:[],rows:[]};
  const rows=buildPeopleCoverage(t,crosscheck(t,'unavailable'),passed(t),published).rows;
  assert.deepEqual(rows.map(r=>[r.partyStatus,r.party,r.uf,r.review]),[['review',null,null,true],['not-applicable',null,null,false]]);
});
test('a month with a party change lists the parties without choosing one',()=>{
  const t=temporal();t.people[0].months[0].party={status:'changed',value:null,values:['PL','PSD'],rows:[0,1]};
  const row=buildPeopleCoverage(t,crosscheck(t),passed(t),published).rows[0];assert.equal(row.party,null);assert.deepEqual(row.partyValues,['PL','PSD']);
});
test('stored coverage stays inactive until its audit passes, and the audit rereads SQL',async()=>{
  const db=await openDB(true);
  try{
    const t=temporal(),c=crosscheck(t),coverage=buildPeopleCoverage(t,c,passed(t),published);
    await storePeopleCoverage(db,coverage);await storePeopleCoverage(db,coverage);
    assert.deepEqual(await readPeopleCoverage(db,coverage.id),coverage.rows);assert.equal(await activePublication(db,'pessoas'),null);
    const audit=await auditPeopleCoverage(db,coverage.id,t,c);assert.equal(audit.status,'passed');
    await db.query(`UPDATE people_coverage_v1 SET record=jsonb_set(record,'{party}','"XX"') WHERE publication_id=$1 AND month=1`,[coverage.id]);
    const tampered=await auditPeopleCoverage(db,coverage.id,t,c);assert.equal(tampered.status,'failed');assert.ok(tampered.failures.some(f=>f.startsWith('attribution-')));
    await db.query(`UPDATE people_coverage_v1 SET record=jsonb_set(record,'{party}','"PL"') WHERE publication_id=$1 AND month=1`,[coverage.id]);
    await db.query(`UPDATE people_coverage_v1 SET record=jsonb_set(record,'{partyValues}','["XX"]') WHERE publication_id=$1 AND month=1`,[coverage.id]);assert.ok((await auditPeopleCoverage(db,coverage.id,t,c)).failures.some(f=>f.startsWith('attribution-')));
    await db.query(`UPDATE people_coverage_v1 SET record=jsonb_set(record,'{partyValues}','[]') WHERE publication_id=$1 AND month=1`,[coverage.id]);
    const disputed=crosscheck(t,'potential-conflict');assert.equal((await auditPeopleCoverage(db,coverage.id,t,disputed)).status,'failed');
    await recordDomainAudit(db,coverage.id,'passed',{checkedAt:audit.checkedAt});assert.equal((await activePublication(db,'pessoas'))?.id,coverage.id);
  }finally{await db.close();}
});
test('a tampered coverage id is refused',async()=>{
  const db=await openDB(true);
  try{const t=temporal(),coverage=buildPeopleCoverage(t,crosscheck(t),passed(t),published);await assert.rejects(storePeopleCoverage(db,{...coverage,id:hash('x')}));}finally{await db.close();}
});

test('coverage seen again becomes the newest version only when approved',async()=>{
  const db=await openDB(true);
  try{
    const a=temporal(),ca=crosscheck(a),one=buildPeopleCoverage(a,ca,passed(a),published),b=temporal();b.people[0].months[0].party=dimension('PSD');
    const two=buildPeopleCoverage(b,crosscheck(b),passed(b),published);
    for(const v of [one,two]){await storePeopleCoverage(db,v);await recordDomainAudit(db,v.id,'passed',{checkedAt:published});}
    assert.equal((await activePublication(db,'pessoas'))?.id,two.id);
    await storePeopleCoverage(db,one);await recordDomainAudit(db,two.id,'passed',{checkedAt:published});assert.equal((await activePublication(db,'pessoas'))?.id,two.id,'storing again without approval changes nothing');
    await storePeopleCoverage(db,one);await reobservePeopleCoverage(db,one.id);await recordDomainAudit(db,one.id,'passed',{checkedAt:published});
    assert.equal((await activePublication(db,'pessoas'))?.id,one.id);
  }finally{await db.close();}
});

test('reprocessing identical sources keeps the same coverage id',()=>{
  const first=temporal(),second={...temporal(),createdAt:'2030-01-01T00:00:00Z',historySha256:hash('other')};
  assert.equal(buildPeopleCoverage(first,crosscheck(first),passed(first),published).id,buildPeopleCoverage(second,crosscheck(second),passed(second),'2030-01-02T00:00:00Z').id);
});
test('a party conflict sends that month and the following ones to review',()=>{
  const t=temporal();t.people[0].months[0].party={status:'conflict',value:null,values:['PL','PSD'],rows:[0,1]};
  assert.deepEqual(buildPeopleCoverage(t,crosscheck(t),passed(t),published).rows.map(r=>r.review),[true,true]);
});
test('an event of another legislature after the last known state holds the person, unless it agrees',async()=>{
  const event=(disposition:string,time:string,siglaPartido:string)=>({row:0,precision:'minute',disposition,time,original:{id:1,idLegislatura:disposition==='usable'?57:56,dataHora:time,situacao:'Exercício',condicaoEleitoral:'Titular',siglaPartido,siglaUf:'SP',descricaoStatus:'x'}}) as TemporalReport['people'][number]['events'][number];
  const held=temporal();held.people[0].events=[event('usable','2023-02-01T12:00:00','PL'),event('other-legislature','2023-03-01T12:00:00','PSD')];
  const rows=buildPeopleCoverage(held,crosscheck(held),passed(held),published).rows;assert.deepEqual(rows.map(r=>[r.party,r.uf,r.review]),[[null,null,true],[null,null,true]]);
  const before=temporal();before.people[0].events=[event('other-legislature','2023-01-30T12:00:00','PSD'),event('usable','2023-02-01T12:00:00','PL')];
  assert.equal(buildPeopleCoverage(before,crosscheck(before),passed(before),published).rows[0].party,'PL');
  const db=await openDB(true);
  try{const c=crosscheck(held),v=buildPeopleCoverage(held,c,passed(held),published);await storePeopleCoverage(db,v);assert.equal((await auditPeopleCoverage(db,v.id,held,c)).status,'passed');}finally{await db.close();}
});
