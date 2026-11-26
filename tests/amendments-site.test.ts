import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openDB} from '../src/store.ts';
import type {DB} from '../src/store.ts';
import {publishDomain,recordDomainAudit} from '../src/publications.ts';
import {buildSite} from '../src/build-site.ts';
import {canonical,hash,snapshotId} from '../src/model.ts';
import type {Expense,Snapshot} from '../src/model.ts';
import {amendmentsReport} from '../src/amendments.ts';
import type {AmendmentAuthor,AmendmentLink,AuthorYear,Totals} from '../src/amendments.ts';
import {auditAmendmentsVersion,buildAmendmentsVersion,storeAmendmentsVersion} from '../src/amendments-publication.ts';
import type {ReviewedLink} from '../src/amendments-publication.ts';
import {billsReport} from '../src/bills.ts';
import {votesReport} from '../src/votes.ts';

const execFileAsync=promisify(execFile);

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

test('tampered amendment rows after approval stop the build before staging is cleared and leave existing output untouched',()=>setup(async(db,dist,portraits)=>{
  const a=version([record(100,1,0)]);
  await publishDomain(db,'despesas',a);await recordDomainAudit(db,a.id,'passed',report);
  const basePlan={defaultYear:2025,years:[{year:2025,publicationId:a.id,ceiling:null}]};
  await buildSite(db,dist,portraits,{approvedNames:[]},basePlan);
  const before=await tree(dist),stagingMarker=path.join(dist+'.building','keep');
  await fs.mkdir(dist+'.building',{recursive:true});await fs.writeFile(stagingMarker,'keep');

  const {report:amReport,version:am}=makeAmendments([{code:'100',deputyId:1,years:{'2025':{'SP':totals(1,100,80,70,0,0,0)}}}],new Set([1,2]));
  await storeAmendmentsVersion(db,am);
  const audited=await auditAmendmentsVersion(db,am.id,amReport);
  await recordDomainAudit(db,am.id,'passed',audited);
  await db.query(`UPDATE amendments_v1 SET record=jsonb_set(record,'{totals,paid}','999') WHERE publication_id=$1`,[am.id]);

  await assert.rejects(buildSite(db,dist,portraits,{approvedNames:[]},{...basePlan,amendments:{publicationId:am.id}}),/Emendas no banco diferem da versão aprovada/);
  assert.equal(await fs.readFile(stagingMarker,'utf8'),'keep');
  assert.deepEqual(await tree(dist),before);
}));

test('full-site build with a newer amendments audit keeps non-amendment bytes unchanged and dry-run validates amendments checkedAt',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-full-amendments-'));
  const repo=path.resolve(import.meta.dirname,'..'),script=path.join(repo,'scripts','build-full-site.ts'),tsx=import.meta.resolve('tsx');
  const writeJson=async(file:string,data:unknown)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data));};
  const reviewIds:string[]=[];
  try{
    const baseChecked='2025-03-02T00:00:00.000Z',amendChecked='2025-04-10T00:00:00.000Z';
    const priv=path.join(dir,'data','private'),portraits=path.join(dir,'portraits');
    await fs.mkdir(portraits,{recursive:true});await fs.writeFile(path.join(portraits,'1.jpg'),'jpg');
    const history={scope:{legislature:57,start:'2025-01-01',end:'2025-01-31',sampleIds:[1,2]},legislature:{id:57,start:'2023-02-01',end:'2027-01-31'},people:[1,2].map(id=>({id,profile:{name:'Pessoa '+id,photo:null,source:{fetchedAt:'2025-03-01T00:00:00Z'}}}))};
    const dim=(value:string)=>({status:'single' as const,value,values:[value],rows:[0]});
    const temporal={schema:'clareia.people-temporal.v1',ruleVersion:'camara.history-reported-change.v1',historySha256:hash(canonical(history)),scope:history.scope,createdAt:'2025-03-01T00:00:00Z',status:'review-required',publicAttributionEnabled:false,people:[1,2].map(id=>({id,collectionStatus:'stable',events:[],intervals:[],months:[{year:2025,month:1,start:'2025-01-01T00:00:00',end:'2025-02-01T00:00:00',partialScope:false,exercise:'full',party:dim('PL'),uf:dim('SP'),financialCollection:'not-collected'}],issues:[]}))};
    const temporalSha256=hash(canonical(temporal));
    const crosscheck={schema:'clareia.people-crosscheck.v1',legacySha256:hash('l'),temporalSha256,historySha256:temporal.historySha256,discoverySha256:hash('d'),scope:history.scope,createdAt:'2025-03-01T00:00:00Z',status:'review-required',publicAttributionEnabled:false,dateSemantics:'boundary-days-and-open-ends-unconfirmed',people:[1,2].map(id=>({id,legacyStatus:'stable',partyComparisonStatus:'compared',partyChanges:[],months:[{year:2025,month:1,v2Exercise:'full',legacy:'reported-exercise',periodRows:[0],openEnd:false,comparison:'no-automatic-resolution'}]}))};
    const crosscheckSha256=hash(canonical(crosscheck));
    await writeJson(path.join(priv,'people-history','hist-1','history.json'),history);
    await writeJson(path.join(priv,'people-history','hist-1','temporal.json'),temporal);
    await writeJson(path.join(priv,'people-history','hist-1','temporal-audit.json'),{status:'passed',temporalSha256,checkedAt:baseChecked});
    await writeJson(path.join(priv,'people-legacy','leg-1','crosscheck.json'),crosscheck);
    await writeJson(path.join(priv,'people-legacy','leg-1','crosscheck-audit.json'),{status:'passed',crosscheckSha256,checkedAt:baseChecked});

    const proposal={schema:'clareia.expense-lot.v1',year:2025,months:[1],lot:0,lotSize:2,lots:1,universeSize:2,universeSha256:hash(canonical([1,2])),people:[{id:1},{id:2}],temporalSha256,crosscheckSha256};
    const proposalSha256=hash(canonical(proposal)),lotInput={schema:'clareia.expense-lot-input.v1',selectionRun:'s',proposal,temporal,originAudit:{}};
    const cells=[{personId:1,year:2025,month:1,status:'complete',records:[record(100,1,0),record(250,1,1)],reasons:[],totalCents:350},{personId:2,year:2025,month:1,status:'complete',records:[record(50,2,2)],reasons:[],totalCents:50}];
    const batch={peopleVersion:temporalSha256,scope:{year:2025,months:[1],ids:[1,2],legislature:57},proposalSha256,createdAt:'2025-03-01T00:00:00Z',contentSha256:hash('batch-0'),cells};
    const reportSha256=hash(canonical(batch));
    await writeJson(path.join(priv,'expense-intermediate','lot-0','run.json'),{runId:'lot-0',status:'review-required',reportSha256,proposalSha256,inputSha256:hash(canonical(lotInput))});
    await writeJson(path.join(priv,'expense-intermediate','lot-0','input.json'),lotInput);
    await writeJson(path.join(priv,'expense-intermediate','lot-0','batch.json'),batch);
    await writeJson(path.join(priv,'expense-intermediate','lot-0','audit.json'),{status:'passed',reportSha256,proposalSha256,checkedAt:baseChecked,competences:cells.length,scope:batch.scope,peopleVersion:temporalSha256});

    const billsRep=billsReport(2025,{bills:[],people:[],metrics:{propositions:0,selected:0,held:0,orphanAuthorRows:0,normsResolved:0,normsUnresolved:0}},[],'2025-03-01T00:00:00Z');
    await writeJson(path.join(priv,'bills','bills-2025','bills.json'),billsRep);
    await writeJson(path.join(priv,'bills','bills-2025','audit.json'),{status:'passed',contentSha256:billsRep.contentSha256,checkedAt:baseChecked});

    const votesRep=votesReport(2025,{votes:[],ballots:[],metrics:{votes:0,nominal:0,reconciled:0,held:0,ballots:0,orphanBallots:0,categories:{}}},[],'2025-03-01T00:00:00Z');
    await writeJson(path.join(priv,'votes','votes-2025','votes.json'),votesRep);
    await writeJson(path.join(priv,'votes','votes-2025','ballots.json'),[]);
    await writeJson(path.join(priv,'votes','votes-2025','audit.json'),{status:'passed',contentSha256:votesRep.contentSha256,checkedAt:baseChecked});

    const {report:amReport}=makeAmendments([{code:'100',deputyId:1,years:{'2025':{'SP':totals(2,1000,800,700,100,20,30)}}}],new Set([1,2]));
    await writeJson(path.join(priv,'amendments','amend-1','amendments.json'),amReport);
    await writeJson(path.join(priv,'amendments','amend-1','audit.json'),{status:'passed',contentSha256:amReport.contentSha256,checkedAt:amendChecked});
    await writeJson(path.join(priv,'amendments','amend-missing-ts','amendments.json'),amReport);
    await writeJson(path.join(priv,'amendments','amend-missing-ts','audit.json'),{status:'passed',contentSha256:amReport.contentSha256});
    await writeJson(path.join(priv,'amendments','amend-bad-ts','amendments.json'),amReport);
    await writeJson(path.join(priv,'amendments','amend-bad-ts','audit.json'),{status:'passed',contentSha256:amReport.contentSha256,checkedAt:'not-a-date'});
    await writeJson(path.join(dir,'config','amendment-author-links.json'),[{code:'100',deputyId:1,reviewer:'revisor-teste',reviewedAt:amendChecked,evidence:'evidencia-teste'}]);

    const baseConfig={historyRun:'hist-1',legacyRun:'leg-1',expenseYears:{'2025':['lot-0']},defaultYear:2025,billsRuns:['bills-2025'],votesRuns:['votes-2025']};
    const cfgWithout=path.join(dir,'config-without.json'),cfgWith=path.join(dir,'config-with.json'),cfgMissingTs=path.join(dir,'config-missing-ts.json'),cfgBadTs=path.join(dir,'config-bad-ts.json');
    await writeJson(cfgWithout,baseConfig);
    await writeJson(cfgWith,{...baseConfig,amendmentsRun:'amend-1'});
    await writeJson(cfgMissingTs,{...baseConfig,amendmentsRun:'amend-missing-ts'});
    await writeJson(cfgBadTs,{...baseConfig,amendmentsRun:'amend-bad-ts'});

    const runBuild=async(cfg:string,outDir:string,extra:string[]=[])=>{
      const {stdout}=await execFileAsync(process.execPath,['--import',tsx,script,'--out',outDir,'--portraits',portraits,'--config',cfg,'--data-root',path.join(dir,'data'),...extra],{cwd:dir,encoding:'utf8'});
      const parsed=JSON.parse(stdout.trim()) as {publicationId?:string;built?:boolean;amendments?:string;amendmentRows?:number};
      if(parsed.publicationId)reviewIds.push(parsed.publicationId);
      return parsed;
    };
    const distWithout=path.join(dir,'dist-without'),distWith=path.join(dir,'dist-with');
    const dryWithout=await runBuild(cfgWithout,distWithout,['--dry-run']);
    const dryWith=await runBuild(cfgWith,distWith,['--dry-run']);
    await assert.rejects(runBuild(cfgMissingTs,distWith,['--dry-run']),/Nenhuma auditoria de entrada com checkedAt válido/);
    await assert.rejects(runBuild(cfgBadTs,distWith,['--dry-run']),/Nenhuma auditoria de entrada com checkedAt válido/);
    assert.equal(dryWithout.built,false);
    assert.equal(Object.hasOwn(dryWithout,'amendments'),false);
    assert.equal(Object.hasOwn(dryWithout,'amendmentRows'),false);
    assert.equal(dryWith.built,false);
    assert.match(dryWith.amendments??'',/^[0-9a-f]{64}$/);
    assert.equal(dryWith.amendmentRows,1);

    const without=await runBuild(cfgWithout,distWithout),withAm=await runBuild(cfgWith,distWith);
    assert.equal(Object.hasOwn(without,'amendments'),false);
    assert.equal(Object.hasOwn(without,'amendmentRows'),false);
    assert.equal(withAm.amendments,dryWith.amendments);
    assert.equal(withAm.amendmentRows,1);
    const baseWithout=path.join(distWithout,'data',without.publicationId!),baseWith=path.join(distWith,'data',withAm.publicationId!);
    await assert.rejects(fs.access(path.join(baseWithout,'emendas')));
    await fs.access(path.join(baseWith,'emendas','1.json'));
    await assert.rejects(fs.access(path.join(baseWith,'emendas','2.json')));

    for(const rel of [['summary.json'],['index.json'],['fornecedores.json'],['dados-abertos.json'],['abertos','despesas-2025.zip'],['abertos','despesas-2025-01.csv'],['deputados','1','despesas.json'],['deputados','2','despesas.json']]){
      assert.deepEqual(await fs.readFile(path.join(baseWith,...rel)),await fs.readFile(path.join(baseWithout,...rel)),rel.join('/'));
    }
    const indexWith=await json(baseWith,'index.json');
    assert.equal(indexWith.publishedAt,baseChecked);
    assert.equal(indexWith.audit.builtAt,baseChecked);
    const manifestWith=await json(distWith,'manifest.json'),manifestWithout=await json(distWithout,'manifest.json');
    assert.equal(manifestWithout.domains.emendas,undefined);
    assert.equal(manifestWith.domains.emendas.version,withAm.amendments);
    assert.equal(manifestWith.domains.emendas.publishedAt,amendChecked);
    for(const d of ['despesas','pessoas','projetos','votacoes'])assert.equal(manifestWith.domains[d].publishedAt,baseChecked);
  }finally{
    for(const id of reviewIds){
      await fs.rm(path.join(repo,'output','review',`${id}-pendencias-revisao.md`),{force:true});
      await fs.rm(path.join(repo,'output','review',`${id}-sinal-corrigido.md`),{force:true});
    }
    await fs.rm(dir,{recursive:true,force:true});
  }
});
