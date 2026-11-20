import test from 'node:test';
import assert from 'node:assert/strict';
import {yearFolder,yearFolderOf,partialLabel} from '../src/year-view.ts';

const manifest={base:'data/abc',defaultYear:2025,years:[{year:2025,months:[1,2,3,4,5,6,7,8,9,10,11,12]},{year:2026,months:[1,2,3,4,5,6,7,8,9,10]}]};

test('the default year lives at the base and other years in a subfolder',()=>{
  assert.deepEqual(yearFolder(manifest,null),{year:2025,folder:'data/abc',isDefault:true});
  assert.deepEqual(yearFolder(manifest,'2025'),{year:2025,folder:'data/abc',isDefault:true});
  assert.deepEqual(yearFolder(manifest,'2026'),{year:2026,folder:'data/abc/2026',isDefault:false});
  assert.equal(yearFolderOf(manifest,2026),'data/abc/2026');
  assert.equal(yearFolderOf(manifest,2025),'data/abc');
});

test('an unknown or malformed year falls back to the default',()=>{
  for(const bad of ['1999','abc','2026x','','../2026'])assert.equal(yearFolder(manifest,bad).folder,'data/abc',bad);
});

test('a manifest without years keeps the base',()=>{
  assert.deepEqual(yearFolder({base:'data/abc'},'2026'),{year:null,folder:'data/abc',isDefault:true});
});

test('the partial label spells the month range and the first open month',()=>{
  assert.equal(partialLabel([1,2,3,4,5,6,7,8,9,10],2026),'parcial · jan–out 2026 (novembro ainda não fechado)');
  assert.equal(partialLabel([1,2,3],2027),'parcial · jan–mar 2027 (abril ainda não fechado)');
  assert.equal(partialLabel([3],2026),'parcial · mar 2026 (abril ainda não fechado)');
  assert.equal(partialLabel([1,2,4],2026),'parcial · jan–abr 2026');
  assert.equal(partialLabel([2,3,4,5,6,7,8,9,10,11,12],2026),'parcial · fev–dez 2026');
});
