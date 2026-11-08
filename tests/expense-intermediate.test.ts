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
import {collectExpenseBatch,expenseUrl,validateExpenseScope,expensePages} from '../src/expense-intermediate.ts';
import type {TemporalReport,MonthlyCoverage} from '../src/people-temporal.ts';
import {open} from '../src/vault.ts';
import {auditExpenseBatch} from '../src/expense-intermediate-audit.ts';

const scope={year:2025,months:[1,2],ids:[1,2],legislature:57};
const dimension={status:'single' as const,value:'SP',values:['SP'],rows:[0]};
const temporal={schema:'clareia.people-temporal.v1',ruleVersion:'camara.history-reported-change.v1',historySha256:hash('history'),scope:{legislature:57,start:'2025-01-01',end:'2025-12-31',sampleIds:[1]},createdAt:'2026-11-08T12:00:00Z',status:'review-required',publicAttributionEnabled:false,people:[1,2].map(id=>({id,collectionStatus:'stable',events:[],intervals:[],issues:[],months:[1,2].map<MonthlyCoverage>(month=>({year:2025,month,start:`2025-0${month}-01T00:00:00`,end:`2025-0${month+1}-01T00:00:00`,exercise:id===1?'full':'unknown',party:id===1?{...dimension,value:'A',values:['A']}:{status:'unknown',value:null,values:[],rows:[]},uf:dimension,partialScope:false,financialCollection:'not-collected'}))}))} as TemporalReport;
const contract={paths:{'/deputados/{id}/despesas':{get:{parameters:['ano','mes','idLegislatura','itens','pagina','ordem','ordenarPor'].map(name=>({name,in:'query'}))}}}};
const apiRow=(month=1,overrides:Record<string,unknown>={})=>({ano:2025,mes:month,codDocumento:'10',codLote:1,codTipoDocumento:1,parcela:0,numDocumento:'N1',numRessarcimento:'',tipoDespesa:'COMBUSTÍVEIS',tipoDocumento:'Recibos/Outros',nomeFornecedor:'Empresa',cnpjCpfFornecedor:'11222333000181',dataDocumento:'2025-01-02T00:00:00',urlDocumento:null,valorDocumento:10.21,valorGlosa:0,valorLiquido:10.21,...overrides});
const columns='ideCadastro;numAno;numMes;codLegislatura;txtDescricao;vlrLiquido;vlrDocumento;vlrGlosa;ideDocumento;txtFornecedor;txtCNPJCPF;urlDocumento;txtNumero;datEmissao;numLote';
const annualLine=(id=1,month=1,category='COMBUSTÍVEIS',amount='10.21',doc='10')=>`${id};2025;${month};57;${category};${amount};${amount};0;${doc};Empresa;11222333000181;;N1;2025-01-02T00:00:00;1`;
const annual=(lines=[annualLine()])=>zipSync({'Ano-2025.csv':strToU8(columns+'\n'+lines.join('\n')+'\n')});
async function setup(t:test.TestContext,reply?:(url:string,pass:number)=>unknown){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-expense-batch-')),key=randomBytes(32);t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const capture=(pass:number)=>new PeopleCapture(path.join(dir,'pass-'+pass),key,async url=>{
    const u=new URL(url),override=reply?.(url,pass);
    const value=override===undefined?u.pathname.endsWith('api-docs')?contract:u.pathname.endsWith('.zip')?annual():{dados:u.pathname.includes('/1/')&&u.searchParams.get('mes')==='1'?[apiRow()]:[],links:[{rel:'self',href:url}]}:override;
    return value instanceof Response?value:new Response(value instanceof Uint8Array?Buffer.from(value):JSON.stringify(value));
  },async()=>{});
  const one=capture(1),two=capture(2),report=await collectExpenseBatch(scope,temporal,hash('proposal'),one,two,{wait:async()=>{}});
  const read=async(s:{pass:number;file:string})=>open(await fs.readFile(path.join(dir,'pass-'+s.pass,s.file)),key);
  assert.equal((await auditExpenseBatch(report,temporal,scope,hash('proposal'),read)).status,'passed');
  return {dir,key,report,one,two,read};
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
test('an exactly full terminal page needs a preserved empty probe and remains independently auditable',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual(Array.from({length:25},(_,i)=>annualLine(1,1,'COMBUSTÍVEIS','10.21',String(10+i)))):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:new URL(url).searchParams.get('pagina')==='1'?Array.from({length:25},(_,i)=>apiRow(1,{codDocumento:String(10+i)})):[],links:[]}:undefined);
  assert.equal(r.report.cells[0].status,'complete');assert.equal(r.report.cells[0].api[1].pages.length,2);assert.equal(r.report.cells[0].api[1].count,25);assert.equal(r.report.totalCents,25525);
});
test('an extra next link after a declared full last page needs an empty successor with the same filters',async t=>{
  const r=await setup(t,url=>url.endsWith('.zip')?annual(Array.from({length:25},(_,i)=>annualLine(1,1,'COMBUSTÍVEIS','10.21',String(10+i)))):url.includes('/1/despesas')&&url.includes('mes=1&')?{dados:new URL(url).searchParams.get('pagina')==='1'?Array.from({length:25},(_,i)=>apiRow(1,{codDocumento:String(10+i)})):[],links:new URL(url).searchParams.get('pagina')==='1'&&new URL(url).searchParams.get('itens')==='25'?[{rel:'next',href:expenseUrl(scope,1,1,2,2)},{rel:'last',href:expenseUrl(scope,1,1,2)}]:[]}:undefined);
  assert.equal(r.report.cells[0].status,'complete');assert.equal(r.report.cells[0].api[1].pages.length,2);
});
test('resuming immutable captures performs no network and keeps the logical content version',async t=>{
  const r=await setup(t),capture=(pass:number)=>new PeopleCapture(path.join(r.dir,'pass-'+pass),r.key,async()=>{throw Error('network forbidden');},async()=>{});
  const resumed=await collectExpenseBatch(scope,temporal,hash('proposal'),capture(1),capture(2),{wait:async()=>{}});assert.equal(resumed.metrics.requests,0);assert.equal(resumed.contentSha256,r.report.contentSha256);assert.equal(resumed.cells[0].records.length,r.report.cells[0].records.length);assert.equal((await auditExpenseBatch(resumed,temporal,scope,hash('proposal'),r.read)).status,'passed');
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
  await fs.writeFile(path.join(root,'running.lock'),'keep');await assert.rejects(promisify(execFile)(process.execPath,args,{cwd}),e=>typeof e==='object'&&e!==null&&'stderr' in e&&String(e.stderr).includes('EEXIST'));assert.equal(await fs.readFile(path.join(root,'running.lock'),'utf8'),'keep');
});
