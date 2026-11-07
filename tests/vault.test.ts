import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {archiveRun,open,seal,vaultKey} from '../src/vault.ts';
import {memoryStore} from '../src/object-store.ts';

const key=randomBytes(32);
const text=(value:string)=>new TextEncoder().encode(value);

test('seal and open round trip',()=>{
  const plain=text('cpf 111.444.777-35');
  assert.deepEqual(Buffer.from(open(seal(plain,key),key)),Buffer.from(plain));
});
test('sealed bytes do not contain the original',()=>{
  assert.equal(Buffer.from(seal(text('111.444.777-35'),key)).includes('111.444.777-35'),false);
});
test('two seals of the same content differ',()=>{
  assert.notDeepEqual(seal(text('a'),key),seal(text('a'),key));
});
test('open rejects tampered bytes',()=>{
  const sealed=seal(text('dados'),key);sealed[sealed.length-1]^=1;
  assert.throws(()=>open(sealed,key));
});
test('open rejects a wrong key',()=>{
  assert.throws(()=>open(seal(text('dados'),key),randomBytes(32)));
});
test('vaultKey needs exactly 32 bytes in base64',()=>{
  assert.equal(vaultKey({CLAREIA_VAULT_KEY:key.toString('base64')}).length,32);
  assert.throws(()=>vaultKey({CLAREIA_VAULT_KEY:'curta'}),/CLAREIA_VAULT_KEY/);
  assert.throws(()=>vaultKey({}),/CLAREIA_VAULT_KEY/);
});
test('archiveRun stores every run file sealed, except the first annual pass',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-run-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.writeFile(path.join(directory,'page.json'),'{"cpf":"11144477735"}');
  await fs.writeFile(path.join(directory,'annual-1.csv.zip'),'a');
  await fs.writeFile(path.join(directory,'annual-2.csv.zip'),'b');
  const store=memoryStore();
  assert.equal(await archiveRun(store,directory,'run1',key),2);
  assert.deepEqual((await store.list('originals/')).sort(),['originals/runs/run1/annual-2.csv.zip','originals/runs/run1/page.json']);
  const sealed=await store.get('originals/runs/run1/page.json');
  assert.equal(Buffer.from(sealed as Uint8Array).includes('11144477735'),false);
  assert.equal(Buffer.from(open(sealed as Uint8Array,key)).toString(),'{"cpf":"11144477735"}');
});
