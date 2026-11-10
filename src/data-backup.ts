import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {ObjectStore} from './object-store.ts';
import {open,seal} from './vault.ts';

type Entry={sha256:string;size:number};
type Manifest=Record<string,Entry>;
export type BackupResult={uploaded:number;skipped:number;total:number;bytes:number};
const SKIPPED=new Set(['worktrees','node_modules']);
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

async function* walk(root:string,relative=''):AsyncGenerator<string>{
  for(const entry of (await fs.readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){
    const next=relative?`${relative}/${entry.name}`:entry.name;
    if(entry.isDirectory()){if(!SKIPPED.has(entry.name))yield* walk(root,next);}
    else if(entry.isFile())yield next;
  }
}
async function readManifest(store:ObjectStore,prefix:string,key:Buffer):Promise<Manifest|null>{
  const sealed=await store.get(`${prefix}manifest.json`);
  return sealed?JSON.parse(Buffer.from(open(sealed,key)).toString('utf8')):null;
}
export async function backupTree(store:ObjectStore,root:string,prefix:string,key:Buffer):Promise<BackupResult>{
  const manifest=(await readManifest(store,prefix,key))??{},result={uploaded:0,skipped:0,total:0,bytes:0};
  const saveManifest=()=>store.put(`${prefix}manifest.json`,seal(Buffer.from(JSON.stringify(manifest)),key));
  for await(const file of walk(root)){
    const plain=await fs.readFile(path.join(root,...file.split('/'))),entry={sha256:sha(plain),size:plain.length},before=manifest[file];
    result.total++;result.bytes+=plain.length;
    if(before?.sha256===entry.sha256&&before.size===entry.size){result.skipped++;continue;}
    await store.put(`${prefix}files/${file}`,seal(plain,key));
    manifest[file]=entry;result.uploaded++;
    if(result.uploaded%200===0)await saveManifest();
  }
  await saveManifest();
  return result;
}
export async function restoreTree(store:ObjectStore,prefix:string,target:string,key:Buffer):Promise<number>{
  const existing=await fs.readdir(target).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
  if(existing.length)throw new Error(`A pasta de destino não está vazia: ${target}`);
  const manifest=await readManifest(store,prefix,key);
  if(!manifest)throw new Error(`Nenhuma cópia encontrada em ${prefix}`);
  let count=0;
  for(const [file,entry] of Object.entries(manifest)){
    const sealed=await store.get(`${prefix}files/${file}`);
    if(!sealed)throw new Error(`Arquivo ausente na cópia: ${file}`);
    let plain:Uint8Array;
    try{plain=open(sealed,key);}catch{throw new Error(`Arquivo corrompido na cópia: ${file}`);}
    if(plain.length!==entry.size||sha(plain)!==entry.sha256)throw new Error(`Arquivo não confere com o manifesto: ${file}`);
    const destination=path.join(target,...file.split('/'));
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.writeFile(destination,plain);count++;
  }
  return count;
}
