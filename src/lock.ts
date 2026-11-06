import fs from 'node:fs/promises';
import path from 'node:path';
export const ROOT=path.resolve(import.meta.dirname,'..');
export const LOCK_FILE=path.join(ROOT,'data','pilot.lock');
async function stale(file:string){
  try{const {pid}=JSON.parse(await fs.readFile(file,'utf8'));if(!Number.isInteger(pid)||pid<=0)return false;process.kill(pid,0);return false;}
  catch(e){return (e as NodeJS.ErrnoException).code==='ESRCH';}
}
export async function lock(file=LOCK_FILE){
  await fs.mkdir(path.dirname(file),{recursive:true});
  for(const retry of [true,false]){
    let handle:fs.FileHandle;
    try{handle=await fs.open(file,'wx');}
    catch(e){
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
      // A hard crash or OOM kill leaves the file behind; only a provably dead owner gives it up.
      if(retry&&await stale(file)){await fs.unlink(file).catch(()=>{});continue;}
      throw new Error(`Outra tarefa possui ${file}. Encerre o servidor/coletor antes de continuar.`);
    }
    await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
    return async()=>{try{await handle.close();}finally{await fs.unlink(file);}};
  }
  throw new Error(`Não foi possível obter ${file}.`);
}
export async function withLock<T>(task:()=>Promise<T>,file=LOCK_FILE):Promise<T>{
  const release=await lock(file);
  try{return await task();}finally{await release();}
}
