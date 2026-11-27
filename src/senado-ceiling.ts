import {UFS} from './model.ts';

export const SENADO_CEILING_URLS = {
  atc2_2023: 'https://adm.senado.gov.br/normas/ui/pub/normaConsultada?idNorma=14380751',
  ato8_2025: 'https://adm.senado.gov.br/normas/ui/pub/normaConsultada?idNorma=14383699',
  ato8_2025_annex: 'https://www.senado.leg.br/transparencia/SECRH/BASF/Anexo/A_01_2025_1761064.PDF',
} as const;

export const SENATOR_COMPUTED_CEILING_NOTE = 'teto calculado pela Clareia a partir do ATC 2/2023';

export type SenatorCeilingTable = {
  annex2023: Record<string, number>;
  step2024: Record<string, number>;
  feb2025: Record<string, number>;
  annex2025: Record<string, number>;
};

export type SenatorSeatCeiling = {
  codigoMandato: string;
  uf: string | null;
  senatorIds: number[];
  spentCents: number;
  ceilingCents: number;
  monthsWithCeiling: number;
  computedMonths: number;
  note: string | null;
};

export type SeatAggregationInput = {
  senatorId: number;
  months: readonly {month: number; uf: string | null; codigoMandato: string | null}[];
  spendByMonth: ReadonlyMap<number, bigint>;
};

export const SENATOR_CEILING_TABLE: SenatorCeilingTable = {
  annex2023: {
    AC: 4118572,
    AL: 3715957,
    AP: 4542651,
    AM: 4693320,
    BA: 3754117,
    CE: 4047780,
    DF: 2230791,
    ES: 3516720,
    GO: 2230791,
    MA: 3964040,
    MT: 3703052,
    MS: 3487951,
    MG: 3020597,
    PA: 4285177,
    PB: 3768851,
    PR: 3454180,
    PE: 3844260,
    PI: 4116452,
    RJ: 3372517,
    RN: 3813477,
    RS: 3803980,
    RO: 3669211,
    RR: 4316792,
    SC: 3484360,
    SP: 3203977,
    SE: 4435512,
    TO: 2672811,
  },
  step2024: {
    AC: 4365686,
    AL: 3938914,
    AP: 4815210,
    AM: 4974919,
    BA: 3979364,
    CE: 4290647,
    DF: 2364638,
    ES: 3727723,
    GO: 2364638,
    MA: 4201882,
    MT: 3925235,
    MS: 3697228,
    MG: 3201833,
    PA: 4542288,
    PB: 3994982,
    PR: 3661431,
    PE: 4074916,
    PI: 4363439,
    RJ: 3574868,
    RN: 4042286,
    RS: 4032219,
    RO: 3889364,
    RR: 4575800,
    SC: 3693422,
    SP: 3396216,
    SE: 4701643,
    TO: 2833180,
  },
  feb2025: {
    AC: 4633303,
    AL: 4180370,
    AP: 5110382,
    AM: 5279882,
    BA: 4223299,
    CE: 4553663,
    DF: 2509591,
    ES: 3956233,
    GO: 2509591,
    MA: 4459458,
    MT: 4165852,
    MS: 3923868,
    MG: 3398105,
    PA: 4820730,
    PB: 4239874,
    PR: 3885877,
    PE: 4324708,
    PI: 4630918,
    RJ: 3794007,
    RN: 4290078,
    RS: 4279394,
    RO: 4127782,
    RR: 4856296,
    SC: 3919828,
    SP: 3604404,
    SE: 4989853,
    TO: 3006854,
  },
  annex2025: {
    AC: 5042626,
    AL: 4673790,
    AP: 5110382,
    AM: 5279882,
    BA: 4480465,
    CE: 4824557,
    DF: 3658246,
    ES: 4321771,
    GO: 4130086,
    MA: 4794549,
    MT: 4522183,
    MS: 4633664,
    MG: 4188651,
    PA: 4820730,
    PB: 4782636,
    PR: 4466566,
    PE: 4747060,
    PI: 4676557,
    RJ: 4155377,
    RN: 4852579,
    RS: 4666970,
    RO: 4946629,
    RR: 5140633,
    SC: 4567158,
    SP: 4283733,
    SE: 4989853,
    TO: 4529741,
  },
};

const SORTED_UFS = [...UFS].sort();

// Single half-up rounding to the cent; Feb 2025 keeps the 2024 step unrounded before ×1,0613.
export function deriveStep2024Cents(annex2023Cents: number): number {
  return Number((BigInt(annex2023Cents) * 106n + 50n) / 100n);
}

export function deriveFeb2025Cents(annex2023Cents: number): number {
  return Number((BigInt(annex2023Cents) * 106n * 10613n + 500_000n) / 1_000_000n);
}

export function senatorCeiling(
  uf: string,
  year: number,
  month: number,
  table: SenatorCeilingTable = SENATOR_CEILING_TABLE,
): {cents: number; computed: boolean} | null {
  if (!UFS.has(uf) || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  if (year === 2023) {
    if (month >= 3 && Object.hasOwn(table.annex2023, uf)) {
      return {cents: table.annex2023[uf], computed: false};
    }
    return null;
  }
  if (year === 2024) {
    if (month === 1) {
      return Object.hasOwn(table.annex2023, uf) ? {cents: table.annex2023[uf], computed: false} : null;
    }
    return Object.hasOwn(table.step2024, uf) ? {cents: table.step2024[uf], computed: true} : null;
  }
  if (year === 2025) {
    if (month === 1) {
      return Object.hasOwn(table.step2024, uf) ? {cents: table.step2024[uf], computed: true} : null;
    }
    if (month === 2) {
      return Object.hasOwn(table.feb2025, uf) ? {cents: table.feb2025[uf], computed: true} : null;
    }
    return Object.hasOwn(table.annex2025, uf) ? {cents: table.annex2025[uf], computed: false} : null;
  }
  return null;
}

export function auditSenatorCeilings(table: SenatorCeilingTable = SENATOR_CEILING_TABLE): string[] {
  const failures: string[] = [];
  const sections: [keyof SenatorCeilingTable, Record<string, number>][] = [
    ['annex2023', table.annex2023],
    ['step2024', table.step2024],
    ['feb2025', table.feb2025],
    ['annex2025', table.annex2025],
  ];
  for (const [name, map] of sections) {
    if (!map || typeof map !== 'object') {
      failures.push(`${name}:missing-table`);
      continue;
    }
    const keys = Object.keys(map);
    for (const key of keys) {
      if (!UFS.has(key)) failures.push(`${name}:unknown-uf:${key}`);
    }
    if (keys.length !== UFS.size) failures.push(`${name}:uf-count:${keys.length}`);
    for (const uf of SORTED_UFS) {
      if (!Object.hasOwn(map, uf)) {
        failures.push(`${name}:missing:${uf}`);
        continue;
      }
      const value = map[uf];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        failures.push(`${name}:invalid:${uf}`);
      }
    }
  }
  if (table.annex2023 && typeof table.annex2023 === 'object') {
    for (const uf of SORTED_UFS) {
      const base = table.annex2023[uf];
      if (typeof base !== 'number' || !Number.isSafeInteger(base) || base <= 0) continue;
      if (table.step2024?.[uf] !== deriveStep2024Cents(base)) {
        failures.push(`step2024:mismatch:${uf}`);
      }
      if (table.feb2025?.[uf] !== deriveFeb2025Cents(base)) {
        failures.push(`feb2025:mismatch:${uf}`);
      }
    }
  }
  return failures;
}

function toSafeNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Valor em centavos fora da precisão segura');
  return n;
}

export function computeSeatCeilings(
  year: number,
  senators: readonly SeatAggregationInput[],
  table: SenatorCeilingTable = SENATOR_CEILING_TABLE,
): Map<number, {ceiling: SenatorSeatCeiling[]; unassignedCents: number}> {
  const seatAcc = new Map<string, {
    senatorIds: Set<number>;
    monthUfs: Map<number, string | null>;
    spendByMonth: Map<number, bigint>;
  }>();
  const seatsBySenator = new Map<number, Set<string>>();
  const unassignedBySenator = new Map<number, bigint>();

  for (const sen of senators) {
    const seatByMonth = new Map<number, string>();
    const heldSeats = new Set<string>();
    seatsBySenator.set(sen.senatorId, heldSeats);

    for (const m of sen.months) {
      if (m.codigoMandato === null || m.codigoMandato === '') continue;
      const seat = m.codigoMandato;
      const prevSeat = seatByMonth.get(m.month);
      if (prevSeat !== undefined && prevSeat !== seat) {
        throw new Error(`Senador ${sen.senatorId} com mandatos conflitantes em ${year}-${m.month}`);
      }
      seatByMonth.set(m.month, seat);
      heldSeats.add(seat);

      let acc = seatAcc.get(seat);
      if (!acc) {
        acc = {senatorIds: new Set(), monthUfs: new Map(), spendByMonth: new Map()};
        seatAcc.set(seat, acc);
      }
      acc.senatorIds.add(sen.senatorId);
      if (acc.monthUfs.has(m.month)) {
        const existingUf = acc.monthUfs.get(m.month)!;
        if (existingUf !== m.uf) {
          throw new Error(`Conflito de UF no mandato ${seat} em ${year}-${String(m.month).padStart(2, '0')}: ${existingUf} vs ${m.uf}`);
        }
      } else {
        acc.monthUfs.set(m.month, m.uf);
      }
    }

    let unassigned = 0n;
    for (const [month, cents] of sen.spendByMonth) {
      const seat = seatByMonth.get(month);
      if (!seat) {
        unassigned += cents;
      } else {
        const acc = seatAcc.get(seat)!;
        acc.spendByMonth.set(month, (acc.spendByMonth.get(month) ?? 0n) + cents);
      }
    }
    unassignedBySenator.set(sen.senatorId, unassigned);
  }

  const computedSeats = new Map<string, SenatorSeatCeiling>();
  for (const [codigoMandato, acc] of seatAcc) {
    let spentCents = 0n;
    let ceilingCents = 0n;
    let monthsWithCeiling = 0;
    let computedMonths = 0;
    const ufs: string[] = [];

    for (const month of [...acc.monthUfs.keys()].sort((a, b) => a - b)) {
      const uf = acc.monthUfs.get(month) ?? null;
      if (uf && !ufs.includes(uf)) ufs.push(uf);
      const c = uf ? senatorCeiling(uf, year, month, table) : null;
      if (!c) continue;
      ceilingCents += BigInt(c.cents);
      monthsWithCeiling += 1;
      if (c.computed) computedMonths += 1;
      spentCents += acc.spendByMonth.get(month) ?? 0n;
    }

    computedSeats.set(codigoMandato, {
      codigoMandato,
      uf: ufs.length ? ufs.join(' / ') : null,
      senatorIds: [...acc.senatorIds].sort((a, b) => a - b),
      spentCents: toSafeNumber(spentCents),
      ceilingCents: toSafeNumber(ceilingCents),
      monthsWithCeiling,
      computedMonths,
      note: computedMonths > 0 ? SENATOR_COMPUTED_CEILING_NOTE : null,
    });
  }

  const result = new Map<number, {ceiling: SenatorSeatCeiling[]; unassignedCents: number}>();
  for (const sen of senators) {
    const held = [...(seatsBySenator.get(sen.senatorId) ?? [])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const ceiling = held.map(code => {
      const entry = computedSeats.get(code)!;
      return {...entry, senatorIds: [...entry.senatorIds]};
    });
    result.set(sen.senatorId, {
      ceiling,
      unassignedCents: toSafeNumber(unassignedBySenator.get(sen.senatorId) ?? 0n),
    });
  }
  return result;
}
