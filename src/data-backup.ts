import {createHash,createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {ObjectStore} from './object-store.ts';
import {open,seal} from './vault.ts';

type Entry={sha256:string;size:number;object:string};
type Manifest={files:Map<string,Entry>;emptyDirs:string[]};
export type Skipped={count:number;examples:string[]};
export type BackupResult={files:number;uploaded:number;alreadyStored:number;bytesUploaded:number;manifest:string;skipped:Skipped};
export type VerifyResult={manifest:string;files:number;objects:number;missing:string[]};
const SKIPPED=new Set(['worktrees','node_modules']),LOCKS=new Set(['running.lock','pilot.lock']);
const WORKERS=8,EXAMPLES=5,MAX_FILE=4*1024**3,POSTMASTER='local/postgres/postmaster.pid';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const objectName=(key:Buffer,digest:string)=>createHmac('sha256',key).update(digest).digest('hex');

async function scan(root:string){
  const files:string[]=[],emptyDirs:string[]=[],locks:string[]=[],skipped:Skipped={count:0,examples:[]};
  const skip=(file:string)=>{skipped.count++;if(skipped.examples.length<EXAMPLES)skipped.examples.push(file);};
  const visit=async(relative:string):Promise<boolean>=>{
    let content=false;
    for(const entry of (await fs.readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:1)){
      const next=relative?`${relative}/${entry.name}`:entry.name;
      if(entry.isDirectory()&&!entry.isSymbolicLink()){
        if(SKIPPED.has(entry.name))skip(next);
        else{if(!await visit(next))emptyDirs.push(next);content=true;}
      }else if(entry.isFile()){files.push(next);content=true;if(LOCKS.has(entry.name))locks.push(next);}
      else skip(next);
    }
    return content;
  };
  await visit('');
  return {files,emptyDirs,locks,skipped};
}
async function pool<T>(items:T[],work:(item:T)=>Promise<void>){
  let next=0,failure:{error:unknown}|undefined;
  await Promise.all(Array.from({length:Math.min(WORKERS,items.length)},async()=>{
    while(!failure&&next<items.length){try{await work(items[next++]);}catch(error){failure??={error};}}
  }));
  if(failure)throw failure.error;
}
async function readManifest(store:ObjectStore,prefix:string,key:Buffer,at?:string):Promise<{name:string;manifest:Manifest}>{
  const names=(await store.list(`${prefix}manifests/`)).filter(name=>name.endsWith('.json')).sort();
  const name=at?`${prefix}manifests/${at.replace(/\.json$/,'')}.json`:names[names.length-1];
  const sealed=name&&names.includes(name)?await store.get(name):null;
  if(!name||!sealed)throw new Error(at?`Manifesto não encontrado: ${at}`:`Nenhuma cópia encontrada em ${prefix}`);
  try{
    const raw=JSON.parse(Buffer.from(open(sealed,key)).toString('utf8'));
    if(!Array.isArray(raw.files)||!Array.isArray(raw.emptyDirs))throw new Error('formato');
    return {name,manifest:{files:new Map(raw.files.map((f:Entry&{path:string})=>[f.path,{sha256:f.sha256,size:f.size,object:f.object}])),emptyDirs:raw.emptyDirs}};
  }catch{throw new Error('Chave do cofre errada ou manifesto corrompido');}
}
export async function backupTree(store:ObjectStore,root:string,prefix:string,key:Buffer):Promise<BackupResult>{
  const {files,emptyDirs,locks,skipped}=await scan(root);
  const busy=[...locks,...files.filter(file=>file===POSTMASTER)];
  if(busy.length)throw new Error(`O banco ou uma tarefa parece estar em uso (${busy.join(', ')}). Feche o processo e tente de novo.`);
  const objects=`${prefix}objects/`,known=new Set((await store.list(objects)).map(name=>name.slice(objects.length)));
  const entries=new Map<string,Entry>(),result={files:files.length,uploaded:0,alreadyStored:0,bytesUploaded:0};
  await pool(files,async file=>{
    const full=path.join(root,...file.split('/'));
    if((await fs.stat(full)).size>MAX_FILE)throw new Error(`Arquivo maior que 4 GB: ${file}`);
    const plain=await fs.readFile(full),digest=sha(plain),object=objectName(key,digest);
    entries.set(file,{sha256:digest,size:plain.length,object});
    if(known.has(object)){result.alreadyStored++;return;}
    known.add(object);
    await store.put(`${objects}${object}`,seal(plain,key));
    result.uploaded++;result.bytesUploaded+=plain.length;
  });
  const taken=new Set(await store.list(`${prefix}manifests/`));
  let at=Date.now(),manifest:string;
  while(taken.has(manifest=`${prefix}manifests/${new Date(at).toISOString().replace(/[:.]/g,'-')}.json`))at++;
  const body={version:1,files:[...entries].sort((a,b)=>a[0]<b[0]?-1:1).map(([file,entry])=>({path:file,...entry})),emptyDirs};
  await store.put(manifest,seal(Buffer.from(JSON.stringify(body)),key));
  return {...result,manifest,skipped};
}
const unsafe=(file:string)=>file.split('/').some(part=>part===''||part==='.'||part==='..')||/[\\:]/.test(file);
export async function restoreTree(store:ObjectStore,prefix:string,target:string,key:Buffer,at?:string):Promise<number>{
  const existing=await fs.readdir(target).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return [];throw error;});
  if(existing.length)throw new Error(`A pasta de destino não está vazia: ${target}`);
  const {manifest}=await readManifest(store,prefix,key,at),base=path.resolve(target);
  const place=(file:string)=>{
    const destination=path.resolve(base,file);
    if(unsafe(file)||!destination.startsWith(base+path.sep))throw new Error(`Caminho inseguro no manifesto: ${file}`);
    return destination;
  };
  const dirs=manifest.emptyDirs.map(place),files=[...manifest.files].map(([file,entry])=>{
    if(!/^[0-9a-f]{64}$/.test(entry.object))throw new Error(`Manifesto corrompido: ${file}`);
    return {file,entry,destination:place(file)};
  });
  await fs.mkdir(base,{recursive:true});
  for(const dir of dirs)await fs.mkdir(dir,{recursive:true});
  await pool(files,async({file,entry,destination})=>{
    const sealed=await store.get(`${prefix}objects/${entry.object}`);
    if(!sealed)throw new Error(`Arquivo ausente na cópia: ${file}`);
    let plain:Uint8Array;
    try{plain=open(sealed,key);}catch{throw new Error(`Arquivo corrompido na cópia: ${file}`);}
    if(plain.length!==entry.size||sha(plain)!==entry.sha256)throw new Error(`Arquivo não confere com o manifesto: ${file}`);
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.writeFile(destination,plain);
  });
  return files.length;
}
export async function verifyBackup(store:ObjectStore,prefix:string,key:Buffer):Promise<VerifyResult>{
  const {name,manifest}=await readManifest(store,prefix,key),stored=new Set(await store.list(`${prefix}objects/`));
  const missing=[...manifest.files].filter(([,entry])=>!stored.has(`${prefix}objects/${entry.object}`)).map(([file])=>file);
  return {manifest:name,files:manifest.files.size,objects:new Set([...manifest.files.values()].map(entry=>entry.object)).size,missing};
}
