import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {ObjectStore} from './object-store.ts';

const NONCE=12,TAG=16;

export function vaultKey(env:NodeJS.ProcessEnv=process.env):Buffer{
  const key=Buffer.from(env.CLAREIA_VAULT_KEY||'','base64');
  if(key.length!==32)throw new Error('CLAREIA_VAULT_KEY precisa ter 32 bytes em base64');
  return key;
}
export function seal(plain:Uint8Array,key:Buffer):Uint8Array{
  const nonce=randomBytes(NONCE),cipher=createCipheriv('aes-256-gcm',key,nonce);
  const body=Buffer.concat([cipher.update(plain),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),body]);
}
export function open(sealed:Uint8Array,key:Buffer):Uint8Array{
  const bytes=Buffer.from(sealed),decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,NONCE));
  decipher.setAuthTag(bytes.subarray(NONCE,NONCE+TAG));
  return Buffer.concat([decipher.update(bytes.subarray(NONCE+TAG)),decipher.final()]);
}
export const runKey=(runId:string,file:string)=>`originals/runs/${runId}/${file}`;
// The second annual pass is the one the version is built from; the first only proves the file was stable.
export async function archiveRun(store:ObjectStore,directory:string,runId:string,key:Buffer):Promise<number>{
  const files=(await fs.readdir(directory)).filter(file=>file!=='annual-1.csv.zip');
  for(const file of files)await store.put(runKey(runId,file),seal(await fs.readFile(path.join(directory,file)),key));
  return files.length;
}
