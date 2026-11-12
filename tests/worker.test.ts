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
const site=(prerendered:string[]=[])=>{const seen:string[]=[];return {seen,fetch:async(r:Request)=>{const p=new URL(r.url).pathname;seen.push(p);
  if(p==='/')return new Response('<html>home',{status:200,headers:{'Cache-Control':'max-age=0, must-revalidate'}});
  if(p==='/404')return new Response('<html>404 page',{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'max-age=0'}});
  if(prerendered.includes(p))return new Response('<html>deputy',{status:200});
  return new Response('Not found',{status:404,headers:immutable});}};};
test('a prerendered page is served as an asset',async()=>{
  const a=site(['/deputado/1-a']),r=await worker.fetch(new Request('https://clareia.example/deputado/1-a'),{ASSETS:a});
  assert.equal(r.status,200);assert.equal(await r.text(),'<html>deputy');assert.deepEqual(a.seen,['/deputado/1-a']);
});
test('the home page is served as an asset',async()=>{
  const r=await worker.fetch(new Request('https://clareia.example/'),{ASSETS:site()});
  assert.equal(r.status,200);assert.equal(await r.text(),'<html>home');
});
test('unknown deputy and state routes get the app shell with 404 and no-store',async()=>{
  for(const path of ['/deputado/999-x','/deputado/62881','/deputado/62881-gabriel-mota','/estado/ZZ','/estado/sp']){
    const a=site(),r=await worker.fetch(new Request(`https://clareia.example${path}`),{ASSETS:a});
    assert.equal(r.status,404,path);assert.equal(await r.text(),'<html>home',path);
    assert.equal(r.headers.get('Cache-Control'),'no-store',path);assert.deepEqual(a.seen,[path,'/'],path);
  }
});
test('HEAD on an unknown deputy route answers 404 with no body and no-store',async()=>{
  const r=await worker.fetch(new Request('https://clareia.example/deputado/999-x',{method:'HEAD'}),{ASSETS:site()});
  assert.equal(r.status,404);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(await r.text(),'');
});
test('unknown pages get the branded 404 and are never cached',async()=>{
  for(const path of ['/naoexiste','/estado/SPX','/deputado/a/b']){
    const a=site(),r=await worker.fetch(new Request(`https://clareia.example${path}`),{ASSETS:a});
    assert.equal(r.status,404,path);assert.equal(r.headers.get('Cache-Control'),'no-store',path);assert.equal(await r.text(),'<html>404 page',path);assert.deepEqual(a.seen,[path,'/404'],path);
  }
});
test('app routes only answer reads; other methods get the branded 404',async()=>{
  const a=site(),r=await worker.fetch(new Request('https://clareia.example/deputado/1',{method:'POST'}),{ASSETS:a});
  assert.equal(r.status,404);assert.equal(await r.text(),'<html>404 page');assert.equal(a.seen.includes('/'),false);
});
test('a missing data file keeps the plain 404 and never reaches the 404 page',async()=>{
  for(const path of ['/data/abc/nao-existe.json','/data/abc/deputados/1/despesas.json']){
    const a=site(),r=await worker.fetch(new Request(`https://clareia.example${path}`),{ASSETS:a});
    assert.equal(r.status,404,path);assert.equal(r.headers.get('Cache-Control'),'no-store',path);assert.equal(await r.text(),'Not found',path);assert.deepEqual(a.seen,[path],path);
  }
});
