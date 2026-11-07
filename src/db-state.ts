import {spawn} from 'node:child_process';
import type {ObjectStore} from './object-store.ts';
import {open,seal} from './vault.ts';

export type Runner=(command:string,args:string[],input?:Uint8Array)=>Promise<Uint8Array>;
type Deps={key:Buffer;run?:Runner};
const PREFIX='dumps/';

export const runCommand:Runner=(command,args,input)=>new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:['pipe','pipe','pipe']}),out:Buffer[]=[],err:Buffer[]=[];
  child.stdout.on('data',chunk=>out.push(chunk));child.stderr.on('data',chunk=>err.push(chunk));
  child.on('error',reject);
  child.on('close',code=>code===0?resolve(Buffer.concat(out)):reject(new Error(`${command} falhou: ${Buffer.concat(err).toString().slice(0,500)}`)));
  child.stdin.end(input);
});
export function keepDumps(keys:string[]):string[]{
  const sorted=[...keys].sort(),newest=sorted.slice(-7),perMonth=new Map(sorted.map(key=>[key.slice(PREFIX.length,PREFIX.length+7),key]));
  return [...new Set([...perMonth.values(),...newest])].sort();
}
export async function saveState(store:ObjectStore,url:string,now:Date,{key,run=runCommand}:Deps):Promise<string>{
  const dump=await run('pg_dump',['--format=custom','--no-owner',`--dbname=${url}`]);
  const target=`${PREFIX}${now.toISOString().replace(/\.\d+Z$/,'Z').replaceAll(':','-')}.dump`;
  await store.put(target,seal(dump,key));
  const all=await store.list(PREFIX),kept=new Set(keepDumps(all));
  for(const old of all)if(!kept.has(old))await store.delete(old);
  return target;
}
// Starting from an empty database would silently disable the comparison with the previous version, so an empty store is an error unless bootstrapping.
export async function restoreState(store:ObjectStore,url:string,allowEmpty:boolean,{key,run=runCommand}:Deps):Promise<void>{
  const latest=(await store.list(PREFIX)).sort().at(-1);
  if(!latest){if(allowEmpty)return;throw new Error('Nenhuma cópia do banco encontrada');}
  const sealed=await store.get(latest);
  if(!sealed)throw new Error(`Cópia do banco ilegível: ${latest}`);
  await run('pg_restore',['--clean','--if-exists','--no-owner','--exit-on-error',`--dbname=${url}`],open(sealed,key));
}
