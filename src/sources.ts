import {unzipSync} from 'fflate';
import type {DB} from './store.ts';

export type Fingerprint={url:string;etag:string|null;lastModified:string|null;size:number|null};
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>;
type Row={etag:string|null;last_modified:string|null;size:string|null;sha256:string};
const ZIP_SIGNATURE=[0x50,0x4b,0x03,0x04];

export async function fingerprint(url:string,fetcher:Fetcher=fetch,retries=3):Promise<Fingerprint>{
  let failure:unknown;
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      const r=await fetcher(url,{method:'HEAD',headers:{'User-Agent':'clareia-collector'},signal:AbortSignal.timeout(45000)});
      if(!r.ok)throw new Error(`Fonte respondeu ${r.status}: ${url}`);
      const size=Number(r.headers.get('content-length'));
      return {url,etag:r.headers.get('etag'),lastModified:r.headers.get('last-modified'),size:size>0?size:null};
    }catch(error){failure=error;if(attempt<retries)await new Promise(done=>setTimeout(done,2000*(attempt+1)));}
  }
  throw failure;
}
const latest=async(db:DB,url:string)=>(await db.query<Row>('SELECT etag,last_modified,size::text AS size,sha256 FROM source_files WHERE url=$1 ORDER BY fetched_at DESC, seq DESC LIMIT 1',[url])).rows[0];

export async function changedSources(db:DB,current:Fingerprint[]):Promise<string[]>{
  const changed:string[]=[];
  for(const f of current){
    const seen=await latest(db,f.url);
    const validated=f.etag!==null||f.lastModified!==null;
    const same=seen&&validated&&seen.etag===f.etag&&seen.last_modified===f.lastModified&&(seen.size===null?null:Number(seen.size))===f.size;
    if(!same)changed.push(f.url);
  }
  return changed;
}
// Compares with the latest content, not with any past one: a file that returns to an earlier hash did change.
export async function recordSource(db:DB,f:Fingerprint,sha256:string,objectKey:string):Promise<boolean>{
  const isNew=(await latest(db,f.url))?.sha256!==sha256;
  await db.query(`INSERT INTO source_files(url,sha256,etag,last_modified,size,object_key) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(url,sha256) DO UPDATE SET etag=excluded.etag,last_modified=excluded.last_modified,size=excluded.size,fetched_at=now(),seq=nextval('source_files_seq_seq')`,[f.url,sha256,f.etag,f.lastModified,f.size,objectKey]);
  return isNew;
}
export function assertArchive(bytes:Uint8Array,minimumBytes:number):void{
  if(bytes.length<minimumBytes||!ZIP_SIGNATURE.every((b,i)=>bytes[i]===b))throw new Error('Arquivo inválido: a fonte não entregou um zip completo');
  try{unzipSync(bytes,{filter:()=>false});}catch{throw new Error('Arquivo inválido: zip truncado ou corrompido');}
}
