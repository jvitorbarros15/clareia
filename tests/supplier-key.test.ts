import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE,hash,normalize,stableDigest,isPersonId} from '../src/model.ts';
import {normalizeAnnual} from '../src/annual.ts';
import type {Scope} from '../src/model.ts';

const scope:Scope={year:2025,months:[1],ids:[1],legislature:57};
const source={url:BASE+'/deputados/1/despesas',sha256:'test',row:0,fetchedAt:'2025-03-01T00:00:00Z'};
const CNPJ='11222333000181',CPF='11144477735',OTHER_CPF='52998224725';
const row=(id:string|null,name:string)=>({ano:2025,mes:1,codDocumento:'D1',codLote:1,codTipoDocumento:1,parcela:0,numDocumento:'N1',numRessarcimento:'',tipoDespesa:'TEST',tipoDocumento:'Recibos',nomeFornecedor:name,cnpjCpfFornecedor:id,dataDocumento:'2025-01-05T00:00:00',urlDocumento:null,valorDocumento:10,valorGlosa:0,valorLiquido:10});
const annualRow=(id:string,name:string)=>({ideCadastro:'1',numAno:'2025',numMes:'1',codLegislatura:'57',txtDescricao:'TEST',vlrLiquido:'10',vlrDocumento:'10',vlrGlosa:'0',txtCNPJCPF:id,ideDocumento:'D1',txtNumero:'N1',txtFornecedor:name,datEmissao:'2025-01-05',numLote:'1'});

test('an unverified record id does not depend on, or contain, the CPF or the name',()=>{
  const a=normalize(row(CPF,'MARIA TESTE'),1,scope,source),b=normalize(row(OTHER_CPF,'JOSE TESTE'),1,scope,source);
  assert.equal(a.id,b.id);assert.equal(a.supplierKey,a.id);
  const text=JSON.stringify(a);assert.ok(!text.includes(CPF)&&!text.includes('MARIA'));
  assert.notEqual(a.id,normalize({...row(CPF,'MARIA TESTE'),valorLiquido:11,valorDocumento:11},1,scope,source).id);
  assert.equal(normalizeAnnual(annualRow(CPF,'MARIA'),scope,source).id,normalizeAnnual(annualRow(OTHER_CPF,'JOSE'),scope,source).id);
});
test('a verified CNPJ record keeps the id and supplier key it always had',()=>{
  const r=normalize(row(CNPJ,'EMPRESA TESTE'),1,scope,source);
  assert.equal(r.id,'5a33611cdfd08b7aa3950b42d37c013c7a19b1bcb72fb1415bbc62294fd4192a');
  assert.equal(r.supplierKey,hash('cnpj:'+CNPJ));assert.equal(r.supplierVerified,true);
  assert.notEqual(r.id,normalize(row(CNPJ,'OUTRO NOME'),1,scope,source).id);
});
test('an id that is not a clean CNPJ-sized number is a person',()=>{
  for(const id of ['1114447773','111444777350','000'+CPF]){
    const r=normalize(row(id,'MARIA TESTE'),1,scope,source);
    assert.equal(r.supplier,'Fornecedor pessoa física');assert.equal(r.supplierVerified,false);
  }
  assert.equal(isPersonId(CNPJ),false);assert.equal(isPersonId(''),false);assert.equal(isPersonId('00011222333000'),false);
});
test('rows that differ only in the supplier are refused instead of sharing an id',()=>{
  assert.throws(()=>stableDigest([{personId:1,raw:row(CPF,'A')},{personId:1,raw:row(OTHER_CPF,'B')}]),/só diferem no fornecedor/);
  assert.doesNotThrow(()=>stableDigest([{personId:1,raw:row(CNPJ,'A')},{personId:1,raw:row('11444777000161','B')}]));
});
