import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical, hash, UFS} from '../src/model.ts';
import {
  auditSenatorCeilings,
  computeSeatCeilings,
  deriveFeb2025Cents,
  deriveStep2024Cents,
  SENADO_CEILING_URLS,
  SENATOR_CEILING_TABLE,
  SENATOR_COMPUTED_CEILING_NOTE,
  senatorCeiling,
} from '../src/senado-ceiling.ts';
import {parseCeapsYear} from '../src/senado-expenses.ts';
import {auditCeapsYear} from '../src/senado-expenses-audit.ts';
import {buildSenatorsVersion} from '../src/senado-publication.ts';
import type {SenatorsYearRun} from '../src/senado-publication.ts';
import {deriveSenatorCoverage} from '../src/senate-coverage.ts';

type Envelope = Parameters<typeof deriveSenatorCoverage>[0];

const CHECKED_AT = '2026-11-26T12:00:00.000Z';
const BUILT_AT = '2026-11-26T13:00:00.000Z';

function makeEnvelope(
  code: number,
  name: string,
  mandate: {
    codigoMandato: string;
    uf: string;
    participation: string;
    exercises: {DataInicio: string; DataFim?: string}[];
    start?: string;
    end?: string;
  },
): Envelope {
  return {
    MandatoParlamentar: {
      Parlamentar: {
        Codigo: String(code),
        Nome: name,
        Mandatos: {
          Mandato: {
            CodigoMandato: mandate.codigoMandato,
            UfParlamentar: mandate.uf,
            DescricaoParticipacao: mandate.participation,
            PrimeiraLegislaturaDoMandato: {DataInicio: mandate.start ?? '2019-02-01'},
            SegundaLegislaturaDoMandato: {DataFim: mandate.end ?? '2027-01-31'},
            Exercicios: {Exercicio: mandate.exercises},
          },
        },
      },
    },
  };
}

function makeRawExpense(overrides: {
  id: number;
  ano: number;
  mes: number;
  codSenador: number;
  nomeSenador: string;
  tipoDespesa?: string | null;
  valorReembolsado: number;
}): Record<string, unknown> {
  return {
    id: overrides.id,
    tipoDocumento: 'Nota Fiscal Eletrônica',
    ano: overrides.ano,
    mes: overrides.mes,
    codSenador: overrides.codSenador,
    nomeSenador: overrides.nomeSenador,
    tipoDespesa: overrides.tipoDespesa === undefined
      ? 'Aluguel de imóveis para escritório político, compreendendo despesas concernentes a eles.'
      : overrides.tipoDespesa,
    cpfCnpj: '02.558.157/0001-62',
    fornecedor: 'VIVO TELEFONICA BRASIL S.A',
    documento: `DOC-${overrides.id}`,
    data: `${overrides.ano}-${String(overrides.mes).padStart(2, '0')}-15`,
    detalhamento: null,
    valorReembolsado: overrides.valorReembolsado,
  };
}

function makeRun(year: number, rawRows: Record<string, unknown>[], envelopes: Envelope[]): SenatorsYearRun {
  const bytes = new TextEncoder().encode(JSON.stringify(rawRows));
  const ctx = {year};
  const parsed = parseCeapsYear(bytes, ctx);
  const auditRes = auditCeapsYear(bytes, parsed, ctx);
  assert.equal(auditRes.ok, true);
  const coverage = envelopes.map(env => deriveSenatorCoverage(env, {start: `${year}-01-01`, end: `${year}-12-31`}));
  return {
    year,
    parsed,
    audit: {...auditRes, checkedAt: CHECKED_AT, parsedSha256: hash(canonical(parsed))},
    coverage,
  };
}

test('committed table covers all 27 UFs with exact act URLs, rounding rules and clean audit', () => {
  assert.deepEqual(SENADO_CEILING_URLS, {
    atc2_2023: 'https://adm.senado.gov.br/normas/ui/pub/normaConsultada?idNorma=14380751',
    ato8_2025: 'https://adm.senado.gov.br/normas/ui/pub/normaConsultada?idNorma=14383699',
    ato8_2025_annex: 'https://www.senado.leg.br/transparencia/SECRH/BASF/Anexo/A_01_2025_1761064.PDF',
  });
  assert.equal(Object.keys(SENATOR_CEILING_TABLE.annex2023).length, 27);
  assert.equal(Object.keys(SENATOR_CEILING_TABLE.step2024).length, 27);
  assert.equal(Object.keys(SENATOR_CEILING_TABLE.feb2025).length, 27);
  assert.equal(Object.keys(SENATOR_CEILING_TABLE.annex2025).length, 27);
  assert.deepEqual(auditSenatorCeilings(SENATOR_CEILING_TABLE), []);

  // Single half-up rounding from unrounded 2024 step: Sergipe Feb 2025 is 4989853, not 4989854.
  assert.equal(deriveFeb2025Cents(SENATOR_CEILING_TABLE.annex2023.SE), 4989853);
  assert.equal(senatorCeiling('SE', 2025, 2)?.cents, 4989853);
  assert.equal(senatorCeiling('SE', 2025, 2)?.computed, true);
  assert.equal(deriveFeb2025Cents(SENATOR_CEILING_TABLE.annex2023.AM), 5279882);
  assert.equal(senatorCeiling('AM', 2025, 2)?.cents, 5279882);
  assert.equal(senatorCeiling('AM', 2025, 2)?.computed, true);

  for (const uf of UFS) {
    assert.equal(SENATOR_CEILING_TABLE.step2024[uf], deriveStep2024Cents(SENATOR_CEILING_TABLE.annex2023[uf]));
    assert.equal(SENATOR_CEILING_TABLE.feb2025[uf], deriveFeb2025Cents(SENATOR_CEILING_TABLE.annex2023[uf]));
  }
  for (const uf of ['AP', 'AM', 'PA', 'SE']) {
    assert.equal(SENATOR_CEILING_TABLE.feb2025[uf], SENATOR_CEILING_TABLE.annex2025[uf]);
  }
});

test('senatorCeiling calendar returns official, computed and null on exact boundaries', () => {
  assert.equal(senatorCeiling('SE', 2022, 12), null);
  assert.equal(senatorCeiling('SE', 2023, 1), null);
  assert.equal(senatorCeiling('SE', 2023, 2), null);
  assert.deepEqual(senatorCeiling('SE', 2023, 3), {cents: 4435512, computed: false});
  assert.deepEqual(senatorCeiling('SE', 2023, 12), {cents: 4435512, computed: false});
  assert.deepEqual(senatorCeiling('SE', 2024, 1), {cents: 4435512, computed: false});
  assert.deepEqual(senatorCeiling('SE', 2024, 2), {cents: 4701643, computed: true});
  assert.deepEqual(senatorCeiling('SE', 2024, 12), {cents: 4701643, computed: true});
  assert.deepEqual(senatorCeiling('SE', 2025, 1), {cents: 4701643, computed: true});
  assert.deepEqual(senatorCeiling('SE', 2025, 2), {cents: 4989853, computed: true});
  assert.deepEqual(senatorCeiling('SE', 2025, 3), {cents: 4989853, computed: false});
  assert.deepEqual(senatorCeiling('GO', 2025, 3), {cents: 4130086, computed: false});
  assert.deepEqual(senatorCeiling('GO', 2025, 12), {cents: 4130086, computed: false});
  assert.equal(senatorCeiling('SE', 2026, 1), null);
  assert.equal(senatorCeiling('SE', 2027, 6), null);
  assert.equal(senatorCeiling('XX', 2025, 5), null);
  assert.equal(senatorCeiling('SE', 2025, 0), null);
  assert.equal(senatorCeiling('SE', 2025, 13), null);
});

test('auditSenatorCeilings fails when one derived value shifts by one cent or a UF is missing/invalid', () => {
  const badFeb = structuredClone(SENATOR_CEILING_TABLE);
  badFeb.feb2025.SE += 1;
  assert.ok(auditSenatorCeilings(badFeb).includes('feb2025:mismatch:SE'));

  const badStep = structuredClone(SENATOR_CEILING_TABLE);
  badStep.step2024.AM -= 1;
  assert.ok(auditSenatorCeilings(badStep).includes('step2024:mismatch:AM'));

  const missingUf = structuredClone(SENATOR_CEILING_TABLE);
  delete missingUf.annex2025.TO;
  const missingFailures = auditSenatorCeilings(missingUf);
  assert.ok(missingFailures.includes('annex2025:missing:TO'));
  assert.ok(missingFailures.includes('annex2025:uf-count:26'));

  const nonInt = structuredClone(SENATOR_CEILING_TABLE);
  nonInt.annex2023.AC = 4118572.5;
  assert.ok(auditSenatorCeilings(nonInt).includes('annex2023:invalid:AC'));

  const zeroVal = structuredClone(SENATOR_CEILING_TABLE);
  zeroVal.annex2025.DF = 0;
  assert.ok(auditSenatorCeilings(zeroVal).includes('annex2025:invalid:DF'));
});

test('titular and suplente on one 2025 seat share one ceiling per seat-month, sum numerator, keep computed note, and isolate unassigned/empty-type spend', () => {
  const titular = makeEnvelope(100, 'Titular Sergipe', {
    codigoMandato: '701',
    uf: 'SE',
    participation: 'Titular',
    exercises: [
      {DataInicio: '2023-02-01', DataFim: '2025-02-15'},
      {DataInicio: '2025-05-01'},
    ],
  });
  const suplente = makeEnvelope(200, 'Suplente Sergipe', {
    codigoMandato: '701',
    uf: 'SE',
    participation: '1º Suplente',
    exercises: [{DataInicio: '2025-02-15', DataFim: '2025-04-30'}],
  });

  const run = makeRun(
    2025,
    [
      // Titular in Jan (assigned to 701) + Feb (overlap month with suplente, assigned to 701)
      makeRawExpense({id: 1, ano: 2025, mes: 1, codSenador: 100, nomeSenador: 'TITULAR SERGIPE', valorReembolsado: 1000}),
      makeRawExpense({id: 2, ano: 2025, mes: 2, codSenador: 100, nomeSenador: 'TITULAR SERGIPE', valorReembolsado: 2000}),
      // Empty-type row in Feb must stay out of total and numerator
      makeRawExpense({id: 3, ano: 2025, mes: 2, codSenador: 100, nomeSenador: 'TITULAR SERGIPE', tipoDespesa: null, valorReembolsado: 3500}),
      // Titular spend in Mar while on leave (codigoMandato: null) -> unassignedCents, excluded from seat 701
      makeRawExpense({id: 4, ano: 2025, mes: 3, codSenador: 100, nomeSenador: 'TITULAR SERGIPE', valorReembolsado: 500}),
      // Suplente in Feb (overlap month) and Mar (assigned to 701)
      makeRawExpense({id: 5, ano: 2025, mes: 2, codSenador: 200, nomeSenador: 'SUPLENTE SERGIPE', valorReembolsado: 1500}),
      makeRawExpense({id: 6, ano: 2025, mes: 3, codSenador: 200, nomeSenador: 'SUPLENTE SERGIPE', valorReembolsado: 2500}),
    ],
    [titular, suplente],
  );

  const version = buildSenatorsVersion([run], BUILT_AT);
  const tRow = version.rows.find(r => r.senatorId === 100)!;
  const sRow = version.rows.find(r => r.senatorId === 200)!;

  // All 12 months of 2025 covered by seat 701 (Feb counted ONCE despite overlap).
  const expectedCeiling =
    SENATOR_CEILING_TABLE.step2024.SE +
    SENATOR_CEILING_TABLE.feb2025.SE +
    10 * SENATOR_CEILING_TABLE.annex2025.SE;
  const expectedSeat = {
    codigoMandato: '701',
    uf: 'SE',
    senatorIds: [100, 200],
    spentCents: 100000 + 200000 + 150000 + 250000,
    ceilingCents: expectedCeiling,
    monthsWithCeiling: 12,
    computedMonths: 2,
    note: SENATOR_COMPUTED_CEILING_NOTE,
  };

  assert.deepEqual(tRow.ceiling, [expectedSeat]);
  assert.deepEqual(sRow.ceiling, [expectedSeat]);
  assert.equal(tRow.unassignedCents, 50000);
  assert.equal(sRow.unassignedCents, 0);
  assert.equal(tRow.totalCents, 350000);
  assert.equal(sRow.totalCents, 400000);
});

test('2023 excludes Jan and Feb from both sides and produces null note; 2026 produces zero ceiling and monthsWithCeiling 0', () => {
  const sen2023 = makeEnvelope(300, 'Senador 2023', {
    codigoMandato: '801',
    uf: 'AM',
    participation: 'Titular',
    exercises: [{DataInicio: '2019-02-01'}],
  });
  const janFebOnly = makeEnvelope(301, 'Senador Jan Fev', {
    codigoMandato: '802',
    uf: 'AC',
    participation: 'Titular',
    exercises: [{DataInicio: '2019-02-01', DataFim: '2023-02-20'}],
  });
  const run2023 = makeRun(
    2023,
    [
      makeRawExpense({id: 10, ano: 2023, mes: 1, codSenador: 300, nomeSenador: 'SENADOR 2023', valorReembolsado: 999}),
      makeRawExpense({id: 11, ano: 2023, mes: 2, codSenador: 300, nomeSenador: 'SENADOR 2023', valorReembolsado: 888}),
      makeRawExpense({id: 12, ano: 2023, mes: 3, codSenador: 300, nomeSenador: 'SENADOR 2023', valorReembolsado: 1000}),
      makeRawExpense({id: 13, ano: 2023, mes: 1, codSenador: 301, nomeSenador: 'SENADOR JAN FEV', valorReembolsado: 777}),
    ],
    [sen2023, janFebOnly],
  );
  const v2023 = buildSenatorsVersion([run2023], BUILT_AT);
  const r300 = v2023.rows.find(r => r.senatorId === 300)!;
  const r301 = v2023.rows.find(r => r.senatorId === 301)!;

  assert.deepEqual(r300.ceiling, [{
    codigoMandato: '801',
    uf: 'AM',
    senatorIds: [300],
    spentCents: 100000,
    ceilingCents: 10 * SENATOR_CEILING_TABLE.annex2023.AM,
    monthsWithCeiling: 10,
    computedMonths: 0,
    note: null,
  }]);
  assert.equal(r300.unassignedCents, 0);

  assert.deepEqual(r301.ceiling, [{
    codigoMandato: '802',
    uf: 'AC',
    senatorIds: [301],
    spentCents: 0,
    ceilingCents: 0,
    monthsWithCeiling: 0,
    computedMonths: 0,
    note: null,
  }]);
  assert.equal(r301.unassignedCents, 0);

  const sen2026 = makeEnvelope(400, 'Senador 2026', {
    codigoMandato: '901',
    uf: 'SP',
    participation: 'Titular',
    exercises: [{DataInicio: '2023-02-01'}],
  });
  const run2026 = makeRun(
    2026,
    [makeRawExpense({id: 20, ano: 2026, mes: 4, codSenador: 400, nomeSenador: 'SENADOR 2026', valorReembolsado: 1200})],
    [sen2026],
  );
  const v2026 = buildSenatorsVersion([run2026], BUILT_AT);
  assert.deepEqual(v2026.rows[0].ceiling, [{
    codigoMandato: '901',
    uf: 'SP',
    senatorIds: [400],
    spentCents: 0,
    ceilingCents: 0,
    monthsWithCeiling: 0,
    computedMonths: 0,
    note: null,
  }]);
  assert.equal(v2026.rows[0].unassignedCents, 0);
});

test('disagreeing UFs on one seat in the same month throws during build', () => {
  assert.throws(
    () => computeSeatCeilings(2025, [
      {senatorId: 1, months: [{month: 3, uf: 'GO', codigoMandato: '500'}], spendByMonth: new Map()},
      {senatorId: 2, months: [{month: 3, uf: 'SP', codigoMandato: '500'}], spendByMonth: new Map()},
    ]),
    /Conflito de UF/,
  );
});
