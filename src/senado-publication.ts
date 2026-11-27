import fs from 'node:fs/promises';
import path from 'node:path';
import {scanCpfs} from './cpf-scan.ts';
import {canonical, hash} from './model.ts';
import type {Domain} from './publications.ts';
import {
  auditSenatorCeilings,
  computeSeatCeilings,
  SENATOR_CEILING_TABLE,
} from './senado-ceiling.ts';
import type {SenatorCeilingTable, SenatorSeatCeiling} from './senado-ceiling.ts';
import type {CeapsParsed, CeapsRecord, CeapsReviewItem} from './senado-expenses.ts';
import {partyForMonth} from './senado-profiles.ts';
import type {SenadoProfilesFile, SenatorAffiliation} from './senado-profiles.ts';
import type {deriveSenatorCoverage, SenatorMonth} from './senate-coverage.ts';
import type {DB} from './store.ts';

export type SenatorsAudit = {
  ok: boolean;
  failures: string[];
  checkedAt: string;
  parsedSha256: string;
};

export type SenatorCoverage = ReturnType<typeof deriveSenatorCoverage>;

export type SenatorsYearRun = {
  year: number;
  parsed: CeapsParsed;
  audit: SenatorsAudit;
  coverage: SenatorCoverage[];
  profiles?: SenadoProfilesFile;
};

export type SenatorExerciseMonth = {
  month: number;
  exercise: SenatorMonth['exercise'];
  uf: string | null;
  party?: string | null;
  codigoMandato: string | null;
  participation: string | null;
};

export type SenatorReviewCounts = {
  'empty-type': number;
  'kept-company': number;
  withheld: number;
  'possible-duplicate': number;
};

export type SenatorYearRecord = {
  senatorId: number;
  year: number;
  name: string | null;
  totalCents: number;
  unassignedCents: number;
  records: number;
  byType: Record<string, number>;
  byMonth: Record<string, Record<string, number>>;
  suppliers: Record<string, number>;
  months: SenatorExerciseMonth[];
  ceiling: SenatorSeatCeiling[];
  review: SenatorReviewCounts;
};

export type SenatorsYearSource = {
  year: number;
  parsedSha256: string;
  evidenceSha256: string;
  checkedAt: string;
};

export type SenatorsVersion = {
  schema: 'clareia.senators-version.v1';
  id: string;
  metric: 'senado.ceaps.v1';
  scope: {
    years: number[];
    senators: number;
    records: number;
  };
  sources: SenatorsYearSource[];
  collectedAt: string;
  publishedAt: string;
  rows: SenatorYearRecord[];
};

const PERSON_LABEL = 'Fornecedor pessoa física';
const WITHHELD_LABEL = 'Nome não exibido pelo Clareia';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m || Number.isNaN(Date.parse(value))) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const contentId = (v: Pick<SenatorsVersion, 'schema' | 'metric' | 'scope' | 'rows'>) =>
  hash(canonical({schema: v.schema, metric: v.metric, scope: v.scope, rows: v.rows}));

function supplierLabel(record: CeapsRecord): string {
  if (record.supplierKind === 'withheld') return WITHHELD_LABEL;
  if (record.supplierKind === 'person') return PERSON_LABEL;
  return record.supplier;
}

function toSafeNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Valor em centavos fora da precisão segura');
  return n;
}

function sortedRecord(map: Map<string, bigint>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()]
      .map(([k, v]) => [k, toSafeNumber(v)]),
  );
}

function buildYearRows(
  run: SenatorsYearRun,
  ceilingTable: SenatorCeilingTable = SENATOR_CEILING_TABLE,
): SenatorYearRecord[] {
  const {year, parsed, coverage} = run;
  let affiliationsById: Map<number, SenatorAffiliation[]> | null = null;
  if (run.profiles !== undefined) {
    if (
      !run.profiles ||
      typeof run.profiles !== 'object' ||
      run.profiles.schema !== 'clareia.senado-profiles.v1' ||
      !Array.isArray(run.profiles.senators)
    ) {
      throw new Error(`Senadores de ${year}: perfis inválidos`);
    }
    affiliationsById = new Map<number, SenatorAffiliation[]>();
    for (const entry of run.profiles.senators) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.id !== 'number' ||
        !Number.isSafeInteger(entry.id) ||
        entry.id < 1 ||
        !Array.isArray(entry.affiliations) ||
        affiliationsById.has(entry.id)
      ) {
        throw new Error(`Senadores de ${year}: perfis inválidos`);
      }
      affiliationsById.set(entry.id, entry.affiliations);
    }
  }
  const covById = new Map<number, SenatorCoverage>();
  for (const entry of coverage) {
    if (covById.has(entry.id)) throw new Error(`Cobertura de senador repetida em ${year}: ${entry.id}`);
    covById.set(entry.id, entry);
  }

  const ids = new Set<number>();
  for (const c of coverage) ids.add(c.id);
  for (const r of parsed.records) {
    if (!covById.has(r.codSenador)) throw new Error(`Senadores de ${year}: senador ${r.codSenador} sem cobertura`);
    ids.add(r.codSenador);
  }
  for (const item of parsed.review) {
    if (!covById.has(item.codSenador)) throw new Error(`Senadores de ${year}: senador ${item.codSenador} sem cobertura`);
    ids.add(item.codSenador);
  }

  const recordsBySenator = new Map<number, CeapsRecord[]>();
  for (const r of parsed.records) {
    const list = recordsBySenator.get(r.codSenador);
    if (list) list.push(r); else recordsBySenator.set(r.codSenador, [r]);
  }

  const reviewBySenator = new Map<number, CeapsReviewItem[]>();
  for (const item of parsed.review) {
    const list = reviewBySenator.get(item.codSenador);
    if (list) list.push(item); else reviewBySenator.set(item.codSenador, [item]);
  }

  const drafts: {
    base: Omit<SenatorYearRecord, 'ceiling' | 'unassignedCents'>;
    spendByMonth: Map<number, bigint>;
  }[] = [];
  for (const senatorId of [...ids].sort((a, b) => a - b)) {
    const recs = recordsBySenator.get(senatorId) ?? [];
    const byType = new Map<string, bigint>();
    const byMonth = new Map<number, Map<string, bigint>>();
    const spendByMonth = new Map<number, bigint>();
    const suppliers = new Map<string, bigint>();
    let totalCents = 0n;
    let included = 0;

    for (const r of recs) {
      if (r.excludedFromTotals) continue;
      if (typeof r.tipoDespesa !== 'string' || !r.tipoDespesa.trim()) {
        throw new Error(`Despesa sem tipo fora de excludedFromTotals em ${year}: ${r.id}`);
      }
      if (typeof r.cents !== 'number' || !Number.isSafeInteger(r.cents)) {
        throw new Error(`Valor inválido em centavos em ${year}: ${r.id}`);
      }
      const amount = BigInt(r.cents);
      totalCents += amount;
      included++;
      byType.set(r.tipoDespesa, (byType.get(r.tipoDespesa) ?? 0n) + amount);
      spendByMonth.set(r.month, (spendByMonth.get(r.month) ?? 0n) + amount);
      let monthMap = byMonth.get(r.month);
      if (!monthMap) {
        monthMap = new Map<string, bigint>();
        byMonth.set(r.month, monthMap);
      }
      monthMap.set(r.tipoDespesa, (monthMap.get(r.tipoDespesa) ?? 0n) + amount);
      const label = supplierLabel(r);
      suppliers.set(label, (suppliers.get(label) ?? 0n) + amount);
    }

    const review: SenatorReviewCounts = {
      'empty-type': 0,
      'kept-company': 0,
      withheld: 0,
      'possible-duplicate': 0,
    };
    for (const item of reviewBySenator.get(senatorId) ?? []) {
      if (item.kind === 'empty-type') review['empty-type'] += item.count;
      else if (item.kind === 'possible-duplicate') review['possible-duplicate'] += item.ids.length;
      else if (item.kind === 'kept-company') review['kept-company'] += 1;
      else if (item.kind === 'withheld') review.withheld += 1;
    }

    const cov = covById.get(senatorId);
    const months: SenatorExerciseMonth[] = cov
      ? cov.months
          .filter(m => m.year === year)
          .sort((a, b) => a.month - b.month)
          .map(m => ({
            month: m.month,
            exercise: m.exercise,
            uf: m.uf,
            codigoMandato: m.codigoMandato,
            participation: m.participation,
            ...(affiliationsById !== null
              ? {party: partyForMonth(affiliationsById.get(senatorId) ?? [], year, m.month, m.exercise)}
              : {}),
          }))
      : [];

    const byMonthObj: Record<string, Record<string, number>> = {};
    for (const month of [...byMonth.keys()].sort((a, b) => a - b)) {
      byMonthObj[String(month)] = sortedRecord(byMonth.get(month)!);
    }

    drafts.push({
      base: {
        senatorId,
        year,
        name: cov ? cov.name : null,
        totalCents: toSafeNumber(totalCents),
        records: included,
        byType: sortedRecord(byType),
        byMonth: byMonthObj,
        suppliers: sortedRecord(suppliers),
        months,
        review,
      },
      spendByMonth,
    });
  }

  const seatsBySenator = computeSeatCeilings(
    year,
    drafts.map(d => ({
      senatorId: d.base.senatorId,
      months: d.base.months,
      spendByMonth: d.spendByMonth,
    })),
    ceilingTable,
  );

  return drafts.map(({base}) => {
    const info = seatsBySenator.get(base.senatorId)!;
    return {
      ...base,
      unassignedCents: info.unassignedCents,
      ceiling: info.ceiling,
    };
  });
}

export function buildSenatorsVersion(
  runs: SenatorsYearRun[],
  builtAt: string,
  ceilingTable: SenatorCeilingTable = SENATOR_CEILING_TABLE,
): SenatorsVersion {
  const ceilingFailures = auditSenatorCeilings(ceilingTable);
  if (ceilingFailures.length > 0) {
    throw new Error(`Tabela de tetos do Senado inválida: ${ceilingFailures.join(', ')}`);
  }
  if (!runs.length) throw new Error('Nenhum ano de senadores informado');
  const sorted = [...runs].sort((a, b) => a.year - b.year);
  const years = sorted.map(r => r.year);
  if (new Set(years).size !== years.length) throw new Error('Ano de senadores repetido');

  const rows: SenatorYearRecord[] = [];
  const sources: SenatorsYearSource[] = [];

  for (const run of sorted) {
    const {year, parsed, audit, coverage} = run;
    if (!Number.isInteger(year)) throw new Error(`Ano de senadores inválido: ${year}`);
    if (!audit || audit.ok !== true || !Array.isArray(audit.failures) || audit.failures.length > 0) {
      throw new Error(`Senadores de ${year} sem auditoria aprovada`);
    }
    if (!isIsoDate(audit.checkedAt)) {
      throw new Error(`Senadores de ${year} sem checkedAt ISO válido`);
    }
    const parsedSha256 = hash(canonical(parsed));
    if (audit.parsedSha256 !== parsedSha256) {
      throw new Error(`Senadores de ${year}: parsedSha256 diverge do conteúdo`);
    }
    if (!Array.isArray(coverage)) {
      throw new Error(`Senadores de ${year}: cobertura inválida`);
    }
    for (const entry of coverage) {
      if (!Array.isArray(entry.issues) || entry.issues.length > 0) {
        throw new Error(`Senadores de ${year}: cobertura de ${entry.id} com pendências (${(entry.issues ?? []).join(', ')})`);
      }
    }
    for (const rec of parsed.records) {
      if (rec.year !== year) {
        throw new Error(`Senadores de ${year}: registro ${rec.id} é de ${rec.year}`);
      }
    }

    rows.push(...buildYearRows(run, ceilingTable));
    sources.push({
      year,
      parsedSha256,
      evidenceSha256: parsed.evidence.sha256,
      checkedAt: new Date(audit.checkedAt).toISOString(),
    });
  }

  const scope = {
    years,
    senators: new Set(rows.map(r => r.senatorId)).size,
    records: rows.reduce((s, r) => s + r.records, 0),
  };
  const collectedAt = sources.map(s => s.checkedAt).sort()[0];
  const body = {
    schema: 'clareia.senators-version.v1' as const,
    metric: 'senado.ceaps.v1' as const,
    scope,
    rows,
  };
  const version: SenatorsVersion = {
    ...body,
    id: contentId(body),
    sources,
    collectedAt,
    publishedAt: builtAt,
  };
  if (scanCpfs(canonical(version), new Set()) !== 0) {
    throw new Error('Identificador privado na publicação de senadores');
  }
  return version;
}

export function senatorsSummary(version: SenatorsVersion): {
  version: string;
  records: number;
  years: {year: number; records: number; totalCents: number}[];
} {
  return {
    version: version.id,
    records: version.scope.records,
    years: version.scope.years.map(year => {
      const yr = version.rows.filter(r => r.year === year);
      return {
        year,
        records: yr.reduce((s, r) => s + r.records, 0),
        totalCents: yr.reduce((s, r) => s + r.totalCents, 0),
      };
    }),
  };
}

export async function readSenatorRows(db: DB, id: string): Promise<SenatorYearRecord[]> {
  return (await db.query<{record: SenatorYearRecord}>(
    'SELECT record FROM senators_v1 WHERE publication_id=$1 ORDER BY position',
    [id],
  )).rows.map(r => r.record);
}

export async function storeSenatorsVersion(db: DB, version: SenatorsVersion): Promise<void> {
  const {rows, ...body} = version;
  if (version.id !== contentId(version)) {
    throw new Error('Identificador de senadores não corresponde ao conteúdo');
  }
  await db.query('BEGIN');
  try {
    const created = await db.query<{id: string}>(
      'INSERT INTO publications(id,domain,body) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id',
      [version.id, 'senadores', JSON.stringify(body)],
    );
    if (created.rows[0]) {
      for (let start = 0; start < rows.length; start += 2000) {
        await db.query(
          `INSERT INTO senators_v1(publication_id,position,senator_id,year,record) SELECT $1,$2::integer+ord::integer-1,(r->>'senatorId')::integer,(r->>'year')::integer,r FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS rows(r,ord)`,
          [version.id, start, JSON.stringify(rows.slice(start, start + 2000))],
        );
      }
    } else if (canonical(await readSenatorRows(db, version.id)) !== canonical(rows)) {
      throw new Error('Versão de senadores já gravada com conteúdo diferente');
    }
    const check = await db.query<{n: string}>(
      'SELECT count(*)::text AS n FROM senators_v1 WHERE publication_id=$1',
      [version.id],
    );
    if (Number(check.rows[0].n) !== rows.length) {
      throw new Error('Reconciliação SQL de senadores falhou');
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

export async function reobserveSenatorsVersion(db: DB, id: string): Promise<void> {
  await db.query(
    `UPDATE publications SET seq=nextval(pg_get_serial_sequence('publications','seq')) WHERE id=$1 AND domain='senadores'`,
    [id],
  );
}

// Re-reads SQL independently, verifies content hash, column alignment, arithmetic invariants, CPF absence and source totals.
export async function auditSenatorsVersion(
  db: DB,
  id: string,
  runs: SenatorsYearRun[],
): Promise<{status: 'passed' | 'failed'; failures: string[]; checkedAt: string}> {
  const failures: string[] = [];
  const checkedAt = new Date().toISOString();
  const body = (await db.query<{body: Omit<SenatorsVersion, 'rows'>}>(
    `SELECT body FROM publications WHERE id=$1 AND domain='senadores'`,
    [id],
  )).rows[0]?.body;
  if (!body) return {status: 'failed', failures: ['version-missing'], checkedAt};

  const sqlRows = (await db.query<{senator_id: number; year: number; record: SenatorYearRecord}>(
    'SELECT senator_id, year, record FROM senators_v1 WHERE publication_id=$1 ORDER BY position',
    [id],
  )).rows;
  const rows = sqlRows.map(r => r.record);

  if (contentId({schema: body.schema, metric: body.metric, scope: body.scope, rows}) !== id) {
    failures.push('content-id');
  }
  if (sqlRows.some(r => r.senator_id !== r.record.senatorId || r.year !== r.record.year)) {
    failures.push('columns-drift');
  }
  if (scanCpfs(canonical({body, rows}), new Set()) !== 0) {
    failures.push('cpf-in-output');
  }

  for (const row of rows) {
    const key = `${row.year}:${row.senatorId}`;
    const total = BigInt(row.totalCents);
    const typeSum = Object.values(row.byType).reduce((s, v) => s + BigInt(v), 0n);
    const supplierSum = Object.values(row.suppliers).reduce((s, v) => s + BigInt(v), 0n);
    const monthByType = new Map<string, bigint>();
    let monthSum = 0n;
    for (const types of Object.values(row.byMonth)) {
      for (const [tipo, cents] of Object.entries(types)) {
        const amt = BigInt(cents);
        monthSum += amt;
        monthByType.set(tipo, (monthByType.get(tipo) ?? 0n) + amt);
      }
    }
    const monthMatchesType =
      monthByType.size === Object.keys(row.byType).length &&
      [...monthByType.entries()].every(([k, v]) => Object.hasOwn(row.byType, k) && BigInt(row.byType[k]) === v);
    if (typeSum !== total || supplierSum !== total || monthSum !== total || !monthMatchesType) {
      failures.push(`arithmetic-${key}`);
    }
  }

  const expectedRows = [...runs].sort((a, b) => a.year - b.year).flatMap(r => buildYearRows(r));
  const expectedByKey = new Map(expectedRows.map(r => [`${r.year}:${r.senatorId}`, r]));
  if (rows.length !== expectedRows.length) failures.push('row-count');
  for (const row of rows) {
    const key = `${row.year}:${row.senatorId}`;
    const exp = expectedByKey.get(key);
    if (!exp || canonical(row) !== canonical(exp)) failures.push(`mismatch-${key}`);
  }
  const expectedScope = {
    years: [...runs].map(r => r.year).sort((a, b) => a - b),
    senators: new Set(expectedRows.map(r => r.senatorId)).size,
    records: expectedRows.reduce((s, r) => s + r.records, 0),
  };
  if (canonical(body.scope) !== canonical(expectedScope)) failures.push('scope');

  for (const run of runs) {
    let cents = 0n;
    let count = 0;
    const perSenator = new Map<number, bigint>();
    for (const r of run.parsed.records) {
      if (r.excludedFromTotals) continue;
      cents += BigInt(r.cents);
      count++;
      perSenator.set(r.codSenador, (perSenator.get(r.codSenador) ?? 0n) + BigInt(r.cents));
    }
    const yearRows = rows.filter(r => r.year === run.year);
    if (
      yearRows.reduce((s, r) => s + BigInt(r.totalCents), 0n) !== cents ||
      yearRows.reduce((s, r) => s + r.records, 0) !== count ||
      yearRows.some(r => BigInt(r.totalCents) !== (perSenator.get(r.senatorId) ?? 0n))
    ) {
      failures.push(`source-total-${run.year}`);
    }
  }

  return {status: failures.length ? 'failed' : 'passed', failures, checkedAt};
}

export async function writeSenatorsSite(
  db: DB,
  outDir: string,
  publicationId: string,
  photoIds: Set<number> = new Set(),
): Promise<string[]> {
  const r = await db.query<{domain: Domain; body: Omit<SenatorsVersion, 'rows'>; status: string | null}>(
    'SELECT p.domain,p.body,a.status FROM publications p LEFT JOIN publication_audits a ON a.publication_id=p.id WHERE p.id=$1 AND p.id NOT IN (SELECT publication_id FROM withheld_publications)',
    [publicationId],
  );
  const row = r.rows[0];
  if (!row || row.domain !== 'senadores') throw new Error(`Versão de senadores ${publicationId} não encontrada`);
  if (row.status !== 'passed') throw new Error(`Versão de senadores ${publicationId} sem auditoria aprovada`);

  const rows = await readSenatorRows(db, publicationId);
  if (contentId({schema: row.body.schema, metric: row.body.metric, scope: row.body.scope, rows}) !== publicationId) {
    throw new Error('Senadores no banco diferem da versão aprovada');
  }
  if (rows.some(item => !Number.isSafeInteger(item.unassignedCents) || !Array.isArray(item.ceiling))) {
    throw new Error('Versão de senadores sem dados de teto; gere, audite e ative uma nova publicação');
  }

  const byYear = new Map<number, SenatorYearRecord[]>();
  for (const item of rows) {
    const list = byYear.get(item.year);
    if (list) list.push(item); else byYear.set(item.year, [item]);
  }

  const files: {name: string; json: string}[] = [];
  const indexYears: {year: number; file: string; senators: number; records: number; totalCents: number}[] = [];

  for (const year of row.body.scope.years) {
    const senators = [...(byYear.get(year) ?? [])]
      .sort((a, b) => a.senatorId - b.senatorId)
      .map(s => ({
        ...s,
        photo: photoIds.has(s.senatorId) ? `/senadores/portraits/${s.senatorId}.jpg` : null,
      }));
    const records = senators.reduce((s, x) => s + x.records, 0);
    const totalCents = senators.reduce((s, x) => s + x.totalCents, 0);
    const file = `${year}.json`;
    const json = JSON.stringify({
      schema: 'clareia.senators-year.v1',
      publicationId,
      year,
      collectedAt: row.body.collectedAt,
      publishedAt: row.body.publishedAt,
      totalCents,
      records,
      senators,
    });
    if (scanCpfs(json, new Set()) !== 0) {
      throw new Error(`Identificador privado nos senadores de ${year}`);
    }
    files.push({name: file, json});
    indexYears.push({year, file, senators: senators.length, records, totalCents});
  }

  const indexJson = JSON.stringify({
    schema: 'clareia.senators-index.v1',
    publicationId,
    metric: row.body.metric,
    collectedAt: row.body.collectedAt,
    publishedAt: row.body.publishedAt,
    years: indexYears,
  });
  if (scanCpfs(indexJson, new Set()) !== 0) {
    throw new Error('Identificador privado no índice de senadores');
  }
  files.push({name: 'index.json', json: indexJson});

  const dir = path.join(outDir, 'senadores');
  await fs.mkdir(dir, {recursive: true});
  for (const f of files) {
    await fs.writeFile(path.join(dir, f.name), f.json);
  }
  return files.map(f => path.join(dir, f.name));
}
