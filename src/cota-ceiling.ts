import {parse} from 'parse5';
import {canonical,hash,UFS} from './model.ts';

export const CEILING_SOURCES={
  consolidated:'https://www2.camara.leg.br/legin/int/atomes/2009/atodamesa-43-21-maio-2009-588364-normaatualizada-cd-mesa.html',
  original:'https://www2.camara.leg.br/legin/int/atomes/2023/atodamesa-270-19-janeiro-2023-793708-publicacaooriginal-166895-cd-mesa.html',
  recomposition:'https://www2.camara.leg.br/legin/int/atomes/2026/atodamesa-244-20-fevereiro-2026-798720-publicacaooriginal-178157-cd-mesa.html'
} as const;
export type CeilingSourceKey=keyof typeof CEILING_SOURCES;
export type CeilingFiles=Record<CeilingSourceKey,Uint8Array>;
export type CeilingSource={key:CeilingSourceKey;url:string;sha256:string;bytes:number;fetchedAt:string};
export type CeilingRow={uf:string;year:number;month:number;ceilingCents:number;act:string;effectiveFrom:string;annexUrl:string;actUrl:string};
export const CEILING_ACT='Ato da Mesa nº 270/2023, Anexo I (Anexo Único do Ato da Mesa nº 43/2009)';
export const CEILING_EFFECTIVE_FROM='2023-02-01';
// Ato da Mesa nº 244/2026 enters into force on 2026-02-20; months before it still use the 2023 annex.
export const CEILING_YEARS=[2024,2025];

const dom=(bytes:Uint8Array):any=>{try{return parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('HTML do ato inválido');}};
function nodes(root:any):any[]{
  const stack=[{node:root,depth:0}],all:any[]=[];
  while(stack.length){const {node,depth}=stack.pop()!;if(depth>300||all.length>=200_000)throw Error('HTML do ato complexo demais');all.push(node);for(const child of [...(node.childNodes??[])].reverse())stack.push({node:child,depth:depth+1});}
  return all;
}
const text=(node:any)=>nodes(node).filter(n=>n.nodeName==='#text').map(n=>n.value).join(' ').replace(/\s+/g,' ').trim();
// Whitespace and ordinal marks vary inside the official markup, so needles are matched without them.
export const flat=(value:string)=>value.replace(/[\s ]+/g,'').replace(/[º°]/g,'o').toLowerCase();
export function moneyCents(value:string):number{
  if(!/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(value))throw Error('Valor do limite inválido');
  return Number(value.replace(/\./g,'').replace(',',''));
}
export function parseAnnex(bytes:Uint8Array):Map<string,number>{
  const root=dom(bytes),tables=nodes(root).filter(n=>n.tagName==='table'&&flat(text(n)).startsWith('unidadedafederaçãovalordacota(r$)'));
  if(tables.length!==1)throw Error('Anexo do limite ausente ou ambíguo');
  const out=new Map<string,number>();
  for(const tr of nodes(tables[0]).filter(n=>n.tagName==='tr')){
    const cells=(tr.childNodes??[]).filter((n:any)=>n.tagName==='td');
    if(cells.length!==2)throw Error('Colunas do anexo mudaram');
    const uf=text(cells[0]);if(flat(uf).startsWith('unidade'))continue;
    if(!UFS.has(uf)||out.has(uf))throw Error('UF do anexo inválida ou repetida');
    out.set(uf,moneyCents(text(cells[1])));
  }
  if(out.size!==UFS.size)throw Error('O anexo não tem as 27 UFs');
  return out;
}
export function requirePhrases(bytes:Uint8Array,phrases:string[]):void{
  const page=flat(text(dom(bytes)));
  for(const phrase of phrases)if(!page.includes(flat(phrase)))throw Error('Ato mudou: '+phrase);
}
export const ANNEX_PHRASES=['Anexo ao Ato da Mesa nº 270, de 19/1/2023','em vigor em 1º/2/2023'];
export const ORIGINAL_PHRASES=['ATO DA MESA Nº 270, DE 19/01/2023','Art. 4º Fica alterada a tabela de limites mensais referentes à Cota para o Exercício da Atividade Parlamentar, constante do Anexo do Ato da Mesa n. 43, de 2009','Art. 7º Este Ato entra em vigor em 1º de fevereiro de 2023'];
export const RECOMPOSITION_PHRASES=['ATO DA MESA Nº 244, DE 20/02/2026','entre fevereiro de 2023 e dezembro de 2025','Art. 2º Este Ato entra em vigor na data de sua publicação','Diário da Câmara dos Deputados de 20/02/2026'];

export function deriveCeiling(year:number,files:CeilingFiles):{annex:[string,number][]} {
  if(!CEILING_YEARS.includes(year))throw Error('Ano sem limite confirmado pelas fontes');
  requirePhrases(files.consolidated,ANNEX_PHRASES);requirePhrases(files.original,ORIGINAL_PHRASES);requirePhrases(files.recomposition,RECOMPOSITION_PHRASES);
  return {annex:[...parseAnnex(files.consolidated)].sort((a,b)=>a[0]<b[0]?-1:1)};
}
export function ceilingReport(year:number,derived:{annex:[string,number][]},sources:CeilingSource[],generatedAt:string){
  const rows:CeilingRow[]=[];
  for(const [uf,ceilingCents] of derived.annex)for(let month=1;month<=12;month++)rows.push({uf,year,month,ceilingCents,act:CEILING_ACT,effectiveFrom:CEILING_EFFECTIVE_FROM,annexUrl:CEILING_SOURCES.consolidated,actUrl:CEILING_SOURCES.original});
  return {schema:'clareia.cota-ceiling.v1',year,unit:'monthly-ceiling-per-uf-cents',generatedAt,sources,rows,metrics:{ufs:derived.annex.length,rows:rows.length},publicationEligible:false,notes:['Limite mensal base do Anexo Único; não inclui adicionais de cargo, trechos aéreos do art. 1º §3º, Mercosul nem a proporcionalidade do art. 11.']};
}
export type CeilingReport=ReturnType<typeof ceilingReport>;
export const ceilingSha=(report:CeilingReport)=>hash(canonical(report));
