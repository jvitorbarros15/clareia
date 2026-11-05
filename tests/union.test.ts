import test from 'node:test';
import assert from 'node:assert/strict';
import {unionRecords,removedRecords} from '../src/annual.ts';
import {csv} from '../src/queries.ts';
import type {Expense,Snapshot} from '../src/model.ts';

let n=0;
const record=(category:string,cents:number,documentId=String(++n),extra:Partial<Expense>={}):Expense=>({id:'r'+(++n),personId:1,year:2025,month:1,category,supplier:'Fornecedor',supplierKey:'k',supplierVerified:false,documentId,documentNumber:'N'+documentId,date:'2025-01-02T12:00:00',receipt:null,cents,documentCents:cents,disallowedCents:0,source:{url:'u',sha256:'s',row:0,fetchedAt:'t'},...extra});
const SIGEPA='PASSAGEM AÉREA - SIGEPA',PHONE='TELEFONIA',HOUSING='COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA';

test('pairs use annual values; each single-source record keeps its origin and the totals close in cents',()=>{
  const annual=[record('COMBUSTÍVEIS',1000,'1',{supplier:'Do arquivo'}),record(PHONE,50,'0'),record(HOUSING,-174700,'0')];
  const api=[record('COMBUSTÍVEIS',1000,'1',{supplier:'Da API'}),record(SIGEPA,146995,'300916')];
  const u=unionRecords(annual,api);
  assert.equal(u.records.length,4);assert.equal(u.paired,1);assert.equal(u.onlyAnnual,2);assert.equal(u.onlyApi,1);
  const paired=u.records.find(r=>r.origin==='both');assert.equal(paired?.supplier,'Do arquivo');
  assert.equal(u.originCents.both+u.originCents.annual+u.originCents.api,u.records.reduce((s,r)=>s+r.cents,0));assert.equal(u.originCents.annual,-174650);assert.equal(u.originCents.api,146995);
  assert.match(csv(u.records),/só na API/);assert.match(csv(u.records),/arquivo anual e API/);
});
test('repeated occurrences pair one to one; the surplus stays single-source',()=>{
  const u=unionRecords([record(SIGEPA,100,'9')],[record(SIGEPA,100,'9'),record(SIGEPA,100,'9')]);
  assert.equal(u.paired,1);assert.equal(u.onlyApi,1);
});
test('an unreviewed single-source type or a pair with conflicting fields holds publication',()=>{
  assert.throws(()=>unionRecords([],[record('COMBUSTÍVEIS',100)]),/API contém ocorrências não reconciliadas.*COMBUSTÍVEIS/);
  assert.throws(()=>unionRecords([record('COMBUSTÍVEIS',100)],[]),/tipos sem par/);
  assert.throws(()=>unionRecords([record(SIGEPA,100,'7')],[record(SIGEPA,100,'7',{documentNumber:'OUTRO'})]),/divergem/);
  assert.throws(()=>unionRecords([record(SIGEPA,100,'7')],[record(SIGEPA,100,'7',{date:'2025-02-02T12:00:00'})]),/divergem/);
});
test('a published record absent from every current source is reported, counted per occurrence',()=>{
  const kept=record(SIGEPA,100,'5'),gone=record(HOUSING,-174700,'0');
  const previous={records:[kept,{...kept,id:'twin'},gone]} as Snapshot;
  const removed=removedRecords(previous,[kept]);
  assert.equal(removed.length,2);assert.ok(removed.includes(gone));
  assert.deepEqual(removedRecords({records:[kept]} as Snapshot,[kept]),[]);
});
