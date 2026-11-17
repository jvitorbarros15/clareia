import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE,hash,normalize,stableDigest,isPersonId,oddId} from '../src/model.ts';
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
test('11 digits is a person; a valid CNPJ is a company even with a leading 000; anything else is withheld and flagged',()=>{
  const company=normalize(row('00012345000165','BANCO TESTE'),1,scope,source);
  assert.equal(company.supplier,'BANCO TESTE');assert.equal(company.supplierVerified,true);assert.equal(company.supplierIdOdd,undefined);
  for(const id of ['1114447773','1112345678901','11111111111111','000'+CPF]){
    const r=normalize(row(id,'MARIA TESTE'),1,scope,source);
    assert.equal(r.supplier,'Fornecedor não identificado na fonte');assert.equal(r.supplierVerified,false);assert.equal(r.supplierIdOdd,true);assert.equal(r.receipt,null);
  }
  for(const name of ['CELULAR FUNCIONAL','EMPRESA TESTE LTDA','Tam Linhas Aéreas S.A']){
    const r=normalize({...row('1112345678901',name),urlDocumento:'https://www.camara.leg.br/x.pdf'},1,scope,source);
    assert.equal(r.supplier,name);assert.equal(r.supplierVerified,false);assert.equal(r.supplierIdOdd,true);assert.ok(r.receipt);
  }
  const person=normalize(row(CPF,'MARIA TESTE'),1,scope,source);assert.equal(person.supplier,'Fornecedor pessoa física');assert.equal(person.supplierIdOdd,undefined);
  assert.equal(isPersonId(CPF),true);assert.equal(isPersonId(CNPJ),false);assert.equal(oddId(''),false);assert.equal(oddId(CNPJ),false);assert.equal(oddId('11111111111111'),true);
  assert.equal(normalizeAnnual(annualRow('1112345678901','MARIA'),scope,source).supplierIdOdd,true);
});
test('rows that differ only in the supplier are refused instead of sharing an id',()=>{
  assert.throws(()=>stableDigest([{personId:1,raw:row(CPF,'A')},{personId:1,raw:row(OTHER_CPF,'B')}]),/só diferem no fornecedor/);
  assert.doesNotThrow(()=>stableDigest([{personId:1,raw:row(CNPJ,'A')},{personId:1,raw:row('11444777000161','B')}]));
});
const ODD='1112345678901';
test('a person-like name is withheld even with accents, and bare SA, ME, CIA or TELEF do not make a company',()=>{
  for(const name of ['MARIA LÚCIA DA SILVA','PATRÍCIA SOUZA','MARIA DE SA','JOAO DA SILVA ME','ANTONIO TELEFONE','JOSE CIA'])
    assert.equal(normalize(row(ODD,name),1,scope,source).supplier,'Fornecedor não identificado na fonte',name);
  for(const name of ['CELULAR FUNCIONAL','EMPRESA TESTE LTDA','Tam Linhas Aéreas S.A','Gol Linhas Aereas S/A','Hotel Aloft','TELEFÔNICA BRASIL','Tonosol S.A. Aloft'])
    assert.equal(normalize(row(ODD,name),1,scope,source).supplier,name,name);
});
test('the audit applies the same placeholder rule and sets the review flag',async()=>{
  const {project}=await import('../src/expense-intermediate-audit.ts');
  const at=(id:string,name:string)=>project({raw:{...row(id,name),urlDocumento:'https://www.camara.leg.br/x.pdf'},row:0,source:{url:source.url,sha256:'t',fetchedAt:source.fetchedAt}} as never,1,scope,'api');
  const person=at(ODD,'MARIA LÚCIA DA SILVA'),company=at(ODD,'EMPRESA TESTE LTDA'),cpf=at(CPF,'MARIA'),verified=at(CNPJ,'EMPRESA');
  assert.deepEqual([person.supplier,person.receipt,person.supplierIdOdd],['Fornecedor não identificado na fonte',null,true]);
  assert.deepEqual([company.supplier,company.supplierIdOdd],['EMPRESA TESTE LTDA',true]);assert.ok(company.receipt);
  assert.deepEqual([cpf.supplier,cpf.supplierIdOdd],['Fornecedor pessoa física',undefined]);assert.equal(verified.supplierIdOdd,undefined);
  const real=normalize({...row(ODD,'MARIA LÚCIA DA SILVA'),urlDocumento:'https://www.camara.leg.br/x.pdf'},1,scope,source);
  assert.deepEqual([person.id,person.supplier,person.supplierIdOdd],[real.id,real.supplier,real.supplierIdOdd]);
});
