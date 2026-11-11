import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{serveData} from '../worker/index.ts';

const immutable={'Cache-Control':'public, max-age=31536000, immutable','X-Test':'kept'};
const assets=(status:number)=>({fetch:async()=>new Response(status===200?'ok':status===304?null:'Not found',{status,headers:immutable})});
const request=new Request('https://clareia.example/data/abc/index.json');

test('a missing data file is never cached',async()=>{
  const r=await serveData(request,assets(404));
  assert.equal(r.status,404);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(r.headers.get('X-Test'),'kept');assert.equal(await r.text(),'Not found');
});
test('a data file that exists keeps the headers from the assets',async()=>{
  const r=await serveData(request,assets(200));
  assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),immutable['Cache-Control']);assert.equal(await r.text(),'ok');
});
test('revalidation answers are passed through untouched',async()=>{
  const r=await serveData(request,assets(304));
  assert.equal(r.status,304);assert.equal(r.headers.get('Cache-Control'),immutable['Cache-Control']);
});
test('the default export serves through the ASSETS binding',async()=>{
  const r=await worker.fetch(request,{ASSETS:assets(404)});
  assert.equal(r.headers.get('Cache-Control'),'no-store');
});
