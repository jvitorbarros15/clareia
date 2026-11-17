import fs from 'node:fs/promises';
import path from 'node:path';
import type {Person} from './model.ts';

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
