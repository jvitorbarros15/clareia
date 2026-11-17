import test from 'node:test';
import assert from 'node:assert/strict';
import {partyReviewItems,reviewMarkdown,ufReviewItems} from '../src/review-list.ts';
import type {Person} from '../src/model.ts';

const person=(id:number,uf:string|null,ufNote?:string):Person=>({id,name:'Pessoa '+id,photo:null,sourceUrl:'',profileFetchedAt:'2026-01-01T00:00:00Z',uf,ufNote,party:null});
const items=ufReviewItems([person(1,'SP'),person(2,'RS','UF dos eventos da legislatura'),person(3,null)]);

test('a confirmed UF is not listed; a fallback and a missing UF are, with their source',()=>{
  assert.deepEqual(items.map(i=>[i.id,i.used,i.from]),[[2,'RS','eventos da legislatura'],[3,'sem UF','sem UF confirmada']]);
  assert.match(reviewMarkdown('p',items),/- 3 \| Pessoa 3 \| usada: sem UF \| fonte: sem UF confirmada/);
});

test('a confirmed party is not listed; a fallback and a missing party are',()=>{
  const list=partyReviewItems([{...person(1,'SP'),party:'PL'},{...person(2,'SP'),party:'PP',partyNote:'partido dos eventos da legislatura'},{...person(3,'SP'),partyNote:'evento sem partido'},{...person(4,'SP'),party:'PL',partyNote:'partido registrado em fev/2023 (eventos da legislatura)'}]);
  assert.deepEqual(list.map(i=>[i.id,i.used,i.from]),[[2,'PP','partido dos eventos da legislatura'],[3,'sem partido','evento sem partido'],[4,'PL','partido registrado em fev/2023 (eventos da legislatura)']]);
  assert.match(reviewMarkdown('p',list,'partido'),/^# Pendências de partido - p/);
});
