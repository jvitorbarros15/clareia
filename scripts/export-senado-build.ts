import path from 'node:path';
import {readLocalPeopleKey} from '../src/people-history.ts';
import {RUN_ID_RE, exportSenadoBuildFiles} from '../src/senado-collect.ts';
import {vaultKey} from '../src/vault.ts';

const args = process.argv.slice(2);
const seen = new Set<string>();
let runId = '';
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (seen.has(flag)) throw new Error('Argumento duplicado');
  seen.add(flag);
  if (flag === '--local' || flag === '--help') continue;
  if (flag !== '--run') throw new Error('Argumento inválido');
  runId = args[++i] ?? '';
  if (!RUN_ID_RE.test(runId) || runId.startsWith('--')) throw new Error('Run ID inválido');
}

if (seen.has('--help')) {
  console.log('npm run export:senado:build -- --run ID [--local]');
  process.exit(0);
}
if (!RUN_ID_RE.test(runId)) throw new Error('Run ID inválido');

const key = seen.has('--local') ? await readLocalPeopleKey() : vaultKey();
const year = await exportSenadoBuildFiles({
  runDir: path.resolve('data/private/senado-expenses', runId),
  outDir: path.resolve('data/private/senado-ceaps', runId),
  key,
});
console.log(runId, year, 'parsed.json', 'audit.json', 'coverage.json');
