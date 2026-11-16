import fs from 'node:fs/promises';
import path from 'node:path';
import type {Person} from './model.ts';
import type {SiteSummary} from './site-summary.ts';

export type ReviewItem={kind:string;id:number;name:string;used:string;from:string;why:string};

// One line per deputy whose UF is not the registration's: the fallback used, or none. Add other unknowns as more kinds.
export function ufReviewItems(summary:SiteSummary,people:Person[]):ReviewItem[]{
  return summary.people.flatMap(p=>{
    if(people.find(x=>x.id===p.id)?.uf!==null)return [];
    const counts=new Map<string,number>();for(const m of p.months)counts.set(m.ufStatus,(counts.get(m.ufStatus)??0)+1);
    const months=[...counts].map(([s,n])=>`${s} ${n}`).join(', ');
    return [p.ufLast
      ?{kind:'uf',id:p.id,name:p.name,used:p.ufLast.uf,from:`${String(p.ufLast.month).padStart(2,'0')}/${summary.scope.year}`,why:`UF do cadastro ausente; meses do recorte: ${months}`}
      :{kind:'uf',id:p.id,name:p.name,used:'sem UF confirmada',from:'-',why:`UF do cadastro ausente e nenhum mês confirmado; meses do recorte: ${months||'sem meses'}`}];
  });
}

export function reviewMarkdown(publicationId:string,items:ReviewItem[]):string{
  const kinds=[...new Set(items.map(i=>i.kind))];
  return [`# Pendências de revisão - ${publicationId}`,'',...kinds.flatMap(k=>[`## ${k.toUpperCase()}`,'',...items.filter(i=>i.kind===k).map(i=>`- ${i.id} | ${i.name} | usada: ${i.used} | mês: ${i.from} | ${i.why}`),''])].join('\n');
}

// Never published: output/review is gitignored and outside the site folder.
export async function writeReview(publicationId:string,items:ReviewItem[]):Promise<void>{
  const file=path.join('output','review',`${publicationId}-uf-pendencias.md`);
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,reviewMarkdown(publicationId,items));
  console.error(`Pendências de revisão: ${items.length} em ${file}`);
}
