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
import {storePeopleCoverage} from '../src/people-publication.ts';
import type {PeopleCoverage} from '../src/people-publication.ts';
import {buildSiteSummary} from '../src/site-summary.ts';
import {canonical,hash} from '../src/model.ts';

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

const coverageVersion=(party:string|null,review=false):PeopleCoverage=>{
  const body={schema:'clareia.people-coverage.v1' as const,metric:'camara.people.monthly-coverage.v1' as const,scope:{legislature:57,start:'2025-01-01',end:'2025-01-31',sampleIds:[1]},temporalSha256:hash('t'),crosscheckSha256:hash('c'),collectedAt:'2026-11-08T12:00:00Z',rows:[1,2].map(personId=>({personId,year:2025,month:1,exercise:'full',partyStatus:review?'review':'single',party,partyValues:[],ufStatus:review?'review':'single',uf:party&&'SP',review,partialScope:false}))};
  return {...body,id:hash(canonical({schema:body.schema,metric:body.metric,scope:body.scope,rows:body.rows})),publishedAt:'2026-11-08T13:00:00Z'};
};
const summaryInput=(records:Expense[],expectedTotalCents:number)=>{const v=version(records);return {publicationId:v.id,scope:v.scope,people:v.people,records,expectedTotalCents,coverageId:null,coverage:[]};};
test('the site summary totals match the records in integer cents and carry no record rows',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0),record(250,1,1),record(-50,2,2)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const {publicationId}=await buildSite(db,dist,portraits),summary=await json(dist,'data',publicationId,'summary.json');
  assert.equal(summary.totalCents,300);assert.equal(summary.records,3);assert.deepEqual(summary.people.map((p:{cents:number})=>p.cents),[350,-50]);assert.equal(summary.people[0].months[0].records,2);
  assert.equal(JSON.stringify(summary).includes('r1-0'),false);
}));
test('without approved coverage the summary shows no party, and inactive coverage changes nothing',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  await storePeopleCoverage(db,coverageVersion('PL'));
  const {publicationId}=await buildSite(db,dist,portraits),month=(await json(dist,'data',publicationId,'summary.json')).people[0].months[0];
  assert.deepEqual([month.partyStatus,month.party,month.uf],['unavailable',null,null]);
}));
test('approved coverage supplies the party of the month and a disputed month stays without one',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const known=coverageVersion('PL');await storePeopleCoverage(db,known);await recordDomainAudit(db,known.id,'passed',report);
  let built=await buildSite(db,dist,portraits),summary=await json(dist,'data',built.publicationId,'summary.json');
  assert.equal(summary.coverageId,known.id);assert.deepEqual([summary.people[0].months[0].party,summary.people[0].months[0].uf],['PL','SP']);
  const disputed=coverageVersion(null,true);await storePeopleCoverage(db,disputed);await recordDomainAudit(db,disputed.id,'passed',report);
  built=await buildSite(db,dist,portraits);summary=await json(dist,'data',built.publicationId,'summary.json');
  assert.deepEqual([summary.people[0].months[0].party,summary.people[0].months[0].partyStatus,summary.people[0].months[0].review],[null,'review',true]);
}));
test('a summary that disagrees with the approved total or leaves the scope is refused',()=>{
  assert.throws(()=>buildSiteSummary(summaryInput([record(100,1,0)],101)),/total aprovado/);
  assert.throws(()=>buildSiteSummary(summaryInput([{...record(100,1,0),month:2}],100)),/recorte/);
});

test('tampered active coverage stops the build before the previous output is deleted',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const known=coverageVersion('PL');await storePeopleCoverage(db,known);await recordDomainAudit(db,known.id,'passed',report);
  await buildSite(db,dist,portraits);const before=await tree(dist);
  await db.query(`UPDATE people_coverage_v1 SET record=jsonb_set(record,'{party}','"XX"') WHERE publication_id=$1`,[known.id]);
  await assert.rejects(buildSite(db,dist,portraits),/difere da versão aprovada/);
  assert.deepEqual(await tree(dist),before);
}));

test('a build refused by its limits leaves the previous output in place',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  await buildSite(db,dist,portraits);const before=await tree(dist);
  await fs.writeFile(path.join(portraits,'1.jpg'),Buffer.alloc(11*1024*1024));
  await assert.rejects(buildSite(db,dist,portraits),/10 MiB/);assert.deepEqual(await tree(dist),before);
}));

test('approved bills reach the summary and an unapproved version does not',()=>setup(async(db,dist,portraits)=>{
  const {storeBillsVersion}=await import('../src/bills-publication.ts');
  const a=version([record(100,1,0)]);await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const body={schema:'clareia.bills-version.v1' as const,metric:'camara.bills.authorship.v1' as const,scope:{years:[2025],types:['PL']},bills:[],people:[{id:1,proposed:3,joint:1,coauthored:2,norms:0}]};
  const bills={...body,id:hash(canonical(body)),sources:[],collectedAt:'2026-11-09T00:00:00Z',publishedAt:'2026-11-09T00:00:00Z'};
  await storeBillsVersion(db,bills);
  let built=await buildSite(db,dist,portraits),summary=await json(dist,'data',built.publicationId,'summary.json');assert.equal(summary.billsId,null);assert.equal(summary.people[0].bills,null);
  await recordDomainAudit(db,bills.id,'passed',report);
  built=await buildSite(db,dist,portraits);summary=await json(dist,'data',built.publicationId,'summary.json');
  assert.deepEqual(summary.people.map((p:{bills:unknown})=>p.bills),[{proposed:3,joint:1,coauthored:2,norms:0},{proposed:0,joint:0,coauthored:0,norms:0}]);
}));

test('approved bills must cover the year shown on the site',()=>{
  const v=version([record(100,1,0)]),input={publicationId:v.id,scope:v.scope,people:v.people,records:v.records,expectedTotalCents:100,coverageId:null,coverage:[],billsId:'x',bills:[]};
  assert.throws(()=>buildSiteSummary({...input,billsYears:[2024]}),/não cobrem/);assert.equal(buildSiteSummary({...input,billsYears:[2025]}).billsYears[0],2025);
});

test('approved bills and votes produce a per-deputy activity file and held votes stay out',()=>setup(async(db,dist,portraits)=>{
  const {storeVotesVersion}=await import('../src/votes-publication.ts');
  const a=version([record(100,1,0)]);await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const vote=(id:string,issues:string[])=>({id,date:'2025-03-01',organ:'PLEN',approved:'1',kind:'merito' as const,description:'Aprovado o Projeto',objects:[{billId:5,title:'PL 5/2025',summary:null}],declared:{yes:1,no:0,other:0},observed:{Sim:1},ballots:1,issues});
  const ballots:[string,number,string][]=[['ok',1,'Sim'],['held',1,'Sim']],votes=[vote('held',['empty-ballot']),vote('ok',[])],meta={schema:'clareia.votes-version.v1' as const,metric:'camara.votes.nominal.v1' as const,scope:{years:[2025]}};
  const v={...meta,id:hash(canonical({schema:meta.schema,metric:meta.metric,scope:meta.scope,votes,ballotsSha256:hash(canonical(ballots))})),collectedAt:'2026-11-09T00:00:00Z',publishedAt:'2026-11-09T00:00:00Z',votes,ballots};
  await storeVotesVersion(db,v);await recordDomainAudit(db,v.id,'passed',report);
  const built=await buildSite(db,dist,portraits),activity=await json(dist,'data',built.publicationId,'atividade','1.json'),summary=await json(dist,'data',built.publicationId,'summary.json');
  assert.deepEqual(activity.votes.map((x:{id:string})=>x.id),['ok']);assert.deepEqual(activity.votes[0].matters,['PL 5/2025']);assert.deepEqual(summary.people[0].votes,{Sim:1});assert.equal(summary.people[0].votesHeld,1);assert.equal(JSON.stringify(activity).includes('cents'),false);
}));
