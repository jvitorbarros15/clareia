import test from 'node:test';
import assert from 'node:assert/strict';
import {decimalCents,pairOccurrences} from '../src/reconcile.ts';
import type {Occurrence} from '../src/reconcile.ts';

const row=(o:Partial<Occurrence>={}):Occurrence=>({personId:1,month:1,documentId:'10',category:'TEST',cents:100n,number:'A',date:null,lot:'1',...o});

test('decimal parsing keeps sign and cents without floats',()=>{
  assert.equal(decimalCents('-1747'),-174700n);assert.equal(decimalCents('0.3'),30n);assert.equal(decimalCents('314,01'),31401n);
  assert.throws(()=>decimalCents('1.001'));assert.throws(()=>decimalCents(''));
});
test('annual-only occurrences are reported with their signed total and balance the sums',()=>{
  const phone=row({documentId:'0',number:'7894035',cents:31401n}),housing=row({documentId:'4294',cents:-174700n,number:''});
  const r=pairOccurrences([row(),phone,housing],[row()]);
  assert.equal(r.matched.length,1);assert.deepEqual(r.onlyAnnual,[phone,housing]);assert.equal(r.onlyApi.length,0);
  assert.equal(r.onlyAnnualCents,-143299n);assert.equal(r.annualCents-r.apiCents,-143299n);assert.equal(r.balanced,true);
});
test('multiplicity is respected: one API occurrence pairs with one annual occurrence only',()=>{
  const r=pairOccurrences([row(),row()],[row()]);assert.equal(r.matched.length,1);assert.equal(r.onlyAnnual.length,1);
  const s=pairOccurrences([row()],[row(),row()]);assert.equal(s.onlyApi.length,1);
});
test('a value or month difference is never paired; descriptive drift in a pair is flagged',()=>{
  const r=pairOccurrences([row({cents:101n})],[row()]);assert.equal(r.onlyAnnual.length,1);assert.equal(r.onlyApi.length,1);
  assert.equal(pairOccurrences([row({month:2})],[row()]).matched.length,0);
  assert.equal(pairOccurrences([row({number:'B'})],[row()]).fieldMismatches.length,1);
});
