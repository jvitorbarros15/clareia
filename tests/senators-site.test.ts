import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDB} from '../src/store.ts';
import {publishDomain,recordDomainAudit} from '../src/publications.ts';
import {buildSite} from '../src/build-site.ts';
import {canonical,hash,snapshotId} from '../src/model.ts';
import type {Expense,Snapshot} from '../src/model.ts';
import {scanCpfs} from '../src/cpf-scan.ts';
import {senatorExercisedMonths,senatorMonthlyCents} from '../src/view.ts';
import {deputyPath,loadStaticPages,renderSenator,resolveOptions,senatorDescription,senatorPath,sitemapXml,writeStaticPages} from '../src/prerender.ts';
import type {Deputy,Senator} from '../src/prerender.ts';
import {storeSenatorsVersion} from '../src/senado-publication.ts';
import type {SenatorYearRecord,SenatorsVersion} from '../src/senado-publication.ts';

const SITE='https://example.test';
const shell=await fs.readFile(path.join(import.meta.dirname,'..','real','index.html'),'utf8');
const meta=(html:string,key:string)=>new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`).exec(html)?.[1];

test('senator monthly spend divides totalCents by full and partial months, returning null with zero exercised months',()=>{
  const months=[
    {exercise:'full'},
    {exercise:'partial'},
    {exercise:'outside'},
    {exercise:'unknown'},
    {exercise:'conflict'},
  ];
  assert.equal(senatorExercisedMonths(months),2);
  assert.equal(senatorMonthlyCents({totalCents:100000,months}),50000);
  assert.equal(senatorMonthlyCents({totalCents:0,months:[{exercise:'partial'}]}),0);
  assert.equal(senatorMonthlyCents({totalCents:-300,months:[{exercise:'full'},{exercise:'full'},{exercise:'partial'}]}),-100);
  assert.equal(senatorExercisedMonths([]),0);
  assert.equal(senatorMonthlyCents({totalCents:50000,months:[]}),null);
  assert.equal(senatorMonthlyCents({totalCents:50000,months:[{exercise:'outside'},{exercise:'unknown'},{exercise:'conflict'}]}),null);
});

test('senatorPath uses the same slug rule as deputyPath',()=>{
  for(const [id,name,expected] of [
    [5899,'Vanderlan Cardoso','/senador/5899-vanderlan-cardoso'],
    [204,'Zé Trovão','/senador/204-ze-trovao'],
    [77,'José D\'Ávila Filho','/senador/77-jose-d-avila-filho'],
    [12,'  Ângela --  Çedilha!! ','/senador/12-angela-cedilha'],
  ] as const){
    assert.equal(senatorPath(id,name),expected);
    assert.equal(senatorPath(id,name).replace('/senador/','/deputado/'),deputyPath(id,name));
  }
});

test('renderSenator produces title, description, canonical, noscript and no CPF, and refuses name: null',()=>{
  const senator:Senator={
    senatorId:5899,
    year:2025,
    name:'Vanderlan Cardoso',
    totalCents:913383,
    records:2,
    months:[
      {month:1,exercise:'full',uf:'GO',codigoMandato:'538',participation:'Titular'},
      {month:2,exercise:'partial',uf:'GO',codigoMandato:'538',participation:'1º Suplente'},
    ],
    review:{'empty-type':1,'kept-company':0,withheld:0,'possible-duplicate':0},
    collectedAt:'2026-11-26T12:00:00Z',
  };
  const html=renderSenator(shell,senator,SITE);
  assert.ok(html.includes('<title>Vanderlan Cardoso — Clareia</title>'));
  assert.ok(html.includes(`<link rel="canonical" href="${SITE}/senador/5899-vanderlan-cardoso">`));
  assert.equal(meta(html,'og:url'),`${SITE}/senador/5899-vanderlan-cardoso`);
  assert.equal(meta(html,'og:type'),'profile');
  assert.equal(meta(html,'description'),meta(html,'og:description'));
  assert.ok(senatorDescription(senator).includes('Senador(a) · GO.'));
  assert.ok(senatorDescription(senator).includes('1 lançamento sem tipo de despesa fica fora dos totais.'));
  assert.ok(html.includes('<noscript><main id="main"><h1>Vanderlan Cardoso</h1>'));
  assert.equal(scanCpfs(html,new Set()),0);

  const escaped=renderSenator(shell,{...senator,name:'A $& <script>"\'B'},SITE);
  assert.ok(!escaped.includes('<script>'));
  assert.ok(escaped.includes('<title>A $&amp; &lt;script&gt;&quot;&#39;B — Clareia</title>'));

  assert.throws(()=>renderSenator(shell,{...senator,name:null},SITE),/sem nome/);
});

test('sitemapXml lists named senators sorted by id, skips name: null, and keeps deputy entries unchanged',()=>{
  const deputy:Deputy={id:100,name:'Maria da Silva',uf:'SP',ufNote:null,party:'PL',partyNote:null,partyInReview:false,lastConfirmedParty:null,sourceUrl:'https://www.camara.leg.br/deputados/100',exercisedMonths:12,noExercise:false,comparable:true,heldMonths:[],exerciseReviewMonths:[],cents:1000,hasCells:true,projects:1};
  const senators:Senator[]=[
    {senatorId:5899,year:2025,name:'Vanderlan Cardoso',totalCents:1000,records:1,months:[],review:{'empty-type':0,'kept-company':0,withheld:0,'possible-duplicate':0}},
    {senatorId:475,year:2025,name:'Átila Lins',totalCents:500,records:1,months:[],review:{'empty-type':0,'kept-company':0,withheld:0,'possible-duplicate':0}},
    {senatorId:999,year:2025,name:null,totalCents:200,records:1,months:[],review:{'empty-type':0,'kept-company':0,withheld:0,'possible-duplicate':0}},
  ];
  const without=sitemapXml(SITE,[deputy]);
  const withSenators=sitemapXml(SITE,[deputy],senators);
  assert.equal(withSenators.match(/<loc>/g)?.length,(without.match(/<loc>/g)?.length??0)+2);
  assert.ok(withSenators.includes(`<loc>${SITE}/deputado/100-maria-da-silva</loc>`));
  assert.ok(withSenators.includes(`<loc>${SITE}/senador/475-atila-lins</loc>`));
  assert.ok(withSenators.includes(`<loc>${SITE}/senador/5899-vanderlan-cardoso</loc>`));
  assert.ok(!withSenators.includes('/senador/999'));
  assert.ok(withSenators.indexOf('/senador/475-')<withSenators.indexOf('/senador/5899-'));
});

test('real/pages.js has the Senado methodology section and prerendered metodologia.html carries the Senado noscript sentence',async()=>{
  const pages=await loadStaticPages();
  const senado=pages.pages.metodologia.senado;
  assert.ok(senado.includes('<h3>Senado</h3>'));
  assert.match(senado,/Senado Federal \(CEAPS\)/);
  assert.match(senado,/sem tipo de despesa.*fora dos totais/i);
  assert.match(senado,/2026.*parcial.*meses.*fechados/i);
  assert.doesNotMatch(senado,/reembols/i);

  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-metodologia-senado-'));
  try{
    await fs.writeFile(path.join(dir,'index.html'),shell);
    await writeStaticPages(dir,resolveOptions({siteUrl:SITE}));
    const html=await fs.readFile(path.join(dir,'metodologia.html'),'utf8');
    const noscript=/<noscript>[\s\S]*<\/noscript>/.exec(html)?.[0]??'';
    assert.match(noscript,/Senado Federal \(CEAPS\)/);
  }finally{
    await fs.rm(dir,{recursive:true,force:true});
  }
});

function deputyRecord(cents:number,personId:number,index:number):Expense{
  return {id:`r${personId}-${index}`,personId,year:2025,month:1,category:'TEST',supplier:'EMPRESA TESTE LTDA',supplierKey:'k',supplierVerified:false,documentId:'1',documentNumber:'1',date:null,receipt:null,cents,documentCents:cents,disallowedCents:0,source:{url:'https://dadosabertos.camara.leg.br/api/v2/x',sha256:'s',row:index,fetchedAt:'2025-03-01T00:00:00Z'}};
}
function deputyVersion():Snapshot{
  const records=[deputyRecord(100,1,0)];
  const body={metric:'test.metric',scope:{year:2025,months:[1],ids:[1],legislature:57},people:[{id:1,name:'Ana Souza',photo:null,sourceUrl:'https://www.camara.leg.br/deputados/1',profileFetchedAt:'2025-03-01T00:00:00Z',uf:'SP',party:'PL'}],records,collectedAt:'2025-03-01T00:00:00Z',publishedAt:'2025-03-01T00:00:00Z',pages:[],validation:{stablePasses:2,recordCount:1,totalCents:100,independentTotalCents:'100',duplicatePolicy:'x',limitations:[]}};
  return {...body,id:snapshotId(body)};
}
function makeSenatorsVersion(rows:SenatorYearRecord[]):SenatorsVersion{
  const scope={years:[2025],senators:new Set(rows.map(r=>r.senatorId)).size,records:rows.reduce((s,r)=>s+r.records,0)};
  const body={schema:'clareia.senators-version.v1' as const,metric:'senado.ceaps.v1' as const,scope,rows};
  return {
    ...body,
    id:hash(canonical(body)),
    sources:[{year:2025,parsedSha256:hash('p'),evidenceSha256:hash('e'),checkedAt:'2026-11-26T12:00:00.000Z'}],
    collectedAt:'2026-11-26T12:00:00.000Z',
    publishedAt:'2026-11-26T13:00:00.000Z',
  };
}

test('buildSite writes senadores/, manifest.senators, senator pages and sitemap entries only when plan.senators is set',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-build-senators-')),portraits=path.join(dir,'portraits'),db=await openDB(true);
  await fs.mkdir(portraits);
  try{
    const dep=deputyVersion();
    await publishDomain(db,'despesas',dep);
    await recordDomainAudit(db,dep.id,'passed',{checkedAt:'2025-03-02T00:00:00Z'});

    const senRows:SenatorYearRecord[]=[
      {
        senatorId:5899,year:2025,name:'Vanderlan Cardoso',totalCents:375000,records:1,
        byType:{'Aluguel de imóveis':375000},
        byMonth:{'1':{'Aluguel de imóveis':375000}},
        suppliers:{'Fornecedor pessoa física':375000},
        months:[{month:1,exercise:'full',uf:'GO',codigoMandato:'538',participation:'Titular'}],
        review:{'empty-type':2,'kept-company':0,withheld:0,'possible-duplicate':0},
      },
      {
        senatorId:9999,year:2025,name:null,totalCents:10000,records:1,
        byType:{'Passagens':10000},
        byMonth:{'1':{'Passagens':10000}},
        suppliers:{'EMPRESA AEREA LTDA':10000},
        months:[{month:1,exercise:'outside',uf:null,codigoMandato:null,participation:null}],
        review:{'empty-type':0,'kept-company':0,withheld:0,'possible-duplicate':0},
      },
    ];
    const senVer=makeSenatorsVersion(senRows);
    await storeSenatorsVersion(db,senVer);
    await recordDomainAudit(db,senVer.id,'passed',{checkedAt:'2026-11-26T12:00:00.000Z'});

    const distWithout=path.join(dir,'without');
    const without=await buildSite(db,distWithout,portraits,{siteUrl:SITE,sitemap:true,approvedNames:[]},{defaultYear:2025,years:[{year:2025,publicationId:dep.id,ceiling:null}]});
    const manifestWithout=JSON.parse(await fs.readFile(path.join(distWithout,'manifest.json'),'utf8')) as Record<string,unknown>;
    assert.equal('senators' in manifestWithout,false);
    await assert.rejects(fs.access(path.join(distWithout,'senadores')));
    await assert.rejects(fs.access(path.join(distWithout,'senador')));

    const distWith=path.join(dir,'with');
    const withSen=await buildSite(db,distWith,portraits,{siteUrl:SITE,sitemap:true,approvedNames:[]},{defaultYear:2025,years:[{year:2025,publicationId:dep.id,ceiling:null}],senators:{publicationId:senVer.id}});
    const manifestWith=JSON.parse(await fs.readFile(path.join(distWith,'manifest.json'),'utf8')) as Record<string,unknown>;
    assert.equal(manifestWith.senators,true);
    // 2 files in senadores/ (index.json + 2025.json) + 1 named senator page (name: null gets none)
    assert.equal(withSen.files,without.files+3);

    await fs.access(path.join(distWith,'senadores','index.json'));
    await fs.access(path.join(distWith,'senadores','2025.json'));
    const senatorHtml=await fs.readFile(path.join(distWith,'senador','5899-vanderlan-cardoso.html'),'utf8');
    assert.ok(senatorHtml.includes('<title>Vanderlan Cardoso — Clareia</title>'));
    assert.ok(senatorHtml.includes(`<link rel="canonical" href="${SITE}/senador/5899-vanderlan-cardoso">`));
    assert.equal(senatorHtml.match(/rel="canonical"/g)?.length,1);
    assert.equal(scanCpfs(senatorHtml,new Set()),0);
    assert.deepEqual(await fs.readdir(path.join(distWith,'senador')),['5899-vanderlan-cardoso.html']);

    const sitemap=await fs.readFile(path.join(distWith,'sitemap.xml'),'utf8');
    assert.ok(sitemap.includes(`<loc>${SITE}/deputado/1-ana-souza</loc>`));
    assert.ok(sitemap.includes(`<loc>${SITE}/senador/5899-vanderlan-cardoso</loc>`));
    assert.ok(!sitemap.includes('/senador/9999'));
  }finally{
    await db.close();
    await fs.rm(dir,{recursive:true,force:true});
  }
});
