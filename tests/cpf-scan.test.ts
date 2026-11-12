import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {strToU8,zipSync} from 'fflate';
import {findCpfs,knownCpfs,loadAllowlist,redactCpf,redactExpense,scanCpfs,scanFiles,validCpf} from '../src/cpf-scan.ts';
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

// Synthetic CPF with valid check digits, built here so no real number is ever written down.
function syntheticCpf(seed:number):string{
  const base=String(100000000+seed*7919).slice(0,9),digit=(size:number,d:string)=>{const rest=[...d].reduce((n,c,i)=>n+Number(c)*(size+1-i),0)*10%11;return rest===10?0:rest;};
  const first=digit(9,base);return base+first+digit(10,base+first);
}
const CPF=syntheticCpf(3),OTHER=syntheticCpf(11),CNPJ='11222333000181';
test('the synthetic CPFs are valid',()=>{assert.equal(validCpf(CPF),true);assert.equal(validCpf(OTHER),true);assert.notEqual(CPF,OTHER);});
test('a name ending in MEI-<cpf> is redacted',()=>{
  assert.equal(redactCpf('FULANO DE TAL - MEI-'+CPF),'FULANO DE TAL - MEI-[CPF omitido]');
  assert.equal(redactCpf('MEI '+CPF.slice(0,3)+'.'+CPF.slice(3,6)+'.'+CPF.slice(6,9)+'-'+CPF.slice(9)),'MEI [CPF omitido]');
  assert.equal(publicSupplier('FULANO - MEI-'+CPF,CNPJ).name,'FULANO - MEI-[CPF oculto]');
});
test('a CNPJ stays untouched, plain or punctuated',()=>{
  assert.equal(redactCpf('EMPRESA '+CNPJ),'EMPRESA '+CNPJ);
  assert.equal(redactCpf('EMPRESA 11.222.333/0001-81'),'EMPRESA 11.222.333/0001-81');
  assert.equal(scanCpfs('EMPRESA '+CNPJ,new Set()),0);
});
test('a 12-digit run is not a CPF, but an 11-digit run delimited by non-digits inside a name is',()=>{
  assert.equal(redactCpf('NOME '+CPF+'7'),'NOME '+CPF+'7');
  assert.equal(redactCpf('NOME 7'+CPF),'NOME 7'+CPF);
  assert.equal(redactCpf('NOME/'+CPF+'/X'),'NOME/[CPF omitido]/X');
});
test('eleven digits with wrong check digits are not redacted',()=>{
  const bad=CPF.slice(0,10)+(Number(CPF[10])+1)%10;
  assert.equal(redactCpf('DOC '+bad),'DOC '+bad);
});
test('redactExpense cleans the free-text fields and leaves ids alone, so names differing only by the CPF merge',()=>{
  const base={id:'a'.repeat(12)+'1',supplier:'',documentId:'x',documentNumber:'y',category:'c',receipt:null as string|null},counter={n:0};
  const one=redactExpense({...base,supplier:'ANA MEI-'+CPF},counter),two=redactExpense({...base,supplier:'ANA MEI-'+OTHER},counter);
  assert.equal(one.supplier,two.supplier);assert.equal(one.id,base.id);assert.equal(counter.n,2);
});
test('the scanner fails on an unpunctuated valid CPF without --known and passes once allowlisted',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-cpf-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.writeFile(path.join(directory,'f.json'),JSON.stringify({suppliers:['ANA MEI-'+CPF,'EMPRESA '+CNPJ]}));
  assert.deepEqual(await scanFiles([directory],new Set()),[{file:path.join(directory,'f.json'),count:1}]);
  const allow=path.join(directory,'allow.json');
  await fs.writeFile(allow,JSON.stringify({entries:[{sha256:sha256(CPF),reason:'synthetic number used by the test, not a person'}]}));
  assert.deepEqual(await scanFiles([directory],new Set(),await loadAllowlist(allow)),[]);
});
test('an allowlist entry without a reason is refused',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-cpf-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const allow=path.join(directory,'allow.json');
  await fs.writeFile(allow,JSON.stringify({entries:[{sha256:sha256(CPF),reason:''}]}));
  await assert.rejects(loadAllowlist(allow));
});
test('hex hashes are not read as digit runs',()=>{
  assert.equal(scanCpfs(JSON.stringify({id:'ab'+CPF+'cd'+'0'.repeat(10)}),new Set()),0);
});
test('the shipped allowlist is valid and empty',async()=>{assert.equal((await loadAllowlist(path.join(import.meta.dirname,'..','config','cpf-allowlist.json'))).size,0);});
