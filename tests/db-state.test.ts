import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {keepDumps,restoreState,saveState} from '../src/db-state.ts';
import type {Runner} from '../src/db-state.ts';
import {memoryStore} from '../src/object-store.ts';
import {open,seal} from '../src/vault.ts';

const key=randomBytes(32),url='postgresql://localhost/clareia';
const dump=(iso:string)=>`dumps/${iso}.dump`;
const ok:Runner=async()=>new Uint8Array([1,2,3]);

test('keepDumps keeps the 7 newest and one per month',()=>{
  const old=['2026-08-01','2026-08-20','2026-09-02','2026-09-15'].map(d=>dump(`${d}T00-00-00Z`));
  const recent=Array.from({length:8},(_,i)=>dump(`2026-11-0${i+1}T00-00-00Z`));
  const kept=keepDumps([...old,...recent]);
  assert.equal(kept.includes(dump('2026-08-20T00-00-00Z')),true);
  assert.equal(kept.includes(dump('2026-09-15T00-00-00Z')),true);
  assert.equal(kept.includes(dump('2026-08-01T00-00-00Z')),false);
  assert.equal(kept.includes(dump('2026-09-02T00-00-00Z')),false);
  assert.equal(kept.includes(dump('2026-11-01T00-00-00Z')),false);
  for(const k of recent.slice(1))assert.equal(kept.includes(k),true);
  assert.equal(kept.length,9);
});
test('saveState stores a sealed dump and removes what retention drops',async()=>{
  const store=memoryStore();
  for(let i=1;i<=8;i++)await store.put(dump(`2026-11-0${i}T00-00-00Z`),new Uint8Array([i]));
  const saved=await saveState(store,url,new Date('2026-11-09T12:00:00.000Z'),{key,run:ok});
  assert.equal(saved,dump('2026-11-09T12-00-00Z'));
  assert.deepEqual(Buffer.from(open(await store.get(saved) as Uint8Array,key)),Buffer.from([1,2,3]));
  assert.equal(await store.get(dump('2026-11-01T00-00-00Z')),null);
  assert.equal(await store.get(dump('2026-11-02T00-00-00Z')),null);
});
test('restoreState loads the newest dump',async()=>{
  const store=memoryStore();let restored:Uint8Array|undefined;
  await store.put(dump('2026-11-01T00-00-00Z'),seal(new Uint8Array([1]),key));
  await store.put(dump('2026-11-02T00-00-00Z'),seal(new Uint8Array([2]),key));
  await restoreState(store,url,false,{key,run:async(_,__,input)=>{restored=input;return new Uint8Array();}});
  assert.deepEqual(Buffer.from(restored as Uint8Array),Buffer.from([2]));
});
test('restoreState fails when dumps exist but pg_restore fails',async()=>{
  const store=memoryStore();await store.put(dump('2026-11-01T00-00-00Z'),seal(new Uint8Array([1]),key));
  await assert.rejects(restoreState(store,url,false,{key,run:async()=>{throw new Error('pg_restore falhou');}}),/pg_restore falhou/);
  await assert.rejects(restoreState(store,url,true,{key,run:async()=>{throw new Error('pg_restore falhou');}}),/pg_restore falhou/);
});
test('restoreState fails on a dump sealed with another key',async()=>{
  const store=memoryStore();await store.put(dump('2026-11-01T00-00-00Z'),seal(new Uint8Array([1]),randomBytes(32)));
  await assert.rejects(restoreState(store,url,false,{key,run:ok}));
});
test('restoreState fails on an empty store unless allowEmpty is true',async()=>{
  await assert.rejects(restoreState(memoryStore(),url,false,{key,run:ok}),/Nenhuma cópia/);
  await restoreState(memoryStore(),url,true,{key,run:ok});
});
