import test from 'node:test';
import assert from 'node:assert/strict';
import {activeExpensePublication,assertExpensePublication} from '../src/restore-check.ts';
import {openDB} from '../src/store.ts';

test('finds the active approved expense publication with its row count',async()=>{
  const db=await openDB(true);
  try{
    assert.equal(await activeExpensePublication(db),null);
    await db.query(`INSERT INTO publications(id,domain,body) VALUES('p1','despesas','{}'::jsonb)`);
    await db.query(`INSERT INTO active_publication VALUES('despesas','p1')`);
    assert.deepEqual(await activeExpensePublication(db),{id:'p1',audit:null,rows:0});
    await db.query(`INSERT INTO publication_audits VALUES('p1','passed',now(),'{}'::jsonb)`);
    await db.query(`INSERT INTO expenses_v2 VALUES('p1',0,'o1',1,2025,1,'c','s',100,'{}'::jsonb),('p1',1,'o2',1,2025,1,'c','s',200,'{}'::jsonb)`);
    assert.deepEqual(await activeExpensePublication(db),{id:'p1',audit:'passed',rows:2});
  }finally{await db.close();}
});

test('the restored publication must match the expected id, audit and row count',()=>{
  const good={id:'p1',audit:'passed',rows:2};
  assertExpensePublication(good,'p1',2);
  assert.throws(()=>assertExpensePublication(null,'p1',2),/Nenhuma publicação ativa/);
  assert.throws(()=>assertExpensePublication({...good,id:'p2'},'p1',2),/é p2, esperada p1/);
  assert.throws(()=>assertExpensePublication({...good,audit:null},'p1',2),/Auditoria.*não passou/);
  assert.throws(()=>assertExpensePublication({...good,audit:'failed'},'p1',2),/Auditoria.*failed/);
  assert.throws(()=>assertExpensePublication({...good,rows:1},'p1',2),/1 linhas.*esperadas 2/);
});
