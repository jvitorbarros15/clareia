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
const LABELLED=/\bC\.?P\.?F\.?[^0-9]{0,30}(?<!\d)(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\/.\s]?\d{2})(?!\d)/gi;
// A CPF is exactly 11 digits with valid check digits, bounded by non-digits ("MEI-<cpf>" counts, "MEI<cpf>" too), with or without punctuation.
// A run of 12 or more digits is a longer number (CNPJ, protocol, bank key) and is never cut into an 11-digit piece, and a CNPJ's
// punctuation ("/") breaks the pattern. Lowercase hex tokens (hashes, ids) are blanked first so their digit stretches are not read as numbers.
const DIGIT_CPF=/(?<!\d)(?<!\d\.)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g;
const HEX_TOKEN=/(?<![0-9A-Za-z])(?=[0-9a-f]*[a-f])[0-9a-f]{12,}(?![0-9A-Za-z])/g;
export function cpfRuns(text:string):string[]{
  return [...text.replace(HEX_TOKEN,m=>'x'.repeat(m.length)).matchAll(DIGIT_CPF)].map(m=>m[0].replace(/\D/g,'')).filter(validCpf);
}
export const redactCpf=(text:string)=>text.replace(LABELLED,(whole,digits:string)=>whole.replace(digits,'[CPF omitido]')).replace(/(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g,'[CPF omitido]').replace(DIGIT_CPF,m=>validCpf(m.replace(/\D/g,''))?'[CPF omitido]':m);
// Free text from the source (supplier names, document ids, categories, receipt links) is redacted before it reaches any published file.
export function redactExpense<T extends {supplier:string;documentId:string;documentNumber:string;category:string;lot?:string;receipt:string|null}>(r:T,counter?:{n:number}):T{
  const out={...r};
  for(const k of ['supplier','documentId','documentNumber','category','lot','receipt'] as const){
    const v=out[k];if(typeof v!=='string')continue;
    const clean=redactCpf(v);if(clean!==v){(out as Record<string,unknown>)[k]=clean;if(counter)counter.n++;}
  }
  return out;
}
// Plain 11-digit numbers are usually document numbers, so they only count when this run saw them as a CPF.
export function findCpfs(text:string,known:Set<string>):number{
  const formatted=[...text.matchAll(/(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g)].filter(m=>validCpf(m[0].replace(/\D/g,''))).length;
  const plain=[...text.matchAll(/(?<!\d)\d{11}(?!\d)/g)].filter(m=>known.has(sha256(m[0]))).length;
  const labelled=[...text.matchAll(LABELLED)].length;
  return formatted+plain+labelled;
}
// The scanner's verdict: every valid CPF run counts unless a confirmed false positive is allowlisted by the hash of its digits.
export function scanCpfs(text:string,known:Set<string>,allow:Set<string>=new Set()):number{
  const strict=cpfRuns(text).filter(d=>!allow.has(sha256(d))).length;
  const knownOnly=[...text.matchAll(/(?<!\d)\d{11}(?!\d)/g)].filter(m=>!validCpf(m[0])&&known.has(sha256(m[0]))).length;
  return strict+knownOnly+[...text.matchAll(LABELLED)].length;
}
export async function loadAllowlist(file:string):Promise<Set<string>>{
  const entries=(JSON.parse(await fs.readFile(file,'utf8')) as {entries:{sha256:string;reason:string}[]}).entries;
  for(const e of entries)if(!/^[0-9a-f]{64}$/.test(e.sha256)||typeof e.reason!=='string'||e.reason.trim().length<10)throw new Error('Entrada da lista de exceções de CPF sem hash válido ou sem motivo');
  return new Set(entries.map(e=>e.sha256));
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
export async function scanFiles(targets:string[],known:Set<string>,allow:Set<string>=new Set()):Promise<{file:string;count:number}[]>{
  const found=[];
  for(const file of (await Promise.all(targets.map(walk))).flat()){
    if(SKIP.has(path.extname(file).toLowerCase()))continue;
    const count=scanCpfs(await fs.readFile(file,'utf8'),known,allow);
    if(count)found.push({file,count});
  }
  return found;
}
