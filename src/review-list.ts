import fs from 'node:fs/promises';
import path from 'node:path';
import type {Expense,Person,Snapshot} from './model.ts';
import {SIGN_CATEGORIES} from './expense-publication.ts';

export type ReviewItem={id:number;name:string;used:string;from:string};

// Deputies whose UF is not confirmed month by month: the one their legislature's events agree on, or none.
export const ufReviewItems=(people:Person[]):ReviewItem[]=>people.flatMap(p=>p.uf&&!p.ufNote?[]:[p.uf?{id:p.id,name:p.name,used:p.uf,from:'eventos da legislatura'}:{id:p.id,name:p.name,used:'sem UF',from:'sem UF confirmada'}]);

export type NameTally={name:string;count:number;cents:number};
export type ReviewNames={withheld:NameTally[];kept:NameTally[]};
const nameSection=(title:string,rows:NameTally[])=>rows.length?['','## '+title,'',...rows.map(w=>`- ${w.name} | ${w.count} registros | R$ ${(w.cents/100).toFixed(2)}`)]:[];
export const reviewMarkdown=(publicationId:string,items:ReviewItem[],names:ReviewNames={withheld:[],kept:[]})=>[`# Pendências para revisão - ${publicationId}`,'',...items.map(i=>`- ${i.id} | ${i.name} | usada: ${i.used} | fonte: ${i.from}`),...nameSection('Nomes de fornecedor ocultados',names.withheld),...nameSection('Nomes mantidos pela regra de empresa',names.kept),''].join('\n');

// Never published: output/review is gitignored, outside the site folder, and anchored to the repository, not to the working directory.
export async function writeReview(publicationId:string,items:ReviewItem[],names:ReviewNames={withheld:[],kept:[]}):Promise<number>{
  const file=path.join(import.meta.dirname,'..','output','review',`${publicationId}-pendencias-revisao.md`);
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,reviewMarkdown(publicationId,items,names));
  console.error(`Pendências para revisão: ${items.length} em ${file}; nomes ocultados: ${names.withheld.length}`);
  return items.length;
}

export type DuplicateItem={id:number;name:string;month:number;reason:string;records:number;cents:number;monthCents:number;url:string};
export const duplicateReviewItems=(version:Pick<Snapshot,'people'|'validation'|'records'|'scope'>):DuplicateItem[]=>(version.validation.duplicateCompetences??[]).map(d=>({id:d.personId,name:version.people.find(p=>p.id===d.personId)?.name??'',month:d.month,reason:d.reason,records:d.records,cents:d.cents,monthCents:version.records.filter(r=>r.personId===d.personId&&r.month===d.month).reduce((n,r)=>n+r.cents,0),url:`https://www.camara.leg.br/deputados/${d.personId}?ano=${version.scope.year}`}));

const brlPt=(cents:number)=>'R$ '+(cents/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
export const duplicateMarkdown=(publicationId:string,items:DuplicateItem[])=>[`# Possíveis duplicidades - ${publicationId}`,'',...items.map(i=>`- ${i.id} | ${i.name} | mês ${i.month} | motivo: ${i.reason} | registros sinalizados: ${i.records} | ${brlPt(i.cents)} | total do mês publicado: ${brlPt(i.monthCents)} | ${i.url}`),''].join('\n');

export async function writeDuplicateReview(publicationId:string,items:DuplicateItem[]):Promise<number>{
  const file=path.join(import.meta.dirname,'..','output','review',`${publicationId}-possiveis-duplicidades.md`);
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,duplicateMarkdown(publicationId,items));
  console.error(`Possíveis duplicidades: ${items.length} meses em ${file}`);
  return items.length;
}

const SIGN_REASON='sinal do líquido invertido na fonte; corrigido conforme a página da Câmara';
export type SignItem={id:number;name:string;month:number;category:string;recordId:string;sourceCents:number;cents:number;reason:string};
// Corrected records, plus any negative net on a positive document that was not corrected (those need a human).
export const signReviewItems=(records:Expense[],people:Person[]):SignItem[]=>records.flatMap(r=>{
  const reason=r.sourceCents!==undefined?SIGN_REASON:r.cents<0&&r.documentCents!==null&&r.documentCents>0?'sinal a revisar':null;
  return reason?[{id:r.personId,name:people.find(p=>p.id===r.personId)?.name??'',month:r.month,category:r.category,recordId:r.id,sourceCents:r.sourceCents??r.cents,cents:r.cents,reason}]:[];
});
const brl=(c:number)=>'R$ '+(c/100).toFixed(2);
export const signReviewMarkdown=(publicationId:string,items:SignItem[])=>{
  const housing=SIGN_CATEGORIES[0],sorted=[...items].sort((a,b)=>Number(a.category===housing)-Number(b.category===housing)||a.reason.localeCompare(b.reason,'pt')||a.id-b.id||a.month-b.month);
  const per=new Map<number,{name:string;count:number;cents:number}>();
  for(const i of items)if(i.reason===SIGN_REASON){const g=per.get(i.id)??{name:i.name,count:0,cents:0};g.count++;g.cents+=i.cents;per.set(i.id,g);}
  return [`# Sinal corrigido - ${publicationId}`,'','## Por deputado (só corrigidos)',...[...per].sort((a,b)=>a[0]-b[0]).map(([id,g])=>`- ${id} | ${g.name} | ${g.count} registros | ${brl(g.cents)}`),`- sinal a revisar: ${items.filter(i=>i.reason!==SIGN_REASON).length} registros`,'','## Por registro (outras categorias e "a revisar" primeiro)',...sorted.map(i=>`- ${i.id} | ${i.name} | mês ${i.month} | ${i.category} | fonte ${brl(i.sourceCents)} -> publicado ${brl(i.cents)} | ${i.recordId} | ${i.reason}`),''].join('\n');
};
export async function writeSignReview(publicationId:string,items:SignItem[]):Promise<void>{
  const file=path.join(import.meta.dirname,'..','output','review',`${publicationId}-sinal-corrigido.md`);
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,signReviewMarkdown(publicationId,items));
  console.error(`Sinal corrigido: ${items.length} registros em ${file}`);
}
