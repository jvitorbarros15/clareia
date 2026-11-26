import {redactCpf, scanCpfs} from './cpf-scan.ts';
import {COMPANY_NAME, canonical, cents, hash, validCnpj} from './model.ts';

export type CeapsContext = {
  year: number;
  lastModified?: string;
  etag?: string;
  approvedNames?: Set<string>;
};

export type SupplierKind = 'cnpj' | 'person' | 'kept-company' | 'withheld';

export type CeapsRecord = {
  id: number;
  year: number;
  month: number;
  codSenador: number;
  tipoDocumento: string;
  tipoDespesa: string | null;
  cents: number;
  date: string | null;
  supplier: string;
  supplierKind: SupplierKind;
  documento: string | null;
  source: {sha256: string; row: number};
  excludedFromTotals?: true;
  duplicateFlag?: 'possible';
};

export type CeapsReviewItem =
  | {kind: 'empty-type'; codSenador: number; month: number; cents: number; count: number}
  | {kind: 'kept-company' | 'withheld'; codSenador: number; month: number; id: number; name: string}
  | {kind: 'possible-duplicate'; codSenador: number; month: number; ids: number[]};

export type CeapsEvidence = {
  sha256: string;
  lastModified: string | null;
  etag: string | null;
  ids: number[];
};

export type CeapsParsed = {
  records: CeapsRecord[];
  review: CeapsReviewItem[];
  evidence: CeapsEvidence;
};

export type CeapsErrorCode =
  | 'json-invalid'
  | 'not-array'
  | 'missing-key'
  | 'unknown-key'
  | 'bad-type'
  | 'duplicate-id'
  | 'wrong-year'
  | 'bad-month'
  | 'bad-amount'
  | 'bad-date'
  | 'cpf-leak';

export class CeapsError extends Error {
  readonly code: CeapsErrorCode;
  readonly row?: number;
  constructor(code: CeapsErrorCode, row?: number) {
    super(row === undefined ? code : `${code} at row ${row}`);
    this.code = code;
    if (row !== undefined) this.row = row;
  }
}

const KEYS = [
  'id',
  'tipoDocumento',
  'ano',
  'mes',
  'codSenador',
  'nomeSenador',
  'tipoDespesa',
  'cpfCnpj',
  'fornecedor',
  'documento',
  'data',
  'detalhamento',
  'valorReembolsado',
] as const;

const KEY_SET = new Set<string>(KEYS);
const CNPJ_MASK = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
const MASKED_CPF = /^[\d*]{3}\.[\d*]{3}\.[\d*]{3}-[\d*]{2}$/;
const PERSON_LABEL = 'Fornecedor pessoa física';
const WITHHELD_LABEL = 'Nome não exibido pelo Clareia';

function validIsoDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // setUTCFullYear avoids the 0..99 -> 1900..1999 offset in Date.UTC for early years like 0204.
  const dt = new Date(0);
  dt.setUTCFullYear(year, month - 1, day);
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

export function parseCeapsYear(bytes: Uint8Array, ctx: CeapsContext): CeapsParsed {
  let raw: unknown;
  try {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    raw = JSON.parse(text);
  } catch {
    throw new CeapsError('json-invalid');
  }
  if (!Array.isArray(raw)) throw new CeapsError('not-array');

  const sha256 = hash(bytes);
  const seenIds = new Set<number>();
  const records: CeapsRecord[] = [];
  const nameReview: CeapsReviewItem[] = [];
  const emptyTypes = new Map<string, {codSenador: number; month: number; cents: number; count: number}>();
  const dupGroups = new Map<string, {codSenador: number; month: number; indices: number[]}>();

  for (let row = 0; row < raw.length; row++) {
    const item: unknown = raw[row];
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CeapsError('bad-type', row);
    const obj = item as Record<string, unknown>;
    for (const k of KEYS) {
      if (!Object.hasOwn(obj, k)) throw new CeapsError('missing-key', row);
    }
    for (const k of Object.keys(obj)) {
      if (!KEY_SET.has(k)) throw new CeapsError('unknown-key', row);
    }

    const id = obj.id;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || seenIds.has(id)) {
      throw new CeapsError('duplicate-id', row);
    }
    seenIds.add(id);

    const ano = obj.ano;
    const mes = obj.mes;
    const codSenador = obj.codSenador;
    const tipoDocumento = obj.tipoDocumento;
    const nomeSenador = obj.nomeSenador;
    const tipoDespesaRaw = obj.tipoDespesa;
    const cpfCnpjRaw = obj.cpfCnpj;
    const fornecedor = obj.fornecedor;
    const documentoRaw = obj.documento;
    const dataRaw = obj.data;
    const detalhamento = obj.detalhamento;
    const valorReembolsado = obj.valorReembolsado;

    if (
      typeof ano !== 'number' || !Number.isSafeInteger(ano) ||
      typeof mes !== 'number' || !Number.isSafeInteger(mes) ||
      typeof codSenador !== 'number' || !Number.isSafeInteger(codSenador) || codSenador < 1 ||
      typeof tipoDocumento !== 'string' ||
      typeof nomeSenador !== 'string' ||
      (tipoDespesaRaw !== null && typeof tipoDespesaRaw !== 'string') ||
      (cpfCnpjRaw !== null && typeof cpfCnpjRaw !== 'string') ||
      typeof fornecedor !== 'string' ||
      (documentoRaw !== null && typeof documentoRaw !== 'string') ||
      (dataRaw !== null && typeof dataRaw !== 'string') ||
      (detalhamento !== null && typeof detalhamento !== 'string')
    ) {
      throw new CeapsError('bad-type', row);
    }

    if (ano !== ctx.year) throw new CeapsError('wrong-year', row);
    if (mes < 1 || mes > 12) throw new CeapsError('bad-month', row);

    if (typeof valorReembolsado !== 'number' || !Number.isFinite(valorReembolsado)) {
      throw new CeapsError('bad-amount', row);
    }
    let amountCents: number;
    try {
      amountCents = cents(valorReembolsado);
    } catch {
      throw new CeapsError('bad-amount', row);
    }

    let date: string | null = null;
    if (dataRaw !== null && dataRaw.trim() !== '') {
      if (!validIsoDate(dataRaw)) throw new CeapsError('bad-date', row);
      date = dataRaw;
    }

    const emptyType = tipoDespesaRaw === null || tipoDespesaRaw.trim() === '';
    const tipoDespesa = emptyType ? null : tipoDespesaRaw;

    const trimmedId = (cpfCnpjRaw ?? '').trim();
    const digits = trimmedId.replace(/\D/g, '');
    let supplier: string;
    let supplierKind: SupplierKind;
    if (CNPJ_MASK.test(trimmedId) && validCnpj(digits)) {
      supplier = redactCpf(fornecedor);
      supplierKind = 'cnpj';
    } else if (digits.length === 11 || (MASKED_CPF.test(trimmedId) && trimmedId.includes('*'))) {
      supplier = PERSON_LABEL;
      supplierKind = 'person';
    } else {
      const redacted = redactCpf(fornecedor);
      if (COMPANY_NAME.test(redacted.toUpperCase()) || (ctx.approvedNames?.has(redacted) ?? false)) {
        supplier = redacted;
        supplierKind = 'kept-company';
      } else {
        supplier = WITHHELD_LABEL;
        supplierKind = 'withheld';
      }
      nameReview.push({kind: supplierKind, codSenador, month: mes, id, name: redacted});
    }

    const documento = documentoRaw === null ? null : redactCpf(documentoRaw);

    const record: CeapsRecord = {
      id,
      year: ano,
      month: mes,
      codSenador,
      tipoDocumento,
      tipoDespesa,
      cents: amountCents,
      date,
      supplier,
      supplierKind,
      documento,
      source: {sha256, row},
      ...(emptyType ? {excludedFromTotals: true as const} : {}),
    };
    records.push(record);

    if (emptyType) {
      const key = `${codSenador}:${mes}`;
      const agg = emptyTypes.get(key);
      if (agg) {
        agg.cents += amountCents;
        agg.count += 1;
      } else {
        emptyTypes.set(key, {codSenador, month: mes, cents: amountCents, count: 1});
      }
    }

    const dupKey = canonical([
      codSenador,
      ano,
      mes,
      tipoDespesaRaw,
      cpfCnpjRaw,
      fornecedor,
      documentoRaw,
      dataRaw,
      valorReembolsado,
    ]);
    const group = dupGroups.get(dupKey);
    if (group) {
      group.indices.push(row);
    } else {
      dupGroups.set(dupKey, {codSenador, month: mes, indices: [row]});
    }
  }

  const dupReview: CeapsReviewItem[] = [];
  for (const group of dupGroups.values()) {
    if (group.indices.length > 1) {
      const ids: number[] = [];
      for (const idx of group.indices) {
        records[idx].duplicateFlag = 'possible';
        ids.push(records[idx].id);
      }
      ids.sort((a, b) => a - b);
      dupReview.push({kind: 'possible-duplicate', codSenador: group.codSenador, month: group.month, ids});
    }
  }

  const emptyReview: CeapsReviewItem[] = [...emptyTypes.values()]
    .sort((a, b) => a.codSenador - b.codSenador || a.month - b.month)
    .map(e => ({kind: 'empty-type', codSenador: e.codSenador, month: e.month, cents: e.cents, count: e.count}));

  const result: CeapsParsed = {
    records,
    review: [...emptyReview, ...nameReview, ...dupReview],
    evidence: {
      sha256,
      lastModified: ctx.lastModified ?? null,
      etag: ctx.etag ?? null,
      ids: [...seenIds].sort((a, b) => a - b),
    },
  };

  if (scanCpfs(canonical(result), new Set()) !== 0) {
    throw new CeapsError('cpf-leak');
  }

  return result;
}
