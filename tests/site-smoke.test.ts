import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {smokeSite} from '../src/site-smoke.ts';

const files:Record<string,string>={'manifest.json':'{"base":"data/abc"}','data/abc/index.json':'{"i":1}','data/abc/summary.json':'{"s":1}','data/abc/deputados/7/despesas.json':'[1]'};
const made:string[]=[];
after(()=>Promise.all(made.map(dir=>fs.rm(dir,{recursive:true,force:true}))));
const setup=async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'smoke-'));made.push(dir);for(const [f,c] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(dir,f)),{recursive:true});await fs.writeFile(path.join(dir,f),c);}return dir;};
const good=async(u:string)=>{
  const p=new URL(u).pathname.slice(1);
  if(p==='')return new Response('<html>',{headers:{'content-security-policy':'x','strict-transport-security':'x','x-robots-tag':'noindex, nofollow'}});
  if(p in files)return new Response(files[p],{headers:{'cache-control':p.startsWith('data/')?'public, immutable':'max-age=0'}});
  return new Response('no',{status:404,headers:{'cache-control':'no-store'}});
};

test('a correct deployment passes',async()=>{assert.deepEqual(await smokeSite('https://x.dev',await setup(),good),[]);});
test('missing headers, changed bytes and cached 404 are reported',async()=>{
  const bad=async(u:string)=>{
    const p=new URL(u).pathname.slice(1);
    if(p==='')return new Response('x');
    if(p.endsWith('summary.json'))return new Response('changed',{headers:{'cache-control':'immutable'}});
    if(p.endsWith('nao-existe.json'))return new Response('no',{status:404,headers:{'cache-control':'immutable'}});
    return good(u);
  };
  const failures=await smokeSite('https://x.dev',await setup(),bad);
  assert.equal(failures.length,3);
  assert.match(failures.join('|'),/content-security-policy[\s\S]*sha256[\s\S]*no-store/);
});
test('an indexed build is checked by robots.txt and sitemap, even when the preview host sends noindex',async()=>{
  const site=(robots:string,sitemap=200)=>async(u:string)=>{
    const p=new URL(u).pathname;
    if(p==='/robots.txt')return new Response(robots);
    if(p==='/sitemap.xml')return new Response('<urlset/>',{status:sitemap});
    return good(u);
  };
  const allow='User-agent: *\nAllow: /\n\nSitemap: https://clareia.org/sitemap.xml\n';
  assert.deepEqual(await smokeSite('https://x.dev',await setup(),site(allow),true),[]);
  assert.deepEqual(await smokeSite('https://x.dev',await setup(),site('User-agent: *\nDisallow: /\n'),true),['/robots.txt: robots.txt não libera a indexação']);
  assert.deepEqual(await smokeSite('https://x.dev',await setup(),site(allow,404),true),['/robots.txt: sitemap.xml status 404']);
  const noHeader=async(u:string)=>new URL(u).pathname==='/'?new Response('<html>',{headers:{'content-security-policy':'x','strict-transport-security':'x'}}):good(u);
  assert.deepEqual(await smokeSite('https://x.dev',await setup(),noHeader),['/: sem x-robots-tag noindex']);
});
