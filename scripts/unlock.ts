import fs from 'node:fs/promises';
import {LOCK_FILE as file} from '../src/lock.ts';
const raw=await fs.readFile(file,'utf8');const info=JSON.parse(raw);
if(!Number.isInteger(info.pid)||info.pid<=0)throw new Error('PID de trava inválido; requer inspeção manual');
try{process.kill(info.pid,0);throw new Error('Processo ainda ativo; a trava foi preservada');}
catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
if(await fs.readFile(file,'utf8')!==raw)throw new Error('Trava mudou durante a inspeção');
await fs.unlink(file);console.log('Trava removida somente após confirmar que o processo terminou.');
