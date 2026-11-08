import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {hash} from '../src/model.ts';
import type {Expense} from '../src/model.ts';
import {expenseBatchContentId} from '../src/expense-intermediate.ts';
import type {ExpenseBatch} from '../src/expense-intermediate.ts';
import {compareExpenseBatches} from '../src/expense-changes.ts';

const source={url:'https://www.camara.leg.br/cotas/Ano-2025.csv.zip',sha256:hash('zip'),file:hash('url')+'.sealed',bytes:10,fetchedAt:'2026-11-08T12:00:00Z',pass:1 as const};
const row=(id='row',cents=100):Expense=>({id:hash(id),personId:1,year:2025,month:1,category:'COMBUSTÍVEIS',supplier:'Empresa',supplierKey:hash('cnpj'),supplierVerified:true,documentId:'10',documentNumber:'N1',date:'2025-01-01T00:00:00',lot:'1',receipt:null,cents,documentCents:cents,disallowedCents:0,source:{...source,row:0},origin:'both'});
function refresh(r:ExpenseBatch):ExpenseBatch{
  for(const c of r.cells)c.totalCents=c.status==='complete'||c.status==='no-expenses-confirmed'?c.records.reduce((n,r)=>n+r.cents,0):null;
  r.totalCents=r.cells.every(c=>c.totalCents!==null)?r.cells.reduce((n,c)=>n+c.totalCents!,0):null;r.contentSha256=expenseBatchContentId(r);return r;
}
function batch():ExpenseBatch{
  const uf={status:'single' as const,value:'SP',values:['SP'],rows:[0]};
  return refresh({schema:'clareia.expense-intermediate.v1',equationRule:'camara.ceap.correlated-net.v1',equationDecisions:[],multiplicityRule:'camara.ceap.sigepa-annual-routes.v1',multiplicityDecisions:[],portalRule:'camara.ceap.sigepa-portal-ledger.v1',portalRequested:false,portalChecks:[],contentSha256:'',scope:{year:2025,legislature:57,ids:[1],months:[1,2]},peopleVersion:hash('people'),proposalSha256:hash('selection'),createdAt:'2026-11-08T12:00:00Z',status:'review-required',publicationEligible:false,annual:[{source,csvSha256:hash('csv'),scanned:1},{source:{...source,pass:2},csvSha256:hash('csv'),scanned:1}],cells:[1,2].map(month=>({personId:1,year:2025,month,status:month===1?'complete':'no-expenses-confirmed',reasons:[],api:[{count:month===1?1:0,pages:[]},{count:month===1?1:0,pages:[]}],annualCount:month===1?1:0,exercise:'full',party:uf,uf,totalCents:null,records:month===1?[row()]:[],diagnostics:{annualOnly:{},apiOnly:{}}})),sources:[source],totalCents:null,metrics:{elapsedMs:1,maxRssKiB:1,sourceBytes:10,requests:1,retries:0,cacheHits:0,downloadedBytes:10}});
}
test('a value change is separate removed/added evidence, not an inferred one-to-one correction',()=>{
  const before=batch(),after=batch();after.cells[0].records=[row('new',250)];refresh(after);const r=compareExpenseBatches(before,after);
  assert.equal(r.summary.financiallyChanged,1);assert.equal(r.summary.addedOccurrences,1);assert.equal(r.summary.removedOccurrences,1);assert.equal(r.summary.deltaCents,'150');assert.equal(r.cells[0].removed![0].unitCents,100);assert.equal(r.cells[0].added![0].unitCents,250);assert.equal(r.publicationEligible,false);assert.equal(r.status,'review-required');assert.ok(r.reasons.includes('financial-occurrences-changed'));
});
test('failure, held review and new complete coverage never masquerade as removals, additions or zero',()=>{
  for(const state of ['held-review','source-failure'] as const){const before=batch(),after=batch();after.cells[0].status=state;after.cells[0].records=[];after.cells[0].reasons=['source-unavailable'];refresh(after);
    for(const result of [compareExpenseBatches(before,after),compareExpenseBatches(after,before)]){assert.equal(result.summary.notComparable,1);assert.equal(result.summary.comparable,1);assert.equal(result.summary.addedOccurrences,0);assert.equal(result.summary.removedOccurrences,0);assert.equal(result.summary.deltaCents,null);assert.equal(result.cells[0].added,null);assert.equal(result.cells[0].removed,null);assert.equal(result.cells[0].deltaCents,null);assert.ok(result.reasons.includes('financial-coverage-incomplete'));}}
});
test('capture position, raw record IDs and timestamps do not manufacture a financial withdrawal',()=>{
  const before=batch(),after=batch();after.createdAt='2026-11-09T00:00:00Z';after.cells[0].records[0].id=hash('new raw representation');after.cells[0].records[0].source.row=9;after.cells[0].records[0].source.fetchedAt=after.createdAt;after.cells[0].party={...after.cells[0].party,rows:[9]};after.sources[0]={...after.sources[0],sha256:hash('reordered source')};refresh(after);
  const r=compareExpenseBatches(before,after);assert.equal(r.summary.financiallyChanged,0);assert.equal(r.summary.metadataChanged,0);assert.equal(r.summary.deltaCents,'0');assert.deepEqual(r.reasons,['source-evidence-changed']);
});
test('multiplicity, confirmed empty months and negative removals retain their exact arithmetic',()=>{
  const before=batch(),after=batch();before.cells[0].records=[row('one'),row('two'),row('negative',-50)];refresh(before);after.cells[0].records=[];after.cells[0].status='no-expenses-confirmed';refresh(after);
  const r=compareExpenseBatches(before,after);assert.equal(r.summary.removedOccurrences,3);assert.equal(r.cells[0].removed!.find(d=>d.unitCents===100)!.count,2);assert.equal(r.summary.deltaCents,'-150');assert.equal(r.cells[0].afterCents,'0');
  const onlyNegative=batch();onlyNegative.cells[0].records=[row('negative',-50)];refresh(onlyNegative);assert.equal(compareExpenseBatches(onlyNegative,after).summary.deltaCents,'50');
});
test('metadata, historical coverage, dependencies and rules are visible even without a money change',()=>{
  const before=batch(),after=batch();after.cells[0].records[0].supplier='Nome atualizado';after.cells[0].party={status:'unknown',value:null,values:[],rows:[]};after.peopleVersion=hash('new people');after.proposalSha256=hash('new proposal');after.portalRequested=true;refresh(after);
  const r=compareExpenseBatches(before,after);assert.equal(r.summary.deltaCents,'0');assert.equal(r.summary.metadataChanged,1);assert.equal(r.summary.coverageChanged,1);for(const reason of ['record-metadata-changed','coverage-changed','people-version-changed','selection-version-changed','rules-changed'])assert.ok(r.reasons.includes(reason));
});
test('different scopes, malformed coverage, duplicate IDs, tampered hashes and false totals are refused',()=>{
  const before=batch();for(const edit of [(r:ExpenseBatch)=>r.scope.months=[1],(r:ExpenseBatch)=>r.scope.ids=[2],(r:ExpenseBatch)=>r.cells.pop(),(r:ExpenseBatch)=>r.cells[0].records.push({...r.cells[0].records[0]}),(r:ExpenseBatch)=>r.cells[0].records[0].cents=Number.NaN]){const after=batch();edit(after);refresh(after);assert.throws(()=>compareExpenseBatches(before,after));}
  const wrong=batch();wrong.totalCents=999;wrong.contentSha256=expenseBatchContentId(wrong);assert.throws(()=>compareExpenseBatches(before,wrong));const tampered=batch();tampered.cells[0].records[0].cents++;assert.throws(()=>compareExpenseBatches(before,tampered));
  const reordered=batch();reordered.scope.months.reverse();reordered.cells.reverse();refresh(reordered);assert.equal(compareExpenseBatches(before,reordered).summary.deltaCents,'0');assert.equal(compareExpenseBatches(before,before).id,compareExpenseBatches(before,before).id);
  const otherLegislature=batch();otherLegislature.scope.legislature=58;refresh(otherLegislature);assert.throws(()=>compareExpenseBatches(before,otherLegislature),/Escopos diferentes/);
});
test('comparison CLI retains an existing lock and releases earlier locks when the second run is busy',async t=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-change-cli-'));t.after(()=>fs.rm(cwd,{recursive:true,force:true}));const root=path.join(cwd,'data/private/expense-intermediate'),keys=path.join(cwd,'data/private/people-discovery');await fs.mkdir(keys,{recursive:true});await fs.writeFile(path.join(keys,'local-vault-key'),randomBytes(32));for(const run of ['a','b'])await fs.mkdir(path.join(root,run),{recursive:true});await fs.writeFile(path.join(root,'b/running.lock'),'keep');
  const script=fileURLToPath(new URL('../scripts/compare-expense-intermediate.ts',import.meta.url)),args=['--import',import.meta.resolve('tsx'),script,'--local','--before-run','b','--before-version',hash('before'),'--after-run','a','--after-version',hash('after')];await assert.rejects(promisify(execFile)(process.execPath,args,{cwd}));assert.equal(await fs.readFile(path.join(root,'b/running.lock'),'utf8'),'keep');await assert.rejects(fs.stat(path.join(root,'a/running.lock')),{code:'ENOENT'});
  await assert.rejects(promisify(execFile)(process.execPath,args.map(v=>v===hash('before')?'../escape':v),{cwd}));await assert.rejects(fs.stat(path.join(root,'a/running.lock')),{code:'ENOENT'});
});
