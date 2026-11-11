import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/model.ts';
import {ceilingReport,deriveCeiling,moneyCents,parseAnnex} from '../src/cota-ceiling.ts';
import {auditCeiling} from '../src/cota-ceiling-audit.ts';
import {ANNEX,ceilingFiles,consolidatedHtml,originalHtml,recompositionHtml,sourcesOf} from './fixtures/cota-ceiling.ts';

const build=(files=ceilingFiles(),year=2025)=>{const report=ceilingReport(year,deriveCeiling(year,files),sourcesOf(files,hash),'2026-11-11T12:00:00Z');return {report,files,audit:()=>auditCeiling(report,s=>files[s.key])};};
test('annex becomes one row per UF and month with the act and source URL, in integer cents',()=>{
  const {report,audit}=build();
  assert.equal(report.rows.length,324);assert.equal(report.publicationEligible,false);
  const ac=report.rows.filter(r=>r.uf==='AC');assert.equal(ac.length,12);assert.ok(ac.every(r=>r.ceilingCents===5042626&&r.act.includes('270/2023')&&r.effectiveFrom==='2023-02-01'));
  assert.equal(report.rows.find(r=>r.uf==='DF')!.ceilingCents,3658246);assert.equal(audit().status,'passed');
});
test('money parsing is strict',()=>{
  assert.equal(moneyCents('1.234,56'),123456);
  for(const bad of ['', '1234,56','1.23,56','12,5','R$ 12,50','12,500'])assert.throws(()=>moneyCents(bad));
});
test('missing, repeated or unknown UF and altered layout fail closed',()=>{
  const {AC:_ac,...missing}=ANNEX;
  assert.throws(()=>parseAnnex(ceilingFiles({consolidated:consolidatedHtml(missing)}).consolidated));
  assert.throws(()=>parseAnnex(ceilingFiles({consolidated:consolidatedHtml({...ANNEX,XX:'1,00'})}).consolidated));
  assert.throws(()=>parseAnnex(ceilingFiles({consolidated:consolidatedHtml().replace('VALOR DA COTA (R$)','VALOR')}).consolidated));
  assert.throws(()=>parseAnnex(ceilingFiles({consolidated:consolidatedHtml().replace('<td><p>AL</p></td>','<td><p>AC</p></td>')}).consolidated));
});
test('act text changes and years outside the annex validity are refused',()=>{
  assert.throws(()=>deriveCeiling(2025,ceilingFiles({consolidated:consolidatedHtml(ANNEX,'(Anexo com redação dada pelo Ato da Mesa nº 999)')})));
  assert.throws(()=>deriveCeiling(2025,ceilingFiles({original:originalHtml('1º de março de 2023')})));
  assert.throws(()=>deriveCeiling(2025,ceilingFiles({recomposition:recompositionHtml('janeiro de 2024')})));
  for(const year of [2022,2023,2026])assert.throws(()=>deriveCeiling(year,ceilingFiles()));
});
test('the independent audit rejects altered originals, values, UFs and months',()=>{
  const {report,files}=build();
  const clone=()=>JSON.parse(JSON.stringify(report));
  const run=(r:any,f=files)=>auditCeiling(r,s=>f[s.key]).status;
  assert.equal(run(clone()),'passed');
  const value=clone();value.rows[0].ceilingCents+=1;assert.equal(run(value),'failed');
  const dup=clone();dup.rows[1].month=1;assert.equal(run(dup),'failed');
  const short=clone();short.rows.pop();assert.equal(run(short),'failed');
  const eligible=clone();eligible.publicationEligible=true;assert.equal(run(eligible),'failed');
  const late=clone();late.rows[0].year=2026;assert.equal(run(late),'failed');
  const tampered={...files,consolidated:ceilingFiles({consolidated:consolidatedHtml({...ANNEX,AC:'50.426,27'})}).consolidated};assert.equal(run(clone(),tampered),'failed');
  const url=clone();url.sources[0].url='https://evil.example/x';assert.equal(run(url),'failed');
});
test('the audit does not depend on the collector parser: a layout the parser rejects still fails closed',()=>{
  const files=ceilingFiles({consolidated:consolidatedHtml().replace('UNIDADE DA FEDERAÇÃO','UF')}),{report}=build();
  assert.throws(()=>deriveCeiling(2025,files));
  assert.equal(auditCeiling(report,s=>files[s.key]).status,'failed');
});
