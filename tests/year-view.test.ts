import test from 'node:test';
import assert from 'node:assert/strict';
import {yearFolder,yearFolderOf,partialLabel,provisionalMonths} from '../src/year-view.ts';

const manifest={base:'data/abc',defaultYear:2025,years:[{year:2025,months:[1,2,3,4,5,6,7,8,9,10,11,12]},{year:2026,months:[1,2,3,4,5,6,7,8,9,10]}]};

test('the default year lives at the base and other years in a subfolder',()=>{
  assert.deepEqual(yearFolder(manifest,null),{year:2025,folder:'data/abc',isDefault:true});
  assert.deepEqual(yearFolder(manifest,'2025'),{year:2025,folder:'data/abc',isDefault:true});
  assert.deepEqual(yearFolder(manifest,'2026'),{year:2026,folder:'data/abc/2026',isDefault:false});
  assert.equal(yearFolderOf(manifest,2026),'data/abc/2026');
  assert.equal(yearFolderOf(manifest,2025),'data/abc');
  assert.equal(yearFolderOf(manifest,'2025'),'data/abc');assert.equal(yearFolderOf(manifest,'2026'),'data/abc/2026');
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

test('the methodology text states the published months from the manifest years',async()=>{
  const {loadStaticPages}=await import('../src/prerender.ts');
  const anos=((await loadStaticPages()).pages.metodologia as unknown as {anos:(years:unknown[],defaultYear:string)=>string}).anos;
  const years=[{year:2025,months:manifest.years[0].months,partial:false},{year:2026,months:[1,2,3,4,5,6,7,8,9,10,11],partial:true}];
  const text=anos(years,'2025');
  assert.match(text,/O ano de 2025 está completo e é o que o site abre primeiro\./);
  assert.match(text,/O ano de 2026 está publicado de janeiro a novembro, porque dezembro ainda não fechou\./);
});

test('provisionalMonths uses the 90-day UTC boundary from each month end',()=>{
  // March 2026 ends 2026-03-31: +89 days = 2026-06-28, +90 = 2026-06-29, +91 = 2026-06-30.
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-28T23:59:59Z'),[3]);
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-29T00:00:00Z'),[]);
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-30T12:00:00Z'),[]);
});

test('provisionalMonths handles December crossing into the next year',()=>{
  // December 2025 ends 2025-12-31; 2026 is non-leap, so +89 = 2026-03-30, +90 = 2026-03-31, +91 = 2026-04-01.
  assert.deepEqual(provisionalMonths([10,11,12],2025,'2026-03-30T12:00:00Z'),[12]);
  assert.deepEqual(provisionalMonths([10,11,12],2025,'2026-03-31T00:00:00Z'),[]);
  assert.deepEqual(provisionalMonths([10,11,12],2025,'2026-04-01T00:00:00Z'),[]);
  // Crossing into leap year 2024: +89 = 2024-03-29, +90 = 2024-03-30.
  assert.deepEqual(provisionalMonths([12],2023,'2024-03-29T00:00:00Z'),[12]);
  assert.deepEqual(provisionalMonths([12],2023,'2024-03-30T00:00:00Z'),[]);
});

test('provisionalMonths handles February in leap and non-leap years',()=>{
  // Leap year 2024 (Feb 29): +89 = 2024-05-28, +90 = 2024-05-29; Jan 31 +90 = 2024-04-30.
  assert.deepEqual(provisionalMonths([1,2],2024,'2024-04-29T00:00:00Z'),[1,2]);
  assert.deepEqual(provisionalMonths([1,2],2024,'2024-04-30T00:00:00Z'),[2]);
  assert.deepEqual(provisionalMonths([2],2024,'2024-05-28T00:00:00Z'),[2]);
  assert.deepEqual(provisionalMonths([2],2024,'2024-05-29T00:00:00Z'),[]);
  // Non-leap year 2025 (Feb 28): +89 = 2025-05-28, +90 = 2025-05-29; Jan 31 +89 = 2025-04-30, +90 = 2025-05-01.
  assert.deepEqual(provisionalMonths([1,2],2025,'2025-04-30T00:00:00Z'),[1,2]);
  assert.deepEqual(provisionalMonths([1,2],2025,'2025-05-01T00:00:00Z'),[2]);
  assert.deepEqual(provisionalMonths([2],2025,'2025-05-28T00:00:00Z'),[2]);
  assert.deepEqual(provisionalMonths([2],2025,'2025-05-29T00:00:00Z'),[]);
});

test('provisionalMonths marks months ending after collection as provisional and ignores malformed dates',()=>{
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-03-15T12:00:00Z'),[1,2,3]);
  assert.deepEqual(provisionalMonths([1,12],2026,'2026-05-10T00:00:00Z'),[12]);
  for(const bad of ['','not-a-date','2026-13-01T00:00:00Z','2026-02-30T00:00:00Z','2026-02-29T00:00:00Z','2026-06-28T25:00:00Z','2026-06-28T12:60:00Z','2026-06-28T12:00:00+25:00','2026-06-28\n12:00:00Z','2026-06-28\t12:00:00Z','2026-06-28\r12:00:00Z','12345']){
    assert.deepEqual(provisionalMonths([1,2,3],2026,bad),[],bad);
  }
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-28 23:59:59Z'),[3]);
  assert.deepEqual(provisionalMonths([1,2,3],2026,undefined as unknown as string),[]);
});

test('provisionalMonths interprets offsetless timestamps as UTC and honors offsets crossing UTC midnight',()=>{
  // Offsetless timestamps stay on their UTC calendar day regardless of host timezone.
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-28T23:59:59'),[3]);
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-29T00:00:00'),[]);
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-28'),[3]);
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-29'),[]);
  // 2026-06-28T23:30:00-03:00 is 2026-06-29T02:30:00Z (90 days after Mar 31 -> not provisional).
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-28T23:30:00-03:00'),[]);
  // 2026-06-29T01:30:00+03:00 is 2026-06-28T22:30:00Z (89 days after Mar 31 -> provisional).
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-29T01:30:00+03:00'),[3]);
});

test('provisionalMonths handles years 0000-0099 without 1900 remapping',()=>{
  assert.deepEqual(provisionalMonths([1,2,3],50,'0050-06-28T23:59:59Z'),[3]);
  assert.deepEqual(provisionalMonths([1,2,3],50,'0050-06-29T00:00:00Z'),[]);
  assert.deepEqual(provisionalMonths([1,2,3],50,'0050-02-29T00:00:00Z'),[]);
  // Year 0000 is a leap year (Feb 29): +89 = May 28, +90 = May 29.
  assert.deepEqual(provisionalMonths([1,2],0,'0000-05-28T00:00:00Z'),[2]);
  assert.deepEqual(provisionalMonths([1,2],0,'0000-05-29T00:00:00Z'),[]);
});

test('provisionalMonths normalizes ISO 24:00:00 end-of-day timestamps to the next day',()=>{
  // 2026-06-27T24:00:00Z == 2026-06-28T00:00:00Z (89 days after Mar 31 -> provisional).
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-27T24:00:00Z'),[3]);
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-27T24:00:00.000Z'),[3]);
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-27T24:00Z'),[3]);
  // 2026-06-28T24:00:00Z == 2026-06-29T00:00:00Z (90 days after Mar 31 -> not provisional).
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-28T24:00:00Z'),[]);
  // 2026-06-28T24:00:00+01:00 == 2026-06-28T23:00:00Z (89 days -> provisional).
  assert.deepEqual(provisionalMonths([1,2,3],2026,'2026-06-28T24:00:00+01:00'),[3]);
  // Year rollover: 2025-12-31T24:00:00Z == 2026-01-01T00:00:00Z.
  assert.deepEqual(provisionalMonths([9,10,11,12],2025,'2025-12-31T24:00:00Z'),[10,11,12]);
  for(const bad of ['2026-06-27T24:00:01Z','2026-06-27T24:01:00Z','2026-06-27T24:00:00.001Z','2026-06-27T24:00:00.0001Z','2026-02-29T24:00:00Z']){
    assert.deepEqual(provisionalMonths([1,2,3],2026,bad),[],bad);
  }
});
