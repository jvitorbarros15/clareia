import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,hash} from '../src/model.ts';
import {CEILING_ACT,CEILING_EFFECTIVE_FROM,CEILING_SOURCES,CEILING_YEARS,PORTAL_2026_ACT,ceilingReport,ceilingSha,deriveCeiling,moneyCents,parseAnnex} from '../src/cota-ceiling.ts';
import {PORTAL_2026_CAPTURED_AT,PORTAL_2026_CENTS,PORTAL_2026_URL} from '../src/cota-ceiling-2026-portal.ts';
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
  for(const year of [2022,2023,2027])assert.throws(()=>deriveCeiling(year,ceilingFiles()));
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
test('2026 report has 297 rows: January from 2023 annex, no February, March to December from portal',()=>{
  assert.deepEqual(CEILING_YEARS,[2024,2025,2026]);
  assert.equal(PORTAL_2026_CENTS.RO,5626790);
  const {report:r2024}=build(ceilingFiles(),2024),{report,audit}=build(ceilingFiles(),2026);
  assert.equal(report.rows.length,297);assert.deepEqual(report.metrics,{ufs:27,rows:297});
  assert.equal(report.rows.some(r=>r.month===2),false);
  const jan2024=new Map(r2024.rows.filter(r=>r.month===1).map(r=>[r.uf,r]));
  const jan2026=report.rows.filter(r=>r.month===1);
  assert.equal(jan2026.length,27);
  for(const r of jan2026){
    const prev=jan2024.get(r.uf)!;
    assert.deepEqual({...r,year:2024},prev);
  }
  const rest=report.rows.filter(r=>r.month>=3);
  assert.equal(rest.length,27*10);
  for(const r of rest){
    assert.equal(r.ceilingCents,PORTAL_2026_CENTS[r.uf]);
    assert.equal(r.act,PORTAL_2026_ACT);
    assert.match(r.act,/Câmara/);
    assert.equal(r.effectiveFrom,PORTAL_2026_CAPTURED_AT);
    assert.equal(r.annexUrl,PORTAL_2026_URL);
    assert.equal(r.actUrl,PORTAL_2026_URL);
  }
  assert.equal(audit().status,'passed');
});
test('2024 and 2025 reports and ceilingSha stay unchanged and still require 27x12 annex rows',()=>{
  for(const year of [2024,2025]){
    const {report,files,audit}=build(ceilingFiles(),year);
    assert.deepEqual(Object.keys(report),['schema','year','unit','generatedAt','sources','rows','metrics','publicationEligible','notes']);
    assert.equal(report.rows.length,324);
    assert.equal(ceilingSha(report),hash(canonical(report)));
    assert.equal(audit().status,'passed');
    const noFeb=JSON.parse(JSON.stringify(report));
    noFeb.rows=noFeb.rows.filter((r:{month:number})=>r.month!==2);
    noFeb.metrics.rows=noFeb.rows.length;
    assert.equal(auditCeiling(noFeb,s=>files[s.key]).status,'failed');
  }
  const {report,files}=build(ceilingFiles(),2025),foreign=JSON.parse(JSON.stringify(report));
  foreign.year=2027;
  assert.equal(auditCeiling(foreign,s=>files[s.key]).status,'failed');
});
test('auditCeiling for 2026 fails on any February row',()=>{
  const {report,files}=build(ceilingFiles(),2026);
  const replaced=JSON.parse(JSON.stringify(report));
  replaced.rows.find((r:{uf:string;month:number})=>r.uf==='AC'&&r.month===3).month=2;
  assert.equal(auditCeiling(replaced,s=>files[s.key]).status,'failed');
  const added=JSON.parse(JSON.stringify(report));
  added.rows.push({...added.rows[0],month:2});added.metrics.rows=added.rows.length;
  assert.equal(auditCeiling(added,s=>files[s.key]).status,'failed');
});
test('auditCeiling for 2026 fails on a portal row in January or an annex row in March or later',()=>{
  const {report,files}=build(ceilingFiles(),2026);
  const portalInJan=JSON.parse(JSON.stringify(report));
  const jan=portalInJan.rows.find((r:{uf:string;month:number})=>r.uf==='AC'&&r.month===1);
  Object.assign(jan,{ceilingCents:PORTAL_2026_CENTS.AC,act:PORTAL_2026_ACT,effectiveFrom:PORTAL_2026_CAPTURED_AT,annexUrl:PORTAL_2026_URL,actUrl:PORTAL_2026_URL});
  assert.equal(auditCeiling(portalInJan,s=>files[s.key]).status,'failed');
  const annexInMar=JSON.parse(JSON.stringify(report));
  const mar=annexInMar.rows.find((r:{uf:string;month:number})=>r.uf==='AC'&&r.month===3);
  Object.assign(mar,{ceilingCents:5042626,act:CEILING_ACT,effectiveFrom:CEILING_EFFECTIVE_FROM,annexUrl:CEILING_SOURCES.consolidated,actUrl:CEILING_SOURCES.original});
  assert.equal(auditCeiling(annexInMar,s=>files[s.key]).status,'failed');
  const annexActInDec=JSON.parse(JSON.stringify(report));
  const dec=annexActInDec.rows.find((r:{uf:string;month:number})=>r.uf==='AC'&&r.month===12);
  Object.assign(dec,{act:CEILING_ACT,effectiveFrom:CEILING_EFFECTIVE_FROM,annexUrl:CEILING_SOURCES.consolidated,actUrl:CEILING_SOURCES.original});
  assert.equal(auditCeiling(annexActInDec,s=>files[s.key]).status,'failed');
});
test('auditCeiling for 2026 fails on a row count other than 297',()=>{
  const {report,files}=build(ceilingFiles(),2026);
  const short=JSON.parse(JSON.stringify(report));
  short.rows.pop();short.metrics.rows=short.rows.length;
  assert.equal(auditCeiling(short,s=>files[s.key]).status,'failed');
  const extra=JSON.parse(JSON.stringify(report));
  extra.rows.push({...extra.rows[0]});extra.metrics.rows=extra.rows.length;
  assert.equal(auditCeiling(extra,s=>files[s.key]).status,'failed');
});
test('auditCeiling for 2026 fails when a portal value differs from the committed file',()=>{
  const {report,files}=build(ceilingFiles(),2026);
  const altered=JSON.parse(JSON.stringify(report));
  altered.rows.find((r:{uf:string;month:number})=>r.uf==='AC'&&r.month===3).ceilingCents+=1;
  assert.equal(auditCeiling(altered,s=>files[s.key]).status,'failed');
});
test('auditCeiling for 2026 fails when a portal value is more than 1 cent away from round(annex * 1.1375)',()=>{
  const shiftedFiles=ceilingFiles({consolidated:consolidatedHtml({...ANNEX,AC:'50.427,26'})});
  const {audit}=build(shiftedFiles,2026);
  const result=audit();
  assert.equal(result.status,'failed');
  assert.ok(result.failures.some(f=>f.includes('1,1375')));
});
