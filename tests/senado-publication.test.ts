import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {scanCpfs} from '../src/cpf-scan.ts';
import {canonical, hash} from '../src/model.ts';
import {activePublication, recordDomainAudit} from '../src/publications.ts';
import {parseCeapsYear} from '../src/senado-expenses.ts';
import type {CeapsParsed} from '../src/senado-expenses.ts';
import {auditCeapsYear} from '../src/senado-expenses-audit.ts';
import {
  auditSenatorsVersion,
  buildSenatorsVersion,
  readSenatorRows,
  reobserveSenatorsVersion,
  senatorsSummary,
  storeSenatorsVersion,
  writeSenatorsSite,
} from '../src/senado-publication.ts';
import type {SenatorsYearRun} from '../src/senado-publication.ts';
import {deriveSenatorCoverage} from '../src/senate-coverage.ts';
import {openDB} from '../src/store.ts';
import {coverageFor} from './senado-coverage-helper.ts';

type Envelope = Parameters<typeof deriveSenatorCoverage>[0];

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'senado');
const API_BYTES = new Uint8Array(readFileSync(path.join(FIXTURES, 'ceaps-2025-api-sample.json')));
const MANDATOS: Envelope[] = JSON.parse(readFileSync(path.join(FIXTURES, 'mandatos-sample.json'), 'utf8'));
const BASE_ROWS = JSON.parse(new TextDecoder('utf-8').decode(API_BYTES)) as Record<string, unknown>[];

const CHECKED_AT = '2026-11-26T12:00:00.000Z';
const BUILT_AT = '2026-11-26T13:00:00.000Z';

function syntheticCpf(seed: number): string {
  const base = String(100000000 + seed * 7919).slice(0, 9);
  const digit = (size: number, d: string) => {
    const rest = ([...d].reduce((n, c, i) => n + Number(c) * (size + 1 - i), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = digit(9, base);
  const full = base + first + digit(10, base + first);
  return `${full.slice(0, 3)}.${full.slice(3, 6)}.${full.slice(6, 9)}-${full.slice(9)}`;
}

function makeRun(year = 2025, checkedAt = CHECKED_AT): SenatorsYearRun {
  const ctx = {year, lastModified: 'Thu, 26 Nov 2026 02:00:00 GMT', etag: '"v1"'};
  const parsed = parseCeapsYear(API_BYTES, ctx);
  const auditRes = auditCeapsYear(API_BYTES, parsed, ctx);
  assert.equal(auditRes.ok, true);
  const coverage = coverageFor(MANDATOS, parsed.records.map(r => r.codSenador).concat(parsed.review.map(i => i.codSenador)), {start: `${year}-01-01`, end: `${year}-12-31`});
  return {
    year,
    parsed,
    audit: {...auditRes, checkedAt, parsedSha256: hash(canonical(parsed))},
    coverage,
  };
}

test('refuses failed audit, missing or invalid checkedAt, wrong parsedSha256, wrong year, coverage issues and CPF in output', () => {
  const base = makeRun();

  const failed = structuredClone(base);
  failed.audit.ok = false;
  assert.throws(() => buildSenatorsVersion([failed], BUILT_AT), /auditoria aprovada/);

  const withFailures = structuredClone(base);
  withFailures.audit.failures = ['record-count'];
  assert.throws(() => buildSenatorsVersion([withFailures], BUILT_AT), /auditoria aprovada/);

  for (const badCheckedAt of ['', 'not-a-date', '2025-02-30T00:00:00Z', undefined as unknown as string]) {
    const bad = structuredClone(base);
    bad.audit.checkedAt = badCheckedAt;
    assert.throws(() => buildSenatorsVersion([bad], BUILT_AT), /checkedAt/);
  }

  const badSha = structuredClone(base);
  badSha.audit.parsedSha256 = '0'.repeat(64);
  assert.throws(() => buildSenatorsVersion([badSha], BUILT_AT), /parsedSha256/);

  const wrongYear = structuredClone(base);
  wrongYear.parsed.records[0].year = 2024;
  wrongYear.audit.parsedSha256 = hash(canonical(wrongYear.parsed));
  assert.throws(() => buildSenatorsVersion([wrongYear], BUILT_AT), /2024/);

  const withIssues = structuredClone(base);
  const conflictEnv: Envelope = {
    MandatoParlamentar: {
      Parlamentar: {
        Codigo: '99',
        Nome: 'Senador Conflito',
        Mandatos: {
          Mandato: {
            CodigoMandato: '12',
            UfParlamentar: 'PE',
            DescricaoParticipacao: 'Titular',
            PrimeiraLegislaturaDoMandato: {DataInicio: '2023-02-01'},
            SegundaLegislaturaDoMandato: {DataFim: '2031-01-31'},
            Exercicios: {
              Exercicio: [
                {DataInicio: '2025-02-01', DataFim: '2025-04-01'},
                {DataInicio: '2025-03-31', DataFim: '2025-05-31'},
              ],
            },
          },
        },
      },
    },
  };
  withIssues.coverage = [...withIssues.coverage, deriveSenatorCoverage(conflictEnv, {start: '2025-01-01', end: '2025-12-31'})];
  assert.throws(() => buildSenatorsVersion([withIssues], BUILT_AT), /pendências/);

  const cpfLeak = structuredClone(base);
  const cnpjRec = cpfLeak.parsed.records.find(r => r.supplierKind === 'cnpj' && !r.excludedFromTotals)!;
  cnpjRec.supplier = `EMPRESA ${syntheticCpf(17)} LTDA`;
  cpfLeak.audit.parsedSha256 = hash(canonical(cpfLeak.parsed));
  assert.throws(() => buildSenatorsVersion([cpfLeak], BUILT_AT), /Identificador privado/);

  const uncovered = structuredClone(base);
  uncovered.coverage = uncovered.coverage.filter(c => c.id !== 999001);
  assert.throws(() => buildSenatorsVersion([uncovered], BUILT_AT), /999001 sem cobertura/);
});

test('computes totals by tipoDespesa and month, excludes empty-type, keeps duplicates, preserves supplier labels and coverage months', () => {
  const run = makeRun();
  const version = buildSenatorsVersion([run], BUILT_AT);

  assert.equal(version.scope.records, 15);
  assert.equal(version.scope.senators, 9);
  assert.deepEqual(senatorsSummary(version), {
    version: version.id,
    records: 15,
    years: [{year: 2025, records: 15, totalCents: 2236272}],
  });

  const byId = new Map(version.rows.map(r => [r.senatorId, r]));

  const emptyOnly = byId.get(5967)!;
  assert.equal(emptyOnly.totalCents, 0);
  assert.equal(emptyOnly.records, 0);
  assert.deepEqual(emptyOnly.byType, {});
  assert.deepEqual(emptyOnly.byMonth, {});
  assert.deepEqual(emptyOnly.suppliers, {});
  assert.deepEqual(emptyOnly.review, {'empty-type': 1, 'kept-company': 0, withheld: 0, 'possible-duplicate': 0});

  const dupWithheld = byId.get(6335)!;
  assert.equal(dupWithheld.totalCents, 52230);
  assert.equal(dupWithheld.records, 2);
  assert.deepEqual(dupWithheld.byType, {
    'Aluguel de imóveis para escritório político, compreendendo despesas concernentes a eles.': 52230,
  });
  assert.deepEqual(dupWithheld.byMonth, {
    '7': {'Aluguel de imóveis para escritório político, compreendendo despesas concernentes a eles.': 52230},
  });
  assert.deepEqual(dupWithheld.suppliers, {'Nome não exibido pelo Clareia': 52230});
  assert.deepEqual(dupWithheld.review, {'empty-type': 0, 'kept-company': 0, withheld: 2, 'possible-duplicate': 2});

  const mixedWithheld = byId.get(475)!;
  assert.equal(mixedWithheld.totalCents, 112536);
  assert.deepEqual(mixedWithheld.suppliers, {
    'HOTEL PORTO MADEIRA LTDA': 38500,
    'Nome não exibido pelo Clareia': 74036,
  });
  assert.deepEqual(mixedWithheld.review, {'empty-type': 0, 'kept-company': 0, withheld: 1, 'possible-duplicate': 0});

  const multiMonth = byId.get(5672)!;
  assert.equal(multiMonth.totalCents, 393778);
  assert.equal(multiMonth.records, 4);
  assert.deepEqual(multiMonth.byType, {
    'Aluguel de imóveis para escritório político, compreendendo despesas concernentes a eles.': 375000,
    'Contratação de consultorias, assessorias, pesquisas, trabalhos técnicos e outros serviços de apoio ao exercício do mandato parlamentar': -3095,
    'Locomoção, hospedagem, alimentação, combustíveis e lubrificantes': 21873,
  });
  assert.deepEqual(multiMonth.byMonth, {
    '1': {
      'Aluguel de imóveis para escritório político, compreendendo despesas concernentes a eles.': 375000,
      'Locomoção, hospedagem, alimentação, combustíveis e lubrificantes': 21873,
    },
    '12': {
      'Contratação de consultorias, assessorias, pesquisas, trabalhos técnicos e outros serviços de apoio ao exercício do mandato parlamentar': -3095,
    },
  });
  assert.deepEqual(multiMonth.suppliers, {
    'AEROTUR SERVIÇOS': -3095,
    'Fornecedor pessoa física': 375000,
    'POSTO VILLAGE LTDA': 21873,
  });

  const mei = byId.get(999001)!;
  assert.deepEqual(mei.suppliers, {'FULANO DE TAL MEI [CPF omitido]': 12345});

  const vanderlan = byId.get(5899)!;
  assert.equal(vanderlan.name, 'Vanderlan Cardoso');
  assert.equal(vanderlan.totalCents, 913383);
  assert.equal(vanderlan.months.length, 12);
  assert.deepEqual(vanderlan.months.map(m => m.exercise), [
    'full', 'full', 'full', 'full', 'full', 'full', 'partial', 'outside', 'outside', 'partial', 'full', 'full',
  ]);
  for (const m of vanderlan.months) {
    assert.deepEqual(Object.keys(m).sort(), ['codigoMandato', 'exercise', 'month', 'participation', 'uf']);
  }
  assert.deepEqual(vanderlan.months[7], {
    month: 8, exercise: 'outside', uf: null, codigoMandato: null, participation: null,
  });

  const keptRows = BASE_ROWS.slice(0, 2).map(r => ({...r}));
  keptRows[0].cpfCnpj = '123456';
  keptRows[0].fornecedor = 'EMPRESA EXEMPLO LTDA';
  keptRows[0].valorReembolsado = 100;
  keptRows[1].tipoDespesa = 'Aluguel de imóveis para escritório político, compreendendo despesas concernentes a eles.';
  keptRows[1].cpfCnpj = '';
  keptRows[1].fornecedor = 'NOME SECRETO';
  keptRows[1].valorReembolsado = 50;
  const keptBytes = new TextEncoder().encode(JSON.stringify(keptRows));
  const keptParsed: CeapsParsed = parseCeapsYear(keptBytes, {year: 2025});
  const keptAudit = auditCeapsYear(keptBytes, keptParsed, {year: 2025});
  const keptVersion = buildSenatorsVersion([{
    year: 2025,
    parsed: keptParsed,
    audit: {...keptAudit, checkedAt: CHECKED_AT, parsedSha256: hash(canonical(keptParsed))},
    coverage: coverageFor(MANDATOS, keptParsed.records.map(r => r.codSenador).concat(keptParsed.review.map(i => i.codSenador)), {start: '2025-01-01', end: '2025-12-31'}),
  }], BUILT_AT);
  assert.equal(keptVersion.rows.find(r => r.senatorId === 5672)?.suppliers['EMPRESA EXEMPLO LTDA'], 10000);
  assert.equal(keptVersion.rows.find(r => r.senatorId === 5672)?.review['kept-company'], 1);
  assert.equal(keptVersion.rows.find(r => r.senatorId === 5967)?.suppliers['Nome não exibido pelo Clareia'], 5000);
  assert.equal(JSON.stringify(keptVersion).includes('NOME SECRETO'), false);
});

test('id is deterministic, SQL store and re-audit round-trip detects tampering, and written files contain no private fields', async () => {
  const run = makeRun();
  const version = buildSenatorsVersion([run], BUILT_AT);
  const sameContentLater = buildSenatorsVersion([makeRun(2025, '2026-12-01T00:00:00.000Z')], '2026-12-02T00:00:00.000Z');
  assert.match(version.id, /^[0-9a-f]{64}$/);
  assert.equal(sameContentLater.id, version.id);

  const db = await openDB(true);
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'clareia-senators-'));
  try {
    await storeSenatorsVersion(db, version);
    await storeSenatorsVersion(db, version);
    assert.equal((await readSenatorRows(db, version.id)).length, version.rows.length);
    assert.equal(await activePublication(db, 'senadores'), null);

    await assert.rejects(writeSenatorsSite(db, outDir, version.id), /sem auditoria aprovada/);

    const cleanAudit = await auditSenatorsVersion(db, version.id, [run]);
    assert.equal(cleanAudit.status, 'passed');
    assert.deepEqual(cleanAudit.failures, []);

    await db.query(
      `UPDATE senators_v1 SET record=jsonb_set(record,'{totalCents}','999999') WHERE publication_id=$1 AND position=0`,
      [version.id],
    );
    const tamperedRecord = await auditSenatorsVersion(db, version.id, [run]);
    assert.equal(tamperedRecord.status, 'failed');
    assert.ok(tamperedRecord.failures.includes('content-id'));
    assert.ok(tamperedRecord.failures.includes('source-total-2025'));

    await db.query(
      `UPDATE senators_v1 SET record=$2::jsonb WHERE publication_id=$1 AND position=0`,
      [version.id, JSON.stringify(version.rows[0])],
    );
    await db.query(
      `UPDATE senators_v1 SET senator_id=999999 WHERE publication_id=$1 AND position=0`,
      [version.id],
    );
    const tamperedColumn = await auditSenatorsVersion(db, version.id, [run]);
    assert.equal(tamperedColumn.status, 'failed');
    assert.ok(tamperedColumn.failures.includes('columns-drift'));

    await db.query(
      `UPDATE senators_v1 SET senator_id=$2 WHERE publication_id=$1 AND position=0`,
      [version.id, version.rows[0].senatorId],
    );
    await reobserveSenatorsVersion(db, version.id);
    const passed = await auditSenatorsVersion(db, version.id, [run]);
    assert.equal(passed.status, 'passed');
    await recordDomainAudit(db, version.id, 'passed', passed);
    assert.equal((await activePublication(db, 'senadores'))?.id, version.id);

    const written = await writeSenatorsSite(db, outDir, version.id);
    assert.deepEqual(
      written.map(f => path.relative(outDir, f).split(path.sep).join('/')).sort(),
      ['senadores/2025.json', 'senadores/index.json'],
    );

    const yearText = await fs.readFile(path.join(outDir, 'senadores', '2025.json'), 'utf8');
    const indexText = await fs.readFile(path.join(outDir, 'senadores', 'index.json'), 'utf8');
    for (const text of [yearText, indexText]) {
      assert.equal(scanCpfs(text, new Set()), 0);
      for (const forbidden of [
        'detalhamento',
        'documento',
        '***',
        'VOE DESTAK',
        'Secretaria de Estado de Fazenda',
        'DG Invest',
        'ALAN RICK',
        'Pessoa física',
        '"ids"',
      ]) {
        assert.equal(text.includes(forbidden), false, forbidden);
      }
    }

    const indexJson = JSON.parse(indexText) as {publicationId: string; years: {year: number; file: string; senators: number; records: number; totalCents: number}[]};
    assert.equal(indexJson.publicationId, version.id);
    assert.deepEqual(indexJson.years, [{year: 2025, file: '2025.json', senators: 9, records: 15, totalCents: 2236272}]);
  } finally {
    await db.close();
    await fs.rm(outDir, {recursive: true, force: true});
  }
});
