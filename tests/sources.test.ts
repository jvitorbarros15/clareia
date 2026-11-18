import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {assertArchive} from '../src/sources.ts';

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
