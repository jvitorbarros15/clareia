import fs from 'node:fs/promises';
import path from 'node:path';
import {loadAllowlist,scanFiles} from '../src/cpf-scan.ts';

const args=process.argv.slice(2),option=(name:string)=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const knownFile=option('--known'),allowFile=option('--allow')??path.join(import.meta.dirname,'..','config','cpf-allowlist.json');
const known=new Set(knownFile?(await fs.readFile(knownFile,'utf8')).split('\n').filter(Boolean):[]);
const targets=args.filter((a,i)=>!a.startsWith('--')&&!['--known','--allow'].includes(args[i-1]));
if(!targets.length)throw new Error('Uso: scan-cpf <pasta ou arquivo>... [--known arquivo] [--allow arquivo]');
const found=await scanFiles(targets,known,await loadAllowlist(allowFile));
for(const {file,count} of found)console.error(`${file}: ${count} ocorrência(s) de CPF`);
if(found.length)process.exitCode=1;
else console.log('Nenhum CPF encontrado.');
