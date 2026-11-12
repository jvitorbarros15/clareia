import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import type {Person} from './model.ts';
import {ceilingUse} from './ceiling-use.ts';
import type {CeilingUse} from './ceiling-use.ts';
import type {SiteSummary,SupplierSummary} from './site-summary.ts';

const REPO=path.join(import.meta.dirname,'..');
export const DEFAULT_SITE_URL='https://clareia.clareia.workers.dev';
export const UFS:Record<string,string>={AC:'Acre',AL:'Alagoas',AM:'Amazonas',AP:'Amapá',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',MA:'Maranhão',MG:'Minas Gerais',MS:'Mato Grosso do Sul',MT:'Mato Grosso',PA:'Pará',PB:'Paraíba',PE:'Pernambuco',PI:'Piauí',PR:'Paraná',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RO:'Rondônia',RR:'Roraima',RS:'Rio Grande do Sul',SC:'Santa Catarina',SE:'Sergipe',SP:'São Paulo',TO:'Tocantins'};
const MONTHS=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTH_ABBR=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const ICON='/icon-512.png';
export const SHARE_WIDTH=1200,SHARE_HEIGHT=630;

export type SiteOptions={siteUrl?:string;sitemap?:boolean;noindex?:boolean;shareImages?:boolean};
export type ResolvedOptions={siteUrl:string;sitemap:boolean;noindex:boolean;shareImages:boolean};

export function resolveOptions(options:SiteOptions={}):ResolvedOptions{
  const sitemap=Boolean(options.sitemap),noindex=Boolean(options.noindex);
  if(sitemap&&noindex)throw new Error('--sitemap e --noindex não podem ser usados juntos');
  let url:URL;
  try{url=new URL(options.siteUrl||DEFAULT_SITE_URL);}catch{throw new Error('--site-url inválido');}
  if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('--site-url deve ser só a origem, como https://exemplo.com');
  return {siteUrl:url.origin,sitemap,noindex,shareImages:Boolean(options.shareImages)};
}

export const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const plain=(value:string)=>value.replace(/\s+/g,' ').trim();
const norm=(value:string)=>value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
// The same rule as slugOf and deputyPath in real/app.js: the page and the app must agree on the address.
export const slugOf=(name:string)=>norm(name).replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
export const deputyPath=(officialId:number,name:string)=>`/deputado/${officialId}-${slugOf(name)}`;
export const statePath=(uf:string)=>`/estado/${uf}`;
export const money=(cents:number)=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/^-/,'−');

export type Deputy={id:number;name:string;uf:string|null;party:string|null;partyInReview:boolean;lastConfirmedParty:string|null;sourceUrl:string;exercisedMonths:number;noExercise:boolean;heldMonths:number[];cents:number;hasCells:boolean;projects:number|null;use?:CeilingUse};
export type Period={year:string;coverage:number[]};

// Mirrors the derivation in real/data.js, so a prerendered page states what the app shows for the same person.
export function deputiesOf(input:{ids:number[];people:Person[];summary:SiteSummary;suppliers:SupplierSummary;months:number[]}):Deputy[]{
  const {summary,suppliers}=input,summaryOf=new Map(summary.people.map(p=>[p.id,p]));
  const exercised=(m:{exercise:string|null;records:number})=>m.exercise!=='outside'||m.records>0;
  const partyOfPeriod=(id:number,current:string|null)=>{
    if(!summary.coverageId)return current?`${current} (atual)`:null;
    const months=summaryOf.get(id)?.months??[],served=months.filter(m=>m.partyStatus!=='not-applicable');
    if(!served.length||served.some(m=>m.partyStatus==='unavailable'||m.partyStatus==='unknown'))return 'Partido indisponível';
    if(served.some(m=>m.partyStatus==='review'||m.partyStatus==='conflict'))return 'Partido em revisão';
    return [...new Set(served.flatMap(m=>m.party?[m.party]:m.partyValues))].join(' / ');
  };
  return input.ids.map(id=>{
    const info=input.people.find(p=>p.id===id),own=summaryOf.get(id),months=summary.coverageId?own?.months??[]:null,party=partyOfPeriod(id,info?.party??null);
    const last=[...(own?.months??[])].filter(m=>m.partyStatus==='single'&&m.party).sort((a,b)=>b.month-a.month)[0]?.party??null;
    const noExercise=!summary.coverageId||(own?.records??0)>0?false:(own?.months??[]).length>0&&(own?.months??[]).every(m=>!m.exercise||['unknown','outside','conflict'].includes(m.exercise));
    return {id,name:plain(info?.name??`ID ${id}`),uf:info?.uf??null,party,partyInReview:party==='Partido em revisão',lastConfirmedParty:last,sourceUrl:info?.sourceUrl??'',exercisedMonths:months?months.filter(exercised).length:input.months.length,noExercise,heldMonths:(own?.months??[]).filter(m=>m.held).map(m=>m.month-1),cents:own?.cents??0,use:ceilingUse(own?.months??[],summary.ceiling,Boolean(summary.coverageId)),hasCells:(suppliers.people[id]??[]).length>0,projects:own?.bills?.proposed??null};
  });
}

export const spanOf=(period:Period)=>`${MONTH_ABBR[period.coverage[0]]}–${MONTH_ABBR[period.coverage.at(-1)!]} ${period.year}`;
export const minMonths=(period:Period)=>Math.min(6,period.coverage.length);
// Same words as partialNote and exclusionNote in real/app.js.
export function exclusionNote(p:Deputy,period:Period):string{
  if(p.heldMonths.length)return `Total parcial: ${p.heldMonths.length===1?`${MONTHS[p.heldMonths[0]].toLowerCase()} de ${period.year} está em revisão`:`${p.heldMonths.length} meses em revisão`} e fora da soma. Não entra em rankings nem comparações.`;
  if(p.exercisedMonths<minMonths(period))return `Exerceu o mandato em ${p.exercisedMonths} de ${period.coverage.length} meses do recorte. Rankings e comparações incluem quem exerceu pelo menos ${minMonths(period)} meses.`;
  return '';
}
export function partyText(p:Deputy):string|null{
  if(p.partyInReview)return p.lastConfirmedParty?`${p.lastConfirmedParty} (último confirmado)`:null;
  if(!p.party||p.party==='Partido indisponível')return null;
  return p.party;
}

export function deputyDescription(p:Deputy,period:Period):string{
  const who=['Deputado(a) federal',p.uf,partyText(p)].filter(Boolean).join(' · ');
  const spend=p.noExercise?`Sem exercício confirmado em ${period.year}.`:p.heldMonths.length&&!p.hasCells?`Despesas no recorte (${spanOf(period)}): Em revisão.`:`Despesas no recorte (${spanOf(period)}): ${money(p.cents)}.`;
  const note=p.noExercise?'':exclusionNote(p,period);
  return [`${who}.`,spend,note,p.projects===null?'':`Projetos como proponente: ${p.projects.toLocaleString('pt-BR',{maximumFractionDigits:1})}.`,'Dados oficiais da Câmara dos Deputados.'].filter(Boolean).join(' ');
}
export function inState(deputies:Deputy[],uf:string):Deputy[]{return deputies.filter(p=>!p.noExercise&&p.uf===uf);}
export function stateDescription(uf:string,deputies:Deputy[],period:Period):string{
  const people=inState(deputies,uf);
  if(!people.length)return `${UFS[uf]}: nenhum deputado neste recorte. Indisponível não significa zero.`;
  const partial=people.filter(p=>p.heldMonths.length).length;
  return [`${UFS[uf]}: ${people.length} ${people.length===1?'deputado':'deputados'} neste recorte.`,`Cota total em ${spanOf(period)}: ${money(people.reduce((n,p)=>n+p.cents,0))} (valor exato).`,partial?`Inclui ${partial} ${partial===1?'deputado com total parcial':'deputados com total parcial'}; meses em revisão ficam fora da soma.`:'','Dados oficiais da Câmara dos Deputados.'].filter(Boolean).join(' ');
}

type Image={url:string;width?:number;height?:number;alt:string;large?:boolean};
type Meta={title:string;description:string;url:string;type:'website'|'profile';image:Image};
function metaTags(m:Meta):string{
  const tags=[`<link rel="canonical" href="${esc(m.url)}">`,`<meta property="og:site_name" content="Clareia">`,`<meta property="og:locale" content="pt_BR">`,`<meta property="og:type" content="${m.type}">`,`<meta property="og:title" content="${esc(m.title)}">`,`<meta property="og:description" content="${esc(m.description)}">`,`<meta property="og:url" content="${esc(m.url)}">`,`<meta property="og:image" content="${esc(m.image.url)}">`];
  if(m.image.width&&m.image.height)tags.push(`<meta property="og:image:width" content="${m.image.width}">`,`<meta property="og:image:height" content="${m.image.height}">`);
  tags.push(...m.image.large?[`<meta property="og:image:type" content="image/jpeg">`]:[],`<meta property="og:image:alt" content="${esc(m.image.alt)}">`,`<meta name="twitter:card" content="${m.image.large?'summary_large_image':'summary'}">`,`<meta name="twitter:title" content="${esc(m.title)}">`,`<meta name="twitter:description" content="${esc(m.description)}">`,`<meta name="twitter:image" content="${esc(m.image.url)}">`,`<meta name="twitter:image:alt" content="${esc(m.image.alt)}">`);
  return tags.join('\n  ');
}
const TITLE=/<title>[^<]*<\/title>/,DESCRIPTION=/<meta name="description" content="[^"]*">/,NOSCRIPT=/<noscript>[^<]*<\/noscript>/;
function swap(shell:string,pattern:RegExp,text:string):string{
  if(!pattern.test(shell))throw new Error(`Esqueleto sem ${pattern.source}`);
  return shell.replace(pattern,()=>text);
}
function page(shell:string,m:Meta,noscript?:string):string{
  let html=swap(shell,TITLE,`<title>${esc(m.title)}</title>`);
  html=swap(html,DESCRIPTION,`<meta name="description" content="${esc(m.description)}">\n  ${metaTags(m)}`);
  return noscript?swap(html,NOSCRIPT,noscript):html;
}
const icon=(siteUrl:string):Image=>({url:siteUrl+ICON,width:512,height:512,alt:'Clareia'});

export function renderHome(shell:string,siteUrl:string):string{
  const title=/<title>([^<]*)<\/title>/.exec(shell)?.[1],description=/<meta name="description" content="([^"]*)">/.exec(shell)?.[1];
  if(!title||!description)throw new Error('Esqueleto sem título ou descrição');
  return swap(shell,DESCRIPTION,`<meta name="description" content="${description}">\n  ${metaTags({title,description,url:siteUrl+'/',type:'website',image:icon(siteUrl)})}`);
}
export function renderDeputy(shell:string,p:Deputy,period:Period,siteUrl:string,portrait:{url:string;width?:number;height?:number}|null,share:{url:string;alt:string}|null=null):string{
  const description=deputyDescription(p,period),title=`${p.name} — Clareia`;
  const image:Image=share?{url:share.url,width:SHARE_WIDTH,height:SHARE_HEIGHT,alt:share.alt,large:true}:portrait?{...portrait,alt:`Retrato oficial de ${p.name}, da Câmara dos Deputados`}:icon(siteUrl);
  const source=/^https:\/\//.test(p.sourceUrl)?` <a href="${esc(p.sourceUrl)}" rel="noopener noreferrer">Cadastro na Câmara</a>`:'';
  const noscript=`<noscript><main id="main"><h1>${esc(p.name)}</h1><p>${esc(description)}</p><p>Ative o JavaScript para explorar os dados.${source}</p></main></noscript>`;
  return page(shell,{title,description,url:siteUrl+deputyPath(p.id,p.name),type:'profile',image},noscript);
}
export function renderState(shell:string,uf:string,deputies:Deputy[],period:Period,siteUrl:string):string{
  const description=stateDescription(uf,deputies,period),title=`${UFS[uf]} — Clareia`;
  const noscript=`<noscript><main id="main"><h1>${esc(UFS[uf])}</h1><p>${esc(description)}</p><p>Ative o JavaScript para explorar os dados.</p></main></noscript>`;
  return page(shell,{title,description,url:siteUrl+statePath(uf),type:'website',image:icon(siteUrl)},noscript);
}

export function jpegSize(b:Buffer):{width:number;height:number}|null{
  if(b.length<4||b[0]!==0xff||b[1]!==0xd8)return null;
  let i=2;
  while(i+9<b.length){
    if(b[i]!==0xff){i++;continue;}
    const m=b[i+1];
    if(m===0xff){i++;continue;}
    if(m>=0xc0&&m<=0xcf&&m!==0xc4&&m!==0xc8&&m!==0xcc)return {height:b.readUInt16BE(i+5),width:b.readUInt16BE(i+7)};
    if(m===0xd8||m===0x01||(m>=0xd0&&m<=0xd7)){i+=2;continue;}
    i+=2+b.readUInt16BE(i+2);
  }
  return null;
}

export function sitemapXml(siteUrl:string,deputies:Deputy[]):string{
  const urls=[siteUrl+'/',...Object.keys(UFS).sort().map(uf=>siteUrl+statePath(uf)),...[...deputies].sort((a,b)=>a.id-b.id).map(p=>siteUrl+deputyPath(p.id,p.name))];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u=>`  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}
export function robotsTxt(o:ResolvedOptions):string{
  if(o.noindex)return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\n${o.sitemap?`\nSitemap: ${o.siteUrl}/sitemap.xml\n`:''}`;
}

export type CorrectionEntry={date:string;title:string;detail:string};
type StaticPages={CONTACT_EMAIL:string;POLICY:string;pages:{sobre:{title:string;description:string;body:()=>string};correcoes:{title:string;description:string;body:(list:CorrectionEntry[],email:string)=>string};metodologia:{title:string;description:string;naoConcluimos:string;privacidade:string}}};
// real/pages.js is the one copy of these texts: the browser loads it as a script, and here it is run in an empty sandbox.
export async function loadStaticPages():Promise<StaticPages>{
  const sandbox:{window:{ClareiaPages?:StaticPages}}={window:{}};
  vm.runInNewContext(await fs.readFile(path.join(REPO,'real','pages.js'),'utf8'),sandbox);
  if(!sandbox.window.ClareiaPages)throw new Error('real/pages.js não define ClareiaPages');
  return sandbox.window.ClareiaPages;
}
export async function loadCorrections():Promise<CorrectionEntry[]>{
  const list:unknown=JSON.parse(await fs.readFile(path.join(REPO,'config','corrections.json'),'utf8'));
  if(!Array.isArray(list)||list.some(e=>typeof e!=='object'||e===null||typeof e.date!=='string'||typeof e.title!=='string'||typeof e.detail!=='string'))throw new Error('config/corrections.json deve ser uma lista de {date, title, detail}');
  return list as CorrectionEntry[];
}
export async function writeStaticPages(outDir:string,options:ResolvedOptions):Promise<void>{
  const shell=await fs.readFile(path.join(outDir,'index.html'),'utf8');
  const pages=await loadStaticPages(),corrections=await loadCorrections();
  await fs.copyFile(path.join(REPO,'config','corrections.json'),path.join(outDir,'corrections.json'));
  for(const name of ['sobre','correcoes','metodologia'] as const){
    const entry=pages.pages[name];
    const inner=name==='sobre'?pages.pages.sobre.body():name==='correcoes'?pages.pages.correcoes.body(corrections,pages.CONTACT_EMAIL):`<h1>Metodologia</h1><p>${esc(entry.description)}</p><p>Ative o JavaScript para ler a metodologia completa e os números desta versão.</p>`;
    const noscript=`<noscript><main id="main">${inner}</main></noscript>`;
    // Same rule as the deputy pages: <route>.html, so the route answers without a redirect.
    await fs.writeFile(path.join(outDir,`${name}.html`),page(shell,{title:entry.title,description:entry.description,url:options.siteUrl+`/${name}`,type:'website',image:icon(options.siteUrl)},noscript));
  }
}

export async function writePrerendered(outDir:string,publicationId:string,deputies:Deputy[],period:Period,options:ResolvedOptions,shares:Map<number,{name:string;alt:string}>=new Map()):Promise<void>{
  const shell=await fs.readFile(path.join(outDir,'index.html'),'utf8');
  for(const p of deputies){
    const file=path.join(outDir,'data',publicationId,'portraits',`${p.id}.jpg`),bytes=await fs.readFile(file).catch(()=>null);
    const portrait=bytes?{url:`${options.siteUrl}/data/${publicationId}/portraits/${p.id}.jpg`,...jpegSize(bytes)??{}}:null;
    // A file named <route>.html is served at <route> with no redirect; a folder index would answer 307 to a trailing slash.
    const page=path.join(outDir,`${deputyPath(p.id,p.name).slice(1)}.html`);
    await fs.mkdir(path.dirname(page),{recursive:true});
    await fs.writeFile(page,renderDeputy(shell,p,period,options.siteUrl,portrait,shares.has(p.id)?{url:`${options.siteUrl}/data/${publicationId}/share/${shares.get(p.id)!.name}.jpg`,alt:shares.get(p.id)!.alt}:null));
  }
  for(const uf of Object.keys(UFS)){
    await fs.mkdir(path.join(outDir,'estado'),{recursive:true});
    await fs.writeFile(path.join(outDir,'estado',`${uf}.html`),renderState(shell,uf,deputies,period,options.siteUrl));
  }
  await fs.writeFile(path.join(outDir,'index.html'),renderHome(shell,options.siteUrl));
  await fs.writeFile(path.join(outDir,'robots.txt'),robotsTxt(options));
  if(options.sitemap)await fs.writeFile(path.join(outDir,'sitemap.xml'),sitemapXml(options.siteUrl,deputies));
}
