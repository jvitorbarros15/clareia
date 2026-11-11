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
const recording=()=>{const seen:string[]=[];return {seen,fetch:async(r:Request)=>{seen.push(new URL(r.url).pathname);return new URL(r.url).pathname==='/'?new Response('<html>',{status:200}):new Response('Not found',{status:404,headers:immutable});}};};
test('deputy and state routes get the app page',async()=>{
  for(const path of ['/deputado/62881-gabriel-mota','/deputado/62881','/estado/SP','/estado/sp/']){
    const a=recording(),r=await worker.fetch(new Request(`https://clareia.example${path}`),{ASSETS:a});
    assert.equal(r.status,200,path);assert.deepEqual(a.seen,['/'],path);
  }
});
test('other misses stay real 404s and are never cached',async()=>{
  for(const path of ['/data/abc/nao-existe.json','/deputado/62881/despesas.json','/estado/SPX','/qualquer','/deputado/a/b']){
    const a=recording(),r=await worker.fetch(new Request(`https://clareia.example${path}`),{ASSETS:a});
    assert.equal(r.status,404,path);assert.equal(r.headers.get('Cache-Control'),'no-store',path);assert.deepEqual(a.seen,[path],path);
  }
});
test('app routes only answer reads',async()=>{
  const a=recording(),r=await worker.fetch(new Request('https://clareia.example/deputado/1',{method:'POST'}),{ASSETS:a});
  assert.equal(r.status,404);assert.deepEqual(a.seen,['/deputado/1']);
});
