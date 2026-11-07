import fs from 'node:fs/promises';
import {scanFiles} from '../src/cpf-scan.ts';

const args=process.argv.slice(2),flag=args.indexOf('--known');
const known=new Set(flag>=0?(await fs.readFile(args[flag+1],'utf8')).split('\n').filter(Boolean):[]);
const targets=args.filter((_,i)=>flag<0||(i!==flag&&i!==flag+1));
if(!targets.length)throw new Error('Uso: scan-cpf <pasta ou arquivo>... [--known arquivo]');
const found=await scanFiles(targets,known);
for(const {file,count} of found)console.error(`${file}: ${count} ocorrência(s) de CPF`);
if(found.length)process.exitCode=1;
else console.log('Nenhum CPF encontrado.');
