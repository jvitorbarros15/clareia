import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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
  const testUrl=memory?process.env.TEST_DATABASE_URL:undefined;
  if(testUrl){
    // One throwaway schema per test keeps tests isolated on a shared server.
    const schema='test_'+randomUUID().replaceAll('-',''),client=new pg.Client({connectionString:testUrl});await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`);
    db={query:async<T>(sql:string,p?:unknown[])=>({rows:(await client.query(sql,p)).rows as T[]}),close:async()=>{await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}};
  }
  else if(process.env.DATABASE_URL&&!memory){const client=new pg.Client({connectionString:process.env.DATABASE_URL});client.on('error',error=>console.error(error.message));await client.connect();db={query:async<T>(sql:string,p?:unknown[])=>({rows:(await client.query(sql,p)).rows as T[]}),close:()=>client.end()};}
  else {if(!memory){await fs.mkdir('data/local',{recursive:true});await prepareWindowsDirectory(path.resolve('data/local/postgres'));}const lite=new PGlite(memory?undefined:path.resolve('data/local/postgres'));db={query:<T>(s:string,p?:unknown[])=>lite.query<T>(s,p),close:()=>lite.close()};}
  for(const sql of [
    `CREATE TABLE IF NOT EXISTS publications (id text PRIMARY KEY, seq bigserial NOT NULL, domain text NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS publications_domain ON publications(domain,seq)`,
    `CREATE TABLE IF NOT EXISTS expenses_v2 (publication_id text REFERENCES publications(id), position integer NOT NULL, occurrence_id text NOT NULL, person_id integer NOT NULL, year integer NOT NULL, month integer NOT NULL, category text NOT NULL, supplier_key text NOT NULL, amount_cents bigint NOT NULL, record jsonb NOT NULL, PRIMARY KEY(publication_id,occurrence_id))`,
    `CREATE INDEX IF NOT EXISTS expenses_person ON expenses_v2(publication_id,person_id,year,month)`,
    `CREATE TABLE IF NOT EXISTS people_coverage_v1 (publication_id text REFERENCES publications(id), position integer NOT NULL, person_id integer NOT NULL, year integer NOT NULL, month integer NOT NULL, record jsonb NOT NULL, PRIMARY KEY(publication_id,person_id,year,month))`,
    `CREATE TABLE IF NOT EXISTS active_publication (domain text PRIMARY KEY, publication_id text NOT NULL REFERENCES publications(id))`,
    `CREATE TABLE IF NOT EXISTS withheld_publications (publication_id text PRIMARY KEY REFERENCES publications(id), reason text NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS publication_audits (publication_id text PRIMARY KEY REFERENCES publications(id), status text NOT NULL CHECK(status IN ('passed','failed')), checked_at timestamptz NOT NULL, report jsonb NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS source_files (seq bigserial NOT NULL, url text NOT NULL, sha256 text NOT NULL, etag text, last_modified text, size bigint, fetched_at timestamptz NOT NULL DEFAULT now(), object_key text, PRIMARY KEY(url,sha256))`,
    `CREATE TABLE IF NOT EXISTS publication_runs (id text PRIMARY KEY, status text NOT NULL, started_at timestamptz NOT NULL, finished_at timestamptz, publication_id text, error text)`
  ])await db.query(sql);
  return db;
}
