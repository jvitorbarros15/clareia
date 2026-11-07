import test from 'node:test';
import assert from 'node:assert/strict';
import {openDB} from '../src/store.ts';
import type {DB} from '../src/store.ts';
import {activePublication,latestPublication,publishDomain,readPublication,readRecords,recordDomainAudit,withholdPublication} from '../src/publications.ts';
import {snapshotId} from '../src/model.ts';
import type {Expense,Snapshot} from '../src/model.ts';

function record(cents:number,personId=1,index=0):Expense{
  return {id:`r${personId}-${cents}-${index}`,personId,year:2025,month:1,category:'TEST',supplier:'Fornecedor',supplierKey:'k',supplierVerified:false,documentId:'1',documentNumber:'1',date:null,receipt:null,cents,documentCents:cents,disallowedCents:0,source:{url:'https://dadosabertos.camara.leg.br/api/v2/x',sha256:'s',row:index,fetchedAt:'2025-03-01T00:00:00Z'}};
}
function version(records:Expense[]):Snapshot{
  const total=records.reduce((n,r)=>n+r.cents,0);
  const body={metric:'test.metric',scope:{year:2025,months:[1],ids:[1,2],legislature:57},people:[],records,collectedAt:'2025-03-01T00:00:00Z',publishedAt:'2025-03-01T00:00:00Z',pages:[],validation:{stablePasses:2,recordCount:records.length,totalCents:total,independentTotalCents:String(total),duplicatePolicy:'x',limitations:[]}};
  return {...body,id:snapshotId(body)};
}
const passed={checkedAt:'2025-03-02T00:00:00Z'};
async function withDB(task:(db:DB)=>Promise<void>){const db=await openDB(true);try{await task(db);}finally{await db.close();}}

test('failed audit keeps the previous active publication',()=>withDB(async db=>{
  const a=version([record(100)]),b=version([record(200)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',passed);
  await publishDomain(db,'despesas',b);
  assert.equal((await activePublication(db,'despesas'))?.id,a.id);
  await recordDomainAudit(db,b.id,'failed',passed);
  assert.equal((await activePublication(db,'despesas'))?.id,a.id);
}));
test('a passing audit makes the newest publication active, and re-auditing an older one does not move it back',()=>withDB(async db=>{
  const a=version([record(100)]),b=version([record(200)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',passed);
  await publishDomain(db,'despesas',b);await recordDomainAudit(db,b.id,'passed',passed);
  assert.equal((await activePublication(db,'despesas'))?.id,b.id);
  await recordDomainAudit(db,a.id,'passed',{checkedAt:'2030-01-01T00:00:00Z'});
  assert.equal((await activePublication(db,'despesas'))?.id,b.id);
}));
test('a failed votacoes publication does not change despesas',()=>withDB(async db=>{
  const a=version([record(100)]),v=version([record(300)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',passed);
  await publishDomain(db,'votacoes',v);await recordDomainAudit(db,v.id,'failed',passed);
  assert.equal((await activePublication(db,'despesas'))?.id,a.id);
  assert.equal(await activePublication(db,'votacoes'),null);
}));
test('publishing the same content twice is idempotent',()=>withDB(async db=>{
  const a=version([record(100),record(200)]);
  await publishDomain(db,'despesas',a);await publishDomain(db,'despesas',a);
  assert.equal((await db.query<{count:number}>('SELECT count(*)::integer AS count FROM expenses_v2')).rows[0].count,2);
  assert.equal((await db.query<{count:number}>('SELECT count(*)::integer AS count FROM publications')).rows[0].count,1);
}));
test('a wrong record total rolls back the whole publication',()=>withDB(async db=>{
  const bad=version([record(100)]);bad.records[0].cents=101;bad.id=snapshotId(bad);
  await assert.rejects(publishDomain(db,'despesas',bad),/Reconciliação/);
  assert.equal((await db.query<{count:number}>('SELECT count(*)::integer AS count FROM expenses_v2')).rows[0].count,0);
  assert.equal(await readPublication(db,bad.id),null);
}));
test('a withheld publication is never active',()=>withDB(async db=>{
  const a=version([record(100)]),b=version([record(200)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',passed);
  await publishDomain(db,'despesas',b);await recordDomainAudit(db,b.id,'passed',passed);
  await withholdPublication(db,b.id,'Revisão');
  assert.equal((await activePublication(db,'despesas'))?.id,a.id);
  assert.equal((await latestPublication(db,'despesas'))?.id,a.id);
  assert.equal(await readPublication(db,b.id),null);
}));
test('a stored publication rebuilds to the same identifier, in the original order',()=>withDB(async db=>{
  const a=version([record(300,2,0),record(100,1,1),record(200,2,2)]);
  await publishDomain(db,'despesas',a);
  const stored=await readPublication(db,a.id);
  assert.deepEqual(stored?.records.map(r=>r.id),a.records.map(r=>r.id));
  assert.equal(snapshotId(stored as Snapshot),a.id);
}));
test('records can be read for one person',()=>withDB(async db=>{
  const a=version([record(300,2,0),record(100,1,1)]);
  await publishDomain(db,'despesas',a);
  assert.deepEqual((await readRecords(db,a.id,1)).map(r=>r.cents),[100]);
  assert.equal((await readRecords(db,a.id)).length,2);
}));
test('a publication larger than one insert batch is stored complete',()=>withDB(async db=>{
  const a=version(Array.from({length:12001},(_,i)=>record(1,1,i)));
  await publishDomain(db,'despesas',a);
  assert.equal((await readRecords(db,a.id)).length,12001);
}));
