import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSiteSummary} from '../src/site-summary.ts';
import {reviewMarkdown,ufReviewItems} from '../src/review-list.ts';
import type {Person} from '../src/model.ts';
import type {CoverageRow} from '../src/people-publication.ts';

const person=(id:number,uf:string|null):Person=>({id,name:'Pessoa '+id,photo:null,sourceUrl:'',profileFetchedAt:'2026-01-01T00:00:00Z',uf,party:null});
const row=(personId:number,month:number,ufStatus:string,uf:string|null):CoverageRow=>({personId,year:2025,month,exercise:'full',partyStatus:'single',party:'PL',partyValues:[],ufStatus,uf,review:false,partialScope:false});
const people=[person(1,'SP'),person(2,null),person(3,null)];
const coverage=[
  ...[1,2,3].map(m=>row(1,m,'single','SP')),
  row(2,1,'single','RJ'),row(2,2,'single','MG'),row(2,3,'review',null),
  ...[1,2,3].map(m=>row(3,m,'unknown',null)),
];
const summary=buildSiteSummary({publicationId:'p',scope:{year:2025,months:[1,2,3],ids:[1,2,3],legislature:57} as never,people,records:[],expectedTotalCents:0,coverageId:'c',coverage});

test('a deputy with a confirmed UF keeps it and is not listed',()=>{
  assert.equal(summary.people[0].ufLast,null);
  assert.deepEqual(ufReviewItems(summary,people).map(i=>i.id),[2,3]);
});
test('an unconfirmed UF falls back to the latest confirmed month and says which',()=>{
  assert.deepEqual(summary.people[1].ufLast,{uf:'MG',month:2,note:'UF de fev/2025 (última confirmada)'});
  const [item]=ufReviewItems(summary,people);
  assert.deepEqual([item.used,item.from],['MG','02/2025']);
  assert.match(item.why,/single 2, review 1/);
});
test('with no confirmed month there is no UF and the deputy is listed for review',()=>{
  assert.equal(summary.people[2].ufLast,null);
  const item=ufReviewItems(summary,people)[1];
  assert.equal(item.used,'sem UF confirmada');
  assert.match(reviewMarkdown('p',[item]),/- 3 \| Pessoa 3 \| usada: sem UF confirmada/);
});
