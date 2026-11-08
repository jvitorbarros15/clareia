import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,hash} from '../src/model.ts';
import {openDB} from '../src/store.ts';
import {activePublication,recordDomainAudit} from '../src/publications.ts';
import {auditPeopleCoverage,buildPeopleCoverage,readPeopleCoverage,storePeopleCoverage} from '../src/people-publication.ts';
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
test('a party change only one source reports puts only its month in review',()=>{
  const t=temporal(),coverage=buildPeopleCoverage(t,crosscheck(t,'no-automatic-resolution',[{legacyRow:0,v2Row:null,day:'2025-02-10',before:'PL',after:'PSD',status:'legacy-only-change'}]),passed(t),published);
  assert.deepEqual(coverage.rows.map(r=>[r.month,r.party,r.review]),[[1,'PL',false],[2,null,true]]);
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
    await recordDomainAudit(db,coverage.id,'passed',{checkedAt:audit.checkedAt});assert.equal((await activePublication(db,'pessoas'))?.id,coverage.id);
  }finally{await db.close();}
});
test('a tampered coverage id is refused',async()=>{
  const db=await openDB(true);
  try{const t=temporal(),coverage=buildPeopleCoverage(t,crosscheck(t),passed(t),published);await assert.rejects(storePeopleCoverage(db,{...coverage,id:hash('x')}));}finally{await db.close();}
});
