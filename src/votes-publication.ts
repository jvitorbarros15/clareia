import {canonical,hash} from './model.ts';
import type {DB} from './store.ts';
import {ballotsHash,votesContentId} from './votes.ts';
import type {Ballot,Vote,VotesReport} from './votes.ts';

export type VotesVersion={schema:'clareia.votes-version.v1';id:string;metric:'camara.votes.nominal.v1';scope:{years:number[]};collectedAt:string;publishedAt:string;votes:Vote[];ballots:Ballot[]};
type Audit={status:string;contentSha256:string};
type Body=Omit<VotesVersion,'votes'|'ballots'>&{ballotsSha256:string};
const contentId=(v:Pick<VotesVersion,'schema'|'metric'|'scope'|'votes'>&{ballotsSha256:string})=>hash(canonical({schema:v.schema,metric:v.metric,scope:v.scope,votes:v.votes,ballotsSha256:v.ballotsSha256}));
const digest=(b:Ballot[])=>hash(canonical(b));

export function buildVotesVersion(parts:{report:VotesReport;ballots:Ballot[];audit:Audit}[],publishedAt:string):VotesVersion{
  if(!parts.length)throw new Error('Nenhum ano informado');
  for(const {report,audit,ballots} of parts)if(audit.status!=='passed'||audit.contentSha256!==report.contentSha256||votesContentId(report)!==report.contentSha256||ballotsHash(ballots)!==report.ballotsSha256)throw new Error(`Votações de ${report.year} sem auditoria aprovada para esta versão`);
  const sorted=[...parts].sort((a,b)=>a.report.year-b.report.year),years=sorted.map(p=>p.report.year);
  if(new Set(years).size!==years.length)throw new Error('Ano repetido');
  const votes=sorted.flatMap(p=>p.report.votes.filter(v=>v.ballots>0||v.issues.length)),ballots=sorted.flatMap(p=>p.ballots);
  if(new Set(votes.map(v=>v.id)).size!==votes.length)throw new Error('Votação em mais de um ano');
  const body={schema:'clareia.votes-version.v1' as const,metric:'camara.votes.nominal.v1' as const,scope:{years},votes,ballotsSha256:digest(ballots)};
  return {schema:body.schema,metric:body.metric,scope:body.scope,id:contentId(body),collectedAt:sorted.map(p=>p.report.createdAt).sort()[0],publishedAt,votes,ballots};
}
export async function readVotes(db:DB,id:string):Promise<Vote[]>{
  return (await db.query<{record:Vote}>('SELECT record FROM votes_v1 WHERE publication_id=$1 ORDER BY position',[id])).rows.map(r=>r.record);
}
export async function readBallots(db:DB,id:string,deputyId?:number):Promise<Ballot[]>{
  const r=await db.query<{vote_id:string;deputy_id:number;category:string}>(`SELECT vote_id,deputy_id,category FROM vote_ballots_v1 WHERE publication_id=$1 ${deputyId===undefined?'':'AND deputy_id=$2'} ORDER BY position`,deputyId===undefined?[id]:[id,deputyId]);
  return r.rows.map(b=>[b.vote_id,b.deputy_id,b.category]);
}
const bodyOf=async(db:DB,id:string)=>(await db.query<{body:Body}>(`SELECT body FROM publications WHERE id=$1 AND domain='votacoes'`,[id])).rows[0]?.body;
// Stored for review only: the site moves only after an approval records a passing audit.
export async function storeVotesVersion(db:DB,version:VotesVersion):Promise<void>{
  const {votes,ballots,...rest}=version,ballotsSha256=digest(ballots);
  if(version.id!==contentId({...version,ballotsSha256}))throw new Error('Identificador das votações não corresponde ao conteúdo');
  await db.query('BEGIN');
  try{
    const created=await db.query<{id:string}>('INSERT INTO publications(id,domain,body) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id',[version.id,'votacoes',JSON.stringify({...rest,ballotsSha256})]);
    if(created.rows[0]){
      for(let start=0;start<votes.length;start+=1000)await db.query(`INSERT INTO votes_v1(publication_id,position,vote_id,record) SELECT $1,$2::integer+ord::integer-1,r->>'id',r FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS rows(r,ord)`,[version.id,start,JSON.stringify(votes.slice(start,start+1000))]);
      for(let start=0;start<ballots.length;start+=10000)await db.query(`INSERT INTO vote_ballots_v1(publication_id,position,vote_id,deputy_id,category) SELECT $1,$2::integer+ord::integer-1,r->>0,(r->>1)::integer,r->>2 FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS rows(r,ord)`,[version.id,start,JSON.stringify(ballots.slice(start,start+10000))]);
    }
    const check=await db.query<{n:string}>('SELECT count(*)::text AS n FROM vote_ballots_v1 WHERE publication_id=$1',[version.id]);
    if(Number(check.rows[0].n)!==ballots.length)throw new Error('Reconciliação SQL das votações falhou');
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}
}
export async function reobserveVotesVersion(db:DB,id:string):Promise<void>{
  await db.query(`UPDATE publications SET seq=nextval(pg_get_serial_sequence('publications','seq')) WHERE id=$1 AND domain='votacoes'`,[id]);
}
export async function assertVotesMatchVersion(db:DB,id:string):Promise<Body>{
  const body=await bodyOf(db,id);if(!body)throw new Error('Versão de votações inexistente');
  if(digest(await readBallots(db,id))!==body.ballotsSha256||contentId({...body,votes:await readVotes(db,id)})!==id)throw new Error('Votações no banco diferem da versão aprovada');
  return body;
}
// Recounts every category from the ballots held in SQL, independently of the stored tallies.
export async function auditVotesVersion(db:DB,id:string):Promise<{status:'passed'|'failed';failures:string[];checkedAt:string}>{
  const failures:string[]=[],checkedAt=new Date().toISOString();
  try{await assertVotesMatchVersion(db,id);}catch{failures.push('content-id');}
  const rows=await db.query<{vote_id:string;category:string;n:string}>('SELECT vote_id,category,count(*)::text AS n FROM vote_ballots_v1 WHERE publication_id=$1 GROUP BY vote_id,category',[id]),tally=new Map<string,Record<string,number>>();
  for(const r of rows.rows){const t=tally.get(r.vote_id)??{};t[r.category]=Number(r.n);tally.set(r.vote_id,t);}
  const list=await readVotes(db,id),known=new Set(list.map(v=>v.id));
  for(const key of tally.keys())if(!known.has(key))failures.push('orphan-ballot-'+key);
  for(const v of list)if(canonical(Object.entries(tally.get(v.id)??{}).sort(([a],[b])=>a.localeCompare(b)))!==canonical(Object.entries(v.observed).sort(([a],[b])=>a.localeCompare(b))))failures.push('tally-'+v.id);
  return {status:failures.length?'failed':'passed',failures,checkedAt};
}
