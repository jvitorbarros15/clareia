import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'csv-parse/sync';
import {unzipSync} from 'fflate';

const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');
const SKIP=new Set(['.jpg','.jpeg','.png','.zip','.woff2']);

export function validCpf(digits:string):boolean{
  if(!/^\d{11}$/.test(digits)||/^(\d)\1+$/.test(digits))return false;
  const check=(size:number)=>{const sum=[...digits.slice(0,size)].reduce((n,c,i)=>n+Number(c)*(size+1-i),0),rest=sum*10%11;return rest===10?0:rest;};
  return check(9)===Number(digits[9])&&check(10)===Number(digits[10]);
}
// Official free text can carry a formatted CPF; it must not reach any report or the site.
export const redactCpf=(text:string)=>text.replace(/(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g,'[CPF omitido]');
// Plain 11-digit numbers are usually document numbers, so they only count when this run saw them as a CPF.
export function findCpfs(text:string,known:Set<string>):number{
  const formatted=[...text.matchAll(/(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g)].filter(m=>validCpf(m[0].replace(/\D/g,''))).length;
  const plain=[...text.matchAll(/(?<!\d)\d{11}(?!\d)/g)].filter(m=>known.has(sha256(m[0]))).length;
  return formatted+plain;
}
export async function knownCpfs(directory:string):Promise<Set<string>>{
  const known=new Set<string>();
  const add=(value:string)=>{const digits=value.replace(/\D/g,'');if(digits.length===11)known.add(sha256(digits));};
  for(const file of await fs.readdir(directory)){
    if(!file.endsWith('.json'))continue;
    const text=await fs.readFile(path.join(directory,file),'utf8');
    for(const m of text.matchAll(/"(?:cpf|cnpjCpfFornecedor)":"([^"]*)"/g))add(m[1]);
  }
  const archive=await fs.readFile(path.join(directory,'annual-2.csv.zip')).catch(()=>null);
  if(archive)for(const bytes of Object.values(unzipSync(archive))){
    const rows=parse(Buffer.from(bytes),{columns:true,delimiter:';',bom:true,relax_quotes:true,relax_column_count:true}) as {txtCNPJCPF?:string}[];
    for(const row of rows)add(row.txtCNPJCPF||'');
  }
  return known;
}
async function walk(target:string):Promise<string[]>{
  if(!(await fs.stat(target)).isDirectory())return [target];
  const entries=await fs.readdir(target,{withFileTypes:true});
  return (await Promise.all(entries.map(e=>walk(path.join(target,e.name))))).flat();
}
export async function scanFiles(targets:string[],known:Set<string>):Promise<{file:string;count:number}[]>{
  const found=[];
  for(const file of (await Promise.all(targets.map(walk))).flat()){
    if(SKIP.has(path.extname(file).toLowerCase()))continue;
    const count=findCpfs(await fs.readFile(file,'utf8'),known);
    if(count)found.push({file,count});
  }
  return found;
}
