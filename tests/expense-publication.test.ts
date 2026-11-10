import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,hash,snapshotId} from '../src/model.ts';
import type {Expense} from '../src/model.ts';
import {buildExpenseVersion} from '../src/expense-publication.ts';
import type {ExpenseLotRun} from '../src/expense-publication.ts';

const history={people:[1,2,3].map(id=>({id,profile:{name:'Pessoa '+id,photo:null,source:{fetchedAt:'2026-11-07T00:00:00Z'}}}))} as any;
const temporal={historySha256:hash(canonical(history)),scope:{legislature:57},people:[1,2,3].map(id=>({id,months:[{year:2025,month:1,uf:{status:'single',value:'SP'},party:{status:'single',value:'X'}}]}))} as any;
const record=(personId:number,cents:number,i:number):Expense=>({id:`r${personId}-${i}`,personId,year:2025,month:1,category:'C',supplier:'S',supplierKey:'k',supplierVerified:false,documentId:'1',documentNumber:'1',date:null,receipt:null,cents,documentCents:cents,disallowedCents:0,source:{url:'https://www.camara.leg.br/cotas/Ano-2025.csv.zip',sha256:'s',row:i,fetchedAt:'2026-11-09T00:00:00Z'}});
const universe=[1,2,3];
function lot(n:number,ids:number[],cells:any[]):ExpenseLotRun{
  const proposal={schema:'clareia.expense-lot.v1',year:2025,months:[1],lot:n,lotSize:2,lots:2,universeSize:3,universeSha256:hash(canonical(universe)),people:ids.map(id=>({id})),temporalSha256:hash(canonical(temporal)),crosscheckSha256:'c'};
  const proposalSha256=hash(canonical(proposal)),input={schema:'clareia.expense-lot-input.v1',selectionRun:'s',proposal,temporal,originAudit:{}};
  const report={scope:{year:2025,months:[1],ids,legislature:57},proposalSha256,createdAt:`2026-11-09T0${n}:00:00Z`,contentSha256:'c'+n,cells} as any;
  const reportSha256=hash(canonical(report));
  return {runId:'run'+n,manifest:{runId:'run'+n,status:'review-required',reportSha256,proposalSha256,inputSha256:hash(canonical(input))},input:input as any,report,audit:{status:'passed',reportSha256,proposalSha256,checkedAt:'2026-11-09T10:00:00Z',competences:cells.length}};
}
const cell=(personId:number,status:string,records:Expense[]=[])=>({personId,year:2025,month:1,status,records,totalCents:status==='complete'||status==='no-expenses-confirmed'?records.reduce((n,r)=>n+r.cents,0):null});
const lots=()=>[lot(0,[1,2],[cell(1,'complete',[record(1,100,0),record(1,-30,1)]),cell(2,'held-review')]),lot(1,[3],[cell(3,'no-expenses-confirmed')])];

test('all audited lots of one universe become one version with held months counted',()=>{
  const v=buildExpenseVersion(lots(),history,'2026-11-09T12:00:00Z');
  assert.equal(v.id,snapshotId(v));
  assert.deepEqual(v.scope.ids,[1,2,3]);
  assert.equal(v.records.length,2);assert.equal(v.validation.totalCents,70);assert.equal(v.validation.independentTotalCents,'70');
  assert.deepEqual(v.validation.heldMonths,{2:1});
  assert.equal(v.validation.sourceKind,'annual-api-union');
  assert.deepEqual(v.people.map(p=>[p.name,p.uf,p.party]),[['Pessoa 1','SP','X'],['Pessoa 2','SP','X'],['Pessoa 3','SP','X']]);
  assert.equal(v.collectedAt,'2026-11-09T01:00:00Z');
});
test('the version id ignores lot order and publication time',()=>{
  const a=buildExpenseVersion(lots(),history,'2026-11-09T12:00:00Z'),b=buildExpenseVersion(lots().reverse(),history,'2026-11-10T12:00:00Z');
  assert.equal(a.id,b.id);
});
test('a missing or repeated lot is refused',()=>{
  assert.throws(()=>buildExpenseVersion([lots()[0]],history,'t'),/incompletos ou repetidos/);
  assert.throws(()=>buildExpenseVersion([lots()[0],lots()[0]],history,'t'),/incompletos ou repetidos/);
});
test('a lot without a passing audit of the same report is refused',()=>{
  const failed=lots();failed[1].audit.status='failed';
  assert.throws(()=>buildExpenseVersion(failed,history,'t'),/sem auditoria aprovada/);
  const changed=lots();changed[0].report.cells[0].records[0].cents=101;
  assert.throws(()=>buildExpenseVersion(changed,history,'t'),/sem auditoria aprovada/);
});
test('lots from another universe or with overlapping people are refused',()=>{
  const other=lots();other[1].input.proposal.universeSha256='x';
  assert.throws(()=>buildExpenseVersion(other,history,'t'));
  const overlap=[lots()[0],lot(1,[2],[cell(2,'no-expenses-confirmed')])];
  assert.throws(()=>buildExpenseVersion(overlap,history,'t'),/universo declarado/);
});
test('a held cell carrying records or a complete total that disagrees is refused',()=>{
  assert.throws(()=>buildExpenseVersion([lot(0,[1,2],[cell(1,'complete',[record(1,100,0)]),{...cell(2,'held-review'),records:[record(2,5,0)]}]),lots()[1]],history,'t'),/retida com registros/);
  assert.throws(()=>buildExpenseVersion([lot(0,[1,2],[{...cell(1,'complete',[record(1,100,0)]),totalCents:99},cell(2,'held-review')]),lots()[1]],history,'t'),/diverge das células/);
});
test('a history other than the one used in the collection is refused',()=>{
  assert.throws(()=>buildExpenseVersion(lots(),{people:[]} as any,'t'),/Histórico/);
});
