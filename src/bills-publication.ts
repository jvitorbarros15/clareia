import {canonical,hash} from './model.ts';
import {billsContentId} from './bills.ts';
import type {DB} from './store.ts';
import type {Bill,BillPerson,BillsReport} from './bills.ts';

export type BillsVersion={schema:'clareia.bills-version.v1';id:string;metric:'camara.bills.authorship.v1';scope:{years:number[];types:string[]};sources:{year:number;contentSha256:string}[];collectedAt:string;publishedAt:string;bills:Bill[];people:BillPerson[]};
type Audit={status:string;contentSha256:string};

const contentId=(v:Pick<BillsVersion,'schema'|'metric'|'scope'|'bills'|'people'>)=>hash(canonical({schema:v.schema,metric:v.metric,scope:v.scope,bills:v.bills,people:v.people}));
function sumPeople(reports:BillsReport[]):BillPerson[]{
  const totals=new Map<number,BillPerson>();
  for(const p of reports.flatMap(r=>r.people)){const t=totals.get(p.id)??{id:p.id,proposed:0,joint:0,coauthored:0,norms:0};t.proposed+=p.proposed;t.joint+=p.joint;t.coauthored+=p.coauthored;t.norms+=p.norms;totals.set(p.id,t);}
  return [...totals.values()].sort((a,b)=>a.id-b.id);
}
export function buildBillsVersion(pairs:{report:BillsReport;audit:Audit}[],publishedAt:string):BillsVersion{
  if(!pairs.length)throw new Error('Nenhum ano informado');
  for(const {report,audit} of pairs)if(audit.status!=='passed'||audit.contentSha256!==report.contentSha256||billsContentId(report)!==report.contentSha256)throw new Error(`Proposições de ${report.year} sem auditoria aprovada para esta versão`);
  const reports=pairs.map(p=>p.report).sort((a,b)=>a.year-b.year),years=reports.map(r=>r.year);
  if(new Set(years).size!==years.length)throw new Error('Ano repetido');
  if(canonical(reports[0].types)!==canonical([...new Set(reports.flatMap(r=>r.types))]))throw new Error('Tipos divergentes entre os anos');
  const bills=reports.flatMap(r=>r.bills);if(new Set(bills.map(b=>b.id)).size!==bills.length)throw new Error('Proposição em mais de um ano');
  const body={schema:'clareia.bills-version.v1' as const,metric:'camara.bills.authorship.v1' as const,scope:{years,types:reports[0].types},bills,people:sumPeople(reports)};
  return {...body,id:contentId(body),sources:reports.map(r=>({year:r.year,contentSha256:r.contentSha256})),collectedAt:reports.map(r=>r.createdAt).sort()[0],publishedAt};
}
export async function readBills(db:DB,id:string):Promise<Bill[]>{
  return (await db.query<{record:Bill}>('SELECT record FROM bills_v1 WHERE publication_id=$1 ORDER BY position',[id])).rows.map(r=>r.record);
}
type Body=Omit<BillsVersion,'bills'>;
const bodyOf=async(db:DB,id:string)=>(await db.query<{body:Body}>(`SELECT body FROM publications WHERE id=$1 AND domain='projetos'`,[id])).rows[0]?.body;
// Stored for review only: the site moves only after an approval records a passing audit.
export async function storeBillsVersion(db:DB,version:BillsVersion):Promise<void>{
  const {bills,...body}=version;
  if(version.id!==contentId(version))throw new Error('Identificador das proposições não corresponde ao conteúdo');
  await db.query('BEGIN');
  try{
    const created=await db.query<{id:string}>('INSERT INTO publications(id,domain,body) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id',[version.id,'projetos',JSON.stringify(body)]);
    if(created.rows[0])for(let start=0;start<bills.length;start+=2000)await db.query(`INSERT INTO bills_v1(publication_id,position,bill_id,record) SELECT $1,$2::integer+ord::integer-1,(r->>'id')::integer,r FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS rows(r,ord)`,[version.id,start,JSON.stringify(bills.slice(start,start+2000))]);
    else if(canonical(await readBills(db,version.id))!==canonical(bills))throw new Error('Versão já gravada com conteúdo diferente');
    const check=await db.query<{n:string}>('SELECT count(*)::text AS n FROM bills_v1 WHERE publication_id=$1',[version.id]);
    if(Number(check.rows[0].n)!==bills.length)throw new Error('Reconciliação SQL das proposições falhou');
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}
}
export async function reobserveBillsVersion(db:DB,id:string):Promise<void>{
  await db.query(`UPDATE publications SET seq=nextval(pg_get_serial_sequence('publications','seq')) WHERE id=$1 AND domain='projetos'`,[id]);
}
// Rebuilds the per-person counts from the bills held in SQL, independently of the stored totals.
export async function auditBillsVersion(db:DB,id:string,reports:BillsReport[]):Promise<{status:'passed'|'failed';failures:string[];checkedAt:string}>{
  const failures:string[]=[],stored=await readBills(db,id),body=await bodyOf(db,id);
  if(!body){failures.push('version-missing');return {status:'failed',failures,checkedAt:new Date().toISOString()};}
  const expected=[...reports].sort((a,b)=>a.year-b.year).flatMap(r=>r.bills);
  if(canonical(expected)!==canonical(stored))failures.push('bills-differ-from-reports');
  if(contentId({schema:body.schema,metric:body.metric,scope:body.scope,people:body.people,bills:stored})!==id)failures.push('content-id');
  const tally=new Map<number,[number,number,number,number]>();
  for(const bill of stored){
    if(bill.issues.length)continue;
    const many=bill.authors.filter(a=>a.proponent).length+bill.otherProponents>1;
    for(const a of bill.authors){const t=tally.get(a.deputyId)??[0,0,0,0];if(a.proponent){t[0]++;if(many)t[1]++;if(bill.normStatus==='resolved')t[3]++;}else t[2]++;tally.set(a.deputyId,t);}
  }
  const recount=[...tally].sort((a,b)=>a[0]-b[0]).map(([personId,[proposed,joint,coauthored,norms]])=>({id:personId,proposed,joint,coauthored,norms}));
  if(canonical(recount)!==canonical(body.people))failures.push('person-counts');
  return {status:failures.length?'failed':'passed',failures,checkedAt:new Date().toISOString()};
}
export async function assertBillsMatchVersion(db:DB,id:string):Promise<BillPerson[]>{
  const body=await bodyOf(db,id);if(!body)throw new Error('Versão de proposições inexistente');
  if(contentId({schema:body.schema,metric:body.metric,scope:body.scope,people:body.people,bills:await readBills(db,id)})!==id)throw new Error('Proposições no banco diferem da versão aprovada');
  return body.people;
}
