import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createApp} from '../src/app.ts';

const WRANGLER='wrangler@4.160.0',OUT='build/site';
const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log(`npm run deploy:test -- --portraits PASTA [--data-root data] [--config config/full-site.json] [--verify-ui] [--dry-run] [--yes]\nMonta o site completo em ${OUT}, procura CPF, confere os valores no navegador e só então publica com ${WRANGLER}. Qualquer etapa que falhar interrompe a cadeia. Sem --yes nada é publicado; --dry-run roda o wrangler sem publicar. --verify-ui acrescenta a suíte verify:ui, escrita para o piloto de 3 deputados.`);process.exit(0);}
for(let i=0;i<args.length;i++){if(['--yes','--dry-run','--verify-ui'].includes(args[i]))continue;if(['--portraits','--data-root','--config'].includes(args[i])&&args[i+1]){i++;continue;}throw new Error('Argumento inválido');}
const portraits=value('--portraits');if(!portraits)throw new Error('Informe --portraits');
const passthrough=['--data-root','--config'].flatMap(f=>value(f)?[f,value(f)]:[]);
// Paths may contain spaces, so only the fixed npx call goes through a shell.
const run=(label:string,command:string,commandArgs:string[],env:Record<string,string>={},shell=false)=>new Promise<void>((resolve,reject)=>{
  console.log(`\n== ${label}`);
  spawn(command,commandArgs,{stdio:'inherit',shell,env:{...process.env,...env}}).on('exit',code=>code===0?resolve():reject(new Error(`${label} falhou (código ${code})`)));
});
const node=process.execPath,tsx=(script:string,...rest:string[])=>['--import','tsx','--max-old-space-size=8192',script,...rest];
await run('1/4 build do site completo',node,tsx('scripts/build-full-site.ts','--out',OUT,'--portraits',portraits,'--noindex',...passthrough));
await run('2/4 busca de CPF',node,tsx('scripts/scan-cpf.ts',OUT));
const server=createApp(OUT,0);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const env={BASE_URL:`http://127.0.0.1:${(server.address() as {port:number}).port}`};
  await run('3/4 conferência no navegador',node,['scripts/verify-real.cjs'],env);
  if(args.includes('--verify-ui'))await run('3/4 verify:ui',node,['scripts/verify-ui.cjs'],env);
}finally{server.close();}
const manifest=JSON.parse(await fs.readFile(path.join(OUT,'manifest.json'),'utf8')),wrangler=JSON.parse((await fs.readFile('wrangler.jsonc','utf8')).replace(/^\s*\/\/.*$/gm,''));
console.log(`\nSerá publicado: Worker "${wrangler.name}" com os arquivos de ${path.resolve(OUT)}\n  dados: ${manifest.base}\n${Object.entries(manifest.domains as Record<string,{version:string}>).map(([d,v])=>`  ${d}: ${v.version.slice(0,12)}`).join('\n')}`);
if(!args.includes('--yes')&&!args.includes('--dry-run')){console.error('\nNada foi publicado. Confirme com --yes (ou use --dry-run para só simular).');process.exit(1);}
await run(args.includes('--yes')?'4/4 wrangler deploy':'4/4 wrangler deploy --dry-run','npx',['--yes',WRANGLER,'deploy',...args.includes('--yes')?[]:['--dry-run']],{},true);
