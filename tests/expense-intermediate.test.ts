import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {zipSync,strToU8} from 'fflate';
import {BASE,hash,canonical} from '../src/model.ts';
import {PeopleCapture,sourceAllowed} from '../src/people-discovery.ts';
import {collectExpenseBatch,expenseUrl,validateExpenseScope,expensePages,expenseBatchContentId} from '../src/expense-intermediate.ts';
import {portalHtml} from './fixtures/cota-portal.ts';
import type {TemporalReport,MonthlyCoverage} from '../src/people-temporal.ts';
import {open} from '../src/vault.ts';
import {auditExpenseBatch} from '../src/expense-intermediate-audit.ts';

const scope={year:2025,months:[1,2],ids:[1,2],legislature:57};
const dimension={status:'single' as const,value:'SP',values:['SP'],rows:[0]};
const temporal={schema:'clareia.people-temporal.v1',ruleVersion:'camara.history-reported-change.v1',historySha256:hash('history'),scope:{legislature:57,start:'2025-01-01',end:'2025-12-31',sampleIds:[1]},createdAt:'2026-11-08T12:00:00Z',status:'review-required',publicAttributionEnabled:false,people:[1,2].map(id=>({id,collectionStatus:'stable',events:[],intervals:[],issues:[],months:[1,2].map<MonthlyCoverage>(month=>({year:2025,month,start:`2025-0${month}-01T00:00:00`,end:`2025-0${month+1}-01T00:00:00`,exercise:id===1?'full':'unknown',party:id===1?{...dimension,value:'A',values:['A']}:{status:'unknown',value:null,values:[],rows:[]},uf:dimension,partialScope:false,financialCollection:'not-collected'}))}))} as TemporalReport;
const contract={paths:{'/deputados/{id}/despesas':{get:{parameters:['ano','mes','idLegislatura','itens','pagina','ordem','ordenarPor'].map(name=>({name,in:'query'}))}}}};
const apiRow=(month=1,overrides:Record<string,unknown>={})=>({ano:2025,mes:month,codDocumento:'10',codLote:1,codTipoDocumento:1,parcela:0,numDocumento:'N1',numRessarcimento:'',tipoDespesa:'COMBUSTÍVEIS',tipoDocumento:'Recibos/Outros',nomeFornecedor:'Empresa',cnpjCpfFornecedor:'11222333000181',dataDocumento:'2025-01-02T00:00:00',urlDocumento:null,valorDocumento:10.21,valorGlosa:0,valorLiquido:10.21,...overrides});
const columns='ideCadastro;numAno;numMes;codLegislatura;txtDescricao;vlrLiquido;vlrDocumento;vlrGlosa;ideDocumento;txtFornecedor;txtCNPJCPF;urlDocumento;txtNumero;datEmissao;numLote;numParcela';
const annualLine=(id=1,month=1,category='COMBUSTÍVEIS',amount='10.21',doc='10')=>`${id};2025;${month};57;${category};${amount};${amount};0;${doc};Empresa;11222333000181;;N1;2025-01-02T00:00:00;1;0`;
const annual=(lines=[annualLine()])=>zipSync({'Ano-2025.csv':strToU8(columns+'\n'+lines.join('\n')+'\n')},{mtime:'2025-01-01'});
async function setup(t:test.TestContext,reply?:(url:string,pass:number)=>unknown,fullYear=false,portal=false,tune?:(t:TemporalReport)=>void){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-expense-batch-')),key=randomBytes(32);t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const capture=(pass:number)=>new PeopleCapture(path.join(dir,'pass-'+pass),key,async url=>{
    const u=new URL(url),override=reply?.(url,pass);
    const value=override===undefined?u.pathname.endsWith('api-docs')?contract:u.pathname.endsWith('.zip')?annual():{dados:u.pathname.includes('/1/')&&u.searchParams.get('mes')==='1'?[apiRow()]:[],links:[{rel:'self',href:url}]}:override;
    return value instanceof Response?value:new Response(value instanceof Uint8Array?Buffer.from(value):JSON.stringify(value));
  },async()=>{});
  const selectedScope=fullYear?{...scope,months:Array.from({length:12},(_,i)=>i+1)}:scope,selectedTemporal=structuredClone(temporal);tune?.(selectedTemporal as TemporalReport);
  if(fullYear)for(const p of selectedTemporal.people)p.months=selectedScope.months.map(month=>({...p.months[0],month,start:new Date(Date.UTC(2025,month-1,1)).toISOString().slice(0,19),end:new Date(Date.UTC(2025,month,1)).toISOString().slice(0,19)}));
  const one=capture(1),two=capture(2),report=await collectExpenseBatch(selectedScope,selectedTemporal,hash('proposal'),one,two,{wait:async()=>{},portal});
  const read=async(s:{pass:number;file:string})=>open(await fs.readFile(path.join(dir,'pass-'+s.pass,s.file)),key);
  assert.equal((await auditExpenseBatch(report,selectedTemporal,selectedScope,hash('proposal'),read)).status,'passed');
  return {dir,key,report,one,two,read,selectedScope,selectedTemporal};
}
test('expanded scope accepts arbitrary IDs/months and rejects duplicates, future months and query changes',()=>{
  validateExpenseScope(scope);validateExpenseScope({...scope,ids:Array.from({length:648},(_,i)=>i+1),months:Array.from({length:12},(_,i)=>i+1)});
  for(const s of [{...scope,ids:[1,1]},{...scope,months:[1,1]},{...scope,months:[13]},{...scope,year:2099},{...scope,year:999999999}])assert.throws(()=>validateExpenseScope(s));
  const url=expenseUrl(scope,1,1,1);assert.equal(sourceAllowed(url),true);for(const bad of [url+'&mes=2',url+'&extra=x',url.replace('mes=1','mes=13'),url.replace('itens=100','itens=999'),url.replace('ordem=ASC','ordem=DESC')])assert.equal(sourceAllowed(bad),false);
});
test('batch reconciles sources and classifies captured empty competences separately from unknown exercise',async t=>{
  const r=await setup(t);assert.equal(r.report.cells.length,4);assert.deepEqual(r.report.cells.map(c=>c.status),['complete','no-expenses-confirmed','no-expenses-confirmed','no-expenses-confirmed']);assert.equal(r.report.totalCents,1021);assert.equal(r.report.cells[2].exercise,'unknown');assert.equal(r.report.cells[2].party.status,'unknown');assert.equal(r.report.cells[0].records[0].origin,'both');assert.equal(r.report.publicationEligible,false);
  const plain=await r.read(r.report.sources[0]),sealed=await fs.readFile(path.join(r.dir,'pass-1',r.report.sources[0].file));assert.notDeepEqual(Buffer.from(plain),sealed);
});
test('a corroborated reported installment retains its net and evidence instead of requiring the full document face',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual([annualLine().replace(';10.21;10.21;0;',';4.00;10.21;0;').replace(/;0$/,';1')]):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{valorLiquido:4,parcela:1})],links:[]}:undefined);
  assert.equal(r.report.cells[0].status,'complete');assert.equal(r.report.totalCents,400);assert.equal(r.report.cells[0].records[0].documentCents,1021);assert.equal(r.report.cells[0].records[0].financialBasis,'reported-installment');
  r.report.cells[0].records[0].financialBasis='balanced-document-split';assert.ok((await auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read)).failures.some(f=>f.code==='financial-records-coverage-or-union'));
  r.report.equationDecisions[0].annualKeys[0]=hash('wrong evidence');assert.ok((await auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read)).failures.some(f=>f.code==='equation-review-evidence'));
});
test('over-budget installments retain both affected months and cannot produce a partial approved total',async t=>{
  for(const net of [60,100]){
    const line=(month:number)=>annualLine(1,month,'COMBUSTÍVEIS','100.00').replace(';100.00;100.00;0;',`;${net}.00;100.00;0;`).replace(/;0$/,`;${month}`);
    const r=await setup(t,url=>url.endsWith('.zip')?annual([line(1),line(2)]):url.includes('/1/despesas')?{dados:[apiRow(Number(new URL(url).searchParams.get('mes')),{valorDocumento:100,valorLiquido:net,parcela:Number(new URL(url).searchParams.get('mes'))})],links:[]}:undefined);
    assert.equal(r.report.equationDecisions.length,0);assert.equal(r.report.equationHolds[0].reason,'over-document-limit');assert.equal(r.report.totalCents,null);for(const c of r.report.cells.filter(c=>c.personId===1)){assert.equal(c.status,'held-review');assert.equal(c.totalCents,null);assert.deepEqual(c.records,[]);assert.deepEqual(c.reasons,['installment-document-review']);}
    r.report.equationHolds=[];r.report.contentSha256=expenseBatchContentId(r.report);assert.ok((await auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read)).failures.some(f=>f.code==='equation-review-holds'));
  }
});
test('a complete-year split across months preserves each competence and does not multiply the document face',async t=>{
  const line=(month:number,net:string)=>annualLine(1,month,'COMBUSTÍVEIS','10.00').replace(';10.00;10.00;0;',`;${net};10.00;0;`);
  const r=await setup(t,url=>url.endsWith('.zip')?annual([line(1,'4.00'),line(2,'6.00')]):url.includes('/1/despesas')?{dados:Number(new URL(url).searchParams.get('mes'))<=2?[apiRow(Number(new URL(url).searchParams.get('mes')),{valorDocumento:10,valorLiquido:Number(new URL(url).searchParams.get('mes'))===1?4:6})]:[],links:[]}:undefined,true);
  assert.equal(r.report.totalCents,1000);assert.equal(r.report.cells[0].totalCents,400);assert.equal(r.report.cells[1].totalCents,600);assert.equal(r.report.cells[0].records[0].financialBasis,'balanced-document-split');assert.deepEqual(r.report.equationDecisions[0].months,[1,2]);assert.equal(r.report.cells.length,24);
});
test('distinct annual flight routes preserve the proof but cannot authorize summing identical API projections',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?zipSync({'Ano-2025.csv':strToU8(columns+';txtTrecho\n'+annualLine(1,1,'PASSAGEM AÉREA - SIGEPA')+';AAA/BBB\n'+annualLine(1,1,'PASSAGEM AÉREA - SIGEPA')+';BBB/AAA\n')}):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{tipoDespesa:'PASSAGEM AÉREA - SIGEPA'}),apiRow(1,{tipoDespesa:'PASSAGEM AÉREA - SIGEPA'})],links:[]}:undefined);
  assert.equal(r.report.cells[0].status,'held-review');assert.deepEqual(r.report.cells[0].reasons,['sigepa-unit-unconfirmed']);assert.deepEqual(r.report.cells[0].records,[]);assert.equal(r.report.totalCents,null);assert.equal(r.report.multiplicityDecisions[0].count,2);
  r.report.multiplicityDecisions[0].count=1;assert.ok((await auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read)).failures.some(f=>f.code==='multiplicity-review-evidence'));
});
test('an exactly full terminal page needs a preserved empty probe and remains independently auditable',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual(Array.from({length:25},(_,i)=>annualLine(1,1,'COMBUSTÍVEIS','10.21',String(10+i)))):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:new URL(url).searchParams.get('pagina')==='1'?Array.from({length:25},(_,i)=>apiRow(1,{codDocumento:String(10+i)})):[],links:[]}:undefined);
  assert.equal(r.report.cells[0].status,'complete');assert.equal(r.report.cells[0].api[1].pages.length,2);assert.equal(r.report.cells[0].api[1].count,25);assert.equal(r.report.totalCents,25525);
});
test('a matched official portal ledger cannot release API-only SIGEPA duplicates while the accounting unit is unconfirmed',async t=>{
  const reply=(url:string)=>url.endsWith('.zip')?zipSync({'Ano-2025.csv':strToU8(columns+';nuDeputadoId\n'+annualLine()+';99\n')}):url.includes('/analitico?')?new Response(portalHtml([{net:1021},{net:1021},{net:-1021}])):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(),... [10.21,10.21,-10.21].map(net=>apiRow(1,{codDocumento:'11',tipoDespesa:'PASSAGEM AÉREA - SIGEPA',valorDocumento:net,valorLiquido:net}))],links:[]}:undefined;
  const r=await setup(t,reply,false,true),cell=r.report.cells[0];assert.equal(cell.status,'held-review');assert.equal(r.report.totalCents,null);assert.deepEqual(cell.records,[]);assert.deepEqual(cell.reasons,['sigepa-unit-unconfirmed']);assert.equal(r.report.portalChecks[0].status,'matched');assert.equal(r.report.portalChecks[0].count,3);assert.equal(r.report.publicationEligible,false);
  const capture=(pass:number)=>new PeopleCapture(path.join(r.dir,'pass-'+pass),r.key,async()=>{throw Error('network forbidden');},async()=>{}),resumed=await collectExpenseBatch(scope,temporal,hash('proposal'),capture(1),capture(2),{portal:true,wait:async()=>{}});assert.equal(resumed.metrics.requests,0);assert.equal(resumed.contentSha256,r.report.contentSha256);
  const original=structuredClone(r.report),audit=()=>auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read);
  for(const edit of [()=>r.report.portalChecks[0].count=2,()=>r.report.cells[0].reasons=[],()=>{r.report.cells[0].status='no-expenses-confirmed';r.report.cells[0].totalCents=0;}]){edit();r.report.contentSha256=expenseBatchContentId(r.report);assert.equal((await audit()).status,'failed');Object.assign(r.report,structuredClone(original));}
});
test('missing, changed or mismatched portal evidence never clears an unresolved SIGEPA month',async t=>{
  for(const mode of ['missing','changed','mismatch','no-identity'] as const){
    const r=await setup(t,(url,pass)=>url.endsWith('.zip')?mode==='no-identity'?annual():zipSync({'Ano-2025.csv':strToU8(columns+';nuDeputadoId\n'+annualLine()+';99\n')}):url.includes('/analitico?')?mode==='missing'&&pass===2?new Response('',{status:404}):new Response(portalHtml(mode==='mismatch'?[{}]:mode==='changed'&&pass===2?[{net:1022},{}]:[{},{}])):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(),apiRow(1,{codDocumento:'11',tipoDespesa:'PASSAGEM AÉREA - SIGEPA'}),apiRow(1,{codDocumento:'11',tipoDespesa:'PASSAGEM AÉREA - SIGEPA'})],links:[]}:undefined,false,true);
    assert.equal(r.report.cells[0].status,'held-review');assert.equal(r.report.cells[0].totalCents,null);assert.equal(r.report.totalCents,null);assert.equal(r.report.portalChecks[0].status,mode==='changed'?'changed':mode==='mismatch'?'mismatch':'unavailable');
  }
});
test('an extra next link after a declared full last page needs an empty successor with the same filters',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual(Array.from({length:25},(_,i)=>annualLine(1,1,'COMBUSTÍVEIS','10.21',String(10+i)))):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:new URL(url).searchParams.get('pagina')==='1'?Array.from({length:25},(_,i)=>apiRow(1,{codDocumento:String(10+i)})):[],links:new URL(url).searchParams.get('pagina')==='1'&&new URL(url).searchParams.get('itens')==='25'?[{rel:'next',href:expenseUrl(scope,1,1,2,2)},{rel:'last',href:expenseUrl(scope,1,1,2)}]:[]}:undefined);
  assert.equal(r.report.cells[0].status,'complete');assert.equal(r.report.cells[0].api[1].pages.length,2);
});
test('resuming immutable captures performs no network and keeps the logical content version',async t=>{
  const r=await setup(t),capture=(pass:number)=>new PeopleCapture(path.join(r.dir,'pass-'+pass),r.key,async()=>{throw Error('network forbidden');},async()=>{});
  const resumed=await collectExpenseBatch(scope,temporal,hash('proposal'),capture(1),capture(2),{wait:async()=>{}});assert.equal(resumed.metrics.requests,0);assert.equal(resumed.contentSha256,r.report.contentSha256);assert.equal(resumed.cells[0].records.length,r.report.cells[0].records.length);assert.equal((await auditExpenseBatch(resumed,temporal,scope,hash('proposal'),r.read)).status,'passed');
});
test('fresh captures detect API-only corrections and withdrawals even when both annual archives stay identical',async t=>{
  const withApi=(net:number|null)=>(url:string)=>url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(),...(net===null?[]:[apiRow(1,{codDocumento:'12',tipoDespesa:'PASSAGEM AÉREA - SIGEPA',valorDocumento:net,valorLiquido:net})])],links:[]}:undefined;
  const before=await setup(t,withApi(3)),preserved=canonical(before.report),corrected=await setup(t,withApi(4)),withdrawn=await setup(t,withApi(null));
  assert.deepEqual(before.report.annual.map(a=>a.source.sha256),corrected.report.annual.map(a=>a.source.sha256));assert.deepEqual(before.report.annual.map(a=>a.source.sha256),withdrawn.report.annual.map(a=>a.source.sha256));
  assert.deepEqual([before.report.totalCents,corrected.report.totalCents,withdrawn.report.totalCents],[1321,1421,1021]);assert.equal(withdrawn.report.cells[0].records.length,1);assert.notEqual(before.report.contentSha256,corrected.report.contentSha256);assert.notEqual(before.report.contentSha256,withdrawn.report.contentSha256);assert.equal(canonical(before.report),preserved);
  assert.ok([before,corrected,withdrawn].every(r=>r.report.publicationEligible===false));
});
test('withdrawal in both new sources can confirm an empty month, whereas one-sided withdrawal stays held',async t=>{
  const before=await setup(t),empty=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(99)]):url.includes('/despesas?')?{dados:[],links:[]}:undefined),oneSided=await setup(t,url=>url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[],links:[]}:undefined);
  assert.equal(before.report.cells[0].records.length,1);assert.equal(empty.report.cells[0].status,'no-expenses-confirmed');assert.equal(empty.report.cells[0].totalCents,0);assert.equal(empty.report.totalCents,0);assert.notEqual(empty.report.contentSha256,before.report.contentSha256);
  assert.equal(oneSided.report.cells[0].status,'held-review');assert.equal(oneSided.report.cells[0].totalCents,null);assert.equal(oneSided.report.totalCents,null);assert.equal(before.report.totalCents,1021);
  await assert.rejects(setup(t,url=>url.endsWith('.zip')?annual([]):undefined),/Arquivo anual vazio/);
});
test('API-only SIGEPA and negative annual-only adjustments survive without widening unreviewed exception categories',async t=>{
  const r=await setup(t,(url)=>url.endsWith('.zip')?annual([annualLine(),annualLine(1,1,'COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA','-2.00','11')]):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(),apiRow(1,{codDocumento:'12',tipoDespesa:'PASSAGEM AÉREA - SIGEPA',valorDocumento:3,valorLiquido:3})],links:[]}:undefined);
  assert.equal(r.report.cells[0].status,'complete');assert.equal(r.report.totalCents,1121);assert.deepEqual(r.report.cells[0].records.map(r=>r.origin),['both','annual','api']);
  const held=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(1,1,'UNREVIEWED')]):undefined);assert.equal(held.report.cells[0].status,'held-review');assert.equal(held.report.totalCents,null);assert.equal(held.report.cells[0].totalCents,null);assert.equal(held.report.cells[0].records.length,0);assert.deepEqual(held.report.cells[0].diagnostics?.annualOnly,{UNREVIEWED:1});
});
test('failed sources and between-pass changes retain coverage without a zero or a partial grand total',async t=>{
  const failed=await setup(t,(url,pass)=>url.includes('/1/despesas')&&url.includes('mes=2&')&&pass===2?new Response('private-body',{status:404}):undefined);assert.equal(failed.report.cells[1].status,'source-failure');assert.equal(failed.report.cells[1].totalCents,null);assert.equal(failed.report.totalCents,null);
  const changed=await setup(t,(url,pass)=>url.includes('/1/despesas')&&url.includes('mes=1&')&&pass===2?{dados:[apiRow(1,{valorDocumento:20,valorLiquido:20})],links:[]}:undefined);assert.deepEqual(changed.report.cells[0].reasons,['api-changed-between-passes']);
  const annualChanged=await setup(t,(url,pass)=>url.endsWith('.zip')&&pass===2?annual([annualLine(1,1,'COMBUSTÍVEIS','10.22')]):undefined);assert.ok(annualChanged.report.cells.every(c=>c.reasons.includes('annual-changed-between-passes')));assert.equal(annualChanged.report.totalCents,null);
});
test('duplicate occurrences and mismatched equations are held, preserving original evidence rather than deduplicating',async t=>{
  const duplicate=await setup(t,url=>url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(),apiRow()],links:[]}:undefined);assert.deepEqual(duplicate.report.cells[0].reasons,['ambiguous-identical-occurrences']);assert.equal(duplicate.report.cells[0].api[1].count,2);
  const equation=await setup(t,url=>url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{valorDocumento:11})],links:[]}:undefined);assert.deepEqual(equation.report.cells[0].reasons,['financial-normalization-failed']);
});
test('pagination rejects added filters, missing pages and full terminal pages without completion proof',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-expense-page-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(const [i,body] of [{dados:[apiRow()],links:[{rel:'next',href:expenseUrl(scope,1,1,1,2)+'&extra=x'}]},{dados:[apiRow()],links:[{rel:'last',href:expenseUrl(scope,1,1,1,2)}]},{dados:Array.from({length:100},()=>apiRow()),links:[]}].entries()){
    const c=new PeopleCapture(path.join(dir,String(i)),randomBytes(32),async()=>new Response(JSON.stringify(body)),async()=>{});await assert.rejects(expensePages(scope,1,1,1,c));
  }
});
test('independent financial audit rejects altered cents, false empty status, missing competences and historical reassignment',async t=>{
  const r=await setup(t),audit=()=>auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read),original=structuredClone(r.report);
  for(const edit of [()=>r.report.cells[0].records[0].cents++,()=>r.report.cells[0].status='no-expenses-confirmed',()=>r.report.cells.pop(),()=>r.report.cells[2].party={status:'single',value:'A',values:['A'],rows:[]},()=>r.report.cells[0].api[0].count=0,()=>Object.assign(r.report,{publicationEligible:true}),()=>r.report.totalCents=0,()=>r.report.cells[0].records[0].supplier='Alterado']){
    edit();assert.equal((await audit()).status,'failed');Object.assign(r.report,structuredClone(original));
  }
  await assert.rejects(auditExpenseBatch(r.report,temporal,scope,hash('proposal'),async()=>strToU8('tampered')),/Hash/);
});
test('retired equation and SIGEPA policies are refused even if their content hash is recomputed',async t=>{
  const r=await setup(t);Object.assign(r.report,{equationRule:'camara.ceap.correlated-net.v1',multiplicityRule:'camara.ceap.sigepa-annual-routes.v1'});r.report.contentSha256=expenseBatchContentId(r.report);const audit=await auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read);assert.equal(audit.status,'failed');for(const code of ['equation-review-evidence','multiplicity-review-evidence'])assert.ok(audit.failures.some(f=>f.code===code));
});
test('known private identifiers cannot be written even in allowed document fields',async t=>{
  await assert.rejects(setup(t,url=>url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{numDocumento:'12345678901',cnpjCpfFornecedor:'12345678901'})],links:[]}:url.endsWith('.zip')?annual([annualLine().replace(';N1;',';12345678901;').replace('11222333000181','12345678901')]):undefined),/Identificador privado/);
});
test('malformed annual competences for a selected identity cannot disappear through filtering and create false empty months',async t=>{
  await assert.rejects(setup(t,url=>url.endsWith('.zip')?annual([annualLine(1,0)]):undefined),/Identidade ou competência anual inválida/);
});
test('an empty response identifying another competence cannot manufacture a zero',async t=>{
  const r=await setup(t,url=>url.includes('/2/despesas')&&url.includes('mes=2&')?{dados:[],links:[{rel:'self',href:url.replace('mes=2&','mes=1&')}]}:undefined);
  const cell=r.report.cells.find(c=>c.personId===2&&c.month===2)!;assert.equal(cell.status,'source-failure');assert.equal(cell.totalCents,null);assert.equal(r.report.totalCents,null);
});
test('financial CLI takes its lock before reading inputs and refuses a different selection without overwriting a run',async t=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-financial-cli-'));t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  const root=path.join(cwd,'data/private/expense-intermediate/test-run'),keys=path.join(cwd,'data/private/people-discovery');await fs.mkdir(root,{recursive:true});await fs.mkdir(keys,{recursive:true});await fs.writeFile(path.join(keys,'local-vault-key'),randomBytes(32));
  const original=JSON.stringify({selectionRun:'original-selection',status:'review-required'});await fs.writeFile(path.join(root,'run.json'),original);
  const script=fileURLToPath(new URL('../scripts/collect-expense-intermediate.ts',import.meta.url)),args=['--import',import.meta.resolve('tsx'),script,'--local','--offline','--run','test-run','--selection-run','another-selection'];
  await assert.rejects(promisify(execFile)(process.execPath,args,{cwd}));assert.equal(await fs.readFile(path.join(root,'run.json'),'utf8'),original);await assert.rejects(fs.stat(path.join(root,'running.lock')),{code:'ENOENT'});
  await fs.writeFile(path.join(root,'running.lock'),'keep');await assert.rejects(promisify(execFile)(process.execPath,args,{cwd}),e=>typeof e==='object'&&e!==null&&'stderr' in e&&String(e.stderr).includes('Outra tarefa possui'));assert.equal(await fs.readFile(path.join(root,'running.lock'),'utf8'),'keep');
});

const sigepa=(month:number,overrides:Record<string,unknown>={})=>apiRow(month,{tipoDespesa:'PASSAGEM AÉREA - SIGEPA',codDocumento:'11',numDocumento:'T1',valorDocumento:500,valorLiquido:500,...overrides});
const firstMonth=(rows:unknown[])=>(url:string)=>{const u=new URL(url);return u.pathname.includes('/1/despesas')&&u.searchParams.get('mes')==='1'?{dados:rows,links:[{rel:'self',href:url}]}:undefined;};
const cell=(r:{cells:any[]},id=1,month=1)=>r.cells.find(c=>c.personId===id&&c.month===month);
test('an API row from another competence holds the month instead of entering its total',async t=>{
  const {report}=await setup(t,firstMonth([apiRow(),sigepa(2)]));
  assert.equal(cell(report).status,'held-review');assert.deepEqual(cell(report).reasons,['api-row-outside-competence']);assert.equal(cell(report).totalCents,null);
});
test('expenses in a month outside the mandate open review and carry no approved value',async t=>{
  const {report}=await setup(t,undefined,false,false,tr=>{tr.people[0].months[0].exercise='outside';});
  assert.equal(cell(report).status,'held-review');assert.deepEqual(cell(report).reasons,['expense-outside-exercise']);assert.deepEqual(cell(report).records,[]);assert.equal(cell(report).totalCents,null);
});
test('repeated SIGEPA amounts that differ only outside the money stay held',async t=>{
  const {report}=await setup(t,firstMonth([apiRow(),sigepa(1,{numRessarcimento:''}),sigepa(1,{numRessarcimento:null})]));
  assert.deepEqual(cell(report).reasons,['sigepa-unit-unconfirmed']);assert.equal(cell(report).totalCents,null);
});
test('a selected identity with another year in the annual file stops the run instead of vanishing',async t=>{
  const line='1;2024;1;57;COMBUSTÍVEIS;10.21;10.21;0;10;Empresa;11222333000181;;N1;2024-01-02T00:00:00;1;0';
  await assert.rejects(setup(t,url=>url.endsWith('.zip')?annual([annualLine(),line]):undefined));
});
test('an annual file without numParcela stops the run',async t=>{
  const noParcel=zipSync({'Ano-2025.csv':strToU8(columns.replace(';numParcela','')+'\n'+annualLine().replace(/;0$/,'')+'\n')});
  await assert.rejects(setup(t,url=>url.endsWith('.zip')?noParcel:undefined));
});
