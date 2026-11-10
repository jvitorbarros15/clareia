import test from 'node:test';
import assert from 'node:assert/strict';
import {compareMonth,drawCompetences} from '../src/expense-portal-sample.ts';
import {portalCategoryEmpty} from '../src/cota-portal.ts';
import type {Expense} from '../src/model.ts';

const html=(body:string)=>new TextEncoder().encode(`<!doctype html><html><body>${body}</body></html>`);
const skeleton=(rows:string,total:string)=>html(`<table class="tabela-2"><tr><th>Fornecedor</th></tr>${rows}<tr><td>Total</td><td id="totalFinalAnalitico">${total}</td></tr></table>`);

test('the draw is reproducible from the seed, unique and limited to the size',()=>{
  const all=Array.from({length:40},(_,i)=>({personId:100+(i%10),month:1+Math.floor(i/10)}));
  const a=drawCompetences(all,'semente-publica',30),b=drawCompetences([...all].reverse(),'semente-publica',30);
  assert.deepEqual(a,b);assert.equal(a.length,30);
  assert.equal(new Set(a.map(c=>c.personId+':'+c.month)).size,30);
  assert.notDeepEqual(drawCompetences(all,'outra',30),a);
  assert.equal(drawCompetences([...all,...all],'x',100).length,40);
  assert.throws(()=>drawCompetences(all,' ',3),/inválida/);assert.throws(()=>drawCompetences(all,'x',0),/inválida/);
});
test('a month matches only when the portal total equals the published cents exactly',()=>{
  const r=(cents:number,month=2)=>({personId:1,month,cents} as Expense),records=[r(100),r(-30),r(500,3)];
  assert.equal(compareMonth({personId:1,month:2},records,{total:70,rows:2}).status,'matched');
  assert.equal(compareMonth({personId:1,month:2},records,{total:71,rows:2}).status,'mismatch');
  assert.deepEqual(compareMonth({personId:1,month:2},records,null),{personId:1,month:2,oursCents:70,oursRecords:2,portalCents:null,portalRows:null,status:'portal-unavailable'});
});
test('an empty category is the table skeleton with no row and a blank total; anything else is not empty',()=>{
  assert.equal(portalCategoryEmpty(skeleton('','\n  ')),true);
  assert.equal(portalCategoryEmpty(skeleton('<tr><td id="analitico0">x</td></tr>','')),false);
  assert.equal(portalCategoryEmpty(skeleton('','R$ 1,00')),false);
  assert.equal(portalCategoryEmpty(html('<h1>JBWEB000064: Error report</h1>')),false);
  assert.equal(portalCategoryEmpty(html(`${'<table class="tabela-2"></table>'.repeat(2)}`)),false);
});
