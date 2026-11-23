import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUpload,publishVersion} from '../src/deploy-version.ts';

const id='2e351a3f-f1d5-41bf-bc77-34af1d9b5921',previewUrl='https://2e351a3f-clareia.clareia.workers.dev';
const uploadOutput=`Worker Version ID: ${id}\nVersion Preview URL: ${previewUrl}`;

test('parses the version ID and preview URL from colored upload output',()=>{
  assert.deepEqual(parseUpload(`\x1b[1;32m${uploadOutput}\x1b[0m\r\n`),{id,previewUrl});
});

test('reports missing ID or preview URL',()=>{
  assert.throws(()=>parseUpload(`Version Preview URL: ${previewUrl}`),/não tem "Worker Version ID"/);
  assert.throws(()=>parseUpload(`Worker Version ID: ${id}`),{message:`A versão ${id} foi enviada sem "Version Preview URL" e não foi promovida; nada mudou no ar`});
});

test('uploads, checks the preview URL, then promotes the version',async()=>{
  const calls:string[]=[];
  const version=await publishVersion({
    upload:async()=>{calls.push('upload');return uploadOutput;},
    check:async url=>{calls.push(`check ${url}`);return [];},
    promote:async versionId=>{calls.push(`promote ${versionId}`);},
  });
  assert.deepEqual(calls,['upload',`check ${previewUrl}`,`promote ${id}`]);
  assert.deepEqual(version,{id,previewUrl});
});

test('reports all check failures and keeps the version unpromoted',async()=>{
  const promote=test.mock.fn(async()=>{});
  await assert.rejects(publishVersion({
    upload:async()=>uploadOutput,
    check:async()=>['CSP ausente','sha256 diferente'],
    promote,
  }),{message:`A versão ${id} NÃO passou na conferência em ${previewUrl} e não foi promovida; nada mudou no ar:\n  - CSP ausente\n  - sha256 diferente`});
  assert.equal(promote.mock.callCount(),0);
});

test('skips checking and promoting when upload output cannot be parsed',async()=>{
  const check=test.mock.fn(async()=>[]),promote=test.mock.fn(async()=>{});
  await assert.rejects(publishVersion({upload:async()=>'',check,promote}),/Worker Version ID/);
  assert.equal(check.mock.callCount(),0);
  assert.equal(promote.mock.callCount(),0);
});
