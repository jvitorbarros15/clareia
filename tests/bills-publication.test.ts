import test from 'node:test';
import assert from 'node:assert/strict';
import {openDB} from '../src/store.ts';
import {activePublication,recordDomainAudit} from '../src/publications.ts';
import {billsContentId} from '../src/bills.ts';
import type {Bill,BillPerson,BillsReport} from '../src/bills.ts';
import {assertBillsMatchVersion,auditBillsVersion,buildBillsVersion,readBills,reobserveBillsVersion,storeBillsVersion} from '../src/bills-publication.ts';

const bill=(id:number,year:number,overrides:Partial<Bill>={}):Bill=>({id,type:'PL',number:id,year,presentedAt:`${year}-03-01T10:00`,summary:'Ementa',situation:'Aguardando Parecer',situationAt:null,url:null,authors:[{deputyId:10,order:1,proponent:true}],otherAuthors:0,otherProponents:0,issues:[],normStatus:'none',norm:null,...overrides});
function report(year:number,bills:Bill[],people:BillPerson[]):BillsReport{
  const metrics={propositions:bills.length,selected:bills.length,held:0,orphanAuthorRows:0,normsResolved:0,normsUnresolved:0},body={schema:'clareia.bills.v1' as const,year,types:['PL','PLP','PEC'],bills,people,metrics};
  return {...body,contentSha256:billsContentId(body),status:'review-required',publicationEligible:false,createdAt:`${year+1}-01-01T00:00:00Z`,sources:[]};
}
const person=(proposed:number):BillPerson[]=>[{id:10,proposed,joint:0,coauthored:0,norms:0}];
const pair=(r:BillsReport)=>({report:r,audit:{status:'passed',contentSha256:r.contentSha256}});
const y25=report(2025,[bill(1,2025)],person(1)),y24=report(2024,[bill(2,2024)],person(1)),now='2026-11-09T00:00:00Z';

test('years add up per person and an unaudited or repeated year is refused',()=>{
  assert.deepEqual(buildBillsVersion([pair(y25),pair(y24)],now).people,person(2));
  assert.throws(()=>buildBillsVersion([{report:y25,audit:{status:'failed',contentSha256:y25.contentSha256}}],now),/auditoria/);
  assert.throws(()=>buildBillsVersion([{report:y25,audit:{status:'passed',contentSha256:'x'}}],now),/auditoria/);
  assert.throws(()=>buildBillsVersion([pair(y25),pair(y25)],now),/repetido/);
  const edited=structuredClone(y25);edited.people[0].proposed=9;assert.throws(()=>buildBillsVersion([pair(edited)],now),/auditoria/);
});
test('a stored version stays inactive until approved and the audit recounts from SQL',async()=>{
  const db=await openDB(true);
  try{
    const reports=[y25,y24],version=buildBillsVersion(reports.map(pair),now);
    await storeBillsVersion(db,version);await storeBillsVersion(db,version);
    assert.equal((await readBills(db,version.id)).length,2);assert.equal(await activePublication(db,'projetos'),null);
    const audit=await auditBillsVersion(db,version.id,reports);assert.deepEqual(audit.failures,[]);
    await db.query(`UPDATE bills_v1 SET record=jsonb_set(record,'{authors,0,proponent}','false') WHERE publication_id=$1 AND bill_id=1`,[version.id]);
    const tampered=await auditBillsVersion(db,version.id,reports);assert.ok(tampered.failures.includes('person-counts'));assert.ok(tampered.failures.includes('content-id'));
    await assert.rejects(assertBillsMatchVersion(db,version.id),/diferem/);
    await db.query(`UPDATE bills_v1 SET record=jsonb_set(record,'{authors,0,proponent}','true') WHERE publication_id=$1 AND bill_id=1`,[version.id]);
    await reobserveBillsVersion(db,version.id);await recordDomainAudit(db,version.id,'passed',{checkedAt:audit.checkedAt});
    assert.equal((await activePublication(db,'projetos'))?.id,version.id);assert.deepEqual(await assertBillsMatchVersion(db,version.id),person(2));
  }finally{await db.close();}
});
test('held bills enter the stored list but not the recount',async()=>{
  const db=await openDB(true);
  try{
    const r=report(2025,[bill(1,2025),bill(2,2025,{issues:['year-date-mismatch']})],person(1)),version=buildBillsVersion([pair(r)],now);
    await storeBillsVersion(db,version);assert.deepEqual((await auditBillsVersion(db,version.id,[r])).failures,[]);
  }finally{await db.close();}
});
