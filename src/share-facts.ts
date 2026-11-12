import {canonical,hash} from './model.ts';
import {exclusionNote,money,partyText,spanOf} from './prerender.ts';
import type {Deputy,Period} from './prerender.ts';
import type {CeilingUse,Standing} from './ceiling-use.ts';

export const TEMPLATE_VERSION=3,JPEG_QUALITY=85;
export const FORMATS={wide:{width:1200,height:630,suffix:''},square:{width:1080,height:1080,suffix:'-square'}} as const;
export type ShareFormat=keyof typeof FORMATS;

export const DISCLAIMER='Gasto maior não indica irregularidade';
export const SOURCE='Dados oficiais da Câmara dos Deputados';

export type ShareStatus='full'|'partial'|'review'|'few-months'|'no-exercise';
export type ShareFact={deputyId:number;name:string;context:string;status:ShareStatus;label:string;value:string;ceiling:string;notes:string[];alt:string};

const pct=(tenths:number)=>(tenths/10).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
// The position only appears with at least two comparable peers; a figure that is not confirmed gets no line at all.
export function ceilingLine(use:CeilingUse|undefined,standing:Standing|null):string{
  if(use?.status!=='ok')return '';
  const ufs=[...new Set(use.counted.map(c=>c.uf))];
  if(ufs.length!==1)return '';
  const head=`${pct(use.tenths)}% do teto da cota do ${ufs[0]}`;
  if(!standing||standing.uf!==ufs[0]||standing.total<2)return head;
  const {rank,total}=standing;
  return `${head} · ${rank===1?'maior uso':rank===total?'menor uso':`${rank}º maior uso`} entre ${total} deputados comparáveis do estado`;
}

// The words come from the same helpers as deputyDescription, so the image says what the page says for the same person.
export function shareFactOf(p:Deputy,period:Period,standing:Standing|null=null):ShareFact{
  const context=['Deputado(a) federal',p.uf,partyText(p)].filter(Boolean).join(' · ');
  const note=p.noExercise?'':exclusionNote(p,period);
  const status:ShareStatus=p.noExercise?'no-exercise':p.heldMonths.length&&!p.hasCells?'review':p.heldMonths.length?'partial':note?'few-months':'full';
  const label=p.noExercise?'':`Despesas no recorte (${spanOf(period)})`;
  const value=p.noExercise?`Sem exercício confirmado em ${period.year}`:status==='review'?'Em revisão':money(p.cents);
  const ceiling=status==='full'||status==='few-months'?ceilingLine(p.use,standing):'';
  return {deputyId:p.id,name:p.name,context,status,label,value,ceiling,notes:note?[note]:[],alt:`Imagem de compartilhamento de ${p.name}. ${[label,value].filter(Boolean).join(': ')}. ${ceiling?ceiling+'. ':''}${DISCLAIMER}.`};
}

const PARTICLES=new Set(['de','da','do','das','dos','e']);
export function monogram(name:string):string{
  const words=name.normalize('NFC').split(/\s+/).filter(w=>/\p{L}/u.test(w));
  const main=words.filter(w=>!PARTICLES.has(w.toLowerCase()));
  const pick=main.length?main:words;
  const letter=(w:string)=>(w.match(/\p{L}/u)?.[0]??'').toLocaleUpperCase('pt-BR');
  if(!pick.length)return '?';
  return pick.length===1?letter(pick[0]):letter(pick[0])+letter(pick.at(-1)!);
}
const MONOGRAM_COLORS:[string,string][]=[['#e8edff','#1551ff'],['#e6eee5','#215e48'],['#f4e9d8','#7a4a0c'],['#efe6f3','#5b2a73'],['#f3e4e2','#9c2f28'],['#e3edf2','#1f5673']];
export const monogramColors=(id:number):{background:string;ink:string}=>{const [background,ink]=MONOGRAM_COLORS[Math.abs(id)%MONOGRAM_COLORS.length];return {background,ink};};

// Picks the type size from what has to fit, so a long name shrinks instead of overflowing; the renderer still rejects any overflow.
export type NameSize='xl'|'l'|'m'|'s'|'xs';
export function nameSize(name:string,format:ShareFormat):NameSize{
  const n=[...name].length,limits=format==='wide'?[22,32,44,60]:[18,28,40,56];
  return n<=limits[0]?'xl':n<=limits[1]?'l':n<=limits[2]?'m':n<=limits[3]?'s':'xs';
}
export function valueSize(value:string):'big'|'mid'|'small'{
  const n=[...value].length;
  return n<=15?'big':n<=21?'mid':'small';
}

export function shareHash(fact:ShareFact,portrait:Uint8Array|null,assetsSha:string):string{
  return hash(canonical({version:TEMPLATE_VERSION,quality:JPEG_QUALITY,fact,portrait:portrait?hash(portrait):null,assets:assetsSha}));
}
export const shareName=(id:number,contentHash:string,format:ShareFormat)=>`${id}-${contentHash.slice(0,12)}${FORMATS[format].suffix}.jpg`;
