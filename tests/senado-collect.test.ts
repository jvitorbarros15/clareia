import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {canonical, hash} from '../src/model.ts';
import {
  assertAllowedSenadoUrl,
  ceapsYearUrl,
  collectSenadoExpenses,
  isAllowedSenadoUrl,
  senatorMandatesUrl,
} from '../src/senado-collect.ts';
import type {Fetcher} from '../src/senado-collect.ts';
import {parseCeapsYear} from '../src/senado-expenses.ts';
import {open} from '../src/vault.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'senado');
const API_BYTES = new Uint8Array(readFileSync(path.join(FIXTURES, 'ceaps-2025-api-sample.json')));
const BASE_ROWS = JSON.parse(new TextDecoder('utf-8').decode(API_BYTES)) as Record<string, unknown>[];
const MANDATES_FIXTURE = JSON.parse(
  readFileSync(path.join(FIXTURES, 'mandatos-sample.json'), 'utf8'),
) as Array<{MandatoParlamentar: {Parlamentar: {Codigo: string; Nome: string}}}>;

const MANDATES_BY_CODE = new Map<number, Uint8Array>(
  MANDATES_FIXTURE.map(entry => [
    Number(entry.MandatoParlamentar.Parlamentar.Codigo),
    new TextEncoder().encode(JSON.stringify(entry)),
  ]),
);

const toBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const cloneRows = () => BASE_ROWS.map(r => ({...r}));

async function tempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clareia-senado-collect-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  return dir;
}

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

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function makeFakeFetcher(options: {
  pass1Bytes?: Uint8Array;
  pass2Bytes?: Uint8Array;
  pass1Headers?: Record<string, string>;
  pass2Headers?: Record<string, string>;
  mandates?: Map<number, Uint8Array>;
} = {}) {
  const pass1Bytes = options.pass1Bytes ?? API_BYTES;
  const pass2Bytes = options.pass2Bytes ?? pass1Bytes;
  const pass1Headers = options.pass1Headers ?? {
    'last-modified': 'Thu, 26 Nov 2026 02:00:00 GMT',
    etag: '"v1"',
  };
  const pass2Headers = options.pass2Headers ?? pass1Headers;
  const mandates = options.mandates ?? MANDATES_BY_CODE;

  let ceapsCalls = 0;
  const calls: string[] = [];

  const fetcher: Fetcher = async (url, init) => {
    assert.equal(isAllowedSenadoUrl(url), true, `URL must pass allowlist: ${url}`);
    calls.push(url);

    if (url.startsWith('https://adm.senado.gov.br/')) {
      ceapsCalls += 1;
      const body = ceapsCalls === 1 ? pass1Bytes : pass2Bytes;
      const headers = ceapsCalls === 1 ? pass1Headers : pass2Headers;
      return new Response(Buffer.from(body), {status: 200, headers});
    }

    const reqHeaders = new Headers(init?.headers);
    assert.equal(reqHeaders.get('accept'), 'application/json');
    const match = /\/senador\/(\d+)\/mandatos$/.exec(url);
    assert.ok(match);
    const code = Number(match[1]);
    const body = mandates.get(code);
    if (!body) {
      return new Response('', {status: 404});
    }
    return new Response(Buffer.from(body), {status: 200, headers: {'content-type': 'application/json'}});
  };

  return {fetcher, calls};
}

test('allowlist accepts both official shapes and rejects CSV, /csv, 2022, query string and other hosts', async t => {
  for (const year of [2023, 2024, 2025, 2026]) {
    assert.equal(
      isAllowedSenadoUrl(`https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/${year}`),
      true,
    );
  }
  assert.equal(isAllowedSenadoUrl('https://legis.senado.leg.br/dadosabertos/senador/5899/mandatos'), true);
  assert.equal(isAllowedSenadoUrl('https://legis.senado.leg.br/dadosabertos/senador/1/mandatos'), true);

  const rejected = [
    'https://www.senado.gov.br/transparencia/LAI/verba/despesa_ceaps_2025.csv',
    'https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/2025/csv',
    'https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/2022',
    'https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/2027',
    'https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/2025?formato=json',
    'https://legis.senado.leg.br/dadosabertos/senador/5899/mandatos?v=5',
    'https://legis.senado.leg.br/dadosabertos/senador/0/mandatos',
    'https://legis.senado.leg.br/dadosabertos/senador/05899/mandatos',
    'https://example.org/adm-dadosabertos/api/v1/senadores/despesas_ceaps/2025',
    'http://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/2025',
    'https://user@adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/2025',
  ];
  for (const url of rejected) {
    assert.equal(isAllowedSenadoUrl(url), false, url);
    assert.throws(() => assertAllowedSenadoUrl(url));
  }

  let fetchCalls = 0;
  await assert.rejects(
    collectSenadoExpenses({
      year: 2022,
      runId: 'bad-year',
      key: randomBytes(32),
      baseDir: await tempDir(t),
      fetcher: async () => {
        fetchCalls += 1;
        return new Response('[]', {status: 200});
      },
    }),
  );
  assert.equal(fetchCalls, 0);
});

test('two identical passes seal originals, compute summary/empty-type/mandates, drop private names and count fetches', async t => {
  const baseDir = await tempDir(t);
  const key = randomBytes(32);
  const {fetcher, calls} = makeFakeFetcher();

  const summary = await collectSenadoExpenses({
    year: 2025,
    runId: 'run-2025-01',
    key,
    baseDir,
    fetcher,
  });

  assert.equal(summary.schema, 'clareia.senado-ceaps-run.v1');
  assert.equal(summary.year, 2025);
  assert.equal(summary.status, 'review-required');
  assert.equal(summary.recordCount, 16);
  assert.equal(summary.previousRun, null);
  assert.equal(summary.independentPasses, false);
  assert.deepEqual(summary.heldMonths, []);
  assert.equal(summary.errorCode, null);
  assert.equal(summary.audit.ok, true);
  assert.deepEqual(summary.audit.pass1, {ok: true, failures: []});
  assert.deepEqual(summary.audit.pass2, {ok: true, failures: []});

  const expectedSha = hash(API_BYTES);
  assert.deepEqual(summary.passes.pass1, {
    sha256: expectedSha,
    lastModified: 'Thu, 26 Nov 2026 02:00:00 GMT',
    etag: '"v1"',
  });
  assert.deepEqual(summary.passes.pass2, {
    sha256: expectedSha,
    lastModified: 'Thu, 26 Nov 2026 02:00:00 GMT',
    etag: '"v1"',
  });

  assert.equal(summary.emptyTypeRows, 1);
  assert.deepEqual(summary.emptyTypeCentsByMonth, {'1': 350000});
  assert.equal(summary.centsByMonth['1'], 621218);
  assert.equal(summary.centsByMonth['2'], 540000);
  assert.equal(summary.centsByMonth['5'], 74036);
  assert.equal(summary.centsByMonth['7'], 52230);
  assert.equal(summary.centsByMonth['9'], 63483);
  assert.equal(summary.centsByMonth['12'], 885305);

  assert.deepEqual(summary.reviewCounts, {
    'empty-type': 1,
    'kept-company': 0,
    withheld: 3,
    'possible-duplicate': 1,
  });

  assert.deepEqual(summary.coverage, {
    monthsByExercise: {full: 20, partial: 2, outside: 2, unknown: 0, conflict: 0},
    issues: 0,
  });
  assert.deepEqual(summary.mandatesMissing, [475, 825, 5422, 5672, 5967, 6335, 999001]);

  assert.equal(calls.length, 11);
  assert.equal(calls.every(isAllowedSenadoUrl), true);

  const runDir = path.join(baseDir, 'run-2025-01');
  const ceapsStem = hash(ceapsYearUrl(2025));
  const sealedPass1 = await fs.readFile(path.join(runDir, 'pass-1', `${ceapsStem}.sealed`));
  assert.equal(sealedPass1.includes(Buffer.from('ALAN RICK')), false);
  assert.equal(sealedPass1.includes(Buffer.from('VOE DESTAK')), false);
  assert.deepEqual(new Uint8Array(open(sealedPass1, key)), API_BYTES);

  const metaPass1 = JSON.parse(await fs.readFile(path.join(runDir, 'pass-1', `${ceapsStem}.meta.json`), 'utf8'));
  assert.equal(metaPass1.url, ceapsYearUrl(2025));
  assert.equal(metaPass1.sha256, expectedSha);
  assert.equal(metaPass1.bytes, API_BYTES.length);
  assert.equal(metaPass1.lastModified, 'Thu, 26 Nov 2026 02:00:00 GMT');
  assert.equal(metaPass1.etag, '"v1"');

  const mandate5899Stem = hash(senatorMandatesUrl(5899));
  const sealed5899 = await fs.readFile(path.join(runDir, 'mandates', `${mandate5899Stem}.sealed`));
  assert.equal(sealed5899.includes(Buffer.from('Vanderlan Cardoso')), false);
  assert.deepEqual(new Uint8Array(open(sealed5899, key)), MANDATES_BY_CODE.get(5899)!);

  const summaryText = await fs.readFile(path.join(runDir, 'summary.json'), 'utf8');
  const reviewText = await fs.readFile(path.join(runDir, 'review.json'), 'utf8');
  const recordsText = await fs.readFile(path.join(runDir, 'records.json'), 'utf8');
  assert.equal(summaryText, canonical(summary));
  const reviewItems = JSON.parse(reviewText) as Record<string, unknown>[];
  for (const item of reviewItems) {
    if (item.kind === 'withheld' || item.kind === 'kept-company') {
      assert.deepEqual(Object.keys(item).sort(), ['codSenador', 'id', 'kind', 'month']);
    }
  }

  const forbiddenInSummaryAndReview = [
    ...new Set(BASE_ROWS.map(r => String(r.nomeSenador))),
    ...MANDATES_FIXTURE.map(m => m.MandatoParlamentar.Parlamentar.Nome),
    'VOE DESTAK',
    'Secretaria de Estado de Fazenda do Distrito Federal',
  ];
  for (const name of forbiddenInSummaryAndReview) {
    assert.equal(summaryText.includes(name), false, `summary.json must not contain ${name}`);
    assert.equal(reviewText.includes(name), false, `review.json must not contain ${name}`);
  }
  for (const secret of ['Check-In', 'Companhia Aérea', 'PASSAGEIROS', '000.***.***-00', 'ALAN RICK']) {
    assert.equal(recordsText.includes(secret), false, `records.json must not contain ${secret}`);
  }
});

test('kept-company name is omitted from summary.json and review.json, and different pass sha sets independentPasses:true', async t => {
  const baseDir = await tempDir(t);
  const key = randomBytes(32);
  const rows = cloneRows();
  rows[3].cpfCnpj = '123456';
  rows[3].fornecedor = 'AGENCIA MODELO LTDA';
  const pass1Bytes = new TextEncoder().encode(JSON.stringify(rows, null, 2));
  const pass2Bytes = toBytes(rows);
  const {fetcher} = makeFakeFetcher({pass1Bytes, pass2Bytes});

  const summary = await collectSenadoExpenses({
    year: 2025,
    runId: 'kept-company-run',
    key,
    baseDir,
    fetcher,
  });

  assert.equal(summary.status, 'review-required');
  assert.equal(summary.independentPasses, true);
  assert.equal(summary.reviewCounts['kept-company'], 1);

  const runDir = path.join(baseDir, 'kept-company-run');
  const summaryText = await fs.readFile(path.join(runDir, 'summary.json'), 'utf8');
  const reviewText = await fs.readFile(path.join(runDir, 'review.json'), 'utf8');
  assert.equal(summaryText.includes('AGENCIA MODELO LTDA'), false);
  assert.equal(reviewText.includes('AGENCIA MODELO LTDA'), false);
});

test('pass 2 with a removed id or a changed value holds the affected month', async t => {
  const baseDir = await tempDir(t);
  const key = randomBytes(32);

  const removedRows = cloneRows().filter(r => r.id !== 2249409);
  const removedSummary = await collectSenadoExpenses({
    year: 2025,
    runId: 'pass2-removed',
    key,
    baseDir,
    fetcher: makeFakeFetcher({pass1Bytes: API_BYTES, pass2Bytes: toBytes(removedRows)}).fetcher,
  });
  assert.equal(removedSummary.status, 'held');
  assert.deepEqual(removedSummary.heldMonths, [1]);

  const changedRows = cloneRows();
  const target = changedRows.find(r => r.id === 2276647)!;
  target.valorReembolsado = 250;
  const changedSummary = await collectSenadoExpenses({
    year: 2025,
    runId: 'pass2-changed',
    key,
    baseDir,
    fetcher: makeFakeFetcher({pass1Bytes: API_BYTES, pass2Bytes: toBytes(changedRows)}).fetcher,
  });
  assert.equal(changedSummary.status, 'held');
  assert.deepEqual(changedSummary.heldMonths, [9]);
});

test('pass 2 with a duplicated id fails and writes only summary.json with code', async t => {
  const baseDir = await tempDir(t);
  const key = randomBytes(32);
  const dupRows = cloneRows();
  dupRows[1].id = dupRows[0].id;

  const summary = await collectSenadoExpenses({
    year: 2025,
    runId: 'pass2-dup',
    key,
    baseDir,
    fetcher: makeFakeFetcher({pass1Bytes: API_BYTES, pass2Bytes: toBytes(dupRows)}).fetcher,
  });

  assert.equal(summary.status, 'failed');
  assert.equal(summary.errorCode, 'duplicate-id');
  const runDir = path.join(baseDir, 'pass2-dup');
  assert.equal(await exists(path.join(runDir, 'summary.json')), true);
  assert.equal(await exists(path.join(runDir, 'records.json')), false);
  assert.equal(await exists(path.join(runDir, 'review.json')), false);
});

test('previous run with vanished, changed, or new id in existing month holds that month', async t => {
  const baseDir = await tempDir(t);
  const key = randomBytes(32);

  await collectSenadoExpenses({
    year: 2025,
    runId: 'prev-run',
    key,
    baseDir,
    fetcher: makeFakeFetcher().fetcher,
  });

  const vanishedRows = cloneRows().filter(r => r.id !== 9000002);
  const vanished = await collectSenadoExpenses({
    year: 2025,
    runId: 'curr-vanished',
    previousRunId: 'prev-run',
    key,
    baseDir,
    fetcher: makeFakeFetcher({pass1Bytes: toBytes(vanishedRows)}).fetcher,
  });
  assert.equal(vanished.previousRun, 'prev-run');
  assert.equal(vanished.status, 'held');
  assert.deepEqual(vanished.heldMonths, [2]);

  const changedRows = cloneRows();
  changedRows.find(r => r.id === 2268296)!.valorReembolsado = 390;
  const changed = await collectSenadoExpenses({
    year: 2025,
    runId: 'curr-changed',
    previousRunId: 'prev-run',
    key,
    baseDir,
    fetcher: makeFakeFetcher({pass1Bytes: toBytes(changedRows)}).fetcher,
  });
  assert.equal(changed.status, 'held');
  assert.deepEqual(changed.heldMonths, [9]);

  const newInExistingMonth = [...cloneRows(), {...cloneRows()[3], id: 9999101, mes: 5, documento: 'NEW-DOC-5'}];
  const existingMonthHeld = await collectSenadoExpenses({
    year: 2025,
    runId: 'curr-new-existing-month',
    previousRunId: 'prev-run',
    key,
    baseDir,
    fetcher: makeFakeFetcher({pass1Bytes: toBytes(newInExistingMonth)}).fetcher,
  });
  assert.equal(existingMonthHeld.status, 'held');
  assert.deepEqual(existingMonthHeld.heldMonths, [5]);

  const newInFreshMonth = [...cloneRows(), {...cloneRows()[3], id: 9999102, mes: 3, documento: 'NEW-DOC-3'}];
  const freshMonthOk = await collectSenadoExpenses({
    year: 2025,
    runId: 'curr-new-fresh-month',
    previousRunId: 'prev-run',
    key,
    baseDir,
    fetcher: makeFakeFetcher({pass1Bytes: toBytes(newInFreshMonth)}).fetcher,
  });
  assert.equal(freshMonthOk.status, 'review-required');
  assert.deepEqual(freshMonthOk.heldMonths, []);
});

test('truncated JSON fails and writes only summary.json', async t => {
  const baseDir = await tempDir(t);
  const key = randomBytes(32);

  const summary = await collectSenadoExpenses({
    year: 2025,
    runId: 'truncated-json',
    key,
    baseDir,
    fetcher: makeFakeFetcher({pass1Bytes: API_BYTES.slice(0, 40)}).fetcher,
  });

  assert.equal(summary.status, 'failed');
  assert.equal(summary.errorCode, 'json-invalid');
  const runDir = path.join(baseDir, 'truncated-json');
  assert.equal(await exists(path.join(runDir, 'summary.json')), true);
  assert.equal(await exists(path.join(runDir, 'records.json')), false);
  assert.equal(await exists(path.join(runDir, 'review.json')), false);
});

test('audit failure gives failed and writes only summary.json with failure codes', async t => {
  const baseDir = await tempDir(t);
  const key = randomBytes(32);

  const summary = await collectSenadoExpenses({
    year: 2025,
    runId: 'audit-fail',
    key,
    baseDir,
    fetcher: makeFakeFetcher().fetcher,
    parse: (bytes, ctx) => {
      const parsed = parseCeapsYear(bytes, ctx);
      parsed.records[0].cents += 1;
      return parsed;
    },
  });

  assert.equal(summary.status, 'failed');
  assert.equal(summary.audit.ok, false);
  assert.equal(summary.audit.pass1?.ok, false);
  assert.ok(summary.audit.pass1 && summary.audit.pass1.failures.includes('cents:9000001'));
  const runDir = path.join(baseDir, 'audit-fail');
  assert.equal(await exists(path.join(runDir, 'summary.json')), true);
  assert.equal(await exists(path.join(runDir, 'records.json')), false);
  assert.equal(await exists(path.join(runDir, 'review.json')), false);
});

test('scanCpfs gate throws when a CPF is injected into a derived record and writes no derived file', async t => {
  const baseDir = await tempDir(t);
  const key = randomBytes(32);
  const cpf = syntheticCpf(19);
  const formatted = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;

  await assert.rejects(
    collectSenadoExpenses({
      year: 2025,
      runId: 'cpf-gate',
      key,
      baseDir,
      fetcher: makeFakeFetcher().fetcher,
      parse: (bytes, ctx) => {
        const parsed = parseCeapsYear(bytes, ctx);
        parsed.records[0].supplier = `FORNECEDOR ${formatted}`;
        return parsed;
      },
      audit: () => ({ok: true, failures: []}),
    }),
    /CPF/,
  );

  const runDir = path.join(baseDir, 'cpf-gate');
  assert.equal(await exists(path.join(runDir, 'summary.json')), false);
  assert.equal(await exists(path.join(runDir, 'records.json')), false);
  assert.equal(await exists(path.join(runDir, 'review.json')), false);
});

test('resume reuses sealed captures without refetching and rejects a tampered .sealed', async t => {
  const baseDir = await tempDir(t);
  const key = randomBytes(32);

  const first = makeFakeFetcher();
  const summary1 = await collectSenadoExpenses({
    year: 2025,
    runId: 'resume-run',
    key,
    baseDir,
    fetcher: first.fetcher,
  });
  assert.equal(first.calls.length, 11);

  const second = makeFakeFetcher();
  const summary2 = await collectSenadoExpenses({
    year: 2025,
    runId: 'resume-run',
    key,
    baseDir,
    fetcher: second.fetcher,
  });
  assert.equal(summary2.status, summary1.status);
  assert.equal(second.calls.includes(ceapsYearUrl(2025)), false);
  assert.equal(second.calls.includes(senatorMandatesUrl(5899)), false);
  assert.equal(second.calls.includes(senatorMandatesUrl(5917)), false);
  assert.equal(second.calls.length, 7);

  const ceapsFile = path.join(baseDir, 'resume-run', 'pass-1', `${hash(ceapsYearUrl(2025))}.sealed`);
  await fs.writeFile(ceapsFile, Buffer.from('tampered'));

  await assert.rejects(
    collectSenadoExpenses({
      year: 2025,
      runId: 'resume-run',
      key,
      baseDir,
      fetcher: makeFakeFetcher().fetcher,
    }),
  );
});
