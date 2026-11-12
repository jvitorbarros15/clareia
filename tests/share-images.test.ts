import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deputyDescription,renderDeputy} from '../src/prerender.ts';
import type {Deputy,Period} from '../src/prerender.ts';
import {ufStandings} from '../src/ceiling-use.ts';
import type {CeilingUse} from '../src/ceiling-use.ts';
import {ceilingLine,DISCLAIMER,FORMATS,SOURCE,monogram,monogramColors,nameSize,shareFactOf,shareHash,shareName,valueSize} from '../src/share-facts.ts';
import {generateShareImages,loadShareAssets,openRenderer,shareBody,shareDocument} from '../src/share-images.ts';
import {jpegSize} from '../src/prerender.ts';
import type {Renderer} from '../src/share-images.ts';

const PAGE=path.join(import.meta.dirname,'..','real');
const shell=await fs.readFile(path.join(PAGE,'index.html'),'utf8');
const period:Period={year:'2025',coverage:[0,1,2,3,4,5,6,7,8,9,10,11]};
const normal:Deputy={id:100,name:'Maria da Silva',uf:'SP',party:'PL (atual)',partyInReview:false,lastConfirmedParty:null,sourceUrl:'https://www.camara.leg.br/deputados/100',exercisedMonths:12,noExercise:false,heldMonths:[],cents:123456789,hasCells:true,projects:7};
const partial:Deputy={...normal,id:101,heldMonths:[2],cents:-5000};
const none:Deputy={...normal,id:102,noExercise:true,exercisedMonths:0,cents:0};
const assets=await loadShareAssets(PAGE);
const jpeg=Buffer.from([0xff,0xd8,0xff,0xd9]);

test('the fact of a normal deputy states the period and the exact total',()=>{
  const f=shareFactOf(normal,period);
  assert.equal(f.status,'full');
  assert.equal(f.label,'Despesas no recorte (Jan–Dez 2025)');
  assert.equal(f.value,'R$ 1.234.567,89');
  assert.equal(f.context,'Deputado(a) federal · SP · PL (atual)');
  assert.deepEqual(f.notes,[]);
  assert.ok(deputyDescription(normal,period).includes(`${f.label}: ${f.value}.`));
});
test('a partial total carries the exclusion note of the page and a negative value keeps its sign',()=>{
  const f=shareFactOf(partial,period);
  assert.equal(f.status,'partial');
  assert.equal(f.value,'−R$ 50,00');
  assert.deepEqual(f.notes,['Total parcial: março de 2025 está em revisão e fora da soma. Não entra em rankings nem comparações.']);
  assert.ok(deputyDescription(partial,period).includes(f.notes[0]));
  assert.equal(shareFactOf({...partial,hasCells:false},period).value,'Em revisão');
  assert.equal(shareFactOf({...partial,hasCells:false},period).status,'review');
  const few=shareFactOf({...normal,exercisedMonths:3},period);
  assert.equal(few.status,'few-months');
  assert.ok(few.notes[0].startsWith('Exerceu o mandato em 3 de 12 meses'));
});
test('someone with no confirmed exercise never gets a zero',()=>{
  const f=shareFactOf(none,period);
  assert.equal(f.status,'no-exercise');
  assert.equal(f.value,'Sem exercício confirmado em 2025');
  assert.equal(f.label,'');
  assert.ok(!f.value.includes('R$'));
  assert.ok(deputyDescription(none,period).includes(f.value));
});
test('the image always carries the source line and the irregularity caveat, and no ranking words',()=>{
  for(const d of [normal,partial,none]){
    const html=shareBody(shareFactOf(d,period),'wide',assets,null);
    assert.ok(html.includes(DISCLAIMER)&&html.includes(SOURCE));
    assert.ok(!/melhor|pior|ranking:|posição|[0-9]º/i.test(html.replace(/Não entra em rankings nem comparações\./,'')));
  }
});
test('every text from data is escaped in the template',()=>{
  const evil={...normal,name:'<img src=x onerror=alert(1)>&"\'',party:'<b>X</b>'};
  const html=shareBody(shareFactOf(evil,period),'square',assets,null);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>X</b>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;'));
  const doc=shareDocument(shareFactOf(evil,period),'wide',assets,jpeg);
  assert.ok(doc.includes("default-src 'none'"));
  assert.ok(!/https?:\/\//.test(doc.replace(/xmlns="[^"]*"/g,'')));
});
test('a long name picks a smaller size and never a larger one',()=>{
  const order=['xl','l','m','s','xs'];
  for(const format of ['wide','square'] as const){
    let last=0;
    for(let n=1;n<=120;n++){const i=order.indexOf(nameSize('a'.repeat(n),format));assert.ok(i>=last);last=i;}
    assert.equal(nameSize('Ana Lima',format),'xl');
    assert.equal(nameSize('a'.repeat(90),format),'xs');
  }
  assert.equal(valueSize('R$ 1.234.567,89'),'big');
  assert.equal(valueSize('R$ 123.456.789,00'),'mid');
  assert.equal(valueSize('Sem exercício confirmado em 2025'),'small');
});
test('the monogram is deterministic, skips particles and survives odd names',()=>{
  assert.equal(monogram('Maria da Silva'),'MS');
  assert.equal(monogram('Ângela D\'Ávila'),'ÂD');
  assert.equal(monogram('Zé'),'Z');
  assert.equal(monogram('  '),'?');
  assert.equal(monogram('de da'),'DD');
  assert.deepEqual(monogramColors(7),monogramColors(7));
  assert.notDeepEqual(monogramColors(1),monogramColors(2));
  const html=shareBody(shareFactOf(normal,period),'wide',assets,null);
  assert.ok(html.includes('class="mono"')&&html.includes('>MS<'));
  assert.ok(shareBody(shareFactOf(normal,period),'wide',assets,jpeg).includes('data:image/jpeg;base64,'));
});
test('the content hash changes only when an input changes',()=>{
  const f=shareFactOf(normal,period),h=shareHash(f,jpeg,assets.sha);
  assert.equal(h,shareHash(shareFactOf({...normal,projects:99,sourceUrl:'https://x.test',heldMonths:[]},period),jpeg,assets.sha));
  assert.notEqual(h,shareHash(shareFactOf({...normal,cents:normal.cents+1},period),jpeg,assets.sha));
  assert.notEqual(h,shareHash(shareFactOf(partial,period),jpeg,assets.sha));
  assert.notEqual(h,shareHash(shareFactOf(normal,{...period,year:'2026'}),jpeg,assets.sha));
  assert.notEqual(h,shareHash(f,Buffer.from([0xff,0xd8,0x00,0xff,0xd9]),assets.sha));
  assert.notEqual(h,shareHash(f,null,assets.sha));
  assert.notEqual(h,shareHash(f,jpeg,'outro'));
  assert.equal(shareName(100,h,'wide'),`100-${h.slice(0,12)}.jpg`);
  assert.equal(shareName(100,h,'square'),`100-${h.slice(0,12)}-square.jpg`);
});
test('the deputy page points og:image at the horizontal image and falls back to the portrait',()=>{
  const meta=(html:string,key:string)=>new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`).exec(html)?.[1];
  const share={url:'https://example.test/data/p/share/100-abc.jpg',alt:'Imagem'};
  const html=renderDeputy(shell,normal,period,'https://example.test',{url:'https://example.test/p.jpg',width:10,height:20},share);
  assert.equal(meta(html,'og:image'),share.url);
  assert.equal(meta(html,'og:image:width'),'1200');
  assert.equal(meta(html,'og:image:height'),'630');
  assert.equal(meta(html,'og:image:type'),'image/jpeg');
  assert.equal(meta(html,'twitter:card'),'summary_large_image');
  assert.equal(meta(html,'twitter:image'),share.url);
  const plain=renderDeputy(shell,normal,period,'https://example.test',{url:'https://example.test/p.jpg',width:10,height:20});
  assert.equal(meta(plain,'og:image'),'https://example.test/p.jpg');
  assert.equal(meta(plain,'twitter:card'),'summary');
});

const png=(width:number,height:number)=>{const b=Buffer.alloc(40);b.writeUInt16BE(0xffd8,0);b.writeUInt16BE(0xffc0,2);b.writeUInt16BE(11,4);b.writeUInt8(8,6);b.writeUInt16BE(height,7);b.writeUInt16BE(width,9);return b;};
function stub(log:string[]):Renderer{
  return {async render(job){log.push(`${job.fact.deputyId}:${job.format}`);const {width,height}=FORMATS[job.format];return png(width,height);},async close(){}};
}
test('images are cached by content and only changed deputies render again',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'share-'));
  try{
    const portraits=path.join(tmp,'portraits');await fs.mkdir(portraits);await fs.writeFile(path.join(portraits,'100.jpg'),jpeg);
    const run=async(deputies:Deputy[],log:string[])=>generateShareImages({outDir:path.join(tmp,'out'),publicationId:'pub',deputies,period,portraitsDir:portraits,pageDir:PAGE,cacheDir:path.join(tmp,'cache'),renderer:stub(log)});
    const first:string[]=[],a=await run([normal,partial],first);
    assert.equal(first.length,4);assert.equal(a.rendered,4);assert.equal(a.reused,0);
    const index=JSON.parse(await fs.readFile(path.join(tmp,'out','data','pub','share','index.json'),'utf8'));
    assert.deepEqual(Object.keys(index),['100','101']);
    for(const id of ['100','101']){
      for(const f of ['','-square'])assert.ok(jpegSize(await fs.readFile(path.join(tmp,'out','data','pub','share',`${index[id]}${f}.jpg`))));
    }
    assert.equal(a.names.get(100)!.alt,shareFactOf(normal,period).alt);
    const second:string[]=[],b=await run([normal,partial],second);
    assert.deepEqual(second,[]);assert.equal(b.reused,4);
    const third:string[]=[],c=await run([normal,{...partial,cents:-6000}],third);
    assert.deepEqual(third.sort(),['101:square','101:wide']);
    assert.equal(c.reused,2);
    assert.equal((await fs.readdir(path.join(tmp,'cache'))).length,4);
    assert.equal((await fs.readdir(path.join(tmp,'out','data','pub','share'))).length,5);
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test('a render with the wrong size stops the build',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'share-'));
  try{
    const bad:Renderer={async render(){return png(10,10);},async close(){}};
    await assert.rejects(generateShareImages({outDir:path.join(tmp,'out'),publicationId:'pub',deputies:[normal],period,portraitsDir:tmp,pageDir:PAGE,cacheDir:path.join(tmp,'cache'),renderer:bad}),/fora do tamanho 1200x630/);
    assert.deepEqual(await fs.readdir(path.join(tmp,'cache')),[]);
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});

test('real renderer: exact sizes, long name, no portrait, and a layout that does not fit is refused',async t=>{
  let renderer:Renderer;
  try{renderer=await openRenderer(assets,1);}catch(e){t.skip(String((e as Error).message));return;}
  try{
    const long={...normal,id:103,name:'Francisco Pereira Gonçalves de Albuquerque Montenegro Cavalcanti da Rocha Lima Sobrinho',heldMonths:[2,3]};
    for(const d of [normal,partial,none,long])for(const format of ['wide','square'] as const){
      const bytes=await renderer.render({fact:shareFactOf(d,period),format,portrait:null});
      assert.deepEqual(jpegSize(bytes),{width:FORMATS[format].width,height:FORMATS[format].height});
    }
    const absurd={...normal,name:'W'.repeat(400)};
    await assert.rejects(renderer.render({fact:shareFactOf(absurd,period),format:'wide',portrait:null}),/não cabe no modelo/);
  }finally{await renderer.close();}
});

const okUse=(tenths:number,uf='AC'):CeilingUse=>({status:'ok',counted:[{month:1,uf,expenseCents:1,ceilingCents:1,records:1}],excluded:[],outside:[],expenseCents:1,ceilingCents:1,tenths});
test('the ceiling line states the share and the position among comparable deputies of the state',()=>{
  assert.equal(ceilingLine(okUse(818),{uf:'AC',rank:1,total:7}),'81,8% do teto da cota do AC · maior uso entre 7 deputados comparáveis do estado');
  assert.equal(ceilingLine(okUse(818),{uf:'AC',rank:3,total:7}),'81,8% do teto da cota do AC · 3º maior uso entre 7 deputados comparáveis do estado');
  assert.equal(ceilingLine(okUse(1048),{uf:'AC',rank:7,total:7}),'104,8% do teto da cota do AC · menor uso entre 7 deputados comparáveis do estado');
  assert.equal(ceilingLine(okUse(1000),{uf:'AC',rank:1,total:1}),'100,0% do teto da cota do AC');
  assert.equal(ceilingLine(okUse(500),null),'50,0% do teto da cota do AC');
  assert.equal(ceilingLine(okUse(500,'SP'),null),'50,0% do teto da cota de SP');
  assert.equal(ceilingLine(okUse(500,'BA'),null),'50,0% do teto da cota da BA');
  const unconfirmed:CeilingUse={status:'unconfirmed',counted:[],excluded:[],outside:[],missing:[1]};
  assert.equal(ceilingLine(unconfirmed,{uf:'AC',rank:1,total:7}),'');
  assert.equal(ceilingLine(undefined,null),'');
});
test('the position counts only comparable deputies whose counted months are all in one state',()=>{
  const mixed:CeilingUse={...okUse(900),counted:[{month:1,uf:'AC',expenseCents:1,ceilingCents:1,records:1},{month:2,uf:'SP',expenseCents:1,ceilingCents:1,records:1}]} as CeilingUse;
  const s=ufStandings([
    {id:1,name:'Ana',comparable:true,use:okUse(900)},
    {id:2,name:'Bia',comparable:true,use:okUse(950)},
    {id:3,name:'Caio',comparable:false,use:okUse(990)},
    {id:4,name:'Davi',comparable:true,use:mixed},
    {id:5,name:'Eva',comparable:true,use:{status:'unconfirmed',counted:[],excluded:[],outside:[],missing:[1]}},
    {id:6,name:'Fabio',comparable:true,use:okUse(900)},
    {id:7,name:'Gil',comparable:true,use:okUse(100,'SP')}
  ]);
  assert.deepEqual(s.get(2),{uf:'AC',rank:1,total:3});
  assert.deepEqual(s.get(1),{uf:'AC',rank:2,total:3});
  assert.deepEqual(s.get(6),{uf:'AC',rank:3,total:3});
  assert.deepEqual(s.get(7),{uf:'SP',rank:1,total:1});
  for(const id of [3,4,5])assert.equal(s.has(id),false);
});
test('the line reaches the fact and the alt text only for a full or few-months total with a confirmed share',()=>{
  const withUse={...normal,use:okUse(818,'SP')},st={uf:'SP',rank:2,total:5};
  const f=shareFactOf(withUse,period,st);
  assert.equal(f.ceiling,'81,8% do teto da cota de SP · 2º maior uso entre 5 deputados comparáveis do estado');
  assert.ok(f.alt.includes(f.ceiling));
  assert.ok(shareBody(f,'wide',assets,null).includes(f.ceiling));
  assert.equal(shareFactOf({...withUse,heldMonths:[2]},period,st).ceiling,'');
  assert.equal(shareFactOf({...withUse,hasCells:false,heldMonths:[2]},period,st).ceiling,'');
  assert.equal(shareFactOf({...withUse,noExercise:true},period,st).ceiling,'');
  assert.equal(shareFactOf(normal,period).ceiling,'');
});
