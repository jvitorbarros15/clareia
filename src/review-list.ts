import fs from 'node:fs/promises';
import path from 'node:path';
import type {Person,Snapshot} from './model.ts';

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

export type DuplicateItem={id:number;name:string;month:number;reason:string;records:number;cents:number;monthCents:number;url:string};
export const duplicateReviewItems=(version:Pick<Snapshot,'people'|'validation'|'records'|'scope'>):DuplicateItem[]=>(version.validation.duplicateCompetences??[]).map(d=>({id:d.personId,name:version.people.find(p=>p.id===d.personId)?.name??'',month:d.month,reason:d.reason,records:d.records,cents:d.cents,monthCents:version.records.filter(r=>r.personId===d.personId&&r.month===d.month).reduce((n,r)=>n+r.cents,0),url:`https://www.camara.leg.br/deputados/${d.personId}?ano=${version.scope.year}`}));

const brl=(cents:number)=>'R$ '+(cents/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
export const duplicateMarkdown=(publicationId:string,items:DuplicateItem[])=>[`# Possíveis duplicidades - ${publicationId}`,'',...items.map(i=>`- ${i.id} | ${i.name} | mês ${i.month} | motivo: ${i.reason} | registros sinalizados: ${i.records} | ${brl(i.cents)} | total do mês publicado: ${brl(i.monthCents)} | ${i.url}`),''].join('\n');

export async function writeDuplicateReview(publicationId:string,items:DuplicateItem[]):Promise<number>{
  const file=path.join(import.meta.dirname,'..','output','review',`${publicationId}-possiveis-duplicidades.md`);
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,duplicateMarkdown(publicationId,items));
  console.error(`Possíveis duplicidades: ${items.length} meses em ${file}`);
  return items.length;
}
