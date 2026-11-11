import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {officialUrl} from '../src/model.ts';

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log('npm run fetch:portraits -- --out PASTA [--config config/full-site.json] [--data-root data]\nBaixa os retratos oficiais das pessoas do histórico listado na configuração, sem repetir os que já existem. Exige JPEG de até 2 MB.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--out','--config','--data-root'].includes(args[i])&&args[i+1]){i++;continue;}throw new Error('Argumento inválido');}
const out=value('--out');if(!out)throw new Error('Informe --out');
const {historyRun}=JSON.parse(await fs.readFile(path.resolve(value('--config')||'config/full-site.json'),'utf8'));
if(!/^[a-zA-Z0-9-]{1,80}$/.test(historyRun??''))throw new Error('Configuração inválida: historyRun');
const history=JSON.parse(await fs.readFile(path.resolve(value('--data-root')||'data','private/people-history',historyRun,'history.json'),'utf8'));
await fs.mkdir(out,{recursive:true});
// Node's fetch is cut off by the Câmara servers; curl is not.
const curl=promisify(execFile);let ok=0,skipped=0,failed=0;
for(const p of history.people){
  const url=p.profile?.photo?officialUrl(p.profile.photo,'photo'):null,file=path.join(out,`${p.id}.jpg`);
  if(!url){skipped++;continue;}
  if(await fs.access(file).then(()=>true,()=>false)){ok++;continue;}
  try{
    await curl('curl',['-s','-f','--max-time','30','-o',file+'.tmp',url]);
    const bytes=new Uint8Array(await fs.readFile(file+'.tmp'));if(bytes.length>2000000||bytes[0]!==255||bytes[1]!==216)throw new Error('Retrato não é JPEG no limite esperado');
    await fs.rename(file+'.tmp',file);ok++;
  }catch{await fs.rm(file+'.tmp',{force:true});failed++;}
  await new Promise(r=>setTimeout(r,150));
}
console.log(JSON.stringify({ok,skipped,failed}));
if(failed)process.exitCode=1;
