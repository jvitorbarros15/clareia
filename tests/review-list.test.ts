import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSiteSummary} from '../src/site-summary.ts';
import {reviewMarkdown,ufReviewItems} from '../src/review-list.ts';
import type {Person} from '../src/model.ts';
import type {CoverageRow} from '../src/people-publication.ts';

const person=(id:number,uf:string|null,ufNote?:string):Person=>({id,name:'Pessoa '+id,photo:null,sourceUrl:'',profileFetchedAt:'2026-01-01T00:00:00Z',uf,ufNote,party:null});
const row=(personId:number,month:number,ufStatus:string,uf:string|null):CoverageRow=>({personId,year:2025,month,exercise:'full',partyStatus:'single',party:'PL',partyValues:[],ufStatus,uf,review:false,partialScope:false});
const people=[person(1,'SP'),person(2,'RS','UF do cadastro da Câmara'),person(3,null)];
const coverage=[
  ...[1,2,3].map(m=>row(1,m,'single','SP')),
  ...[1,2,3].map(m=>row(2,m,'unknown',null)),
  ...[1,2,3].map(m=>row(3,m,'unknown',null)),
];
const summary=buildSiteSummary({publicationId:'p',scope:{year:2025,months:[1,2,3],ids:[1,2,3],legislature:57} as never,people,records:[],expectedTotalCents:0,coverageId:'c',coverage});
const items=ufReviewItems(summary,people);

test('a deputy with a confirmed UF keeps it and is not listed',()=>{
  assert.deepEqual(items.map(i=>i.id),[2,3]);
});
test('an unconfirmed UF takes the registration UF, listed with its source',()=>{
  assert.deepEqual([items[0].used,items[0].from],['RS','cadastro']);
  assert.match(items[0].why,/unknown 3/);
});
test('with no UF anywhere the deputy has none and is listed for review',()=>{
  assert.equal(items[1].used,'sem UF confirmada');
  assert.match(reviewMarkdown('p',[items[1]]),/- 3 \| Pessoa 3 \| usada: sem UF confirmada/);
});
