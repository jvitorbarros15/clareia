import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {Fetcher} from '../src/senado-collect.ts';
import {
  MAX_PHOTO_BYTES,
  collectSenadoProfiles,
  isAllowedSenadoPhotoUrl,
  parseSenatorAffiliations,
  parseSenatorDetail,
  partyForMonth,
  senatorAffiliationsUrl,
  senatorDetailUrl,
} from '../src/senado-profiles.ts';
import type {SenatorAffiliation} from '../src/senado-profiles.ts';
import {parseCollectProfilesArgs} from '../scripts/collect-senado-profiles.ts';

const VALID_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x90, 0x01, 0x2c, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
]);

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

async function tempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'clareia-senado-profiles-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  return dir;
}

function detailEnvelope(code: number | string, opts: {photo?: unknown; party?: unknown; uf?: unknown} = {}) {
  return {
    DetalheParlamentar: {
      Parlamentar: {
        IdentificacaoParlamentar: {
          CodigoParlamentar: String(code),
          NomeParlamentar: `Senador ${code}`,
          ...(opts.photo !== undefined ? {UrlFotoParlamentar: opts.photo} : {}),
          ...(opts.party !== undefined ? {SiglaPartidoParlamentar: opts.party} : {}),
          ...(opts.uf !== undefined ? {UfParlamentar: opts.uf} : {}),
        },
      },
    },
  };
}

function affiliationsEnvelope(
  code: number | string,
  items: Array<{party: string; start: string; end?: string | null}> | {party: string; start: string; end?: string | null},
) {
  const mapOne = (item: {party: string; start: string; end?: string | null}) => ({
    Partido: {SiglaPartido: item.party},
    DataFiliacao: item.start,
    ...(item.end !== undefined ? {DataDesfiliacao: item.end} : {}),
  });
  return {
    FiliacaoParlamentar: {
      Parlamentar: {
        Codigo: String(code),
        Filiacoes: {
          Filiacao: Array.isArray(items) ? items.map(mapOne) : mapOne(items),
        },
      },
    },
  };
}

test('isAllowedSenadoPhotoUrl accepts only exact https senado hosts without credentials, port or hash', () => {
  for (const ok of [
    'https://www.senado.leg.br/senadores/img/fotos-oficiais/senador5899.jpg',
    'https://legis.senado.leg.br/dadosabertos/senador/5899/foto.jpg',
    'https://www.senado.leg.br/foto.jpg?v=2',
  ]) {
    assert.equal(isAllowedSenadoPhotoUrl(ok), true, ok);
  }

  for (const bad of [
    'http://www.senado.leg.br/senadores/img/fotos-oficiais/senador5899.jpg',
    'http://legis.senado.leg.br/foto.jpg',
    'https://adm.senado.gov.br/foto.jpg',
    'https://senado.leg.br/foto.jpg',
    'https://example.com/foto.jpg',
    'https://www.senado.leg.br.evil.com/foto.jpg',
    'https://legis.senado.leg.br.evil.com/foto.jpg',
    'https://evil.com/www.senado.leg.br/foto.jpg',
    'https://user:pass@www.senado.leg.br/foto.jpg',
    'https://user@www.senado.leg.br/foto.jpg',
    'https://@www.senado.leg.br/foto.jpg',
    'https://www.senado.leg.br:8443/foto.jpg',
    'https://www.senado.leg.br:443/foto.jpg',
    'https://www.senado.leg.br/foto.jpg#section',
    'https://www.senado.leg.br/foto.jpg#',
    'https://www.senado.\tleg.br/foto.jpg',
    ' https://www.senado.leg.br/foto.jpg',
    '',
    'not-a-url',
    'javascript:alert(1)',
    'ftp://www.senado.leg.br/foto.jpg',
  ]) {
    assert.equal(isAllowedSenadoPhotoUrl(bad), false, bad);
  }
});

test('senatorDetailUrl and senatorAffiliationsUrl validate positive safe integers', () => {
  assert.equal(senatorDetailUrl(5899), 'https://legis.senado.leg.br/dadosabertos/senador/5899');
  assert.equal(senatorAffiliationsUrl(5899), 'https://legis.senado.leg.br/dadosabertos/senador/5899/filiacoes');
  assert.equal(senatorDetailUrl(1), 'https://legis.senado.leg.br/dadosabertos/senador/1');

  for (const bad of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => senatorDetailUrl(bad), /Código de senador inválido/);
    assert.throws(() => senatorAffiliationsUrl(bad), /Código de senador inválido/);
  }
});

test('parseSenatorDetail reads official fields, nulls disallowed/missing photos, and rejects mismatch or bad shape', () => {
  const url = 'https://www.senado.leg.br/senadores/img/fotos-oficiais/senador5899.jpg';
  assert.deepEqual(parseSenatorDetail(detailEnvelope(5899, {photo: url, party: 'PSD', uf: 'GO'}), 5899), {
    id: 5899,
    photoUrl: url,
    party: 'PSD',
    uf: 'GO',
  });

  assert.equal(parseSenatorDetail(detailEnvelope(5899, {party: 'PSD', uf: 'GO'}), 5899).photoUrl, null);
  assert.equal(
    parseSenatorDetail(detailEnvelope(5899, {photo: 'http://www.senado.leg.br/senador5899.jpg'}), 5899).photoUrl,
    null,
  );
  assert.equal(
    parseSenatorDetail(detailEnvelope(5899, {photo: 'https://www.senado.leg.br.evil.com/x.jpg'}), 5899).photoUrl,
    null,
  );

  assert.throws(() => parseSenatorDetail(detailEnvelope(1234, {photo: url}), 5899), /Código incompatível/);
  assert.throws(() => parseSenatorDetail(null, 5899));
  assert.throws(() => parseSenatorDetail({}, 5899));
  assert.throws(() => parseSenatorDetail({DetalheParlamentar: {Parlamentar: {}}}, 5899));
});

test('parseSenatorAffiliations handles single object and array shapes and rejects invalid input', () => {
  assert.deepEqual(
    parseSenatorAffiliations(affiliationsEnvelope(5899, {party: 'PSD', start: '2020-03-04'}), 5899),
    [{party: 'PSD', start: '2020-03-04', end: null}],
  );

  assert.deepEqual(
    parseSenatorAffiliations(
      affiliationsEnvelope(5899, [
        {party: 'MDB', start: '2025-05-16', end: null},
        {party: 'PSD', start: '2020-03-04', end: '2025-05-15'},
      ]),
      5899,
    ),
    [
      {party: 'PSD', start: '2020-03-04', end: '2025-05-15'},
      {party: 'MDB', start: '2025-05-16', end: null},
    ],
  );

  assert.throws(() => parseSenatorAffiliations(affiliationsEnvelope(1234, {party: 'PSD', start: '2020-03-04'}), 5899));
  assert.throws(() => parseSenatorAffiliations({}, 5899));
  assert.throws(() => parseSenatorAffiliations(affiliationsEnvelope(5899, {party: '', start: '2020-03-04'}), 5899));
  assert.throws(() => parseSenatorAffiliations(affiliationsEnvelope(5899, {party: 'PSD', start: '2025-02-30'}), 5899));
  assert.throws(() =>
    parseSenatorAffiliations(affiliationsEnvelope(5899, {party: 'PSD', start: '2025-05-10', end: '2025-05-01'}), 5899),
  );
});

test('partyForMonth chooses most days, breaks ties to later start, and returns null outside/unknown/conflict/uncovered', () => {
  const midYearSwitch: SenatorAffiliation[] = [
    {party: 'PSD', start: '2023-02-01', end: '2025-04-15'},
    {party: 'MDB', start: '2025-04-16', end: '2025-08-10'},
    {party: 'UNIÃO', start: '2025-08-11', end: null},
  ];
  // March: PSD full month
  assert.equal(partyForMonth(midYearSwitch, 2025, 3, 'full'), 'PSD');
  // April (30 days): 15 days PSD vs 15 days MDB -> tie goes to later start (MDB)
  assert.equal(partyForMonth(midYearSwitch, 2025, 4, 'full'), 'MDB');
  // Order independent tie-break
  assert.equal(partyForMonth([...midYearSwitch].reverse(), 2025, 4, 'partial'), 'MDB');
  // August (31 days): 10 days MDB vs 21 days UNIÃO -> UNIÃO
  assert.equal(partyForMonth(midYearSwitch, 2025, 8, 'full'), 'UNIÃO');
  // Before any affiliation
  assert.equal(partyForMonth(midYearSwitch, 2023, 1, 'full'), null);
  // Non-exercised statuses always return null
  for (const exercise of ['outside', 'unknown', 'conflict'] as const) {
    assert.equal(partyForMonth(midYearSwitch, 2025, 3, exercise), null, exercise);
  }
  assert.equal(partyForMonth([], 2025, 3, 'full'), null);
});

test('collectSenadoProfiles fetches with redirect:manual, handles redirects/failures/existing files, and refuses CPF', async t => {
  const dir = await tempDir(t);
  const ceapsBaseDir = path.join(dir, 'senado-ceaps');
  const outBaseDir = path.join(dir, 'senado-profiles');
  const portraitsDir = path.join(dir, 'portraits');
  await fs.mkdir(path.join(ceapsBaseDir, 'ceaps-2025'), {recursive: true});
  await fs.mkdir(path.join(ceapsBaseDir, 'ceaps-2026'), {recursive: true});
  await fs.mkdir(portraitsDir, {recursive: true});

  await fs.writeFile(
    path.join(ceapsBaseDir, 'ceaps-2025', 'coverage.json'),
    JSON.stringify([{id: 5899}, {id: 1001}, {id: 1002}]),
  );
  await fs.writeFile(
    path.join(ceapsBaseDir, 'ceaps-2026', 'coverage.json'),
    JSON.stringify([{id: 5899}, {id: 1003}, {id: 1004}, {id: 1005}]),
  );

  // Pre-existing portrait for 1001 must never be overwritten.
  const existingBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await fs.writeFile(path.join(portraitsDir, 'sen-1001.jpg'), existingBytes);

  const calls: Array<{url: string; redirect?: RequestRedirect}> = [];
  const fetcher: Fetcher = async (url, init) => {
    assert.equal(init?.redirect, 'manual', `redirect must be manual for ${url}`);
    calls.push({url, redirect: init?.redirect});

    if (url === senatorDetailUrl(1001)) {
      return Response.json(detailEnvelope(1001, {photo: 'https://www.senado.leg.br/p1001.jpg'}));
    }
    if (url === senatorAffiliationsUrl(1001)) {
      return Response.json(affiliationsEnvelope(1001, {party: 'PT', start: '2023-01-01'}));
    }
    if (url === senatorDetailUrl(1002)) {
      // Redirects to an allowed host
      return Response.json(detailEnvelope(1002, {photo: 'https://www.senado.leg.br/old/1002.jpg'}));
    }
    if (url === senatorAffiliationsUrl(1002)) {
      return Response.json(affiliationsEnvelope(1002, {party: 'PL', start: '2023-01-01'}));
    }
    if (url === 'https://www.senado.leg.br/old/1002.jpg') {
      return new Response('', {status: 302, headers: {location: 'https://legis.senado.leg.br/new/1002.jpg'}});
    }
    if (url === 'https://legis.senado.leg.br/new/1002.jpg') {
      return new Response(VALID_JPEG, {status: 200});
    }
    if (url === senatorDetailUrl(1003)) {
      // Redirects to a disallowed host -> must not fetch evil.com, no file written
      return Response.json(detailEnvelope(1003, {photo: 'https://www.senado.leg.br/bad-redirect.jpg'}));
    }
    if (url === senatorAffiliationsUrl(1003)) {
      return Response.json(affiliationsEnvelope(1003, {party: 'MDB', start: '2023-01-01'}));
    }
    if (url === 'https://www.senado.leg.br/bad-redirect.jpg') {
      return new Response('', {status: 302, headers: {location: 'https://evil.com/1003.jpg'}});
    }
    if (url === senatorDetailUrl(1004)) {
      // Returns non-JPEG bytes
      return Response.json(detailEnvelope(1004, {photo: 'https://www.senado.leg.br/not-jpeg.jpg'}));
    }
    if (url === senatorAffiliationsUrl(1004)) {
      return Response.json(affiliationsEnvelope(1004, {party: 'PDT', start: '2023-01-01'}));
    }
    if (url === 'https://www.senado.leg.br/not-jpeg.jpg') {
      return new Response(Buffer.from('<html>not a jpeg</html>'), {status: 200});
    }
    if (url === senatorDetailUrl(1005)) {
      // Returns oversize > 2MB
      return Response.json(detailEnvelope(1005, {photo: 'https://www.senado.leg.br/huge.jpg'}));
    }
    if (url === senatorAffiliationsUrl(1005)) {
      return Response.json(affiliationsEnvelope(1005, {party: 'PP', start: '2023-01-01'}));
    }
    if (url === 'https://www.senado.leg.br/huge.jpg') {
      const big = Buffer.alloc(MAX_PHOTO_BYTES + 10);
      big[0] = 0xff;
      big[1] = 0xd8;
      big[2] = 0xff;
      return new Response(big, {status: 200});
    }
    if (url === senatorDetailUrl(5899)) {
      return Response.json(detailEnvelope(5899, {photo: 'https://www.senado.leg.br/senador5899.jpg'}));
    }
    if (url === senatorAffiliationsUrl(5899)) {
      return Response.json(
        affiliationsEnvelope(5899, [
          {party: 'PSD', start: '2020-03-04', end: '2025-06-30'},
          {party: 'MDB', start: '2025-07-01', end: null},
        ]),
      );
    }
    if (url === 'https://www.senado.leg.br/senador5899.jpg') {
      return new Response(VALID_JPEG, {status: 200});
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const result = await collectSenadoProfiles({
    runId: 'profiles-2026',
    ceapsRuns: ['ceaps-2025', 'ceaps-2026'],
    portraitsDir,
    ceapsBaseDir,
    outBaseDir,
    fetcher,
  });

  assert.equal(result.senators, 6);
  assert.equal(result.photosDownloaded, 2); // 1002 and 5899
  assert.equal(result.photosSkipped, 1); // 1001 already existed
  assert.equal(result.photosFailed, 3); // 1003 bad redirect, 1004 non-JPEG, 1005 oversize
  assert.equal(calls.some(c => c.url.includes('evil.com')), false);
  assert.equal(calls.some(c => c.url === 'https://www.senado.leg.br/p1001.jpg'), false);

  assert.deepEqual(await fs.readFile(path.join(portraitsDir, 'sen-1001.jpg')), existingBytes);
  assert.deepEqual(await fs.readFile(path.join(portraitsDir, 'sen-1002.jpg')), VALID_JPEG);
  assert.deepEqual(await fs.readFile(path.join(portraitsDir, 'sen-5899.jpg')), VALID_JPEG);
  assert.deepEqual((await fs.readdir(portraitsDir)).sort(), ['sen-1001.jpg', 'sen-1002.jpg', 'sen-5899.jpg']);

  const written = JSON.parse(await fs.readFile(path.join(outBaseDir, 'profiles-2026', 'profiles.json'), 'utf8'));
  assert.equal(written.schema, 'clareia.senado-profiles.v1');
  assert.deepEqual(written.senators.map((s: {id: number}) => s.id), [1001, 1002, 1003, 1004, 1005, 5899]);

  // CPF refusal: profiles.json must not be written.
  const cpfCeaps = path.join(ceapsBaseDir, 'cpf-run');
  await fs.mkdir(cpfCeaps, {recursive: true});
  await fs.writeFile(path.join(cpfCeaps, 'coverage.json'), JSON.stringify([{id: 7777}]));
  await assert.rejects(
    collectSenadoProfiles({
      runId: 'profiles-cpf',
      ceapsRuns: ['cpf-run'],
      portraitsDir,
      ceapsBaseDir,
      outBaseDir,
      fetcher: async url => {
        if (url === senatorDetailUrl(7777)) return Response.json(detailEnvelope(7777, {}));
        if (url === senatorAffiliationsUrl(7777)) {
          return Response.json(affiliationsEnvelope(7777, {party: `PT ${syntheticCpf(9)}`, start: '2023-01-01'}));
        }
        throw new Error(`Unexpected ${url}`);
      },
    }),
    /CPF detectado/,
  );
  await assert.rejects(fs.access(path.join(outBaseDir, 'profiles-cpf', 'profiles.json')));
});

test('CLI arg parser accepts valid flags and rejects duplicates and bad values', () => {
  assert.deepEqual(
    parseCollectProfilesArgs(['--run', 'p1', '--ceaps-run', 'c25,c26', '--portraits', 'ret', '--local']),
    {help: false, runId: 'p1', ceapsRuns: ['c25', 'c26'], portraitsDir: 'ret', local: true},
  );
  assert.equal(parseCollectProfilesArgs(['--help']).help, true);

  for (const bad of [
    ['--run', 'p1', '--run', 'p2', '--ceaps-run', 'c25', '--portraits', 'ret'],
    ['--run', '../p1', '--ceaps-run', 'c25', '--portraits', 'ret'],
    ['--run', 'p1', '--ceaps-run', 'c25,c25', '--portraits', 'ret'],
    ['--run', 'p1', '--ceaps-run', '../bad', '--portraits', 'ret'],
    ['--run', 'p1', '--ceaps-run', '--portraits', 'ret'],
    ['--run', 'p1', '--ceaps-run', 'c25'],
    ['--run', 'p1', '--ceaps-run', 'c25', '--portraits', 'ret', '--unknown'],
  ]) {
    assert.throws(() => parseCollectProfilesArgs(bad), /inválid|duplicad/i);
  }
});
