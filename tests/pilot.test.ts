import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cents,normalize,stableDigest,BASE,officialUrl} from '../src/model.ts';
import {lock,withLock,LOCK_FILE} from '../src/lock.ts';
import type {Scope} from '../src/model.ts';
import {normalizeAnnual,parseAnnual} from '../src/annual.ts';

const scope:Scope={year:2025,months:[1,2],ids:[1,2,3],legislature:57};
function expense(month=1,amount=100.21){return {ano:2025,mes:month,codDocumento:'TEST-DOC',codLote:1,codTipoDocumento:1,parcela:0,numDocumento:'TEST',numRessarcimento:'',tipoDespesa:'TEST CATEGORY',tipoDocumento:'Recibos/Outros',nomeFornecedor:'TEST SUPPLIER',cnpjCpfFornecedor:'11222333000181',dataDocumento:'2025-01-01T00:00:00',urlDocumento:'https://www.camara.leg.br/test.pdf',valorDocumento:amount,valorGlosa:0,valorLiquido:amount};}
const source={url:BASE+'/deputados/1/despesas',sha256:'test',row:0,fetchedAt:'2025-03-01T00:00:00Z'};
async function temp<T>(fn:(dir:string)=>Promise<T>){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-test-'));try{return await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}

test('money preserves cents and negatives; refuses fractional cents and unsafe magnitudes',()=>{
  assert.equal(cents(0.29),29);assert.equal(cents(-20.05),-2005);assert.equal(cents('0.00'),0);
  assert.throws(()=>cents(0.001));assert.throws(()=>cents('9007199254740992'));assert.throws(()=>cents(NaN));
});
test('annual CSV preserves negative adjustments and missing fields without inventing zero',()=>{
  const r={ideCadastro:'1',numAno:'2025',numMes:'1',codLegislatura:'57',txtDescricao:'TEST ADJUSTMENT',vlrLiquido:'-1747.00',vlrDocumento:'',vlrGlosa:'',txtCNPJCPF:'',ideDocumento:'',txtNumero:'',txtFornecedor:'TEST'};
  const normalized=normalizeAnnual(r,scope,source);assert.equal(normalized.cents,-174700);assert.equal(normalized.documentCents,null);assert.equal(normalized.disallowedCents,null);
  assert.throws(()=>normalizeAnnual({...r,vlrLiquido:''},scope,source));assert.throws(()=>normalizeAnnual({...r,codLegislatura:'56'},scope,source));
  // Real shape of the housing-complement adjustment: positive document, blank glosa, negative net.
  const housing=normalizeAnnual({...r,vlrDocumento:'1747',vlrGlosa:'',vlrLiquido:'-1747'},scope,source);
  assert.equal(housing.documentCents,174700);assert.equal(housing.disallowedCents,null);assert.equal(housing.cents,-174700);
});
test('annual parser filters by official ID and competence rather than display name',async()=>{
  const header='ideCadastro;numAno;numMes;txNomeParlamentar;codLegislatura;txtDescricao;vlrLiquido;vlrDocumento;vlrGlosa;ideDocumento;txtFornecedor;txtCNPJCPF;urlDocumento;txtNumero;datEmissao;numLote',tail=';57;TEST;1;1;0;1;F;;;N;2025-01-02;1\n';
  const data=header+'\n1;2025;1;Same name'+tail+'999;2025;1;Same name'+tail+'1;2024;1;Same name'+tail;
  const parsed=await parseAnnual(new TextEncoder().encode(data),scope);assert.equal(parsed.rows.length,1);assert.equal(parsed.scanned,3);
  await assert.rejects(parseAnnual(new TextEncoder().encode('ideCadastro;numAno\n1;2025\n'),scope),/coluna ausente/);
  await assert.rejects(parseAnnual(new TextEncoder().encode(header.replace('txtFornecedor','txtNomeFornecedor')+'\n'),scope),/coluna ausente txtFornecedor/);
  await assert.rejects(parseAnnual(new TextEncoder().encode(header+';numMes\n'),scope),/coluna duplicada/);
});
test('an individual supplier reaches a record without name, CPF or receipt link',()=>{
  const fromApi=normalize({...expense(),cnpjCpfFornecedor:'11144477735',nomeFornecedor:'Maria da Silva',urlDocumento:'https://www.camara.leg.br/cota-parlamentar/nota-fiscal-eletronica?ideDocumentoFiscal=1'},1,scope,source);
  const annualRow={ideCadastro:'1',numAno:'2025',numMes:'1',codLegislatura:'57',txtDescricao:'ALUGUEL',vlrLiquido:'10.00',vlrDocumento:'10.00',vlrGlosa:'0',txtCNPJCPF:'111.444.777-35',ideDocumento:'1',txtFornecedor:'Maria da Silva',urlDocumento:'https://www.camara.leg.br/nota',txtNumero:'1',datEmissao:'2025-01-01',numLote:'1'};
  const fromAnnual=normalizeAnnual(annualRow,scope,source);
  for(const record of [fromApi,fromAnnual]){
    assert.equal(record.supplier,'Fornecedor pessoa física');assert.equal(record.receipt,null);assert.equal(record.supplierVerified,false);
    assert.equal(/Maria|11144477735|111\.444/.test(JSON.stringify(record)),false);
  }
});
test('schema, financial equation and scope failures block records',()=>{
  assert.equal(normalize(expense(),1,scope,source).cents,10021);
  assert.throws(()=>normalize({...expense(),valorGlosa:1},1,scope,source));
  assert.throws(()=>normalize({...expense(),mes:8},1,scope,source));
  assert.throws(()=>normalize({...expense(),valorLiquido:undefined},1,scope,source));
  assert.throws(()=>normalize(expense(),999,scope,source));
});
test('API nulls for document id, lot, installment and glosa read as absent values, never as zero',()=>{
  const row=normalize({...expense(),codDocumento:null,codLote:null,parcela:null,valorGlosa:null,valorDocumento:61.9,valorLiquido:-61.9},1,scope,source);
  assert.equal(row.documentId,'');assert.equal(row.lot,'');assert.equal(row.disallowedCents,null);assert.equal(row.documentCents,6190);assert.equal(row.cents,-6190);
  assert.throws(()=>normalize({...expense(),valorLiquido:null},1,scope,source));
  assert.throws(()=>normalize({...expense(),valorDocumento:null},1,scope,source));
  assert.throws(()=>normalize({...expense(),valorGlosa:1.5},1,scope,source));
  assert.throws(()=>normalize({...expense(),codTipoDocumento:null},1,scope,source));
});
test('same document with distinct events is preserved; ambiguous identical rows are rejected',()=>{
  const a={personId:1,raw:expense()},b={personId:1,raw:{...expense(),codLote:2}};
  assert.doesNotThrow(()=>stableDigest([a,b]));assert.throws(()=>stableDigest([a,a]),/idênticas/);
  assert.equal(stableDigest([a,b]),stableDigest([b,a]));
  assert.equal(normalize(a.raw,1,scope,source).id,normalize(a.raw,1,scope,{...source,sha256:'different-page-format',row:9}).id);
});
test('missing IDs and CPF do not merge suppliers by name; source URLs stay official',()=>{
  const a=normalize({...expense(),cnpjCpfFornecedor:''},1,scope,source);
  const b=normalize({...expense(),cnpjCpfFornecedor:'12345678900'},1,scope,source);
  assert.equal(a.supplierVerified,false);assert.equal(b.supplierVerified,false);assert.notEqual(a.supplierKey,b.supplierKey);
  assert.equal(normalize(expense(),1,scope,source).supplierVerified,true);
  assert.equal(officialUrl('https://camara.leg.br.evil.test/file','receipt'),null);
  assert.equal(officialUrl('javascript:alert(1)','receipt'),null);
});
test('lock path is absolute under the project root and is released even when the task or close fails',async()=>temp(async dir=>{
  assert.ok(path.isAbsolute(LOCK_FILE));assert.equal(LOCK_FILE,path.resolve(import.meta.dirname,'..','data','pilot.lock'));
  const file=path.join(dir,'nested','pilot.lock');
  await assert.rejects(withLock(async()=>{throw new Error('db.close falhou');},file),/db.close falhou/);
  await assert.rejects(fs.access(file));
  const release=await lock(file);await assert.rejects(lock(file),/Outra tarefa/);await release();await assert.rejects(fs.access(file));
}));
