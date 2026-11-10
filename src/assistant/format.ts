export const MONTH_ABBR=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
export const MONTH_NAMES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

export const money=(cents:number):string=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/^-/,'−');
export const integer=(n:number):string=>n.toLocaleString('pt-BR');
export const decimal=(n:number):string=>n.toLocaleString('pt-BR',{maximumFractionDigits:1});
export const percent=(n:number):string=>`${n.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
export const plural=(n:number,one:string,many:string):string=>n===1?one:many;

export function divRound(a:number,b:number):number{
  const r=Math.floor(Math.abs(a)/b+0.5);
  return a<0?-r:r;
}

export function dateBR(iso:string):string{
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m?`${m[3]}/${m[2]}/${m[1]}`:iso;
}

export function numberTokens(text:string):string[]{return text.match(/\d+(?:[.,]\d+)*/g)??[];}
