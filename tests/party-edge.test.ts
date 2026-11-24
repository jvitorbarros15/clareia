import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {partyFromEvents} from '../src/expense-publication.ts';
import {deputiesOf} from '../src/prerender.ts';
import {partyFieldsOf} from '../src/site-summary.ts';
import type {MonthSummary, SiteSummary} from '../src/site-summary.ts';

const pev = (siglaPartido: string, dataHora: string) => ({time: `${dataHora}:00`, original: {idLegislatura: 57, siglaPartido, dataHora}});
const direct = (events: ReturnType<typeof pev>[], end = '2025-12-31') => {
  const {value, note} = partyFromEvents(events, 57, `${end.slice(0, 4)}-01-01`, end);
  return [value, note] as const;
};
const m = (month: number, partyStatus: string, party: string | null = null, partyValues: string[] = []): MonthSummary => ({
  month, partyStatus, party, partyValues, cents: 0, records: 0, exercise: null, ufStatus: 'single', uf: 'SP', held: false,
});

const mergers = [
  {old: 'PTB', successor: 'PRD', before: '2023-11-08', on: '2023-11-09', month: 'nov/2023'},
  {old: 'PROS', successor: 'SOLIDARIEDADE', before: '2023-02-13', on: '2023-02-14', month: 'fev/2023'},
  {old: 'PATRIOTA', successor: 'PRD', before: '2023-11-08', on: '2023-11-09', month: 'nov/2023'},
  {old: 'PSC', successor: 'PODE', before: '2023-06-14', on: '2023-06-15', month: 'jun/2023'},
];
const cases: {
  name: string;
  months: MonthSummary[];
  events: readonly [string | null, string | null];
  expected: readonly [string, string | null];
}[] = [];

for (const {old, successor, before, on, month} of mergers) {
  const events = [pev(old, '2023-02-01T10:00')];
  const beforeMerger = direct(events, before);
  const onMerger = direct(events, on);
  const oldNote = 'partido dos eventos da legislatura';
  const mergerNote = `${old} registrado em fev/2023; partido extinto, sucedido pelo ${successor} (${month})`;
  test(`${old} maps to ${successor} starting on ${on}`, () => {
    assert.deepEqual(beforeMerger, [old, oldNote]);
    assert.deepEqual(onMerger, [successor, mergerNote]);
    assert.deepEqual(direct(events), [successor, mergerNote]);
  });
  const confirmed = [m(1, 'single', successor), m(2, 'single', successor)];
  cases.push(
    {name: `${old} before the merger with unknown coverage`, months: [m(2, 'unknown')], events: beforeMerger, expected: [old, oldNote]},
    {name: `${successor} on the ${old} merger date with unknown coverage`, months: [m(2, 'unknown')], events: onMerger, expected: [successor, mergerNote]},
    {name: `${old} in events and ${successor} in confirmed coverage`, months: confirmed, events: beforeMerger, expected: [successor, null]},
    {name: `${successor} in both events and coverage for ${old}`, months: confirmed, events: direct([pev(successor, '2025-01-10T10:00')]), expected: [successor, null]},
  );
}

const switched = direct([pev('PL', '2025-01-10T10:00'), pev('PT', '2025-04-10T10:00')]);
const dateNote = 'partido registrado em abr/2025, nos eventos da legislatura';
const changed = m(4, 'changed', null, ['PL', 'PT']);
cases.push(
  {name: 'unknown coverage keeps the party and date note from the switch', months: [m(4, 'unknown')], events: switched, expected: ['PT', dateNote]},
  {name: 'unavailable coverage keeps the party and date note from the switch', months: [m(4, 'unavailable')], events: switched, expected: ['PT', dateNote]},
  {name: 'unknown and unavailable coverage without an events party', months: [m(3, 'unknown'), m(4, 'unavailable')], events: [null, null], expected: ['Partido indisponível', null]},
  {name: 'a changed month publishes both parties', months: [changed], events: switched, expected: ['PL / PT', null]},
  {name: 'a single month and a changed month publish both parties once', months: [m(3, 'single', 'PL'), changed], events: switched, expected: ['PL / PT', null]},
  {name: 'coverage in review after a confirmed month', months: [m(3, 'single', 'PL'), m(4, 'review')], events: switched, expected: ['Partido em revisão', null]},
);

for (const {name, months, events: [current, note], expected} of cases) {
  test(name, () => {
    const {party, partyNote} = partyFieldsOf(months, 'c', current, note);
    assert.deepEqual([party, partyNote], expected);
  });
}

test('the browser loader copies all four summary party fields', async () => {
  const source = await readFile(new URL('../real/data.js', import.meta.url), 'utf8');
  for (const field of ['party', 'partyNote', 'partyInReview', 'lastConfirmedParty']) {
    assert.match(source, new RegExp(`\\b${field}\\s*:\\s*own\\.${field}\\s*[,}]`));
  }
  assert.doesNotMatch(source, /Partido indisponível|Partido em revisão/);
});

test('prerendered deputies copy all four summary party fields for every case', () => {
  for (const {name, months, events: [current, note]} of cases) {
    const fields = partyFieldsOf(months, 'c', current, note);
    const scope = {year: 2025, months: months.map(m => m.month), ids: [1], legislature: 57};
    const summary: SiteSummary = {
      schema: 'clareia.site-summary.v3', publicationId: 'p', coverageId: 'c', scope,
      billsId: null, billsYears: [], votesId: null, votesYears: [], ceiling: null,
      minMonths: 1, totalCents: 0, records: 0, categories: [],
      people: [{
        id: 1, name: 'A', photo: null, cents: 0, records: 0, months, categories: [], cells: [],
        bills: null, votes: null, votesHeld: 0, exercisedMonths: 1, noExercise: false, heldMonths: [], comparable: true,
        ...fields,
      }],
    };
    const [{party, partyNote, partyInReview, lastConfirmedParty}] = deputiesOf({
      ids: scope.ids,
      people: [{id: 1, name: 'A', photo: null, sourceUrl: '', profileFetchedAt: '', party: current, partyNote: note}],
      summary,
      suppliers: {schema: 'clareia.supplier-summary.v1', publicationId: 'p', categories: [], suppliers: [], people: {}},
    });
    assert.deepEqual({party, partyNote, partyInReview, lastConfirmedParty}, fields, name);
  }
});
