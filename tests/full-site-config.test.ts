import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {assertYearVersion,parseFullSiteConfig} from '../src/full-site-config.ts';

const base=()=>({historyRun:'h',legacyRun:'l',expenseYears:{'2025':['a','b']},ceilingRuns:{'2025':'c'},defaultYear:2025,billsRuns:['b1'],votesRuns:['v1']});
const hashes={temporalSha256:'t',crosscheckSha256:'x'};

test('the checked-in config parses in the new shape',async()=>{
  const config=parseFullSiteConfig(JSON.parse(await fs.readFile('config/full-site.json','utf8')));
  assert.equal(config.defaultYear,2025);assert.deepEqual(Object.keys(config.expenseYears),['2025','2026']);
});
test('config accepts several years and a year without a ceiling',()=>{
  const config=parseFullSiteConfig({...base(),expenseYears:{'2025':['a'],'2026':['c26']}});
  assert.deepEqual(Object.keys(config.expenseYears),['2025','2026']);assert.equal(config.ceilingRuns[2026],undefined);
});
test('config refuses the old keys, a bad year key and a default year that is not a key',()=>{
  const {expenseYears:_e,ceilingRuns:_c,...old}=base();
  assert.throws(()=>parseFullSiteConfig({...old,expenseRuns:['a'],ceilingRun:'c'}),/expenseYears/);
  assert.throws(()=>parseFullSiteConfig({...base(),expenseYears:{'25':['a']}}),/expenseYears/);
  assert.throws(()=>parseFullSiteConfig({...base(),defaultYear:2026}),/defaultYear/);
  assert.throws(()=>parseFullSiteConfig({...base(),defaultYear:'2025'}),/defaultYear/);
  assert.throws(()=>parseFullSiteConfig({...base(),ceilingRuns:{'2026':'c'}}),/ceilingRuns\.2026/);
  assert.throws(()=>parseFullSiteConfig({...base(),expenseYears:{'2025':['a'],'2026':['a']}}),/repete/);
  assert.throws(()=>parseFullSiteConfig({...base(),socialRun:'../x'}),/socialRun/);
});
test('the version of a year must be of that year',()=>{
  assertYearVersion(2025,{scope:{year:2025}},hashes,hashes);
  assert.throws(()=>assertYearVersion(2026,{scope:{year:2025}},hashes,hashes),/2026.*2025/);
});
test('the first lot of each year must come from the coverage temporal and crosscheck versions',()=>{
  assert.throws(()=>assertYearVersion(2025,{scope:{year:2025}},hashes,{...hashes,temporalSha256:'other'}),/versões temporais diferentes/);
  assert.throws(()=>assertYearVersion(2025,{scope:{year:2025}},hashes,{...hashes,crosscheckSha256:'other'}),/versões temporais diferentes/);
});
