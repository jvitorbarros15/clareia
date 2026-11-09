import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync} from 'fflate';
import {hash} from '../src/model.ts';
import {AMENDMENTS_URL,amendmentsReport,brlCents,deriveAmendments} from '../src/amendments.ts';
import type {AmendmentSource} from '../src/amendments.ts';
import {auditAmendments} from '../src/amendments-audit.ts';
import {sourceAllowed} from '../src/people-discovery.ts';

const head='"Localidade de aplicação do recurso";"Ano da Emenda";"Tipo de Emenda";"Código do Autor da Emenda";"Nome do Autor da Emenda";"Valor Empenhado";"Valor Liquidado";"Valor Pago";"Valor Restos A Pagar Inscritos";"Valor Restos A Pagar Cancelados";"Valor Restos A Pagar Pagos"';
const IND='Emenda Individual - Transferências Especiais';
const row=(year:number,type:string,code:string,name:string,committed='100,00',paid='40,50')=>`"SP";"${year}";"${type}";"${code}";"${name}";"${committed}";"0,00";"${paid}";"0,00";"0,00";"0,00"`;
const latin=(lines:string[])=>Uint8Array.from(Buffer.from([head,...lines].join('\n')+'\n','latin1'));
const people=[{id:1,name:'Ana Lúcia'},{id:2,name:'Bruno Reis'},{id:3,name:'Bruno Reis'}];

test('money is parsed to integer cents, including negative values',()=>{
  assert.equal(brlCents('1234,5'),123450);assert.equal(brlCents('-0,07'),-7);assert.equal(brlCents('10'),1000);assert.throws(()=>brlCents('1.000,00'));
});
test('measures stay separate per author and year and earlier years are left out',async()=>{
  const r=await deriveAmendments(latin([row(2024,IND,'10','ANA LÚCIA'),row(2024,IND,'10','ANA LÚCIA','50,25','0,00'),row(2025,IND,'10','ANA LÚCIA'),row(2020,IND,'10','ANA LÚCIA')]),2023,people);
  assert.deepEqual(r.authors[0].years['2024'],{rows:2,committed:15025,liquidated:0,paid:4050,carriedOver:0,carriedCancelled:0,carriedPaid:0,destinations:{SP:{rows:2,committed:15025,liquidated:0,paid:4050,carriedOver:0,carriedCancelled:0,carriedPaid:0}}});assert.equal(r.authors[0].years['2020'],undefined);assert.equal(r.metrics.selected,3);
});
test('only individual amendments reach an author; bench, committee, rapporteur and unknown authors stay apart',async()=>{
  const r=await deriveAmendments(latin([row(2024,'Emenda de Bancada','8100','BANCADA'),row(2024,'Emenda de Relator','8100','RELATOR'),row(2024,IND,'S/I','Sem informação'),row(2024,IND,'-99','Sem informação')]),2023,people);
  assert.deepEqual(r.authors,[]);assert.deepEqual(Object.keys(r.excluded),['Emenda de Bancada','Emenda de Relator','Emenda individual sem autor identificado']);assert.equal(r.metrics.unattributed,2);
});
test('a name match is only a proposal and a shared or missing name is not linked',async()=>{
  const r=await deriveAmendments(latin([row(2024,IND,'10','ANA LUCIA'),row(2024,IND,'11','BRUNO REIS'),row(2024,IND,'12','OUTRA PESSOA')]),2023,people);
  assert.deepEqual(r.links.map(l=>[l.status,l.candidates]),[['proposed',[1]],['ambiguous',[2,3]],['unmatched',[]]]);
});
test('one author code with two names is never proposed as a link, and a missing column stops the run',async()=>{
  const two=await deriveAmendments(latin([row(2024,IND,'10','ANA LÚCIA'),row(2024,IND,'10','OUTRA')]),2023,people);assert.deepEqual(two.links.map(l=>[l.status,l.candidates]),[['ambiguous',[]]]);assert.equal(two.authors[0].years['2024'].rows,2);
  await assert.rejects(deriveAmendments(Uint8Array.from(Buffer.from('"Ano da Emenda"\n"2024"\n','latin1')),2023,people),/coluna ausente/);
});
test('only the official CGU file is allowed',()=>{
  assert.ok(sourceAllowed(AMENDMENTS_URL));assert.equal(sourceAllowed('https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida/outro/x.zip'),false);
});
test('the audit recounts each measure and catches a changed value',async()=>{
  const csv=latin([row(2024,IND,'10','ANA LÚCIA'),row(2024,'Emenda de Bancada','8100','BANCADA')]),zip=zipSync({'EmendasParlamentares.csv':csv}),source:AmendmentSource={url:AMENDMENTS_URL,sha256:hash(zip),file:'z',bytes:zip.length,fetchedAt:'2026-11-09T00:00:00Z',pass:2};
  const report=amendmentsReport(2023,await deriveAmendments(csv,2023,people),[source],'2026-11-09T00:00:00Z'),read=async()=>zip;
  assert.deepEqual((await auditAmendments(report,read)).failures,[]);
  const copy=structuredClone(report);copy.authors[0].years['2024'].paid=1;assert.ok((await auditAmendments(copy,read)).failures.includes('totals'));
});
