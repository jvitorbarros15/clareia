import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {open,seal,vaultKey} from '../src/vault.ts';

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
