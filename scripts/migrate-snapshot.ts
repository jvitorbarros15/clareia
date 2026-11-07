import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {openDB} from '../src/store.ts';
import {activePublication,publishDomain,recordDomainAudit,readRecords} from '../src/publications.ts';
import {snapshotId} from '../src/model.ts';
import type {Snapshot} from '../src/model.ts';

const APPROVED={prefix:'8eb3b85c',records:194,cents:20933746};
const legacy=new PGlite(path.resolve(process.argv[2]||'data/local/postgres'));
const version=await legacy.query<{body:Snapshot;status:string;report:{checkedAt:string}}>(`SELECT s.body,a.status,a.report FROM snapshots s JOIN snapshot_audits a ON a.snapshot_id=s.id WHERE s.id LIKE $1`,[APPROVED.prefix+'%']);
const stored=version.rows[0]?.body;
if(!stored||version.rows[0].status!=='passed')throw new Error('Versão aprovada não encontrada no banco antigo');
// The id formula changed after this version was stored. The content stays untouched; the old id stays in the audit report.
const snapshot={...stored,id:snapshotId(stored)};
const run=await legacy.query<{id:string;status:string;started_at:string;finished_at:string}>(`SELECT id,status,started_at,finished_at FROM runs WHERE snapshot_id=$1 AND status='published' ORDER BY finished_at DESC LIMIT 1`,[stored.id]);
await legacy.close();
const db=await openDB();
try{
  await publishDomain(db,'despesas',snapshot);
  await recordDomainAudit(db,snapshot.id,'passed',{...version.rows[0].report,legacyId:stored.id} as {checkedAt:string});
  if(run.rows[0]){const r=run.rows[0];await db.query('INSERT INTO publication_runs(id,status,started_at,finished_at,publication_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[r.id,r.status,r.started_at,r.finished_at,snapshot.id]);}
  const records=await readRecords(db,snapshot.id),cents=records.reduce((n,r)=>n+r.cents,0);
  if(records.length!==APPROVED.records||cents!==APPROVED.cents)throw new Error(`Migração diverge: ${records.length} registros, ${cents} centavos`);
  if((await activePublication(db,'despesas'))?.id!==snapshot.id)throw new Error('Versão migrada não ficou ativa');
  console.log(JSON.stringify({publication:snapshot.id,records:records.length,cents}));
}finally{await db.close();}
