// Independent verifier for Senado CEAPS year parses. It re-reads the raw API
// bytes and implements JSON decoding, cents conversion, CNPJ validation,
// supplier classification and duplicate keying without importing src/model.ts
// or parser runtime code.
import {createHash} from 'node:crypto';
import {cpfRuns, redactCpf} from './cpf-scan.ts';
import type {CeapsContext, CeapsParsed, SupplierKind} from './senado-expenses.ts';

const CNPJ_MASK = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
const MASKED_CPF = /^[\d*]{3}\.[\d*]{3}\.[\d*]{3}-[\d*]{2}$/;
const COMPANY_PATTERN = /(?<![\p{L}\p{N}])(LTDA|S\.A|S\/A|EIRELI|EPP|COMPANHIA|LINHAS A[ÉE]REAS|AIRLINES|HOTEL|APARTMENTS|TELEF[ÔO]NICA|CELULAR FUNCIONAL)(?![\p{L}\p{N}])/u;
const PERSON_LABEL = 'Fornecedor pessoa física';
const WITHHELD_LABEL = 'Nome não exibido pelo Clareia';

function toCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const text = String(value);
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [integer, decimal = ''] = (negative ? text.slice(1) : text).split('.');
  const scaled = (BigInt(integer) * 100n + BigInt(decimal.padEnd(2, '0'))) * (negative ? -1n : 1n);
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER) || scaled < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(scaled);
}

function checkCpfDigits(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(digits[i]) * (size + 1 - i);
    const rest = (sum * 10) % 11;
    if ((rest === 10 ? 0 : rest) !== Number(digits[size])) return false;
  }
  return true;
}

function checkCnpjDigits(digits: string): boolean {
  if (!/^\d{14}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  if (digits.startsWith('000') && checkCpfDigits(digits.slice(3)) && !/^000\d{5}000[1-9]\d{2}$/.test(digits)) {
    return false;
  }
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const [idx, weights] of [[12, w1], [13, w2]] as const) {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += Number(digits[i]) * weights[i];
    const mod = sum % 11;
    if (Number(digits[idx]) !== (mod < 2 ? 0 : 11 - mod)) return false;
  }
  return true;
}

function classifySupplier(
  cpfCnpj: string | null,
  fornecedor: string,
  approvedNames?: Set<string>,
): {supplier: string; supplierKind: SupplierKind} {
  const trimmed = (cpfCnpj ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (CNPJ_MASK.test(trimmed) && checkCnpjDigits(digits)) {
    return {supplier: redactCpf(fornecedor), supplierKind: 'cnpj'};
  }
  if (digits.length === 11 || (MASKED_CPF.test(trimmed) && trimmed.includes('*'))) {
    return {supplier: PERSON_LABEL, supplierKind: 'person'};
  }
  const redacted = redactCpf(fornecedor);
  if (COMPANY_PATTERN.test(redacted.toUpperCase()) || (approvedNames?.has(redacted) ?? false)) {
    return {supplier: redacted, supplierKind: 'kept-company'};
  }
  return {supplier: WITHHELD_LABEL, supplierKind: 'withheld'};
}

function collectOutputText(value: unknown, strings: string[], keys: Set<string>): void {
  if (typeof value === 'string') {
    strings.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectOutputText(item, strings, keys);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      collectOutputText(v, strings, keys);
    }
  }
}

type ExpectedRow = {
  id: number;
  month: number;
  codSenador: number;
  cents: number;
  emptyType: boolean;
  supplier: string;
  supplierKind: SupplierKind;
  dupKey: string;
};

export function auditCeapsYear(
  bytes: Uint8Array,
  parsed: CeapsParsed,
  ctx: CeapsContext,
): {ok: boolean; failures: string[]} {
  const failures: string[] = [];
  const rawSha256 = createHash('sha256').update(bytes).digest('hex');

  if (parsed.evidence.sha256 !== rawSha256) failures.push('evidence-sha256');
  if (parsed.evidence.lastModified !== (ctx.lastModified ?? null)) failures.push('evidence-lastModified');
  if (parsed.evidence.etag !== (ctx.etag ?? null)) failures.push('evidence-etag');

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } catch {
    failures.push('raw-json-invalid');
    return {ok: false, failures};
  }
  if (!Array.isArray(raw)) {
    failures.push('raw-not-array');
    return {ok: false, failures};
  }

  const expected: ExpectedRow[] = [];
  const rawIds = new Set<number>();
  const expectedByMonth = new Map<number, bigint>();
  const expectedEmpty = new Map<string, {cents: bigint; count: number}>();
  const dupCounts = new Map<string, number>();
  const detalhamentos: string[] = [];
  const allowedLiterals = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      failures.push(`raw-row-invalid:${i}`);
      return {ok: false, failures};
    }
    const r = item as Record<string, unknown>;
    const id = r.id;
    const ano = r.ano;
    const mes = r.mes;
    const codSenador = r.codSenador;
    const tipoDespesa = r.tipoDespesa;
    const cpfCnpj = r.cpfCnpj;
    const fornecedor = r.fornecedor;
    const documento = r.documento;
    const data = r.data;
    const detalhamento = r.detalhamento;
    const amountCents = toCents(r.valorReembolsado);

    if (
      typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || rawIds.has(id) ||
      ano !== ctx.year ||
      typeof mes !== 'number' || !Number.isSafeInteger(mes) || mes < 1 || mes > 12 ||
      typeof codSenador !== 'number' || !Number.isSafeInteger(codSenador) || codSenador < 1 ||
      (tipoDespesa !== null && typeof tipoDespesa !== 'string') ||
      (cpfCnpj !== null && typeof cpfCnpj !== 'string') ||
      typeof fornecedor !== 'string' ||
      (documento !== null && typeof documento !== 'string') ||
      (data !== null && typeof data !== 'string') ||
      (detalhamento !== null && typeof detalhamento !== 'string') ||
      amountCents === null
    ) {
      failures.push(`raw-row-invalid:${i}`);
      return {ok: false, failures};
    }
    rawIds.add(id);

    const emptyType = tipoDespesa === null || tipoDespesa.trim() === '';
    const tipoNorm = emptyType ? null : tipoDespesa;
    const dateNorm = data === null || data.trim() === '' ? null : data;
    const trimmedId = (cpfCnpj ?? '').trim();
    const {supplier, supplierKind} = classifySupplier(cpfCnpj, fornecedor, ctx.approvedNames);
    const dupKey = JSON.stringify([codSenador, ano, mes, tipoNorm, trimmedId, fornecedor, documento, dateNorm, amountCents]);

    expected.push({id, month: mes, codSenador, cents: amountCents, emptyType, supplier, supplierKind, dupKey});
    expectedByMonth.set(mes, (expectedByMonth.get(mes) ?? 0n) + BigInt(amountCents));
    dupCounts.set(dupKey, (dupCounts.get(dupKey) ?? 0) + 1);

    if (emptyType) {
      const k = `${codSenador}:${mes}`;
      const agg = expectedEmpty.get(k);
      if (agg) {
        agg.cents += BigInt(amountCents);
        agg.count += 1;
      } else {
        expectedEmpty.set(k, {cents: BigInt(amountCents), count: 1});
      }
    }

    if (typeof r.tipoDocumento === 'string') allowedLiterals.add(r.tipoDocumento);
    if (tipoNorm) allowedLiterals.add(tipoNorm);
    if (documento) allowedLiterals.add(redactCpf(documento));
    if (dateNorm) allowedLiterals.add(dateNorm);
    allowedLiterals.add(supplier);
    if (detalhamento && detalhamento.trim() !== '') detalhamentos.push(detalhamento.trim());
  }

  if (parsed.records.length !== expected.length) failures.push('record-count');

  const expectedSortedIds = [...rawIds].sort((a, b) => a - b);
  if (
    parsed.evidence.ids.length !== expectedSortedIds.length ||
    parsed.evidence.ids.some((id, idx) => id !== expectedSortedIds[idx])
  ) {
    failures.push('evidence-ids');
  }

  const parsedById = new Map<number, (typeof parsed.records)[number]>();
  const parsedByMonth = new Map<number, bigint>();
  const parsedEmptyRecords = new Map<string, {cents: bigint; count: number}>();
  let badRecordSha = false;

  for (const rec of parsed.records) {
    if (rec.source?.sha256 !== rawSha256) badRecordSha = true;
    if (parsedById.has(rec.id)) {
      failures.push(`duplicate-parsed-id:${rec.id}`);
    } else {
      parsedById.set(rec.id, rec);
    }
    parsedByMonth.set(rec.month, (parsedByMonth.get(rec.month) ?? 0n) + BigInt(rec.cents));
    if (rec.excludedFromTotals) {
      const k = `${rec.codSenador}:${rec.month}`;
      const agg = parsedEmptyRecords.get(k);
      if (agg) {
        agg.cents += BigInt(rec.cents);
        agg.count += 1;
      } else {
        parsedEmptyRecords.set(k, {cents: BigInt(rec.cents), count: 1});
      }
    }
  }
  if (badRecordSha) failures.push('record-sha256');

  if (parsedById.size !== rawIds.size || [...parsedById.keys()].some(id => !rawIds.has(id))) {
    failures.push('record-ids');
  }

  const allMonths = new Set([...expectedByMonth.keys(), ...parsedByMonth.keys()]);
  for (const month of allMonths) {
    if ((expectedByMonth.get(month) ?? 0n) !== (parsedByMonth.get(month) ?? 0n)) {
      failures.push(`month-cents:${month}`);
    }
  }

  const parsedEmptyReview = new Map<string, {cents: bigint; count: number}>();
  for (const item of parsed.review) {
    if (item.kind !== 'empty-type') continue;
    const k = `${item.codSenador}:${item.month}`;
    if (parsedEmptyReview.has(k)) {
      failures.push(`empty-type-review-duplicate:${k}`);
    } else {
      parsedEmptyReview.set(k, {cents: BigInt(item.cents), count: item.count});
    }
  }

  const emptyKeys = new Set([...expectedEmpty.keys(), ...parsedEmptyRecords.keys(), ...parsedEmptyReview.keys()]);
  for (const k of emptyKeys) {
    const exp = expectedEmpty.get(k);
    const recAgg = parsedEmptyRecords.get(k);
    const revAgg = parsedEmptyReview.get(k);
    if (
      !exp || !recAgg || !revAgg ||
      exp.cents !== recAgg.cents || exp.count !== recAgg.count ||
      exp.cents !== revAgg.cents || exp.count !== revAgg.count
    ) {
      failures.push(`empty-type:${k}`);
    }
  }

  for (const exp of expected) {
    const rec = parsedById.get(exp.id);
    if (!rec) continue;
    if (rec.cents !== exp.cents) failures.push(`cents:${exp.id}`);
    if (rec.supplier !== exp.supplier || rec.supplierKind !== exp.supplierKind) {
      failures.push(`supplier:${exp.id}`);
    }
    const expectDup = (dupCounts.get(exp.dupKey) ?? 0) > 1;
    const actualDup = rec.duplicateFlag === 'possible';
    if (actualDup !== expectDup || (rec.duplicateFlag !== undefined && rec.duplicateFlag !== 'possible')) {
      failures.push(`duplicate-flag:${exp.id}`);
    }
    if (Boolean(rec.excludedFromTotals) !== exp.emptyType) {
      failures.push(`excluded-flag:${exp.id}`);
    }
  }

  const outJson = JSON.stringify(parsed);
  if (cpfRuns(outJson).length > 0) failures.push('cpf-run-in-output');

  const outStrings: string[] = [];
  const outKeys = new Set<string>();
  collectOutputText(parsed, outStrings, outKeys);
  if (outStrings.some(s => cpfRuns(s).length > 0) && !failures.includes('cpf-run-in-output')) {
    failures.push('cpf-run-in-output');
  }

  let leakedDetalhamento = outKeys.has('detalhamento');
  if (!leakedDetalhamento) {
    const normalizedOut = outStrings.map(s => s.replace(/\s+/g, ' '));
    for (const det of detalhamentos) {
      if (allowedLiterals.has(det)) continue;
      const detNorm = det.replace(/\s+/g, ' ');
      const lines = det.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length >= 12 && !allowedLiterals.has(l));
      if (
        outStrings.some(s => s.includes(det) || lines.some(l => s.includes(l))) ||
        normalizedOut.some(s => s.includes(detNorm))
      ) {
        leakedDetalhamento = true;
        break;
      }
    }
  }
  if (leakedDetalhamento) failures.push('detalhamento-in-output');

  return {ok: failures.length === 0, failures};
}
