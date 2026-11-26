type RankingCsvInput = {
  version: string;
  year: number;
  period: string;
  view: string;
  unit: 'projetos' | 'reais';
  rows: readonly {
    position: number | null;
    id: number;
    name: string;
    uf: string;
    party: string;
    value: number | null;
    warning: string;
  }[];
};

export function rankingCsv({version, year, period, view, unit, rows}: RankingCsvInput): string {
  const spending = unit === 'reais';
  const cell = (value: string | number | null, numeric = false) => {
    let text = String(value ?? '');
    if (!numeric && typeof value === 'string' && /^[\s=+@\-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const header = ['versao_dados', 'ano', 'periodo', 'visao', 'posicao', 'id_deputado', 'nome', 'uf', 'partido', spending ? 'valor_reais' : 'projetos_aprovados', 'aviso'];
  const metadata = [version, year, period, view].map(value => cell(value));
  return '\uFEFF' + [header.map(value => cell(value)).join(';'), ...rows.map(row => {
    let value: string | number | null = row.value;
    if (spending && row.value !== null) {
      const digits = String(Math.abs(row.value)).padStart(3, '0');
      value = `${row.value < 0 ? '-' : ''}${digits.slice(0, -2)},${digits.slice(-2)}`;
    }
    return [...metadata, cell(row.position), cell(row.id), cell(row.name), cell(row.uf), cell(row.party), cell(value, true), cell(row.warning)].join(';');
  })].join('\r\n');
}

export function csvWarning(person: {heldMonths?: readonly number[]; exerciseReviewMonths?: readonly number[]; comparable: boolean}): string {
  if (person.heldMonths?.length) return 'retido';
  if (person.exerciseReviewMonths?.length) return 'nao_comparavel';
  return person.comparable === false ? 'parcial' : '';
}
