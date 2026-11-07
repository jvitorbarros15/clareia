import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {strToU8,zipSync} from 'fflate';
import {findCpfs,knownCpfs,scanFiles,validCpf} from '../src/cpf-scan.ts';
import {publicSupplier} from '../src/model.ts';

const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');

test('an individual supplier loses its name',()=>{
  assert.deepEqual(publicSupplier('Maria da Silva','11144477735'),{name:'Fornecedor pessoa física',key:'person'});
});
test('a company keeps its name',()=>{
  assert.deepEqual(publicSupplier('EMPRESA LTDA','11222333000181'),{name:'EMPRESA LTDA',key:'cnpj'});
});
test('a company name carrying a CPF is still masked',()=>{
  assert.equal(publicSupplier('MEI 111.444.777-35','11222333000181').name,'MEI [CPF oculto]');
});
test('a record without an identifier keeps its label',()=>{
  assert.deepEqual(publicSupplier('CELULAR FUNCIONAL',''),{name:'CELULAR FUNCIONAL',key:'unknown'});
});
test('an empty name gets the placeholder',()=>{
  assert.equal(publicSupplier('','').name,'Fornecedor não informado');
});
test('validCpf checks the verification digits',()=>{
  assert.equal(validCpf('11144477735'),true);
  assert.equal(validCpf('11144477736'),false);
  assert.equal(validCpf('11111111111'),false);
});
test('a formatted valid CPF is always found',()=>{
  assert.equal(findCpfs('doc 111.444.777-35',new Set()),1);
});
test('a formatted number with wrong digits is not a CPF',()=>{
  assert.equal(findCpfs('doc 111.444.777-36',new Set()),0);
});
test('eleven plain digits only count when seen as a CPF in this run',()=>{
  assert.equal(findCpfs('doc 11144477735',new Set()),0);
  assert.equal(findCpfs('doc 11144477735',new Set([sha256('11144477735')])),1);
});
test('a longer number is not read as a CPF',()=>{
  assert.equal(findCpfs('doc 911144477735',new Set([sha256('11144477735')])),0);
});
test('knownCpfs reads API pages and the annual file column',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-cpf-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.writeFile(path.join(directory,'a.json'),JSON.stringify({dados:{cpf:'52998224725'}}));
  await fs.writeFile(path.join(directory,'b.json'),JSON.stringify({dados:[{cnpjCpfFornecedor:'11144477735'},{cnpjCpfFornecedor:'11222333000181'}]}));
  const csv='txtNumero;txtCNPJCPF\n12345678901;39053344705\n1;11222333000181\n';
  await fs.writeFile(path.join(directory,'annual-2.csv.zip'),zipSync({'Ano-2025.csv':strToU8(csv)}));
  const known=await knownCpfs(directory);
  assert.deepEqual([...known].sort(),['52998224725','11144477735','39053344705'].map(sha256).sort());
});
test('scanFiles reports the file and count, walks folders and skips images',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-cpf-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.mkdir(path.join(directory,'data'));
  await fs.writeFile(path.join(directory,'data','clean.json'),'{}');
  await fs.writeFile(path.join(directory,'data','leak.json'),'111.444.777-35 e 529.982.247-25');
  await fs.writeFile(path.join(directory,'photo.jpg'),'111.444.777-35');
  assert.deepEqual(await scanFiles([directory],new Set()),[{file:path.join(directory,'data','leak.json'),count:2}]);
});
