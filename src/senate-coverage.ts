import {nextDay} from './people-temporal.ts';

type Exercise = {DataInicio?: unknown; DataFim?: unknown};
type Mandate = {
  CodigoMandato?: string | number | null;
  UfParlamentar?: string | null;
  DescricaoParticipacao?: string | null;
  PrimeiraLegislaturaDoMandato?: {DataInicio?: unknown};
  SegundaLegislaturaDoMandato?: {DataFim?: unknown};
  Exercicios?: {Exercicio?: Exercise | Exercise[]};
};
type Envelope = {MandatoParlamentar: {Parlamentar: {
  Codigo: string | number;
  Nome: string;
  Mandatos: {Mandato: Mandate | Mandate[]};
}}};

export type SenatorMonth = {
  year: number;
  month: number;
  start: string;
  end: string;
  partialScope: boolean;
  exercise: 'full' | 'partial' | 'outside' | 'unknown' | 'conflict';
  uf: string | null;
  codigoMandato: string | null;
  participation: string | null;
};

const dayMs = 86_400_000;

function parseDay(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? NaN : date.valueOf();
}

export function deriveSenatorCoverage(envelope: Envelope, scope: {start: string; end: string}) {
  const {Codigo, Nome, Mandatos} = envelope.MandatoParlamentar.Parlamentar;
  const issues = new Set<string>();
  const mandates: {start: number; end: number}[] = [];
  const exercises: {start: number; end: number; mandate: Mandate}[] = [];
  for (const mandate of [Mandatos.Mandato].flat()) {
    if (mandate.CodigoMandato == null || mandate.CodigoMandato === '') continue;
    const start = parseDay(mandate.PrimeiraLegislaturaDoMandato?.DataInicio);
    const end = parseDay(mandate.SegundaLegislaturaDoMandato?.DataFim);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) issues.add('invalid-mandate-date');
    else mandates.push({start, end});

    for (const exercise of [mandate.Exercicios?.Exercicio ?? []].flat()) {
      const start = parseDay(exercise.DataInicio);
      const end = 'DataFim' in exercise ? parseDay(exercise.DataFim) : Infinity;
      if (Number.isNaN(start) || Number.isNaN(end) || end < start) issues.add('invalid-exercise-date');
      else exercises.push({start, end, mandate});
    }
  }

  const blocked = issues.size > 0;
  const conflicts: {start: number; end: number}[] = [];
  if (!blocked) {
    exercises.sort((a, b) => a.start - b.start);
    let latestEnd = -Infinity;
    for (const {start, end} of exercises) {
      const overlapEnd = Math.min(end, latestEnd);
      if (start < overlapEnd) conflicts.push({start, end: overlapEnd});
      latestEnd = Math.max(latestEnd, end);
    }
    if (conflicts.length) issues.add('overlapping-exercises');
  }

  const scopeStart = parseDay(scope.start);
  const scopeEnd = parseDay(nextDay(scope.end));
  const months: SenatorMonth[] = [];
  const monthStart = new Date(scopeStart);
  monthStart.setUTCDate(1);
  while (monthStart.valueOf() < scopeEnd) {
    const year = monthStart.getUTCFullYear();
    const month = monthStart.getUTCMonth() + 1;
    const first = monthStart.valueOf();
    const last = monthStart.setUTCMonth(month);
    const start = Math.max(first, scopeStart);
    const end = Math.min(last, scopeEnd);
    let exercise: SenatorMonth['exercise'] = 'unknown';
    let selected: Mandate | undefined;
    if (!blocked && conflicts.some(range => range.start < end && range.end >= start)) {
      exercise = 'conflict';
    } else if (!blocked && mandates.some(range => range.start < end && range.end >= start)) {
      const active = exercises.filter(range => range.start < end && range.end >= start);
      const daysByMandate = new Map<Mandate, number>();
      let coveredDays = 0;
      for (let day = start; day < end; day += dayMs) {
        const covering = new Set(active.filter(range => range.start <= day && day <= range.end).map(range => range.mandate));
        if (covering.size) coveredDays++;
        for (const mandate of covering) daysByMandate.set(mandate, (daysByMandate.get(mandate) ?? 0) + 1);
      }

      exercise = coveredDays === 0 ? 'outside' : coveredDays * dayMs === end - start ? 'full' : 'partial';
      let mostDays = 0;
      for (const [mandate, days] of daysByMandate) {
        if (!selected || days > mostDays || (days === mostDays && String(mandate.CodigoMandato) < String(selected.CodigoMandato))) {
          selected = mandate;
          mostDays = days;
        }
      }
    }
    months.push({
      year, month,
      start: new Date(start).toISOString().slice(0, -5),
      end: new Date(end).toISOString().slice(0, -5),
      partialScope: start !== first || end !== last,
      exercise,
      uf: selected?.UfParlamentar ?? null,
      codigoMandato: selected ? String(selected.CodigoMandato) : null,
      participation: selected?.DescricaoParticipacao ?? null,
    });
  }
  return {id: Number(Codigo), name: Nome, months, issues: [...issues].sort()};
}
