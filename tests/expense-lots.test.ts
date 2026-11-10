import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,hash} from '../src/model.ts';
import {lotProposal,lotUniverse,selectLot} from '../src/expense-lots.ts';
import type {DiscoveryReport} from '../src/people-discovery.ts';
import type {TemporalReport} from '../src/people-temporal.ts';
import type {CrosscheckReport} from '../src/people-legacy.ts';

const months=(exercise:string,year=2025)=>Array.from({length:12},(_,i)=>({year,month:i+1,exercise}));
const temporal=(people:{id:number;months:{year:number;month:number;exercise:string}[]}[])=>({people}) as unknown as TemporalReport;
const discovery=(ids:number[],year=2025)=>({annuals:[{year,people:ids.map(id=>({id,months:[1],rows:1}))}]}) as unknown as DiscoveryReport;
const cross={people:[]} as unknown as CrosscheckReport;

test('the universe keeps anyone with a month of exercise and anyone named in the annual file, in id order',()=>{
  const t=temporal([{id:30,months:months('full')},{id:10,months:[...months('outside').slice(0,11),{year:2025,month:12,exercise:'partial'}]},{id:20,months:months('outside')},{id:40,months:months('unknown')},{id:50,months:months('outside')}]);
  assert.deepEqual(lotUniverse(t,discovery([50]),2025),[10,30,40,50]);
});
test('someone outside exercise all year with no annual expense stays out',()=>{
  assert.deepEqual(lotUniverse(temporal([{id:1,months:months('outside')},{id:2,months:months('full')}]),discovery([]),2025),[2]);
});
test('an annual expense for someone absent from the history is refused',()=>{
  assert.throws(()=>lotUniverse(temporal([{id:1,months:months('full')}]),discovery([9]),2025),/fora do histórico/);
});
test('a missing annual index is refused',()=>{
  assert.throws(()=>lotUniverse(temporal([{id:1,months:months('full')}]),discovery([],2024),2025),/Índice anual de 2025/);
});
test('lots split the universe without overlap or gaps, and an empty lot is refused',()=>{
  const universe=Array.from({length:7},(_,i)=>i+1);
  assert.deepEqual([0,1,2].flatMap(n=>selectLot(universe,n,3)),universe);
  assert.deepEqual(selectLot(universe,2,3),[7]);
  assert.throws(()=>selectLot(universe,3,3),/vazio/);
  for(const [lot,size] of [[-1,3],[0.5,3],[0,0],[0,101]])assert.throws(()=>selectLot(universe,lot,size),/inválido/);
});
test('the lot proposal has the shape the collector and audit read, and pins the universe',()=>{
  const t=temporal([{id:1,months:months('full')},{id:2,months:months('full')},{id:3,months:months('partial')}]),p=lotProposal(t,cross,discovery([]),2025,1,2);
  assert.deepEqual(p.people,[{id:3}]);
  assert.deepEqual(p.months,[1,2,3,4,5,6,7,8,9,10,11,12]);
  assert.equal(p.year,2025);assert.equal(p.lots,2);assert.equal(p.universeSize,3);
  assert.equal(p.universeSha256,hash(canonical([1,2,3])));
  assert.equal(p.temporalSha256,hash(canonical(t)));assert.equal(p.crosscheckSha256,hash(canonical(cross)));
});
