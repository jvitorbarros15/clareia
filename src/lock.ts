import fs from 'node:fs/promises';
import path from 'node:path';
export const ROOT=path.resolve(import.meta.dirname,'..');
export const LOCK_FILE=path.join(ROOT,'data','pilot.lock');
export async function lock(file=LOCK_FILE){
  await fs.mkdir(path.dirname(file),{recursive:true});let handle;
  try{handle=await fs.open(file,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));}
  catch{throw new Error(`Outra tarefa possui ${file}. Encerre o servidor/coletor antes de continuar. Após queda, confira o PID e remova apenas essa trava.`);}
  return async()=>{try{await handle.close();}finally{await fs.unlink(file);}};
}
export async function withLock<T>(task:()=>Promise<T>,file=LOCK_FILE):Promise<T>{
  const release=await lock(file);
  try{return await task();}finally{await release();}
}
