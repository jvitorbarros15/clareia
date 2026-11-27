import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {canonical, hash} from '../src/model.ts';
import {ceapsYearUrl, collectSenadoExpenses, exportSenadoBuildFiles, senatorMandatesUrl} from '../src/senado-collect.ts';
import type {Fetcher} from '../src/senado-collect.ts';
import {parseCeapsYear} from '../src/senado-expenses.ts';
import {buildSenatorsVersion} from '../src/senado-publication.ts';

const fixtures = path.join(import.meta.dirname, 'fixtures', 'senado');
const apiBytes = readFileSync(path.join(fixtures, 'ceaps-2025-api-sample.json'));
const mandates = JSON.parse(readFileSync(path.join(fixtures, 'mandatos-sample.json'), 'utf8')) as
  Array<{MandatoParlamentar: {Parlamentar: {Codigo: string; Nome: string}}}>;
const mandatesByUrl = new Map(mandates.map(envelope => [
  senatorMandatesUrl(Number(envelope.MandatoParlamentar.Parlamentar.Codigo)),
  JSON.stringify(envelope),
]));
const files = ['parsed.json', 'audit.json', 'coverage.json'];
const year = 2025;
const runId = 'export-test';

const fetcher: Fetcher = async (url, init) => {
  assert.equal(new Headers(init?.headers).get('accept'), 'application/json');
  if (url === ceapsYearUrl(year)) return new Response(apiBytes);
  const match = /\/senador\/(\d+)\/mandatos$/.exec(url);
  assert.ok(match);
  const code = match[1];
  assert.equal(url, senatorMandatesUrl(Number(code)));
  return new Response(mandatesByUrl.get(url) ?? JSON.stringify({
    MandatoParlamentar: {Parlamentar: {
      Codigo: code,
      Nome: `Senador de teste ${code}`,
      Mandatos: {Mandato: {
        CodigoMandato: code,
        PrimeiraLegislaturaDoMandato: {DataInicio: '2023-02-01'},
        SegundaLegislaturaDoMandato: {DataFim: '2031-01-31'},
        Exercicios: {Exercicio: {DataInicio: '2023-02-01'}},
      }},
    }},
  }));
};

async function setup(t: test.TestContext, exportOnCollect = false) {
  const dir = await fs.mkdtemp(path.join(import.meta.dirname, 'senado-export-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const baseDir = path.join(dir, 'captures');
  const runDir = path.join(baseDir, runId);
  const outDir = path.join(dir, 'build');
  const key = randomBytes(32);
  const summary = await collectSenadoExpenses({
    year, runId, key, baseDir, fetcher, ...(exportOnCollect ? {exportDir: outDir} : {}),
  });
  assert.equal(summary.status, 'review-required');
  assert.deepEqual(summary.mandatesMissing, []);
  return {runDir, outDir, key, summary};
}

test('collector export feeds the senators build and can be reproduced byte for byte', async t => {
  const {runDir, outDir, key} = await setup(t, true);
  const original = await Promise.all(files.map(name => fs.readFile(path.join(outDir, name))));
  const [parsed, audit, coverage] = original.map(bytes => JSON.parse(bytes.toString('utf8')));
  const version = buildSenatorsVersion([{year, parsed, audit, coverage}], audit.checkedAt);
  assert.ok(version.rows.length > 0);
  const metaPath = path.join(runDir, 'pass-2', `${hash(ceapsYearUrl(year))}.meta.json`);
  assert.equal(audit.checkedAt, JSON.parse(await fs.readFile(metaPath, 'utf8')).fetchedAt);
  assert.deepEqual(await fs.readdir(outDir).then(names => names.sort()), [...files].sort());

  const second = `${outDir}-second`;
  assert.equal(await exportSenadoBuildFiles({runDir, outDir: second, key}), year);
  assert.deepEqual(await Promise.all(files.map(name => fs.readFile(path.join(second, name)))), original);

  await exportSenadoBuildFiles({runDir, outDir, key, renameDir: async () => assert.fail('unexpected rename')});
  assert.deepEqual(await Promise.all(files.map(name => fs.readFile(path.join(outDir, name)))), original);
});

test('refusals preserve existing output or leave no output and no staging folder', async t => {
  const {runDir, outDir, key, summary} = await setup(t);
  const options = {runDir, outDir, key};
  const summaryPath = path.join(runDir, 'summary.json');
  const base = String(100000000 + 19 * 7919);
  const digit = (digits: string) => {
    const rest = [...digits].reduce((sum, value, i) => sum + Number(value) * (digits.length + 1 - i), 0) * 10 % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = base + digit(base);
  const cpf = first + digit(first);

  async function refuse(result: Promise<unknown>, message: string) {
    await assert.rejects(result, (err: Error) => {
      assert.equal(err.message, message);
      assert.ok(!err.message.includes(cpf));
      for (const envelope of mandates) {
        assert.ok(!err.message.includes(envelope.MandatoParlamentar.Parlamentar.Nome));
      }
      return true;
    });
    const siblings = await fs.readdir(path.dirname(outDir));
    assert.ok(siblings.every(name => !name.endsWith('.tmp')));
  }

  for (const overrides of [
    {status: 'failed'},
    {status: 'held'},
    {audit: {...summary.audit, ok: false}},
    {mandatesMissing: [1]},
  ]) {
    await fs.writeFile(summaryPath, canonical({...summary, ...overrides}));
    await refuse(exportSenadoBuildFiles(options), 'Resumo da execução não permite exportação');
    await assert.rejects(fs.stat(outDir), {code: 'ENOENT'});
  }
  await fs.writeFile(summaryPath, canonical(summary));

  const audit = t.mock.fn(() => ({ok: false, failures: ['x']}));
  await refuse(exportSenadoBuildFiles({...options, audit}), 'Auditoria da captura não aprovada');
  assert.equal(audit.mock.callCount(), 1);
  await assert.rejects(fs.stat(outDir), {code: 'ENOENT'});

  await refuse(exportSenadoBuildFiles({
    ...options,
    parse: (bytes, context) => {
      const parsed = parseCeapsYear(bytes, context);
      parsed.records[0].supplier = cpf;
      return parsed;
    },
    audit: () => ({ok: true, failures: []}),
  }), 'CPF detectado nos arquivos de exportação');
  await assert.rejects(fs.stat(outDir), {code: 'ENOENT'});

  const renameError = new Error('Falha ao renomear diretório');
  const renameDir = t.mock.fn(async (staging: string, dest: string) => {
    assert.equal(path.dirname(staging), path.dirname(outDir));
    assert.ok(staging.startsWith(`${outDir}.`) && staging.endsWith('.tmp'));
    assert.deepEqual((await fs.readdir(staging)).sort(), [...files].sort());
    assert.equal(dest, outDir);
    await assert.rejects(fs.stat(outDir), {code: 'ENOENT'});
    throw renameError;
  });
  await refuse(exportSenadoBuildFiles({...options, renameDir}), renameError.message);
  assert.equal(renameDir.mock.callCount(), 1);
  await assert.rejects(fs.stat(outDir), {code: 'ENOENT'});

  await fs.mkdir(outDir);
  const old = Buffer.from('conteúdo anterior');
  for (const name of files) await fs.writeFile(path.join(outDir, name), old);
  await refuse(exportSenadoBuildFiles(options), 'Diretório de exportação já existe com conteúdo diferente');
  for (const name of files) assert.deepEqual(await fs.readFile(path.join(outDir, name)), old);
  await fs.rm(outDir, {recursive: true});

  const firstMandate = mandatesByUrl.keys().next().value!;
  await fs.unlink(path.join(runDir, 'mandates', `${hash(firstMandate)}.sealed`));
  await refuse(exportSenadoBuildFiles(options), 'Mandato ausente ou inválido para exportação');
  await assert.rejects(fs.stat(outDir), {code: 'ENOENT'});
});
