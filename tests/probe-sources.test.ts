import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,SOURCES} from '../scripts/probe-sources.mjs';

test('classify separates reachable, blocked and unstable sources',()=>{
  assert.equal(classify(200,1024),'ok');
  assert.equal(classify(206,1024),'ok');
  assert.equal(classify(403,0),'blocked');
  assert.equal(classify(451,0),'blocked');
  assert.equal(classify(200,0),'unstable');
  assert.equal(classify(504,0),'unstable');
  assert.equal(classify(0,0),'unstable');
});
test('every source is an https url with a name',()=>{
  assert.ok(SOURCES.length>=7);
  for(const s of SOURCES){assert.ok(s.name);assert.equal(new URL(s.url).protocol,'https:');}
});
