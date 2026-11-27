import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {redactCpf, scanCpfs} from './cpf-scan.ts';
import {canonical, hash, readLimited} from './model.ts';
import {auditCeapsYear} from './senado-expenses-audit.ts';
import {CeapsError, parseCeapsYear} from './senado-expenses.ts';
import type {CeapsContext, CeapsErrorCode, CeapsParsed, CeapsRecord, CeapsReviewItem} from './senado-expenses.ts';
import {deriveSenatorCoverage} from './senate-coverage.ts';
import type {SenatorMonth} from './senate-coverage.ts';
import {open, seal} from './vault.ts';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type CaptureMeta = {
  url: string;
  sha256: string;
  bytes: number;
  fetchedAt: string;
  lastModified: string | null;
  etag: string | null;
};

export type SenadoPassInfo = {
  sha256: string;
  lastModified: string | null;
  etag: string | null;
};

export type SenadoAuditSummary = {
  ok: boolean;
  pass1: {ok: boolean; failures: string[]} | null;
  pass2: {ok: boolean; failures: string[]} | null;
};

export type SenadoCoverageSummary = {
  monthsByExercise: Record<SenatorMonth['exercise'], number>;
  issues: number;
};

export type SenadoRunStatus = 'review-required' | 'held' | 'failed';

export type SanitizedReviewItem =
  | {kind: 'empty-type'; codSenador: number; month: number; cents: number; count: number}
  | {kind: 'kept-company' | 'withheld'; codSenador: number; month: number; id: number}
  | {kind: 'possible-duplicate'; codSenador: number; month: number; ids: number[]};

export type SenadoCeapsSummary = {
  schema: 'clareia.senado-ceaps-run.v1';
  year: number;
  status: SenadoRunStatus;
  recordCount: number;
  previousRun: string | null;
  centsByMonth: Record<string, number>;
  emptyTypeRows: number;
  emptyTypeCentsByMonth: Record<string, number>;
  reviewCounts: {
    'empty-type': number;
    'kept-company': number;
    withheld: number;
    'possible-duplicate': number;
  };
  heldMonths: number[];
  independentPasses: boolean;
  passes: {
    pass1: SenadoPassInfo | null;
    pass2: SenadoPassInfo | null;
  };
  audit: SenadoAuditSummary;
  errorCode: CeapsErrorCode | null;
  coverage: SenadoCoverageSummary;
  mandatesMissing: number[];
};

export type CollectSenadoOptions = {
  year: number;
  runId: string;
  key: Buffer;
  baseDir?: string;
  previousRunId?: string;
  fetcher?: Fetcher;
  parse?: typeof parseCeapsYear;
  audit?: typeof auditCeapsYear;
};

export const RUN_ID_RE = /^[a-zA-Z0-9-]{1,80}$/;

const CEAPS_URL_RE = /^https:\/\/adm\.senado\.gov\.br\/adm-dadosabertos\/api\/v1\/senadores\/despesas_ceaps\/(2023|2024|2025|2026)$/;
const MANDATES_URL_RE = /^https:\/\/legis\.senado\.leg\.br\/dadosabertos\/senador\/([1-9]\d*)\/mandatos$/;
const CEAPS_MAX_BYTES = 100_000_000;
const MANDATES_MAX_BYTES = 12_000_000;

export function isAllowedSenadoUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.href !== url || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return false;
  }
  if (CEAPS_URL_RE.test(url)) return true;
  const match = MANDATES_URL_RE.exec(url);
  return match !== null && Number.isSafeInteger(Number(match[1]));
}

export function assertAllowedSenadoUrl(url: string): void {
  if (!isAllowedSenadoUrl(url)) {
    throw new Error('URL do Senado não permitida');
  }
}

export function ceapsYearUrl(year: number): string {
  if (!Number.isInteger(year)) {
    throw new Error('Ano inválido');
  }
  const url = `https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/${year}`;
  assertAllowedSenadoUrl(url);
  return url;
}

export function senatorMandatesUrl(codSenador: number): string {
  if (!Number.isSafeInteger(codSenador) || codSenador < 1) {
    throw new Error('Código de senador inválido');
  }
  const url = `https://legis.senado.leg.br/dadosabertos/senador/${codSenador}/mandatos`;
  assertAllowedSenadoUrl(url);
  return url;
}

async function isSameDirectory(a: string, b: string): Promise<boolean> {
  if (path.resolve(a) === path.resolve(b)) return true;
  try {
    const [realA, realB] = await Promise.all([fs.realpath(a), fs.realpath(b)]);
    if (realA === realB) return true;
    const [statA, statB] = await Promise.all([
      fs.stat(realA, {bigint: true}),
      fs.stat(realB, {bigint: true}),
    ]);
    return statA.ino !== 0n && statA.dev === statB.dev && statA.ino === statB.ino;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function readVerifiedCapture(
  sealedFile: string,
  metaFile: string,
  url: string,
  key: Buffer,
): Promise<{bytes: Uint8Array; meta: CaptureMeta}> {
  let meta: CaptureMeta;
  try {
    meta = JSON.parse(await fs.readFile(metaFile, 'utf8')) as CaptureMeta;
  } catch {
    throw new Error('Metadados de captura inválidos');
  }
  if (
    !meta ||
    typeof meta !== 'object' ||
    meta.url !== url ||
    typeof meta.sha256 !== 'string' ||
    typeof meta.bytes !== 'number' ||
    typeof meta.fetchedAt !== 'string' ||
    (meta.lastModified !== null && typeof meta.lastModified !== 'string') ||
    (meta.etag !== null && typeof meta.etag !== 'string')
  ) {
    throw new Error('Metadados de captura incompatíveis');
  }
  let plain: Uint8Array;
  try {
    plain = open(await fs.readFile(sealedFile), key);
  } catch {
    throw new Error('Captura preservada inválida ou adulterada');
  }
  if (hash(plain) !== meta.sha256 || plain.length !== meta.bytes) {
    throw new Error('Hash de captura preservada diverge');
  }
  return {bytes: plain, meta};
}

async function readSealedCapture(
  dir: string,
  url: string,
  key: Buffer,
): Promise<{bytes: Uint8Array; meta: CaptureMeta}> {
  assertAllowedSenadoUrl(url);
  if (key.length !== 32) throw new Error('Chave de cofre inválida');
  const stem = hash(url);
  return await readVerifiedCapture(
    path.join(dir, `${stem}.sealed`),
    path.join(dir, `${stem}.meta.json`),
    url,
    key,
  );
}

async function captureOrResume(
  dir: string,
  url: string,
  key: Buffer,
  fetcher: Fetcher,
  maxBytes: number,
  allowFetchFailure: boolean,
): Promise<{bytes: Uint8Array; meta: CaptureMeta} | null> {
  assertAllowedSenadoUrl(url);
  if (key.length !== 32) throw new Error('Chave de cofre inválida');
  await fs.mkdir(dir, {recursive: true});
  const stem = hash(url);
  const sealedFile = path.join(dir, `${stem}.sealed`);
  const metaFile = path.join(dir, `${stem}.meta.json`);
  const stagedSealedFile = path.join(dir, `${stem}.sealed.pending`);
  const stagedMetaFile = path.join(dir, `${stem}.meta.json.pending`);

  if (await fileExists(metaFile)) {
    return await readVerifiedCapture(sealedFile, metaFile, url, key);
  }

  if (await fileExists(sealedFile)) {
    if (await fileExists(stagedMetaFile)) {
      const recovered = await readVerifiedCapture(sealedFile, stagedMetaFile, url, key);
      await fs.unlink(stagedSealedFile).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err;
      });
      await fs.rename(stagedMetaFile, metaFile);
      return recovered;
    }
    throw new Error('Captura incompleta encontrada; não sobrescrever');
  }

  for (const stale of [stagedSealedFile, stagedMetaFile]) {
    await fs.unlink(stale).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err;
    });
  }

  assertAllowedSenadoUrl(url);
  let response: Response;
  let bytes: Uint8Array;
  try {
    response = await fetcher(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'clareia-senado-collect',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status !== 200) {
      if (allowFetchFailure) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    bytes = await readLimited(response, maxBytes);
  } catch (err) {
    if (allowFetchFailure) return null;
    throw err;
  }
  const meta: CaptureMeta = {
    url,
    sha256: hash(bytes),
    bytes: bytes.length,
    fetchedAt: new Date().toISOString(),
    lastModified: response.headers.get('last-modified'),
    etag: response.headers.get('etag'),
  };
  const encrypted = seal(bytes, key);
  // Stage both files before publishing either so an interrupted write never strands a partial original or missing metadata.
  try {
    await fs.writeFile(stagedSealedFile, encrypted, {flag: 'wx', mode: 0o600});
    await fs.writeFile(stagedMetaFile, JSON.stringify(meta, null, 2), {flag: 'wx', mode: 0o600});
    await fs.link(stagedSealedFile, sealedFile);
  } catch (err) {
    for (const staged of [stagedSealedFile, stagedMetaFile]) {
      await fs.unlink(staged).catch(() => {});
    }
    throw err;
  }
  await fs.unlink(stagedSealedFile);
  await fs.rename(stagedMetaFile, metaFile);
  return {bytes, meta};
}

function toCeapsContext(year: number, meta: CaptureMeta): CeapsContext {
  return {
    year,
    ...(meta.lastModified !== null ? {lastModified: meta.lastModified} : {}),
    ...(meta.etag !== null ? {etag: meta.etag} : {}),
  };
}

function toPassInfo(meta: CaptureMeta): SenadoPassInfo {
  return {
    sha256: meta.sha256,
    lastModified: meta.lastModified === null ? null : redactCpf(meta.lastModified),
    etag: meta.etag === null ? null : redactCpf(meta.etag),
  };
}

function emptyCoverage(): SenadoCoverageSummary {
  return {
    monthsByExercise: {full: 0, partial: 0, outside: 0, unknown: 0, conflict: 0},
    issues: 0,
  };
}

function emptyReviewCounts(): SenadoCeapsSummary['reviewCounts'] {
  return {
    'empty-type': 0,
    'kept-company': 0,
    withheld: 0,
    'possible-duplicate': 0,
  };
}

function recordContentKey(rec: CeapsRecord): string {
  const {source: _source, ...content} = rec;
  return canonical(content);
}

function indexRawById(bytes: Uint8Array): Map<number, Record<string, unknown>> {
  const rows = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)) as Record<string, unknown>[];
  const map = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    map.set(row.id as number, row);
  }
  return map;
}

function sanitizeReview(items: CeapsReviewItem[]): SanitizedReviewItem[] {
  return items.map((item): SanitizedReviewItem => {
    switch (item.kind) {
      case 'kept-company':
      case 'withheld':
        return {
          kind: item.kind,
          codSenador: item.codSenador,
          month: item.month,
          id: item.id,
        };
      case 'empty-type':
        return {
          kind: item.kind,
          codSenador: item.codSenador,
          month: item.month,
          cents: item.cents,
          count: item.count,
        };
      case 'possible-duplicate':
        return {
          kind: item.kind,
          codSenador: item.codSenador,
          month: item.month,
          ids: [...item.ids],
        };
    }
  });
}

function isValidMandateEnvelope(
  value: unknown,
  expectedCode: number,
): value is Parameters<typeof deriveSenatorCoverage>[0] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const mp = (value as Record<string, unknown>).MandatoParlamentar;
  if (!mp || typeof mp !== 'object' || Array.isArray(mp)) return false;
  const parl = (mp as Record<string, unknown>).Parlamentar;
  if (!parl || typeof parl !== 'object' || Array.isArray(parl)) return false;
  const p = parl as Record<string, unknown>;
  if ((typeof p.Codigo !== 'string' && typeof p.Codigo !== 'number') || Number(p.Codigo) !== expectedCode) {
    return false;
  }
  if (typeof p.Nome !== 'string') return false;
  const mandatos = p.Mandatos;
  if (!mandatos || typeof mandatos !== 'object' || Array.isArray(mandatos)) return false;
  const mandato = (mandatos as Record<string, unknown>).Mandato;
  if (mandato === undefined || mandato === null) return false;
  if (Array.isArray(mandato)) {
    return mandato.every(m => Boolean(m) && typeof m === 'object' && !Array.isArray(m));
  }
  return typeof mandato === 'object';
}

function auditFailureCodes(failures: string[]): string[] {
  return [...new Set(failures.map(f => f.split(':', 1)[0]))];
}

async function assertRunYear(runDir: string, year: number, url: string): Promise<void> {
  const summaryFile = path.join(runDir, 'summary.json');
  let rawSummary: string | null = null;
  try {
    rawSummary = await fs.readFile(summaryFile, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (rawSummary !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawSummary);
    } catch {
      throw new Error('Resumo preservado inválido');
    }
    if (!parsed || typeof parsed !== 'object' || (parsed as {year?: unknown}).year !== year) {
      throw new Error('Run ID já vinculado a outro ano');
    }
  }

  const expectedPrefix = `${hash(url)}.`;
  for (const sub of ['pass-1', 'pass-2']) {
    let entries: string[];
    try {
      entries = await fs.readdir(path.join(runDir, sub));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    if (entries.some(name => !name.startsWith(expectedPrefix))) {
      throw new Error('Run ID já vinculado a outro ano');
    }
  }
}

async function writeDerivedFiles(
  runDir: string,
  files: Array<{name: string; text: string}>,
  removeNames: string[] = [],
): Promise<void> {
  for (const file of files) {
    if (scanCpfs(file.text, new Set()) !== 0) {
      throw new Error(`CPF detectado em arquivo derivado: ${file.name}`);
    }
  }
  const ordered = [
    ...files.filter(f => f.name !== 'summary.json'),
    ...files.filter(f => f.name === 'summary.json'),
  ];
  const token = randomBytes(6).toString('hex');
  const staged: Array<{tmp: string; dest: string}> = [];
  try {
    for (const file of ordered) {
      const dest = path.join(runDir, file.name);
      const tmp = path.join(runDir, `.${file.name}.${token}.tmp`);
      staged.push({tmp, dest});
      await fs.writeFile(tmp, file.text, {mode: 0o600});
    }
    for (const name of removeNames) {
      await fs.unlink(path.join(runDir, name)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== 'ENOENT') throw err;
      });
    }
    for (const {tmp, dest} of staged) {
      await fs.rename(tmp, dest);
    }
  } catch (err) {
    for (const {tmp} of staged) {
      await fs.unlink(tmp).catch(() => {});
    }
    throw err;
  }
}

async function failRun(
  runDir: string,
  year: number,
  previousRun: string | null,
  passes: SenadoCeapsSummary['passes'],
  audit: SenadoAuditSummary,
  errorCode: CeapsErrorCode | null,
): Promise<SenadoCeapsSummary> {
  const summary: SenadoCeapsSummary = {
    schema: 'clareia.senado-ceaps-run.v1',
    year,
    status: 'failed',
    recordCount: 0,
    previousRun,
    centsByMonth: {},
    emptyTypeRows: 0,
    emptyTypeCentsByMonth: {},
    reviewCounts: emptyReviewCounts(),
    heldMonths: [],
    independentPasses:
      passes.pass1 !== null && passes.pass2 !== null && passes.pass1.sha256 !== passes.pass2.sha256,
    passes,
    audit,
    errorCode,
    coverage: emptyCoverage(),
    mandatesMissing: [],
  };
  await writeDerivedFiles(
    runDir,
    [{name: 'summary.json', text: canonical(summary)}],
    ['records.json', 'review.json'],
  );
  return summary;
}

export async function collectSenadoExpenses(options: CollectSenadoOptions): Promise<SenadoCeapsSummary> {
  const {year, runId, key, previousRunId} = options;
  if (!RUN_ID_RE.test(runId)) throw new Error('Run ID inválido');
  if (previousRunId !== undefined && !RUN_ID_RE.test(previousRunId)) {
    throw new Error('Previous run ID inválido');
  }
  if (key.length !== 32) throw new Error('Chave de cofre inválida');

  const url = ceapsYearUrl(year);
  const baseDir = options.baseDir ?? path.resolve('data/private/senado-expenses');
  const runDir = path.join(baseDir, runId);
  const fetcher = options.fetcher ?? fetch;
  const parse = options.parse ?? parseCeapsYear;
  const audit = options.audit ?? auditCeapsYear;
  const previousRun = previousRunId ?? null;

  if (previousRunId !== undefined && (await isSameDirectory(runDir, path.join(baseDir, previousRunId)))) {
    throw new Error('Previous run não pode apontar para o mesmo diretório da execução atual');
  }

  await assertRunYear(runDir, year, url);

  let prevParsed: CeapsParsed | null = null;
  let prevRawById: Map<number, Record<string, unknown>> | null = null;
  if (previousRunId !== undefined) {
    const prevCap = await readSealedCapture(path.join(baseDir, previousRunId, 'pass-1'), url, key);
    try {
      prevParsed = parseCeapsYear(prevCap.bytes, toCeapsContext(year, prevCap.meta));
    } catch (err) {
      if (err instanceof CeapsError) {
        await fs.mkdir(runDir, {recursive: true});
        return await failRun(
          runDir,
          year,
          previousRun,
          {pass1: null, pass2: null},
          {ok: false, pass1: null, pass2: null},
          err.code,
        );
      }
      throw err;
    }
    prevRawById = indexRawById(prevCap.bytes);
  }

  await fs.mkdir(runDir, {recursive: true});

  const cap1 = (await captureOrResume(path.join(runDir, 'pass-1'), url, key, fetcher, CEAPS_MAX_BYTES, false))!;
  const ctx1 = toCeapsContext(year, cap1.meta);
  let parsed1: CeapsParsed;
  try {
    parsed1 = parse(cap1.bytes, ctx1);
  } catch (err) {
    if (err instanceof CeapsError) {
      return await failRun(
        runDir,
        year,
        previousRun,
        {pass1: toPassInfo(cap1.meta), pass2: null},
        {ok: false, pass1: null, pass2: null},
        err.code,
      );
    }
    throw err;
  }

  const cap2 = (await captureOrResume(path.join(runDir, 'pass-2'), url, key, fetcher, CEAPS_MAX_BYTES, false))!;
  const ctx2 = toCeapsContext(year, cap2.meta);
  let parsed2: CeapsParsed;
  try {
    parsed2 = parse(cap2.bytes, ctx2);
  } catch (err) {
    if (err instanceof CeapsError) {
      return await failRun(
        runDir,
        year,
        previousRun,
        {pass1: toPassInfo(cap1.meta), pass2: toPassInfo(cap2.meta)},
        {ok: false, pass1: null, pass2: null},
        err.code,
      );
    }
    throw err;
  }

  const audit1 = audit(cap1.bytes, parsed1, ctx1);
  const audit2 = audit(cap2.bytes, parsed2, ctx2);
  const auditSummary: SenadoAuditSummary = {
    ok: audit1.ok && audit2.ok,
    pass1: {ok: audit1.ok, failures: auditFailureCodes(audit1.failures)},
    pass2: {ok: audit2.ok, failures: auditFailureCodes(audit2.failures)},
  };
  if (!auditSummary.ok) {
    return await failRun(
      runDir,
      year,
      previousRun,
      {pass1: toPassInfo(cap1.meta), pass2: toPassInfo(cap2.meta)},
      auditSummary,
      null,
    );
  }

  const pass1ById = new Map<number, CeapsRecord>(parsed1.records.map(r => [r.id, r]));
  const pass2ById = new Map<number, CeapsRecord>(parsed2.records.map(r => [r.id, r]));
  const raw1ById = indexRawById(cap1.bytes);
  const raw2ById = indexRawById(cap2.bytes);

  const heldSet = new Set<number>();
  const allPassIds = new Set<number>([...pass1ById.keys(), ...pass2ById.keys()]);
  for (const id of allPassIds) {
    const r1 = pass1ById.get(id);
    const r2 = pass2ById.get(id);
    if (!r1) {
      heldSet.add(r2!.month);
    } else if (!r2) {
      heldSet.add(r1.month);
    } else if (
      recordContentKey(r1) !== recordContentKey(r2) ||
      canonical(raw1ById.get(id)) !== canonical(raw2ById.get(id))
    ) {
      heldSet.add(r1.month);
      heldSet.add(r2.month);
    }
  }

  if (prevParsed && prevRawById) {
    const prevById = new Map<number, CeapsRecord>(prevParsed.records.map(r => [r.id, r]));
    const prevMonths = new Set<number>(prevParsed.records.map(r => r.month));
    for (const [id, prevRec] of prevById) {
      const currRec = pass1ById.get(id);
      if (!currRec) {
        heldSet.add(prevRec.month);
      } else if (
        recordContentKey(prevRec) !== recordContentKey(currRec) ||
        canonical(prevRawById.get(id)) !== canonical(raw1ById.get(id))
      ) {
        heldSet.add(prevRec.month);
        heldSet.add(currRec.month);
      }
    }
    for (const [id, currRec] of pass1ById) {
      if (!prevById.has(id) && prevMonths.has(currRec.month)) {
        heldSet.add(currRec.month);
      }
    }
  }

  const senatorCodes = [...new Set(parsed1.records.map(r => r.codSenador))].sort((a, b) => a - b);
  const mandatesDir = path.join(runDir, 'mandates');
  const coverage = emptyCoverage();
  const mandatesMissing: number[] = [];
  const coverageScope = {start: `${year}-01-01`, end: `${year}-12-31`};

  for (const code of senatorCodes) {
    const mUrl = senatorMandatesUrl(code);
    const captured = await captureOrResume(mandatesDir, mUrl, key, fetcher, MANDATES_MAX_BYTES, true);
    if (captured === null) {
      mandatesMissing.push(code);
      continue;
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(captured.bytes));
    } catch {
      mandatesMissing.push(code);
      continue;
    }
    if (!isValidMandateEnvelope(envelope, code)) {
      mandatesMissing.push(code);
      continue;
    }
    try {
      const derived = deriveSenatorCoverage(envelope, coverageScope);
      for (const month of derived.months) {
        coverage.monthsByExercise[month.exercise] += 1;
      }
      coverage.issues += derived.issues.length;
    } catch {
      mandatesMissing.push(code);
    }
  }

  const derivedRecords: CeapsRecord[] = parsed1.records.map(rec => ({
    ...rec,
    tipoDocumento: redactCpf(rec.tipoDocumento),
    tipoDespesa: rec.tipoDespesa === null ? null : redactCpf(rec.tipoDespesa),
    documento: rec.documento === null ? null : redactCpf(rec.documento),
  }));

  const centsByMonth: Record<string, number> = {};
  const emptyTypeCentsByMonth: Record<string, number> = {};
  let emptyTypeRows = 0;

  for (const rec of derivedRecords) {
    const monthKey = String(rec.month);
    if (rec.excludedFromTotals) {
      emptyTypeRows += 1;
      emptyTypeCentsByMonth[monthKey] = (emptyTypeCentsByMonth[monthKey] ?? 0) + rec.cents;
    } else {
      centsByMonth[monthKey] = (centsByMonth[monthKey] ?? 0) + rec.cents;
    }
  }

  const sanitizedReview = sanitizeReview(parsed1.review);
  const reviewCounts = emptyReviewCounts();
  for (const item of sanitizedReview) {
    reviewCounts[item.kind] += 1;
  }

  const heldMonths = [...heldSet].sort((a, b) => a - b);
  const status: SenadoRunStatus = heldMonths.length > 0 ? 'held' : 'review-required';

  const summary: SenadoCeapsSummary = {
    schema: 'clareia.senado-ceaps-run.v1',
    year,
    status,
    recordCount: derivedRecords.length,
    previousRun,
    centsByMonth,
    emptyTypeRows,
    emptyTypeCentsByMonth,
    reviewCounts,
    heldMonths,
    independentPasses: cap1.meta.sha256 !== cap2.meta.sha256,
    passes: {
      pass1: toPassInfo(cap1.meta),
      pass2: toPassInfo(cap2.meta),
    },
    audit: auditSummary,
    errorCode: null,
    coverage,
    mandatesMissing,
  };

  await writeDerivedFiles(runDir, [
    {name: 'records.json', text: canonical(derivedRecords)},
    {name: 'review.json', text: canonical(sanitizedReview)},
    {name: 'summary.json', text: canonical(summary)},
  ]);

  return summary;
}
