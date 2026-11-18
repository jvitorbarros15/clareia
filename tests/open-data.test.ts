import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {unzipSync} from 'fflate';
import {openDB} from '../src/store.ts';
import {publishDomain,recordDomainAudit} from '../src/publications.ts';
import {buildSite} from '../src/build-site.ts';
import {snapshotId,hash} from '../src/model.ts';
import type {Expense,Snapshot} from '../src/model.ts';
import {csv} from '../src/view.ts';
import {monthlyTables,quirkCounts} from '../src/open-data.ts';
import type {OpenData} from '../src/open-data.ts';

const record=(cents:number,personId:number,index:number,month:number,extra:Partial<Expense>={}):Expense=>({id:`r${personId}-${index}`,personId,year:2025,month,category:'TEST',supplier:'Fornecedor',supplierKey:'k',supplierVerified:true,documentId:'1',documentNumber:'1',date:null,receipt:null,cents,documentCents:null,disallowedCents:null,source:{url:'https://x',row:index,sha256:'a',fetchedAt:'2025-03-01T00:00:00Z'},...extra});
const version=(records:Expense[]):Snapshot=>{
  const total=records.reduce((n,r)=>n+r.cents,0);
  const body={metric:'test.metric',scope:{year:2025,months:[1,2,3],ids:[1,2],legislature:57},people:[1,2].map(id=>({id,name:'Pessoa '+id,photo:null,sourceUrl:'https://x',profileFetchedAt:'2025-03-01T00:00:00Z'})),records,validation:{totalCents:total,independentTotalCents:String(total),recordCount:records.length,stablePasses:2,sourceKind:'annual-api-union',heldCompetences:[],duplicateCompetences:[],duplicatePolicy:'x',limitations:[]},collectedAt:'2025-03-01T00:00:00Z',publishedAt:'2025-03-02T00:00:00Z'};
  return {...body,id:snapshotId(body)} as Snapshot;
};

test('monthly CSVs split the records by competence with the per-deputy header and every row once',()=>{
  const all=[record(100,1,0,1),record(200,1,1,2),record(300,2,2,1),record(400,2,3,3)];
  const tables=monthlyTables(all);
  assert.deepEqual(tables.map(t=>t.name),['despesas-2025-01.csv','despesas-2025-02.csv','despesas-2025-03.csv']);
  assert.equal(tables.reduce((n,t)=>n+t.records,0),all.length);
  const header=csv([]);
  for(const t of tables){
    assert.equal(t.text.split('\r\n')[0],header);
    assert.equal(t.text.split('\r\n').length-1,t.records);
  }
  assert.equal(tables[0].text,csv(all.filter(r=>r.month===1)));
});

test('quirk counts follow the definitions shown on the page',()=>{
  const all=[record(100,1,0,1,{date:'2025-01-05T00:00:00'}),record(-5,1,1,1,{date:'2025-02-05T00:00:00',supplierVerified:false,duplicateFlag:'possible'}),record(1,1,2,1,{supplier:'Fornecedor pessoa física'}),record(1,1,3,1,{supplier:'Nome não exibido pelo Clareia'})];
  assert.deepEqual(quirkCounts(all,[{personId:1},{personId:1},{personId:2}],{withheld:'Nome não exibido pelo Clareia',individual:'Fornecedor pessoa física'}),{records:4,noDate:2,monthDiffers:1,unverifiedSupplier:1,possibleDuplicates:1,heldMonths:3,heldPeople:2,negative:1,withheldNames:1,individualSuppliers:1});
});

test('the built open data files match the manifest, the per-deputy files and the zip',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-open-')),portraits=path.join(dir,'portraits'),db=await openDB(true);
  await fs.mkdir(portraits);
  try{
    const all=[record(100,1,0,1),record(200,1,1,2),record(300,2,2,1)],v=version(all);
    await publishDomain(db,'despesas',v);await recordDomainAudit(db,v.id,'passed',{checkedAt:'2025-03-02T00:00:00Z',status:'passed'});
    const dist=path.join(dir,'dist'),{publicationId}=await buildSite(db,dist,portraits),base=path.join(dist,'data',publicationId);
    const manifest=JSON.parse(await fs.readFile(path.join(base,'dados-abertos.json'),'utf8')) as OpenData;
    const months=manifest.files.filter(f=>f.kind==='month');
    assert.equal(months.reduce((n,f)=>n+f.records!,0),all.length);
    for(const f of manifest.files){const bytes=await fs.readFile(path.join(base,f.path));assert.equal(bytes.length,f.bytes,f.name);assert.equal(hash(bytes),f.sha256,f.name);}
    const header=(await fs.readFile(path.join(base,'deputados','1','despesas.csv'),'utf8')).split('\r\n')[0];
    for(const f of months)assert.equal((await fs.readFile(path.join(base,f.path),'utf8')).split('\r\n')[0],header);
    const zip=manifest.files.find(f=>f.kind==='zip')!,inside=unzipSync(await fs.readFile(path.join(base,zip.path)));
    assert.deepEqual(Object.keys(inside).sort(),months.map(f=>f.name).sort());
    for(const f of months)assert.ok(Buffer.from(inside[f.name]).equals(await fs.readFile(path.join(base,f.path))),f.name);
    assert.equal(manifest.quirks.records,all.length);
  }finally{await db.close();await fs.rm(dir,{recursive:true,force:true});}
});
