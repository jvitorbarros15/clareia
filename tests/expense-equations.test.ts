import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,hash} from '../src/model.ts';
import {equationKey,reviewExpenseEquations,reviewFlightMultiplicity} from '../src/expense-equations.ts';
import type {EquationInput} from '../src/expense-equations.ts';
import {independentEquationReview,independentFlightMultiplicity} from '../src/expense-equations-audit.ts';

const scope={year:2025,months:Array.from({length:12},(_,i)=>i+1),ids:[1,2],legislature:57};
function pair(month:number,net:string,parcel=0,document='10'):EquationInput[]{
  const source=(kind:string)=>({url:kind==='annual'?'https://www.camara.leg.br/cotas/Ano-2025.csv.zip':`https://dadosabertos.camara.leg.br/api/v2/deputados/1/despesas?mes=${month}`,sha256:hash(kind),row:month,fetchedAt:'2026-11-08T12:00:00Z'});
  return [{kind:'annual',personId:1,source:source('annual'),raw:{ideCadastro:'1',numAno:'2025',numMes:String(month),codLegislatura:'57',ideDocumento:document,txtDescricao:'CATEGORY',txtNumero:'N1',datEmissao:'2025-01-01',numLote:'1',vlrDocumento:'100',vlrGlosa:'0',vlrLiquido:net,numParcela:String(parcel)}},{kind:'api',personId:1,source:source('api'),raw:{ano:2025,mes:month,codDocumento:document,tipoDespesa:'CATEGORY',numDocumento:'N1',dataDocumento:'2025-01-01',codLote:1,valorDocumento:100,valorGlosa:0,valorLiquido:Number(net),parcela:parcel}}];
}
function review(inputs:EquationInput[],s=scope){
  const result=reviewExpenseEquations(s,inputs),other=independentEquationReview(s,inputs);
  assert.equal(canonical(result.decisions),canonical(other.decisions));assert.deepEqual([...result.permissions].sort(),[...other.permissions].sort());assert.equal(canonical(result.holds),canonical(other.holds));assert.deepEqual([...result.blockedKeys].sort(),[...other.blockedKeys].sort());return result;
}
test('a reported installment requires unique corroboration of every compared field and preserves the raw net',()=>{
  const rows=pair(1,'40',1),r=review(rows);assert.equal(r.permissions.size,2);assert.equal(r.permissions.get(equationKey(rows[0])),'reported-installment');assert.equal(rows[0].raw.vlrLiquido,'40');assert.equal(r.decisions[0].months[0],1);
  for(const field of ['valorDocumento','valorGlosa','valorLiquido','parcela','numDocumento','dataDocumento','codLote','tipoDespesa']){const changed=structuredClone(rows);changed[1].raw[field]=typeof changed[1].raw[field]==='number'?changed[1].raw[field]+1:'different';assert.equal(review(changed).permissions.size,0,field);}
});
test('unlabelled partial, negative or excessive amounts and source-only installments remain unexplained',()=>{
  for(const rows of [pair(1,'40'),pair(1,'-1',1),pair(1,'101',1),pair(1,'40',1).slice(0,1),pair(1,'40',1,'0'),pair(1,'40',1,'')])assert.equal(review(rows).permissions.size,0);
});
for(const [name,resolve] of [['collector',reviewExpenseEquations],['source verifier',independentEquationReview]] as const)test(`${name} rejects two reported installments of 60 against a document of 100`,()=>{
  const inputs=[...pair(1,'60',1),...pair(2,'60',2)];
  assert.equal(resolve(scope,inputs).permissions.size,0);
  assert.equal(resolve(scope,inputs).holds[0].reason,'over-document-limit');
});
test('a correct equation in each full-face installment cannot bypass the document ceiling',()=>{
  const result=review([...pair(1,'100',1),...pair(2,'100',2)]);assert.equal(result.blockedKeys.size,4);assert.equal(result.holds[0].reason,'over-document-limit');assert.deepEqual(result.holds[0].months,[1,2]);
});
test('installments use the whole document budget once, including glosa and other document members',()=>{
  for(const nets of [['60','40'],['60','39.99']]){const result=review([...pair(1,nets[0],1),...pair(2,nets[1],2)]);assert.equal(result.permissions.size,4);assert.equal(result.decisions[0].documentBudget?.faceCents,10000);assert.equal(result.decisions[0].documentBudget?.annualKeys.length,2);}
  const glosa=(net:string,month:number)=>pair(month,net,month).map(r=>{if(r.kind==='annual')r.raw.vlrGlosa='20';else r.raw.valorGlosa=20;return r;});
  assert.equal(review([...glosa('40',1),...glosa('40',2)]).permissions.size,4);assert.equal(review([...glosa('40',1),...glosa('40.01',2)]).permissions.size,0);
  for(const rows of [[...pair(1,'100'),...pair(2,'1',1)],[...pair(1,'60',1),...pair(2,'60',2),...pair(3,'-20')],[...pair(1,'40',1),...pair(2,'10',2).slice(0,1)]])assert.equal(review(rows).permissions.size,0);
});
test('ambiguous, missing or inconsistent members cannot authorize the remaining installment',()=>{
  for(const edit of [(r:EquationInput[])=>r.pop(),(r:EquationInput[])=>r.push(structuredClone(r[2]),structuredClone(r[3])),(r:EquationInput[])=>r[2].raw.vlrDocumento='',(r:EquationInput[])=>{r[2].raw.vlrDocumento='200';r[3].raw.valorDocumento=200;}]){const rows=[...pair(1,'40',1),...pair(2,'10',2)];edit(rows);assert.equal(review(rows).permissions.size,0);}
});
test('a split across competences closes once against the document face only in a complete-year cohort',()=>{
  const rows=[...pair(1,'40'),...pair(2,'60')],r=review(rows);assert.equal(r.permissions.size,4);assert.equal(r.decisions.length,1);assert.equal(r.decisions[0].basis,'balanced-document-split');assert.deepEqual(r.decisions[0].months,[1,2]);
  assert.equal(review(rows,{...scope,months:[1,2]}).permissions.size,0);assert.equal(review([...pair(1,'40'),...pair(2,'59')]).permissions.size,0);
});
test('a document shared by categories can close without attributing the full face to each occurrence',()=>{
  const rows=[...pair(1,'90'),...pair(1,'10')];rows[2].source.row=22;rows[3].source.row=22;rows[2].raw.txtDescricao='OTHER';rows[3].raw.tipoDespesa='OTHER';
  const r=review(rows);assert.equal(r.permissions.size,4);assert.equal(r.decisions[0].basis,'balanced-document-split');assert.equal(rows.reduce((n,r)=>n+Number(r.kind==='annual'?r.raw.vlrLiquido:0),0),100);
});
test('duplicate occurrence counts, missing counterpart, invalid group member or another person cannot manufacture a balanced split',()=>{
  const good=[...pair(1,'40'),...pair(2,'60')];
  const duplicated=[...good,structuredClone(good[0]),structuredClone(good[1])];assert.equal(review(duplicated).permissions.size,0);
  assert.equal(review(good.slice(0,3)).permissions.size,0);
  const invalid=[...good,...pair(3,'0')];invalid[4].raw.vlrDocumento='';assert.equal(review(invalid).permissions.size,0);
  const other=structuredClone(good);other[2].personId=2;other[2].raw.ideCadastro='2';other[3].personId=2;assert.equal(review(other).permissions.size,0);
  const falseIdentity=pair(1,'40',1);falseIdentity[0].raw.ideCadastro='2';assert.equal(review(falseIdentity).permissions.size,0);
});
function flights(){
  const rows=[...pair(1,'100'),...pair(1,'100')];for(const r of rows)if(r.kind==='api')r.raw.tipoDespesa='PASSAGEM AÉREA - SIGEPA';else r.raw.txtDescricao='PASSAGEM AÉREA - SIGEPA';
  rows[2].source.row=22;rows[3].source.row=22;rows[0].raw.txtTrecho='AAA/BBB';rows[2].raw.txtTrecho='BBB/AAA';return rows;
}
function multiplicity(rows:EquationInput[]){const r=reviewFlightMultiplicity(scope,rows),a=independentFlightMultiplicity(scope,rows);assert.equal(canonical(r.decisions),canonical(a.decisions));assert.deepEqual([...r.covered].sort(),[...a.covered].sort());return r;}
test('SIGEPA projection duplicates retain both occurrences when distinct annual routes corroborate the full financial signature',()=>{
  const r=multiplicity(flights());assert.equal(r.covered.size,2);assert.equal(r.decisions[0].count,2);assert.equal(r.decisions[0].distinctAnnualRoutes,2);assert.equal(JSON.stringify(r.decisions).includes('AAA'),false);
});
test('unmatched quantities, absent routes, cosmetic differences and extra annual differences do not resolve projected duplicates',()=>{
  const edits=[(r:EquationInput[])=>r.pop(),(r:EquationInput[])=>delete r[2].raw.txtTrecho,(r:EquationInput[])=>r[2].raw.txtTrecho=' aaa / bbb ',(r:EquationInput[])=>r[2].raw.txtFornecedor='different',(r:EquationInput[])=>r[2].raw.vlrLiquido='99'];
  for(const edit of edits){const rows=flights();edit(rows);assert.equal(multiplicity(rows).covered.size,0);}
  const other=flights();for(const r of other)if(r.kind==='api')r.raw.tipoDespesa='OTHER';else r.raw.txtDescricao='OTHER';assert.equal(multiplicity(other).covered.size,0);
});

test('a document over its ceiling is held whatever the parcela value',()=>{
  const r=review([...pair(1,'100'),...pair(2,'100')]);
  assert.equal(r.holds.length,1);assert.equal(r.holds[0].reason,'over-document-limit');assert.equal(r.blockedKeys.size,4);assert.equal(r.permissions.size,0);
});
test('installments on an unusable document number have no ceiling to confirm and are held',()=>{
  const r=review([...pair(1,'100',1,'0'),...pair(2,'100',2,'0')]);
  assert.equal(r.holds.length,1);assert.equal(r.holds[0].reason,'document-group-unconfirmed');assert.equal(r.blockedKeys.size,4);
});
test('one complete occurrence of a document is not held by the ceiling',()=>{
  const r=review(pair(1,'100'));assert.equal(r.holds.length,0);assert.equal(r.blockedKeys.size,0);
});
