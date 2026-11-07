import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDB} from '../src/store.ts';
import type {DB} from '../src/store.ts';
import {publishDomain,recordDomainAudit} from '../src/publications.ts';
import {buildSite,checkLimits} from '../src/build-site.ts';
import {personView} from '../src/view.ts';
import {snapshotId} from '../src/model.ts';
import type {Expense,Snapshot} from '../src/model.ts';

function record(cents:number,personId:number,index:number):Expense{
  return {id:`r${personId}-${index}`,personId,year:2025,month:1,category:'TEST',supplier:'Fornecedor',supplierKey:'k',supplierVerified:false,documentId:'1',documentNumber:'1',date:null,receipt:null,cents,documentCents:cents,disallowedCents:0,source:{url:'https://dadosabertos.camara.leg.br/api/v2/x',sha256:'s',row:index,fetchedAt:'2025-03-01T00:00:00Z'}};
}
function version(records:Expense[],ids=[1,2]):Snapshot{
  const total=records.reduce((n,r)=>n+r.cents,0);
  const body={metric:'test.metric',scope:{year:2025,months:[1],ids,legislature:57},people:ids.map(id=>({id,name:'Pessoa '+id,photo:null,sourceUrl:'https://x',profileFetchedAt:'2025-03-01T00:00:00Z'})),records,collectedAt:'2025-03-01T00:00:00Z',publishedAt:'2025-03-01T00:00:00Z',pages:[],validation:{stablePasses:2,recordCount:records.length,totalCents:total,independentTotalCents:String(total),duplicatePolicy:'x',limitations:[]}};
  return {...body,id:snapshotId(body)};
}
const report={checkedAt:'2025-03-02T00:00:00Z',status:'passed'};
async function setup(task:(db:DB,dir:string,portraits:string)=>Promise<void>){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-site-')),portraits=path.join(dir,'portraits'),db=await openDB(true);
  await fs.mkdir(portraits);await fs.writeFile(path.join(portraits,'1.jpg'),'jpg');
  try{await task(db,path.join(dir,'dist'),portraits);}finally{await db.close();await fs.rm(dir,{recursive:true,force:true});}
}
const json=async(...parts:string[])=>JSON.parse(await fs.readFile(path.join(...parts),'utf8'));
async function tree(root:string,dir=root):Promise<Record<string,string>>{
  const out:Record<string,string>={};
  for(const e of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())Object.assign(out,await tree(root,full));else out[path.relative(root,full)]=(await fs.readFile(full)).toString('base64');}
  return out;
}

test('totals in the generated files match the database',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0),record(250,1,1),record(50,2,2)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const {publicationId}=await buildSite(db,dist,portraits);
  const base=path.join(dist,'data',publicationId);
  const rows=await json(base,'deputados','1','despesas.json') as Expense[];
  assert.equal(rows.reduce((n,r)=>n+r.cents,0),350);
  assert.equal((await json(base,'deputados','2','despesas.json') as Expense[]).length,1);
  assert.equal((await json(base,'index.json')).validation.totalCents,400);
  const csv=await fs.readFile(path.join(base,'deputados','1','despesas.csv'),'utf8');
  assert.equal(csv.split('\r\n').length-1,2);
}));
test('the same publication produces identical bytes',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  await buildSite(db,dist,portraits);const first=await tree(dist);
  await buildSite(db,dist,portraits);
  assert.deepEqual(await tree(dist),first);
}));
test('a new publication gets a new data path',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]),b=version([record(200,1,0)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const first=await buildSite(db,dist,portraits);
  await publishDomain(db,'despesas',b);await recordDomainAudit(db,b.id,'passed',report);
  const second=await buildSite(db,dist,portraits);
  assert.notEqual(first.publicationId,second.publicationId);
}));
test('fails above 15000 files or with a file above 10 MiB',()=>{
  assert.throws(()=>checkLimits(15000,1),/arquivos/);
  assert.throws(()=>checkLimits(1,10*1024*1024+1),/MiB/);
  checkLimits(14999,10*1024*1024);
});
test('a record changed after the audit stops the build, whether in the JSON or in a column',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0),record(300,2,1)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  await db.query(`UPDATE expenses_v2 SET amount_cents=amount_cents+1 WHERE position=0`);
  await assert.rejects(buildSite(db,dist,portraits),/Colunas de expenses_v2 divergem/);
  await db.query(`UPDATE expenses_v2 SET amount_cents=amount_cents-1, person_id=2 WHERE position=0`);
  await assert.rejects(buildSite(db,dist,portraits),/Colunas de expenses_v2 divergem/);
  await db.query(`UPDATE expenses_v2 SET person_id=1, record=jsonb_set(record,'{cents}','101') WHERE position=0`);
  await assert.rejects(buildSite(db,dist,portraits),/diferem da versão aprovada/);
  await assert.rejects(fs.access(dist));
}));
test('without an approved publication nothing is generated',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);
  await publishDomain(db,'despesas',a);
  await assert.rejects(buildSite(db,dist,portraits),/Nenhuma versão aprovada/);
}));
test('a domain without a passing audit is absent from the manifest',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]),v=version([record(300,1,0)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  await publishDomain(db,'votacoes',v);await recordDomainAudit(db,v.id,'failed',report);
  await buildSite(db,dist,portraits);
  const manifest=await json(dist,'manifest.json');
  assert.deepEqual(Object.keys(manifest.domains),['despesas']);
  assert.equal(manifest.domains.despesas.version,a.id);
}));
test('a newer unaudited publication never reaches the site',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]),b=version([record(999,1,0)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  await publishDomain(db,'despesas',b);
  const {publicationId}=await buildSite(db,dist,portraits);
  assert.equal((await json(dist,'data',publicationId,'deputados','1','despesas.json'))[0].cents,100);
}));
test('a deputy without a file renders as unavailable, not zero',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const {publicationId}=await buildSite(db,dist,portraits);
  const base=path.join(dist,'data',publicationId),index=await json(base,'index.json');
  await assert.rejects(fs.access(path.join(base,'deputados','2','despesas.json')));
  assert.deepEqual(index.withoutData,[2]);
  assert.equal(personView(index,null,new URLSearchParams('person=2')),null);
  assert.equal(personView(index,await json(base,'deputados','1','despesas.json'),new URLSearchParams('person=1'))?.totalCents,100);
}));
test('portraits are versioned with the data and a missing one is simply absent',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0),record(100,2,1)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const {publicationId}=await buildSite(db,dist,portraits);
  await fs.access(path.join(dist,'data',publicationId,'portraits','1.jpg'));
  await assert.rejects(fs.access(path.join(dist,'data',publicationId,'portraits','2.jpg')));
}));
test('_headers marks data as immutable and manifest as revalidated',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  await buildSite(db,dist,portraits);
  const headers=await fs.readFile(path.join(dist,'_headers'),'utf8');
  assert.match(headers,/\/data\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers,/\/manifest\.json\s+Cache-Control: max-age=0, must-revalidate/);
  assert.match(headers,/Content-Security-Policy: default-src 'self'/);
  for(const file of ['index.html','app.js','view.js','styles.css'])await fs.access(path.join(dist,file));
}));
