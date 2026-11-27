import fs from 'node:fs/promises';
import path from 'node:path';
import {lock as acquireLock} from '../src/lock.ts';
import {readLocalPeopleKey} from '../src/people-history.ts';
import {RUN_ID_RE, collectSenadoExpenses} from '../src/senado-collect.ts';
import {vaultKey} from '../src/vault.ts';

const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? '' : args[i + 1];
};

if (args.includes('--help')) {
  console.log(
    'npm run collect:senado:expenses -- --year 2023..2026 --run ID [--previous-run ID] [--local]\nColeta local cifrada das despesas CEAPS do Senado, sem publicação.',
  );
  process.exit(0);
}

const seen = new Set<string>();
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (seen.has(flag)) throw new Error('Argumento duplicado');
  seen.add(flag);
  if (flag === '--local') continue;
  if (['--year', '--run', '--previous-run'].includes(flag) && args[i + 1] && !args[i + 1].startsWith('--')) {
    i++;
    continue;
  }
  throw new Error('Argumento inválido');
}

const yearRaw = value('--year');
if (!/^(2023|2024|2025|2026)$/.test(yearRaw)) {
  throw new Error('Ano inválido (permitido: 2023..2026)');
}
const year = Number(yearRaw);

const runId = value('--run');
if (!RUN_ID_RE.test(runId)) {
  throw new Error('Run ID inválido');
}

const previousRunId = args.includes('--previous-run') ? value('--previous-run') : undefined;
if (previousRunId !== undefined && !RUN_ID_RE.test(previousRunId)) {
  throw new Error('Previous run ID inválido');
}

const baseDir = path.resolve('data/private/senado-expenses');
const runDir = path.join(baseDir, runId);
const key = args.includes('--local') ? await readLocalPeopleKey() : vaultKey();

await fs.mkdir(runDir, {recursive: true});
const release = await acquireLock(path.join(runDir, 'running.lock'));
try {
  const summary = await collectSenadoExpenses({
    year,
    runId,
    key,
    baseDir,
    exportDir: path.resolve('data/private/senado-ceaps', runId),
    ...(previousRunId !== undefined ? {previousRunId} : {}),
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status === 'failed') {
    process.exitCode = 1;
  }
} finally {
  await release();
}
