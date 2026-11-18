import test from 'node:test';
import assert from 'node:assert/strict';
import {rankingFieldsOf} from '../src/site-summary.ts';
import type {MonthSummary} from '../src/site-summary.ts';

// The rule real/app.js and real/data.js applied in the browser before the build published it.
function browserRule(months:MonthSummary[],coverageId:string|null,records:number,scopeMonths:number){
  const exercised=(m:MonthSummary)=>m.exercise!=='outside'||m.records>0;
  const noExercise=(()=>{if(!coverageId||records||months.some(m=>m.held))return false;return months.length>0&&months.every(m=>!m.exercise||['unknown','outside','conflict'].includes(m.exercise));})();
  const exercisedMonths=coverageId?months.filter(exercised).length:scopeMonths;
  const heldMonths=months.filter(m=>m.held).map(m=>m.month-1),min=Math.min(6,scopeMonths);
  return {exercisedMonths,noExercise,heldMonths,comparable:!noExercise&&!heldMonths.length&&!(exercisedMonths<min)};
}
const month=(n:number,exercise:string|null,records=0,held=false):MonthSummary=>({month:n,cents:0,records,exercise,partyStatus:'single',party:'X',partyValues:[],ufStatus:'single',uf:'SP',held});
const run=(months:MonthSummary[],coverageId:string|null,scopeMonths:number)=>{
  const records=months.reduce((n,m)=>n+m.records,0),got=rankingFieldsOf(months,coverageId,records,scopeMonths,Math.min(6,scopeMonths)),old=browserRule(months,coverageId,records,scopeMonths);
  assert.deepEqual({...got,heldMonths:got.heldMonths.map(m=>m-1)},old);
  return got;
};
const all=(n:number,exercise:string|null,records=0)=>Array.from({length:n},(_,i)=>month(i+1,exercise,records));

test('ranking fields match the old browser rule on every edge case',()=>{
  assert.equal(run(all(12,'in-office',1),'c',12).comparable,true);
  assert.equal(run(all(12,'outside'),'c',12).noExercise,true);
  assert.equal(run(all(12,'outside'),'c',12).comparable,false);
  assert.equal(run(all(12,'unknown'),'c',12).noExercise,true);
  assert.equal(run(all(12,null),'c',12).noExercise,true);
  assert.equal(run([],'c',12).noExercise,false);
  assert.equal(run([...all(11,'in-office',1),month(12,'in-office',0,true)],'c',12).comparable,false);
  assert.deepEqual(run([month(2,'in-office',0,true),...all(0,null)],'c',12).heldMonths,[2]);
  const five=[...all(5,'in-office',1),...Array.from({length:7},(_,i)=>month(i+6,'outside'))],six=[...all(6,'in-office',1),...Array.from({length:6},(_,i)=>month(i+7,'outside'))];
  assert.equal(run(five,'c',12).comparable,false);
  assert.equal(run(six,'c',12).comparable,true);
  assert.equal(run(six,'c',12).exercisedMonths,6);
  assert.equal(run([...all(5,'in-office',1),month(6,'outside',3)],'c',6).exercisedMonths,6);
  assert.equal(run([...all(3,'partial',1),...all(0,null)],'c',12).comparable,false);
  assert.equal(run(all(12,'partial',0),'c',12).comparable,true);
  assert.equal(run(all(12,'unknown',2),'c',12).noExercise,false);
  assert.equal(run(all(4,'in-office',1),'c',4).comparable,true);
  assert.equal(run([...all(3,'in-office',1),month(4,'outside')],'c',4).comparable,false);
  assert.equal(run([...all(2,'in-office',1),...all(0,null),month(3,'outside'),month(4,'outside')],'c',4).comparable,false);
  assert.equal(run(all(12,'outside'),null,12).comparable,true);
  assert.equal(run(all(12,'outside'),null,12).exercisedMonths,12);
  assert.equal(run(all(3,'in-office'),null,3).comparable,true);
});

test('a held month is never reported as no exercise, even with no records', ()=>{
  const held=[...all(11,'unknown'),month(12,'outside',0,true)];
  assert.equal(run(held,'c',12).noExercise,false);
  assert.deepEqual(run(held,'c',12).heldMonths,[12]);
});
