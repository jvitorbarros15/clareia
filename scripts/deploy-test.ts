import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {smokeSite} from '../src/site-smoke.ts';
import {createApp} from '../src/app.ts';

const WRANGLER='wrangler@4.160.0',OUT='build/site',TEST_WORKER='clareia',DEFAULT_URL='https://clareia.clareia.workers.dev';
const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log(`npm run deploy:test -- --portraits PASTA [--data-root data] [--config config/full-site.json] [--skip-verify-ui] [--known ARQUIVO] [--url URL] [--allow-missing-portraits (não vale com --yes)] [--dry-run | --yes]\nMonta o site completo em ${OUT}, procura CPF, confere os valores no navegador e só então publica com ${WRANGLER}. Qualquer etapa que falhar interrompe a cadeia. Sem --yes nada é publicado; --dry-run roda o wrangler sem publicar (não combina com --yes). Depois de publicar, o passo 5 confere o site em --url (padrão ${DEFAULT_URL}) e, se algo falhar, mostra como voltar à versão anterior. --known repassa ao scan:cpf um arquivo local de CPFs conhecidos. verify:ui roda por padrão depois de verify:browser; --skip-verify-ui pula essa suíte.`);process.exit(0);}
for(let i=0;i<args.length;i++){if(['--yes','--dry-run','--skip-verify-ui','--allow-missing-portraits'].includes(args[i]))continue;if(['--portraits','--data-root','--config','--known','--url'].includes(args[i])&&args[i+1]){i++;continue;}throw new Error('Argumento inválido');}
const portraits=value('--portraits');if(!portraits)throw new Error('Informe --portraits');
if(args.includes('--yes')&&args.includes('--dry-run'))throw new Error('--yes e --dry-run não podem ser usados juntos');
if(args.includes('--yes')&&args.includes('--allow-missing-portraits'))throw new Error('--allow-missing-portraits não pode ser usado com --yes');
const passthrough=['--data-root','--config'].flatMap(f=>value(f)?[f,value(f)]:[]);
// Paths may contain spaces, so only the fixed npx call goes through a shell.
const run=(label:string,command:string,commandArgs:string[],env:Record<string,string>={},shell=false)=>new Promise<void>((resolve,reject)=>{
  console.log(`\n== ${label}`);
  spawn(command,commandArgs,{stdio:'inherit',shell,env:{...process.env,...env}}).on('exit',code=>code===0?resolve():reject(new Error(`${label} falhou (código ${code})`)));
});
const node=process.execPath,tsx=(script:string,...rest:string[])=>['--import','tsx','--max-old-space-size=8192',script,...rest];
await run('1/5 build do site completo',node,tsx('scripts/build-full-site.ts','--out',OUT,'--portraits',portraits,'--noindex',...value('--url')?['--site-url',value('--url')]:[],...passthrough,...args.includes('--allow-missing-portraits')?['--allow-missing-portraits']:[]));
const wranglerName=JSON.parse((await fs.readFile('wrangler.jsonc','utf8')).replace(/^\s*\/\/.*$/gm,'')).name;
if(/^\s*X-Robots-Tag:.*noindex/mi.test(await fs.readFile(path.join(OUT,'_headers'),'utf8'))&&wranglerName!==TEST_WORKER)throw new Error(`Build com noindex só pode ir para o Worker de teste "${TEST_WORKER}", não "${wranglerName}"`);
await run('2/5 busca de CPF',node,tsx('scripts/scan-cpf.ts',OUT,...value('--known')?['--known',value('--known')]:[]));
const server=createApp(OUT,0);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const env={BASE_URL:`http://127.0.0.1:${(server.address() as {port:number}).port}`};
  await run('3/5 conferência no navegador',node,['scripts/verify-real.cjs'],env);
  if(!args.includes('--skip-verify-ui'))await run('3/5 verify:ui',node,['scripts/verify-ui.cjs'],env);
}finally{server.close();}
const manifest=JSON.parse(await fs.readFile(path.join(OUT,'manifest.json'),'utf8')),wrangler=JSON.parse((await fs.readFile('wrangler.jsonc','utf8')).replace(/^\s*\/\/.*$/gm,''));
console.log(`\nSerá publicado: Worker "${wrangler.name}" com os arquivos de ${path.resolve(OUT)}\n  dados: ${manifest.base}\n${Object.entries(manifest.domains as Record<string,{version:string}>).map(([d,v])=>`  ${d}: ${v.version.slice(0,12)}`).join('\n')}`);
if(!args.includes('--yes')&&!args.includes('--dry-run')){console.error('\nNada foi publicado. Confirme com --yes (ou use --dry-run para só simular).');process.exit(1);}
await run(args.includes('--yes')?'4/5 wrangler deploy':'4/5 wrangler deploy --dry-run','npx',['--yes',WRANGLER,'deploy',...args.includes('--yes')?[]:['--dry-run']],{},true);
if(!args.includes('--yes'))process.exit(0);
const site=value('--url')||DEFAULT_URL;
console.log(`\n== 5/5 conferência do site publicado em ${site}`);
let failures:string[]=[];
for(let attempt=1;attempt<=6;attempt++){
  failures=await smokeSite(site,OUT).catch(e=>[`falha ao conferir: ${(e as Error).message}`]);
  if(!failures.length)break;
  if(attempt<6){console.log(`tentativa ${attempt} falhou; nova tentativa em 6 s`);await new Promise(r=>setTimeout(r,6000));}
}
if(failures.length){
  console.error(`\nA publicação NÃO passou na conferência:\n${failures.map(f=>'  - '+f).join('\n')}`);
  console.error(`\nPara voltar à versão anterior:\n  npx ${WRANGLER} deployments list\n  npx ${WRANGLER} versions list\n  npx ${WRANGLER} rollback [version-id]`);
  process.exit(1);
}
console.log('Site publicado e conferido.');
