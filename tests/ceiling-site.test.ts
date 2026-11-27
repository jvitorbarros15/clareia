import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {canonical,hash,snapshotId} from '../src/model.ts';
import type {Expense} from '../src/model.ts';
import {CEILING_ACT,CEILING_EFFECTIVE_FROM,CEILING_SOURCES,PORTAL_2026_ACT,ceilingReport,deriveCeiling} from '../src/cota-ceiling.ts';
import type {CeilingReport} from '../src/cota-ceiling.ts';
import {PORTAL_2026_CAPTURED_AT,PORTAL_2026_NOTE,PORTAL_2026_URL} from '../src/cota-ceiling-2026-portal.ts';
import {auditCeiling} from '../src/cota-ceiling-audit.ts';
import {buildSiteCeiling} from '../src/ceiling-site.ts';
import {ceilingUse,tenthsOf} from '../src/ceiling-use.ts';
import {buildSiteSummary} from '../src/site-summary.ts';
import {buildPeopleCoverage} from '../src/people-publication.ts';
import type {TemporalReport} from '../src/people-temporal.ts';
import type {CrosscheckReport} from '../src/people-legacy.ts';
import {openDB} from '../src/store.ts';
import {publishDomain,recordDomainAudit} from '../src/publications.ts';
import {buildSite} from '../src/build-site.ts';
import {ANNEX,ceilingFiles,legacyCeilingReport,legacyCeilingSha,mixedCeiling2026,reportFor,sourcesOf} from './fixtures/cota-ceiling.ts';

const made=()=>{const files=ceilingFiles(),report=ceilingReport(2025,deriveCeiling(2025,files),sourcesOf(files,hash),'2026-11-11T12:00:00Z');return {report,audit:auditCeiling(report,s=>files[s.key])};};
const person={id:1,name:'Pessoa 1',photo:null,sourceUrl:'https://x',profileFetchedAt:'2025-03-01T00:00:00Z'};

test('the site ceiling is cents per UF and month with the act and the source URL',()=>{
  const {report,audit}=made(),site=buildSiteCeiling(report,audit,2025);
  assert.equal(site.schema,'clareia.site-ceiling.v1');assert.equal(site.year,2025);assert.equal(site.unit,'monthly-ceiling-per-uf-cents');
  assert.deepEqual(Object.keys(site.byUf),[...Object.keys(site.byUf)].sort());assert.equal(Object.keys(site.byUf).length,27);
  assert.deepEqual(site.byUf.AC,new Array(12).fill(5042626));assert.deepEqual(site.byUf.DF,new Array(12).fill(3658246));
  assert.match(site.act,/270\/2023/);assert.match(site.annexUrl,/^https:\/\/www2\.camara\.leg\.br\//);assert.match(site.actUrl,/atodamesa-270/);
  assert.equal(site.reportSha256,hash(canonical(report)));assert.equal(JSON.stringify(buildSiteCeiling(report,audit,2025)),JSON.stringify(site));
});
test('a missing, failed or foreign audit refuses the ceiling',()=>{
  const {report,audit}=made();
  assert.throws(()=>buildSiteCeiling(report,null,2025),/sem auditoria aprovada/);
  assert.throws(()=>buildSiteCeiling(report,undefined,2025),/sem auditoria aprovada/);
  assert.throws(()=>buildSiteCeiling(report,{...audit,status:'failed'},2025),/sem auditoria aprovada/);
  assert.throws(()=>buildSiteCeiling(report,{...audit,reportSha256:'0'.repeat(64)},2025),/sem auditoria aprovada/);
  const altered={...report,rows:report.rows.map((r,i)=>i?r:{...r,ceilingCents:r.ceilingCents+1})};
  assert.throws(()=>buildSiteCeiling(altered,audit,2025),/sem auditoria aprovada/);
  assert.throws(()=>buildSiteCeiling(report,audit,2024),/outro ano/);
});
test('the summary carries the ceiling, or null, and refuses a ceiling of another year',()=>{
  const {report,audit}=made(),ceiling=buildSiteCeiling(report,audit,2025);
  const input={publicationId:'p',scope:{year:2025,months:[1],ids:[1],legislature:57},people:[person],records:[] as Expense[],expectedTotalCents:0,coverageId:null,coverage:[]};
  assert.deepEqual(buildSiteSummary({...input,ceiling}).ceiling,ceiling);assert.equal(buildSiteSummary(input).ceiling,null);
  assert.throws(()=>buildSiteSummary({...input,scope:{...input.scope,year:2024},ceiling}),/não cobre o ano/);
});
test('buildSite writes the ceiling into summary.json',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-ceiling-')),db=await openDB(true);
  try{
    await fs.mkdir(path.join(dir,'portraits'));
    const records=[{id:'r1',personId:1,year:2025,month:1,category:'TEST',supplier:'F',supplierKey:'k',supplierVerified:false,documentId:'1',documentNumber:'1',date:null,receipt:null,cents:100,documentCents:100,disallowedCents:0,source:{url:'https://dadosabertos.camara.leg.br/api/v2/x',sha256:'s',row:0,fetchedAt:'2025-03-01T00:00:00Z'}}] as unknown as Expense[];
    const body={metric:'test.metric',scope:{year:2025,months:[1],ids:[1],legislature:57},people:[person],records,collectedAt:'2025-03-01T00:00:00Z',publishedAt:'2025-03-01T00:00:00Z',pages:[],validation:{stablePasses:2,recordCount:1,totalCents:100,independentTotalCents:'100',duplicatePolicy:'x',limitations:[]}};
    const v={...body,id:snapshotId(body as never)} as never;
    await publishDomain(db,'despesas',v);await recordDomainAudit(db,(v as {id:string}).id,'passed',{checkedAt:'2025-03-02T00:00:00Z',status:'passed'} as never);
    const {report,audit}=made(),ceiling=buildSiteCeiling(report,audit,2025),{publicationId}=await buildSite(db,path.join(dir,'dist'),path.join(dir,'portraits'),{},{defaultYear:2025,years:[{year:2025,publicationId:(v as {id:string}).id,ceiling}]});
    const summary=JSON.parse(await fs.readFile(path.join(dir,'dist','data',publicationId,'summary.json'),'utf8'));
    assert.deepEqual(summary.ceiling,ceiling);
  }finally{await db.close();await fs.rm(dir,{recursive:true,force:true});}
});

type M=Parameters<typeof ceilingUse>[0][number];
const month=(m:number,cents:number,over:Partial<M>={}):M=>({month:m,cents,records:cents?1:0,exercise:'full',held:false,ufStatus:'single',uf:'SP',...over});
const table={year:2025,byUf:{SP:new Array(12).fill(4283733),RR:new Array(12).fill(5140633)}};
test('percent uses exact sums over the counted months, with partial and held months out of both sides',()=>{
  const u=ceilingUse([month(1,100000),month(2,200000),month(3,999999,{exercise:'partial'}),month(4,777,{held:true}),month(5,0,{exercise:'outside'}),month(6,300000,{uf:'RR'})],table,true);
  assert.equal(u.status,'ok');if(u.status!=='ok')return;
  assert.deepEqual(u.counted.map(c=>c.month),[1,2,6]);assert.deepEqual(u.excluded,[{month:3,reason:'partial'},{month:4,reason:'held'}]);assert.deepEqual(u.outside,[5]);
  assert.equal(u.expenseCents,600000);assert.equal(u.ceilingCents,4283733*2+5140633);assert.equal(u.tenths,tenthsOf(600000,4283733*2+5140633));
});
test('a held month outside the mandate stays held, never outside',()=>{
  const u=ceilingUse([month(1,100000),month(5,0,{exercise:'outside',held:true})],table,true);
  assert.equal(u.status,'ok');if(u.status!=='ok')return;
  assert.deepEqual(u.counted.map(c=>c.month),[1]);
  assert.deepEqual(u.excluded,[{month:5,reason:'held'}]);
  assert.deepEqual(u.outside,[]);
});
test('a held review-outside month is missing, never excluded, and leaves the figure unconfirmed',()=>{
  const u=ceilingUse([month(1,100000),month(5,0,{exercise:'outside',held:true,exerciseReview:true})],table,true);
  assert.equal(u.status,'unconfirmed');if(u.status!=='unconfirmed')return;
  assert.deepEqual(u.missing,[5]);assert.deepEqual(u.excluded,[]);assert.deepEqual(u.outside,[]);
});
test('a counted month without a confirmed UF ceiling is not confirmed, never zero',()=>{
  assert.equal(ceilingUse([month(1,5),month(2,5,{uf:null,ufStatus:'review'})],table,true).status,'unconfirmed');
  assert.equal(ceilingUse([month(1,5)],null,true).status,'unconfirmed');
  assert.equal(ceilingUse([month(1,5)],table,false).status,'unconfirmed');
  assert.equal(ceilingUse([month(1,5,{uf:'XX'})],table,true).status,'unconfirmed');
  assert.equal(ceilingUse([month(1,5,{exercise:'partial'})],table,true).status,'unconfirmed');
});
test('tenths round half away from zero from exact sums',()=>{
  assert.equal(tenthsOf(1,8),125);assert.equal(tenthsOf(1,3),333);assert.equal(tenthsOf(2,3),667);assert.equal(tenthsOf(0,5),0);assert.equal(tenthsOf(5,1000),5);assert.equal(tenthsOf(4,1000),4);
  assert.equal(tenthsOf(1,2000),1);assert.equal(tenthsOf(-1,2000),-1);assert.equal(tenthsOf(-1,8),-125);assert.equal(tenthsOf(-1,3),-333);
});
test('only fully exercised months count; unknown, conflict and outside months with expenses leave the figure unconfirmed',()=>{
  for(const exercise of ['unknown','conflict',null])assert.equal(ceilingUse([month(1,5),month(2,5,{exercise})],table,true).status,'unconfirmed',String(exercise));
  const late=ceilingUse([month(1,5),month(2,5,{exercise:'outside'})],table,true);
  assert.equal(late.status,'unconfirmed');assert.deepEqual(late.outside,[]);
  assert.equal(ceilingUse([month(1,5),month(2,5,{ufStatus:'changed'})],table,true).status,'unconfirmed');
});
test('a negative month lowers the sum and the percent keeps its sign',()=>{
  const u=ceilingUse([month(1,4283733),month(2,-4283733*2)],table,true);
  assert.equal(u.status,'ok');if(u.status!=='ok')return;
  assert.equal(u.expenseCents,-4283733);assert.equal(u.tenths,-500);
});

type Spec={exercise:'full'|'partial'|'outside';uf:{status:'single'|'conflict';value:string|null};comparison:'unavailable'|'potential-conflict'};
const dim=(status:'single'|'conflict',value:string|null)=>({status,value,values:value?[value]:[],rows:[0]});
function ceilingOfCoverage(specs:Spec[],uf:string|null){
  const {report,audit}=made(),ceiling=buildSiteCeiling(report,audit,2025),months=specs.map((s,i)=>({year:2025,month:i+1,start:'',end:'',partialScope:s.exercise==='partial',exercise:s.exercise,party:dim('single','PL'),uf:dim(s.uf.status,s.uf.value),financialCollection:'not-collected' as const}));
  const t:TemporalReport={schema:'clareia.people-temporal.v1',ruleVersion:'camara.history-reported-change.v1',historySha256:hash('h'),scope:{legislature:57,start:'2025-01-01',end:'2025-03-31',sampleIds:[1]},createdAt:'2026-11-08T12:00:00Z',status:'review-required',publicAttributionEnabled:false,people:[{id:1,collectionStatus:'stable',events:[],intervals:[],months,issues:[]}]};
  const c:CrosscheckReport={schema:'clareia.people-crosscheck.v1',legacySha256:hash('l'),temporalSha256:hash(canonical(t)),historySha256:hash('h'),discoverySha256:hash('d'),scope:t.scope,createdAt:'2026-11-08T12:00:00Z',status:'review-required',publicAttributionEnabled:false,dateSemantics:'boundary-days-and-open-ends-unconfirmed',people:[{id:1,legacyStatus:'stable',partyComparisonStatus:'compared',partyChanges:[],months:specs.map((s,i)=>({year:2025,month:i+1,v2Exercise:s.exercise,legacy:'reported-exercise' as const,periodRows:[0],openEnd:false,comparison:s.comparison}))}]};
  const coverage=buildPeopleCoverage(t,c,{status:'passed',temporalSha256:hash(canonical(t))},'2026-11-08T13:00:00Z');
  const records=specs.map((_,i)=>({id:'r'+i,personId:1,year:2025,month:i+1,cents:1000,category:'C',supplier:'S',supplierId:'0',document:'d',date:'2025-0'+(i+1)+'-05T00:00:00',source:'x'} as unknown as Expense));
  const s=buildSiteSummary({publicationId:'p',scope:{year:2025,months:specs.map((_,i)=>i+1),ids:[1],legislature:57},people:[{...person,uf}],records,expectedTotalCents:specs.length*1000,coverageId:coverage.id,coverage:coverage.rows,ceiling});
  return ceilingUse(s.people[0].months,ceiling,true);
}
const single=(v:string):Spec['uf']=>({status:'single',value:v});
const full=(uf=single('RR'),comparison:Spec['comparison']='unavailable'):Spec=>({exercise:'full',uf,comparison});
test('a full month with no second source keeps its own UF and the ceiling counts it',()=>{
  const use=ceilingOfCoverage([full(),full(),full()],'RR');
  assert.equal(use.status,'ok');assert.deepEqual(use.counted.map(c=>c.uf),['RR','RR','RR']);
});
test('a full month the legacy source contradicts stays out and the figure is unconfirmed',()=>{
  const use=ceilingOfCoverage([full(),full(single('RR'),'potential-conflict'),full()],'RR');
  assert.equal(use.status,'unconfirmed');assert.deepEqual(use.counted.map(c=>c.month),[1,3]);
});
test('a month with its own conflicting UF is not counted, whatever the other months say',()=>{
  const use=ceilingOfCoverage([full(single('RJ')),full({status:'conflict',value:null}),full(single('RJ'))],'RJ');
  assert.equal(use.status,'unconfirmed');assert.deepEqual(use.counted.map(c=>c.month),[1,3]);
});
test('a partial month stays excluded from the ceiling even with a confirmed UF',()=>{
  const use=ceilingOfCoverage([full(),{...full(),exercise:'partial'},full()],'RR');
  assert.equal(use.status,'ok');assert.deepEqual(use.excluded,[{month:2,reason:'partial'}]);assert.deepEqual(use.counted.map(c=>c.month),[1,3]);
});
test('a review-outside month goes to missing, never outside or excluded, while a full review month with single UF still counts',()=>{
  const direct=ceilingUse([month(1,100000),month(2,0,{exercise:'outside',exerciseReview:true})],table,true);
  assert.equal(direct.status,'unconfirmed');if(direct.status!=='unconfirmed')return;
  assert.deepEqual(direct.missing,[2]);assert.deepEqual(direct.outside,[]);assert.deepEqual(direct.excluded,[]);
  const uncrossed=ceilingUse([month(1,100000,{exercise:'full',ufStatus:'single',exerciseReview:true})],table,true);
  assert.equal(uncrossed.status,'ok');if(uncrossed.status!=='ok')return;
  assert.deepEqual(uncrossed.counted.map(c=>c.month),[1]);
});

test('2024 and 2025 site ceilings keep the exact current shape with no new keys',()=>{
  for(const year of [2024,2025] as const){
    const {report,audit}=reportFor(year),site=buildSiteCeiling(report,audit,year),legacy=legacyCeilingReport(year);
    const expectedByUf=Object.fromEntries(Object.entries(ANNEX).sort(([a],[b])=>a<b?-1:1).map(([uf,v])=>[uf,new Array(12).fill(Number(v.replace(/\./g,'').replace(',','')))]));
    const expected={schema:'clareia.site-ceiling.v1' as const,year,unit:'monthly-ceiling-per-uf-cents' as const,act:legacy.rows[0].act,effectiveFrom:legacy.rows[0].effectiveFrom,actUrl:legacy.rows[0].actUrl,annexUrl:legacy.rows[0].annexUrl,reportSha256:legacyCeilingSha(year),byUf:expectedByUf};
    assert.deepEqual(site,expected);
    assert.deepEqual(Object.keys(site),Object.keys(expected));
    assert.equal('noCeilingMonths' in site,false);
    assert.equal('note' in site,false);
    assert.equal('sources' in site,false);
  }
});
test('2026 site ceiling carries noCeilingMonths, note, sources and keeps January official metadata at top level',()=>{
  const site=mixedCeiling2026();
  assert.equal(site.year,2026);
  assert.equal(site.act,CEILING_ACT);
  assert.equal(site.effectiveFrom,CEILING_EFFECTIVE_FROM);
  assert.equal(site.actUrl,CEILING_SOURCES.original);
  assert.equal(site.annexUrl,CEILING_SOURCES.consolidated);
  assert.deepEqual(site.noCeilingMonths,[2]);
  assert.equal(site.note,PORTAL_2026_NOTE);
  assert.deepEqual(site.sources,[
    {months:[1],act:CEILING_ACT,effectiveFrom:CEILING_EFFECTIVE_FROM,actUrl:CEILING_SOURCES.original,annexUrl:CEILING_SOURCES.consolidated,official:true},
    {months:[3,4,5,6,7,8,9,10,11,12],act:PORTAL_2026_ACT,effectiveFrom:PORTAL_2026_CAPTURED_AT,actUrl:PORTAL_2026_URL,annexUrl:PORTAL_2026_URL,official:false}
  ]);
  assert.equal(site.byUf.RO[0],4946629);
  assert.equal(site.byUf.RO[1],0);
  assert.equal(site.byUf.RO[2],5626790);
});
test('buildSiteCeiling rejects mixed acts outside 2026, missing months other than February 2026, and any missing month in 2024 or 2025',()=>{
  const ok=(r:CeilingReport)=>({status:'passed' as const,reportSha256:hash(canonical(r))});
  for(const year of [2024,2025]){
    const {report}=reportFor(year);
    const mixed:CeilingReport={...report,rows:report.rows.map((r,i)=>i?r:{...r,act:PORTAL_2026_ACT,effectiveFrom:PORTAL_2026_CAPTURED_AT,actUrl:PORTAL_2026_URL,annexUrl:PORTAL_2026_URL})};
    assert.throws(()=>buildSiteCeiling(mixed,ok(mixed),year),/atos diferentes/);
    const missingFeb:CeilingReport={...report,rows:report.rows.filter(r=>r.month!==2)};
    assert.throws(()=>buildSiteCeiling(missingFeb,ok(missingFeb),year),/incompleto/);
    const missingJan:CeilingReport={...report,rows:report.rows.filter(r=>!(r.uf==='AC'&&r.month===1))};
    assert.throws(()=>buildSiteCeiling(missingJan,ok(missingJan),year),/incompleto/);
  }
  const {report:r2026}=reportFor(2026);
  const missingMar:CeilingReport={...r2026,rows:r2026.rows.filter(r=>!(r.uf==='SP'&&r.month===3))};
  assert.throws(()=>buildSiteCeiling(missingMar,ok(missingMar),2026),/incompleto/);
  const missingJan2026:CeilingReport={...r2026,rows:r2026.rows.filter(r=>r.month!==1)};
  assert.throws(()=>buildSiteCeiling(missingJan2026,ok(missingJan2026),2026),/incompleto/);
});
test('ceilingUse with mixed 2026 fixture leaves February out on both sides and still rejects other months without a ceiling',()=>{
  const c2026=mixedCeiling2026();
  const u=ceilingUse([month(1,100000),month(2,9999999),month(3,200000)],c2026,true);
  assert.equal(u.status,'ok');if(u.status!=='ok')return;
  assert.deepEqual(u.counted.map(c=>c.month),[1,3]);
  assert.deepEqual(u.excluded,[{month:2,reason:'noCeiling'}]);
  assert.equal(u.expenseCents,300000);
  assert.equal(u.ceilingCents,c2026.byUf.SP[0]+c2026.byUf.SP[2]);
  assert.equal(u.tenths,tenthsOf(300000,c2026.byUf.SP[0]+c2026.byUf.SP[2]));
  const febOnly=ceilingUse([month(2,500000)],c2026,true);
  assert.equal(febOnly.status,'unconfirmed');
  assert.deepEqual(febOnly.excluded,[{month:2,reason:'noCeiling'}]);
  const otherZero={...c2026,byUf:{...c2026.byUf,SP:[...c2026.byUf.SP.slice(0,2),0,...c2026.byUf.SP.slice(3)]}};
  const unconfirmed=ceilingUse([month(1,100000),month(2,200000),month(3,300000)],otherZero,true);
  assert.equal(unconfirmed.status,'unconfirmed');if(unconfirmed.status!=='unconfirmed')return;
  assert.deepEqual(unconfirmed.missing,[3]);
  assert.deepEqual(unconfirmed.excluded,[{month:2,reason:'noCeiling'}]);
});
test('ceilingUse excludes configured no-ceiling months even when their UF is in conflict',()=>{
  const c2026=mixedCeiling2026();
  const u=ceilingUse([month(1,100000),month(2,9999999,{uf:null,ufStatus:'conflict'}),month(3,200000)],c2026,true);
  assert.equal(u.status,'ok');if(u.status!=='ok')return;
  assert.deepEqual(u.counted.map(c=>c.month),[1,3]);
  assert.deepEqual(u.excluded,[{month:2,reason:'noCeiling'}]);
  assert.equal(u.expenseCents,300000);
  assert.equal(u.ceilingCents,c2026.byUf.SP[0]+c2026.byUf.SP[2]);
  assert.equal(u.tenths,tenthsOf(300000,c2026.byUf.SP[0]+c2026.byUf.SP[2]));
  assert.equal(ceilingUse([month(1,100000),month(2,9999999,{exercise:'conflict',uf:null,ufStatus:'conflict'}),month(3,200000)],c2026,true).status,'unconfirmed');
});
