import {canonical,hash} from './model.ts';
import type {DB} from './store.ts';
import {amendmentsContentId,MEASURES} from './amendments.ts';
import type {AmendmentsReport,Totals} from './amendments.ts';

export type ReviewedLink={code:string;deputyId:number;reviewer:string;reviewedAt:string;evidence:string};
export type AmendmentRow={deputyId:number;code:string;year:number;destination:string;totals:Totals};
export type AmendmentsVersion={schema:'clareia.amendments-version.v1';id:string;metric:'cgu.amendments.individual.v1';scope:{fromYear:number;linkedAuthors:number;authors:number;links:ReviewedLink[]};collectedAt:string;publishedAt:string;rows:AmendmentRow[]};
type Audit={status:string;contentSha256:string};
const contentId=(v:Pick<AmendmentsVersion,'schema'|'metric'|'scope'|'rows'>)=>hash(canonical({schema:v.schema,metric:v.metric,scope:v.scope,rows:v.rows}));

// Only a reviewed link attributes an amendment to a deputy; a name match never does.
export function buildAmendmentsVersion(report:AmendmentsReport,audit:Audit,links:ReviewedLink[],publishedAt:string):AmendmentsVersion{
  if(audit.status!=='passed'||audit.contentSha256!==report.contentSha256||amendmentsContentId(report)!==report.contentSha256)throw new Error('Emendas sem auditoria aprovada para esta versão');
  if(report.metrics.repeatedRows)throw new Error('Arquivo de emendas com linhas repetidas: revisão necessária');
  const proposals=new Map(report.links.map(l=>[l.code,l]));
  if(new Set(links.map(l=>l.code)).size!==links.length||new Set(links.map(l=>l.deputyId)).size!==links.length)throw new Error('Ligação repetida');
  const authors=new Map(report.authors.map(a=>[a.code,a])),rows:AmendmentRow[]=[];
  for(const l of [...links].sort((a,b)=>a.code.localeCompare(b.code))){
    if(!l.reviewer.trim()||!l.reviewedAt.trim()||!l.evidence.trim()||!Number.isInteger(l.deputyId))throw new Error('Ligação sem revisão registrada: '+l.code);
    const author=authors.get(l.code);if(!author)throw new Error('Ligação para autor inexistente: '+l.code);
    const candidates=proposals.get(l.code)?.candidates??[];if(candidates.length&&!candidates.includes(l.deputyId))throw new Error('Ligação diverge dos candidatos: '+l.code);
    for(const year of Object.keys(author.years).sort())for(const [destination,totals] of Object.entries(author.years[year].destinations).sort(([a],[b])=>a.localeCompare(b)))rows.push({deputyId:l.deputyId,code:l.code,year:Number(year),destination,totals});
  }
  const body={schema:'clareia.amendments-version.v1' as const,metric:'cgu.amendments.individual.v1' as const,scope:{fromYear:report.fromYear,linkedAuthors:links.length,authors:report.authors.length,links:[...links].sort((a,b)=>a.code.localeCompare(b.code))},rows};
  return {...body,id:contentId(body),collectedAt:report.createdAt,publishedAt};
}
export async function readAmendmentRows(db:DB,id:string):Promise<AmendmentRow[]>{
  return (await db.query<{record:AmendmentRow}>('SELECT record FROM amendments_v1 WHERE publication_id=$1 ORDER BY position',[id])).rows.map(r=>r.record);
}
export async function storeAmendmentsVersion(db:DB,version:AmendmentsVersion):Promise<void>{
  const {rows,...body}=version;if(version.id!==contentId(version))throw new Error('Identificador das emendas não corresponde ao conteúdo');
  await db.query('BEGIN');
  try{
    const created=await db.query<{id:string}>('INSERT INTO publications(id,domain,body) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id',[version.id,'emendas',JSON.stringify(body)]);
    if(created.rows[0])for(let start=0;start<rows.length;start+=2000)await db.query(`INSERT INTO amendments_v1(publication_id,position,deputy_id,year,record) SELECT $1,$2::integer+ord::integer-1,(r->>'deputyId')::integer,(r->>'year')::integer,r FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS rows(r,ord)`,[version.id,start,JSON.stringify(rows.slice(start,start+2000))]);
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}
}
export async function reobserveAmendmentsVersion(db:DB,id:string):Promise<void>{
  await db.query(`UPDATE publications SET seq=nextval(pg_get_serial_sequence('publications','seq')) WHERE id=$1 AND domain='emendas'`,[id]);
}
// Rereads SQL and adds the destinations back up to the author-year totals in the audited report.
export async function auditAmendmentsVersion(db:DB,id:string,report:AmendmentsReport):Promise<{status:'passed'|'failed';failures:string[];checkedAt:string}>{
  const failures:string[]=[],rows=await readAmendmentRows(db,id),body=(await db.query<{body:Omit<AmendmentsVersion,'rows'>}>(`SELECT body FROM publications WHERE id=$1 AND domain='emendas'`,[id])).rows[0]?.body;
  if(!body||contentId({schema:body.schema,metric:body.metric,scope:body.scope,rows})!==id)failures.push('content-id');
  const sums=new Map<string,bigint[]>();
  for(const r of rows){const key=r.code+'|'+r.year,t=sums.get(key)??[0n,...MEASURES.map(()=>0n)];t[0]+=BigInt(r.totals.rows);MEASURES.forEach((m,i)=>{t[i+1]+=BigInt(r.totals[m]);});sums.set(key,t);}
  for(const [key,t] of sums){const [code,year]=key.split('|'),y=report.authors.find(a=>a.code===code)?.years[year];if(!y||canonical([BigInt(y.rows),...MEASURES.map(m=>BigInt(y[m]))].map(String))!==canonical(t.map(String)))failures.push('totals-'+key);}
  return {status:failures.length?'failed':'passed',failures,checkedAt:new Date().toISOString()};
}
