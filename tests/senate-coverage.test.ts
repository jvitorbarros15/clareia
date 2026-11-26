import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveSenatorCoverage} from '../src/senate-coverage.ts';

type Envelope = Parameters<typeof deriveSenatorCoverage>[0];
type Mandates = Envelope['MandatoParlamentar']['Parlamentar']['Mandatos']['Mandato'];

const fixture: Envelope[] = JSON.parse(readFileSync(new URL('./fixtures/senado/mandatos-sample.json', import.meta.url), 'utf8'));
const fixturePerson = (id: string) => fixture.find(item => item.MandatoParlamentar.Parlamentar.Codigo === id)!;
const yearScope = (year: number) => ({start: `${year}-01-01`, end: `${year}-12-31`});
const substitute = {
  CodigoMandato: '12',
  UfParlamentar: 'PE',
  DescricaoParticipacao: '1º Suplente',
  Titular: {DescricaoParticipacao: 'Titular'},
  PrimeiraLegislaturaDoMandato: {DataInicio: '2023-02-01'},
  SegundaLegislaturaDoMandato: {DataFim: '2031-01-31'},
};
const envelope = (Mandato: Mandates, Codigo = '1'): Envelope => ({
  MandatoParlamentar: {Parlamentar: {Codigo, Nome: 'Synthetic senator', Mandatos: {Mandato}}},
});
const noMandate = {uf: null, codigoMandato: null, participation: null};
const metadata = ({uf, codigoMandato, participation}: ReturnType<typeof deriveSenatorCoverage>['months'][number]) => ({uf, codigoMandato, participation});

test('5899 exercises before and after leave in 2025', () => {
  const result = deriveSenatorCoverage(fixturePerson('5899'), yearScope(2025));
  assert.equal(result.id, 5899);
  assert.equal(result.name, 'Vanderlan Cardoso');
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.months.map(month => month.exercise), [
    'full', 'full', 'full', 'full', 'full', 'full', 'partial', 'outside', 'outside', 'partial', 'full', 'full',
  ]);
  for (const month of result.months) {
    assert.deepEqual(metadata(month), month.exercise === 'outside' ? noMandate : {
      uf: 'GO', codigoMandato: '538', participation: 'Titular',
    });
  }
});

test('5899 has full coverage in 2024 despite the later open exercise', () => {
  const result = deriveSenatorCoverage(fixturePerson('5899'), yearScope(2024));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.months.map(month => month.exercise), Array(12).fill('full'));
});

test('substitutes can serve a closed or open part of the year', () => {
  const closed = deriveSenatorCoverage(envelope({
    ...substitute, Exercicios: {Exercicio: {DataInicio: '2025-03-15', DataFim: '2025-06-10'}},
  }), yearScope(2025));
  assert.deepEqual(closed.months.map(month => month.exercise), [
    'outside', 'outside', 'partial', 'full', 'full', 'partial', 'outside', 'outside', 'outside', 'outside', 'outside', 'outside',
  ]);
  assert.deepEqual(metadata(closed.months[2]), {uf: 'PE', codigoMandato: '12', participation: '1º Suplente'});

  const open = deriveSenatorCoverage(envelope({
    ...substitute, CodigoMandato: '13', Exercicios: {Exercicio: {DataInicio: '2025-10-30'}},
  }, '2'), yearScope(2025));
  assert.deepEqual(open.issues, []);
  assert.deepEqual(open.months.map(month => month.exercise), [...Array(9).fill('outside'), 'partial', 'full', 'full']);
});

test('5917 shares an inclusive handover day without a conflict or gap', () => {
  const result = deriveSenatorCoverage(fixturePerson('5917'), yearScope(2023));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.months.map(month => month.exercise), Array(12).fill('full'));
  for (const month of result.months) {
    assert.deepEqual(metadata(month), {uf: 'PE', codigoMandato: '526', participation: '1º Suplente'});
  }
});

test('months without a mandate are unknown and a mandate without exercises gives outside', () => {
  const person = envelope([substitute, {Exercicios: {Exercicio: {DataInicio: 'bad'}}}]);
  const outsideSpan = deriveSenatorCoverage(person, yearScope(2015));
  assert.deepEqual(outsideSpan.issues, []);
  assert.deepEqual(outsideSpan.months.map(month => month.exercise), Array(12).fill('unknown'));
  assert.deepEqual(metadata(outsideSpan.months[0]), noMandate);
  const insideSpan = deriveSenatorCoverage(person, yearScope(2025));
  assert.deepEqual(insideSpan.issues, []);
  assert.deepEqual(insideSpan.months.map(month => month.exercise), Array(12).fill('outside'));
});

test('a multi-day overlap touching two months makes each a conflict', () => {
  const result = deriveSenatorCoverage(envelope({
    ...substitute, Exercicios: {Exercicio: [
      {DataInicio: '2025-03-31', DataFim: '2025-05-31'},
      {DataInicio: '2025-02-01', DataFim: '2025-04-01'},
    ]},
  }), yearScope(2025));
  assert.deepEqual(result.issues, ['overlapping-exercises']);
  assert.deepEqual(result.months.slice(1, 5).map(month => month.exercise), ['full', 'conflict', 'conflict', 'full']);
  for (const month of result.months.slice(2, 4)) assert.deepEqual(metadata(month), noMandate);
});

test('invalid exercise dates block the whole scope even when the exercise is outside it', () => {
  for (const invalid of [
    {},
    {DataInicio: 'bad'},
    {DataInicio: '2024-02-30'},
    {DataInicio: '2024-02-01', DataFim: '2024-2-29'},
    {DataInicio: '2024-03-01', DataFim: '2024-02-29'},
  ]) {
    const result = deriveSenatorCoverage(envelope({
      ...substitute, Exercicios: {Exercicio: [{DataInicio: '2025-01-01'}, invalid]},
    }), yearScope(2025));
    assert.deepEqual(result.issues, ['invalid-exercise-date']);
    assert.deepEqual(result.months.map(month => month.exercise), Array(12).fill('unknown'));
    for (const month of result.months) assert.deepEqual(metadata(month), noMandate);
  }
});

test('invalid kept mandate spans block the whole scope and issues are sorted and deduplicated', () => {
  const result = deriveSenatorCoverage(envelope([
    substitute,
    {CodigoMandato: '13', Exercicios: {Exercicio: {DataInicio: 'bad'}}},
    {...substitute, CodigoMandato: '14', SegundaLegislaturaDoMandato: {DataFim: '2031-02-29'}},
  ]), yearScope(2025));
  assert.deepEqual(result.issues, ['invalid-exercise-date', 'invalid-mandate-date']);
  assert.deepEqual(result.months.map(month => month.exercise), Array(12).fill('unknown'));
  for (const month of result.months) assert.deepEqual(metadata(month), noMandate);
});

test('coverage and attribution count clipped days and break a tie by string code', () => {
  const person = envelope([
    {...substitute, CodigoMandato: '2', Exercicios: {Exercicio: {DataInicio: '2025-04-01', DataFim: '2025-04-16'}}},
    {...substitute, CodigoMandato: '10', UfParlamentar: 'GO', DescricaoParticipacao: 'Titular',
      Exercicios: {Exercicio: {DataInicio: '2025-04-16', DataFim: '2025-04-30'}}},
  ]);
  assert.equal(deriveSenatorCoverage(person, yearScope(2025)).months[3].codigoMandato, '2');
  const clipped = deriveSenatorCoverage(person, {start: '2025-04-02', end: '2025-04-30'});
  assert.deepEqual(clipped.months, [{
    year: 2025, month: 4, start: '2025-04-02T00:00:00', end: '2025-05-01T00:00:00', partialScope: true,
    exercise: 'full', uf: 'GO', codigoMandato: '10', participation: 'Titular',
  }]);
});
