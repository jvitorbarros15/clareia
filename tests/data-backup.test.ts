import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {backupTree,restoreTree,verifyBackup} from '../src/data-backup.ts';
import {memoryStore} from '../src/object-store.ts';
import type {ObjectStore} from '../src/object-store.ts';
import {seal} from '../src/vault.ts';

const key=randomBytes(32),prefix='backups/t/';
const write=async(root:string,file:string,body:string|Uint8Array)=>{const target=path.join(root,file);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,body);};
const temp=()=>fs.mkdtemp(path.join(os.tmpdir(),'clareia-backup-'));
const out=async()=>path.join(await temp(),'out');
const objectKey=(body:string|Uint8Array)=>`${prefix}objects/${createHmac('sha256',key).update(createHash('sha256').update(body).digest('hex')).digest('hex')}`;
const manifests=(store:ObjectStore)=>store.list(`${prefix}manifests/`);
const counting=(inner:ObjectStore,failOn=0)=>{
  const puts:string[]=[];
  const store:ObjectStore={...inner,put:async(name,body)=>{puts.push(name);if(puts.length===failOn)throw new Error('queda no meio');return inner.put(name,body);}};
  return {store,puts};
};
const binary=randomBytes(5000);
async function sample(){
  const root=await temp();
  await write(root,'a.json','{"a":1}');
  await write(root,'lot/pass-1/original.bin',binary);
  await write(root,'lot/empty.txt','');
  await fs.mkdir(path.join(root,'lot/vazia/aninhada'),{recursive:true});
  await write(root,'worktrees/other/skip.txt','skip');
  await write(root,'lot/node_modules/pkg/skip.js','skip');
  return root;
}
const handSealed=async(store:ObjectStore,body:object,sealKey=key)=>store.put(`${prefix}manifests/2026-01-01T00-00-00-000Z.json`,seal(Buffer.from(JSON.stringify(body)),sealKey));

test('backup and restore round trip is byte for byte and skips worktrees and node_modules visibly',async()=>{
  const store=memoryStore(),root=await sample(),target=await out();
  const result=await backupTree(store,root,prefix,key);
  assert.deepEqual({...result,manifest:undefined},{files:3,uploaded:3,alreadyStored:0,bytesUploaded:5007,manifest:undefined,skipped:{count:2,examples:['lot/node_modules','worktrees']}});
  assert.match(result.manifest,/^backups\/t\/manifests\/\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.json$/);
  assert.equal(await restoreTree(store,prefix,target,key),3);
  for(const file of ['a.json','lot/pass-1/original.bin','lot/empty.txt'])assert.deepEqual(await fs.readFile(path.join(target,file)),await fs.readFile(path.join(root,file)));
  await assert.rejects(fs.stat(path.join(target,'worktrees')));
  await assert.rejects(fs.stat(path.join(target,'lot/node_modules')));
});

test('symlinks are skipped and reported',async t=>{
  const root=await sample();
  try{await fs.symlink(path.join(root,'a.json'),path.join(root,'link.json'));}catch{t.skip('sem permissão para criar link simbólico');return;}
  const result=await backupTree(memoryStore(),root,prefix,key);
  assert.equal(result.files,3);
  assert.ok(result.skipped.examples.includes('link.json'));
});

test('second backup uploads only changed files, keeps every manifest and the history restores',async()=>{
  const store=memoryStore(),root=await sample();
  const first=await backupTree(store,root,prefix,key);
  const again=await backupTree(store,root,prefix,key);
  assert.deepEqual([again.files,again.uploaded,again.alreadyStored,again.bytesUploaded],[3,0,3,0]);
  await write(root,'a.json','{"a":2}');
  const changed=await backupTree(store,root,prefix,key);
  assert.deepEqual([changed.uploaded,changed.alreadyStored,changed.bytesUploaded],[1,2,7]);
  await fs.rm(path.join(root,'lot/empty.txt'));
  assert.equal((await backupTree(store,root,prefix,key)).files,2);
  assert.equal((await manifests(store)).length,4);
  const latest=await out(),old=await out();
  assert.equal(await restoreTree(store,prefix,latest,key),2);
  assert.equal(await fs.readFile(path.join(latest,'a.json'),'utf8'),'{"a":2}');
  assert.equal(await restoreTree(store,prefix,old,key,first.manifest.slice(`${prefix}manifests/`.length)),3);
  assert.equal(await fs.readFile(path.join(old,'a.json'),'utf8'),'{"a":1}');
  await assert.rejects(restoreTree(store,prefix,await out(),key,'2000-01-01T00-00-00-000Z'),/Manifesto não encontrado/);
});

test('restore refuses a non-empty target and a missing backup',async()=>{
  const store=memoryStore(),root=await sample();
  await backupTree(store,root,prefix,key);
  await assert.rejects(restoreTree(store,prefix,root,key),/não está vazia/);
  await assert.rejects(restoreTree(store,'backups/none/',await out(),key),/Nenhuma cópia/);
});

test('restore fails naming the file when an object is tampered with or missing',async()=>{
  const store=memoryStore(),root=await sample(),object=objectKey('{"a":1}');
  await backupTree(store,root,prefix,key);
  const sealed=await store.get(object) as Uint8Array,bad=Uint8Array.from(sealed);
  bad[bad.length-1]^=1;
  await store.put(object,bad);
  await assert.rejects(restoreTree(store,prefix,await out(),key),/corrompido.*a\.json/);
  await store.delete(object);
  await assert.rejects(restoreTree(store,prefix,await out(),key),/ausente.*a\.json/);
});

test('restore fails when a valid object was swapped for another file',async()=>{
  const store=memoryStore(),root=await sample();
  await backupTree(store,root,prefix,key);
  await store.put(objectKey('{"a":1}'),await store.get(objectKey(binary)) as Uint8Array);
  await assert.rejects(restoreTree(store,prefix,await out(),key),/não confere.*a\.json/);
});

test('objects and manifests are sealed and object keys leak no path',async()=>{
  const store=memoryStore(),root=await temp();
  await write(root,'segredo/dossie-secreto.txt','texto muito secreto');
  await backupTree(store,root,prefix,key);
  const names=await store.list(prefix);
  assert.equal(names.length,2);
  for(const name of names){
    assert.doesNotMatch(name,/segredo|dossie|secreto/);
    assert.equal(Buffer.from(await store.get(name) as Uint8Array).includes('secreto'),false);
  }
  assert.ok(names.includes(objectKey('texto muito secreto')));
});

test('two identical files upload once',async()=>{
  const store=memoryStore(),root=await temp();
  await write(root,'um.txt','igual');await write(root,'dois/outro.txt','igual');
  const result=await backupTree(store,root,prefix,key);
  assert.deepEqual([result.files,result.uploaded,result.alreadyStored,result.bytesUploaded],[2,1,1,5]);
  assert.equal((await store.list(`${prefix}objects/`)).length,1);
  const target=await out();
  assert.equal(await restoreTree(store,prefix,target,key),2);
  assert.equal(await fs.readFile(path.join(target,'dois/outro.txt'),'utf8'),'igual');
});

test('a crash mid-run leaves the previous manifest restorable and the next run completes',async()=>{
  const inner=memoryStore(),root=await sample();
  await backupTree(inner,root,prefix,key);
  await write(root,'novo-1.txt','um');await write(root,'novo-2.txt','dois');await write(root,'a.json','{"a":9}');
  const {store}=counting(inner,2);
  await assert.rejects(backupTree(store,root,prefix,key),/queda no meio/);
  assert.equal((await manifests(inner)).length,1);
  const before=await out();
  assert.equal(await restoreTree(inner,prefix,before,key),3);
  assert.equal(await fs.readFile(path.join(before,'a.json'),'utf8'),'{"a":1}');
  const result=await backupTree(inner,root,prefix,key);
  assert.equal(result.files,5);
  const after=await out();
  assert.equal(await restoreTree(inner,prefix,after,key),5);
  assert.equal(await fs.readFile(path.join(after,'a.json'),'utf8'),'{"a":9}');
});

test('resume does not re-upload stored objects',async()=>{
  const inner=memoryStore(),root=await sample();
  await write(root,'novo-1.txt','um');await write(root,'novo-2.txt','dois');
  const crashed=counting(inner,3);
  await assert.rejects(backupTree(crashed.store,root,prefix,key),/queda no meio/);
  const stored=(await inner.list(`${prefix}objects/`)).length;
  assert.ok(stored>=1&&stored<5);
  const resumed=counting(inner),result=await backupTree(resumed.store,root,prefix,key);
  assert.equal(result.alreadyStored,stored);
  assert.equal(result.uploaded,5-stored);
  assert.equal(resumed.puts.length,5-stored+1);
});

test('empty directories round trip',async()=>{
  const store=memoryStore(),root=await sample(),target=await out();
  await backupTree(store,root,prefix,key);
  await restoreTree(store,prefix,target,key);
  for(const dir of ['lot/vazia/aninhada'])assert.deepEqual(await fs.readdir(path.join(target,dir)),[]);
  assert.ok((await fs.stat(path.join(target,'lot/vazia'))).isDirectory());
});

test('a real PGlite database round trips and opens with its rows',async()=>{
  const root=await temp();await fs.mkdir(path.join(root,'local'));const db=new PGlite(path.join(root,'local','postgres'));
  await db.exec('create table pessoas(id int primary key,nome text)');
  await db.query("insert into pessoas values (1,'Ana'),(2,'Bruno'),(3,'Cecília')");
  await db.close();
  await write(root,'private/nota.txt','nota');
  const store=memoryStore(),target=await out();
  await backupTree(store,root,prefix,key);
  await restoreTree(store,prefix,target,key);
  const restored=new PGlite(path.join(target,'local','postgres'));
  try{assert.deepEqual((await restored.query<{id:number;nome:string}>('select id,nome from pessoas order by id')).rows,[{id:1,nome:'Ana'},{id:2,nome:'Bruno'},{id:3,nome:'Cecília'}]);}
  finally{await restored.close();}
});

test('backup refuses while a database or task is running',async()=>{
  for(const file of ['local/postgres/postmaster.pid','pilot.lock','runs/x/running.lock']){
    const store=memoryStore(),root=await sample();
    await write(root,file,'1');
    await assert.rejects(backupTree(store,root,prefix,key),/em uso/);
    assert.deepEqual(await store.list(''),[]);
  }
});

test('restore rejects manifests with unsafe paths before writing anything',async()=>{
  const entry={sha256:'0'.repeat(64),size:0,object:'0'.repeat(64)};
  const bad=['../x','a/../../x','a/..','/abs','a//b','./a','a/./b','a\\b','C:x','a/b:c',''];
  for(const file of bad){
    const store=memoryStore(),target=await out();
    await handSealed(store,{version:1,files:[{path:file,...entry}],emptyDirs:[]});
    await assert.rejects(restoreTree(store,prefix,target,key),/inseguro/,file);
    await assert.rejects(fs.stat(target));
  }
  const store=memoryStore();
  await handSealed(store,{version:1,files:[],emptyDirs:['ok','../fora']});
  await assert.rejects(restoreTree(store,prefix,await out(),key),/inseguro/);
});

test('a wrong key or a corrupted manifest gives a clear message',async()=>{
  const store=memoryStore(),root=await sample();
  await backupTree(store,root,prefix,key);
  const message=/Chave do cofre errada ou manifesto corrompido/;
  await assert.rejects(restoreTree(store,prefix,await out(),randomBytes(32)),message);
  await assert.rejects(verifyBackup(store,prefix,randomBytes(32)),message);
  const broken=memoryStore();
  await handSealed(broken,{nada:true});
  await assert.rejects(restoreTree(broken,prefix,await out(),key),message);
});

test('a file named __proto__ round trips',async()=>{
  const store=memoryStore(),root=await temp(),target=await out();
  await write(root,'__proto__','perigo');await write(root,'sub/__proto__','outro');
  assert.equal((await backupTree(store,root,prefix,key)).files,2);
  assert.equal(await restoreTree(store,prefix,target,key),2);
  assert.equal(await fs.readFile(path.join(target,'__proto__'),'utf8'),'perigo');
  assert.equal(await fs.readFile(path.join(target,'sub/__proto__'),'utf8'),'outro');
});

test('verify passes, then fails after an object is deleted from the store',async()=>{
  const store=memoryStore(),root=await sample();
  await backupTree(store,root,prefix,key);
  const ok=await verifyBackup(store,prefix,key);
  assert.deepEqual([ok.files,ok.objects,ok.missing],[3,3,[]]);
  await store.delete(objectKey(binary));
  assert.deepEqual((await verifyBackup(store,prefix,key)).missing,['lot/pass-1/original.bin']);
  await assert.rejects(verifyBackup(memoryStore(),prefix,key),/Nenhuma cópia/);
});

test('a single file over 4 GB is refused',async()=>{
  const root=await temp(),big=path.join(root,'grande.bin');
  await fs.writeFile(big,'');await fs.truncate(big,4*1024**3+1);
  await assert.rejects(backupTree(memoryStore(),root,prefix,key),/maior que 4 GB.*grande\.bin/);
});
