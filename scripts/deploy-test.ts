import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {smokeSite} from '../src/site-smoke.ts';
import {publishVersion} from '../src/deploy-version.ts';
import {createApp} from '../src/app.ts';

const WRANGLER='wrangler',OUT='build/site',TEST_WORKER='clareia';
const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log(`npm run deploy:test -- --portraits PASTA [--data-root data] [--ceiling-root data] [--config config/full-site.json] [--skip-verify-ui] [--share-images] [--index] [--known ARQUIVO] [--url URL] [--allow-missing-portraits (não vale com --yes)] [--dry-run | --yes]\nMonta o site completo em ${OUT}, procura CPF, confere os valores no navegador e só então publica com o ${WRANGLER} da lockfile. Qualquer etapa que falhar interrompe a cadeia. Sem --yes nada é publicado; --dry-run roda o wrangler sem publicar (não combina com --yes). Com --yes, o passo 4 sobe uma versão sem colocá-la no ar, o passo 5 confere o site na URL de prévia dessa versão e só então a versão é promovida a 100%; se a conferência falhar, nada muda no ar e o script diz qual versão ficou sem promover. --url só define o --site-url do build. --known repassa ao scan:cpf um arquivo local de CPFs conhecidos. verify:ui roda por padrão depois de verify:browser; --skip-verify-ui pula essa suíte.`);process.exit(0);}
for(let i=0;i<args.length;i++){if(['--yes','--dry-run','--skip-verify-ui','--allow-missing-portraits','--share-images','--index'].includes(args[i]))continue;if(['--portraits','--data-root','--ceiling-root','--config','--known','--url'].includes(args[i])&&args[i+1]){i++;continue;}throw new Error('Argumento inválido');}
const portraits=value('--portraits');if(!portraits)throw new Error('Informe --portraits');
if(args.includes('--yes')&&args.includes('--dry-run'))throw new Error('--yes e --dry-run não podem ser usados juntos');
if(args.includes('--yes')&&args.includes('--allow-missing-portraits'))throw new Error('--allow-missing-portraits não pode ser usado com --yes');
const passthrough=['--data-root','--ceiling-root','--config'].flatMap(f=>value(f)?[f,value(f)]:[]);
// Every step sees only what node, tsx and the browser need to run; no Cloudflare, R2 or database variable. Names are compared in upper case because Windows spells them Path, SystemRoot.
const pick=(names:string[])=>Object.fromEntries(Object.entries(process.env).filter(([k])=>names.includes(k.toUpperCase()))) as NodeJS.ProcessEnv;
const BASE_ENV=['PATH','PATHEXT','SYSTEMROOT','SYSTEMDRIVE','WINDIR','COMSPEC','TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMDATA','PROGRAMFILES','PROGRAMFILES(X86)','COMMONPROGRAMFILES','ALLUSERSPROFILE','USERNAME','USERDOMAIN','OS','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','NODE_OPTIONS','NODE_EXTRA_CA_CERTS','PLAYWRIGHT_BROWSERS_PATH','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'];
const STEP_ENV=pick(BASE_ENV);
const run=(label:string,command:string,commandArgs:string[],env:Record<string,string>={},childEnv:NodeJS.ProcessEnv=STEP_ENV)=>new Promise<void>((resolve,reject)=>{
  console.log(`\n== ${label}`);
  spawn(command,commandArgs,{stdio:'inherit',env:{...childEnv,...env}})
    .on('error',error=>reject(new Error(`${label} falhou: ${error.message}`)))
    .on('exit',code=>code===0?resolve():reject(new Error(`${label} falhou (código ${code})`)));
});
// wrangler also needs its config folder and the Cloudflare credentials.
const WRANGLER_ENV=pick([...BASE_ENV,'XDG_CONFIG_HOME','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID']);
const wranglerBin=path.resolve('node_modules','wrangler','bin','wrangler.js');
const node=process.execPath,tsx=(script:string,...rest:string[])=>['--import','tsx','--max-old-space-size=8192',script,...rest];
await run('1/5 build do site completo',node,tsx('scripts/build-full-site.ts','--out',OUT,'--portraits',portraits,...args.includes('--index')?['--sitemap']:['--noindex'],...value('--url')?['--site-url',value('--url')]:[],...passthrough,...args.includes('--allow-missing-portraits')?['--allow-missing-portraits']:[],...args.includes('--share-images')?['--share-images']:[]));
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
const capture=(label:string,commandArgs:string[])=>new Promise<string>((resolve,reject)=>{
  console.log(`\n== ${label}`);
  let out='';
  const child=spawn(node,commandArgs,{stdio:['inherit','pipe','inherit'],env:{...WRANGLER_ENV}});
  child.stdout.setEncoding('utf8').on('data',(chunk:string)=>{process.stdout.write(chunk);out+=chunk;});
  child.on('error',error=>reject(new Error(`${label} falhou: ${error.message}`)));
  child.on('close',code=>code===0?resolve(out):reject(new Error(`${label} falhou (código ${code})`)));
});
try{
  if(args.includes('--dry-run')){await run('4/5 wrangler versions upload --dry-run',node,[wranglerBin,'versions','upload','--dry-run'],{},WRANGLER_ENV);process.exit(0);}
  const version=await publishVersion({
    upload:()=>capture('4/5 wrangler versions upload',[wranglerBin,'versions','upload']),
    check:async previewUrl=>{
      console.log(`\n== 5/5 conferência na prévia da versão em ${previewUrl}`);
      let failures:string[]=[];
      for(let attempt=1;attempt<=6;attempt++){
        failures=await smokeSite(previewUrl,OUT,undefined,args.includes('--index')).catch(e=>[`falha ao conferir: ${(e as Error).message}`]);
        if(!failures.length)break;
        if(attempt<6){console.log(`tentativa ${attempt} falhou; nova tentativa em 6 s`);await new Promise(r=>setTimeout(r,6000));}
      }
      return failures;
    },
    promote:id=>run(`promoção da versão ${id} a 100%`,node,[wranglerBin,'versions','deploy',`${id}@100`,'--yes'],{},WRANGLER_ENV),
  });
  console.log(`\nVersão ${version.id} conferida na prévia e promovida a 100%.`);
}catch(e){
  console.error(`\n${(e as Error).message}`);
  console.error(`\nPara ver versões e implantações:\n  npx --no-install wrangler versions list\n  npx --no-install wrangler deployments list`);
  process.exit(1);
}
