import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {strToU8,zipSync} from 'fflate';
import {unionRecords,removedRecords,annualSnapshot,HeldPublication} from '../src/annual.ts';
import {csv} from '../src/queries.ts';
import type {Expense,Scope,Snapshot} from '../src/model.ts';

let n=0;
const record=(category:string,cents:number,documentId=String(++n),extra:Partial<Expense>={}):Expense=>({id:'r'+(++n),personId:1,year:2025,month:1,category,supplier:'Fornecedor',supplierKey:'k',supplierVerified:false,documentId,documentNumber:'N'+documentId,date:'2025-01-02T12:00:00',receipt:null,cents,documentCents:cents,disallowedCents:0,source:{url:'u',sha256:'s',row:0,fetchedAt:'t'},...extra});
const SIGEPA='PASSAGEM AÉREA - SIGEPA',PHONE='TELEFONIA',HOUSING='COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA';
const scope:Scope={year:2025,months:[1],ids:[1],legislature:57};

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
  assert.throws(()=>unionRecords([record(SIGEPA,100,'7',{lot:'1'})],[record(SIGEPA,100,'7',{lot:'2'})]),/divergem/);
});
test('a field left blank in both sources is not a conflict',()=>{
  assert.equal(unionRecords([record(SIGEPA,100,'7',{documentNumber:'Não informado'})],[record(SIGEPA,100,'7',{documentNumber:''})]).paired,1);
});
test('a published record absent from every current source is reported, counted per occurrence',()=>{
  const kept=record(SIGEPA,100,'5'),gone=record(HOUSING,-174700,'0');
  const previous={records:[kept,{...kept,id:'twin'},gone]} as Snapshot;
  const removed=removedRecords(previous,[kept],scope);
  assert.equal(removed.length,2);assert.ok(removed.includes(gone));
  assert.deepEqual(removedRecords({records:[kept]} as Snapshot,[kept],scope),[]);
});
test('a record outside the current scope is not reported as removed',()=>{
  const outside=[record(SIGEPA,100,'5',{month:2}),record(SIGEPA,100,'6',{personId:2}),record(SIGEPA,100,'7',{year:2024})];
  assert.deepEqual(removedRecords({records:outside} as Snapshot,[],scope),[]);
});
test('a record without a known origin leaves the CSV source column blank',()=>{
  assert.match(csv([record(SIGEPA,100,'5')]).split('\r\n')[1],/;""$/);
});
test('re-collecting the same content on another day from a repacked zip keeps the version id',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-annual-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const bytes=strToU8('ideCadastro;numAno;numMes;codLegislatura;txtDescricao;vlrLiquido;vlrDocumento;vlrGlosa;ideDocumento;txtFornecedor;txtCNPJCPF;urlDocumento;txtNumero;datEmissao;numLote\n1;2025;1;57;TELEFONIA;10.00;10.00;0;0;Fornecedor;;;N1;2025-01-02;1\n');
  let level:0|6=6;t.mock.method(globalThis,'fetch',async()=>new Response(zipSync({'Ano-2025.csv':bytes},{level}) as BodyInit));
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-05T12:00:00Z')});
  const api={id:'api',metric:'m',scope,people:[],records:[],collectedAt:'t',publishedAt:'t',pages:[],validation:{stablePasses:2,recordCount:0,totalCents:0,independentTotalCents:'0',duplicatePolicy:'',limitations:[]}} as Snapshot;
  const first=await annualSnapshot(api,directory);
  level=0;t.mock.timers.setTime(Date.parse('2026-11-06T12:00:00Z'));
  const second=await annualSnapshot(api,directory);
  assert.notEqual(first.collectedAt,second.collectedAt);assert.equal(first.id,second.id);
});
test('a record that vanished from every source raises a deliberate hold',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'clareia-annual-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const bytes=strToU8('ideCadastro;numAno;numMes;codLegislatura;txtDescricao;vlrLiquido;vlrDocumento;vlrGlosa;ideDocumento;txtFornecedor;txtCNPJCPF;urlDocumento;txtNumero;datEmissao;numLote\n1;2025;1;57;TELEFONIA;10.00;10.00;0;0;F;;;;2025-01-01;1\n');
  t.mock.method(globalThis,'fetch',async()=>new Response(zipSync({'Ano-2025.csv':bytes}) as BodyInit));
  const api={id:'api',metric:'m',scope,people:[],records:[],collectedAt:'t',publishedAt:'t',pages:[],validation:{stablePasses:2,recordCount:0,totalCents:0,independentTotalCents:'0',duplicatePolicy:'',limitations:[]}} as Snapshot;
  const first=await annualSnapshot(api,directory);
  const previous={...first,records:[...first.records,{...first.records[0],id:'gone',documentId:'9',cents:555}]};
  await assert.rejects(annualSnapshot(api,directory,previous),HeldPublication);
});
