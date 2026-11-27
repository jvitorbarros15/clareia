import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDB} from '../src/store.ts';
import type {DB} from '../src/store.ts';
import {publishDomain,recordDomainAudit} from '../src/publications.ts';
import {buildSite,checkLimits,dataFolderId} from '../src/build-site.ts';
import {snapshotId} from '../src/model.ts';
import type {Expense,Snapshot} from '../src/model.ts';
import {storePeopleCoverage} from '../src/people-publication.ts';
import type {PeopleCoverage} from '../src/people-publication.ts';
import {assertSuppliersMatchSummary,buildSiteSummary,buildSupplierSummary,withSupplierLabels} from '../src/site-summary.ts';
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
test('the data folder name is the same for identical builds and changes with any published byte',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const first=await buildSite(db,dist,portraits),second=await buildSite(db,dist,portraits);
  assert.equal(first.publicationId,second.publicationId);
  assert.deepEqual(await fs.readdir(path.join(dist,'data')),[first.publicationId]);
  assert.equal((await json(dist,'manifest.json')).base,`data/${first.publicationId}`);
  await fs.writeFile(path.join(portraits,'1.jpg'),'other jpg');
  assert.notEqual((await buildSite(db,dist,portraits)).publicationId,first.publicationId);
}));
test('dataFolderId depends on every file path and byte',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-hash-'));
  try{
    await fs.mkdir(path.join(dir,'sub'));await fs.writeFile(path.join(dir,'a.json'),'{}');await fs.writeFile(path.join(dir,'sub','b.json'),'1');
    const base=await dataFolderId(dir);
    assert.equal(await dataFolderId(dir),base);assert.match(base,/^[0-9a-f]{12}$/);
    await fs.writeFile(path.join(dir,'sub','b.json'),'2');const changed=await dataFolderId(dir);assert.notEqual(changed,base);
    await fs.rename(path.join(dir,'sub','b.json'),path.join(dir,'sub','c.json'));assert.notEqual(await dataFolderId(dir),changed);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
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
}));
test('portraits are versioned with the data and a missing one is simply absent',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0),record(100,2,1)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const {publicationId}=await buildSite(db,dist,portraits);
  await fs.access(path.join(dist,'data',publicationId,'portraits','1.jpg'));
  await assert.rejects(fs.access(path.join(dist,'data',publicationId,'portraits','2.jpg')));
}));
test('social links from the run reach people[] checked again, and without the run nothing changes',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0),record(100,2,1)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const plan=(social?:Record<string,unknown>)=>({defaultYear:2025,years:[{year:2025,publicationId:a.id,ceiling:null}],...social?{social}:{}});
  const without=await json(dist,'data',(await buildSite(db,dist,portraits,{},plan())).publicationId,'index.json');
  assert.ok(without.people.every((p:{social?:unknown})=>!('social' in p)));
  const index=await json(dist,'data',(await buildSite(db,dist,portraits,{},plan({'1':['https://www.instagram.com/p1','https://evil.test/x'],'2':['javascript:alert(1)']}))).publicationId,'index.json');
  assert.deepEqual(index.people.map((p:{social?:unknown})=>p.social),[[{network:'Instagram',url:'https://www.instagram.com/p1'}],undefined]);
  assert.equal(index.snapshotId,a.id);
}));
test('_headers marks data as immutable and manifest as revalidated',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  await buildSite(db,dist,portraits);
  const headers=await fs.readFile(path.join(dist,'_headers'),'utf8');
  assert.match(headers,/\/data\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers,/\/manifest\.json\s+Cache-Control: max-age=0, must-revalidate/);
  assert.match(headers,/Content-Security-Policy: default-src 'self'/);
  assert.match(headers,/Strict-Transport-Security: max-age=31536000; includeSubDomains\r?\n/);
  assert.doesNotMatch(headers,/Strict-Transport-Security:[^\n]*preload/);
  assert.match(headers,/Permissions-Policy: camera=\(\), microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\), browsing-topics=\(\)/);
  for(const file of ['app.js','portal.js','data.js','analytics.js','view.js','styles.css'])assert.match(headers,new RegExp(`\\n/${file.replace('.','\\.')}\\s+Cache-Control: max-age=0, must-revalidate`));
  assert.match(headers,/script-src 'self' https:\/\/static\.cloudflareinsights\.com;/);
  assert.match(headers,/connect-src 'self' https:\/\/cloudflareinsights\.com;/);
  for(const file of ['index.html','404.html','app.js','analytics.js','view.js','styles.css'])await fs.access(path.join(dist,file));
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
  assert.deepEqual([summary.people[0].months[0].party,summary.people[0].months[0].partyStatus],[null,'review']);
}));
test('a summary that disagrees with the approved total or leaves the scope is refused',()=>{
  assert.throws(()=>buildSiteSummary(summaryInput([record(100,1,0)],101)),/total aprovado/);
  assert.throws(()=>buildSiteSummary(summaryInput([{...record(100,1,0),month:2}],100)),/recorte/);
});
test('a held competence reaches the summary as held, never as a confirmed zero, and cannot carry records',()=>{
  const records=[record(100,1,0)],s=buildSiteSummary({...summaryInput(records,100),held:[{personId:2,month:1}]});
  assert.deepEqual(s.people.map((p:{months:{held:boolean;cents:number}[]})=>[p.months[0].held,p.months[0].cents]),[[false,100],[true,0]]);
  assert.throws(()=>buildSiteSummary({...summaryInput(records,100),held:[{personId:1,month:1}]}),/retida com registros/);
});
test('monthly cells and supplier rows add up to each person and carry no record rows',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0),record(250,1,1),{...record(-30,1,2),supplier:'Outro'},{...record(70,1,3),category:'ALFA'}]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const {publicationId}=await buildSite(db,dist,portraits),base=path.join(dist,'data',publicationId),summary=await json(base,'summary.json'),suppliers=await json(base,'fornecedores.json');
  assert.deepEqual(summary.categories,['ALFA','TEST']);
  assert.equal('cells' in summary.people[0],false);
  const built=buildSiteSummary(summaryInput(a.records,a.validation.totalCents));
  assert.deepEqual(built.people[0].cells,[[1,0,70,1],[1,1,320,3]]);
  assert.deepEqual(built.people[1].cells,[]);
  assert.deepEqual(suppliers.suppliers,['Nome não exibido pelo Clareia']);
  assert.deepEqual(suppliers.people['1'],[[1,0,0,70,1],[1,1,0,320,3]]);
  assert.deepEqual(suppliers.people['2'],[]);
  assert.equal(suppliers.publicationId,a.id);
  assert.equal(JSON.stringify(suppliers).includes('r1-0'),false);
}));
test('supplier rows that disagree with the monthly cells are refused',()=>{
  const records=[record(100,1,0),{...record(50,1,1),supplier:'Outro'}],summary=buildSiteSummary(summaryInput(records,150)),good=buildSupplierSummary(summary,records);
  const tampered=structuredClone(good);tampered.people['1'][0][3]+=1;
  assert.throws(()=>assertSuppliersMatchSummary(summary,tampered),/divergem das células/);
  const counted=structuredClone(good);counted.people['1'][1][4]+=1;
  assert.throws(()=>assertSuppliersMatchSummary(summary,counted),/divergem das células/);
  const missing=structuredClone(good);delete missing.people['2'];
  assert.throws(()=>assertSuppliersMatchSummary(summary,missing),/pessoas do resumo/);
  assert.throws(()=>assertSuppliersMatchSummary(summary,{...good,publicationId:'x'}),/outra versão/);
});
const K=(c:string)=>c.repeat(64),cnpj=(cents:number,i:number,supplier:string,date:string|null='2025-01-05',key=K('a')):Expense=>({...record(cents,1,i),supplier,supplierKey:key,supplierVerified:true,date});
const supplierNamesOf=(records:Expense[],names={})=>buildSupplierSummary(buildSiteSummary(summaryInput(records,records.reduce((n,r)=>n+r.cents,0))),records,names).suppliers;
test('a CNPJ with many spellings is one supplier named by its most frequent spelling, and an override wins',()=>{
  const records=[cnpj(100,0,'TAM','2025-01-05T10:00:00'),cnpj(200,1,'LATAM Airlines Brasil','2025-01-20T10:00:00'),cnpj(300,2,'Cia Aérea - TAM','2025-01-10T10:00:00'),cnpj(50,3,'TAM','2025-01-11T10:00:00')],summary=buildSiteSummary(summaryInput(records,650));
  const grouped=buildSupplierSummary(summary,records);
  assert.deepEqual(grouped.suppliers,['TAM']);
  assert.deepEqual(grouped.people['1'],[[1,0,0,650,4]]);
  assert.deepEqual(withSupplierLabels(records).map(r=>r.supplierLabel),[undefined,'TAM','TAM',undefined]);
  assert.deepEqual(buildSupplierSummary(summary,records,{[K('a')]:{name:'Latam'}}).suppliers,['Latam']);
});
test('the display name falls back by records, absolute value, date and then alphabet, and a single-spelling CNPJ gets no label',()=>{
  assert.deepEqual(supplierNamesOf([cnpj(1000,0,'ONE'),cnpj(10,1,'TWO'),cnpj(10,2,'TWO')]),['TWO']);
  assert.deepEqual(supplierNamesOf([cnpj(-500,0,'EMPRESA LTDA'),cnpj(-100,1,'EMPRESA LTDA'),cnpj(10,2,'FULANO DE TAL')]),['EMPRESA LTDA']);
  assert.deepEqual(supplierNamesOf([cnpj(-500,0,'S1'),cnpj(100,1,'S2')]),['S1']);
  assert.deepEqual(supplierNamesOf([cnpj(100,0,'OLD','2025-01-01'),cnpj(100,1,'NEW','2025-02-01')]),['NEW']);
  assert.deepEqual(supplierNamesOf([cnpj(100,0,'B'),cnpj(100,1,'A')]),['A']);
  const one=[cnpj(100,0,'SOZINHO'),cnpj(100,1,'SOZINHO')];
  assert.ok(withSupplierLabels(one).every(r=>!('supplierLabel' in r)));
});
test('the same name under two CNPJs stays two suppliers numbered by key, a typed-name entry keeps the plain name, and a person is one line',()=>{
  const posto=(cents:number,i:number,key:string)=>cnpj(cents,i,'POSTO',null,key),person=(cents:number,i:number):Expense=>({...record(cents,1,i),supplier:'Fornecedor pessoa física',supplierKey:'p'+i});
  const records=[posto(100,0,K('a')),posto(300,1,K('b')),{...record(50,1,2),supplier:'POSTO'},person(10,3),person(20,4)],summary=buildSiteSummary(summaryInput(records,480));
  const grouped=buildSupplierSummary(summary,records);
  assert.deepEqual(grouped.suppliers,['Fornecedor pessoa física','POSTO','POSTO · 2','POSTO · 3']);
  assert.deepEqual(grouped.people['1'],[[1,0,0,30,2],[1,0,1,50,1],[1,0,2,100,1],[1,0,3,300,1]]);
  assert.deepEqual(withSupplierLabels(records).map(r=>r.supplierLabel),['POSTO · 2','POSTO · 3',undefined,undefined,undefined]);
  const taken=[posto(100,0,K('a')),posto(100,1,K('b')),{...record(50,1,2),supplier:'POSTO · 2'}];
  assert.deepEqual(supplierNamesOf(taken),['POSTO','POSTO · 2','POSTO · 3']);
});
test('reviewed names with a bad key or a clash with another supplier are refused',()=>{
  const records=[cnpj(100,0,'A',null,K('a')),cnpj(100,1,'B',null,K('b')),{...record(50,1,2),supplier:'Latam'}];
  assert.throws(()=>supplierNamesOf(records,{x:{name:'Z'}}),/Chave de nome/);
  assert.throws(()=>supplierNamesOf(records,{[K('a')]:{name:'Z'},[K('b')]:{name:'Z'}}),/colide/);
  assert.throws(()=>supplierNamesOf(records,{[K('a')]:{name:'Latam'}}),/colide/);
  assert.throws(()=>supplierNamesOf(records,{[K('b')]:{name:'A'}}),/colide/);
});
test('supplier checks refuse a CPF in a name',()=>{
  const records=[cnpj(100,0,'A',null,K('a')),{...record(50,1,1),supplier:'Outro'}],summary=buildSiteSummary(summaryInput(records,150)),good=buildSupplierSummary(summary,records);
  assert.throws(()=>assertSuppliersMatchSummary(summary,{...good,suppliers:['Fornecedor','Fulano 123.456.789-09']}),/Identificador privado/);
});
test('a private supplier keeps its label in the supplier file',()=>setup(async(db,dist,portraits)=>{
  const a=version([{...record(100,1,0),supplier:'Fornecedor pessoa física'}]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const {publicationId}=await buildSite(db,dist,portraits);
  assert.deepEqual((await json(dist,'data',publicationId,'fornecedores.json')).suppliers,['Fornecedor pessoa física']);
}));

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

const activityVote={id:'ok',date:'2025-01-15',organ:'PLEN',approved:'1',kind:'merito' as const,description:'Aprovado o Projeto',objects:[{billId:5,title:'PL 5/2025',summary:null}],declared:{yes:1,no:0,other:0},observed:{Sim:1},ballots:1,issues:[]};
const activityVotes=[{...activityVote,id:'held',issues:['empty-ballot']},activityVote,{...activityVote,id:'nobill',objects:[]}];
const activityBallots:[string,number,string][]=[['ok',1,'Sim'],['held',1,'Sim'],['nobill',1,'Sim']];
const activityVotesMeta={schema:'clareia.votes-version.v1' as const,metric:'camara.votes.nominal.v1' as const,scope:{years:[2025]}};
const activityVotesVersion={...activityVotesMeta,id:hash(canonical({...activityVotesMeta,votes:activityVotes,ballotsSha256:hash(canonical(activityBallots))})),collectedAt:'2026-11-09T00:00:00Z',publishedAt:'2026-11-09T00:00:00Z',votes:activityVotes,ballots:activityBallots};

test('approved bills and votes produce a per-deputy activity file and held votes stay out',()=>setup(async(db,dist,portraits)=>{
  const {storeVotesVersion}=await import('../src/votes-publication.ts');
  const a=version([record(100,1,0)]);await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const v=activityVotesVersion;
  await storeVotesVersion(db,v);await recordDomainAudit(db,v.id,'passed',report);
  const built=await buildSite(db,dist,portraits),activity=await json(dist,'data',built.publicationId,'atividade','1.json'),summary=await json(dist,'data',built.publicationId,'summary.json');
  assert.deepEqual(activity.votes.map((x:{id:string})=>x.id),['nobill','ok']);assert.deepEqual(activity.votes[1].matters,['PL 5/2025']);assert.equal(activity.votes[1].billId,5);assert.equal(activity.votes[0].billId,null);assert.deepEqual(summary.people[0].votes,{Sim:2});assert.equal(summary.people[0].votesHeld,1);assert.equal(JSON.stringify(activity).includes('cents'),false);
}));
test('active votes and people coverage publish party votes without changing deputy activity',()=>setup(async(db,dist,portraits)=>{
  const {storeVotesVersion}=await import('../src/votes-publication.ts');
  const a=version([record(100,1,0)]);await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  await storeVotesVersion(db,activityVotesVersion);await recordDomainAudit(db,activityVotesVersion.id,'passed',report);
  const before=path.join(dist,'data',(await buildSite(db,dist,portraits)).publicationId);
  await assert.rejects(fs.access(path.join(before,'votacoes')),{code:'ENOENT'});
  const activity=await tree(path.join(before,'atividade'));

  const coverage=coverageVersion('PL');await storePeopleCoverage(db,coverage);await recordDomainAudit(db,coverage.id,'passed',report);
  const after=path.join(dist,'data',(await buildSite(db,dist,portraits)).publicationId),dir=path.join(after,'votacoes');
  const {id,date,description,declared,approved}=activityVote;
  const entry={id,date,description,objects:[{billId:5,title:'PL 5/2025'}],declared,approved,matchesDeclared:true};
  assert.deepEqual(await json(dir,'index.json'),{schema:'clareia.party-votes-index.v1',votes:[{...entry,id:'nobill',objects:[]},entry]});
  assert.deepEqual((await fs.readdir(dir)).sort(),['index.json','nobill.json','ok.json']);
  assert.deepEqual(await json(dir,'ok.json'),{...entry,differences:{yes:0,no:0,other:0},rows:[
    {party:'PL',label:'PL',counts:{Sim:1,semVoto:1},deputies:[{id:1,category:'Sim'},{id:2,category:null}]}
  ]});
  assert.deepEqual(await tree(path.join(after,'atividade')),activity);

  const unsafeVotes=[{...activityVote,id:'../outside'}];
  const unsafe={...activityVotesVersion,votes:unsafeVotes,ballots:[],id:hash(canonical({...activityVotesMeta,votes:unsafeVotes,ballotsSha256:hash(canonical([]))}))};
  await storeVotesVersion(db,unsafe);await recordDomainAudit(db,unsafe.id,'passed',report);
  await assert.rejects(buildSite(db,dist,portraits),/Identificador de votação inválido para publicação/);
}));
test('only a verified supplier publishes its supplier key',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0),{...record(250,1,1),supplierVerified:true,supplierKey:'verified-key'}]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const {publicationId}=await buildSite(db,dist,portraits);
  const rows=await json(path.join(dist,'data',publicationId),'deputados','1','despesas.json') as Expense[];
  assert.equal('supplierKey' in rows.find(r=>!r.supplierVerified)!,false);
  assert.equal(rows.find(r=>r.supplierVerified)!.supplierKey,'verified-key');
}));
const CPF='11144477735';
async function published(change:Partial<Expense>){
  let out:{rows:Expense[];review:{id:number;from:string;used:string}[];csv:string}={rows:[],review:[],csv:''};
  await setup(async(db,dist,portraits)=>{
    const a=version([{...record(100,1,0),id:'old',...change}]);
    await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
    const built=await buildSite(db,dist,portraits),base=path.join(dist,'data',built.publicationId);
    out={rows:await json(base,'deputados','1','despesas.json') as Expense[],review:built.years[0].review,csv:await fs.readFile(path.join(base,'deputados','1','despesas.csv'),'utf8')};
  });
  return out;
}
test('every published id is rebuilt from the redacted record, never from the stored id or a CPF in the free text',async()=>{
  const a=await published({documentNumber:'NF '+CPF}),b=await published({documentNumber:'NF 52998224725'});
  assert.equal(a.rows[0].id,b.rows[0].id);assert.notEqual(a.rows[0].id,'old');assert.match(a.rows[0].id,/^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(a.rows).includes(CPF)&&!a.csv.includes(CPF));assert.ok(a.csv.includes(a.rows[0].id));
  const v=await published({supplierVerified:true,supplierKey:'k',supplier:'EMPRESA'}),w=await published({supplierVerified:true,supplierKey:'k',supplier:'OUTRA'});
  assert.equal(v.rows[0].id,w.rows[0].id);assert.notEqual(v.rows[0].id,'old');assert.equal(v.rows[0].supplierKey,'k');
});
test('an unverified record publishes neither its supplier key nor its page hash; a verified one keeps both',async()=>{
  const u=(await published({})).rows[0],v=(await published({supplierVerified:true,supplierKey:'k'})).rows[0];
  assert.ok(!('supplierKey' in u)&&!('sha256' in u.source));assert.equal(v.supplierKey,'k');assert.equal(v.source.sha256,'s');
});
test('a supplier id outside the format reaches the review list by deputy count and not the site',async()=>{
  const r=await published({supplierIdOdd:true});
  assert.deepEqual(r.review.filter(i=>i.from==='identificador do fornecedor fora do formato').map(i=>[i.id,i.used]),[[1,'1 registros']]);
  assert.ok(!('supplierIdOdd' in r.rows[0]));
});
test('two unverified records that would share a published id stop the build',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0),{...record(100,1,1),source:record(100,1,0).source}]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  await assert.rejects(buildSite(db,dist,portraits),/repetido/);
}));
test('a record without an identified supplier cannot carry a receipt link',()=>setup(async(db,dist,portraits)=>{
  const a=version([{...record(100,1,0),supplier:'Nome não exibido pelo Clareia',receipt:'https://www.camara.leg.br/x.pdf'}]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  await assert.rejects(buildSite(db,dist,portraits),/recibo/);
}));

test('an unverified typed name is withheld at build unless it looks like a company or the owner approved it; verified records are untouched',()=>setup(async(db,dist,portraits)=>{
  const url='https://www.camara.leg.br/x.pdf',named=(i:number,supplier:string,more:Partial<Expense>={})=>({...record(100,1,i),supplier,receipt:url,documentId:'D'+i,...more});
  const a=version([named(0,'MARIA TESTE'),named(1,'EMPRESA TESTE LTDA'),named(2,'JOSE TESTE'),named(3,'JOAO CASA'),named(4,'MARIA TESTE'),named(5,'OUTRA PESSOA',{supplierVerified:true,supplierKey:'k'})]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  {
    const built=await buildSite(db,dist,portraits,{approvedNames:['JOAO CASA']}),base=path.join(dist,'data',built.publicationId),rows=await json(base,'deputados','1','despesas.json') as Expense[],by=(i:number)=>rows.find(r=>r.documentId==='D'+i)!;
    assert.deepEqual([0,1,2,3,5].map(i=>by(i).supplier),['Nome não exibido pelo Clareia','EMPRESA TESTE LTDA','Nome não exibido pelo Clareia','JOAO CASA','OUTRA PESSOA']);
    assert.deepEqual([0,1,2,3,5].map(i=>by(i).receipt),[null,url,null,url,url]);
    const text=await fs.readFile(path.join(base,'fornecedores.json'),'utf8')+await fs.readFile(path.join(base,'deputados','1','despesas.csv'),'utf8')+JSON.stringify(rows);
    assert.ok(!text.includes('MARIA TESTE')&&!text.includes('JOSE TESTE')&&text.includes('OUTRA PESSOA'));
    assert.deepEqual(built.years[0].names.withheld,[{name:'MARIA TESTE',count:2,cents:200},{name:'JOSE TESTE',count:1,cents:100}]);
    assert.deepEqual(built.years[0].names.kept,[{name:'EMPRESA TESTE LTDA',count:1,cents:100}]);
    const {reviewMarkdown}=await import('../src/review-list.ts'),md=reviewMarkdown(built.publicationId,built.years[0].review,built.years[0].names);
    assert.match(md,/## Nomes de fornecedor ocultados\s+- MARIA TESTE \| 2 registros \| R\$ 2\.00\s+- JOSE TESTE \| 1 registros \| R\$ 1\.00/);
    assert.match(md,/## Nomes mantidos pela regra de empresa\s+- EMPRESA TESTE LTDA \| 1 registros/);
  }
}));
test('identical flagged rows keep distinct public ids, the flag and the CSV column, and their withheld name',()=>setup(async(db,dist,portraits)=>{
  const row=(i:number)=>({...record(100,1,i),supplier:'MARIA TESTE',documentId:'D',duplicateFlag:'possible' as const,id:hash('same-'+i)});
  const a=version([row(0),row(1),row(2)]);await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const built=await buildSite(db,dist,portraits,{approvedNames:[]}),base=path.join(dist,'data',built.publicationId),rows=await json(base,'deputados','1','despesas.json') as Expense[];
  assert.equal(new Set(rows.map(r=>r.id)).size,3);assert.ok(rows.every(r=>r.duplicateFlag==='possible'&&r.supplier==='Nome não exibido pelo Clareia'));
  const lines=(await fs.readFile(path.join(base,'deputados','1','despesas.csv'),'utf8')).split('\r\n');assert.match(lines[0],/;"sinal_corrigido";"possivel_duplicidade"$/);assert.match(lines[1],/;"";"sim"$/);
}));

const yearVersion=(year:number,months:number[],records:Expense[],ids=[1,2],collectedAt='2025-03-01T00:00:00Z'):Snapshot=>{
  const total=records.reduce((n,r)=>n+r.cents,0),body={metric:'test.metric',scope:{year,months,ids,legislature:57},people:ids.map(id=>({id,name:'Pessoa '+id,photo:null,sourceUrl:'https://x',profileFetchedAt:'2025-03-01T00:00:00Z'})),records,collectedAt,publishedAt:'2025-03-01T00:00:00Z',pages:[],validation:{stablePasses:2,recordCount:records.length,totalCents:total,independentTotalCents:String(total),duplicatePolicy:'x',limitations:[]}};
  return {...body,id:snapshotId(body)};
};
const approve=async(db:DB,v:Snapshot)=>{await publishDomain(db,'despesas',v);await recordDomainAudit(db,v.id,'passed',report);};

// The real-data rehearsal proved the one-year site is byte-identical to the live build; this checks the one-year layout and manifest.
test('a one-year build keeps the single-year layout and manifest',()=>setup(async(db,dist,portraits)=>{
  const records=[record(100,1,0),record(250,1,1),record(50,2,2),record(70,2,3)].map((r,i)=>i===1?{...r,month:2}:i===3?{...r,month:2,supplier:'EMPRESA TESTE LTDA'}:r);
  const a=yearVersion(2025,[1,2],records,[1,2,3]);await approve(db,a);
  const built=await buildSite(db,dist,portraits,{approvedNames:[]});
  assert.match(built.publicationId,/^[0-9a-f]{12}$/);
  const manifest=await json(dist,'manifest.json');
  assert.deepEqual(Object.keys(manifest),['base','domains','defaultYear','years']);
  assert.equal(manifest.base,'data/'+built.publicationId);assert.equal(manifest.defaultYear,2025);
  assert.deepEqual(manifest.years,[{year:2025,months:[1,2],partial:true,collectedAt:a.collectedAt,expenses:a.id,totalCents:470,records:4}]);
  assert.deepEqual(manifest.domains.despesas.version,a.id);
  const base=path.join(dist,'data',built.publicationId);
  assert.deepEqual((await fs.readdir(base)).sort(),['abertos','dados-abertos.json','deputados','fornecedores.json','index.json','legislatura.json','portraits','summary.json']);
  assert.equal(built.years.length,1);
}));
test('two years write the extra year under its own folder with its own totals',()=>setup(async(db,dist,portraits)=>{
  const a=yearVersion(2025,[1],[record(100,1,0),record(50,2,1)],[1,2],'2025-06-01T00:00:00Z'),b=yearVersion(2026,[1,2,3],[{...record(700,1,0),year:2026},{...record(300,3,1),year:2026,month:2},{...record(11,3,2),year:2026,month:3}],[1,3],'2026-06-15T00:00:00Z');
  await fs.writeFile(path.join(portraits,'3.jpg'),'jpg3');
  await approve(db,b);await approve(db,a);
  const {storeBillsVersion}=await import('../src/bills-publication.ts');
  const bill={id:9,type:'PL',number:9,year:2026,summary:'Ementa',situation:'x',situationAt:null,norm:null,authors:[{deputyId:3,proponent:true}],otherProponents:0,issues:[]},bodyBills={schema:'clareia.bills-version.v1' as const,metric:'camara.bills.authorship.v1' as const,scope:{years:[2025,2026],types:['PL']},bills:[bill],people:[1,2,3].map(id=>({id,proposed:id===3?1:0,joint:0,coauthored:0,norms:0}))};
  const bills={...bodyBills,id:hash(canonical(bodyBills)),sources:[],collectedAt:'2026-11-09T00:00:00Z',publishedAt:'2026-11-09T00:00:00Z'};
  await storeBillsVersion(db,bills as never);await recordDomainAudit(db,bills.id,'passed',report);
  const plan={defaultYear:2025,years:[{year:2026,publicationId:b.id,ceiling:null},{year:2025,publicationId:a.id,ceiling:null}]};
  const built=await buildSite(db,dist,portraits,{shareImages:false,approvedNames:[]},plan),base=path.join(dist,'data',built.publicationId);
  assert.equal((await json(base,'summary.json')).publicationId,a.id);
  assert.equal((await json(base,'index.json')).validation.totalCents,150);
  assert.equal((await json(base,'2026','summary.json')).publicationId,b.id);
  assert.equal((await json(base,'2026','index.json')).validation.totalCents,1011);
  assert.equal((await json(base,'2026','deputados','3','despesas.json') as Expense[]).length,2);
  assert.equal((await json(base,'2026','dados-abertos.json')).year,2026);
  await assert.rejects(fs.access(path.join(base,'deputados','3')));
  await assert.rejects(fs.access(path.join(base,'2025')));
  const manifest=await json(dist,'manifest.json');
  assert.equal(manifest.defaultYear,2025);assert.equal(manifest.domains.despesas.version,a.id);
  assert.deepEqual(manifest.years,[{year:2025,months:[1],partial:true,collectedAt:a.collectedAt,expenses:a.id,totalCents:150,records:2},{year:2026,months:[1,2,3],partial:true,collectedAt:b.collectedAt,expenses:b.id,totalCents:1011,records:3}]);
  assert.deepEqual(built.years.map(y=>y.year),[2025,2026]);
  const prerendered=await fs.readdir(path.join(dist,'deputado'));
  assert.deepEqual(prerendered.filter(f=>/^[13]-/.test(f)).map(f=>f[0]).sort(),['1','3']);
  const extraPage=await fs.readFile(path.join(dist,'deputado',prerendered.find(f=>f.startsWith('3-'))!),'utf8');
  assert.match(extraPage,/Jan–Mar 2026/);
  assert.doesNotMatch(extraPage,/share\//);
  // portraits and activity are shared across years and keyed by the union of people
  assert.deepEqual((await fs.readdir(path.join(base,'portraits'))).sort(),['1.jpg','3.jpg']);
  assert.deepEqual((await fs.readdir(path.join(base,'atividade'))).sort(),['1.json','2.json','3.json']);
  assert.equal((await json(base,'atividade','3.json')).bills[0].id,9);
  const folderWith=await dataFolderId(path.join(dist,'data',built.publicationId));assert.equal(folderWith,built.publicationId);
}));
test('the default year must be the active version and every named year must be approved and of its year',()=>setup(async(db,dist,portraits)=>{
  const a=yearVersion(2025,[1],[record(100,1,0)]),b=yearVersion(2026,[1],[{...record(100,1,0),year:2026}]);
  await approve(db,a);await approve(db,b);
  const years=(x:Snapshot,y:Snapshot)=>[{year:2025,publicationId:x.id,ceiling:null},{year:2026,publicationId:y.id,ceiling:null}];
  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},{defaultYear:2025,years:years(a,b)}),/não é a do ano padrão/);
  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},{defaultYear:2027,years:years(a,b)}),/Ano padrão 2027/);
  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},{defaultYear:2025,years:years(b,a)}),/é de 2026, não de 2025/);
  const c=yearVersion(2025,[1,2],[record(100,1,0)]);await publishDomain(db,'despesas',c);
  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},{defaultYear:2026,years:[{year:2025,publicationId:c.id,ceiling:null},{year:2026,publicationId:b.id,ceiling:null}]}),/sem auditoria aprovada/);
}));
test('an extra year whose version is withheld is refused even with a passed audit',()=>setup(async(db,dist,portraits)=>{
  const a=yearVersion(2025,[1],[record(100,1,0)]),b=yearVersion(2026,[1],[{...record(100,1,0),year:2026}]);
  await approve(db,b);await approve(db,a);
  await db.query('INSERT INTO withheld_publications VALUES($1,$2)',[b.id,'test']);
  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},{defaultYear:2025,years:[{year:2025,publicationId:a.id,ceiling:null},{year:2026,publicationId:b.id,ceiling:null}]}),/não encontrada/);
}));
test('a review-outside month keeps totals unchanged, falls back on old coverage rows and updates the deputy page description',()=>setup(async(db,dist,portraits)=>{
  const a=yearVersion(2025,[1,2],[record(100,1,0),record(50,2,1)]);
  await approve(db,a);
  const makeCoverage=(withReview:boolean,omitField=false):PeopleCoverage=>{
    const rows=[1,2].flatMap(personId=>[1,2].map(month=>{
      const disputed=personId===1&&month===2&&withReview;
      const base={personId,year:2025,month,exercise:personId===1&&month===2?'outside':'full',partyStatus:disputed?'review':'single',party:disputed?null:'PL',partyValues:[],ufStatus:disputed?'review':personId===1&&month===2?'not-applicable':'single',uf:disputed||personId===1&&month===2?null:'SP',review:disputed,partialScope:false};
      return omitField?base:{...base,exerciseReview:disputed};
    }));
    const body={schema:'clareia.people-coverage.v1' as const,metric:'camara.people.monthly-coverage.v1' as const,scope:{legislature:57,start:'2025-01-01',end:'2025-02-28',sampleIds:[1,2]},temporalSha256:hash('t'+withReview+omitField),crosscheckSha256:hash('c'),collectedAt:'2026-11-08T12:00:00Z',rows};
    return {...body,id:hash(canonical({schema:body.schema,metric:body.metric,scope:body.scope,rows:body.rows})),publishedAt:'2026-11-08T13:00:00Z'};
  };
  const plain=buildSiteSummary({publicationId:a.id,scope:a.scope,people:a.people,records:a.records,expectedTotalCents:a.validation.totalCents,coverageId:'p',coverage:makeCoverage(false).rows});
  const flagged=buildSiteSummary({publicationId:a.id,scope:a.scope,people:a.people,records:a.records,expectedTotalCents:a.validation.totalCents,coverageId:'f',coverage:makeCoverage(true).rows});
  const legacy=buildSiteSummary({publicationId:a.id,scope:a.scope,people:a.people,records:a.records,expectedTotalCents:a.validation.totalCents,coverageId:'l',coverage:makeCoverage(true,true).rows});
  assert.equal(flagged.totalCents,plain.totalCents);
  assert.deepEqual(flagged.people.map(p=>p.cents),plain.people.map(p=>p.cents));
  assert.deepEqual(flagged.people[0].exerciseReviewMonths,[2]);
  assert.equal(flagged.people[0].comparable,false);
  assert.deepEqual(legacy.people[0].exerciseReviewMonths,[2]);
  assert.equal(legacy.people[0].months[1].exerciseReview,true);
  const cov=makeCoverage(true);await storePeopleCoverage(db,cov);await recordDomainAudit(db,cov.id,'passed',report);
  await buildSite(db,dist,portraits);
  const html=await fs.readFile(path.join(dist,'deputado','1-pessoa-1.html'),'utf8');
  assert.match(html,/Exercício em revisão: fevereiro de 2025/);
  assert.doesNotMatch(html,/Exerceu o mandato/);
}));
