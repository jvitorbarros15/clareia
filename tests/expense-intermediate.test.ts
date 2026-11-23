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
async function setup(t:test.TestContext,reply?:(url:string,pass:number)=>unknown,fullYear=false,portal=false,tune?:(t:TemporalReport)=>void,audited=true){
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
  if(audited)assert.deepEqual((await auditExpenseBatch(report,selectedTemporal,selectedScope,hash('proposal'),read)).failures,[]);
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
test('API nulls for document id, lot, installment and glosa pair with the annual blanks and are audited independently',async t=>{
  const category='PASSAGEM AÉREA - MISSÃO OFICIAL',line=`1;2025;1;57;${category};-10.21;10.21;;;Empresa;11222333000181;;N1;2025-01-02T00:00:00;;0`;
  const r=await setup(t,url=>url.endsWith('.zip')?annual([line]):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{tipoDespesa:category,codDocumento:null,codLote:null,parcela:null,valorGlosa:null,valorDocumento:10.21,valorLiquido:-10.21})],links:[]}:undefined);
  const cell=r.report.cells[0];assert.equal(cell.status,'complete');assert.equal(cell.totalCents,-1021);assert.equal(cell.records.length,1);assert.equal(cell.records[0].origin,'both');assert.equal(cell.records[0].disallowedCents,null);
  const bad=await setup(t,url=>url.endsWith('.zip')?annual([line]):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{tipoDespesa:category,codDocumento:null,codLote:null,parcela:null,valorGlosa:null,valorDocumento:10.21,valorLiquido:null})],links:[]}:undefined).catch(e=>e);
  assert.ok(bad instanceof Error||bad.report.cells[0].status==='held-review');
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
test('distinct annual flight routes preserve the proof and publish the identical API projections flagged',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?zipSync({'Ano-2025.csv':strToU8(columns+';txtTrecho\n'+annualLine(1,1,'PASSAGEM AÉREA - SIGEPA')+';AAA/BBB\n'+annualLine(1,1,'PASSAGEM AÉREA - SIGEPA')+';BBB/AAA\n')}):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{tipoDespesa:'PASSAGEM AÉREA - SIGEPA'}),apiRow(1,{tipoDespesa:'PASSAGEM AÉREA - SIGEPA'})],links:[]}:undefined);
  const c0=r.report.cells[0];assert.equal(c0.status,'complete');assert.deepEqual(c0.reasons,[]);assert.equal(c0.duplicateReason,'sigepa-unit-unconfirmed');assert.equal(c0.records.length,2);assert.ok(c0.records.every(x=>x.duplicateFlag==='possible'));assert.equal(new Set(c0.records.map(x=>x.id)).size,2);assert.equal(r.report.multiplicityDecisions[0].count,2);
  r.report.multiplicityDecisions[0].count=1;assert.ok((await auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read)).failures.some(f=>f.code==='multiplicity-review-evidence'));
});
test('an exactly full terminal page needs a preserved empty probe and remains independently auditable',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual(Array.from({length:25},(_,i)=>annualLine(1,1,'COMBUSTÍVEIS','10.21',String(10+i)))):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:new URL(url).searchParams.get('pagina')==='1'?Array.from({length:25},(_,i)=>apiRow(1,{codDocumento:String(10+i)})):[],links:[]}:undefined);
  assert.equal(r.report.cells[0].status,'complete');assert.equal(r.report.cells[0].api[1].pages.length,2);assert.equal(r.report.cells[0].api[1].count,25);assert.equal(r.report.totalCents,25525);
});
test('a matched official portal ledger publishes API-only SIGEPA duplicates flagged, while preserving the proof',async t=>{
  const reply=(url:string)=>url.endsWith('.zip')?zipSync({'Ano-2025.csv':strToU8(columns+';nuDeputadoId\n'+annualLine()+';99\n')}):url.includes('/analitico?')?new Response(portalHtml([{net:1021},{net:1021},{net:-1021}])):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(),... [10.21,10.21,-10.21].map(net=>apiRow(1,{codDocumento:'11',tipoDespesa:'PASSAGEM AÉREA - SIGEPA',valorDocumento:net,valorLiquido:net}))],links:[]}:undefined;
  const r=await setup(t,reply,false,true),cell=r.report.cells[0];assert.equal(cell.status,'complete');assert.equal(cell.totalCents,2042);assert.equal(cell.records.length,4);assert.equal(cell.records.filter(x=>x.duplicateFlag==='possible').length,2);assert.deepEqual(cell.reasons,[]);assert.equal(cell.duplicateReason,'sigepa-unit-unconfirmed');assert.equal(r.report.portalChecks[0].status,'matched');assert.equal(r.report.portalChecks[0].count,3);assert.equal(r.report.publicationEligible,false);
  const capture=(pass:number)=>new PeopleCapture(path.join(r.dir,'pass-'+pass),r.key,async()=>{throw Error('network forbidden');},async()=>{}),resumed=await collectExpenseBatch(scope,temporal,hash('proposal'),capture(1),capture(2),{portal:true,wait:async()=>{}});assert.equal(resumed.metrics.requests,0);assert.equal(resumed.contentSha256,r.report.contentSha256);
  const original=structuredClone(r.report),audit=()=>auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read);
  for(const edit of [()=>r.report.portalChecks[0].count=2,()=>delete r.report.cells[0].duplicateReason,()=>{r.report.cells[0].records[1].duplicateFlag=undefined;},()=>{r.report.cells[0].status='no-expenses-confirmed';r.report.cells[0].totalCents=0;}]){edit();r.report.contentSha256=expenseBatchContentId(r.report);assert.equal((await audit()).status,'failed');Object.assign(r.report,structuredClone(original));}
});
test('a portal that disagrees or changes keeps the unresolved SIGEPA month held; an unavailable one publishes it flagged',async t=>{
  for(const mode of ['missing','changed','mismatch','no-identity'] as const){
    const r=await setup(t,(url,pass)=>url.endsWith('.zip')?mode==='no-identity'?annual():zipSync({'Ano-2025.csv':strToU8(columns+';nuDeputadoId\n'+annualLine()+';99\n')}):url.includes('/analitico?')?mode==='missing'&&pass===2?new Response('',{status:404}):new Response(portalHtml(mode==='mismatch'?[{}]:mode==='changed'&&pass===2?[{net:1022},{}]:[{},{}])):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(),apiRow(1,{codDocumento:'11',tipoDespesa:'PASSAGEM AÉREA - SIGEPA'}),apiRow(1,{codDocumento:'11',tipoDespesa:'PASSAGEM AÉREA - SIGEPA'})],links:[]}:undefined,false,true);
    const disagree=mode==='changed'||mode==='mismatch',held=r.report.cells[0];if(disagree){assert.equal(held.status,'held-review');assert.deepEqual(held.reasons,['portal-disagrees']);assert.deepEqual(held.records,[]);assert.equal(held.totalCents,null);assert.equal(held.duplicateReason,undefined);}else{assert.equal(held.status,'complete');assert.equal(held.duplicateReason,'ambiguous-identical-occurrences');}
    assert.equal(r.report.portalChecks[0].status,mode==='changed'?'changed':mode==='mismatch'?'mismatch':'unavailable');
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
test('identical rows are published with distinct ids and flagged; mismatched equations stay held',async t=>{
  const duplicate=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(),annualLine()]):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(),apiRow()],links:[]}:undefined),dc=duplicate.report.cells[0];assert.equal(dc.status,'complete');assert.deepEqual(dc.reasons,[]);assert.equal(dc.duplicateReason,'ambiguous-identical-occurrences');assert.equal(dc.api[1].count,2);assert.equal(dc.records.length,2);assert.equal(new Set(dc.records.map(x=>x.id)).size,2);assert.ok(dc.records.every(x=>x.duplicateFlag==='possible'));const pre=await auditExpenseBatch(duplicate.report,temporal,scope,hash('proposal'),duplicate.read);assert.deepEqual(pre.failures,[]);
  dc.records[0].duplicateFlag=undefined;assert.ok((await auditExpenseBatch(duplicate.report,temporal,scope,hash('proposal'),duplicate.read)).failures.some(f=>f.code==='financial-records-coverage-or-union'));
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
  const r=await setup(t);for(const multiplicityRule of ['camara.ceap.sigepa-annual-routes.v1','camara.ceap.sigepa-preserve-hold.v2']){Object.assign(r.report,{equationRule:'camara.ceap.correlated-net.v1',multiplicityRule});r.report.contentSha256=expenseBatchContentId(r.report);const audit=await auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read);assert.equal(audit.status,'failed');for(const code of ['equation-review-evidence','multiplicity-review-evidence'])assert.ok(audit.failures.some(f=>f.code===code));}
});
test('a document numbered with a known private identifier is hidden, never written',async t=>{
  const r=await setup(t,url=>url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{numDocumento:'12345678901',cnpjCpfFornecedor:'12345678901'})],links:[]}:url.endsWith('.zip')?annual([annualLine().replace(';N1;',';12345678901;').replace('11222333000181','12345678901')]):undefined);
  const records=r.report.cells.flatMap(c=>c.records);
  assert.ok(records.some(x=>x.documentNumber==='[CPF omitido]'));
  assert.equal(JSON.stringify(r.report).includes('12345678901'),false);
});
test('malformed annual competences for a selected identity cannot disappear through filtering and create false empty months',async t=>{
  await assert.rejects(setup(t,url=>url.endsWith('.zip')?annual([annualLine(1,0)]):undefined),/Identidade ou competência anual inválida/);
});
test('an empty response identifying another competence cannot manufacture a zero',async t=>{
  const r=await setup(t,url=>url.includes('/2/despesas')&&url.includes('mes=2&')?{dados:[],links:[{rel:'self',href:url.replace('mes=2&','mes=1&')}]}:undefined);
  const cell=r.report.cells.find(c=>c.personId===2&&c.month===2)!;assert.equal(cell.status,'source-failure');assert.equal(cell.totalCents,null);assert.equal(r.report.totalCents,null);
});
test('financial CLI refuses a different selection before reading inputs or touching a lock',async t=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-financial-cli-'));t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  const root=path.join(cwd,'data/private/expense-intermediate/test-run'),keys=path.join(cwd,'data/private/people-discovery');await fs.mkdir(root,{recursive:true});await fs.mkdir(keys,{recursive:true});await fs.writeFile(path.join(keys,'local-vault-key'),randomBytes(32));
  const original=JSON.stringify({selectionRun:'original-selection',status:'review-required'});await fs.writeFile(path.join(root,'run.json'),original);
  const script=fileURLToPath(new URL('../scripts/collect-expense-intermediate.ts',import.meta.url)),args=['--import',import.meta.resolve('tsx'),script,'--local','--offline','--run','test-run','--selection-run','another-selection'];
  await assert.rejects(promisify(execFile)(process.execPath,args,{cwd}));assert.equal(await fs.readFile(path.join(root,'run.json'),'utf8'),original);await assert.rejects(fs.stat(path.join(root,'running.lock')),{code:'ENOENT'});
  await fs.writeFile(path.join(root,'running.lock'),'keep');await assert.rejects(promisify(execFile)(process.execPath,args,{cwd}),e=>typeof e==='object'&&e!==null&&'stderr' in e&&String(e.stderr).includes('Retomada incompat'));assert.equal(await fs.readFile(path.join(root,'running.lock'),'utf8'),'keep');
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
test('repeated SIGEPA amounts that differ only outside the money are published and flagged',async t=>{
  const {report}=await setup(t,firstMonth([apiRow(),sigepa(1,{numRessarcimento:''}),sigepa(1,{numRessarcimento:null})]));
  assert.deepEqual(cell(report).reasons,[]);assert.equal(cell(report).duplicateReason,'sigepa-unit-unconfirmed');assert.equal(cell(report).totalCents,101021);assert.equal(cell(report).records.filter((x:any)=>x.duplicateFlag==='possible').length,2);
});
test('a selected identity with another year in the annual file stops the run instead of vanishing',async t=>{
  const line='1;2024;1;57;COMBUSTÍVEIS;10.21;10.21;0;10;Empresa;11222333000181;;N1;2024-01-02T00:00:00;1;0';
  await assert.rejects(setup(t,url=>url.endsWith('.zip')?annual([annualLine(),line]):undefined));
});
test('an annual file without numParcela stops the run',async t=>{
  const noParcel=zipSync({'Ano-2025.csv':strToU8(columns.replace(';numParcela','')+'\n'+annualLine().replace(/;0$/,'')+'\n')});
  await assert.rejects(setup(t,url=>url.endsWith('.zip')?noParcel:undefined));
});

test('an annual row from another legislature remains evidence and holds its competence',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual([annualLine().replace(';57;',';56;')]):undefined);
  const c=cell(r.report);
  assert.equal(c.annualCount,1);assert.equal(c.status,'held-review');
  assert.deepEqual(c.reasons,['financial-normalization-failed']);
  assert.equal(c.totalCents,null);assert.deepEqual(c.records,[]);
  // setup also independently audits both preserved captures.
});

test('the audit rejects a duplicate flag or marker on a month that has no repeated rows',async t=>{
  const r=await setup(t);const audit=()=>auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read);
  r.report.cells[0].records[0].duplicateFlag='possible';assert.ok((await audit()).failures.some(f=>f.code==='financial-records-coverage-or-union'));
  r.report.cells[0].records[0].duplicateFlag=undefined;r.report.cells[0].duplicateReason='sigepa-unit-unconfirmed';assert.ok((await audit()).failures.some(f=>f.code==='financial-records-coverage-or-union'));
});

const SIG='PASSAGEM AÉREA - SIGEPA';
test('a repetition together with another problem stays held with the other reason and no duplicate marker',async t=>{
  const {report}=await setup(t,firstMonth([apiRow(1,{valorDocumento:11}),apiRow(1,{valorDocumento:11})]));
  assert.equal(cell(report).status,'held-review');assert.deepEqual(cell(report).reasons,['financial-normalization-failed']);assert.equal(cell(report).duplicateReason,undefined);assert.deepEqual(cell(report).records,[]);
});
test('three identical rows are published with three distinct ids, all flagged',async t=>{
  const {report}=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(),annualLine(),annualLine()]):firstMonth([apiRow(),apiRow(),apiRow()])(url));
  const c=cell(report);assert.equal(c.status,'complete');assert.equal(c.records.length,3);assert.equal(new Set(c.records.map((x:any)=>x.id)).size,3);assert.ok(c.records.every((x:any)=>x.duplicateFlag==='possible'));assert.equal(c.totalCents,3063);
});
test('a SIGEPA ticket with a blank document is flagged when the API repeats it',async t=>{
  const {report}=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(1,1,SIG,'10.21','')]):firstMonth([apiRow(1,{tipoDespesa:SIG,codDocumento:null,numRessarcimento:'a'}),apiRow(1,{tipoDespesa:SIG,codDocumento:null,numRessarcimento:'b'})])(url));
  const c=cell(report);assert.equal(c.status,'complete');assert.equal(c.duplicateReason,'sigepa-unit-unconfirmed');assert.equal(c.records.length,2);assert.ok(c.records.every((x:any)=>x.duplicateFlag==='possible'));
});
test('an offline re-projection with a missing preserved page fails instead of holding the month quietly',async t=>{
  const r=await setup(t),offline=(pass:number)=>new PeopleCapture(path.join(r.dir,'pass-'+pass),r.key,async()=>new Response('',{status:404}),async()=>{});
  const ok=await collectExpenseBatch(scope,temporal,hash('proposal'),offline(1),offline(2),{wait:async()=>{},offline:true,previous:r.report});assert.equal(ok.metrics.requests,0);
  await fs.rm(path.join(r.dir,'pass-2',hash(expenseUrl(scope,1,1,2))+'.sealed'));
  await assert.rejects(collectExpenseBatch(scope,temporal,hash('proposal'),offline(1),offline(2),{wait:async()=>{},offline:true,previous:r.report}),/offline/);
});
test('the batch date is the latest capture time, so an offline re-projection keeps the original collection date',async t=>{
  const r=await setup(t),offline=(pass:number)=>new PeopleCapture(path.join(r.dir,'pass-'+pass),r.key,async()=>{throw Error('network forbidden');},async()=>{});
  await new Promise(done=>setTimeout(done,20));
  const again=await collectExpenseBatch(scope,temporal,hash('proposal'),offline(1),offline(2),{wait:async()=>{},offline:true});
  assert.equal(again.createdAt,r.report.createdAt);assert.equal(again.createdAt,r.report.sources.map(x=>x.fetchedAt).sort().at(-1));
});
test('annual rows that differ only in the supplier stay held, while identical rows do not',async t=>{
  const line=(supplier:string,id:string)=>annualLine().replace('Empresa;11222333000181',`${supplier};${id}`);
  const {report}=await setup(t,url=>url.endsWith('.zip')?annual([line('A','12345678909'),line('B','98765432100')]):undefined);
  assert.equal(cell(report).status,'held-review');assert.deepEqual(cell(report).reasons,['supplier-only-difference']);assert.equal(cell(report).duplicateReason,undefined);
});

test('an unexpected error while checking a month holds it as a processing error, never as a duplicate',async t=>{
  const {report}=await setup(t,firstMonth([null]),false,false,undefined,false);
  assert.equal(cell(report).status,'held-review');assert.deepEqual(cell(report).reasons,['processing-error']);assert.equal(cell(report).duplicateReason,undefined);
});
test('a SIGEPA ticket with a blank document number is flagged when the API repeats it',async t=>{
  const {report}=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(1,1,SIG).replace(';N1;',';;')]):firstMonth([apiRow(1,{tipoDespesa:SIG,numDocumento:'',numRessarcimento:'a'}),apiRow(1,{tipoDespesa:SIG,numDocumento:'',numRessarcimento:'b'})])(url));
  const c=cell(report);assert.equal(c.status,'complete');assert.equal(c.duplicateReason,'sigepa-unit-unconfirmed');assert.equal(c.records.length,2);assert.ok(c.records.every((x:any)=>x.duplicateFlag==='possible'));
});
test('supplier-only rows plus a failing equation hold the same way in the collector and the audit',async t=>{
  const line=(supplier:string,id:string)=>annualLine().replace('Empresa;11222333000181',`${supplier};${id}`);
  const {report}=await setup(t,url=>url.endsWith('.zip')?annual([line('A','12345678909'),line('B','98765432100')]):firstMonth([apiRow(1,{valorDocumento:11})])(url));
  assert.deepEqual(cell(report).reasons,['financial-normalization-failed']);
});
test('an outside-exercise month with repeated rows is held for the exercise, in the collector and the audit',async t=>{
  const {report}=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(),annualLine()]):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(),apiRow()],links:[]}:undefined,false,false,tr=>{tr.people[0].months[0].exercise='outside';});
  assert.deepEqual(cell(report).reasons,['expense-outside-exercise']);assert.equal(cell(report).duplicateReason,undefined);assert.deepEqual(cell(report).records,[]);
});
test('an offline re-projection fails only on a failure the previous report did not have',async t=>{
  const r=await setup(t,(url,pass)=>url.includes('/1/despesas')&&url.includes('mes=2&')&&pass===2?new Response('',{status:404}):undefined),offline=(pass:number)=>new PeopleCapture(path.join(r.dir,'pass-'+pass),r.key,async()=>new Response('',{status:404}),async()=>{});
  assert.equal(cell(r.report,1,2).status,'source-failure');
  const again=await collectExpenseBatch(scope,temporal,hash('proposal'),offline(1),offline(2),{wait:async()=>{},offline:true,previous:r.report});assert.equal(cell(again,1,2).status,'source-failure');
  await assert.rejects(collectExpenseBatch(scope,temporal,hash('proposal'),offline(1),offline(2),{wait:async()=>{},offline:true}),/offline/);
});
const invertedApi=(overrides:Record<string,unknown>={})=>(url:string)=>url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{valorDocumento:10.21,valorGlosa:0,valorLiquido:-10.21,...overrides})],links:[]}:undefined;
test('an inverted API net is taken from the annual value, counted for the month and not marked on the record',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?undefined:invertedApi()(url));
  const c=r.report.cells[0];assert.equal(c.status,'complete');assert.deepEqual(c.reasons,[]);assert.equal(c.records.length,1);assert.equal(c.records[0].cents,1021);assert.equal(c.records[0].origin,'both');assert.equal(c.records[0].sourceCents,undefined);assert.equal(c.records[0].note,undefined);assert.equal(c.diagnostics?.apiSignCorrected,1);assert.equal(r.report.totalCents,1021);
});
test('an inverted API row with no annual partner or a different annual value keeps the month held',async t=>{
  const none=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(2)]):invertedApi()(url));
  const empty=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(1,1,'COMBUSTÍVEIS','10.21','99')]):invertedApi()(url));
  for(const r of [none,empty]){const c=r.report.cells[0];assert.equal(c.status,'held-review');assert.deepEqual(c.reasons,['unreconciled-source-occurrences']);assert.deepEqual(c.records,[]);assert.equal(c.diagnostics?.apiSignCorrected,undefined);}
  const other=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(1,1,'COMBUSTÍVEIS','9.50')]):invertedApi()(url));
  assert.deepEqual(other.report.cells[0].reasons,['unreconciled-source-occurrences']);assert.deepEqual(other.report.cells[0].records,[]);
});
test('a second inverted row with only one annual partner leaves the month held',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?undefined:url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{valorLiquido:-10.21}),apiRow(1,{valorLiquido:-10.21})],links:[]}:undefined);
  assert.deepEqual(r.report.cells[0].reasons,['unreconciled-source-occurrences']);
});
test('two inverted rows with two annual partners are both taken from the annual file',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(),annualLine()]):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{valorLiquido:-10.21}),apiRow(1,{valorLiquido:-10.21})],links:[]}:undefined);
  const c=r.report.cells[0];assert.equal(c.status,'complete');assert.equal(c.diagnostics?.apiSignCorrected,2);assert.equal(c.totalCents,2042);
});
test('airfare, housing, zero values and correct positives are not touched by the API sign rule',async t=>{
  const sigepa=await setup(t,url=>url.endsWith('.zip')?undefined:invertedApi({tipoDespesa:'PASSAGEM AÉREA - SIGEPA'})(url));
  assert.deepEqual(sigepa.report.cells[0].reasons,['financial-normalization-failed']);
  const housing='COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA',line=`1;2025;1;57;${housing};-10.21;10.21;;;Empresa;11222333000181;;N1;2025-01-02T00:00:00;;0`;
  const both=await setup(t,url=>url.endsWith('.zip')?annual([line]):invertedApi({tipoDespesa:housing,codDocumento:null,codLote:null,parcela:null,valorGlosa:null})(url));
  assert.equal(both.report.cells[0].status,'complete');assert.equal(both.report.cells[0].totalCents,-1021);assert.equal(both.report.cells[0].diagnostics?.apiSignCorrected,undefined);
  const zero=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(1,1,'COMBUSTÍVEIS','0.00')]):invertedApi({valorDocumento:0,valorLiquido:-0})(url));
  assert.equal(zero.report.cells[0].status,'complete');assert.equal(zero.report.cells[0].diagnostics?.apiSignCorrected,undefined);
  const ok=await setup(t);assert.equal(ok.report.cells[0].diagnostics?.apiSignCorrected,undefined);
});
test('an installment with an inverted API net and no exact annual twin stays held for review',async t=>{
  const line=annualLine(1,1,'COMBUSTÍVEIS','9.50').replace(/;0$/,';1'),r=await setup(t,url=>url.endsWith('.zip')?annual([line]):invertedApi({parcela:1})(url));
  assert.equal(r.report.cells[0].status,'held-review');assert.deepEqual(r.report.cells[0].records,[]);assert.equal(r.report.cells[0].diagnostics?.apiSignCorrected,undefined);
});
test('the leftover sign rule never applies to airfare, mission or housing categories',async t=>{
  for(const category of ['LOCAÇÃO OU FRETAMENTO DE AERONAVES','PASSAGEM AÉREA - RPA','PASSAGEM AÉREA - REEMBOLSO','PASSAGEM AÉREA - MISSÃO OFICIAL','COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA','PASSAGEM AÉREA - SIGEPA']){
    const r=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(2)]):invertedApi({tipoDespesa:category})(url));
    assert.deepEqual(r.report.cells[0].reasons,['financial-normalization-failed'],category);assert.equal(r.report.cells[0].status,'held-review');
  }
});
test('an inverted row with glosa null is not taken from the annual value',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?undefined:invertedApi({valorGlosa:null})(url));
  assert.deepEqual(r.report.cells[0].reasons,['unreconciled-source-occurrences']);
});
test('a held month carries no API sign counter',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(),annualLine(1,1,'UNREVIEWED')]):invertedApi()(url));
  assert.equal(r.report.cells[0].status,'held-review');assert.equal(r.report.cells[0].diagnostics?.apiSignCorrected,undefined);
});
test('an inverted row and a legitimate refund of the same value complete in either API order',async t=>{
  const refund=annualLine(1,1,'COMBUSTÍVEIS','-10.21'),inverted=apiRow(1,{valorLiquido:-10.21}),legit=apiRow(1,{valorDocumento:-10.21,valorLiquido:-10.21});
  for(const dados of [[inverted,legit],[legit,inverted]]){
    const r=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(),refund]):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados,links:[]}:undefined);
    const c=r.report.cells[0];assert.equal(c.status,'complete');assert.equal(c.totalCents,0);assert.equal(c.diagnostics?.apiSignCorrected,1);
  }
});
const withGlosa=(net:string,face:string,glosa:string)=>annualLine().replace(';10.21;10.21;0;',`;${net};${face};${glosa};`);
const invertedGlosa=(overrides:Record<string,unknown>={})=>invertedApi({valorDocumento:10.21,valorGlosa:2,valorLiquido:-8.21,...overrides});
test('an inverted API row with glosa takes the annual value when document and glosa match, and is counted',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual([withGlosa('8.21','10.21','2')]):invertedGlosa()(url));
  const c=r.report.cells[0];assert.equal(c.status,'complete');assert.equal(c.totalCents,821);assert.equal(c.records[0].cents,821);assert.equal(c.records[0].documentCents,1021);assert.equal(c.records[0].disallowedCents,200);assert.equal(c.records[0].origin,'both');assert.equal(c.diagnostics?.apiSignCorrected,1);
});
test('an inverted API row with glosa stays held unless the annual net, document and glosa all match',async t=>{
  const held=async(reply:(url:string)=>unknown,code='unreconciled-source-occurrences')=>{const r=await setup(t,reply as any);assert.deepEqual(r.report.cells[0].reasons,[code]);assert.deepEqual(r.report.cells[0].records,[]);assert.equal(r.report.cells[0].diagnostics?.apiSignCorrected,undefined);};
  await held(url=>url.endsWith('.zip')?annual([withGlosa('8.21','11.21','3')]):invertedGlosa()(url));
  await held(url=>url.endsWith('.zip')?annual([withGlosa('7.21','9.21','2')]):invertedGlosa()(url));
  await held(url=>url.endsWith('.zip')?annual([withGlosa('8.21','10.21','0')].map(l=>l.replace(';8.21;10.21;0;',';10.21;10.21;0;'))):invertedGlosa()(url));
  await held(url=>url.endsWith('.zip')?annual([annualLine(2)]):invertedGlosa()(url));
  await held(url=>url.endsWith('.zip')?annual([annualLine(2)]):invertedGlosa({tipoDespesa:'PASSAGEM AÉREA - SIGEPA'})(url),'financial-normalization-failed');
  await held(url=>url.endsWith('.zip')?annual([annualLine(2)]):invertedGlosa({valorDocumento:5,valorGlosa:8,valorLiquido:3})(url),'financial-normalization-failed');
  await held(url=>url.endsWith('.zip')?annual([withGlosa('8.21','10.21','')]):invertedGlosa()(url));
  await held(url=>url.endsWith('.zip')?annual([withGlosa('8.21','','2')]):invertedGlosa()(url));
  await held(url=>url.endsWith('.zip')?annual([withGlosa('10.21','12.21','2')]):invertedApi()(url));
});
test('an annual row with the inverted shape is never fixed: the month stays held in the collector and the audit',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual([withGlosa('-8.21','10.21','2')]):url.includes('/despesas')?{dados:[],links:[]}:undefined);
  assert.equal(r.report.cells[0].status,'held-review');assert.deepEqual(r.report.cells[0].records,[]);assert.equal(r.report.cells[0].diagnostics,null);
});
test('an inverted row finds its annual partner whichever order the annual rows come in',async t=>{
  const plain=withGlosa('8.21','8.21','0'),glosa=withGlosa('8.21','10.21','2'),dados=[apiRow(1,{valorDocumento:10.21,valorGlosa:2,valorLiquido:8.21}),apiRow(1,{valorDocumento:8.21,valorGlosa:0,valorLiquido:-8.21})];
  for(const lines of [[plain,glosa],[glosa,plain]]){
    const r=await setup(t,url=>url.endsWith('.zip')?annual(lines):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados,links:[]}:undefined);
    const c=r.report.cells[0];assert.equal(c.status,'complete');assert.equal(c.totalCents,1642);assert.equal(c.diagnostics?.apiSignCorrected,1);
  }
});
const housingCat='COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA';
const housingAnnual=(net:string)=>`1;2025;1;57;${housingCat};${net};${net.replace('-','')};;;Empresa;11222333000181;;N1;2025-01-02T00:00:00;;0`;
const housingApi=(net:number)=>(url:string)=>url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:[apiRow(1,{tipoDespesa:housingCat,codDocumento:null,codLote:null,parcela:null,valorDocumento:Math.abs(net),valorGlosa:null,valorLiquido:net})],links:[]}:undefined;
test('a housing API row with the opposite sign pairs with the annual row and keeps the annual value',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual([housingAnnual('-12.47')]):housingApi(12.47)(url));
  const c=r.report.cells[0];assert.equal(c.status,'complete');assert.equal(c.records.length,1);assert.equal(c.records[0].cents,-1247);assert.equal(c.records[0].origin,'both');assert.equal(r.report.totalCents,-1247);
});
test('a housing API row that is not the exact opposite of the annual row keeps the month held',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual([housingAnnual('-12.00')]):housingApi(12.47)(url));
  assert.equal(r.report.cells[0].status,'held-review');assert.deepEqual(r.report.cells[0].reasons,['unreconciled-source-occurrences']);
});
test('a housing API row with no annual row keeps the month held',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual([annualLine(2)]):housingApi(12.47)(url));
  assert.equal(r.report.cells[0].status,'held-review');assert.deepEqual(r.report.cells[0].reasons,['unreconciled-source-occurrences']);
});
const full=(category:string,net:string,face:string,glosa:string,doc:string,parcel:string,month=1)=>`1;2025;${month};57;${category};${net};${face};${glosa};${doc};Empresa;11222333000181;;N1;2025-01-02T00:00:00;1;${parcel}`;
const twinApi=(rows:Record<string,unknown>[])=>(url:string)=>url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:rows.map(o=>apiRow(1,o)),links:[]}:undefined;
test('an API row with the exact opposite net of its annual twin takes the annual value, for moradia, aircraft rental and installments',async t=>{
  const moradia=await setup(t,url=>url.endsWith('.zip')?annual([housingAnnual('-12.47')]):housingApi(12.47)(url));
  const rental=await setup(t,url=>url.endsWith('.zip')?annual([full('LOCAÇÃO OU FRETAMENTO DE AERONAVES','150.00','150.00','0','10','0')]):twinApi([{tipoDespesa:'LOCAÇÃO OU FRETAMENTO DE AERONAVES',valorDocumento:150,valorGlosa:0,valorLiquido:-150}])(url));
  assert.equal(rental.report.cells[0].status,'complete');assert.equal(rental.report.totalCents,15000);assert.equal(rental.report.cells[0].records[0].origin,'both');assert.equal(rental.report.cells[0].diagnostics?.apiSignCorrected,1);
  assert.equal(moradia.report.cells[0].diagnostics?.apiSignCorrected,1);
  const inst=await setup(t,url=>url.endsWith('.zip')?annual([full('COMBUSTÍVEIS','46.32','50.00','0','10','1')]):twinApi([{valorDocumento:50,valorGlosa:0,valorLiquido:-46.32,parcela:1}])(url));
  assert.equal(inst.report.cells[0].status,'complete');assert.equal(inst.report.totalCents,4632);assert.equal(inst.report.cells[0].records[0].financialBasis,'reported-installment');
  const month=(url:string)=>Number(new URL(url).searchParams.get('mes'));
  const split=await setup(t,url=>url.endsWith('.zip')?annual([full('COMBUSTÍVEIS','3.96','7.06','0','10','0',1),full('COMBUSTÍVEIS','3.10','7.06','0','10','0',2)]):url.includes('/1/despesas')?{dados:month(url)<=2?[apiRow(month(url),{valorDocumento:7.06,valorLiquido:month(url)===1?-3.96:-3.10})]:[],links:[]}:undefined,true);
  assert.equal(split.report.cells[0].status,'complete');assert.equal(split.report.totalCents,706);assert.equal(split.report.cells[0].records[0].financialBasis,'balanced-document-split');
});
test('an API row without an exact annual twin stays held even next to a twin or one cent away',async t=>{
  const extra=await setup(t,url=>url.endsWith('.zip')?annual([full('COMBUSTÍVEIS','46.32','50.00','0','10','1')]):twinApi([{valorDocumento:50,valorGlosa:0,valorLiquido:-46.32,parcela:1},{valorDocumento:50,valorGlosa:0,valorLiquido:5.28,parcela:1}])(url));
  const cent=await setup(t,url=>url.endsWith('.zip')?annual([full('COMBUSTÍVEIS','50.00','50.00','0','10','0')]):twinApi([{valorDocumento:49.94,valorGlosa:0,valorLiquido:-49.94}])(url));
  for(const r of [extra,cent]){assert.equal(r.report.cells[0].status,'held-review');assert.deepEqual(r.report.cells[0].records,[]);assert.equal(r.report.totalCents,null);}
});
test('the audit rejects a twin batch whose published value follows the API sign',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual([housingAnnual('-12.47')]):housingApi(12.47)(url));
  assert.equal(r.report.cells[0].records[0].cents,-1247);
  r.report.cells[0].records[0].cents=1247;r.report.cells[0].totalCents=1247;r.report.totalCents=1247;r.report.contentSha256=expenseBatchContentId(r.report);
  assert.ok((await auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read)).failures.some(f=>f.code==='financial-records-coverage-or-union'));
});
const near=(face:number,net:number)=>({valorDocumento:face,valorGlosa:0,valorLiquido:net});
const nearAnnual=()=>annual([full('COMBUSTÍVEIS','100.00','100.00','0','10','0')]);
test('a difference of up to 5 cents between the API and the annual row of the same document keeps the annual value, with either sign',async t=>{
  for(const api of [near(99.95,-99.95),near(99.95,99.95),near(100.05,-100.05)]){
    const r=await setup(t,url=>url.endsWith('.zip')?nearAnnual():twinApi([api])(url));
    const c=r.report.cells[0];assert.equal(c.status,'complete');assert.equal(r.report.totalCents,10000);assert.equal(c.records[0].documentCents,10000);assert.equal(c.records[0].origin,'both');assert.equal(c.diagnostics?.apiCentsTolerated,1);assert.equal(c.diagnostics?.apiSignCorrected,undefined);
  }
});
test('a difference above 5 cents, or a tolerance with two API rows on the key, stays held',async t=>{
  const six=await setup(t,url=>url.endsWith('.zip')?nearAnnual():twinApi([near(99.94,-99.94)])(url));
  const two=await setup(t,url=>url.endsWith('.zip')?nearAnnual():twinApi([near(99.95,-99.95),near(99.97,-99.97)])(url));
  const other=await setup(t,url=>url.endsWith('.zip')?nearAnnual():twinApi([{...near(99.95,-99.95),numDocumento:'N2'}])(url));
  for(const r of [six,two,other]){assert.equal(r.report.cells[0].status,'held-review');assert.deepEqual(r.report.cells[0].records,[]);assert.equal(r.report.cells[0].diagnostics?.apiCentsTolerated,undefined);}
});
test('the audit rejects a tolerance batch whose published value follows the API',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?nearAnnual():twinApi([near(99.95,-99.95)])(url));
  r.report.cells[0].records[0].cents=9995;r.report.cells[0].totalCents=9995;r.report.totalCents=9995;r.report.contentSha256=expenseBatchContentId(r.report);
  assert.ok((await auditExpenseBatch(r.report,temporal,scope,hash('proposal'),r.read)).failures.some(f=>f.code==='financial-records-coverage-or-union'));
  const r2=await setup(t,url=>url.endsWith('.zip')?nearAnnual():twinApi([near(99.95,-99.95)])(url));
  delete r2.report.cells[0].diagnostics!.apiCentsTolerated;r2.report.contentSha256=expenseBatchContentId(r2.report);
  assert.ok((await auditExpenseBatch(r2.report,temporal,scope,hash('proposal'),r2.read)).failures.some(f=>f.code==='financial-records-coverage-or-union'));
});
test('several rows of one document with different faces pair by exact face first, with the right counters',async t=>{
  const hl=(net:string)=>housingAnnual(net),h2=housingAnnual('-30.00');
  const mk=(c:string,net:number,face?:number)=>({tipoDespesa:c,codDocumento:null,codLote:null,parcela:null,valorDocumento:face??Math.abs(net),valorGlosa:null,valorLiquido:net});
  const two=await setup(t,url=>url.endsWith('.zip')?annual([hl('-12.47'),h2]):twinApi([mk(housingCat,12.47),mk(housingCat,30)])(url));
  assert.equal(two.report.cells[0].status,'complete');assert.equal(two.report.totalCents,-4247);assert.equal(two.report.cells[0].diagnostics?.apiSignCorrected,2);assert.equal(two.report.cells[0].diagnostics?.apiCentsTolerated,undefined);
  const mixed=await setup(t,url=>url.endsWith('.zip')?annual([hl('-12.47'),h2]):twinApi([mk(housingCat,12.47),mk(housingCat,-30)])(url));
  assert.equal(mixed.report.cells[0].status,'complete');assert.equal(mixed.report.totalCents,-4247);assert.equal(mixed.report.cells[0].diagnostics?.apiSignCorrected,1);
  const air='LOCAÇÃO OU FRETAMENTO DE AERONAVES',item=(net:string)=>full(air,net,net,'0','10','0');
  const rental=await setup(t,url=>url.endsWith('.zip')?annual([item('150.00'),item('250.00')]):twinApi([{tipoDespesa:air,valorDocumento:150,valorGlosa:0,valorLiquido:-150},{tipoDespesa:air,valorDocumento:250,valorGlosa:0,valorLiquido:-250}])(url));
  assert.equal(rental.report.cells[0].status,'complete');assert.equal(rental.report.totalCents,40000);assert.equal(rental.report.cells[0].diagnostics?.apiSignCorrected,2);
});
const offAnnual=(net:string)=>annual([full('COMBUSTÍVEIS',net,'100.00','0','10','0')]);
test('an annual row whose document minus glosa is up to 5 cents from its net publishes the annual net, with either API sign',async t=>{
  for(const [net,api] of [['99.97',near(100,99.97)],['99.95',near(100,-99.95)],['100.05',near(100,100.05)]] as const){
    const r=await setup(t,url=>url.endsWith('.zip')?offAnnual(net):twinApi([api])(url));
    const c=r.report.cells[0],cents=Math.round(Number(net)*100);assert.equal(c.status,'complete');assert.deepEqual(c.reasons,[]);assert.equal(c.records.length,1);assert.equal(c.records[0].cents,cents);assert.equal(c.records[0].documentCents,10000);assert.equal(c.records[0].origin,'both');assert.equal(c.diagnostics?.annualCentsTolerated,1);assert.equal(c.diagnostics?.apiCentsTolerated,undefined);assert.equal(r.report.totalCents,cents);
  }
  const exact=await setup(t);assert.equal(exact.report.cells[0].diagnostics?.annualCentsTolerated,undefined);
});
test('an annual row or an API row 6 cents off its own equation, or an API-only row off by any amount, stays held',async t=>{
  const six=await setup(t,url=>url.endsWith('.zip')?offAnnual('99.94'):twinApi([near(100,99.94)])(url));
  const apiOnly=await setup(t,url=>url.endsWith('.zip')?annual():twinApi([{},{codDocumento:'12',tipoDespesa:'PASSAGEM AÉREA - SIGEPA',valorDocumento:3,valorLiquido:2.97}])(url));
  const annualAlone=await setup(t,url=>url.endsWith('.zip')?annual([full('TELEFONIA','99.94','100.00','0','0','0')]):twinApi([])(url));
  const apiAlone=await setup(t,url=>url.endsWith('.zip')?offAnnual('100.00'):twinApi([near(100.06,100)])(url));
  const tolerated=await setup(t,url=>url.endsWith('.zip')?offAnnual('99.97'):twinApi([near(100,99.97),{codDocumento:'12',tipoDespesa:'PASSAGEM AÉREA - SIGEPA',valorDocumento:3,valorLiquido:2.97}])(url));
  for(const r of [six,apiOnly,annualAlone,apiAlone,tolerated]){const c=r.report.cells[0];assert.equal(c.status,'held-review');assert.deepEqual(c.reasons,['financial-normalization-failed']);assert.deepEqual(c.records,[]);assert.equal(c.totalCents,null);assert.equal(c.diagnostics?.annualCentsTolerated,undefined);}
});
test('two rows on one document key whose API documents are 4 cents above their nets publish the exact annual values, with no counter',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual([full('COMBUSTÍVEIS','100.00','100.00','0','10','0'),full('COMBUSTÍVEIS','50.00','50.00','0','10','0')]):twinApi([near(100.04,100),near(50.04,50)])(url));
  const c=r.report.cells[0];assert.equal(c.status,'complete');assert.deepEqual(c.reasons,[]);assert.deepEqual(c.records.map(x=>[x.cents,x.documentCents,x.origin]).sort(),[[10000,10000,'both'],[5000,5000,'both']]);assert.equal(r.report.totalCents,15000);assert.equal(c.diagnostics?.annualCentsTolerated,undefined);assert.equal(c.diagnostics?.apiCentsTolerated,undefined);
});
test('the audit mirror recomputes the annual cents tolerance and rejects a batch that drops the count or publishes the document value',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?offAnnual('99.97'):twinApi([near(100,-99.97)])(url));
  assert.equal(r.report.cells[0].diagnostics?.annualCentsTolerated,1);assert.equal(r.report.cells[0].diagnostics?.apiSignCorrected,1);
  const audit=async(edit:(c:typeof r.report.cells[0])=>void)=>{const report=structuredClone(r.report);edit(report.cells[0]);report.totalCents=report.cells.reduce((n,c)=>n+(c.totalCents??0),0);report.contentSha256=expenseBatchContentId(report);return (await auditExpenseBatch(report,temporal,scope,hash('proposal'),r.read)).failures.map(f=>f.code);};
  assert.ok((await audit(c=>{delete c.diagnostics!.annualCentsTolerated;})).includes('financial-records-coverage-or-union'));
  assert.ok((await audit(c=>{c.records[0].cents=10000;c.totalCents=10000;})).includes('financial-records-coverage-or-union'));
});
