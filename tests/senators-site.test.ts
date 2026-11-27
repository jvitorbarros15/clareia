import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {openDB} from '../src/store.ts';
import {publishDomain,recordDomainAudit} from '../src/publications.ts';
import {buildSite} from '../src/build-site.ts';
import {canonical,hash,snapshotId} from '../src/model.ts';
import type {Expense,Snapshot} from '../src/model.ts';
import {scanCpfs} from '../src/cpf-scan.ts';
import * as ClareiaView from '../src/view.ts';
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

const DATA_JS=await fs.readFile(path.join(import.meta.dirname,'..','real','data.js'),'utf8');
const APP_JS=await fs.readFile(path.join(import.meta.dirname,'..','real','app.js'),'utf8');
const flush=async()=>{for(let i=0;i<6;i++)await new Promise<void>(r=>setImmediate(r));};

async function bootDataJs(manifestSenators:unknown):Promise<boolean>{
  const responses:Record<string,unknown>={
    '/manifest.json':{
      base:'data/pub1',
      defaultYear:2025,
      years:[{year:2025,months:[1],partial:true}],
      ...(manifestSenators===undefined?{}:{senators:manifestSenators}),
    },
    '/data/pub1/index.json':{
      scope:{year:2025,months:[1],ids:[1]},
      validation:{heldMonths:{}},
      people:[{id:1,name:'Ana Souza',photo:null,sourceUrl:'',uf:'SP',profileFetchedAt:'2025-03-01T00:00:00Z'}],
      collectedAt:'2025-03-01T00:00:00Z',
      snapshotId:'snap1234567890',
    },
    '/data/pub1/summary.json':{
      publicationId:'pub1',
      minMonths:1,
      ceiling:null,
      coverageId:null,
      billsId:null,
      votesId:null,
      categories:['TEST'],
      people:[{
        id:1,
        cents:100,
        categories:[{category:'TEST',cents:100,records:1}],
        party:'PL',
        partyNote:null,
        partyInReview:false,
        lastConfirmedParty:null,
        exercisedMonths:1,
        noExercise:false,
        heldMonths:[],
        exerciseReviewMonths:[],
        comparable:true,
        months:[{month:1,cents:100,records:1,held:false,exercise:'full',ufStatus:'single',uf:'SP'}],
        bills:null,
      }],
    },
  };
  let done!:()=>void;
  const finished=new Promise<void>(r=>{done=r;});
  const win:Record<string,unknown>={};
  win.window=win;
  const sandbox:Record<string,unknown>={
    window:win,
    ClareiaView,
    URLSearchParams,
    location:{search:'',pathname:'/',hash:''},
    setTimeout,
    fetch:async(url:string)=>Object.hasOwn(responses,url)?{ok:true,json:async()=>responses[url]}:{ok:false,status:404,json:async()=>({})},
    document:{
      getElementById:(id:string)=>id==='main'?{append(){}}:{innerHTML:''},
      createElement:()=>({className:'',innerHTML:'',src:'',onload:null as (()=>void)|null,onerror:null as (()=>void)|null,setAttribute(){},remove(){}}),
      body:{
        prepend(){},
        appendChild(el:{src?:string;onload?:(()=>void)|null}){
          queueMicrotask(()=>{el.onload?.();if(el.src==='/portal.js')done();});
        },
      },
    },
  };
  vm.runInNewContext(DATA_JS,sandbox);
  await finished;
  const data=win.ClareiaData as {senators:boolean}|undefined;
  assert.ok(data,'ClareiaData initialized');
  return data.senators;
}

type AppFetch=(url:string)=>Promise<{ok:boolean;status?:number;json:()=>Promise<unknown>}>;
function bootAppJs(opts:{
  senators?:boolean;
  pathname?:string;
  search?:string;
  suppliersLoaded?:()=>boolean;
  loadSuppliers?:()=>Promise<void>;
  fetchImpl?:AppFetch;
}={}){
  const origin='https://clareia.test';
  const loc={origin,pathname:opts.pathname??'/',search:opts.search??'',href:''};
  const setUrl=(input:string|URL)=>{const u=new URL(String(input),origin);loc.pathname=u.pathname;loc.search=u.search;loc.href=u.href;};
  setUrl((opts.pathname??'/')+(opts.search??''));
  const historyStack:{state:unknown;href:string}[]=[{state:null,href:loc.href}];
  let historyIdx=0;
  const winListeners=new Map<string,{fn:(ev?:unknown)=>void;once?:boolean}[]>();
  const docListeners=new Map<string,((ev:unknown)=>void)[]>();
  const fireWin=(type:string)=>{
    const list=winListeners.get(type)??[];
    winListeners.set(type,list.filter(x=>!x.once));
    for(const item of list)item.fn();
  };
  const history={
    get state(){return historyStack[historyIdx]?.state??null;},
    replaceState(st:unknown,_t:string,url?:string|URL|null){if(url!=null)setUrl(url);historyStack[historyIdx]={state:st,href:loc.href};},
    pushState(st:unknown,_t:string,url?:string|URL|null){if(url!=null)setUrl(url);historyStack.length=historyIdx+1;historyStack.push({state:st,href:loc.href});historyIdx=historyStack.length-1;},
    go(delta:number){historyIdx=Math.max(0,Math.min(historyStack.length-1,historyIdx+delta));setUrl(historyStack[historyIdx].href);queueMicrotask(()=>fireWin('popstate'));},
    back(){history.go(-1);},
  };
  const dialogListeners=new Map<string,(()=>void)[]>();
  const dialog={
    open:false,
    scrollTop:0,
    classList:{remove(){},add(){}},
    showModal(){this.open=true;},
    close(){if(!this.open)return;this.open=false;for(const fn of dialogListeners.get('close')??[])fn();},
    contains(){return false;},
    addEventListener(type:string,fn:()=>void){const list=dialogListeners.get(type)??[];list.push(fn);dialogListeners.set(type,list);},
  };
  const makeBox=()=>({
    id:'',className:'',innerHTML:'',textContent:'',hidden:false,value:'',
    attrs:{} as Record<string,string>,
    dataset:{} as Record<string,string>,
    setAttribute(k:string,v:string){this.attrs[k]=String(v);},
    focus(){},
    scrollIntoView(){},
    before(){},
    getBoundingClientRect(){return {left:0,top:0,width:100,height:40};},
  });
  const elements:Record<string,ReturnType<typeof makeBox>>={
    '#app':makeBox(),'#universo':makeBox(),'#answer-slot':makeBox(),'#rank-slot':makeBox(),
    '#editorial-feature':makeBox(),'#hero-portrait':makeBox(),'#query':makeBox(),'#suggestions':makeBox(),
    '#detail-title':makeBox(),'#detail-body':makeBox(),'#detail .close-button':makeBox(),'#toast':makeBox(),
  };
  let scopeChip:ReturnType<typeof makeBox>|null=null;
  const people=[
    {id:'1',officialId:1,name:'Ana Souza',photo:null,sourceUrl:'',social:[],uf:'SP',ufNote:null,party:'PL',partyNote:null,partyInReview:false,lastConfirmedParty:null,profileFetchedAt:'2025-03-01T00:00:00Z',months:1,exercisedMonths:1,noExercise:false,heldMonths:[],exerciseReviewMonths:[],comparable:true,use:{status:'unconfirmed',counted:[],excluded:[],outside:[],missing:[1]},projects:null,approved:null,votes:null,cells:[{month:0,category:'TEST',supplier:'EMPRESA LTDA',amount:50000,count:1}],total:50000},
    {id:'2',officialId:2,name:'Bruno Lima',photo:null,sourceUrl:'',social:[],uf:'RJ',ufNote:null,party:'PT',partyNote:null,partyInReview:false,lastConfirmedParty:null,profileFetchedAt:'2025-03-01T00:00:00Z',months:1,exercisedMonths:1,noExercise:false,heldMonths:[],exerciseReviewMonths:[],comparable:true,use:{status:'unconfirmed',counted:[],excluded:[],outside:[],missing:[1]},projects:null,approved:null,votes:null,cells:[{month:0,category:'TEST',supplier:'EMPRESA LTDA',amount:20000,count:1}],total:20000},
  ];
  const clareiaData={
    minMonths:1,ceiling:null,coverageApproved:false,billsApproved:false,votesApproved:false,billsYears:[],votesYears:[],
    label:(c:string)=>c,dataset:()=>people,categories:['TEST'],
    monthNames:['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],
    index:{snapshotId:'snap1234567890',collectedAt:'2025-03-01T00:00:00Z',publishedAt:'2025-03-01T00:00:00Z',scope:{year:2025,months:[1],ids:[1,2]},validation:{sourceKind:'annual',limitations:[]}},
    base:'/data/pub1',sharedBase:'/data/pub1',year:'2025',defaultYear:'2025',years:[{year:2025,months:[1],partial:true}],
    partial:true,partialLabel:'parcial · jan 2025',provisional:[],provisionalNote:'',ceilingPending:false,shareImages:false,
    senators:opts.senators??true,yearBase:()=>'/data/pub1',coverage:[0],
    suppliersLoaded:opts.suppliersLoaded??(()=>true),
    loadSuppliers:opts.loadSuppliers??(()=>Promise.resolve()),
  };
  const win:Record<string,unknown>={
    ClareiaData:clareiaData,
    addEventListener(type:string,fn:(ev?:unknown)=>void,options?:{once?:boolean}){const list=winListeners.get(type)??[];list.push({fn,once:options?.once});winListeners.set(type,list);},
  };
  win.window=win;
  const doc={
    title:'Clareia — o poder, em números',
    body:{dataset:{} as Record<string,string>},
    activeElement:null,
    createElement(){const box=makeBox();scopeChip=box;return box;},
    querySelector(sel:string){
      if(sel==='#detail')return dialog;
      if(sel==='#scope-chip')return scopeChip;
      if(sel==='#detail [data-senator-run]'){
        const m=/data-senator-run="(\d+)"/.exec(elements['#detail-body'].innerHTML);
        return m?{dataset:{senatorRun:m[1]}}:null;
      }
      return elements[sel]??null;
    },
    querySelectorAll(){return [];},
    addEventListener(type:string,fn:(ev:unknown)=>void){const list=docListeners.get(type)??[];list.push(fn);docListeners.set(type,list);},
    dispatchEvent(){},
  };
  class CustomEvent{type:string;constructor(type:string){this.type=type;}}
  const unrefTimeout=(fn:()=>void,ms?:number)=>{const t=setTimeout(fn,ms);t.unref?.();return t;};
  const sandbox:Record<string,unknown>={
    window:win,document:doc,location:loc,history,ClareiaView,URL,URLSearchParams,CustomEvent,
    matchMedia:()=>({matches:true}),setTimeout:unrefTimeout,clearTimeout,
    fetch:opts.fetchImpl??(async()=>({ok:false,status:404,json:async()=>({})})),
  };
  vm.runInNewContext(APP_JS,sandbox);
  const clickHouse=(house:'camara'|'senado')=>{
    const target={tagName:'BUTTON',dataset:{house},closest(sel:string){return sel.includes('[data-house]')?target:null;}};
    for(const fn of docListeners.get('click')??[])fn({target,preventDefault(){}});
  };
  return {
    clareia:win.Clareia as {
      state:{house:string;query:string;tab:string;answer:{type:string}|null};
      ask:(q:string,scroll?:boolean)=>void;
      openRoute:(route:{type:string;id?:string;slug?:string},opts?:{initial?:boolean})=>void;
      closeDialog:()=>Promise<void>;
    },
    dialog,elements,location:loc,clickHouse,
  };
}

const VALID_SENATORS_INDEX={schema:'clareia.senators-index.v1',years:[{year:2025,file:'2025.json'}]};
const VALID_SENATORS_YEAR={
  schema:'clareia.senators-year.v1',publicationId:'pub1234567890',year:2025,collectedAt:'2026-11-26T12:00:00Z',
  totalCents:375000,records:1,
  senators:[{
    senatorId:5899,year:2025,name:'Vanderlan Cardoso',totalCents:375000,records:1,
    byType:{'Aluguel de imóveis':375000},byMonth:{'1':{'Aluguel de imóveis':375000}},
    suppliers:{'Fornecedor pessoa física':375000},
    months:[{month:1,exercise:'full',uf:'GO',codigoMandato:'538',participation:'Titular'}],
    review:{'empty-type':0,'kept-company':0,withheld:0,'possible-duplicate':0},
  }],
};

test('real/data.js enables senators only when manifest.senators is strictly true',async()=>{
  assert.equal(await bootDataJs('false'),false);
  assert.equal(await bootDataJs(1),false);
  assert.equal(await bootDataJs(undefined),false);
  assert.equal(await bootDataJs(true),true);
});

test('real/app.js rejects malformed senator months ([null] or invalid month) with an error state and escapes fallback month label',async()=>{
  for(const badMonths of [[null],[{month:'<img src=x>',exercise:'full',uf:'GO',codigoMandato:null,participation:null}],[{month:13,exercise:'full',uf:'GO',codigoMandato:null,participation:null}]]){
    const badYear={...VALID_SENATORS_YEAR,senators:[{...VALID_SENATORS_YEAR.senators[0],months:badMonths}]};
    const app=bootAppJs({
      senators:true,
      fetchImpl:async url=>{
        if(url==='/senadores/index.json')return {ok:true,json:async()=>VALID_SENATORS_INDEX};
        if(url==='/senadores/2025.json')return {ok:true,json:async()=>badYear};
        return {ok:false,status:404,json:async()=>({})};
      },
    });
    app.clickHouse('senado');
    await flush();
    assert.ok(app.elements['#rank-slot'].innerHTML.includes('senators-error'),`malformed months should show error state`);
    assert.ok(!app.elements['#rank-slot'].innerHTML.includes('senators-status'),`malformed months must not stay loading`);
  }
  assert.match(APP_JS,/Mês \$\{escape\(m\.month\)\}/);
});

test('closing a senator profile while its year file is loading prevents the late response from reopening the dialog or restoring the URL',async()=>{
  let resolveYear!:()=>void;
  const yearGate=new Promise<void>(r=>{resolveYear=r;});
  const app=bootAppJs({
    senators:true,
    pathname:'/senador/5899-vanderlan-cardoso',
    fetchImpl:async url=>{
      if(url==='/senadores/index.json')return {ok:true,json:async()=>VALID_SENATORS_INDEX};
      if(url==='/senadores/2025.json'){await yearGate;return {ok:true,json:async()=>VALID_SENATORS_YEAR};}
      return {ok:false,status:404,json:async()=>({})};
    },
  });
  app.clareia.openRoute({type:'senador',id:'5899',slug:'vanderlan-cardoso'},{initial:true});
  assert.equal(app.dialog.open,true);
  assert.equal(app.location.pathname,'/senador/5899-vanderlan-cardoso');

  await app.clareia.closeDialog();
  assert.equal(app.dialog.open,false);
  assert.equal(app.location.pathname,'/');

  resolveYear();
  await flush();
  assert.equal(app.dialog.open,false);
  assert.equal(app.location.pathname,'/');
});

test('starting a Câmara search while suppliers load then switching to Senado keeps the user on Senado when suppliers finish',async()=>{
  let suppliersDone=false;
  let resolveSuppliers!:()=>void;
  const suppliersPromise=new Promise<void>(r=>{resolveSuppliers=()=>{suppliersDone=true;r();};});
  const app=bootAppJs({
    senators:true,
    suppliersLoaded:()=>suppliersDone,
    loadSuppliers:()=>suppliersPromise,
    fetchImpl:async url=>{
      if(url==='/senadores/index.json')return {ok:true,json:async()=>VALID_SENATORS_INDEX};
      if(url==='/senadores/2025.json')return {ok:true,json:async()=>VALID_SENATORS_YEAR};
      return {ok:false,status:404,json:async()=>({})};
    },
  });
  app.clareia.ask('Quem mais gastou?',false);
  assert.equal(app.clareia.state.house,'camara');
  assert.equal(app.clareia.state.answer?.type,'loading');

  app.clickHouse('senado');
  assert.equal(app.clareia.state.house,'senado');
  assert.equal(new URLSearchParams(app.location.search).get('casa'),'senado');

  resolveSuppliers();
  await flush();
  assert.equal(app.clareia.state.house,'senado');
  assert.equal(new URLSearchParams(app.location.search).get('casa'),'senado');
  assert.equal(app.clareia.state.answer,null);
  assert.ok(app.elements['#rank-slot'].innerHTML.includes('Vanderlan Cardoso'));

  // Replacing a pending Câmara query before suppliers resolve applies only the latest query.
  let done2=false;
  let resolve2!:()=>void;
  const p2=new Promise<void>(r=>{resolve2=()=>{done2=true;r();};});
  const app2=bootAppJs({senators:true,suppliersLoaded:()=>done2,loadSuppliers:()=>p2});
  app2.clareia.ask('Quem mais gastou?',false);
  app2.clareia.ask('Quem gastou menos?',false);
  resolve2();
  await flush();
  assert.equal(app2.clareia.state.house,'camara');
  assert.equal(app2.clareia.state.query,'Quem gastou menos?');
  assert.equal(app2.clareia.state.tab,'menos');
});
