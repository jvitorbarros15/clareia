import {canonical,hash} from './model.ts';
import type {DB} from './store.ts';
import type {TemporalReport} from './people-temporal.ts';
import type {CrosscheckReport} from './people-legacy.ts';

export type CoverageRow={personId:number;year:number;month:number;exercise:string;partyStatus:string;party:string|null;partyValues:string[];ufStatus:string;uf:string|null;review:boolean};
export type PeopleCoverage={schema:'clareia.people-coverage.v1';id:string;metric:'camara.people.monthly-coverage.v1';scope:TemporalReport['scope'];temporalSha256:string;crosscheckSha256:string;collectedAt:string;publishedAt:string;rows:CoverageRow[]};

const REVIEW_CHANGES=new Set(['legacy-only-change','v2-only-change']);
const monthOf=(day:string)=>day.slice(0,7);
const contentId=(c:Omit<PeopleCoverage,'id'|'publishedAt'>)=>hash(canonical(c));

// A month the two official sources disagree on keeps its state but publishes no party or UF as fact.
export function buildPeopleCoverage(temporal:TemporalReport,crosscheck:CrosscheckReport,audit:{status:string;temporalSha256:string},publishedAt:string):PeopleCoverage{
  const temporalSha256=hash(canonical(temporal));
  if(audit.status!=='passed'||audit.temporalSha256!==temporalSha256)throw new Error('Cobertura temporal sem auditoria aprovada para esta versão');
  if(crosscheck.temporalSha256!==temporalSha256)throw new Error('Cruzamento pertence a outra versão temporal');
  const checks=new Map(crosscheck.people.map(p=>[p.id,p]));
  const rows=temporal.people.flatMap(person=>{
    const check=checks.get(person.id);if(!check)throw new Error('Pessoa sem cruzamento de fontes');
    const disputed=new Set(check.partyChanges.filter(c=>REVIEW_CHANGES.has(c.status)).map(c=>monthOf(c.day)));
    return person.months.map<CoverageRow>(m=>{
      const key=`${m.year}-${String(m.month).padStart(2,'0')}`,compared=check.months.find(x=>x.year===m.year&&x.month===m.month);
      if(!compared)throw new Error('Competência sem cruzamento de fontes');
      const review=compared.comparison==='potential-conflict'||disputed.has(key);
      return {personId:person.id,year:m.year,month:m.month,exercise:m.exercise,partyStatus:review?'review':m.party.status,party:review||m.party.status!=='single'?null:m.party.value,partyValues:m.party.status==='changed'&&!review?m.party.values:[],ufStatus:review?'review':m.uf.status,uf:review||m.uf.status!=='single'?null:m.uf.value,review};
    });
  });
  const body={schema:'clareia.people-coverage.v1' as const,metric:'camara.people.monthly-coverage.v1' as const,scope:temporal.scope,temporalSha256,crosscheckSha256:hash(canonical(crosscheck)),collectedAt:temporal.createdAt,rows};
  return {...body,id:contentId(body),publishedAt};
}
export async function readPeopleCoverage(db:DB,id:string):Promise<CoverageRow[]>{
  const r=await db.query<{record:CoverageRow}>('SELECT record FROM people_coverage_v1 WHERE publication_id=$1 ORDER BY position',[id]);
  return r.rows.map(row=>row.record);
}
// Stored for review only: the site moves only after recordDomainAudit marks this id as passed.
export async function storePeopleCoverage(db:DB,coverage:PeopleCoverage):Promise<void>{
  const {id,publishedAt,rows,...rest}=coverage;
  if(id!==contentId({...rest,rows}))throw new Error('Identificador da cobertura não corresponde ao conteúdo');
  await db.query('BEGIN');
  try{
    const created=await db.query<{id:string}>('INSERT INTO publications(id,domain,body) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id',[id,'pessoas',JSON.stringify({...rest,id,publishedAt})]);
    if(created.rows[0])for(let start=0;start<rows.length;start+=5000)await db.query(`INSERT INTO people_coverage_v1(publication_id,position,person_id,year,month,record)
      SELECT $1,$2::integer+ord::integer-1,(r->>'personId')::integer,(r->>'year')::integer,(r->>'month')::integer,r FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS rows(r,ord)`,[id,start,JSON.stringify(rows.slice(start,start+5000))]);
    else if(canonical(await readPeopleCoverage(db,id))!==canonical(rows))throw new Error('Versão já gravada com conteúdo diferente');
    const check=await db.query<{n:string}>('SELECT count(*)::text AS n FROM people_coverage_v1 WHERE publication_id=$1',[id]);
    if(Number(check.rows[0].n)!==rows.length)throw new Error('Reconciliação SQL da cobertura falhou');
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}
}
// Rereads what SQL holds and rederives it from the temporal report by a separate path.
export async function auditPeopleCoverage(db:DB,id:string,temporal:TemporalReport,crosscheck:CrosscheckReport):Promise<{status:'passed'|'failed';failures:string[];checkedAt:string}>{
  const failures:string[]=[],stored=await readPeopleCoverage(db,id),seen=new Set<string>();
  const months=new Map<string,TemporalReport['people'][number]['months'][number]>();
  for(const p of temporal.people)for(const m of p.months)months.set(p.id+':'+m.year+':'+m.month,m);
  if(stored.length!==months.size)failures.push('row-count');
  const flagged=new Set<string>();
  for(const p of crosscheck.people){
    for(const m of p.months)if(m.comparison==='potential-conflict')flagged.add(p.id+':'+m.year+':'+m.month);
    for(const c of p.partyChanges)if(c.status==='legacy-only-change'||c.status==='v2-only-change')flagged.add(p.id+':'+Number(c.day.slice(0,4))+':'+Number(c.day.slice(5,7)));
  }
  for(const row of stored){
    const key=row.personId+':'+row.year+':'+row.month,source=months.get(key);
    if(seen.has(key)||!source){failures.push('unknown-or-repeated-'+key);continue;}seen.add(key);
    const review=flagged.has(key);
    if(row.review!==review||row.exercise!==source.exercise)failures.push('state-'+key);
    if(review?row.party!==null||row.uf!==null||row.partyStatus!=='review'||row.ufStatus!=='review':row.partyStatus!==source.party.status||row.ufStatus!==source.uf.status||row.party!==(source.party.status==='single'?source.party.value:null)||row.uf!==(source.uf.status==='single'?source.uf.value:null))failures.push('attribution-'+key);
  }
  return {status:failures.length?'failed':'passed',failures,checkedAt:new Date().toISOString()};
}
