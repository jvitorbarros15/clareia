import test from 'node:test';
import assert from 'node:assert/strict';
import {addNoindex,assertHeaders,latestCheckedAt} from '../src/site-headers.ts';

const base='/*\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src \'self\'\n  Strict-Transport-Security: max-age=1\n\n/data/*\n  Cache-Control: immutable\n';

test('noindex goes inside the single /* block',()=>{
  const text=addNoindex(base);
  assert.equal(text.match(/^\/\*$/gm)?.length,1);
  assert.match(text,/Strict-Transport-Security: max-age=1\n  X-Robots-Tag: noindex, nofollow\n\n\/data/);
  assertHeaders(text,true);
});
test('a second /* block is refused',()=>{
  assert.throws(()=>assertHeaders(base+'\n/*\n  X-Robots-Tag: noindex\n',true),/exatamente um bloco/);
});
test('missing security headers or noindex are refused',()=>{
  assert.throws(()=>assertHeaders('/*\n  X-Content-Type-Options: nosniff\n',false),/Content-Security-Policy/);
  assert.throws(()=>assertHeaders(base,true),/X-Robots-Tag/);
  assertHeaders(base,false);
});
test('CRLF files are understood',()=>{
  assertHeaders(base.replace(/\n/g,'\r\n'),false);
});
test('latest checkedAt is the newest valid time',()=>{
  assert.equal(latestCheckedAt([{checkedAt:'2026-01-02T00:00:00.000Z'},{},{checkedAt:'2026-03-01T00:00:00.000Z'},{checkedAt:'bad'}]),'2026-03-01T00:00:00.000Z');
  assert.throws(()=>latestCheckedAt([{}]));
});
