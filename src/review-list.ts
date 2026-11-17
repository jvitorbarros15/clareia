import fs from 'node:fs/promises';
import path from 'node:path';
import type {Person} from './model.ts';

export type ReviewItem={id:number;name:string;used:string;from:string};

// Deputies whose UF is not confirmed month by month: the one their legislature's events agree on, or none.
export const ufReviewItems=(people:Person[]):ReviewItem[]=>people.flatMap(p=>p.uf&&!p.ufNote?[]:[p.uf?{id:p.id,name:p.name,used:p.uf,from:'eventos da legislatura'}:{id:p.id,name:p.name,used:'sem UF',from:'sem UF confirmada'}]);

export const partyReviewItems=(people:Person[]):ReviewItem[]=>people.flatMap(p=>p.partyNote?[{id:p.id,name:p.name,used:p.party!,from:/registrado|na posse/.test(p.partyNote)?`sem evento de partido no período das despesas; ${p.partyNote}`:p.partyNote}]:p.party?[]:[{id:p.id,name:p.name,used:'sem partido',from:'sem partido confirmado'}]);

export const reviewMarkdown=(publicationId:string,items:ReviewItem[],kind='UF')=>[`# Pendências de ${kind} - ${publicationId}`,'',...items.map(i=>`- ${i.id} | ${i.name} | usada: ${i.used} | fonte: ${i.from}`),''].join('\n');

// Never published: output/review is gitignored, outside the site folder, and anchored to the repository, not to the working directory.
export async function writeReview(publicationId:string,items:ReviewItem[],partyItems:ReviewItem[]):Promise<number>{
  const dir=path.join(import.meta.dirname,'..','output','review');
  await fs.mkdir(dir,{recursive:true});
  for(const [name,kind,list] of [['uf','UF',items],['partido','partido',partyItems]] as const){
    const file=path.join(dir,`${publicationId}-${name}-pendencias.md`);
    await fs.writeFile(file,reviewMarkdown(publicationId,list,kind));
    console.error(`Pendências de ${kind}: ${list.length} em ${file}`);
  }
  return items.length;
}
