import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {canonical,hash,snapshotId} from '../src/model.ts';
import type {Expense} from '../src/model.ts';
import {ceilingReport,deriveCeiling} from '../src/cota-ceiling.ts';
import {auditCeiling} from '../src/cota-ceiling-audit.ts';
import {buildSiteCeiling} from '../src/ceiling-site.ts';
import {ceilingUse,compareUse,tenthsOf} from '../src/ceiling-use.ts';
import {buildSiteSummary} from '../src/site-summary.ts';
import {openDB} from '../src/store.ts';
import {publishDomain,recordDomainAudit} from '../src/publications.ts';
import {buildSite} from '../src/build-site.ts';
import {ceilingFiles,sourcesOf} from './fixtures/cota-ceiling.ts';

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
    const {report,audit}=made(),ceiling=buildSiteCeiling(report,audit,2025),{publicationId}=await buildSite(db,path.join(dir,'dist'),path.join(dir,'portraits'),{},ceiling);
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
test('a counted month without a confirmed UF ceiling is not confirmed, never zero',()=>{
  assert.equal(ceilingUse([month(1,5),month(2,5,{uf:null,ufStatus:'review'})],table,true).status,'unconfirmed');
  assert.equal(ceilingUse([month(1,5)],null,true).status,'unconfirmed');
  assert.equal(ceilingUse([month(1,5)],table,false).status,'unconfirmed');
  assert.equal(ceilingUse([month(1,5,{uf:'XX'})],table,true).status,'unconfirmed');
  assert.equal(ceilingUse([month(1,5,{exercise:'partial'})],table,true).status,'unconfirmed');
});
test('tenths round half up from exact sums and ordering compares exact fractions',()=>{
  assert.equal(tenthsOf(1,8),125);assert.equal(tenthsOf(1,3),333);assert.equal(tenthsOf(2,3),667);assert.equal(tenthsOf(0,5),0);assert.equal(tenthsOf(5,1000),5);assert.equal(tenthsOf(4,1000),4);
  const ok=(a:number,b:number)=>({status:'ok' as const,counted:[],excluded:[],outside:[],expenseCents:a,ceilingCents:b,tenths:tenthsOf(a,b)});
  assert.equal(compareUse(ok(1001,10000),ok(1000,10000)),-1);assert.equal(compareUse(ok(1,2),ok(2,4)),0);assert.equal(compareUse(ok(1,3),ok(1,2)),1);
});
