import path from 'node:path';
import {RUN_ID_RE} from '../src/senado-collect.ts';
import {collectSenadoProfiles} from '../src/senado-profiles.ts';

export type CollectProfilesCliArgs = {
  help: boolean;
  runId: string;
  ceapsRuns: string[];
  portraitsDir: string;
  local: boolean;
};

export function parseCollectProfilesArgs(args: string[]): CollectProfilesCliArgs {
  const seen = new Set<string>();
  let runId = '';
  let ceapsRaw = '';
  let portraitsDir = '';
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error('Argumento duplicado');
    seen.add(flag);
    if (flag === '--local' || flag === '--help') continue;
    if (flag === '--run') {
      runId = args[++i] ?? '';
      if (!RUN_ID_RE.test(runId) || runId.startsWith('--')) throw new Error('Run ID inválido');
      continue;
    }
    if (flag === '--ceaps-run') {
      ceapsRaw = args[++i] ?? '';
      const parts = ceapsRaw.split(',');
      if (!ceapsRaw || !parts.every(r => RUN_ID_RE.test(r) && !r.startsWith('--')) || new Set(parts).size !== parts.length) {
        throw new Error('CEAPS run ID inválido');
      }
      continue;
    }
    if (flag === '--portraits') {
      portraitsDir = args[++i] ?? '';
      if (!portraitsDir || portraitsDir.startsWith('--')) throw new Error('Pasta de retratos inválida');
      continue;
    }
    throw new Error('Argumento inválido');
  }
  if (seen.has('--help')) {
    return {help: true, runId: '', ceapsRuns: [], portraitsDir: '', local: seen.has('--local')};
  }
  if (!RUN_ID_RE.test(runId)) throw new Error('Run ID inválido');
  const ceapsRuns = ceapsRaw.split(',');
  if (!ceapsRaw || !ceapsRuns.every(r => RUN_ID_RE.test(r) && !r.startsWith('--')) || new Set(ceapsRuns).size !== ceapsRuns.length) {
    throw new Error('CEAPS run ID inválido');
  }
  if (!portraitsDir) throw new Error('Pasta de retratos inválida');
  return {help: false, runId, ceapsRuns, portraitsDir, local: seen.has('--local')};
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const parsed = parseCollectProfilesArgs(process.argv.slice(2));
  if (parsed.help) {
    console.log('npm run collect:senado:profiles -- --run ID --ceaps-run ID[,ID...] --portraits PASTA [--local]');
    process.exit(0);
  }
  const result = await collectSenadoProfiles({
    runId: parsed.runId,
    ceapsRuns: parsed.ceapsRuns,
    portraitsDir: path.resolve(parsed.portraitsDir),
  });
  console.log(JSON.stringify({
    runId: result.runId,
    senators: result.senators,
    photosDownloaded: result.photosDownloaded,
    photosSkipped: result.photosSkipped,
    photosFailed: result.photosFailed,
    outFile: result.outFile,
  }));
}
