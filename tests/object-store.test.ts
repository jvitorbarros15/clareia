import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryStore,r2Store,storeFromEnv} from '../src/object-store.ts';

const env={R2_ACCOUNT_ID:'acc',R2_ACCESS_KEY_ID:'id',R2_SECRET_ACCESS_KEY:'secret',R2_BUCKET:'clareia'};

test('memoryStore keeps, lists and deletes',async()=>{
  const s=memoryStore();await s.put('a/1',new Uint8Array([1]));await s.put('b/1',new Uint8Array([2]));
  assert.deepEqual(await s.list('a/'),['a/1']);
  await s.delete('a/1');assert.equal(await s.get('a/1'),null);
});
test('storeFromEnv is null without a bucket, so local runs stay local',()=>{
  assert.equal(storeFromEnv({}),null);
  assert.ok(storeFromEnv(env));
});
test('r2Store requires every credential',()=>{
  assert.throws(()=>r2Store({...env,R2_SECRET_ACCESS_KEY:undefined}),/R2_SECRET_ACCESS_KEY/);
});
test('r2Store signs requests and targets the bucket',async t=>{
  let seen:Request|undefined;
  t.mock.method(globalThis,'fetch',async(input:Request)=>{seen=input;return new Response(null,{status:200});});
  await r2Store(env).put('dumps/a.dump',new Uint8Array([1]));
  assert.equal(seen?.url,'https://acc.r2.cloudflarestorage.com/clareia/dumps/a.dump');
  assert.equal(seen?.method,'PUT');
  assert.match(String(seen?.headers.get('authorization')),/^AWS4-HMAC-SHA256/);
});
test('r2Store get returns null on 404 and throws on other errors',async t=>{
  const status={value:404};
  t.mock.method(globalThis,'fetch',async()=>new Response('x',{status:status.value}));
  assert.equal(await r2Store(env).get('nada'),null);
  status.value=403;
  await assert.rejects(r2Store(env).get('nada'),/403/);
});
const noWait=async()=>{};
test('r2Store retries network errors, 5xx and 429 and then succeeds',async()=>{
  const outcomes:(Response|Error)[]=[new Error('socket'),new Response('x',{status:503}),new Response('x',{status:429}),new Response('ok',{status:200})];
  let calls=0;
  const store=r2Store(env,{sleep:noWait,fetch:async()=>{calls++;const next=outcomes.shift() as Response|Error;if(next instanceof Error)throw next;return next;}});
  assert.deepEqual(await store.get('a'),new TextEncoder().encode('ok'));
  assert.equal(calls,4);
});
test('r2Store gives up after 5 attempts and does not retry other 4xx',async()=>{
  let calls=0;
  await assert.rejects(r2Store(env,{sleep:noWait,fetch:async()=>{calls++;return new Response('x',{status:500});}}).put('a',new Uint8Array([1])),/500/);
  assert.equal(calls,5);
  calls=0;
  await assert.rejects(r2Store(env,{sleep:noWait,fetch:async()=>{calls++;return new Response('x',{status:403});}}).put('a',new Uint8Array([1])),/403/);
  assert.equal(calls,1);
  calls=0;
  await assert.rejects(r2Store(env,{sleep:noWait,fetch:async()=>{calls++;throw new Error('socket');}}).get('a'),/socket/);
  assert.equal(calls,5);
});
test('r2Store gives each attempt a timeout signal',async()=>{
  let signal:AbortSignal|undefined;
  await r2Store(env,{fetch:async(input)=>{signal=(input as Request).signal;return new Response(null,{status:200});}}).put('a',new Uint8Array([1]));
  assert.ok(signal);
});
test('r2Store list follows continuation tokens',async t=>{
  const pages=['<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>n1</NextContinuationToken><Key>a/1</Key></ListBucketResult>','<ListBucketResult><IsTruncated>false</IsTruncated><Key>a/2</Key></ListBucketResult>'];
  const urls:string[]=[];
  t.mock.method(globalThis,'fetch',async(input:Request)=>{urls.push(input.url);return new Response(pages.shift());});
  assert.deepEqual(await r2Store(env).list('a/'),['a/1','a/2']);
  assert.match(urls[1],/continuation-token=n1/);
});
