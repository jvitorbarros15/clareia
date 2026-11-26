import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDB} from '../src/store.ts';
import type {DB} from '../src/store.ts';
import {publishDomain,recordDomainAudit} from '../src/publications.ts';
import {buildSite} from '../src/build-site.ts';
import {snapshotId} from '../src/model.ts';
import type {Expense,Snapshot} from '../src/model.ts';
import {amendmentsReport} from '../src/amendments.ts';
import type {AmendmentAuthor,AmendmentLink,AuthorYear,Totals} from '../src/amendments.ts';
import {auditAmendmentsVersion,buildAmendmentsVersion,storeAmendmentsVersion} from '../src/amendments-publication.ts';
import type {ReviewedLink} from '../src/amendments-publication.ts';

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
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-amendments-site-')),portraits=path.join(dir,'portraits'),db=await openDB(true);
  await fs.mkdir(portraits);await fs.writeFile(path.join(portraits,'1.jpg'),'jpg');
  try{await task(db,path.join(dir,'dist'),portraits);}finally{await db.close();await fs.rm(dir,{recursive:true,force:true});}
}
const json=async(...parts:string[])=>JSON.parse(await fs.readFile(path.join(...parts),'utf8'));
async function tree(root:string,dir=root):Promise<Record<string,string>>{
  const out:Record<string,string>={};
  for(const e of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())Object.assign(out,await tree(root,full));else out[path.relative(root,full)]=(await fs.readFile(full)).toString('base64');}
  return out;
}
const totals=(rows:number,committed:number,liquidated:number,paid:number,carriedOver:number,carriedCancelled:number,carriedPaid:number):Totals=>({rows,committed,liquidated,paid,carriedOver,carriedCancelled,carriedPaid});
const yearOf=(destinations:Record<string,Totals>):AuthorYear=>{
  const sum=(k:keyof Totals)=>Object.values(destinations).reduce((n,t)=>n+t[k],0);
  return {rows:sum('rows'),committed:sum('committed'),liquidated:sum('liquidated'),paid:sum('paid'),carriedOver:sum('carriedOver'),carriedCancelled:sum('carriedCancelled'),carriedPaid:sum('carriedPaid'),destinations};
};
function makeAmendments(entries:{code:string;deputyId:number;years:Record<string,Record<string,Totals>>}[],known:Set<number>){
  const authors:AmendmentAuthor[]=entries.map(e=>({code:e.code,name:`Pessoa ${e.deputyId}`,names:[`Pessoa ${e.deputyId}`],years:Object.fromEntries(Object.entries(e.years).map(([y,d])=>[y,yearOf(d)]))}));
  const links:AmendmentLink[]=entries.map(e=>({code:e.code,name:`Pessoa ${e.deputyId}`,status:'proposed' as const,candidates:[e.deputyId]}));
  const totalRows=authors.reduce((n,a)=>n+Object.values(a.years).reduce((m,y)=>m+y.rows,0),0);
  const rep=amendmentsReport(2024,{authors,links,excluded:{},metrics:{rows:totalRows,selected:totalRows,individual:totalRows,unattributed:0,repeatedRows:0}},[],'2025-03-01T00:00:00Z');
  const audit={status:'passed',contentSha256:rep.contentSha256,checkedAt:'2025-03-02T00:00:00Z'};
  const reviews:ReviewedLink[]=entries.map(e=>({code:e.code,deputyId:e.deputyId,reviewer:'revisor-teste',reviewedAt:'2025-03-02T00:00:00Z',evidence:'evidencia-teste'}));
  return {report:rep,version:buildAmendmentsVersion(rep,audit,reviews,known,'2025-03-02T00:00:00Z')};
}
function runtimeCpf(base:string):string{
  const check=(d:string)=>{const r=[...d].reduce((n,c,i)=>n+Number(c)*(d.length+1-i),0)*10%11;return r===10?0:r;};
  const d1=check(base),d2=check(base+d1),all=base+d1+d2;
  return `${all.slice(0,3)}.${all.slice(3,6)}.${all.slice(6,9)}-${all.slice(9)}`;
}

test('amendments publish per-deputy files with separate measures, leave cota bytes unchanged and omit deputies without rows',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0),record(250,1,1),record(50,2,2)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const planWithout={defaultYear:2025,years:[{year:2025,publicationId:a.id,ceiling:null}]};
  const distWithout=dist+'-without';
  const builtWithout=await buildSite(db,distWithout,portraits,{approvedNames:[]},planWithout);
  const baseWithout=path.join(distWithout,'data',builtWithout.publicationId);
  await assert.rejects(fs.access(path.join(baseWithout,'emendas')));

  const {report:amReport,version:am}=makeAmendments([{code:'100',deputyId:1,years:{
    '2025':{'SP':totals(2,1000,800,700,100,20,30),'BA':totals(1,500,400,300,50,10,5)},
    '2024':{'RJ':totals(3,2000,1500,1200,300,40,60)}
  }}],new Set([1,2]));
  await storeAmendmentsVersion(db,am);
  const audited=await auditAmendmentsVersion(db,am.id,amReport);
  assert.equal(audited.status,'passed');
  await recordDomainAudit(db,am.id,'passed',audited);

  const built=await buildSite(db,dist,portraits,{approvedNames:[]},{...planWithout,amendments:{publicationId:am.id}});
  const base=path.join(dist,'data',built.publicationId);
  const rawDeputy=await fs.readFile(path.join(base,'emendas','1.json'),'utf8');
  const deputy=JSON.parse(rawDeputy);
  assert.deepEqual(Object.keys(deputy).sort(),['deputyId','publicationId','rows','schema']);
  assert.equal(deputy.schema,'clareia.amendments-deputy.v1');
  assert.equal(deputy.publicationId,am.id);
  assert.equal(deputy.deputyId,1);
  assert.deepEqual(deputy.rows,[
    {year:2024,destination:'RJ',rows:3,committed:2000,liquidated:1500,paid:1200,carriedOver:300,carriedCancelled:40,carriedPaid:60},
    {year:2025,destination:'BA',rows:1,committed:500,liquidated:400,paid:300,carriedOver:50,carriedCancelled:10,carriedPaid:5},
    {year:2025,destination:'SP',rows:2,committed:1000,liquidated:800,paid:700,carriedOver:100,carriedCancelled:20,carriedPaid:30}
  ]);
  for(const row of deputy.rows)assert.deepEqual(Object.keys(row).sort(),['carriedCancelled','carriedOver','carriedPaid','committed','destination','liquidated','paid','rows','year']);
  assert.equal(rawDeputy.includes('revisor-teste'),false);
  assert.equal(rawDeputy.includes('evidencia-teste'),false);
  assert.equal(rawDeputy.includes('"code"'),false);
  await assert.rejects(fs.access(path.join(base,'emendas','2.json')));

  for(const rel of [['summary.json'],['index.json'],['dados-abertos.json'],['deputados','1','despesas.json'],['deputados','2','despesas.json']]){
    assert.deepEqual(await fs.readFile(path.join(base,...rel)),await fs.readFile(path.join(baseWithout,...rel)));
  }
  const manifest=await json(dist,'manifest.json');
  assert.equal(manifest.domains.emendas.version,am.id);
  const builtWithoutAfter=await buildSite(db,distWithout,portraits,{approvedNames:[]},planWithout);
  await assert.rejects(fs.access(path.join(distWithout,'data',builtWithoutAfter.publicationId,'emendas')));
}));

test('unaudited, failed, withheld or wrong-domain amendments versions are refused',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const {report:amReport,version:am}=makeAmendments([{code:'100',deputyId:1,years:{'2025':{'SP':totals(1,100,0,0,0,0,0)}}}],new Set([1,2]));
  await storeAmendmentsVersion(db,am);
  const plan=(publicationId:string)=>({defaultYear:2025,years:[{year:2025,publicationId:a.id,ceiling:null}],amendments:{publicationId}});

  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},plan(am.id)),/Versão de emendas .* sem auditoria aprovada/);
  await recordDomainAudit(db,am.id,'failed',{checkedAt:'2025-03-02T00:00:00Z'});
  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},plan(am.id)),/Versão de emendas .* sem auditoria aprovada/);

  const audited=await auditAmendmentsVersion(db,am.id,amReport);
  await recordDomainAudit(db,am.id,'passed',audited);
  await db.query('INSERT INTO withheld_publications VALUES($1,$2)',[am.id,'test']);
  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},plan(am.id)),/Versão de emendas .* não encontrada/);
  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},plan(a.id)),/Versão de emendas .* não encontrada/);
}));

test('an amendment row for a deputy outside the site is refused',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)],[1,2]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const {report:amReport,version:am}=makeAmendments([{code:'999',deputyId:99,years:{'2025':{'SP':totals(1,100,0,0,0,0,0)}}}],new Set([1,2,99]));
  await storeAmendmentsVersion(db,am);
  const audited=await auditAmendmentsVersion(db,am.id,amReport);
  await recordDomainAudit(db,am.id,'passed',audited);

  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},{defaultYear:2025,years:[{year:2025,publicationId:a.id,ceiling:null}],amendments:{publicationId:am.id}}),/fora da montagem/);
}));

test('a CPF-shaped destination stops the build and leaves the existing output untouched',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const basePlan={defaultYear:2025,years:[{year:2025,publicationId:a.id,ceiling:null}]};
  await buildSite(db,dist,portraits,{approvedNames:[]},basePlan);
  const before=await tree(dist);

  const destination='Localidade '+runtimeCpf(['123','456','789'].join(''));
  const {report:amReport,version:am}=makeAmendments([{code:'100',deputyId:1,years:{'2025':{[destination]:totals(1,100,0,0,0,0,0)}}}],new Set([1,2]));
  await storeAmendmentsVersion(db,am);
  const audited=await auditAmendmentsVersion(db,am.id,amReport);
  await recordDomainAudit(db,am.id,'passed',audited);

  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},{...basePlan,amendments:{publicationId:am.id}}),/Identificador privado nas emendas de um deputado/);
  assert.deepEqual(await tree(dist),before);
}));
