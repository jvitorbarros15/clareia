import fs from 'node:fs/promises';
import path from 'node:path';
import type {Expense,Person} from './model.ts';

export type ReviewItem={id:number;name:string;used:string;from:string};

// Deputies whose UF is not confirmed month by month: the one their legislature's events agree on, or none.
export const ufReviewItems=(people:Person[]):ReviewItem[]=>people.flatMap(p=>p.uf&&!p.ufNote?[]:[p.uf?{id:p.id,name:p.name,used:p.uf,from:'eventos da legislatura'}:{id:p.id,name:p.name,used:'sem UF',from:'sem UF confirmada'}]);

export const reviewMarkdown=(publicationId:string,items:ReviewItem[])=>[`# Pendências de UF - ${publicationId}`,'',...items.map(i=>`- ${i.id} | ${i.name} | usada: ${i.used} | fonte: ${i.from}`),''].join('\n');

// Never published: output/review is gitignored, outside the site folder, and anchored to the repository, not to the working directory.
export async function writeReview(publicationId:string,items:ReviewItem[]):Promise<number>{
  const file=path.join(import.meta.dirname,'..','output','review',`${publicationId}-uf-pendencias.md`);
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,reviewMarkdown(publicationId,items));
  console.error(`Pendências de UF: ${items.length} em ${file}`);
  return items.length;
}

export const signReviewItems=(records:Expense[],people:Person[])=>{
  const by=new Map<number,{count:number;cents:number}>();
  for(const r of records)if(r.sourceCents!==undefined){const g=by.get(r.personId)??{count:0,cents:0};g.count++;g.cents+=r.cents;by.set(r.personId,g);}
  return [...by].sort((a,b)=>a[0]-b[0]).map(([id,g])=>({id,name:people.find(p=>p.id===id)?.name??'',...g,reason:'sinal do líquido invertido na fonte; corrigido conforme a página da Câmara'}));
};
export const signReviewMarkdown=(publicationId:string,items:ReturnType<typeof signReviewItems>)=>[`# Sinal corrigido - ${publicationId}`,'',...items.map(i=>`- ${i.id} | ${i.name} | ${i.count} registros | R$ ${(i.cents/100).toFixed(2)} | ${i.reason}`),''].join('\n')+'\n';
export async function writeSignReview(publicationId:string,items:ReturnType<typeof signReviewItems>):Promise<void>{
  const file=path.join(import.meta.dirname,'..','output','review',`${publicationId}-sinal-corrigido.md`);
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,signReviewMarkdown(publicationId,items));
  console.error(`Sinal corrigido: ${items.length} deputados em ${file}`);
}
