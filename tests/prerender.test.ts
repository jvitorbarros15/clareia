import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openDB} from '../src/store.ts';
import {publishDomain,recordDomainAudit} from '../src/publications.ts';
import {buildSite} from '../src/build-site.ts';
import {createApp} from '../src/app.ts';
import {snapshotId} from '../src/model.ts';
import type {Expense,Snapshot} from '../src/model.ts';
import {loadStaticPages,writeStaticPages,UFS,deputyDescription,deputyPath,inState,jpegSize,renderDeputy,renderHome,renderState,resolveOptions,robotsTxt,sitemapXml,slugOf,stateDescription} from '../src/prerender.ts';
import type {Deputy,Period} from '../src/prerender.ts';

const shell=await fs.readFile(path.join(import.meta.dirname,'..','real','index.html'),'utf8');
const period:Period={year:'2025',coverage:[0,1,2,3,4,5,6,7,8,9,10,11]};
const SITE='https://example.test';
const normal:Deputy={id:100,name:'Maria da Silva',uf:'SP',party:'PL (atual)',partyInReview:false,lastConfirmedParty:null,sourceUrl:'https://www.camara.leg.br/deputados/100',exercisedMonths:12,noExercise:false,heldMonths:[],cents:123456789,hasCells:true,projects:7};
const meta=(html:string,key:string)=>new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`).exec(html)?.[1];

test('slugs follow the rule of real/app.js',()=>{
  assert.equal(slugOf('José D\'Ávila Filho'),'jose-d-avila-filho');
  assert.equal(slugOf('  Ângela --  Çedilha!! '),'angela-cedilha');
  assert.equal(slugOf('<b>X & Y</b>'),'b-x-y-b');
  assert.equal(deputyPath(204,'Zé Trovão'),'/deputado/204-ze-trovao');
  assert.equal(deputyPath(5,'???'),'/deputado/5-');
});
test('canonical and og:url use the same path as the app',()=>{
  const html=renderDeputy(shell,{...normal,id:204,name:'Zé Trovão'},period,SITE,null);
  assert.ok(html.includes(`<link rel="canonical" href="${SITE}/deputado/204-ze-trovao">`));
  assert.equal(meta(html,'og:url'),`${SITE}/deputado/204-ze-trovao`);
});
test('every field from data is escaped',()=>{
  const evil:Deputy={...normal,name:'A<script>"&\'B',sourceUrl:'https://x.test/?a="1"&b=<2>'};
  const html=renderDeputy(shell,evil,period,SITE,{url:`${SITE}/data/p/portraits/1.jpg?a="&`,width:10,height:20});
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('<title>A&lt;script&gt;&quot;&amp;&#39;B — Clareia</title>'));
  assert.equal(meta(html,'og:title'),'A&lt;script&gt;&quot;&amp;&#39;B — Clareia');
  assert.ok(meta(html,'og:image:alt')!.includes('A&lt;script&gt;&quot;&amp;&#39;B'));
  assert.ok(meta(html,'og:image')!.includes('&quot;&amp;'));
  assert.ok(html.includes('<h1>A&lt;script&gt;&quot;&amp;&#39;B</h1>'));
  assert.ok(html.includes('href="https://x.test/?a=&quot;1&quot;&amp;b=&lt;2&gt;"'));
  assert.equal(html.match(/<head>/g)?.length,1);
  const noHttps=renderDeputy(shell,{...normal,sourceUrl:'javascript:alert(1)'},period,SITE,null);
  assert.ok(!noHttps.includes('javascript:'));
});
test('a normal deputy gets a factual description',()=>{
  assert.equal(deputyDescription(normal,period),`Deputado(a) federal · SP · PL (atual). Despesas no recorte (Jan–Dez 2025): R$ 1.234.567,89. Projetos como proponente: 7. Dados oficiais da Câmara dos Deputados.`);
});
test('partial, short exercise and no exercise use the app wording',()=>{
  const partial=deputyDescription({...normal,heldMonths:[2]},period);
  assert.ok(partial.includes('Total parcial: março de 2025 está em revisão e fora da soma. Não entra em rankings nem comparações.'));
  assert.ok(deputyDescription({...normal,heldMonths:[2,3]},period).includes('Total parcial: 2 meses em revisão e fora da soma.'));
  assert.ok(deputyDescription({...normal,heldMonths:[2],hasCells:false,cents:0},period).includes('Despesas no recorte (Jan–Dez 2025): Em revisão.'));
  assert.ok(deputyDescription({...normal,exercisedMonths:4},period).includes('Exerceu o mandato em 4 de 12 meses do recorte. Rankings e comparações incluem quem exerceu pelo menos 6 meses.'));
  const none=deputyDescription({...normal,noExercise:true,cents:0,projects:null},period);
  assert.ok(none.includes('Sem exercício confirmado em 2025.'));
  assert.ok(!none.includes('R$')&&!none.includes('Projetos'));
});
test('a party under review gives the last confirmed party or none',()=>{
  const review={...normal,party:'Partido em revisão',partyInReview:true};
  assert.ok(deputyDescription({...review,lastConfirmedParty:'PT'},period).startsWith('Deputado(a) federal · SP · PT (último confirmado).'));
  const without=deputyDescription(review,period);
  assert.ok(without.startsWith('Deputado(a) federal · SP.'));
  assert.ok(!without.includes('revisão'));
  assert.ok(deputyDescription({...normal,party:'Partido indisponível'},period).startsWith('Deputado(a) federal · SP.'));
  assert.ok(deputyDescription({...normal,party:null,uf:null},period).startsWith('Deputado(a) federal.'));
});
test('without a portrait the page uses the site icon and no portrait tags',()=>{
  const html=renderDeputy(shell,normal,period,SITE,null);
  assert.equal(meta(html,'og:image'),`${SITE}/icon-512.png`);
  assert.equal(meta(html,'og:image:alt'),'Clareia');
  const withPortrait=renderDeputy(shell,normal,period,SITE,{url:`${SITE}/data/p/portraits/100.jpg`,width:300,height:400});
  assert.equal(meta(withPortrait,'og:image'),`${SITE}/data/p/portraits/100.jpg`);
  assert.equal(meta(withPortrait,'og:image:width'),'300');
  assert.equal(meta(withPortrait,'og:image:height'),'400');
  assert.equal(meta(withPortrait,'og:type'),'profile');
  assert.equal(meta(withPortrait,'og:locale'),'pt_BR');
  assert.equal(meta(withPortrait,'twitter:card'),'summary');
  assert.equal(meta(withPortrait,'description'),meta(withPortrait,'og:description'));
  assert.ok(withPortrait.includes('<noscript><main id="main"><h1>Maria da Silva</h1>'));
  assert.ok(withPortrait.includes('href="https://www.camara.leg.br/deputados/100"'));
});
test('state pages are factual and cover all 27 UFs',()=>{
  const list:Deputy[]=[normal,{...normal,id:101,cents:1000,heldMonths:[1]},{...normal,id:102,uf:'BA'},{...normal,id:103,noExercise:true,cents:0}];
  assert.equal(inState(list,'SP').length,2);
  assert.equal(stateDescription('SP',list,period),`São Paulo: 2 deputados neste recorte. Cota total em Jan–Dez 2025: R$ 1.234.577,89 (valor exato). Inclui 1 deputado com total parcial; meses em revisão ficam fora da soma. Dados oficiais da Câmara dos Deputados.`);
  assert.equal(stateDescription('AC',list,period),'Acre: nenhum deputado neste recorte. Indisponível não significa zero.');
  assert.equal(Object.keys(UFS).length,27);
  const html=renderState(shell,'SP',list,period,SITE);
  assert.ok(html.includes('<title>São Paulo — Clareia</title>'));
  assert.equal(meta(html,'og:url'),`${SITE}/estado/SP`);
  assert.equal(meta(html,'og:image'),`${SITE}/icon-512.png`);
});
test('the home page gets canonical and og tags and keeps its own title',()=>{
  const html=renderHome(shell,SITE);
  assert.ok(html.includes('<title>Clareia — o poder, em números</title>'));
  assert.ok(html.includes(`<link rel="canonical" href="${SITE}/">`));
  assert.equal(meta(html,'og:image'),`${SITE}/icon-512.png`);
  assert.equal(meta(html,'og:description'),meta(html,'description'));
});
test('a replacement name with dollar signs is not interpreted',()=>{
  const html=renderDeputy(shell,{...normal,name:'A $& $1 B'},period,SITE,null);
  assert.ok(html.includes('<title>A $&amp; $1 B — Clareia</title>'));
});
test('sitemap and noindex are exclusive and drive robots.txt',()=>{
  assert.throws(()=>resolveOptions({sitemap:true,noindex:true}),/não podem ser usados juntos/);
  assert.equal(robotsTxt(resolveOptions({noindex:true})),'User-agent: *\nDisallow: /\n');
  assert.equal(robotsTxt(resolveOptions({sitemap:true,siteUrl:'https://clareia.example/'})),'User-agent: *\nAllow: /\n\nSitemap: https://clareia.example/sitemap.xml\n');
  assert.ok(!robotsTxt(resolveOptions()).includes('Sitemap'));
  assert.throws(()=>resolveOptions({siteUrl:'https://x.test/caminho'}),/origem/);
  assert.throws(()=>resolveOptions({siteUrl:'ftp://x.test'}),/origem/);
  assert.throws(()=>resolveOptions({siteUrl:'nada'}),/inválido/);
  const xml=sitemapXml(SITE,[normal,{...normal,id:7,name:'Zé & Cia'}]);
  assert.equal(xml.match(/<loc>/g)?.length,1+27+2);
  assert.ok(xml.includes(`<loc>${SITE}/deputado/7-ze-cia</loc>`));
  assert.ok(xml.indexOf('/deputado/7-')<xml.indexOf('/deputado/100-'));
});
test('jpeg size is read from the frame header',()=>{
  const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x04,0x00,0x00,0xff,0xc0,0x00,0x0b,0x08,0x01,0x90,0x01,0x2c,0x01,0x01,0x11,0x00]);
  assert.deepEqual(jpegSize(jpeg),{width:300,height:400});
  assert.equal(jpegSize(Buffer.from('jpg')),null);
});

function record(cents:number,personId:number,index:number):Expense{
  return {id:`r${personId}-${index}`,personId,year:2025,month:1,category:'TEST',supplier:'Fornecedor',supplierKey:'k',supplierVerified:false,documentId:'1',documentNumber:'1',date:null,receipt:null,cents,documentCents:cents,disallowedCents:0,source:{url:'https://dadosabertos.camara.leg.br/api/v2/x',sha256:'s',row:index,fetchedAt:'2025-03-01T00:00:00Z'}};
}
function version():Snapshot{
  const records=[record(100,1,0),record(250,2,1)],ids=[1,2];
  const people=[{id:1,name:'Ana <&"> Souza',photo:'x',sourceUrl:'https://www.camara.leg.br/deputados/1',profileFetchedAt:'2025-03-01T00:00:00Z',uf:'SP',party:'PL'},{id:2,name:'Zé Ávila',photo:null,sourceUrl:'https://www.camara.leg.br/deputados/2',profileFetchedAt:'2025-03-01T00:00:00Z',uf:'BA',party:null}];
  const body={metric:'test.metric',scope:{year:2025,months:[1],ids,legislature:57},people,records,collectedAt:'2025-03-01T00:00:00Z',publishedAt:'2025-03-01T00:00:00Z',pages:[],validation:{stablePasses:2,recordCount:2,totalCents:350,independentTotalCents:'350',duplicatePolicy:'x',limitations:[]}};
  return {...body,id:snapshotId(body)};
}
async function tree(root:string,dir=root):Promise<Record<string,string>>{
  const out:Record<string,string>={};
  for(const e of await fs.readdir(dir,{withFileTypes:true})){const full=path.join(dir,e.name);if(e.isDirectory())Object.assign(out,await tree(root,full));else out[path.relative(root,full)]=(await fs.readFile(full)).toString('base64');}
  return out;
}
async function built(options:Parameters<typeof buildSite>[3],task:(dist:string,publicationId:string)=>Promise<void>){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-prerender-')),portraits=path.join(dir,'portraits'),db=await openDB(true);
  await fs.mkdir(portraits);await fs.writeFile(path.join(portraits,'1.jpg'),Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x01,0x90,0x01,0x2c,0x01,0x01,0x11,0x00,0xff,0xd9]));
  try{
    const v=version();await publishDomain(db,'despesas',v);await recordDomainAudit(db,v.id,'passed',{checkedAt:'2025-03-02T00:00:00Z'});
    const {publicationId}=await buildSite(db,path.join(dir,'dist'),portraits,options);
    await task(path.join(dir,'dist'),publicationId);
  }finally{await db.close();await fs.rm(dir,{recursive:true,force:true});}
}
test('a build writes deputy, state and home pages and rebuilds byte for byte',()=>built({siteUrl:SITE,sitemap:true},async(dist,id)=>{
  const ana=await fs.readFile(path.join(dist,'deputado','1-ana-souza.html'),'utf8');
  assert.ok(ana.includes('<title>Ana &lt;&amp;&quot;&gt; Souza — Clareia</title>'));
  assert.equal(meta(ana,'og:image'),`${SITE}/data/${id}/portraits/1.jpg`);
  assert.equal(meta(ana,'og:image:width'),'300');
  assert.equal(meta(ana,'og:image:height'),'400');
  assert.ok(ana.includes('<script defer src="/view.js"></script>'));
  const ze=await fs.readFile(path.join(dist,'deputado','2-ze-avila.html'),'utf8');
  assert.equal(meta(ze,'og:image'),`${SITE}/icon-512.png`);
  assert.equal((await fs.readdir(path.join(dist,'estado'))).length,27);
  assert.ok((await fs.readFile(path.join(dist,'estado','SP.html'),'utf8')).includes('São Paulo: 1 deputado neste recorte.'));
  assert.ok((await fs.readFile(path.join(dist,'sitemap.xml'),'utf8')).includes(`${SITE}/deputado/2-ze-avila`));
  assert.ok((await fs.readFile(path.join(dist,'robots.txt'),'utf8')).includes(`Sitemap: ${SITE}/sitemap.xml`));
  const first=await tree(dist);
  await built({siteUrl:SITE,sitemap:true},async(again)=>{assert.deepEqual(await tree(again),first);});
}));
test('a noindex build has no sitemap and disallows everything; both flags together are refused',async()=>{
  await built({noindex:true},async dist=>{
    await assert.rejects(fs.access(path.join(dist,'sitemap.xml')));
    assert.equal(await fs.readFile(path.join(dist,'robots.txt'),'utf8'),'User-agent: *\nDisallow: /\n');
  });
  const db=await openDB(true);
  try{await assert.rejects(buildSite(db,path.join(os.tmpdir(),'never'),os.tmpdir(),{sitemap:true,noindex:true}),/não podem ser usados juntos/);}finally{await db.close();}
});
test('the local server answers a prerendered route with its own page',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-serve-'));
  await fs.mkdir(path.join(dir,'deputado'),{recursive:true});
  await fs.writeFile(path.join(dir,'index.html'),'home');await fs.writeFile(path.join(dir,'deputado','1-ana.html'),'ana');
  const server=createApp(dir,0);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try{
    assert.equal(await (await fetch(url+'/deputado/1-ana')).text(),'ana');
    assert.equal(await (await fetch(url+'/deputado/2-outro')).text(),'home');
    assert.equal((await fetch(url+'/data/x/nao-existe.json')).status,404);
  }finally{server.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('static pages are prerendered at their own route, with the same meta tags as the other pages',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-static-'));
  try{
    await fs.writeFile(path.join(dir,'index.html'),shell);
    await writeStaticPages(dir,resolveOptions({siteUrl:SITE}));
    for(const route of ['sobre','correcoes','metodologia']){
      const html=await fs.readFile(path.join(dir,route+'.html'),'utf8');
      assert.match(html,/<title>[^<]+ — Clareia<\/title>/);
      assert.ok(html.includes(`<link rel="canonical" href="${SITE}/${route}">`));
      assert.ok(html.includes(`<meta property="og:url" content="${SITE}/${route}">`));
      assert.match(html,/<meta name="description" content="[^"]+">/);
      assert.ok(html.includes('<noscript><main id="main">'));
    }
    assert.equal(await fs.readFile(path.join(dir,'corrections.json'),'utf8'),await fs.readFile(path.join(import.meta.dirname,'..','config','corrections.json'),'utf8'));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('the corrections page shows the placeholder while no contact address is set, and escapes contact and entries',async()=>{
  const pages=await loadStaticPages();
  assert.equal(pages.CONTACT_EMAIL,'');
  const empty=pages.pages.correcoes.body([],pages.CONTACT_EMAIL);
  assert.ok(empty.includes('Canal de correções em configuração.'));
  assert.ok(!empty.includes('mailto:'));
  assert.ok(empty.includes('Nenhuma correção registrada até agora.'));
  assert.ok(empty.includes(pages.POLICY));
  const set=pages.pages.correcoes.body([],'a&"<b>');
  assert.ok(set.includes('href="mailto:a&amp;&quot;&lt;b&gt;"'));
  assert.ok(!set.includes('<b>'));
  const entry=pages.pages.correcoes.body([{date:'2026-11-12',title:'<script>x</script>',detail:'a & b'}],'');
  assert.ok(!entry.includes('<script>'));
  assert.ok(entry.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(entry.includes('<time datetime="2026-11-12">12/11/2026</time>'));
});
test('the about and methodology texts name the project, not a person, and carry no contact address',async()=>{
  const pages=await loadStaticPages();
  const text=[pages.pages.sobre.body(),pages.pages.correcoes.body([],''),pages.pages.metodologia.naoConcluimos,pages.pages.metodologia.privacidade].join(' ');
  assert.ok(text.includes('Projeto Clareia'));
  assert.ok(text.includes('Gasto maior não significa irregularidade'));
  assert.doesNotMatch(text,/[\w.+-]+@[\w-]+\.[\w.]+/);
});
