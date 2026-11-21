import fs from 'node:fs/promises';
import path from 'node:path';
import {BASE,socialLinks} from '../src/model.ts';
import {download} from '../src/people-discovery.ts';
import {yearFolderOf} from '../src/year-view.ts';

const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??'';};
if(args.includes('--help')){console.log('npm run collect:social -- --site PASTA --run ID\nLê as redes sociais que cada deputado do site montado informou à Câmara. Guarda só links de redes conhecidas; o resto do cadastro, CPF incluído, não é gravado.');process.exit(0);}
for(let i=0;i<args.length;i++){if(['--site','--run'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--')){i++;continue;}throw new Error('Argumento inválido');}
const site=value('--site'),runId=value('--run');
if(!site||!/^[a-zA-Z0-9-]{1,80}$/.test(runId))throw new Error('Informe --site e um --run válido');
const manifest=JSON.parse(await fs.readFile(path.join(site,'manifest.json'),'utf8')),ids=new Set<number>();
for(const {year} of manifest.years)for(const id of JSON.parse(await fs.readFile(path.join(site,yearFolderOf(manifest,year),'index.json'),'utf8')).scope.ids)ids.add(id);
const root=path.resolve('data/private/social',runId),people:Record<string,string[]>={},failed:number[]=[],networks:Record<string,number>={};let dropped=0;
await fs.mkdir(root,{recursive:true});
for(const id of [...ids].sort((a,b)=>a-b)){
  try{
    const dados=JSON.parse(Buffer.from(await download(`${BASE}/deputados/${id}`)).toString()).dados;
    if(dados?.id!==id)throw new Error('Cadastro incompatível');
    const links=socialLinks(dados.redeSocial);
    dropped+=(Array.isArray(dados.redeSocial)?dados.redeSocial.length:0)-links.length;
    for(const l of links)networks[l.network]=(networks[l.network]??0)+1;
    if(links.length)people[id]=links.map(l=>l.url);
  }catch{failed.push(id);}
  await new Promise(r=>setTimeout(r,150));
}
await fs.writeFile(path.join(root,'social.json'),JSON.stringify({schema:'clareia.social.v1',createdAt:new Date().toISOString(),source:`${BASE}/deputados/{id} dados.redeSocial`,ids:ids.size,people,failed},null,2),{flag:'wx'});
console.log(JSON.stringify({ids:ids.size,withLinks:Object.keys(people).length,networks,dropped,failed:failed.length}));
if(failed.length)process.exitCode=1;
