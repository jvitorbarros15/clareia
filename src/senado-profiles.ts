import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {scanCpfs} from './cpf-scan.ts';
import {canonical, readLimited} from './model.ts';
import {RUN_ID_RE} from './senado-collect.ts';
import type {Fetcher} from './senado-collect.ts';
import type {SenatorMonth} from './senate-coverage.ts';

export const MAX_PHOTO_BYTES = 2_000_000;
const MAX_JSON_BYTES = 2_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const DAY_MS = 86_400_000;
const ALLOWED_PHOTO_HOSTS = new Set(['www.senado.leg.br', 'legis.senado.leg.br']);

export type SenatorDetail = {
  id: number;
  photoUrl: string | null;
  party: string | null;
  uf: string | null;
};

export type SenatorAffiliation = {
  party: string;
  start: string;
  end: string | null;
};

export type SenatorProfileRecord = {
  id: number;
  affiliations: SenatorAffiliation[];
};

export type SenadoProfilesFile = {
  schema: 'clareia.senado-profiles.v1';
  senators: SenatorProfileRecord[];
};

export type CollectSenadoProfilesOptions = {
  runId: string;
  ceapsRuns: string[];
  portraitsDir: string;
  ceapsBaseDir?: string;
  outBaseDir?: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
};

export type CollectSenadoProfilesResult = {
  runId: string;
  senators: number;
  photosDownloaded: number;
  photosSkipped: number;
  photosFailed: number;
  outFile: string;
  profiles: SenadoProfilesFile;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertSenatorCode(code: number): void {
  if (typeof code !== 'number' || !Number.isSafeInteger(code) || code < 1) {
    throw new Error('Código de senador inválido');
  }
}

function matchesCode(raw: unknown, expected: number): boolean {
  if (typeof raw === 'number') return raw === expected;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return /^\d+$/.test(trimmed) && Number(trimmed) === expected;
  }
  return false;
}

function parseDay(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? NaN : date.valueOf();
}

function optionalTrimmedString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`Campo inválido: ${field}`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isJpegBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function isAllowedSenadoPhotoUrl(url: string): boolean {
  if (typeof url !== 'string' || !url || url.trim() !== url) return false;
  if (/[\u0000-\u001f\u007f]/.test(url) || url.includes('#')) return false;
  const authorityMatch = /^https:\/\/([^/?#\\]+)(?:[/?]|$)/i.exec(url);
  if (!authorityMatch || !ALLOWED_PHOTO_HOSTS.has(authorityMatch[1].toLowerCase())) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (!ALLOWED_PHOTO_HOSTS.has(parsed.hostname)) return false;
  if (parsed.username || parsed.password || parsed.port || parsed.hash) return false;
  return true;
}

export function senatorDetailUrl(code: number): string {
  assertSenatorCode(code);
  return `https://legis.senado.leg.br/dadosabertos/senador/${code}`;
}

export function senatorAffiliationsUrl(code: number): string {
  assertSenatorCode(code);
  return `https://legis.senado.leg.br/dadosabertos/senador/${code}/filiacoes`;
}

export function parseSenatorDetail(envelope: unknown, code: number): SenatorDetail {
  assertSenatorCode(code);
  if (!isPlainObject(envelope)) throw new Error('Detalhe de senador inválido');
  const detail = envelope.DetalheParlamentar;
  if (!isPlainObject(detail)) throw new Error('DetalheParlamentar ausente');
  const parl = detail.Parlamentar;
  if (!isPlainObject(parl)) throw new Error('Parlamentar ausente no detalhe');
  const ident = parl.IdentificacaoParlamentar;
  if (!isPlainObject(ident)) throw new Error('IdentificacaoParlamentar ausente');
  const rawCode = ident.CodigoParlamentar ?? parl.Codigo;
  if (!matchesCode(rawCode, code)) throw new Error(`Código incompatível no detalhe do senador ${code}`);

  const rawPhoto = optionalTrimmedString(ident.UrlFotoParlamentar, 'UrlFotoParlamentar');
  const photoUrl = rawPhoto !== null && isAllowedSenadoPhotoUrl(rawPhoto) ? rawPhoto : null;
  const party = optionalTrimmedString(ident.SiglaPartidoParlamentar, 'SiglaPartidoParlamentar');
  const uf = optionalTrimmedString(ident.UfParlamentar, 'UfParlamentar');
  return {id: code, photoUrl, party, uf};
}

export function parseSenatorAffiliations(envelope: unknown, code: number): SenatorAffiliation[] {
  assertSenatorCode(code);
  if (!isPlainObject(envelope)) throw new Error('Filiações de senador inválidas');
  const root = envelope.FiliacaoParlamentar;
  if (!isPlainObject(root)) throw new Error('FiliacaoParlamentar ausente');
  const parl = root.Parlamentar;
  if (!isPlainObject(parl)) throw new Error('Parlamentar ausente nas filiações');
  const rawCode = parl.Codigo ?? parl.CodigoParlamentar;
  if (!matchesCode(rawCode, code)) throw new Error(`Código incompatível nas filiações do senador ${code}`);
  const filiacoes = parl.Filiacoes;
  if (!isPlainObject(filiacoes)) throw new Error('Filiacoes ausente');
  const rawList = filiacoes.Filiacao;
  if (rawList === undefined || rawList === null) throw new Error('Filiacao ausente');
  const items = Array.isArray(rawList) ? rawList : [rawList];

  const out: SenatorAffiliation[] = [];
  for (const item of items) {
    if (!isPlainObject(item)) throw new Error('Entrada de filiação inválida');
    const partido = item.Partido;
    if (!isPlainObject(partido)) throw new Error('Partido ausente na filiação');
    const party = optionalTrimmedString(partido.SiglaPartido, 'SiglaPartido');
    if (party === null) throw new Error('SiglaPartido ausente na filiação');
    const start = optionalTrimmedString(item.DataFiliacao, 'DataFiliacao');
    const startMs = parseDay(start);
    if (start === null || Number.isNaN(startMs)) throw new Error('DataFiliacao inválida');
    const end = optionalTrimmedString(item.DataDesfiliacao, 'DataDesfiliacao');
    if (end !== null) {
      const endMs = parseDay(end);
      if (Number.isNaN(endMs) || endMs < startMs) throw new Error('DataDesfiliacao inválida');
    }
    out.push({party, start, end});
  }
  out.sort((a, b) => a.start.localeCompare(b.start) || (a.end ?? '').localeCompare(b.end ?? '') || a.party.localeCompare(b.party));
  return out;
}

export function partyForMonth(
  affiliations: readonly SenatorAffiliation[],
  year: number,
  month: number,
  exercise: SenatorMonth['exercise'],
): string | null {
  if (exercise !== 'full' && exercise !== 'partial') return null;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;

  const monthStart = Date.UTC(year, month - 1, 1);
  const monthEnd = Date.UTC(year, month, 0);
  let best: {party: string; days: number; start: number} | null = null;
  let tied = false;

  for (const aff of affiliations) {
    const party = typeof aff.party === 'string' ? aff.party.trim() : '';
    if (!party) continue;
    const startMs = parseDay(aff.start);
    const endMs = aff.end === null ? Infinity : parseDay(aff.end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) continue;
    const from = Math.max(startMs, monthStart);
    const to = Math.min(endMs, monthEnd);
    if (to < from) continue;
    const days = Math.floor((to - from) / DAY_MS) + 1;
    if (!best || days > best.days || (days === best.days && startMs > best.start)) {
      best = {party, days, start: startMs};
      tied = false;
    } else if (days === best.days && startMs === best.start && party !== best.party) {
      tied = true;
    }
  }
  return best && !tied ? best.party : null;
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

async function fetchJson(url: string, fetcher: Fetcher, timeoutMs: number): Promise<unknown> {
  const response = await fetcher(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'clareia-senado-profiles',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${response.status} em ${url}`);
  }
  const bytes = await readLimited(response, MAX_JSON_BYTES);
  return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}

async function downloadPhoto(
  url: string,
  destFile: string,
  fetcher: Fetcher,
  timeoutMs: number,
): Promise<'downloaded' | 'exists' | 'failed'> {
  let current = url;
  const tmpFile = `${destFile}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    if (await fileExists(destFile)) return 'exists';
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isAllowedSenadoPhotoUrl(current)) return 'failed';
      const res = await fetcher(current, {
        headers: {'User-Agent': 'clareia-senado-profiles'},
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        const location = res.headers.get('location');
        if (!location || hop === MAX_REDIRECTS || location.includes('#') || location.trim() !== location || /[\u0000-\u001f\u007f]/.test(location)) return 'failed';
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          return 'failed';
        }
        if (/^https?:/i.test(location) && !isAllowedSenadoPhotoUrl(location)) return 'failed';
        if (/^[\/\\]{2}/.test(location) && !isAllowedSenadoPhotoUrl(`https:${location}`)) return 'failed';
        if (!isAllowedSenadoPhotoUrl(next.href)) return 'failed';
        current = next.href;
        continue;
      }
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => {});
        return 'failed';
      }
      response = res;
      break;
    }
    if (!response) return 'failed';
    const bytes = await readLimited(response, MAX_PHOTO_BYTES);
    if (!isJpegBytes(bytes)) return 'failed';
    await fs.mkdir(path.dirname(destFile), {recursive: true});
    await fs.writeFile(tmpFile, bytes, {flag: 'wx'});
    try {
      await fs.link(tmpFile, destFile);
      await fs.unlink(tmpFile);
      return 'downloaded';
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {});
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
      return 'failed';
    }
  } catch {
    await fs.unlink(tmpFile).catch(() => {});
    return 'failed';
  }
}

export async function collectSenadoProfiles(options: CollectSenadoProfilesOptions): Promise<CollectSenadoProfilesResult> {
  const {runId, ceapsRuns, portraitsDir} = options;
  if (!RUN_ID_RE.test(runId)) throw new Error('Run ID inválido');
  if (!Array.isArray(ceapsRuns) || !ceapsRuns.length || !ceapsRuns.every(r => RUN_ID_RE.test(r)) || new Set(ceapsRuns).size !== ceapsRuns.length) {
    throw new Error('CEAPS run ID inválido');
  }
  if (!portraitsDir) throw new Error('Pasta de retratos inválida');

  const ceapsBaseDir = options.ceapsBaseDir ?? path.resolve('data/private/senado-ceaps');
  const outBaseDir = options.outBaseDir ?? path.resolve('data/private/senado-profiles');
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const idSet = new Set<number>();
  for (const ceapsRun of ceapsRuns) {
    const file = path.join(ceapsBaseDir, ceapsRun, 'coverage.json');
    const raw: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!Array.isArray(raw)) throw new Error(`coverage.json inválido: ${file}`);
    for (const entry of raw) {
      if (!isPlainObject(entry) || typeof entry.id !== 'number' || !Number.isSafeInteger(entry.id) || entry.id < 1) {
        throw new Error(`Entrada inválida em ${file}`);
      }
      idSet.add(entry.id);
    }
  }
  const ids = [...idSet].sort((a, b) => a - b);

  const senators: SenatorProfileRecord[] = [];
  let photosDownloaded = 0;
  let photosSkipped = 0;
  let photosFailed = 0;

  for (const id of ids) {
    const detailEnv = await fetchJson(senatorDetailUrl(id), fetcher, timeoutMs);
    const detail = parseSenatorDetail(detailEnv, id);
    const affEnv = await fetchJson(senatorAffiliationsUrl(id), fetcher, timeoutMs);
    const affiliations = parseSenatorAffiliations(affEnv, id);
    senators.push({id, affiliations});

    if (detail.photoUrl === null) {
      photosSkipped++;
      continue;
    }
    const status = await downloadPhoto(
      detail.photoUrl,
      path.join(portraitsDir, `sen-${id}.jpg`),
      fetcher,
      timeoutMs,
    );
    if (status === 'downloaded') photosDownloaded++;
    else if (status === 'exists') photosSkipped++;
    else photosFailed++;
  }

  const profiles: SenadoProfilesFile = {
    schema: 'clareia.senado-profiles.v1',
    senators,
  };
  const text = canonical(profiles);
  if (scanCpfs(text, new Set()) !== 0) {
    throw new Error('CPF detectado em profiles.json');
  }

  const runDir = path.join(outBaseDir, runId);
  const outFile = path.join(runDir, 'profiles.json');
  const tmpFile = path.join(runDir, `.profiles.json.${randomBytes(6).toString('hex')}.tmp`);
  await fs.mkdir(runDir, {recursive: true});
  try {
    await fs.writeFile(tmpFile, text, {mode: 0o600});
    await fs.rename(tmpFile, outFile);
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => {});
    throw err;
  }

  return {
    runId,
    senators: senators.length,
    photosDownloaded,
    photosSkipped,
    photosFailed,
    outFile,
    profiles,
  };
}
