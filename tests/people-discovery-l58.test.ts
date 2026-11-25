import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {parseDiscoveryScope} from '../src/people-discovery.ts';

const file=path.join(import.meta.dirname,'..','config','people-discovery-2027-l58.json');

test('legislature 58 scope parses on its start day and is refused before it',async()=>{
  const scope=JSON.parse(await fs.readFile(file,'utf8'));
  assert.equal(scope.legislature,58);
  assert.equal(scope.start,'2027-02-01');
  assert.deepEqual(parseDiscoveryScope(scope,'2027-02-01'),scope);
  assert.throws(()=>parseDiscoveryScope(scope,'2027-01-31'));
  assert.throws(()=>parseDiscoveryScope(scope,'2026-11-24'));
});
