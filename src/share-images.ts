import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from './model.ts';
import {esc} from './prerender.ts';
import type {Deputy,Period} from './prerender.ts';
import {DISCLAIMER,FORMATS,SOURCE,monogram,monogramColors,nameSize,shareFactOf,shareHash,shareName,valueSize} from './share-facts.ts';
import type {ShareFact,ShareFormat} from './share-facts.ts';

export type ShareAssets={css:string;logo:string;sha:string};
type Portrait=Uint8Array|null;

const FONT_FILES:[string,string,string][]=[['Newsreader','newsreader-latin.woff2','200 800'],['Public Sans','public-sans-latin.woff2','100 900']];

export async function loadShareAssets(pageDir:string):Promise<ShareAssets>{
  const parts:string[]=[],shas:string[]=[];
  for(const [family,file,weight] of FONT_FILES){
    const bytes=await fs.readFile(path.join(pageDir,'fonts',file));
    shas.push(hash(bytes));
    parts.push(`@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2");font-weight:${weight};font-style:normal}`);
  }
  const svg=await fs.readFile(path.join(pageDir,'icon.svg'),'utf8');
  shas.push(hash(svg));
  return {css:parts.join(''),logo:`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,sha:hash(shas.join(' '))};
}

const STYLE=`
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#faf9f6}
body{font-family:"Public Sans",sans-serif;color:#0b0e18;-webkit-font-smoothing:antialiased}
.card{position:relative;display:flex;flex-direction:column;overflow:hidden;background:#faf9f6;border-top:10px solid #1551ff}
.wide{width:1200px;height:630px;padding:34px 56px 30px}
.square{width:1080px;height:1080px;padding:56px 64px 52px}
.head{display:flex;align-items:center;gap:14px}
.logo{width:50px;height:50px;border-radius:12px}
.brand{font:600 32px "Newsreader",serif;letter-spacing:-.01em}
.body{flex:1;min-height:0;display:grid}
.wide .body{grid-template-columns:minmax(0,1fr) 290px;grid-template-rows:auto minmax(0,1fr);column-gap:44px;margin-top:24px}
.square .body{grid-template-columns:320px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr);column-gap:44px;margin-top:40px}
.photo{border-radius:16px;overflow:hidden;background:#e8edff}
.photo img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.mono{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font:600 96px "Newsreader",serif}
.wide .photo{grid-column:2;grid-row:1/3;height:386px;align-self:start}
.square .photo{grid-column:1;grid-row:1;height:400px}
.who{min-width:0}
.square .who{align-self:center}
.name{font-family:"Newsreader",serif;font-weight:600;line-height:1.06;letter-spacing:-.015em;overflow-wrap:anywhere}
.wide .name.xl{font-size:68px}.wide .name.l{font-size:58px}.wide .name.m{font-size:48px}.wide .name.s{font-size:40px}.wide .name.xs{font-size:33px}
.square .name.xl{font-size:62px}.square .name.l{font-size:54px}.square .name.m{font-size:46px}.square .name.s{font-size:39px}.square .name.xs{font-size:33px}
.context{margin-top:12px;font-size:24px;line-height:1.3;color:#656977}
.fact{align-self:end;min-width:0}
.wide .fact{grid-column:1;grid-row:2}
.square .fact{grid-column:1/3;grid-row:2;margin-top:40px}
.label{font-size:24px;font-weight:500;color:#656977}
.value{margin-top:6px;font-family:"Newsreader",serif;font-weight:600;color:#1551ff;line-height:1.04;letter-spacing:-.02em;font-variant-numeric:lining-nums tabular-nums;overflow-wrap:anywhere}
.wide .value.big{font-size:92px}.wide .value.mid{font-size:68px}.wide .value.small{font-size:50px}
.value.big,.value.mid{white-space:nowrap}
.square .value.big{font-size:118px}.square .value.mid{font-size:92px}.square .value.small{font-size:68px}
.notes{margin-top:14px;font-size:21px;line-height:1.35;color:#3a3f4e;max-width:900px}
.square .notes{font-size:25px}
.foot{display:flex;justify-content:space-between;gap:24px;margin-top:18px;padding-top:14px;border-top:1px solid #dbdcd9;font-size:19px;color:#656977}
.square .foot{font-size:23px;margin-top:28px;padding-top:20px}
.foot b{font-weight:600;color:#0b0e18}
`;

export const CSP="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'";

export function shareBody(fact:ShareFact,format:ShareFormat,assets:Pick<ShareAssets,'logo'>,portrait:Portrait):string{
  const mono=monogramColors(fact.deputyId);
  const picture=portrait
    ?`<img src="data:image/jpeg;base64,${Buffer.from(portrait).toString('base64')}" alt="">`
    :`<div class="mono" style="background:${mono.background};color:${mono.ink}">${esc(monogram(fact.name))}</div>`;
  return `<div class="card ${format}" lang="pt-BR">`
    +`<div class="head"><img class="logo" src="${assets.logo}" alt=""><span class="brand">Clareia</span></div>`
    +`<div class="body"><div class="who"><h1 class="name ${nameSize(fact.name,format)}">${esc(fact.name)}</h1><p class="context">${esc(fact.context)}</p></div>`
    +`<div class="photo">${picture}</div>`
    +`<div class="fact">${fact.label?`<p class="label">${esc(fact.label)}</p>`:''}<p class="value ${valueSize(fact.value)}">${esc(fact.value)}</p>${fact.notes.map(n=>`<p class="notes">${esc(n)}</p>`).join('')}</div></div>`
    +`<div class="foot"><span>${esc(SOURCE)}</span><b>${esc(DISCLAIMER)}</b></div></div>`;
}

export function shareDocument(fact:ShareFact,format:ShareFormat,assets:ShareAssets,portrait:Portrait):string{
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${assets.css}${STYLE}</style></head><body>${shareBody(fact,format,assets,portrait)}</body></html>`;
}
const shell=(assets:ShareAssets)=>`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${assets.css}${STYLE}</style></head><body></body></html>`;

export function pngSize(b:Uint8Array):{width:number;height:number}|null{
  const buf=Buffer.from(b.buffer,b.byteOffset,b.length);
  if(buf.length<24||buf.readUInt32BE(0)!==0x89504e47||buf.toString('latin1',12,16)!=='IHDR')return null;
  return {width:buf.readUInt32BE(16),height:buf.readUInt32BE(20)};
}

type Job={fact:ShareFact;format:ShareFormat;portrait:Portrait};
type Page={setViewportSize(s:{width:number;height:number}):Promise<void>;setContent(html:string):Promise<void>;evaluate:(fn:any,arg?:any)=>Promise<any>;screenshot(o:object):Promise<Buffer>};

// The check runs in the page: the card must contain everything it was asked to show, and the portrait must have loaded.
const FIT=`async html=>{
  document.body.innerHTML=html;
  await Promise.all(['600 40px Newsreader','400 20px "Public Sans"','500 20px "Public Sans"','600 20px "Public Sans"'].map(f=>document.fonts.load(f)));
  await document.fonts.ready;
  await Promise.all([...document.images].map(i=>i.decode()));
  const card=document.querySelector('.card'),box=card.getBoundingClientRect(),bad=[];
  if(card.scrollHeight>card.clientHeight+1||card.scrollWidth>card.clientWidth+1)bad.push('card');
  for(const el of card.querySelectorAll('.name,.context,.label,.value,.notes,.foot span,.foot b')){const r=el.getBoundingClientRect();if(r.right>box.right-1||r.bottom>box.bottom-1||el.scrollWidth>el.clientWidth+1)bad.push(el.className);}
  const who=card.querySelector('.who').getBoundingClientRect(),fact=card.querySelector('.fact').getBoundingClientRect();
  if(who.bottom>fact.top+1)bad.push('overlap');
  if(!['Newsreader','Public Sans'].every(f=>document.fonts.check('20px "'+f+'"')))bad.push('fonts');
  return bad;
}`;

export type Renderer={render(job:Job):Promise<Buffer>;close():Promise<void>};
export async function openRenderer(assets:ShareAssets,concurrency=4):Promise<Renderer>{
  let chromium;
  try{({chromium}=await import('playwright'));}
  catch(e){throw new Error('Playwright ausente. Rode npm ci e npx playwright install chromium',{cause:e});}
  const browser=await chromium.launch().catch((e:Error)=>{throw new Error(`Chromium indisponível: rode npx playwright install chromium (${e.message.split('\n')[0]})`,{cause:e});});
  const context=await browser.newContext({offline:true,serviceWorkers:'block',deviceScaleFactor:1});
  // Nothing may leave the page: the template only uses data: URLs.
  await context.route('**/*',r=>r.abort());
  const pages:Page[]=[];
  for(let i=0;i<concurrency;i++){const page=await context.newPage() as unknown as Page;await page.setContent(shell(assets));pages.push(page);}
  const idle=[...pages],waiting:((p:Page)=>void)[]=[];
  const take=()=>new Promise<Page>(res=>{const p=idle.pop();if(p)res(p);else waiting.push(res);});
  const give=(p:Page)=>{const w=waiting.shift();if(w)w(p);else idle.push(p);};
  return {
    async render(job){
      const page=await take();
      try{
        const {width,height}=FORMATS[job.format];
        await page.setViewportSize({width,height});
        const bad:string[]=await page.evaluate(`(${FIT})(${JSON.stringify(shareBody(job.fact,job.format,assets,job.portrait))})`);
        if(bad.length)throw new Error(`Imagem de compartilhamento de ${job.fact.deputyId} (${job.format}) não cabe no modelo: ${bad.join(', ')}`);
        return await page.screenshot({type:'png',clip:{x:0,y:0,width,height}});
      }finally{give(page);}
    },
    async close(){await browser.close();}
  };
}

export type ShareResult={names:Map<number,{name:string;alt:string}>;rendered:number;reused:number;ms:number};
const exists=(file:string)=>fs.access(file).then(()=>true,()=>false);

export async function generateShareImages(o:{outDir:string;publicationId:string;deputies:Deputy[];period:Period;portraitsDir:string;pageDir:string;cacheDir:string;renderer?:Renderer}):Promise<ShareResult>{
  const started=Date.now(),assets=await loadShareAssets(o.pageDir),dir=path.join(o.outDir,'data',o.publicationId,'share');
  await fs.mkdir(dir,{recursive:true});await fs.mkdir(o.cacheDir,{recursive:true});
  const plan=await Promise.all(o.deputies.map(async p=>{
    const portrait=await fs.readFile(path.join(o.portraitsDir,`${p.id}.jpg`)).catch(()=>null),fact=shareFactOf(p,o.period),h=shareHash(fact,portrait,assets.sha);
    return {id:p.id,fact,portrait,hash:h};
  }));
  const keep=new Set<string>(),todo:{item:typeof plan[number];format:ShareFormat}[]=[];
  for(const item of plan)for(const format of Object.keys(FORMATS) as ShareFormat[]){
    const file=`${item.hash}${FORMATS[format].suffix}.png`;keep.add(file);
    if(!await exists(path.join(o.cacheDir,file)))todo.push({item,format});
  }
  todo.sort((a,b)=>a.format===b.format?0:a.format==='wide'?-1:1);
  if(todo.length){
    const renderer=o.renderer??await openRenderer(assets);
    try{
      let next=0;
      const worker=async()=>{for(;;){
        const t=todo[next++];if(!t)return;
        const png=await renderer.render({fact:t.item.fact,format:t.format,portrait:t.item.portrait}),size=pngSize(png),want=FORMATS[t.format];
        if(!size||size.width!==want.width||size.height!==want.height)throw new Error(`Imagem de compartilhamento de ${t.item.id} fora do tamanho ${want.width}x${want.height}`);
        const file=path.join(o.cacheDir,`${t.item.hash}${want.suffix}.png`);
        await fs.writeFile(file+'.tmp',png);await fs.rename(file+'.tmp',file);
      }};
      await Promise.all(Array.from({length:4},worker));
    }finally{if(!o.renderer)await renderer.close();}
  }
  const names=new Map<number,{name:string;alt:string}>();
  for(const item of plan){
    for(const format of Object.keys(FORMATS) as ShareFormat[])await fs.copyFile(path.join(o.cacheDir,`${item.hash}${FORMATS[format].suffix}.png`),path.join(dir,shareName(item.id,item.hash,format)));
    names.set(item.id,{name:`${item.id}-${item.hash.slice(0,12)}`,alt:item.fact.alt});
  }
  for(const f of await fs.readdir(o.cacheDir))if(f.endsWith('.png')&&!keep.has(f))await fs.rm(path.join(o.cacheDir,f));
  const served=new Set([...names.values()].flatMap(n=>[`${n.name}.png`,`${n.name}-square.png`,'index.json']));
  for(const f of await fs.readdir(dir))if(!served.has(f))await fs.rm(path.join(dir,f));
  await fs.writeFile(path.join(dir,'index.json'),JSON.stringify(Object.fromEntries([...names].sort((a,b)=>a[0]-b[0]).map(([id,n])=>[id,n.name]))));
  return {names,rendered:todo.length,reused:plan.length*2-todo.length,ms:Date.now()-started};
}
