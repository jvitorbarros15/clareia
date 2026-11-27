import {deriveSenatorCoverage} from '../src/senate-coverage.ts';

type Envelope = Parameters<typeof deriveSenatorCoverage>[0];

// Covers every fixture senator: the real sample envelopes plus clones of the first one for the other ids.
export function coverageFor(mandatos: Envelope[], codes: number[], period: {start: string; end: string}) {
  const real = mandatos.map(env => deriveSenatorCoverage(env, period));
  const have = new Set(real.map(c => c.id));
  const extra = [...new Set(codes)].filter(code => !have.has(code)).map(code => {
    const env = structuredClone(mandatos[0]);
    env.MandatoParlamentar.Parlamentar.Codigo = String(code);
    env.MandatoParlamentar.Parlamentar.Nome = `Senador ${code}`;
    return deriveSenatorCoverage(env, period);
  });
  return [...real, ...extra];
}
