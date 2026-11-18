import test from 'node:test';
import assert from 'node:assert/strict';
import {validCpf} from '../src/cpf-scan.ts';
import {BASE,hash,normalize,stableDigest,oddId,COMPANY_NAME,validCnpj} from '../src/model.ts';
import {normalizeAnnual} from '../src/annual.ts';
import {project} from '../src/expense-intermediate-audit.ts';
import type {Scope} from '../src/model.ts';

const scope:Scope={year:2025,months:[1],ids:[1],legislature:57};
const source={url:BASE+'/deputados/1/despesas',sha256:'test',row:0,fetchedAt:'2025-03-01T00:00:00Z'};
// Synthetic CPFs with valid check digits, built here so no real number is ever written down.
function syntheticCpf(seed:number):string{
  const base=String(100000000+seed*7919).slice(0,9),digit=(size:number,d:string)=>{const rest=[...d].reduce((n,c,i)=>n+Number(c)*(size+1-i),0)*10%11;return rest===10?0:rest;};
  const first=digit(9,base);return base+first+digit(10,base+first);
}
const CNPJ='11222333000181',CPF=syntheticCpf(3),OTHER_CPF=syntheticCpf(11);
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
test('11 digits is a person; a valid CNPJ is a company even with a leading 000; anything else is flagged',()=>{
  const company=normalize(row('00012345000165','BANCO TESTE'),1,scope,source);
  assert.equal(company.supplier,'BANCO TESTE');assert.equal(company.supplierVerified,true);assert.equal(company.supplierIdOdd,undefined);
  for(const id of ['1114447773','1112345678901','11111111111111','000'+CPF]){
    const r=normalize(row(id,'MARIA TESTE'),1,scope,source);
    assert.equal(r.supplier,'MARIA TESTE');assert.equal(r.supplierVerified,false);assert.equal(r.supplierIdOdd,true);
  }
  const person=normalize(row(CPF,'MARIA TESTE'),1,scope,source);assert.equal(person.supplier,'Fornecedor pessoa física');assert.equal(person.supplierIdOdd,undefined);
  assert.equal(oddId(''),false);assert.equal(oddId(CNPJ),false);assert.equal(oddId('11111111111111'),true);
  assert.equal(normalizeAnnual(annualRow('1112345678901','MARIA'),scope,source).supplierIdOdd,true);
});
test('rows that differ only in the supplier are refused instead of sharing an id',()=>{
  assert.throws(()=>stableDigest([{personId:1,raw:row(CPF,'A')},{personId:1,raw:row(OTHER_CPF,'B')}]),/só diferem no fornecedor/);
  assert.doesNotThrow(()=>stableDigest([{personId:1,raw:row(CNPJ,'A')},{personId:1,raw:row('11444777000161','B')}]));
});
const ODD='1112345678901';
test('COMPANY_NAME matches companies, not accented person names or bare SA, ME, CIA or TELEF',()=>{
  for(const name of ['MARIA LÚCIA DA SILVA','PATRÍCIA SOUZA','MARIA DE SA','JOAO DA SILVA ME','ANTONIO TELEFONE','JOSE CIA'])assert.equal(COMPANY_NAME.test(name.toUpperCase()),false,name);
  for(const name of ['CELULAR FUNCIONAL','EMPRESA TESTE LTDA','Tam Linhas Aéreas S.A','Gol Linhas Aereas S/A','Hotel Aloft','TELEFÔNICA BRASIL','Tonosol S.A. Aloft','LEMON APARTMENTS SA'])assert.equal(COMPANY_NAME.test(name.toUpperCase()),true,name);
});
test('the audit flags an odd id, keeps the typed name and hides only the receipt of a CPF',async()=>{
  const {project}=await import('../src/expense-intermediate-audit.ts');
  const at=(id:string,name:string)=>project({raw:{...row(id,name),urlDocumento:'https://www.camara.leg.br/x.pdf'},row:0,source:{url:source.url,sha256:'t',fetchedAt:source.fetchedAt}} as never,1,scope,'api');
  const odd=at(ODD,'MARIA TESTE'),cpf=at(CPF,'MARIA'),verified=at(CNPJ,'EMPRESA');
  assert.deepEqual([odd.supplier,odd.supplierIdOdd,odd.supplierVerified],['MARIA TESTE',true,false]);assert.ok(odd.receipt);
  assert.deepEqual([cpf.supplier,cpf.supplierIdOdd,cpf.receipt],['Fornecedor pessoa física',undefined,null]);assert.equal(verified.supplierIdOdd,undefined);
  const real=normalize({...row(ODD,'MARIA TESTE'),urlDocumento:'https://www.camara.leg.br/x.pdf'},1,scope,source);
  assert.deepEqual([odd.id,odd.supplier,odd.supplierIdOdd,odd.receipt],[real.id,real.supplier,real.supplierIdOdd,real.receipt]);
});

const cnpjDigits=(base:string)=>{const d=(s:string)=>{let w=s.length-7;const sum=[...s].reduce((n,c)=>{n+=Number(c)*w;w=w===2?9:w-1;return n;},0),m=sum%11;return m<2?0:11-m;};const a=d(base);return base+a+d(base+a);};
// Fake ids built at runtime: a '000'+CPF that also passes the CNPJ check, with and without a real-looking branch.
function paddedCpfId(branchShaped:boolean):string{
  for(let n=0;n<2000000;n++){
    const nine=String(100000000+n*7919).slice(0,9);
    const body=branchShaped?'000'+String(n%100000).padStart(5,'0')+'0001':'000'+nine;
    const id=cnpjDigits(body.slice(0,12));
    if(id.length===14&&validCpf(id.slice(3))&&/^000\d{5}000[1-9]\d{2}$/.test(id)===branchShaped)return id;
  }
  throw new Error('no fake id found');
}
test('a zero-padded CPF that passes the CNPJ check is not verified, a real-looking branch still is',()=>{
  const padded=paddedCpfId(false),company=paddedCpfId(true);
  assert.equal(validCnpj(padded),false);assert.equal(validCnpj(company),true);
  assert.equal(validCnpj(CNPJ),true);
  assert.equal(oddId(padded),true);assert.equal(oddId(company),true);assert.equal(oddId(CNPJ),false);
  const a=normalize(row(padded,'MARIA TESTE'),1,scope,source),b=normalizeAnnual(annualRow(padded,'MARIA TESTE'),scope,source);
  for(const r of [a,b]){assert.equal(r.supplierVerified,false);assert.equal(r.supplierKey,r.id);assert.ok(!JSON.stringify(r).includes(padded));assert.equal(r.supplierIdOdd,true);}
  const c=normalize(row(company,'EMPRESA TESTE'),1,scope,source);
  assert.equal(c.supplierVerified,true);assert.equal(c.supplierKey,hash('cnpj:'+company));
});

test('the independent audit projection agrees with the pipeline on padded CPFs and separator forms',()=>{
  const padded=paddedCpfId(false),company=paddedCpfId(true),[a,b,c,d]=[CPF.slice(0,3),CPF.slice(3,6),CPF.slice(6,9),CPF.slice(9)];
  const names=['MARIA TESTE','MEI '+CPF,`MEI ${a} ${b} ${c} ${d}`,`MEI ${a}-${b}-${c}-${d}`,`MEI ${a}.${b}.${c}/${d}`,`MEI ${a}  ${b}  ${c} - ${d}`,`MEI ${a} ${b} ${c} ${d}`,`MEI ${a}.${b}.${c}–${d}`,`MEI ${a}.${b}.${c}. ${d}`,'LOJA 123 456 789 00'];
  const pick=(r:any)=>({id:r.id,supplier:r.supplier,supplierKey:r.supplierKey,supplierVerified:r.supplierVerified,supplierIdOdd:r.supplierIdOdd});
  const src={...source,pass:1 as const},auditSource={...source,pass:1 as const};
  for(const id of [padded,company,CNPJ,CPF,'']){
    for(const name of names){
      const api=row(id,name),annual=annualRow(id,name);
      assert.deepEqual(pick(project({raw:api,row:0,source:src as any},1,scope,'api')),pick(normalize(api,1,scope,source)),id.length+name);
      assert.deepEqual(pick(project({raw:annual,row:0,source:auditSource as any},1,scope,'annual','x')),pick(normalizeAnnual(annual,scope,source)),id.length+name);
    }
  }
  assert.equal(normalize(row(company,'EMPRESA TESTE'),1,scope,source).supplierIdOdd,true);
  assert.equal(normalize(row(company,'EMPRESA TESTE'),1,scope,source).supplierVerified,true);
});
