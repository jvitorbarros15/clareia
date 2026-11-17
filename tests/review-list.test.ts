import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewMarkdown,ufReviewItems} from '../src/review-list.ts';
import type {Person} from '../src/model.ts';

const person=(id:number,uf:string|null,ufNote?:string):Person=>({id,name:'Pessoa '+id,photo:null,sourceUrl:'',profileFetchedAt:'2026-01-01T00:00:00Z',uf,ufNote,party:null});
const items=ufReviewItems([person(1,'SP'),person(2,'RS','UF dos eventos da legislatura'),person(3,null)]);

test('a confirmed UF is not listed; a fallback and a missing UF are, with their source',()=>{
  assert.deepEqual(items.map(i=>[i.id,i.used,i.from]),[[2,'RS','eventos L57'],[3,'sem UF','sem UF confirmada']]);
  assert.match(reviewMarkdown('p',items),/- 3 \| Pessoa 3 \| usada: sem UF \| fonte: sem UF confirmada/);
});
