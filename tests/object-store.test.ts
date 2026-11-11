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
test('r2Store gives up after 7 attempts and does not retry other 4xx',async()=>{
  let calls=0;
  await assert.rejects(r2Store(env,{sleep:noWait,fetch:async()=>{calls++;return new Response('x',{status:500});}}).put('a',new Uint8Array([1])),/500/);
  assert.equal(calls,7);
  calls=0;
  await assert.rejects(r2Store(env,{sleep:noWait,fetch:async()=>{calls++;return new Response('x',{status:403});}}).put('a',new Uint8Array([1])),/403/);
  assert.equal(calls,1);
  calls=0;
  await assert.rejects(r2Store(env,{sleep:noWait,fetch:async()=>{calls++;throw new Error('socket');}}).get('a'),/socket/);
  assert.equal(calls,7);
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
test('r2Store sends the base64 MD5 of the body on PUT',async()=>{
  let md5:string|null=null;
  await r2Store(env,{fetch:async input=>{md5=(input as Request).headers.get('content-md5');return new Response(null,{status:200});}}).put('a',new TextEncoder().encode('hello'));
  assert.equal(md5,'XUFAKrxLKna5cZ2REBfFkg==');
});
test('r2Store retries a GET whose body fails midway',async()=>{
  const broken=new Response(new ReadableStream({start(controller){controller.error(new Error('reset'));}}),{status:200});
  const outcomes=[broken,new Response('ok',{status:200})];let calls=0;
  const store=r2Store(env,{sleep:noWait,fetch:async()=>{calls++;return outcomes.shift() as Response;}});
  assert.deepEqual(await store.get('a'),new TextEncoder().encode('ok'));
  assert.equal(calls,2);
});
test('r2Store backs off with full jitter up to a cap',async()=>{
  const waits:number[]=[];
  await assert.rejects(r2Store(env,{sleep:async ms=>{waits.push(ms);},fetch:async()=>new Response('x',{status:503})}).get('a'),/503/);
  assert.equal(waits.length,6);
  waits.forEach((ms,i)=>assert.ok(ms>=0&&ms<=Math.min(30000,500*2**i)));
});
test('r2Store sends bodies over 16 MiB as a multipart upload',async()=>{
  const seen:{method:string;url:string;size:number;md5:string|null}[]=[];
  const body=new Uint8Array(16*1024**2*2+5).map((_,i)=>i%251);
  await r2Store(env,{fetch:async input=>{
    const r=input as Request,size=(await r.arrayBuffer()).byteLength;seen.push({method:r.method,url:r.url,size,md5:r.headers.get('content-md5')});
    if(r.url.endsWith('?uploads'))return new Response('<InitiateMultipartUploadResult><UploadId>u 1</UploadId></InitiateMultipartUploadResult>');
    if(r.method==='PUT')return new Response(null,{status:200,headers:{etag:`"e${new URL(r.url).searchParams.get('partNumber')}"`}});
    return new Response('<CompleteMultipartUploadResult></CompleteMultipartUploadResult>');
  }}).put('big',body);
  assert.deepEqual(seen.map(s=>s.method),['POST','PUT','PUT','PUT','POST']);
  assert.deepEqual(seen.slice(1,4).map(s=>s.size),[16*1024**2,16*1024**2,5]);
  assert.ok(seen.slice(1,4).every((s,i)=>new URL(s.url).searchParams.get('partNumber')===String(i+1)&&new URL(s.url).searchParams.get('uploadId')==='u 1'&&s.md5));
  assert.equal(seen[4].size,'<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"e1"</ETag></Part><Part><PartNumber>2</PartNumber><ETag>"e2"</ETag></Part><Part><PartNumber>3</PartNumber><ETag>"e3"</ETag></Part></CompleteMultipartUpload>'.length);
});
test('r2Store aborts a multipart upload when a part fails',async()=>{
  const methods:string[]=[];
  await assert.rejects(r2Store(env,{sleep:noWait,fetch:async input=>{
    const r=input as Request;methods.push(r.method);
    if(r.url.endsWith('?uploads'))return new Response('<UploadId>u</UploadId>');
    if(r.method==='PUT')return new Response('x',{status:403});
    return new Response(null,{status:204});
  }}).put('big',new Uint8Array(16*1024**2+1)),/403/);
  assert.deepEqual(methods,['POST','PUT','DELETE']);
});
test('r2Store fails a multipart upload whose completion reports an error',async()=>{
  await assert.rejects(r2Store(env,{fetch:async input=>{
    const r=input as Request;
    if(r.url.endsWith('?uploads'))return new Response('<UploadId>u</UploadId>');
    if(r.method==='PUT')return new Response(null,{status:200,headers:{etag:'"e"'}});
    if(r.method==='POST')return new Response('<Error><Code>InternalError</Code></Error>');
    return new Response(null,{status:204});
  }}).put('big',new Uint8Array(16*1024**2+1)),/não concluiu/);
});
test('r2Store scales the timeout with the upload size',async()=>{
  const timers:number[]=[],real=globalThis.setTimeout;
  globalThis.setTimeout=((fn:()=>void,ms:number)=>{timers.push(ms);return real(fn,ms);}) as typeof setTimeout;
  try{await r2Store(env,{fetch:async()=>new Response(null,{status:200})}).put('a',new Uint8Array(10_000_000));}finally{globalThis.setTimeout=real;}
  assert.ok(timers.includes(120000+100000));
});
