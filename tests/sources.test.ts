import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {openDB} from '../src/store.ts';
import type {DB} from '../src/store.ts';
import {assertArchive,changedSources,fingerprint,recordSource} from '../src/sources.ts';
import type {Fingerprint} from '../src/sources.ts';

const url='https://www.camara.leg.br/cotas/Ano-2025.csv.zip';
const seen=(over:Partial<Fingerprint>={}):Fingerprint=>({url,etag:null,lastModified:'Wed, 05 Nov 2026 06:19:00 GMT',size:100,...over});
async function withDB(task:(db:DB)=>Promise<void>){const db=await openDB(true);try{await task(db);}finally{await db.close();}}

test('a source never seen counts as changed',()=>withDB(async db=>{
  assert.deepEqual(await changedSources(db,[seen()]),[url]);
}));
test('unchanged fingerprint returns no sources',()=>withDB(async db=>{
  await recordSource(db,seen(),'a','originals/a');
  assert.deepEqual(await changedSources(db,[seen()]),[]);
}));
test('new Last-Modified marks the source as changed',()=>withDB(async db=>{
  await recordSource(db,seen(),'a','originals/a');
  assert.deepEqual(await changedSources(db,[seen({lastModified:'Thu, 06 Nov 2026 06:19:00 GMT'})]),[url]);
}));
test('a different size marks the source as changed even with the same Last-Modified',()=>withDB(async db=>{
  await recordSource(db,seen(),'a','originals/a');
  assert.deepEqual(await changedSources(db,[seen({size:101})]),[url]);
}));
test('a source without ETag or Last-Modified always needs a download',()=>withDB(async db=>{
  const blind=seen({lastModified:null,size:null});
  await recordSource(db,blind,'a','originals/a');
  assert.deepEqual(await changedSources(db,[blind]),[url]);
}));
test('same sha256 with a new Last-Modified creates no new version',()=>withDB(async db=>{
  assert.equal(await recordSource(db,seen(),'a','originals/a'),true);
  const later=seen({lastModified:'Thu, 06 Nov 2026 06:19:00 GMT'});
  assert.equal(await recordSource(db,later,'a','originals/a'),false);
  assert.deepEqual(await changedSources(db,[later]),[]);
}));
test('content returning to an earlier hash still counts as new',()=>withDB(async db=>{
  await recordSource(db,seen(),'a','originals/a');
  await recordSource(db,seen({size:200}),'b','originals/b');
  assert.equal(await recordSource(db,seen({size:300}),'a','originals/a'),true);
  assert.deepEqual(await changedSources(db,[seen({size:300})]),[]);
}));
test('an HTML body with status 200 is rejected',()=>{
  assert.throws(()=>assertArchive(strToU8('<html><body>Serviço indisponível</body></html>'.repeat(10)),10),/Arquivo inválido/);
});
test('a truncated zip is rejected',()=>{
  const zip=zipSync({'Ano-2025.csv':strToU8('a;b\n1;2\n'.repeat(500))});
  assert.throws(()=>assertArchive(zip.subarray(0,zip.length-30),10),/Arquivo inválido/);
});
test('a zip smaller than the minimum is rejected',()=>{
  assert.throws(()=>assertArchive(zipSync({'a.csv':strToU8('a')}),1_000_000),/Arquivo inválido/);
});
test('a complete zip is accepted',()=>{
  assertArchive(zipSync({'a.csv':strToU8('a;b\n')}),10);
});
test('fingerprint reads validators from a HEAD response',async()=>{
  let method='';
  const fetcher=async(_:string,init?:RequestInit)=>{method=String(init?.method);return new Response(null,{status:200,headers:{etag:'"x"','last-modified':'Wed, 05 Nov 2026 06:19:00 GMT','content-length':'42'}});};
  assert.deepEqual(await fingerprint(url,fetcher),{url,etag:'"x"',lastModified:'Wed, 05 Nov 2026 06:19:00 GMT',size:42});
  assert.equal(method,'HEAD');
});
test('fingerprint fails when the source does not answer',async()=>{
  await assert.rejects(fingerprint(url,async()=>new Response(null,{status:503}),0),/503/);
});
