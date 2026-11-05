import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { snapshotId } from './model.ts';
import type { Snapshot } from './model.ts';

export interface DB {query<T=Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:T[]}>;close():Promise<void>}
async function prepareWindowsDirectory(directory:string):Promise<void>{
  // OneDrive's directory ReadOnly bit is cosmetic to Win32, but NODEFS interprets
  // it as POSIX permissions. Restrict this adjustment to our own PostgreSQL tree.
  if(process.platform!=='win32')return;
  try {await fs.chmod(directory,0o700);for(const entry of await fs.readdir(directory,{withFileTypes:true}))if(entry.isDirectory())await prepareWindowsDirectory(path.join(directory,entry.name));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
export async function openDB(memory=false):Promise<DB> {
  let db:DB;
  if(process.env.DATABASE_URL&&!memory){const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();db={query:async<T>(sql:string,p?:unknown[])=>({rows:(await client.query(sql,p)).rows as T[]}),close:()=>client.end()};}
  else {if(!memory){await fs.mkdir('data/local',{recursive:true});await prepareWindowsDirectory(path.resolve('data/local/postgres'));}const lite=new PGlite(memory?undefined:path.resolve('data/local/postgres'));db={query:<T>(s:string,p?:unknown[])=>lite.query<T>(s,p),close:()=>lite.close()};}
  for(const sql of [
    `CREATE TABLE IF NOT EXISTS snapshots (id text PRIMARY KEY, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS expenses (snapshot_id text REFERENCES snapshots(id), occurrence_id text, person_id integer NOT NULL, year integer NOT NULL, month integer NOT NULL, category text NOT NULL, supplier_key text NOT NULL, amount_cents bigint NOT NULL, PRIMARY KEY(snapshot_id,occurrence_id))`,
    `CREATE TABLE IF NOT EXISTS active_snapshot (singleton integer PRIMARY KEY CHECK(singleton=1), snapshot_id text NOT NULL REFERENCES snapshots(id))`,
    `CREATE TABLE IF NOT EXISTS withheld_snapshots (snapshot_id text PRIMARY KEY REFERENCES snapshots(id), reason text NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS runs (id text PRIMARY KEY, status text NOT NULL, started_at timestamptz NOT NULL, finished_at timestamptz, snapshot_id text, error text)`
  ])await db.query(sql);
  return db;
}
export async function publish(db:DB,snapshot:Snapshot):Promise<void> {
  if(snapshot.id!==snapshotId(snapshot))throw new Error('Identificador da versão não corresponde ao conteúdo; publicação recusada');
  await db.query('BEGIN');
  try {
    await db.query('INSERT INTO snapshots(id,body) VALUES($1,$2::jsonb) ON CONFLICT(id) DO NOTHING',[snapshot.id,JSON.stringify(snapshot)]);
    const stored=await db.query<{body:Snapshot}>('SELECT body FROM snapshots WHERE id=$1',[snapshot.id]);
    if(snapshotId(stored.rows[0].body)!==snapshot.id)throw new Error('Versão já publicada com o mesmo identificador e conteúdo diferente; publicação recusada');
    for(const r of snapshot.records)await db.query('INSERT INTO expenses VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[snapshot.id,r.id,r.personId,r.year,r.month,r.category,r.supplierKey,r.cents]);
    const check=await db.query<{count:string;total:string}>('SELECT count(*)::text AS count, coalesce(sum(amount_cents),0)::text AS total FROM expenses WHERE snapshot_id=$1',[snapshot.id]);
    if(Number(check.rows[0].count)!==snapshot.records.length||check.rows[0].total!==snapshot.validation.independentTotalCents)throw new Error('Reconciliação SQL independente falhou');
    if(snapshot.validation.sourceKind==='annual-csv'&&snapshot.validation.apiComparison?.missingInApi){
      await db.query(`INSERT INTO withheld_snapshots SELECT id,$1 FROM snapshots WHERE body->>'metric'='camara.ceap.valor-liquido-api.v1' ON CONFLICT DO NOTHING`,['Recorte incompleto da API, identificado ao conferir o arquivo anual.']);
    }
    await db.query('INSERT INTO active_snapshot VALUES(1,$1) ON CONFLICT(singleton) DO UPDATE SET snapshot_id=excluded.snapshot_id',[snapshot.id]);
    await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK');throw e;}
}
export async function readSnapshot(db:DB,id?:string):Promise<Snapshot|null> {
  const r=await db.query<{body:Snapshot}>(id?'SELECT body FROM snapshots WHERE id=$1 AND id NOT IN (SELECT snapshot_id FROM withheld_snapshots)':'SELECT s.body FROM snapshots s JOIN active_snapshot a ON a.snapshot_id=s.id WHERE s.id NOT IN (SELECT snapshot_id FROM withheld_snapshots)',id?[id]:[]);
  return r.rows[0]?.body||null;
}
