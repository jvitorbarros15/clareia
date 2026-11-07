import {snapshotId} from './model.ts';
import type {Expense,Snapshot} from './model.ts';
import type {DB} from './store.ts';

export type Domain='pessoas'|'despesas'|'votacoes'|'projetos'|'eleicoes'|'emendas';
export type Publication=Omit<Snapshot,'records'>&{domain:Domain};
export type AuditDetails={checkedAt:string};
type Row={domain:Domain;body:Omit<Snapshot,'records'>};
const BATCH=5000;
const VISIBLE='id NOT IN (SELECT publication_id FROM withheld_publications)';

async function storeRecords(db:DB,id:string,records:Expense[]):Promise<void>{
  for(let start=0;start<records.length;start+=BATCH){
    await db.query(`INSERT INTO expenses_v2(publication_id,position,occurrence_id,person_id,year,month,category,supplier_key,amount_cents,record)
      SELECT $1,$2::integer+ord::integer-1,r->>'id',(r->>'personId')::integer,(r->>'year')::integer,(r->>'month')::integer,r->>'category',r->>'supplierKey',(r->>'cents')::bigint,r
      FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS rows(r,ord) ON CONFLICT DO NOTHING`,[id,start,JSON.stringify(records.slice(start,start+BATCH))]);
  }
}
// Only a passing audit moves the site, and the order is publication order: re-auditing an old version must not bring it back.
async function refreshActive(db:DB,domain:string):Promise<void>{
  const next=await db.query<{id:string}>(`SELECT p.id FROM publications p JOIN publication_audits a ON a.publication_id=p.id AND a.status='passed' WHERE p.domain=$1 AND p.${VISIBLE} ORDER BY p.seq DESC LIMIT 1`,[domain]);
  if(next.rows[0])await db.query('INSERT INTO active_publication VALUES($1,$2) ON CONFLICT(domain) DO UPDATE SET publication_id=excluded.publication_id',[domain,next.rows[0].id]);
  else await db.query('DELETE FROM active_publication WHERE domain=$1',[domain]);
}
const domainOf=async(db:DB,id:string)=>(await db.query<{domain:string}>('SELECT domain FROM publications WHERE id=$1',[id])).rows[0]?.domain;

export async function publishDomain(db:DB,domain:Domain,snapshot:Snapshot):Promise<void>{
  if(snapshot.id!==snapshotId(snapshot))throw new Error('Identificador da versão não corresponde ao conteúdo; publicação recusada');
  await db.query('BEGIN');
  try{
    const {records,...body}=snapshot;
    const created=await db.query<{id:string}>('INSERT INTO publications(id,domain,body) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id',[snapshot.id,domain,JSON.stringify(body)]);
    if(created.rows[0])await storeRecords(db,snapshot.id,records);
    else{
      const stored=await db.query<Row>('SELECT domain,body FROM publications WHERE id=$1',[snapshot.id]);
      if(snapshotId({...stored.rows[0].body,records:await readRecords(db,snapshot.id)})!==snapshot.id)throw new Error('Versão já publicada com o mesmo identificador e conteúdo diferente; publicação recusada');
      // The source can go back to older content: seeing it again makes it the newest observation.
      await db.query(`UPDATE publications SET seq=nextval(pg_get_serial_sequence('publications','seq')) WHERE id=$1`,[snapshot.id]);
    }
    const check=await db.query<{count:string;total:string}>('SELECT count(*)::text AS count, coalesce(sum(amount_cents),0)::text AS total FROM expenses_v2 WHERE publication_id=$1',[snapshot.id]);
    if(Number(check.rows[0].count)!==records.length||check.rows[0].total!==snapshot.validation.independentTotalCents)throw new Error('Reconciliação SQL independente falhou');
    if(snapshot.validation.apiComparison?.missingInApi){
      await db.query(`INSERT INTO withheld_publications SELECT id,$1 FROM publications WHERE body->>'metric'='camara.ceap.valor-liquido-api.v1' ON CONFLICT DO NOTHING`,['Recorte incompleto da API, identificado pela conciliação com o arquivo anual']);
      await refreshActive(db,domain);
    }
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}
}
export async function recordDomainAudit(db:DB,id:string,status:'passed'|'failed',report:AuditDetails):Promise<void>{
  await db.query('INSERT INTO publication_audits VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(publication_id) DO UPDATE SET status=excluded.status, checked_at=excluded.checked_at, report=excluded.report',[id,status,report.checkedAt,JSON.stringify(report)]);
  await refreshActive(db,await domainOf(db,id));
}
export async function withholdPublication(db:DB,id:string,reason:string):Promise<void>{
  await db.query('INSERT INTO withheld_publications VALUES($1,$2) ON CONFLICT(publication_id) DO UPDATE SET reason=excluded.reason',[id,reason]);
  await refreshActive(db,await domainOf(db,id));
}
const toPublication=(row:Row):Publication=>({...row.body,domain:row.domain});
export async function activePublication(db:DB,domain:Domain):Promise<Publication|null>{
  const r=await db.query<Row>('SELECT p.domain,p.body FROM publications p JOIN active_publication a ON a.publication_id=p.id WHERE a.domain=$1',[domain]);
  return r.rows[0]?toPublication(r.rows[0]):null;
}
// The newest version, audited or not: what an audit has to look at, never what the site shows.
export async function latestPublication(db:DB,domain:Domain):Promise<Publication|null>{
  const r=await db.query<Row>(`SELECT domain,body FROM publications WHERE domain=$1 AND ${VISIBLE} ORDER BY seq DESC LIMIT 1`,[domain]);
  return r.rows[0]?toPublication(r.rows[0]):null;
}
export async function readRecords(db:DB,publicationId:string,personId?:number):Promise<Expense[]>{
  const r=await db.query<{record:Expense}>(`SELECT record FROM expenses_v2 WHERE publication_id=$1 ${personId===undefined?'':'AND person_id=$2'} ORDER BY position`,personId===undefined?[publicationId]:[publicationId,personId]);
  return r.rows.map(row=>row.record);
}
export async function readPublication(db:DB,id:string):Promise<Snapshot|null>{
  const r=await db.query<Row>(`SELECT domain,body FROM publications WHERE id=$1 AND ${VISIBLE}`,[id]);
  return r.rows[0]?{...r.rows[0].body,records:await readRecords(db,id)}:null;
}
export async function publicationAudit(db:DB,id:string):Promise<unknown>{
  return (await db.query<{report:unknown}>('SELECT report FROM publication_audits WHERE publication_id=$1',[id])).rows[0]?.report??null;
}
