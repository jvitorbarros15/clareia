import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

type Fetch=(url:string)=>Promise<Response>;

export async function smokeSite(url:string,dir:string,get:Fetch=u=>fetch(u,{cache:'no-store',redirect:'manual'})):Promise<string[]>{
  const site=url.replace(/\/+$/,''),failures:string[]=[];
  const local=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8')) as {base:string};
  const person=(await fs.readdir(path.join(dir,local.base,'deputados')))[0];
  const check=async(label:string,fn:()=>Promise<void>)=>{try{await fn();}catch(e){failures.push(`${label}: ${(e as Error).message}`);}};
  await check('/',async()=>{
    const r=await get(site+'/');await r.arrayBuffer();
    if(r.status!==200)throw new Error(`status ${r.status}`);
    for(const h of ['content-security-policy','strict-transport-security'])if(!r.headers.get(h))throw new Error(`sem ${h}`);
    if(!/noindex/i.test(r.headers.get('x-robots-tag')??''))throw new Error('sem x-robots-tag noindex');
  });
  await check('/manifest.json',async()=>{
    const r=await get(site+'/manifest.json');
    if(r.status!==200)throw new Error(`status ${r.status}`);
    const remote=await r.json() as {base?:string};
    if(remote.base!==local.base)throw new Error(`base ${remote.base} diferente da local ${local.base}`);
  });
  for(const file of ['index.json','summary.json',`deputados/${person}/despesas.json`])await check(`${local.base}/${file}`,async()=>{
    const r=await get(`${site}/${local.base}/${file}`);
    if(r.status!==200)throw new Error(`status ${r.status}`);
    const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
    if(sha(new Uint8Array(await r.arrayBuffer()))!==sha(await fs.readFile(path.join(dir,local.base,file))))throw new Error('sha256 diferente do arquivo local');
    if(!/immutable/.test(r.headers.get('cache-control')??''))throw new Error('cache-control sem immutable');
  });
  await check(`${local.base}/nao-existe.json`,async()=>{
    const r=await get(`${site}/${local.base}/nao-existe.json`);await r.arrayBuffer();
    if(r.status!==404)throw new Error(`status ${r.status}, esperado 404`);
    if(!/no-store/.test(r.headers.get('cache-control')??''))throw new Error('cache-control sem no-store');
  });
  return failures;
}
