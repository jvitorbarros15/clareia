import test from 'node:test';
import assert from 'node:assert/strict';
import {rankingCsv, csvWarning} from '../src/view.ts';

const metadata = {version: 'snapshot-123', year: 2025, period: 'jan–jun 2025', view: 'Ranking de gastos'};
const person = {position: 1, id: 42, name: 'Ana "Silva";\nSouza', uf: 'SP', party: 'ABC', warning: ''};

test('spending CSV quotes every field, repeats metadata and formats integer cents', () => {
  const rows = [
    {...person, value: 123456},
    {...person, name: '=Ana', uf: '+SP', party: '-ABC', warning: '@retido', position: 2, value: -5},
    {...person, name: ' Ana', position: 3, value: 0},
    {...person, name: 'Ana', position: null, value: null}
  ];
  const prefix = '"snapshot-123";"2025";"jan–jun 2025";"Ranking de gastos"';
  assert.equal(rankingCsv({...metadata, unit: 'reais', rows}), [
    '\uFEFF"versao_dados";"ano";"periodo";"visao";"posicao";"id_deputado";"nome";"uf";"partido";"valor_reais";"aviso"',
    `${prefix};"1";"42";"Ana ""Silva"";\nSouza";"SP";"ABC";"1234,56";""`,
    `${prefix};"2";"42";"'=Ana";"'+SP";"'-ABC";"-0,05";"'@retido"`,
    `${prefix};"3";"42";"' Ana";"SP";"ABC";"0,00";""`,
    `${prefix};"";"42";"Ana";"SP";"ABC";"";""`
  ].join('\r\n'));
});

test('projects CSV uses the approved projects header and integer values', () => {
  const rows = [12, 0, null].map(value => ({...person, name: 'Ana', value}));
  const [header, ...lines] = rankingCsv({...metadata, unit: 'projetos', rows}).split('\r\n');
  assert.match(header, /;"projetos_aprovados";"aviso"$/);
  assert.deepEqual(lines.map(line => line.split(';').at(-2)), ['"12"', '"0"', '""']);
});

test('CSV warnings prioritize held months, then exercise review, then partial coverage', () => {
  assert.equal(csvWarning({heldMonths: [0], exerciseReviewMonths: [1], comparable: false}), 'retido');
  assert.equal(csvWarning({heldMonths: [], exerciseReviewMonths: [0], comparable: false}), 'nao_comparavel');
  assert.equal(csvWarning({exerciseReviewMonths: [], comparable: false}), 'parcial');
  assert.equal(csvWarning({comparable: false}), 'parcial');
  assert.equal(csvWarning({comparable: true}), '');
});
