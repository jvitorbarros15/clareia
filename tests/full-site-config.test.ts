import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {assertYearVersion,coverageOf,parseFullSiteConfig} from '../src/full-site-config.ts';

const base=()=>({historyRun:'h',legacyRun:'l',expenseYears:{'2025':['a','b']},ceilingRuns:{'2025':'c'},defaultYear:2025,billsRuns:['b1'],votesRuns:['v1']});
const hashes={temporalSha256:'t',crosscheckSha256:'x'};
const pair2024={historyRun:'h24',legacyRun:'l24'};
const threeYears=()=>({...base(),expenseYears:{'2024':['a24'],'2025':['a'],'2026':['a26']}});

test('the checked-in config keeps both years on the top-level coverage pair',async()=>{
  const raw=JSON.parse(await fs.readFile('config/full-site.json','utf8'));
  assert.equal(Object.hasOwn(raw,'coverageRuns'),false);
  const config=parseFullSiteConfig(raw);
  assert.equal(config.defaultYear,2025);assert.deepEqual(Object.keys(config.expenseYears),['2025','2026']);
  assert.deepEqual(config.coverageRuns,{});
  const {historyRun,legacyRun}=config;
  for(const year of [2025,2026])assert.deepEqual(coverageOf(config,year),{historyRun,legacyRun});
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
test('config accepts an optional amendmentsRun and rejects a bad value',()=>{
  const without=parseFullSiteConfig(base());
  assert.equal(Object.hasOwn(without,'amendmentsRun'),false);
  assert.equal(parseFullSiteConfig({...base(),amendmentsRun:'run-1'}).amendmentsRun,'run-1');
  assert.throws(()=>parseFullSiteConfig({...base(),amendmentsRun:'../x'}),/Configuração inválida: amendmentsRun/);
});
test('config accepts a third year with its own coverage pair',()=>{
  const config=parseFullSiteConfig({...threeYears(),coverageRuns:{2024:pair2024}});
  assert.deepEqual(config.coverageRuns,{2024:pair2024});
  assert.deepEqual(coverageOf(config,2024),pair2024);
  assert.deepEqual(coverageOf(config,2025),{historyRun:'h',legacyRun:'l'});
});
test('config rejects invalid or repeated coverage pairs and years without expenses',()=>{
  const config=threeYears();
  assert.throws(()=>parseFullSiteConfig({...config,coverageRuns:{2024:{historyRun:'h24'}}}),/Configuração inválida: coverageRuns\.2024\.legacyRun/);
  assert.throws(()=>parseFullSiteConfig({...config,coverageRuns:{2024:{...pair2024,historyRun:'../h24'}}}),/Configuração inválida: coverageRuns\.2024\.historyRun/);
  assert.throws(()=>parseFullSiteConfig({...config,coverageRuns:{2024:'h24'}}),/Configuração inválida: coverageRuns\.2024/);
  assert.throws(()=>parseFullSiteConfig({...config,coverageRuns:{2024:{historyRun:config.historyRun,legacyRun:config.legacyRun}}}),/Configuração inválida: coverageRuns repete/);
  assert.throws(()=>parseFullSiteConfig({...config,coverageRuns:{2024:pair2024,2026:pair2024}}),/Configuração inválida: coverageRuns repete/);
  assert.throws(()=>parseFullSiteConfig({...config,coverageRuns:{2023:pair2024}}),/Configuração inválida: coverageRuns\.2023/);
});
test('the version of a year must be of that year',()=>{
  assertYearVersion(2025,{scope:{year:2025}},hashes,hashes);
  assert.throws(()=>assertYearVersion(2026,{scope:{year:2025}},hashes,hashes),/2026.*2025/);
});
test('the first lot of each year must come from the coverage temporal and crosscheck versions',()=>{
  assert.throws(()=>assertYearVersion(2025,{scope:{year:2025}},hashes,{...hashes,temporalSha256:'other'}),/versões temporais diferentes/);
  assert.throws(()=>assertYearVersion(2025,{scope:{year:2025}},hashes,{...hashes,crosscheckSha256:'other'}),/versões temporais diferentes/);
});
test('a 2024 proposal must match the versions from its own coverage pair',()=>{
  const config=parseFullSiteConfig({...threeYears(),coverageRuns:{2024:pair2024}});
  const hashes2024={temporalSha256:'t24',crosscheckSha256:'x24'};
  const coverages=new Map([['h|l',hashes],['h24|l24',hashes2024]]);
  const {historyRun,legacyRun}=coverageOf(config,2024),coverage=coverages.get(`${historyRun}|${legacyRun}`)!;
  const version={scope:{year:2024}};
  assertYearVersion(2024,version,coverage,hashes2024);
  assert.throws(()=>assertYearVersion(2024,version,coverage,hashes),/versões temporais diferentes/);
});
