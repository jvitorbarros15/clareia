import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parseCeapsYear} from '../src/senado-expenses.ts';
import type {CeapsErrorCode, CeapsParsed} from '../src/senado-expenses.ts';
import {auditCeapsYear} from '../src/senado-expenses-audit.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'senado');
const API_BYTES = new Uint8Array(readFileSync(path.join(FIXTURES, 'ceaps-2025-api-sample.json')));
const LEGACY_CSV_BYTES = new Uint8Array(readFileSync(path.join(FIXTURES, 'ceaps-2025-sample.csv')));
const BASE_ROWS = JSON.parse(new TextDecoder('utf-8').decode(API_BYTES)) as Record<string, unknown>[];

const toBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const cloneRows = () => BASE_ROWS.map(r => ({...r}));

// Synthetic CPF with valid check digits, built here so no real number is ever written down.
function syntheticCpf(seed: number): string {
  const base = String(100000000 + seed * 7919).slice(0, 9);
  const digit = (size: number, d: string) => {
    const rest = ([...d].reduce((n, c, i) => n + Number(c) * (size + 1 - i), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = digit(9, base);
  return base + first + digit(10, base + first);
}

function assertCeapsError(fn: () => unknown, code: CeapsErrorCode, forbiddenValue?: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.equal((err as Error & {code?: string}).code, code);
    if (forbiddenValue !== undefined) {
      assert.equal(err.message.includes(forbiddenValue), false);
    }
    return true;
  });
}

test('parses the 16-row API contract fixture with expected amounts, exclusions, suppliers, privacy and duplicates', () => {
  const parsed = parseCeapsYear(API_BYTES, {year: 2025, lastModified: 'Thu, 26 Nov 2026 02:00:00 GMT', etag: '"v1"'});
  assert.equal(parsed.records.length, 16);

  const byId = new Map(parsed.records.map(r => [r.id, r]));

  assert.equal(byId.get(2303259)?.cents, -3095);
  assert.equal(byId.get(2248415)?.cents, 3);
  assert.equal(byId.get(2249005)?.cents, 21870);

  const emptyRow = byId.get(2248902)!;
  assert.equal(emptyRow.tipoDespesa, null);
  assert.equal(emptyRow.excludedFromTotals, true);
  assert.deepEqual(
    parsed.review.filter(r => r.kind === 'empty-type'),
    [{kind: 'empty-type', codSenador: 5967, month: 1, cents: 350000, count: 1}],
  );

  for (const id of [9000001, 9000002]) {
    assert.equal(byId.get(id)?.supplier, 'Fornecedor pessoa física');
    assert.equal(byId.get(id)?.supplierKind, 'person');
  }
  assert.equal(byId.get(9000002)?.date, '0204-02-16');
  assert.equal(byId.get(9000002)?.month, 2);

  for (const [id, name] of [
    [9000003, 'VOE DESTAK'],
    [2260975, 'Secretaria de Estado de Fazenda do Distrito Federal'],
  ] as const) {
    assert.equal(byId.get(id)?.supplier, 'Nome não exibido pelo Clareia');
    assert.equal(byId.get(id)?.supplierKind, 'withheld');
    assert.ok(parsed.review.some(r => r.kind === 'withheld' && r.id === id && r.name === name));
  }

  assert.equal(byId.get(9000004)?.supplier, 'FULANO DE TAL MEI [CPF omitido]');
  assert.equal(byId.get(9000004)?.supplierKind, 'cnpj');

  assert.equal(byId.get(2280903)?.supplier, 'VIVO TELEFONICA BRASIL S.A');
  assert.equal(byId.get(2280903)?.supplierKind, 'cnpj');

  const serialized = JSON.stringify(parsed);
  for (const forbidden of ['Check-In', 'Companhia Aérea', 'PASSAGEIROS', '000.***', 'ALAN RICK', 'Pessoa física']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }

  assert.equal(byId.get(2260975)?.duplicateFlag, 'possible');
  assert.equal(byId.get(2260976)?.duplicateFlag, 'possible');
  assert.deepEqual(
    parsed.review.filter(r => r.kind === 'possible-duplicate'),
    [{kind: 'possible-duplicate', codSenador: 6335, month: 7, ids: [2260975, 2260976]}],
  );

  const leaveRow = byId.get(2276647)!;
  assert.equal(leaveRow.codSenador, 5899);
  assert.equal(leaveRow.month, 9);
  assert.equal(leaveRow.excludedFromTotals, undefined);

  const expectedSha = createHash('sha256').update(API_BYTES).digest('hex');
  assert.equal(parsed.evidence.sha256, expectedSha);
  assert.equal(parsed.evidence.lastModified, 'Thu, 26 Nov 2026 02:00:00 GMT');
  assert.equal(parsed.evidence.etag, '"v1"');
  assert.deepEqual(
    parsed.evidence.ids,
    [...BASE_ROWS.map(r => Number(r.id))].sort((a, b) => a - b),
  );
  assert.equal(byId.get(9000001)?.source.sha256, expectedSha);
  assert.equal(byId.get(9000001)?.source.row, 0);
});

test('handles 9.99, 4000, approvedNames, COMPANY_NAME kept-company, 11-digit person and null/blank dates', () => {
  const rows = cloneRows().slice(0, 4);
  rows[0].valorReembolsado = 9.99;
  rows[0].cpfCnpj = syntheticCpf(5);
  rows[0].fornecedor = 'FULANO PESSOA FISICA';
  rows[0].data = '';

  rows[1].valorReembolsado = 4000;
  rows[1].cpfCnpj = '123456';
  rows[1].fornecedor = 'EMPRESA EXEMPLO LTDA';
  rows[1].data = null;

  rows[2].cpfCnpj = '1234567';
  rows[2].fornecedor = 'Secretaria Estadual Aprovada';

  rows[3].cpfCnpj = '';
  rows[3].fornecedor = 'NOME RETIDO';

  const bytes = toBytes(rows);
  const ctx = {year: 2025, approvedNames: new Set(['Secretaria Estadual Aprovada'])};
  const parsed = parseCeapsYear(bytes, ctx);

  assert.equal(parsed.records[0].cents, 999);
  assert.equal(parsed.records[0].supplier, 'Fornecedor pessoa física');
  assert.equal(parsed.records[0].supplierKind, 'person');
  assert.equal(parsed.records[0].date, null);
  assert.equal(JSON.stringify(parsed).includes('FULANO PESSOA FISICA'), false);

  assert.equal(parsed.records[1].cents, 400000);
  assert.equal(parsed.records[1].supplier, 'EMPRESA EXEMPLO LTDA');
  assert.equal(parsed.records[1].supplierKind, 'kept-company');
  assert.equal(parsed.records[1].date, null);

  assert.equal(parsed.records[2].supplier, 'Secretaria Estadual Aprovada');
  assert.equal(parsed.records[2].supplierKind, 'kept-company');

  assert.equal(parsed.records[3].supplier, 'Nome não exibido pelo Clareia');
  assert.equal(parsed.records[3].supplierKind, 'withheld');

  assert.equal(parsed.evidence.lastModified, null);
  assert.equal(parsed.evidence.etag, null);

  const audit = auditCeapsYear(bytes, parsed, ctx);
  assert.deepEqual(audit, {ok: true, failures: []});
});

test('refuses legacy CSV and truncated JSON with json-invalid', () => {
  assertCeapsError(() => parseCeapsYear(LEGACY_CSV_BYTES, {year: 2025}), 'json-invalid');
  assertCeapsError(() => parseCeapsYear(API_BYTES.slice(0, 40), {year: 2025}), 'json-invalid');
});

test('refuses non-array top-level JSON with not-array', () => {
  assertCeapsError(() => parseCeapsYear(toBytes({dados: BASE_ROWS}), {year: 2025}), 'not-array');
});

test('refuses object missing one of the 13 keys with missing-key', () => {
  const rows = cloneRows();
  delete rows[0].detalhamento;
  assertCeapsError(() => parseCeapsYear(toBytes(rows), {year: 2025}), 'missing-key');
});

test('refuses object with extra key with unknown-key', () => {
  const rows = cloneRows();
  rows[1].extra = 'valor-secreto';
  assertCeapsError(() => parseCeapsYear(toBytes(rows), {year: 2025}), 'unknown-key', 'valor-secreto');
});

test('refuses wrong field type with bad-type', () => {
  const rows = cloneRows();
  rows[2].fornecedor = 987654;
  assertCeapsError(() => parseCeapsYear(toBytes(rows), {year: 2025}), 'bad-type', '987654');
});

test('refuses repeated or non-positive-integer id with duplicate-id', () => {
  const dup = cloneRows();
  dup[1].id = dup[0].id;
  assertCeapsError(() => parseCeapsYear(toBytes(dup), {year: 2025}), 'duplicate-id', String(dup[0].id));

  const zero = cloneRows();
  zero[0].id = 0;
  assertCeapsError(() => parseCeapsYear(toBytes(zero), {year: 2025}), 'duplicate-id');

  const frac = cloneRows();
  frac[0].id = 12.5;
  assertCeapsError(() => parseCeapsYear(toBytes(frac), {year: 2025}), 'duplicate-id', '12.5');
});

test('refuses ano differing from ctx.year with wrong-year', () => {
  const rows = cloneRows();
  rows[0].ano = 2024;
  assertCeapsError(() => parseCeapsYear(toBytes(rows), {year: 2025}), 'wrong-year', '2024');
});

test('refuses mes outside 1..12 with bad-month', () => {
  const rows = cloneRows();
  rows[0].mes = 13;
  assertCeapsError(() => parseCeapsYear(toBytes(rows), {year: 2025}), 'bad-month', '13');
});

test('refuses non-number or >2-decimal amount with bad-amount', () => {
  const strAmt = cloneRows();
  strAmt[0].valorReembolsado = '3750.00';
  assertCeapsError(() => parseCeapsYear(toBytes(strAmt), {year: 2025}), 'bad-amount', '3750.00');

  const threeDec = cloneRows();
  threeDec[0].valorReembolsado = 10.123;
  assertCeapsError(() => parseCeapsYear(toBytes(threeDec), {year: 2025}), 'bad-amount', '10.123');
});

test('refuses malformed date with bad-date', () => {
  const rows = cloneRows();
  rows[0].data = '12/01/2025';
  assertCeapsError(() => parseCeapsYear(toBytes(rows), {year: 2025}), 'bad-date', '12/01/2025');
});

test('audit passes on clean parse and fails on tampering, CPF run or detalhamento leak', () => {
  const ctx = {year: 2025};
  const clean = parseCeapsYear(API_BYTES, ctx);
  assert.deepEqual(auditCeapsYear(API_BYTES, clean, ctx), {ok: true, failures: []});

  const cloneParsed = (): CeapsParsed => structuredClone(clean);

  const badCents = cloneParsed();
  badCents.records[0].cents += 1;
  assert.equal(auditCeapsYear(API_BYTES, badCents, ctx).ok, false);

  const badSupplier = cloneParsed();
  badSupplier.records[3].supplier = 'VOE DESTAK';
  assert.equal(auditCeapsYear(API_BYTES, badSupplier, ctx).ok, false);

  const badId = cloneParsed();
  badId.records[0].id = 9999999;
  assert.equal(auditCeapsYear(API_BYTES, badId, ctx).ok, false);

  const badDup = cloneParsed();
  delete badDup.records.find(r => r.id === 2260975)!.duplicateFlag;
  assert.equal(auditCeapsYear(API_BYTES, badDup, ctx).ok, false);

  const cpfLeak = cloneParsed();
  const cpf = syntheticCpf(7);
  cpfLeak.records[7].documento = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
  const cpfRes = auditCeapsYear(API_BYTES, cpfLeak, ctx);
  assert.equal(cpfRes.ok, false);
  assert.ok(cpfRes.failures.includes('cpf-run-in-output'));

  const detLeak = cloneParsed();
  detLeak.records[3].documento = String(BASE_ROWS[3].detalhamento);
  const detRes = auditCeapsYear(API_BYTES, detLeak, ctx);
  assert.equal(detRes.ok, false);
  assert.ok(detRes.failures.includes('detalhamento-in-output'));

  const multilineDetLeak = cloneParsed();
  multilineDetLeak.records[14].documento = String(BASE_ROWS[14].detalhamento);
  const multiRes = auditCeapsYear(API_BYTES, multilineDetLeak, ctx);
  assert.equal(multiRes.ok, false);
  assert.ok(multiRes.failures.includes('detalhamento-in-output'));

  const fracCents = cloneParsed();
  fracCents.records[0].cents = 999.5;
  const fracRes = auditCeapsYear(API_BYTES, fracCents, ctx);
  assert.equal(fracRes.ok, false);
  assert.ok(fracRes.failures.includes(`cents-invalid:${fracCents.records[0].id}`));

  const fracReview = cloneParsed();
  const emptyItem = fracReview.review.find(r => r.kind === 'empty-type');
  assert.ok(emptyItem && emptyItem.kind === 'empty-type');
  emptyItem.cents = 350000.5;
  const fracRevRes = auditCeapsYear(API_BYTES, fracReview, ctx);
  assert.equal(fracRevRes.ok, false);
  assert.ok(fracRevRes.failures.includes(`empty-type-review-cents-invalid:${emptyItem.codSenador}:${emptyItem.month}`));
});

test('distinguishes tipoDespesa null from empty string in duplicate key for both parser and audit', () => {
  const base = {...BASE_ROWS[1], tipoDespesa: null};
  const rows = [
    {...base, id: 2248902, tipoDespesa: null},
    {...base, id: 2248903, tipoDespesa: ''},
  ];
  const bytes = toBytes(rows);
  const ctx = {year: 2025};
  const parsed = parseCeapsYear(bytes, ctx);

  assert.equal(parsed.records[0].duplicateFlag, undefined);
  assert.equal(parsed.records[1].duplicateFlag, undefined);
  assert.deepEqual(parsed.review.filter(r => r.kind === 'possible-duplicate'), []);
  assert.deepEqual(auditCeapsYear(bytes, parsed, ctx), {ok: true, failures: []});

  const falselyFlagged = structuredClone(parsed);
  falselyFlagged.records[0].duplicateFlag = 'possible';
  falselyFlagged.records[1].duplicateFlag = 'possible';
  const audit = auditCeapsYear(bytes, falselyFlagged, ctx);
  assert.equal(audit.ok, false);
  assert.ok(audit.failures.includes('duplicate-flag:2248902'));
  assert.ok(audit.failures.includes('duplicate-flag:2248903'));
});

test('audit scopes detalhamento exemptions to expected fields and keeps legitimate substrings valid', () => {
  const ctx = {year: 2025};

  const rowsWithSupplierDet = cloneRows();
  rowsWithSupplierDet[0].detalhamento = 'VIVO TELEFONICA BRASIL S.A';
  const supplierDetBytes = toBytes(rowsWithSupplierDet);
  const cleanSupplierDet = parseCeapsYear(supplierDetBytes, ctx);
  assert.deepEqual(auditCeapsYear(supplierDetBytes, cleanSupplierDet, ctx), {ok: true, failures: []});

  const copiedDet = structuredClone(cleanSupplierDet);
  copiedDet.records[3].documento = 'VIVO TELEFONICA BRASIL S.A';
  const copiedRes = auditCeapsYear(supplierDetBytes, copiedDet, ctx);
  assert.equal(copiedRes.ok, false);
  assert.ok(copiedRes.failures.includes('detalhamento-in-output'));

  const rowsWithMeiDet = cloneRows();
  rowsWithMeiDet[0].detalhamento = 'MEI';
  const meiDetBytes = toBytes(rowsWithMeiDet);
  const cleanMeiDet = parseCeapsYear(meiDetBytes, ctx);
  assert.equal(cleanMeiDet.records.find(r => r.id === 9000004)?.supplier, 'FULANO DE TAL MEI [CPF omitido]');
  assert.deepEqual(auditCeapsYear(meiDetBytes, cleanMeiDet, ctx), {ok: true, failures: []});
});
