import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {smokeSite} from '../src/site-smoke.ts';

const files:Record<string,string>={'manifest.json':'{"base":"data/abc"}','data/abc/index.json':'{"i":1}','data/abc/summary.json':'{"s":1}','data/abc/deputados/7/despesas.json':'[1]'};
const setup=async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'smoke-'));for(const [f,c] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(dir,f)),{recursive:true});await fs.writeFile(path.join(dir,f),c);}return dir;};
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
