import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../src/model.ts';
import {billAuthorsUrl,billsReport,billsUrl,deriveBills} from '../src/bills.ts';
import type {BillSource} from '../src/bills.ts';
import {auditBills} from '../src/bills-audit.ts';
import {sourceAllowed} from '../src/people-discovery.ts';

const head='"id";"siglaTipo";"numero";"ano";"ementa";"dataApresentacao";"urlInteiroTeor";"ultimoStatus_dataHora";"ultimoStatus_descricaoSituacao"';
const authorHead='"idProposicao";"idDeputadoAutor";"uriAutor";"ordemAssinatura";"proponente"';
const bill=(id:number,type='PL',date='2025-03-01T10:00')=>`"${id}";"${type}";"${id}";"2025";"Ementa ${id}";"${date}";"";"2025-04-01T10:00";"Aguardando Parecer"`;
const author=(bill:number,deputy:number,order:number,proponent:number)=>`"${bill}";"${deputy}";"https://dadosabertos.camara.leg.br/api/v2/deputados/${deputy}";"${order}";"${proponent}"`;
const csv=(header:string,lines:string[])=>new TextEncoder().encode([header,...lines].join('\n')+'\n');
const organ=(bill:number)=>`"${bill}";"";"https://dadosabertos.camara.leg.br/api/v2/orgaos/78";"1";"1"`;
const derive=(bills:string[],authors:string[])=>deriveBills(2025,csv(head,bills),csv(authorHead,authors));

test('proponent and co-signature come from the source flag, and signature order is not authorship',async()=>{
  const r=await derive([bill(1),bill(2)],[author(1,10,1,0),author(1,20,2,1),author(2,20,1,1)]);
  assert.deepEqual(r.people,[{id:10,proposed:0,coauthored:1},{id:20,proposed:2,coauthored:0}]);
});
test('only PL, PLP and PEC are selected and each bill counts once',async()=>{
  const r=await derive([bill(1),bill(2,'PLP'),bill(3,'PEC'),bill(4,'REQ')],[author(1,10,1,1),author(2,10,1,1),author(3,10,1,1),author(4,10,1,1)]);
  assert.equal(r.metrics.selected,3);assert.equal(r.metrics.propositions,4);assert.equal(r.people[0].proposed,3);
});
test('a bill whose presentation year differs, without authors or with repeated authors is held out of the counts',async()=>{
  const r=await derive([bill(1,'PL','2003-03-17T11:08'),bill(2),bill(3)],[author(1,10,1,1),author(3,10,1,1),author(3,10,2,1)]);
  assert.deepEqual(r.bills.map(b=>b.issues),[['year-date-mismatch'],['no-author-rows'],['repeated-author-row']]);assert.deepEqual(r.people,[]);assert.equal(r.metrics.held,3);
});
test('non-deputy authors do not become people and an author URI for another deputy is held',async()=>{
  const mismatch=`"2";"10";"https://dadosabertos.camara.leg.br/api/v2/deputados/99";"1";"1"`;
  const r=await derive([bill(1),bill(2)],[organ(1),mismatch]);
  assert.equal(r.bills[0].otherAuthors,1);assert.deepEqual(r.bills[0].issues,[]);assert.deepEqual(r.bills[1].issues,['author-identity-mismatch']);assert.deepEqual(r.people,[]);
});
test('a missing column stops the run',async()=>{
  await assert.rejects(deriveBills(2025,csv('"id";"siglaTipo"',[]),csv(authorHead,[])),/coluna ausente/);
});
test('author rows for a proposition absent from the file are measured, not counted',async()=>{
  const r=await derive([bill(1)],[author(1,10,1,1),author(999,10,1,1)]);assert.equal(r.metrics.orphanAuthorRows,1);assert.equal(r.people[0].proposed,1);
});
test('only the two official yearly files are allowed',()=>{
  assert.ok(sourceAllowed(billsUrl(2025)));assert.ok(sourceAllowed(billAuthorsUrl(2025)));
  assert.equal(sourceAllowed('https://dadosabertos.camara.leg.br/arquivos/proposicoes/csv/outro.csv'),false);
});
test('the audit recounts the preserved files and catches a changed count, bill or hold',async()=>{
  const bills=csv(head,[bill(1),bill(2,'PL','2003-01-01T00:00')]),authors=csv(authorHead,[author(1,10,1,1),author(2,10,1,1)]);
  const file=new Map<string,Uint8Array>([['b',bills],['a',authors]]),source=(url:string,name:string):BillSource=>({url,sha256:hash(file.get(name)!),file:name,bytes:file.get(name)!.length,fetchedAt:'2026-11-09T00:00:00Z',pass:2});
  const report=billsReport(2025,await deriveBills(2025,bills,authors),[source(billsUrl(2025),'b'),source(billAuthorsUrl(2025),'a')],'2026-11-09T00:00:00Z'),read=async(s:BillSource)=>file.get(s.file)!;
  assert.equal((await auditBills(report,read)).status,'passed');
  const edit=(change:(r:typeof report)=>void)=>{const copy=structuredClone(report);change(copy);return auditBills(copy,read);};
  assert.ok((await edit(r=>{r.people[0].proposed=9;})).failures.includes('person-counts'));
  assert.ok((await edit(r=>{r.bills[1].issues=[];})).failures.includes('issues-2'));
  assert.ok((await edit(r=>{r.bills[0].situation='Transformado em Norma Jurídica';})).failures.includes('fields-1'));
  assert.ok((await edit(r=>{r.publicationEligible=true as false;})).failures.includes('publication-gate'));
});
