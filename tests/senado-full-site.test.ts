import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {billsReport} from '../src/bills.ts';
import {scanCpfs} from '../src/cpf-scan.ts';
import {canonical, hash} from '../src/model.ts';
import type {Expense} from '../src/model.ts';
import {senatorPath} from '../src/prerender.ts';
import {parseCeapsYear} from '../src/senado-expenses.ts';
import {auditCeapsYear} from '../src/senado-expenses-audit.ts';
import {deriveSenatorCoverage} from '../src/senate-coverage.ts';
import {votesReport} from '../src/votes.ts';
import {coverageFor} from './senado-coverage-helper.ts';

const execFileAsync = promisify(execFile);
type Envelope = Parameters<typeof deriveSenatorCoverage>[0];

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'senado');
const API_BYTES = new Uint8Array(readFileSync(path.join(FIXTURES, 'ceaps-2025-api-sample.json')));
const MANDATOS: Envelope[] = JSON.parse(readFileSync(path.join(FIXTURES, 'mandatos-sample.json'), 'utf8'));

function record(cents: number, personId: number, index: number): Expense {
  return {
    id: `r${personId}-${index}`,
    personId,
    year: 2025,
    month: 1,
    category: 'TEST',
    supplier: 'Fornecedor',
    supplierKey: 'k',
    supplierVerified: false,
    documentId: '1',
    documentNumber: '1',
    date: null,
    receipt: null,
    cents,
    documentCents: cents,
    disallowedCents: 0,
    source: {url: 'https://dadosabertos.camara.leg.br/api/v2/x', sha256: 's', row: index, fetchedAt: '2025-03-01T00:00:00Z'},
  };
}

async function tree(root: string, dir = root): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await fs.readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, await tree(root, full));
    else out[path.relative(root, full).split(path.sep).join('/')] = (await fs.readFile(full)).toString('base64');
  }
  return out;
}

test('full-site build keeps deputy files and summary byte-identical with or without senators and writes isolated senadores files', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clareia-full-senators-'));
  const repo = path.resolve(import.meta.dirname, '..');
  const script = path.join(repo, 'scripts', 'build-full-site.ts');
  const tsx = import.meta.resolve('tsx');
  const writeJson = async (file: string, data: unknown) => {
    await fs.mkdir(path.dirname(file), {recursive: true});
    await fs.writeFile(file, JSON.stringify(data));
  };
  const suffix = [...randomBytes(8)].map(b => String.fromCharCode(97 + (b % 26))).join('');
  const reviewDir = path.join(repo, 'output', 'review');
  const reviewBefore = new Set(await fs.readdir(reviewDir).catch(() => [] as string[]));
  const reviewFiles: string[] = [];

  try {
    const baseChecked = '2025-03-02T00:00:00.000Z';
    const senatorsChecked = '2025-04-15T00:00:00.000Z';
    const priv = path.join(dir, 'data', 'private');
    const portraits = path.join(dir, 'portraits');
    await fs.mkdir(portraits, {recursive: true});
    await fs.writeFile(path.join(portraits, '1.jpg'), 'jpg');

    const history = {
      scope: {legislature: 57, start: '2025-01-01', end: '2025-01-31', sampleIds: [1, 2]},
      legislature: {id: 57, start: '2023-02-01', end: '2027-01-31'},
      people: [1, 2].map(id => ({id, profile: {name: `Pessoa ${id} ${suffix}`, photo: null, source: {fetchedAt: '2025-03-01T00:00:00Z'}}})),
    };
    const dim = (value: string) => ({status: 'single' as const, value, values: [value], rows: [0]});
    const temporal = {
      schema: 'clareia.people-temporal.v1',
      ruleVersion: 'camara.history-reported-change.v1',
      historySha256: hash(canonical(history)),
      scope: history.scope,
      createdAt: '2025-03-01T00:00:00Z',
      status: 'review-required',
      publicAttributionEnabled: false,
      people: [1, 2].map(id => ({
        id,
        collectionStatus: 'stable',
        events: [],
        intervals: [],
        months: [{year: 2025, month: 1, start: '2025-01-01T00:00:00', end: '2025-02-01T00:00:00', partialScope: false, exercise: 'full', party: dim('PL'), uf: dim('SP'), financialCollection: 'not-collected'}],
        issues: [],
      })),
    };
    const temporalSha256 = hash(canonical(temporal));
    const crosscheck = {
      schema: 'clareia.people-crosscheck.v1',
      legacySha256: hash('l'),
      temporalSha256,
      historySha256: temporal.historySha256,
      discoverySha256: hash('d'),
      scope: history.scope,
      createdAt: '2025-03-01T00:00:00Z',
      status: 'review-required',
      publicAttributionEnabled: false,
      dateSemantics: 'boundary-days-and-open-ends-unconfirmed',
      people: [1, 2].map(id => ({
        id,
        legacyStatus: 'stable',
        partyComparisonStatus: 'compared',
        partyChanges: [],
        months: [{year: 2025, month: 1, v2Exercise: 'full', legacy: 'reported-exercise', periodRows: [0], openEnd: false, comparison: 'no-automatic-resolution'}],
      })),
    };
    const crosscheckSha256 = hash(canonical(crosscheck));
    await writeJson(path.join(priv, 'people-history', 'hist-1', 'history.json'), history);
    await writeJson(path.join(priv, 'people-history', 'hist-1', 'temporal.json'), temporal);
    await writeJson(path.join(priv, 'people-history', 'hist-1', 'temporal-audit.json'), {status: 'passed', temporalSha256, checkedAt: baseChecked});
    await writeJson(path.join(priv, 'people-legacy', 'leg-1', 'crosscheck.json'), crosscheck);
    await writeJson(path.join(priv, 'people-legacy', 'leg-1', 'crosscheck-audit.json'), {status: 'passed', crosscheckSha256, checkedAt: baseChecked});

    const proposal = {schema: 'clareia.expense-lot.v1', year: 2025, months: [1], lot: 0, lotSize: 2, lots: 1, universeSize: 2, universeSha256: hash(canonical([1, 2])), people: [{id: 1}, {id: 2}], temporalSha256, crosscheckSha256};
    const proposalSha256 = hash(canonical(proposal));
    const lotInput = {schema: 'clareia.expense-lot-input.v1', selectionRun: 's', proposal, temporal, originAudit: {}};
    const cells = [
      {personId: 1, year: 2025, month: 1, status: 'complete', records: [record(100, 1, 0), record(250, 1, 1)], reasons: [], totalCents: 350},
      {personId: 2, year: 2025, month: 1, status: 'complete', records: [record(50, 2, 2)], reasons: [], totalCents: 50},
    ];
    const batch = {peopleVersion: temporalSha256, scope: {year: 2025, months: [1], ids: [1, 2], legislature: 57}, proposalSha256, createdAt: '2025-03-01T00:00:00Z', contentSha256: hash('batch-0'), cells};
    const reportSha256 = hash(canonical(batch));
    await writeJson(path.join(priv, 'expense-intermediate', 'lot-0', 'run.json'), {runId: 'lot-0', status: 'review-required', reportSha256, proposalSha256, inputSha256: hash(canonical(lotInput))});
    await writeJson(path.join(priv, 'expense-intermediate', 'lot-0', 'input.json'), lotInput);
    await writeJson(path.join(priv, 'expense-intermediate', 'lot-0', 'batch.json'), batch);
    await writeJson(path.join(priv, 'expense-intermediate', 'lot-0', 'audit.json'), {status: 'passed', reportSha256, proposalSha256, checkedAt: baseChecked, competences: cells.length, scope: batch.scope, peopleVersion: temporalSha256});

    const billsRep = billsReport(2025, {bills: [], people: [], metrics: {propositions: 0, selected: 0, held: 0, orphanAuthorRows: 0, normsResolved: 0, normsUnresolved: 0}}, [], '2025-03-01T00:00:00Z');
    await writeJson(path.join(priv, 'bills', 'bills-2025', 'bills.json'), billsRep);
    await writeJson(path.join(priv, 'bills', 'bills-2025', 'audit.json'), {status: 'passed', contentSha256: billsRep.contentSha256, checkedAt: baseChecked});

    const votesRep = votesReport(2025, {votes: [], ballots: [], metrics: {votes: 0, nominal: 0, reconciled: 0, held: 0, ballots: 0, orphanBallots: 0, categories: {}}}, [], '2025-03-01T00:00:00Z');
    await writeJson(path.join(priv, 'votes', 'votes-2025', 'votes.json'), votesRep);
    await writeJson(path.join(priv, 'votes', 'votes-2025', 'ballots.json'), []);
    await writeJson(path.join(priv, 'votes', 'votes-2025', 'audit.json'), {status: 'passed', contentSha256: votesRep.contentSha256, checkedAt: baseChecked});

    const ceapsCtx = {year: 2025, lastModified: 'Thu, 26 Nov 2026 02:00:00 GMT', etag: '"v1"'};
    const parsed = parseCeapsYear(API_BYTES, ceapsCtx);
    const ceapsAudit = auditCeapsYear(API_BYTES, parsed, ceapsCtx);
    assert.equal(ceapsAudit.ok, true);
    const parsedSha256 = hash(canonical(parsed));
    const coverage = coverageFor(MANDATOS, parsed.records.map(r => r.codSenador).concat(parsed.review.map(i => i.codSenador)), {start: '2025-01-01', end: '2025-12-31'});

    await writeJson(path.join(priv, 'senado-ceaps', 'senado-2025', 'parsed.json'), parsed);
    await writeJson(path.join(priv, 'senado-ceaps', 'senado-2025', 'audit.json'), {...ceapsAudit, checkedAt: senatorsChecked, parsedSha256});
    await writeJson(path.join(priv, 'senado-ceaps', 'senado-2025', 'coverage.json'), coverage);

    await writeJson(path.join(priv, 'senado-ceaps', 'senado-failed', 'parsed.json'), parsed);
    await writeJson(path.join(priv, 'senado-ceaps', 'senado-failed', 'audit.json'), {ok: false, failures: ['tampered'], checkedAt: senatorsChecked, parsedSha256});
    await writeJson(path.join(priv, 'senado-ceaps', 'senado-failed', 'coverage.json'), coverage);

    const baseConfig = {historyRun: 'hist-1', legacyRun: 'leg-1', expenseYears: {'2025': ['lot-0']}, defaultYear: 2025, billsRuns: ['bills-2025'], votesRuns: ['votes-2025']};
    const cfgWithout = path.join(dir, 'config-without.json');
    const cfgWith = path.join(dir, 'config-with.json');
    const cfgFailed = path.join(dir, 'config-failed.json');
    await writeJson(cfgWithout, baseConfig);
    await writeJson(cfgWith, {...baseConfig, senators: {years: {'2025': 'senado-2025'}}});
    await writeJson(cfgFailed, {...baseConfig, senators: {years: {'2025': 'senado-failed'}}});

    const help = await execFileAsync(process.execPath, ['--import', tsx, script, '--help'], {cwd: dir, encoding: 'utf8'});
    assert.match(help.stdout, /senators/);

    const runBuild = async (cfg: string, outDir: string, extra: string[] = []) => {
      const {stdout} = await execFileAsync(
        process.execPath,
        ['--import', tsx, script, '--out', outDir, '--portraits', portraits, '--config', cfg, '--data-root', path.join(dir, 'data'), ...extra],
        {cwd: dir, encoding: 'utf8'},
      );
      const parsedOut = JSON.parse(stdout.trim()) as Record<string, unknown>;
      if (typeof parsedOut.publicationId === 'string') {
        const pubId = parsedOut.publicationId;
        for (const n of ['pendencias-revisao', 'possiveis-duplicidades', 'sinal-corrigido']) {
          const f: string = `${pubId}-${n}.md`;
          assert.equal(reviewBefore.has(f), false, f);
          if (!reviewFiles.includes(f)) reviewFiles.push(f);
        }
      }
      return {raw: stdout, parsed: parsedOut};
    };

    const distWithoutA = path.join(dir, 'dist-without-a');
    const distWithoutB = path.join(dir, 'dist-without-b');
    const distWith = path.join(dir, 'dist-with');

    const dryWithout = await runBuild(cfgWithout, distWithoutA, ['--dry-run']);
    const dryWith = await runBuild(cfgWith, distWith, ['--dry-run']);
    assert.equal(Object.hasOwn(dryWithout.parsed, 'senators'), false);
    assert.equal(dryWith.parsed.built, false);
    const {senators: drySenators, ...dryWithRest} = dryWith.parsed;
    assert.deepEqual(dryWithRest, dryWithout.parsed);
    const drySen = drySenators as {version: string; records: number; years: {year: number; records: number; totalCents: number}[]};
    assert.match(drySen.version, /^[0-9a-f]{64}$/);
    assert.equal(drySen.records, 15);
    assert.deepEqual(drySen.years, [{year: 2025, records: 15, totalCents: 2236272}]);

    await assert.rejects(runBuild(cfgFailed, path.join(dir, 'dist-failed'), ['--dry-run']), /auditoria aprovada/);
    await assert.rejects(runBuild(cfgFailed, path.join(dir, 'dist-failed')), /auditoria aprovada/);

    const withoutA = await runBuild(cfgWithout, distWithoutA);
    const reviewAfterWithout = await Promise.all(
      reviewFiles.map(async f => [f, await fs.readFile(path.join(reviewDir, f), 'utf8').catch(() => null)] as const),
    );
    const withoutB = await runBuild(cfgWithout, distWithoutB);
    assert.equal(withoutA.raw, withoutB.raw);
    assert.deepEqual(await tree(distWithoutA), await tree(distWithoutB));
    assert.equal(Object.hasOwn(withoutA.parsed, 'senators'), false);

    const withSen = await runBuild(cfgWith, distWith);
    const {senators: builtSenators, files: withFiles, ...withSenRest} = withSen.parsed;
    const {files: withoutFiles, ...withoutRest} = withoutA.parsed;
    assert.deepEqual(withSenRest, withoutRest);
    assert.deepEqual(builtSenators, drySenators);

    const withoutTree = await tree(distWithoutA);
    const withTree = await tree(distWith);
    const isSenatorFile = (k: string) => k.startsWith('senadores/') || k.startsWith('senador/');
    assert.equal(Object.keys(withoutTree).some(isSenatorFile), false);
    const senatorFiles = Object.keys(withTree).filter(isSenatorFile);
    assert.equal(withFiles, (withoutFiles as number) + senatorFiles.length);
    const withOutside = Object.fromEntries(Object.entries(withTree).filter(([k]) => !isSenatorFile(k) && k !== 'manifest.json'));
    const withoutOutside = Object.fromEntries(Object.entries(withoutTree).filter(([k]) => k !== 'manifest.json'));
    assert.deepEqual(withOutside, withoutOutside);
    assert.deepEqual(
      Object.keys(withTree).filter(k => k.startsWith('senadores/')).sort(),
      ['senadores/2025.json', 'senadores/index.json'],
    );

    const manifestWithout = JSON.parse(await fs.readFile(path.join(distWithoutA, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    const manifestWith = JSON.parse(await fs.readFile(path.join(distWith, 'manifest.json'), 'utf8')) as {domains: Record<string, unknown>; senators?: unknown; [k: string]: unknown};
    assert.equal(Object.hasOwn(manifestWithout, 'senators'), false);
    assert.equal(manifestWith.senators, true);
    assert.equal(Object.hasOwn(manifestWith.domains, 'senadores'), false);
    const {senators: _senatorsFlag, ...manifestWithRest} = manifestWith;
    assert.deepEqual(manifestWithRest, manifestWithout);

    for (const [f, beforeText] of reviewAfterWithout) {
      const afterText = await fs.readFile(path.join(reviewDir, f), 'utf8').catch(() => null);
      assert.equal(afterText, beforeText, f);
      if (afterText) {
        assert.equal(afterText.includes('Vanderlan'), false, f);
        assert.equal(afterText.includes('Fernando Dueire'), false, f);
      }
    }

    for (const [rel, b64] of Object.entries(withOutside)) {
      if (!/\.(json|csv|html)$/.test(rel)) continue;
      const text = Buffer.from(b64, 'base64').toString('utf8');
      assert.equal(text.includes('Vanderlan Cardoso'), false, rel);
      assert.equal(text.includes('Fernando Dueire'), false, rel);
    }

    for (const rel of ['senadores/2025.json', 'senadores/index.json']) {
      const text = await fs.readFile(path.join(distWith, rel), 'utf8');
      assert.equal(scanCpfs(text, new Set()), 0, rel);
      for (const forbidden of ['detalhamento', 'documento', '***', 'VOE DESTAK', 'Secretaria de Estado de Fazenda']) {
        assert.equal(text.includes(forbidden), false, `${rel}: ${forbidden}`);
      }
    }
    const senYear = JSON.parse(await fs.readFile(path.join(distWith, 'senadores', '2025.json'), 'utf8')) as {
      publishedAt: string;
      totalCents: number;
      records: number;
      senators: {senatorId: number; name: string | null}[];
    };
    assert.equal(senYear.publishedAt, senatorsChecked);
    assert.equal(senYear.totalCents, 2236272);
    assert.equal(senYear.records, 15);
    const expectedSenatorPages = senYear.senators
      .filter((s): s is {senatorId: number; name: string} => typeof s.name === 'string' && s.name.trim().length > 0)
      .map(s => `${senatorPath(s.senatorId, s.name).slice(1)}.html`)
      .sort();
    const actualSenatorPages = Object.keys(withTree).filter(k => k.startsWith('senador/')).sort();
    assert.deepEqual(actualSenatorPages, expectedSenatorPages);
    for (const rel of actualSenatorPages) {
      const text = await fs.readFile(path.join(distWith, rel), 'utf8');
      assert.equal(scanCpfs(text, new Set()), 0, rel);
    }
  } finally {
    for (const f of reviewFiles) await fs.rm(path.join(reviewDir, f), {force: true});
    await fs.rm(dir, {recursive: true, force: true});
  }
});
