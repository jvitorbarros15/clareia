import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {backupTree,restoreTree} from '../src/data-backup.ts';
import {memoryStore} from '../src/object-store.ts';

const key=randomBytes(32),prefix='backups/t/';
const write=async(root:string,file:string,body:string|Uint8Array)=>{const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,body);};
const temp=()=>fs.mkdtemp(path.join(os.tmpdir(),'clareia-backup-'));
async function sample(){
  const root=await temp();
  await write(root,'a.json','{"a":1}');
  await write(root,'lot/pass-1/original.bin',randomBytes(5000));
  await write(root,'lot/empty.txt','');
  await write(root,'worktrees/other/skip.txt','skip');
  await write(root,'lot/node_modules/pkg/skip.js','skip');
  return root;
}

test('backup and restore round trip is byte for byte and skips worktrees and node_modules',async()=>{
  const store=memoryStore(),root=await sample(),target=path.join(await temp(),'out');
  const result=await backupTree(store,root,prefix,key);
  assert.deepEqual(result,{uploaded:3,skipped:0,total:3,bytes:7+5000});
  assert.equal(await restoreTree(store,prefix,target,key),3);
  for(const file of ['a.json','lot/pass-1/original.bin','lot/empty.txt'])assert.deepEqual(await fs.readFile(path.join(target,file)),await fs.readFile(path.join(root,file)));
  await assert.rejects(fs.stat(path.join(target,'worktrees')));
  await assert.rejects(fs.stat(path.join(target,'lot/node_modules')));
});

test('second backup uploads only changed files and keeps files removed locally',async()=>{
  const store=memoryStore(),root=await sample();
  await backupTree(store,root,prefix,key);
  assert.deepEqual(await backupTree(store,root,prefix,key),{uploaded:0,skipped:3,total:3,bytes:5007});
  await write(root,'a.json','{"a":2}');
  assert.deepEqual(await backupTree(store,root,prefix,key),{uploaded:1,skipped:2,total:3,bytes:5007});
  await fs.rm(path.join(root,'lot/empty.txt'));
  assert.equal((await backupTree(store,root,prefix,key)).total,2);
  assert.notEqual(await store.get(`${prefix}files/lot/empty.txt`),null);
  const target=path.join(await temp(),'out');
  assert.equal(await restoreTree(store,prefix,target,key),3);
  assert.equal(await fs.readFile(path.join(target,'a.json'),'utf8'),'{"a":2}');
});

test('restore refuses a non-empty target and a missing backup',async()=>{
  const store=memoryStore(),root=await sample();
  await backupTree(store,root,prefix,key);
  await assert.rejects(restoreTree(store,prefix,root,key),/não está vazia/);
  await assert.rejects(restoreTree(store,'backups/none/',path.join(await temp(),'out'),key),/Nenhuma cópia/);
});

test('restore fails naming the file when an object is tampered with or missing',async()=>{
  const store=memoryStore(),root=await sample();
  await backupTree(store,root,prefix,key);
  const sealed=await store.get(`${prefix}files/a.json`) as Uint8Array,bad=Uint8Array.from(sealed);
  bad[bad.length-1]^=1;
  await store.put(`${prefix}files/a.json`,bad);
  await assert.rejects(restoreTree(store,prefix,path.join(await temp(),'out'),key),/corrompido.*a\.json/);
  await store.delete(`${prefix}files/a.json`);
  await assert.rejects(restoreTree(store,prefix,path.join(await temp(),'out'),key),/ausente.*a\.json/);
});

test('restore fails when a valid object was swapped for another file',async()=>{
  const store=memoryStore(),root=await sample();
  await backupTree(store,root,prefix,key);
  await store.put(`${prefix}files/a.json`,await store.get(`${prefix}files/lot/pass-1/original.bin`) as Uint8Array);
  await assert.rejects(restoreTree(store,prefix,path.join(await temp(),'out'),key),/não confere.*a\.json/);
});

test('objects in the store are sealed',async()=>{
  const store=memoryStore(),root=await temp();
  await write(root,'secret.txt','texto muito secreto');
  await backupTree(store,root,prefix,key);
  for(const name of await store.list(prefix))assert.equal(Buffer.from(await store.get(name) as Uint8Array).includes('texto muito secreto'),false);
  assert.equal(Buffer.from(await store.get(`${prefix}manifest.json`) as Uint8Array).includes('secret.txt'),false);
});
