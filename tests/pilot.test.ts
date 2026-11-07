import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cents,normalize,stableDigest,BASE,officialUrl,snapshotId} from '../src/model.ts';
import {lock,withLock,LOCK_FILE} from '../src/lock.ts';
import {collect,RunCache,paginate,request} from '../src/collector.ts';
import {openDB} from '../src/store.ts';
import {latestPublication,publishDomain,readPublication} from '../src/publications.ts';
import {results,parseFilters,csv} from '../src/queries.ts';
import type {Scope} from '../src/model.ts';
import {normalizeAnnual,parseAnnual} from '../src/annual.ts';

const scope:Scope={year:2025,months:[1,2],ids:[1,2,3],legislature:57};
function expense(month=1,amount=100.21){return {ano:2025,mes:month,codDocumento:'TEST-DOC',codLote:1,codTipoDocumento:1,parcela:0,numDocumento:'TEST',numRessarcimento:'',tipoDespesa:'TEST CATEGORY',tipoDocumento:'Recibos/Outros',nomeFornecedor:'TEST SUPPLIER',cnpjCpfFornecedor:'11222333000181',dataDocumento:'2025-01-01T00:00:00',urlDocumento:'https://www.camara.leg.br/test.pdf',valorDocumento:amount,valorGlosa:0,valorLiquido:amount};}
const source={url:BASE+'/deputados/1/despesas',sha256:'test',row:0,fetchedAt:'2025-03-01T00:00:00Z'};
function fakeFetch(url:string){const u=new URL(url),id=Number(u.pathname.split('/')[4]);return Promise.resolve(new Response(JSON.stringify(u.pathname.endsWith('/despesas')?{dados:[expense(Number(u.searchParams.get('mes')))],links:[{rel:'self',href:url}]}:{dados:{id,ultimoStatus:{nome:'TEST PERSON '+id,urlFoto:null}}}),{status:200}));}
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
test('transient source error is retried; ordinary 404 stops immediately',async()=>{
  let calls=0;await request(BASE+'/deputados/1',async()=>++calls===1?new Response('',{status:503}):new Response('{}'),async()=>{});assert.equal(calls,2);
  calls=0;await assert.rejects(request(BASE+'/deputados/1',async()=>{calls++;return new Response('',{status:404});},async()=>{}));assert.equal(calls,1);
});
test('pagination follows every page and retains separate events',async()=>temp(async dir=>{
  const first=BASE+'/deputados/1/despesas?ano=2025&itens=1&pagina=1',second=first.replace('pagina=1','pagina=2');
  const cache=new RunCache(dir,async url=>new Response(JSON.stringify({dados:[expense(url===first?1:2)],links:[{rel:'last',href:second},...(url===first?[{rel:'next',href:second}]:[])]})));
  assert.equal((await paginate(first,1,cache)).length,2);
}));
test('missing next page, repeated pages, changed scope and unexpected empty page are rejected',async()=>{
  const first=BASE+'/deputados/1/despesas?ano=2025&itens=1&pagina=1',second=first.replace('pagina=1','pagina=2');
  for(const mode of ['missing','repeated','scope','empty'])await temp(async dir=>{
    const cache=new RunCache(dir,async url=>new Response(JSON.stringify({dados:mode==='empty'&&url!==first?[]:[expense()],links:[{rel:'last',href:second},...(url===first&&mode!=='missing'?[{rel:'next',href:mode==='scope'?second.replace('ano=2025','ano=2024'):second}]:[])]})));
    await assert.rejects(paginate(first,1,cache));
  });
});
test('checkpoint reuse avoids requests; tampering forces a verified refetch',async()=>temp(async dir=>{
  let count=0;const fetcher=async(url:string)=>{count++;return fakeFetch(url);};const url=BASE+'/deputados/1';
  const cache=new RunCache(dir,fetcher);const a=await cache.get(url,0);await new RunCache(dir,fetcher).get(url,0);assert.equal(count,1);
  await fs.writeFile(path.join(dir,a.page.file),'{}');await new RunCache(dir,fetcher).get(url,0);assert.equal(count,2);
}));
test('collector validates two captures; an unstable or empty source is withheld',async()=>{
  await temp(async dir=>{const s=await collect(scope,new RunCache(dir,fakeFetch));assert.equal(s.records.length,6);assert.equal(s.validation.totalCents,60126);assert.equal(s.validation.independentTotalCents,'60126');});
  await temp(async dir=>{const fetcher=async(url:string)=>{const r=await fakeFetch(url),j=await r.json();if(url.includes('itens=25'))j.dados[0].valorLiquido=1;return new Response(JSON.stringify(j));};await assert.rejects(collect(scope,new RunCache(dir,fetcher)),/mudou/);});
  await temp(async dir=>{const fetcher=async(url:string)=>url.includes('despesas')?new Response(JSON.stringify({dados:[],links:[]})):fakeFetch(url);await assert.rejects(collect(scope,new RunCache(dir,fetcher)),/vazio/);});
});
test('PostgreSQL publication is idempotent; bad update rolls back; revisions retain old version',async()=>temp(async dir=>{
  const db=await openDB(true);
  try{
    const a=await collect(scope,new RunCache(dir,fakeFetch));await publishDomain(db,'despesas',a);await publishDomain(db,'despesas',a);
    assert.equal((await db.query<{count:number}>('SELECT count(*)::integer AS count FROM expenses_v2')).rows[0].count,6);
    const bad=structuredClone(a);bad.records[0].cents++;bad.id=snapshotId(bad);
    await assert.rejects(publishDomain(db,'despesas',bad),/Reconciliação/);assert.equal((await latestPublication(db,'despesas'))?.id,a.id);assert.equal(await readPublication(db,bad.id),null);
    const revision=structuredClone(a);revision.records[0].cents+=100;revision.validation.totalCents+=100;revision.validation.independentTotalCents=String(BigInt(revision.validation.independentTotalCents)+100n);revision.id=snapshotId(revision);
    await publishDomain(db,'despesas',revision);assert.equal((await latestPublication(db,'despesas'))?.id,revision.id);assert.equal((await readPublication(db,a.id))?.records[0].cents,10021);
  }finally{await db.close();}
}));
test('re-import of the same content is a no-op; a changed body with the same total is never silently dropped',async()=>temp(async dir=>{
  const db=await openDB(true);
  try{
    const a=await collect(scope,new RunCache(dir,fakeFetch));await publishDomain(db,'despesas',a);
    const count=async()=>(await db.query<{count:number}>('SELECT count(*)::integer AS count FROM publications')).rows[0].count;
    const recaptured=structuredClone(a);recaptured.publishedAt=recaptured.collectedAt='2030-01-01T00:00:00Z';for(const p of recaptured.pages)p.fetchedAt='2030-01-01T00:00:00Z';for(const r of recaptured.records)r.source.fetchedAt='2030-01-01T00:00:00Z';
    assert.equal(snapshotId(recaptured),a.id);await publishDomain(db,'despesas',recaptured);assert.equal(await count(),1);
    assert.equal((await latestPublication(db,'despesas'))?.publishedAt,a.publishedAt);
    const reworded=structuredClone(a);reworded.validation.limitations=[...a.validation.limitations,'Nova ressalva.'];
    assert.equal(reworded.validation.totalCents,a.validation.totalCents);
    await assert.rejects(publishDomain(db,'despesas',reworded),/não corresponde ao conteúdo/);
    reworded.id=snapshotId(reworded);assert.notEqual(reworded.id,a.id);await publishDomain(db,'despesas',reworded);
    assert.equal(await count(),2);assert.deepEqual((await latestPublication(db,'despesas'))?.validation.limitations,reworded.validation.limitations);
    const {records:_records,...tampered}=structuredClone(a);tampered.validation.duplicatePolicy='Texto alterado no banco';
    await db.query('UPDATE publications SET body=$2::jsonb WHERE id=$1',[a.id,JSON.stringify(tampered)]);
    await assert.rejects(publishDomain(db,'despesas',a),/mesmo identificador e conteúdo diferente/);
  }finally{await db.close();}
}));
test('lock path is absolute under the project root and is released even when the task or close fails',async()=>temp(async dir=>{
  assert.ok(path.isAbsolute(LOCK_FILE));assert.equal(LOCK_FILE,path.resolve(import.meta.dirname,'..','data','pilot.lock'));
  const file=path.join(dir,'nested','pilot.lock');
  await assert.rejects(withLock(async()=>{throw new Error('db.close falhou');},file),/db.close falhou/);
  await assert.rejects(fs.access(file));
  const release=await lock(file);await assert.rejects(lock(file),/Outra tarefa/);await release();await assert.rejects(fs.access(file));
}));
test('filters, charts, records and CSV agree; out-of-coverage requests are rejected',async()=>temp(async dir=>{
  const snapshot=await collect(scope,new RunCache(dir,fakeFetch));const filters=parseFilters(new URLSearchParams('person=2&from=2&to=2'),snapshot),data=results(snapshot,filters);
  assert.equal(data.totalCents,10021);assert.equal(data.records.length,1);assert.equal(data.months[0].cents,10021);assert.equal(data.categories[0].cents,10021);
  assert.match(csv(data.records),/10021/);assert.throws(()=>parseFilters(new URLSearchParams('person=999'),snapshot));assert.throws(()=>parseFilters(new URLSearchParams('from=2&to=1'),snapshot));
  data.records[0].supplier='=HYPERLINK("malicious")';assert.match(csv(data.records),/'=HYPERLINK/);
}));
