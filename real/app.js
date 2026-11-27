(() => {
  'use strict';
  const D = window.ClareiaData;
  // Wordmark outlines (Arial Black, -1.5px tracking at 30px) so it renders the same without the font.
  const logo = '<svg class="logo-mark" viewBox="0 0 128.83 30" role="img" aria-label="Clareia"><path d="M13.4 20.79 19.07 21.44Q18.6 23.21 17.53 24.5Q16.46 25.8 14.8 26.52Q13.14 27.24 10.58 27.24Q8.1 27.24 6.45 26.77Q4.8 26.31 3.62 25.28Q2.43 24.25 1.76 22.86Q1.08 21.46 1.08 19.16Q1.08 16.76 1.9 15.17Q2.5 13.99 3.54 13.06Q4.58 12.13 5.68 11.68Q7.43 10.96 10.15 10.96Q13.96 10.96 15.96 12.32Q17.96 13.69 18.76 16.31L13.15 17.06Q12.89 16.06 12.19 15.55Q11.5 15.05 10.33 15.05Q8.85 15.05 7.93 16.11Q7.02 17.17 7.02 19.33Q7.02 21.25 7.92 22.24Q8.83 23.24 10.24 23.24Q11.41 23.24 12.21 22.64Q13.01 22.04 13.4 20.79ZM20.52 5.4H26.49V26.87H20.52ZM34.24 16.35 28.54 15.75Q28.86 14.26 29.47 13.4Q30.08 12.54 31.22 11.91Q32.04 11.46 33.47 11.21Q34.91 10.96 36.58 10.96Q39.26 10.96 40.89 11.26Q42.51 11.56 43.6 12.51Q44.36 13.17 44.8 14.38Q45.24 15.59 45.24 16.69V23.56Q45.24 24.66 45.38 25.28Q45.52 25.9 45.98 26.87H40.39Q40.05 26.27 39.95 25.95Q39.85 25.64 39.74 24.97Q38.57 26.09 37.42 26.58Q35.83 27.22 33.74 27.22Q30.96 27.22 29.51 25.93Q28.07 24.64 28.07 22.75Q28.07 20.98 29.11 19.84Q30.15 18.7 32.95 18.14Q36.3 17.47 37.3 17.19Q38.29 16.92 39.41 16.48Q39.41 15.39 38.95 14.95Q38.5 14.51 37.36 14.51Q35.89 14.51 35.16 14.98Q34.59 15.34 34.24 16.35ZM39.41 19.49Q38.18 19.93 36.84 20.26Q35.03 20.75 34.54 21.22Q34.05 21.7 34.05 22.31Q34.05 23.02 34.54 23.46Q35.03 23.91 35.98 23.91Q36.98 23.91 37.83 23.43Q38.69 22.94 39.05 22.25Q39.41 21.55 39.41 20.44ZM47.37 11.31H52.95V13.86Q53.76 12.21 54.61 11.58Q55.47 10.96 56.73 10.96Q58.05 10.96 59.62 11.78L57.77 16.03Q56.72 15.59 56.1 15.59Q54.93 15.59 54.28 16.56Q53.36 17.92 53.36 21.66V26.87H47.37ZM76.4 20.57H64.44Q64.61 22.01 65.22 22.71Q66.08 23.72 67.48 23.72Q68.36 23.72 69.15 23.28Q69.63 23 70.19 22.3L76.06 22.84Q74.71 25.19 72.81 26.2Q70.9 27.22 67.34 27.22Q64.25 27.22 62.48 26.35Q60.71 25.48 59.54 23.58Q58.38 21.68 58.38 19.12Q58.38 15.47 60.72 13.22Q63.05 10.96 67.17 10.96Q70.51 10.96 72.44 11.97Q74.38 12.98 75.39 14.9Q76.4 16.82 76.4 19.9ZM70.33 17.71Q70.16 15.99 69.4 15.24Q68.65 14.49 67.42 14.49Q66 14.49 65.15 15.62Q64.61 16.32 64.46 17.71ZM77.86 5.4H83.82V9.45H77.86ZM77.86 11.31H83.82V26.87H77.86ZM91.56 16.35 85.86 15.75Q86.19 14.26 86.79 13.4Q87.4 12.54 88.54 11.91Q89.36 11.46 90.8 11.21Q92.24 10.96 93.91 10.96Q96.59 10.96 98.21 11.26Q99.84 11.56 100.92 12.51Q101.68 13.17 102.12 14.38Q102.56 15.59 102.56 16.69V23.56Q102.56 24.66 102.7 25.28Q102.84 25.9 103.31 26.87H97.71Q97.38 26.27 97.27 25.95Q97.17 25.64 97.07 24.97Q95.9 26.09 94.74 26.58Q93.16 27.22 91.06 27.22Q88.28 27.22 86.84 25.93Q85.39 24.64 85.39 22.75Q85.39 20.98 86.43 19.84Q87.47 18.7 90.27 18.14Q93.63 17.47 94.62 17.19Q95.62 16.92 96.73 16.48Q96.73 15.39 96.28 14.95Q95.82 14.51 94.68 14.51Q93.22 14.51 92.48 14.98Q91.91 15.34 91.56 16.35ZM96.73 19.49Q95.5 19.93 94.17 20.26Q92.35 20.75 91.87 21.22Q91.37 21.7 91.37 22.31Q91.37 23.02 91.86 23.46Q92.35 23.91 93.3 23.91Q94.3 23.91 95.16 23.43Q96.01 22.94 96.37 22.25Q96.73 21.55 96.73 20.44Z"/><path class="brand-rays" d="M108.83 8 111.83 3M113.83 13l8-3M114.83 19l9 2M109.83 23l4 5"/></svg>';
  const { categories, monthNames, index, base, label } = D;
  const model = 'editorial';
  const BAR_STEP = 10;
  const initial = new URLSearchParams(location.search);
  const otherYears = () => D.years.map(y => String(y.year)).filter(y => y !== D.year);
  const yearQuery = () => D.year === D.defaultYear ? '' : `?ano=${D.year}`;
  const withYear = path => path + yearQuery();
  const ids = D.dataset().map(p => p.id);
  const totalOf = p => p.cells.reduce((n, r) => n + r.amount, 0);
  // A month held for review is missing, not zero: a partial total never enters a ranking or a comparison.
  // Rankings and comparisons need at least six months of exercise (or the whole period when it is shorter).
  const MIN_MONTHS = D.minMonths;
  const fewMonths = p => p.exercisedMonths < MIN_MONTHS;
  const comparable = p => p.comparable;
  // Each total is computed once per sort: summing inside the comparator repeats it thousands of times with hundreds of deputies.
  const sortedBy = (people, key) => people.map(p => [p, key(p)]).sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name, 'pt-BR')).map(([p]) => p);
  // The published totals never change after load, so the order is computed once.
  let totalOrder = null;
  const byTotal = () => [...(totalOrder ??= sortedBy(D.dataset().filter(comparable).length >= 2 ? D.dataset().filter(comparable) : [...D.dataset()], totalOf))];
  // Only the parameters present and valid in the URL; a question applies what its words imply for the rest.
  const fromURL = {};
  if (categories.includes(initial.get('categoria')) || initial.get('categoria') === 'Todas') fromURL.category = initial.get('categoria');
  if (['total', 'mensal'].includes(initial.get('metrica'))) fromURL.metric = initial.get('metrica');
  if (['gastos', 'menos', 'projetos'].includes(initial.get('aba'))) fromURL.tab = initial.get('aba');
  const urlUf = initial.get('uf');
  if (urlUf && D.dataset().some(p => !p.noExercise && p.uf === urlUf)) fromURL.uf = urlUf;
  const isSenatorPath = /^\/senador(?:\/|$)/.test(location.pathname);
  const initialHouse = D.senators && (initial.get('casa') === 'senado' || isSenatorPath) ? 'senado' : 'camara';
  const state = {
    house: initialHouse,
    year: D.year, uf: fromURL.uf ?? 'Brasil',
    category: fromURL.category ?? 'Todas',
    metric: fromURL.metric ?? 'total',
    tab: initialHouse === 'senado' && fromURL.tab === 'projetos' ? 'gastos' : (fromURL.tab ?? 'gastos'), barLimit: BAR_STEP,
    query: initial.get('q') || '', featured: ids.includes(initial.get('destaque')) && comparable(D.dataset().find(p => p.id === initial.get('destaque'))) ? initial.get('destaque') : byTotal()[0]?.id, answer: null, hiddenSeries: new Set(), popover: null
  };
  let dialogTrigger = null, toastTimer, listOrigin = null;
  const $ = selector => document.querySelector(selector);
  const safeUrl = value => /^https:\/\//i.test(String(value ?? '')) ? value : '';
  const safeImage = value => /^https:\/\//i.test(String(value ?? '')) || /^(?![a-z][a-z0-9+.-]*:|\/\/)[^\s]+$/i.test(String(value ?? '')) ? value : '';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const norm = value => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Amounts are integer cents from the published version; every exact value shows its cents.
  const money = cents => cents === null ? 'Não informado' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/^-/, '−');
  // The unit is chosen from the rounded value, so 999,96 mil is shown as 1 milhão and 1,996 milhão as 2 milhões.
  const compact = cents => { const abs = Math.abs(cents), millions = Math.round(abs / 1000000) / 100; return abs >= 99995000 ? `${cents < 0 ? '−' : ''}R$\u00a0${millions.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${millions < 2 ? 'milhão' : 'milhões'}` : compactThousands(cents); };
  const compactThousands = cents => Math.abs(cents) >= 100000 ? `${cents < 0 ? '−' : ''}R$\u00a0${(Math.abs(cents) / 100000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : money(Math.round(cents));
  const number = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  // Positive categories are the only ones drawn as slices, so they are the base of every percentage on the page.
  const shareBase = groups => groups.reduce((n, g) => n + Math.max(0, g.value), 0);
  const share = (value, base) => `${(base > 0 ? value / base * 100 : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const sum = rows => rows.reduce((total, row) => total + row.amount, 0);
  const count = cells => cells.reduce((n, cell) => n + cell.count, 0);
  // A percentage needs a positive base; with a zero or negative base only the difference is meaningful. Direction always comes from a > b.
  const compareValues = (a, b) => ({ equal: a === b, more: a > b, diff: Math.abs(a - b), percent: b > 0 && a >= 0 ? Math.abs(a - b) / b * 100 : null });
  const all = () => D.dataset();
  const person = id => all().find(p => p.id === id);
  const first = p => p.name.split(' ')[0];
  const inCategory = r => state.category === 'Todas' || r.category === state.category;
  const cells = p => p.cells.filter(inCategory);
  const span = () => { const c = D.coverage; return `${monthNames[c[0]]}–${monthNames[c.at(-1)]} ${state.year}`; };
  const cutoff = () => ClareiaView.cutoffLine(D.index.scope.months, D.index.scope.year, D.index.collectedAt);
  const pending = 'Ainda não coletado';
  const billsPeriod = () => { const y = D.billsYears; return y.length > 1 && y.every((v, i) => i === 0 || v === y[i - 1] + 1) ? `${y[0]}–${y.at(-1)}` : y.join(', '); };
  const approvedText = p => `${number(p.approved)} ${p.approved === 1 ? 'projeto' : 'projetos'}`;
  const inUF = p => state.uf === 'Brasil' || p.uf === state.uf;
  // A deputy whose bills were not collected has approved === null and never enters this ranking, so it can never read as zero.
  const projectRanking = () => sortedBy(all().filter(p => p.approved !== null && inUF(p)), p => p.approved);
  const exclusionNote = p => p.heldMonths?.length ? partialNote(p) : p.exerciseReviewMonths?.length ? reviewNote(p) : fewMonths(p) ? `Exerceu o mandato em ${p.exercisedMonths} de ${D.coverage.length} meses do recorte. Rankings e comparações incluem quem exerceu pelo menos ${MIN_MONTHS} meses.` : '';
  const reviewNote = p => `Exercício em revisão: ${p.exerciseReviewMonths.length === 1 ? `${months[p.exerciseReviewMonths[0]].toLowerCase()} de ${state.year}` : `${p.exerciseReviewMonths.length} meses do recorte`}, as fontes oficiais divergem sobre o mandato. Não entra em rankings nem comparações.`;
  const partialNote = p => `Total parcial: ${p.heldMonths.length === 1 ? `${months[p.heldMonths[0]].toLowerCase()} de ${state.year} está em revisão` : `${p.heldMonths.length} meses em revisão`} e fora da soma. Não entra em rankings nem comparações.`;
  // Party comes from the approved monthly coverage; partyNote marks one taken from the legislature's events.
  const context = p => [p.uf, p.ufNote, p.party && p.partyNote ? `${p.party} (${p.partyNote})` : p.party].filter(Boolean).join(' · ') || 'Deputado(a) federal';
  const cardContext = p => p.partyInReview ? [p.uf, p.ufNote, p.lastConfirmedParty && `${p.lastConfirmedParty} (último confirmado)`].filter(Boolean).join(' · ') || 'Deputado(a) federal' : context(p);
  function value(p, kind = state.tab) {
    if (kind === 'projetos') return null;
    const result = sum(cells(p));
    return state.metric === 'mensal' ? result / p.months : result;
  }
  const formatted = (p, kind = state.tab) => kind === 'projetos' ? (p.approved === null ? pending : approvedText(p)) : compact(value(p, kind));
  // The answer ranks expenses even when the Projetos tab is open, where value() has nothing to sort by.
  // The share of the ceiling is over the whole period and counts every category, so the pill hides when a category is filtered.
  const usable = p => p.use.status === 'ok';
  const pctText = p => (p.use.tenths / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const ceilingPill = (p, projects) => {
    if (projects || (!D.ceiling && !D.ceilingPending) || state.category !== 'Todas') return '';
    if (!D.ceiling) return `<span class="ceiling-pill is-muted">limite de ${state.year} em conferência</span>`;
    if (!usable(p)) return `<span class="ceiling-pill is-muted" title="${p.use.missing?.length ? 'O exercício ou a UF de algum mês não foi confirmado' : 'Nenhum mês completo de exercício entrou na conta'}">% não confirmado</span>`;
    const note = D.ceiling.note;
    if (!note) return `<button class="ceiling-pill" data-action="evidence" data-id="${p.id}" data-kind="teto" aria-label="${escape(p.name)}: ${pctText(p)} do teto da cota usado. Ver o cálculo">${pctText(p)} do teto</button>`;
    return `<button class="ceiling-pill" data-action="evidence" data-id="${p.id}" data-kind="teto" title="${escape(note)}" aria-label="${escape(p.name)}: ${pctText(p)} do teto da cota usado (${escape(note)}). Ver o cálculo">${pctText(p)} do teto*</button><small class="ceiling-note">* ${escape(note)}</small>`;
  };
  const inScope = () => all().filter(p => comparable(p) && inUF(p));
  function ranking(kind = state.tab) {
    return sortedBy(inScope(), p => state.tab === 'menos' ? -value(p, kind) : value(p, kind));
  }
  const icon = name => {
    const paths = {
      search: '<circle cx="10.5" cy="10.5" r="6.8"/><path d="m16 16 5 5"/>',
      arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
      external: '<path d="M8 5h11v11M19 5 5 19"/>',
      share: '<path d="M12 16V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
      table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
      database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v13c0 4 16 4 16 0V5M4 11c0 4 16 4 16 0"/>',
      Instagram: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.4"/><path d="M16.6 7.4v.01"/>',
      Facebook: '<path d="M7 10v4h3v7h4v-7h3l1-4h-4V8a1 1 0 0 1 1-1h3V3h-3a5 5 0 0 0-5 5v2H7"/>',
      X: '<path d="m4 4 11.7 16H20L8.3 4zM4 20l6.8-6.8m2.4-2.4L20 4"/>',
      YouTube: '<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/>',
      TikTok: '<path d="M21 7.9v4a10 10 0 0 1-5-1.9v4.5a6.5 6.5 0 1 1-8-6.3v4.3a2.5 2.5 0 1 0 4 2V3h4.1A6 6 0 0 0 21 7.9z"/>',
      Threads: '<path d="M19 7.5C17.7 4.5 15.3 3 12 3c-5 0-8 2.5-8 9s3.5 9 8 9 7-3 7-5-1-5-7-5c-2.5 0-3 1.3-3 2.5 0 1.5 1 2.5 2.5 2.5 2.5 0 3.5-1.5 3.5-5s-2-4-3-4-1.8.3-2.5 1"/>',
      LinkedIn: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 11v5m0-8v.01M12 16v-5m4 5v-3a2 2 0 1 0-4 0"/>',
      Flickr: '<circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/>'
    };
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
  };
  function photo(p) {
    if (!safeImage(p.photo)) return `<span class="initials" aria-label="${escape(p.name)} — sem retrato">${escape(p.name.split(' ').map(w => w[0]).join('').slice(0, 2))}</span>`;
    return `<span class="photo"><img src="${escape(p.photo)}" alt="Retrato oficial de ${escape(p.name)}" loading="lazy"></span>`;
  }
  const avatar = p => `<span class="avatar">${photo(p)}</span>`;
  function setPath(path, title) {
    const url = new URL(location.href);
    if (url.pathname !== path) { url.pathname = path; writeHistory('replaceState', history.state, url); }
    if (title) document.title = pageTitle.value = title;
  }
  const homeQuery = () => {
    const p = new URLSearchParams();
    if (D.year !== D.defaultYear) p.set('ano', D.year);
    if (state.house === 'senado') p.set('casa', 'senado');
    const q = p.toString();
    return q ? '?' + q : '';
  };
  function syncURL() {
    if (parseRoute(location.pathname)?.type === 'senador') return;
    const url = new URL(location.href);
    url.search = '';
    if (D.year !== D.defaultYear) url.searchParams.set('ano', D.year);
    if (state.house === 'senado') {
      url.searchParams.set('casa', 'senado');
      if (state.metric !== 'total') url.searchParams.set('metrica', state.metric);
      if (state.tab === 'menos') url.searchParams.set('aba', state.tab);
    } else {
      // On load an absent parameter means "let the question decide", so a link with a question spells out every choice, defaults included.
      const explicit = Boolean(state.query);
      Object.entries({ categoria: explicit || state.category !== 'Todas' ? state.category : '', metrica: explicit || state.metric !== 'total' ? state.metric : '', aba: explicit || state.tab !== 'gastos' ? state.tab : '', uf: state.uf === 'Brasil' ? '' : state.uf, destaque: state.featured, q: state.query }).forEach(([key, val]) => { if (val) url.searchParams.set(key, val); });
    }
    try { history.replaceState(null, '', url); } catch { /* file previews may restrict history */ }
  }
  const examples = () => { const [a, b] = byTotal(); return [`${first(a)} gastou mais que ${first(b)}?`, 'Quem mais gastou por mês?', 'Quem mais gastou com passagens?', 'Quem gastou menos?']; };
  function searchForm() {
    return `<div class="search-wrap"><form class="search-form" id="search-form" role="search" autocomplete="off">
      <label class="sr-only" for="query">Pergunte sobre os dados</label>
      <input id="query" name="q" value="${escape(state.query)}" placeholder="O que você quer investigar?" maxlength="300" aria-controls="suggestions" aria-expanded="false">
      <button class="search-submit" type="submit" aria-label="Investigar pergunta">${icon('arrow')}</button>
      </form><div id="suggestions" class="suggestions" hidden><p>Experimente estas perguntas</p>${examples().map(q => `<button type="button" data-question="${escape(q)}">${escape(q)} ${icon('arrow')}</button>`).join('')}</div></div>`;
  }
  function header() {
    return `<header class="site-header"><a class="logo" href="/" aria-label="Clareia, início">${logo}</a>
      <button class="header-search" data-action="focus-search" aria-label="Ir para a busca">${icon('search')}</button></header>`;
  }
  function metricToggle() {
    return `<div class="metric-toggle" role="group" aria-label="Forma de comparar"><button data-metric="total" aria-pressed="${state.metric === 'total'}">Total</button><button data-metric="mensal" aria-pressed="${state.metric === 'mensal'}">Por mês</button></div>`;
  }
  function houseSwitch() {
    if (!D.senators) return '';
    return `<div class="house-switch" role="group" aria-label="Casa legislativa"><button type="button" data-house="camara" aria-pressed="${state.house === 'camara'}">Câmara</button><button type="button" data-house="senado" aria-pressed="${state.house === 'senado'}">Senado</button></div>`;
  }
  function tabs() {
    const items = state.house === 'senado'
      ? [['gastos', 'Mais gastos'], ['menos', 'Menos gastos']]
      : [['gastos', 'Mais gastos'], ['menos', 'Menos gastos'], ['projetos', 'Projetos']];
    const list = `<div class="tabs" role="tablist" aria-label="Indicador">${items.map(([key, label]) => `<button role="tab" data-tab="${key}" aria-selected="${state.tab === key}" tabindex="${state.tab === key ? 0 : -1}">${label}</button>`).join('')}</div>`;
    return D.senators ? `<div class="rank-head">${list}${houseSwitch()}</div>` : list;
  }
  const monthsWord = n => n === 1 ? 'mês' : 'meses';
  function caption(p) {
    return `${state.metric === 'mensal' ? 'Média mensal' : 'Cota parlamentar'} · ${span()} · ${p.months} ${p.months === 1 ? 'mês' : 'meses'} no recorte`;
  }
  function cards() {
    const projects = state.tab === 'projetos' && window.ClareiaData.billsApproved;
    if (projects && !projectRanking().length) return `<div class="empty-state"><b>Nenhum deputado com proposições coletadas neste recorte.</b><p>Quem não teve as proposições coletadas não aparece com zero projetos aprovados.</p><button class="outline-button" data-tab="gastos">Ver gastos</button></div>`;
    if (state.tab === 'projetos' && !projects) return `<div class="empty-state"><b>Projetos de lei ainda não foram coletados.</b><p>A próxima etapa inclui PL, PLP e PEC da Câmara, separando autoria principal de coautoria. Nenhum número é mostrado antes da conferência.</p><button class="outline-button" data-tab="gastos">Ver gastos</button></div>`;
    return (projects ? projectRanking() : ranking()).slice(0, 3).map((p, i) => `<article class="rank-card editorial-card" data-person="${p.id}">
      <button class="portrait-button" data-action="profile" data-id="${p.id}" aria-label="Abrir perfil de ${escape(p.name)}">${photo(p)}<span class="rank-number">0${i + 1}</span></button>
      <div class="card-info"><h3 class="person-name">${escape(p.name)}</h3><p class="editorial-person-context">${escape(cardContext(p))}</p><button class="value-button" data-action="evidence" data-id="${p.id}" aria-label="${escape(p.name)}: ${projects ? approvedText(p) : money(value(p))}. Como chegamos nisso?">${formatted(p)}</button>
      <p class="card-caption">${projects ? `Projetos aprovados · ${billsPeriod()}` : caption(p)}</p><div class="card-proofs"><button class="editorial-proof" data-action="evidence" data-id="${p.id}">Como chegamos nisso? →</button>${ceilingPill(p, projects)}</div></div></article>`).join('');
  }
  function rankNote() {
    if (state.tab === 'projetos' && window.ClareiaData.billsApproved) {
      const scope = all().filter(inUF).length, included = projectRanking().length, excluded = scope - included;
      return `Projetos aprovados: PL, PLP e PEC apresentados em ${billsPeriod()} em que o deputado é proponente (autor), não apenas signatário, e que viraram norma jurídica: lei ordinária, lei complementar ou emenda constitucional, com a norma identificada no despacho oficial da Câmara. Só conta a autoria; a coautoria fica de fora. Projetos apresentados não equivalem a leis aprovadas. Inclui ${included} de ${scope} deputados${state.uf === 'Brasil' ? '' : ` de ${escape(state.uf)}`}${excluded ? `; ${excluded} ficam fora porque as proposições deles não foram coletadas, e não aparecem com zero` : ', todos com proposições coletadas'}. Projetos cuja norma não pôde ser confirmada no despacho ou que estão retidos para revisão não entram na contagem. <button class="text-button" data-action="methodology">Fontes e metodologia →</button>`;
    }
    return state.tab === 'projetos' ? 'Projetos apresentados não equivalem a leis aprovadas.' : `Inclui quem exerceu o mandato em pelo menos ${MIN_MONTHS} meses do recorte, sem meses em revisão: ${ranking('gastos').length} de ${all().filter(p => state.uf === 'Brasil' || p.uf === state.uf).length} deputados${state.uf === 'Brasil' ? '' : ` de ${escape(state.uf)}`}. Cota parlamentar é a verba mensal para despesas do mandato, como passagens, combustível e divulgação. Gasto maior não significa irregularidade.`;
  }
  // Long lists grow in steps; only the visible rows are drawn.
  const listMore = (total, limit, step, kind, noun) => total <= step ? '' : `<div class="list-more"><p class="list-count">Mostrando ${Math.min(limit, total)} de ${total} ${noun}</p>${total > limit ? `<button class="outline-button" data-action="${kind}-more">Mostrar mais ${Math.min(step, total - limit)}</button>` : ''}${limit > step ? `<button class="outline-button" data-action="${kind}-less">Mostrar menos</button>` : ''}</div>`;
  function barSection() {
    if (state.house === 'senado') return senatorBarSection();
    const projects = state.tab === 'projetos';
    if (projects && (!window.ClareiaData.billsApproved || !projectRanking().length)) return '';
    const standings = !projects && D.ceiling && state.category === 'Todas' ? ClareiaView.ufStandings(all()) : new Map();
    const ranked = projects ? projectRanking() : ranking(), amount = p => projects ? p.approved : Math.abs(value(p)), shown = p => projects ? approvedText(p) : money(value(p)), max = Math.max(1, ...ranked.map(amount));
    const ceilingNote = D.ceiling?.note;
    return `<section class="bar-section" id="comparison"><h2>${projects ? `Ranking de projetos aprovados · ${billsPeriod()}` : `Comparativo de gastos · ${span()}`}</h2>${ranked.length ? '<button type="button" class="outline-button" data-action="csv-ranking">Baixar CSV</button>' : ''}<div class="bar-chart" id="bar-chart">${ranked.slice(0, state.barLimit).map((p, i) => {
      const s = standings.get(p.id);
      const use = s ? `${pctText(p)} do teto${ceilingNote ? '*' : ''}${s.total > 1 ? ` · ${s.rank}º maior uso do teto entre os ${s.total} de ${escape(s.uf)}` : ''}` : '';
      return `<button class="bar-row" data-action="evidence" data-id="${p.id}" aria-label="${escape(p.name)}, ${shown(p)}${use ? `, ${use}${ceilingNote ? ` (${escape(ceilingNote)})` : ''}` : ''}: ${projects ? 'ver definição' : 'ver cálculo'}" style="--opacity:${Math.max(.25, 1 - i * .18)}"><span class="bar-rank">${String(i + 1).padStart(2, '0')}</span>${avatar(p)}<span class="bar-name">${escape(p.name)}</span><span class="track"><i style="width:${amount(p) / max * 100}%"></i></span><span class="bar-value">${shown(p)}${use ? `<small class="bar-use"${ceilingNote ? ` title="${escape(ceilingNote)}"` : ''}>${use}</small>` : ''}</span></button>`;
    }).join('')}</div>${listMore(ranked.length, state.barLimit, BAR_STEP, 'bars', 'deputados')}</section>`;
  }
  function downloadRankingCsv(scope, uf) {
    const isState = scope === 'state', projects = !isState && state.tab === 'projetos';
    const people = isState
      ? all().filter(p => !p.noExercise && p.uf === uf).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      : projects ? projectRanking() : ranking();
    const metric = state.metric === 'mensal' ? 'média mensal' : 'total';
    const view = isState ? `Estado ${uf} · gastos · ${metric} · ${state.category}` : projects ? `Ranking de projetos aprovados · ${state.uf}` : `Ranking de gastos (${state.tab}) · ${metric} · ${state.category} · ${state.uf}`;
    const rows = people.map((p, i) => ({
      position: isState ? null : i + 1, id: p.officialId, name: p.name, uf: p.uf ?? '', party: p.party ?? '',
      value: projects ? p.approved : Math.round(value(p, 'gastos')), warning: ClareiaView.csvWarning(p)
    }));
    const text = ClareiaView.rankingCsv({ version: index.snapshotId, year: state.year, period: projects ? billsPeriod() : span(), view, unit: projects ? 'projetos' : 'reais', rows });
    const href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
    a.href = href;
    a.download = `clareia-${index.snapshotId.slice(0, 12)}-${isState ? uf : 'ranking'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    toast(`CSV com ${rows.length} deputados preparado.`);
  }
  function editorialFollowUp() {
    if (state.tab === 'projetos') return '';
    const monthly = state.metric === 'mensal';
    return `<div class="editorial-follow-up"><span>Continue investigando</span><button type="button" data-metric="${monthly ? 'total' : 'mensal'}">${monthly ? 'E se compararmos o total do período?' : 'A ordem muda quando comparamos por mês?'} →</button></div>`;
  }
  function yearSelector() {
    const note = [D.partial ? D.partialLabel : '', D.provisional?.length ? `provisório: ${D.provisionalNote}` : ''].filter(Boolean).join(' · ');
    const label = note ? `<span class="year-partial">${escape(note)}</span>` : '';
    if (D.years.length < 2) return label;
    const options = D.years.map(y => `<option value="${y.year}"${String(y.year) === D.year ? ' selected' : ''}>${y.year}${y.partial ? ' (parcial)' : ''}</option>`).join('');
    return `<label class="year-select"><select data-year-select aria-label="Ano"${note ? ` title="${escape(note)}"` : ''}>${options}</select></label>`;
  }
  async function switchYear(year) {
    syncURL();
    const url = new URL(location.href);
    if (String(year) === D.defaultYear) url.searchParams.delete('ano'); else url.searchParams.set('ano', year);
    if (state.house === 'camara' && state.featured) {
      try { const other = await (await fetch(`${D.yearBase(year)}/index.json`)).json(); if (!other.scope.ids.map(String).includes(String(state.featured))) url.searchParams.delete('destaque'); } catch { url.searchParams.delete('destaque'); }
    }
    location.assign(url);
  }
  // Monthly spend = totalCents ÷ count of months whose exercise is full or partial; with zero such months the senator has no monthly value and stays out of the monthly ranking.
  const senatorMonthly = s => ClareiaView.senatorMonthlyCents(s);
  const senatorExercised = s => ClareiaView.senatorExercisedMonths(s.months);
  // Senators with name: null stay in the ranking as "Senador(a) sem nome cadastrado (ID <id>)" in non-interactive rows, with no profile page or link.
  const senatorNamed = s => typeof s.name === 'string' && s.name.trim().length > 0;
  const senatorDisplayName = s => senatorNamed(s) ? s.name.trim() : `Senador(a) sem nome cadastrado (ID ${s.senatorId})`;
  const senatorUf = s => [...new Set((s.months || []).map(m => m.uf).filter(Boolean))].join(' / ');
  const isPlainObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
  const isSafeNumRecord = obj => isPlainObj(obj) && Object.values(obj).every(v => typeof v === 'number' && Number.isSafeInteger(v));
  const isOptNullableStr = v => v === undefined || v === null || typeof v === 'string';
  const validSenatorMonth = m => isPlainObj(m) && Number.isInteger(m.month) && m.month >= 1 && m.month <= 12 && typeof m.exercise === 'string' && m.exercise.length > 0 && isOptNullableStr(m.uf) && isOptNullableStr(m.codigoMandato) && isOptNullableStr(m.participation);
  function validSenatorsIndex(raw) {
    if (!isPlainObj(raw) || raw.schema !== 'clareia.senators-index.v1' || !Array.isArray(raw.years)) return null;
    if (!raw.years.every(y => isPlainObj(y) && Number.isInteger(y.year) && typeof y.file === 'string' && /^\d{4}\.json$/.test(y.file))) return null;
    return raw;
  }
  function validSenatorsYear(raw) {
    if (!isPlainObj(raw) || raw.schema !== 'clareia.senators-year.v1' || typeof raw.publicationId !== 'string' || !raw.publicationId || !Number.isInteger(raw.year) || !Number.isSafeInteger(raw.totalCents) || !Number.isSafeInteger(raw.records) || !isOptNullableStr(raw.collectedAt) || !Array.isArray(raw.senators)) return null;
    for (const s of raw.senators) {
      if (!isPlainObj(s) || !Number.isInteger(s.senatorId) || !Number.isInteger(s.year) || (s.name !== null && typeof s.name !== 'string') || !Number.isSafeInteger(s.totalCents) || !Number.isSafeInteger(s.records)) return null;
      if (!isSafeNumRecord(s.byType) || !isSafeNumRecord(s.suppliers) || !isPlainObj(s.byMonth) || !Object.entries(s.byMonth).every(([month, values]) => /^(?:[1-9]|1[0-2])$/.test(month) && isSafeNumRecord(values))) return null;
      if (!Array.isArray(s.months) || !s.months.every(validSenatorMonth) || !isSafeNumRecord(s.review)) return null;
    }
    return raw;
  }
  let senatorsIndexPromise = null;
  const senatorsYearCache = new Map();
  const senatorState = { status: 'idle', year: null, data: null, index: null, error: null };
  function loadSenatorsIndex() {
    if (!senatorsIndexPromise) {
      senatorsIndexPromise = fetch('/senadores/index.json')
        .then(r => { if (!r.ok) throw new Error('Senadores indisponíveis'); return r.json(); })
        .then(raw => { const idx = validSenatorsIndex(raw); if (!idx) throw new Error('Índice de senadores inválido'); return idx; })
        .catch(err => { senatorsIndexPromise = null; throw err; });
    }
    return senatorsIndexPromise;
  }
  function loadSenatorsYear(year) {
    const key = String(year);
    if (!senatorsYearCache.has(key)) {
      senatorsYearCache.set(key, loadSenatorsIndex().then(idx => {
        const entry = idx.years.find(y => String(y.year) === key);
        if (!entry) return { index: idx, data: null, missingYear: true };
        return fetch(`/senadores/${entry.file}`)
          .then(r => { if (!r.ok) throw new Error('Ano de senadores indisponível'); return r.json(); })
          .then(raw => {
            const parsed = validSenatorsYear(raw);
            if (!parsed || String(parsed.year) !== key) throw new Error('Dados de senadores inválidos');
            return { index: idx, data: parsed, missingYear: false };
          });
      }).catch(err => { senatorsYearCache.delete(key); throw err; }));
    }
    return senatorsYearCache.get(key);
  }
  function ensureSenatorsLoaded() {
    if (!D.senators) return;
    if (senatorState.year === state.year && (senatorState.status === 'ready' || senatorState.status === 'loading' || senatorState.status === 'missing-year')) return;
    const reqYear = state.year;
    senatorState.status = 'loading';
    senatorState.year = reqYear;
    senatorState.error = null;
    loadSenatorsYear(reqYear).then(res => {
      if (senatorState.year !== reqYear) return;
      senatorState.index = res.index;
      if (res.missingYear) { senatorState.status = 'missing-year'; senatorState.data = null; }
      else { senatorState.status = 'ready'; senatorState.data = res.data; }
      if (state.house === 'senado' && $('#rank-slot')) refresh();
    }, () => {
      if (senatorState.year !== reqYear) return;
      senatorState.status = 'error';
      senatorState.data = null;
      senatorState.error = 'Não foi possível carregar os dados do Senado agora. Nenhum valor foi estimado.';
      if (state.house === 'senado' && $('#rank-slot')) refresh();
    });
  }
  function senatorRanking(data) {
    const list = [];
    let excludedMonthly = 0;
    for (const s of data.senators) {
      const val = state.metric === 'mensal' ? senatorMonthly(s) : s.totalCents;
      if (val === null) { excludedMonthly++; continue; }
      list.push({ senator: s, value: val, exercised: senatorExercised(s) });
    }
    list.sort((a, b) => (state.tab === 'menos' ? a.value - b.value : b.value - a.value) || senatorDisplayName(a.senator).localeCompare(senatorDisplayName(b.senator), 'pt-BR') || a.senator.senatorId - b.senator.senatorId);
    return { list, excludedMonthly };
  }
  function senatorCards(data, ranked) {
    if (!ranked.length) return `<div class="empty-state"><b>Nenhum senador neste recorte.</b><p>${state.metric === 'mensal' ? 'Nenhum senador tem mês com exercício completo ou parcial neste ano.' : 'Não há senadores listados para este ano.'}</p></div>`;
    return ranked.slice(0, 3).map(({ senator: s, value: val, exercised }, i) => {
      const named = senatorNamed(s), name = senatorDisplayName(s), uf = senatorUf(s);
      const ctx = ['Senador(a)', uf].filter(Boolean).join(' · ');
      const cap = state.metric === 'mensal' ? `Média mensal · ${exercised} ${monthsWord(exercised)} de exercício` : `CEAPS ${data.year} · ${number(s.records)} ${s.records === 1 ? 'registro' : 'registros'}`;
      const portrait = named
        ? `<button type="button" class="portrait-button" data-action="senator-profile" data-senator-id="${s.senatorId}" aria-label="Abrir perfil de ${escape(name)}">${photo({ name, photo: null })}<span class="rank-number">0${i + 1}</span></button>`
        : `<div class="portrait-button">${photo({ name: 'S', photo: null })}<span class="rank-number">0${i + 1}</span></div>`;
      const amountEl = named
        ? `<button type="button" class="value-button" data-action="senator-profile" data-senator-id="${s.senatorId}" aria-label="${escape(name)}: ${money(val)}. Ver detalhes">${compact(val)}</button>`
        : `<span class="value-button">${compact(val)}</span>`;
      const proof = named ? `<div class="card-proofs"><a class="editorial-proof" href="${escape(withYear(senatorPath(s)))}" data-action="senator-profile" data-senator-id="${s.senatorId}">Ver detalhes →</a></div>` : '';
      return `<article class="rank-card editorial-card${named ? '' : ' is-unlinked'}" data-person="sen-${s.senatorId}">${portrait}<div class="card-info"><h3 class="person-name">${escape(name)}</h3><p class="editorial-person-context">${escape(ctx)}</p>${amountEl}<p class="card-caption">${cap}</p>${proof}</div></article>`;
    }).join('');
  }
  function senatorBarSection() {
    if (senatorState.status !== 'ready' || !senatorState.data) return '';
    const data = senatorState.data, { list: ranked } = senatorRanking(data);
    if (!ranked.length) return '';
    const max = Math.max(1, ...ranked.map(x => Math.abs(x.value)));
    return `<section class="bar-section" id="comparison"><h2>Comparativo de senadores · ${escape(data.year)}</h2><div class="bar-chart" id="bar-chart">${ranked.slice(0, state.barLimit).map(({ senator: s, value: val }, i) => {
      const named = senatorNamed(s), name = senatorDisplayName(s), inner = `<span class="bar-rank">${String(i + 1).padStart(2, '0')}</span>${avatar({ name: named ? name : 'S', photo: null })}<span class="bar-name">${escape(name)}</span><span class="track"><i style="width:${Math.abs(val) / max * 100}%"></i></span><span class="bar-value">${money(val)}</span>`;
      return named
        ? `<a class="bar-row" href="${escape(withYear(senatorPath(s)))}" data-action="senator-profile" data-senator-id="${s.senatorId}" aria-label="${escape(name)}, ${money(val)}: abrir perfil" style="--opacity:${Math.max(.25, 1 - i * .18)}">${inner}</a>`
        : `<div class="bar-row is-unlinked" style="--opacity:${Math.max(.25, 1 - i * .18)}">${inner}</div>`;
    }).join('')}</div>${listMore(ranked.length, state.barLimit, BAR_STEP, 'bars', 'senadores')}</section>`;
  }
  function senatorCutoff(data) {
    if (!data?.collectedAt) return '';
    const ms = [...new Set(data.senators.flatMap(s => (s.months || []).map(m => m.month)).filter(m => m >= 1 && m <= 12))];
    return ms.length ? `<p class="context cutoff">${escape(ClareiaView.cutoffLine(ms, data.year, data.collectedAt))}</p>` : '';
  }
  function senatorRankingSection() {
    let body = '';
    if (senatorState.status === 'error') {
      body = `<div class="senators-error" role="alert"><p>${escape(senatorState.error)}</p></div>`;
    } else if (senatorState.status === 'missing-year') {
      const others = (senatorState.index?.years ?? []).filter(y => String(y.year) !== state.year);
      body = `<div class="senators-error" role="status"><p>Os dados de senadores não estão publicados para ${escape(state.year)}.</p>${others.length ? `<div class="action-row">${others.map(y => `<button type="button" class="outline-button primary" data-year="${escape(y.year)}">Ver ${escape(y.year)}</button>`).join('')}</div>` : ''}</div>`;
    } else if (senatorState.status !== 'ready' || !senatorState.data) {
      body = '<div class="senators-status" role="status">Carregando dados do Senado…</div>';
    } else {
      const data = senatorState.data, { list: ranked, excludedMonthly } = senatorRanking(data);
      const note = `Dados oficiais do Senado Federal (CEAPS) em ${escape(data.year)}: ${number(data.senators.length)} senadores, total publicado de ${money(data.totalCents)} (${number(data.records)} registros). Lançamentos sem tipo de despesa ficam fora dos totais.${state.metric === 'mensal' ? ` Gasto mensal divide o total pelos meses com exercício completo ou parcial${excludedMonthly ? `; ${excludedMonthly} ${excludedMonthly === 1 ? 'senador sem mês de exercício ficou' : 'senadores sem mês de exercício ficaram'} fora do ranking por mês` : ''}.` : ''} Não exibimos porcentagem do teto para senadores. <button class="text-button" data-action="methodology">Fontes e metodologia →</button>`;
      body = `<div class="cards">${senatorCards(data, ranked)}</div><p class="ranking-context">${note}</p>${senatorBarSection()}${editorialFollowUp()}`;
    }
    return `<section class="editorial-rank" id="rankings" aria-labelledby="editorial-rank-title"><h2 id="editorial-rank-title" class="sr-only">Senadores de ${escape(state.year)}</h2>${tabs()}<div class="editorial-controls"><div class="selects">${yearSelector()}<span class="real-year">Senado · ${escape(state.year)}${Number(state.year) === 2026 ? ' (parcial)' : ''}</span>${senatorCutoff(senatorState.data)}</div>${metricToggle()}</div>${body}</section>`;
  }
  function rankingSection() {
    if (state.house === 'senado') return senatorRankingSection();
    return `<section class="editorial-rank" id="rankings" aria-labelledby="editorial-rank-title"><h2 id="editorial-rank-title" class="sr-only">Deputados de ${state.year}</h2>${tabs()}<div class="editorial-controls"><div class="selects">${yearSelector()}<span class="real-year">${state.tab === 'projetos' && D.billsApproved && D.billsYears.length ? `Projetos apresentados em ${billsPeriod()}` : span()}</span><p class="context cutoff">${cutoff()}</p></div>${state.tab === 'projetos' ? '' : metricToggle()}</div><div class="cards">${cards()}</div><p class="ranking-context">${rankNote()}</p>${barSection()}${editorialFollowUp()}</section>`;
  }
  function answerHTML() {
    if (!state.answer) return '';
    const answer = state.answer;
    if (answer.type === 'loading') return '<section class="answer" aria-live="polite"><p class="loading-note">Carregando…</p></section>';
    if (answer.type === 'message') return `<section class="answer" aria-label="Resposta da investigação"><p class="eyebrow">Busca por regras locais · sem IA conectada</p><div class="answer-message"><h3>${escape(answer.title)}</h3><p>${escape(answer.message)}</p>${answer.switchYear ? `<p><button type="button" class="outline-button primary" data-year="${escape(answer.switchYear)}">Ver ${escape(answer.switchYear)}</button></p>` : ''}<div class="answer-next"><span>Tente:</span>${examples().slice(0, 2).map(q => `<button type="button" class="outline-button" data-question="${escape(q)}">${escape(q)}</button>`).join('')}</div></div></section>`;
    const ppl = answer.ids.map(person).filter(p => p && comparable(p));
    if (!ppl.length || ppl.length < answer.ids.length && answer.ids.length === 2) {
      const left = answer.ids.map(person).filter(p => p && !comparable(p));
      const why = left.map(p => `<p><strong>${escape(p.name)}</strong>: ${p.noExercise ? `não tem exercício de mandato confirmado em ${state.year}, então não há gastos para comparar.` : escape(exclusionNote(p))}</p>`).join('');
      return `<section class="answer"><p class="eyebrow">Resultado da investigação</p>${why || '<p>Nenhum deputado com exercício confirmado neste recorte.</p>'}</section>`;
    }
    const max = Math.max(1, ...ppl.map(p => Math.abs(value(p, answer.kind))));
    let summary = '';
    if (answer.type === 'compare') {
      const a = value(ppl[0], answer.kind), b = value(ppl[1], answer.kind), c = compareValues(a, b), x = escape(first(ppl[0])), y = escape(first(ppl[1]));
      summary = c.equal ? `${x} e ${y} têm o mesmo valor no recorte.` : c.percent === null ? `${x} registrou ${money(c.diff)} ${c.more ? 'a mais' : 'a menos'} em despesas no período do que ${y}. Sem percentual: o valor de ${b > 0 ? x : y} é ${b === 0 ? 'zero' : 'negativo'}, então não há base para uma porcentagem.` : `${x} registrou ${number(c.percent)}% ${c.more ? 'mais' : 'menos'} despesas no período.`;
    } else summary = `${escape(ppl[0].name)} ${answer.type !== 'rank' ? 'neste recorte' : state.tab === 'menos' ? 'tem o menor valor deste recorte' : 'lidera este recorte'}.`;
    const unit = state.category === 'Todas' ? 'Cota parlamentar' : label(state.category);
    return `<section class="answer" aria-label="Resultado da investigação"><p class="eyebrow">Resultado da investigação</p><div class="answer-bars">${ppl.map(p => `<div class="answer-row">${avatar(p)}<b>${escape(p.name)}</b><strong>${money(value(p, answer.kind))}</strong><span class="track"><i style="width:${Math.abs(value(p, answer.kind)) / max * 100}%"></i></span></div>`).join('')}</div><div class="answer-bottom"><div><p class="answer-summary">${summary}</p><p class="context">${escape(unit)} • ${span()}${state.metric === 'mensal' ? ' • média mensal' : ''}</p></div><div class="answer-actions"><button class="outline-button primary" data-action="answer-evidence">Como chegamos nisso? ${icon('external')}</button><button class="outline-button" data-action="share">${icon('share')} Compartilhar</button></div></div></section>`;
  }
  function handwrittenNote() {
    let index = 0;
    const lines = ['Todo número', 'tem uma', 'fonte.'];
    const letters = lines.map(line => `<span class="handwritten-line">${Array.from(line).map(char => {
      const delay = 500 + index++ * 75;
      return `<span class="handwritten-letter${char === ' ' ? ' handwritten-space' : ''}" style="--letter-delay:${delay}ms">${char === ' ' ? '&nbsp;' : escape(char)}</span>`;
    }).join('')}</span>`).join('');
    return `<p class="editorial-handwritten"><span class="sr-only">Todo número tem uma fonte.</span><span aria-hidden="true">${letters}</span></p>`;
  }
  function ceilingStep(everyone, step) {
    const out = everyone.filter(p => !usable(p)), idle = out.filter(p => p.noExercise).length, open = out.filter(p => !p.noExercise && p.use.missing?.length).length, none = out.length - idle - open;
    const parts = [idle && `${idle} sem exercício no ano`, open && `${open} com algum mês de exercício ou UF sem confirmação`, none && `${none} sem mês que entre na conta (retidos, parciais ou fora do mandato)`].filter(Boolean);
    return step(everyone.length - out.length, 'com % do teto da cota confirmada', parts.length ? `${out.length} sem: ${parts.join(', ')}.` : '');
  }
  function universe() {
    const everyone = all(), withData = everyone.filter(p => !p.noExercise), compared = everyone.filter(comparable);
    const step = (n, text, note) => `<li class="universe-step"><strong>${n}</strong><span>${text}</span>${note ? `<small>${note}</small>` : ''}</li>`;
    const noun = n => n === 1 ? 'deputado' : 'deputados';
    const lostData = everyone.length - withData.length, lostCompared = withData.length - compared.length;
    return `<section class="universe" id="universo" aria-labelledby="universe-title"><h2 id="universe-title" class="universe-title">Quem entra nas comparações</h2><ol class="universe-steps">${
      step(everyone.length, `${noun(everyone.length)} com mandato no recorte`, '')}${
      step(withData.length, 'com exercício confirmado ou despesas publicadas', lostData ? `${lostData} sem exercício confirmado nem despesa publicada.` : '')}${
      step(compared.length, `comparáveis: ao menos ${MIN_MONTHS} meses de exercício, sem mês em revisão`, lostCompared ? `${lostCompared} com menos meses de exercício ou algum mês em revisão.` : '')}${
      D.ceiling ? ceilingStep(everyone, step) : D.ceilingPending ? step('—', `limite de ${state.year} em conferência`, 'A porcentagem do teto da cota ainda não é mostrada para este ano.') : ''
    }</ol><button type="button" class="text-button" data-action="methodology">Como chegamos nisso? →</button></section>`;
  }
  function syncHouseElements() {
    const isSenado = state.house === 'senado';
    if (isSenado) closeSuggestions();
    for (const sel of ['#universo', '#answer-slot', '.search-wrap', '.editorial-search-examples', '.header-search']) {
      const el = $(sel);
      if (el) el.hidden = isSenado;
    }
  }
  function layout() {
    document.body.dataset.model = model;
    const main = `<section class="editorial-hero"><h1 class="editorial-title">O poder,<em>em números.</em></h1><div class="editorial-left"><p class="editorial-subtitle">Dados públicos para uma sociedade mais informada.</p>${searchForm()}<div class="editorial-search-examples" aria-label="Perguntas para experimentar"><span>Experimente:</span><button type="button" data-question="Quem mais gastou?">Quem mais gastou? ↗︎</button><button type="button" data-question="${escape(examples()[0])}">${escape(examples()[0])} ↗︎</button></div></div><div class="hero-portrait" id="hero-portrait">${photo(person(state.featured))}</div>${handwrittenNote()}<div class="editorial-feature" id="editorial-feature">${editorialFeature()}</div></section>${universe()}<div id="answer-slot" aria-live="polite">${answerHTML()}</div><div id="rank-slot">${rankingSection()}</div>`;
    $('#app').innerHTML = `<div class="site">${header()}<main id="main">${main}</main><footer class="footer"></footer></div>`;
    syncHouseElements();
  }
  function editorialFeature() {
    const p = person(state.featured);
    const choices = byTotal().slice(0, 3).map(c => `<button type="button" data-action="feature" data-id="${c.id}" aria-pressed="${c.id === p.id}">${avatar(c)}<span>${escape(first(c))}</span></button>`).join('');
    return `<p class="eyebrow">Destaque · dados oficiais</p><button class="feature-value" id="total" data-action="evidence" data-id="${p.id}" data-kind="gastos" data-amount="${value(p, 'gastos')}">${compact(value(p, 'gastos'))}</button><p>${state.metric === 'mensal' ? 'é a média mensal' : 'foi o total'} de despesas${state.category === 'Todas' ? '' : ' em ' + escape(label(state.category).toLowerCase())} de ${escape(p.name)} na cota parlamentar em ${span()}.</p><button class="text-button" data-action="evidence" data-id="${p.id}" data-kind="gastos">Como chegamos nisso? →</button><div class="feature-switch" role="group" aria-label="Escolha quem aparece no destaque"><span>Destaques</span>${choices}</div>`;
  }
  function feature(id) {
    if (id === state.featured) return;
    const from = Number($('#editorial-feature .feature-value')?.dataset.amount) || 0;
    state.featured = id;
    $('#editorial-feature').innerHTML = editorialFeature();
    const portrait = $('#hero-portrait');
    portrait.innerHTML = photo(person(id));
    syncURL();
    const moving = !matchMedia('(prefers-reduced-motion: reduce)').matches && document.body.dataset.motion !== 'off';
    $('#editorial-feature [data-action="feature"][aria-pressed="true"]')?.focus({ preventScroll: true });
    if (!moving) return;
    portrait.animate([{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0)' }], { duration: 560, easing: 'cubic-bezier(.77,0,.175,1)' });
    const el = $('#editorial-feature .feature-value'), to = Number(el.dataset.amount), start = performance.now();
    const tick = now => { const t = Math.min(1, (now - start) / 420), e = 1 - Math.pow(1 - t, 3); el.textContent = t < 1 ? compact(Math.round(from + (to - from) * e)) : compact(to); if (t < 1 && el.isConnected) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  let tabMark = null;
  function scopeChip() {
    let chip = $('#scope-chip');
    if (!chip) { chip = document.createElement('div'); chip.id = 'scope-chip'; chip.className = 'scope-chip'; chip.setAttribute('role', 'status'); $('#answer-slot').before(chip); }
    const narrowed = state.house === 'camara' && (state.uf !== 'Brasil' || state.category !== 'Todas' || state.metric === 'mensal');
    chip.hidden = !narrowed;
    const scope = [state.uf === 'Brasil' ? null : state.uf, state.category === 'Todas' ? null : label(state.category), state.metric === 'mensal' ? 'Por mês' : null].filter(Boolean).join(' · ');
    chip.innerHTML = narrowed ? `<span>Filtrando: ${escape(scope)}</span><button type="button" data-action="reset" aria-label="Limpar filtros"><span aria-hidden="true">✕</span> Limpar</button>` : '';
    const dock = $('#dock-filter');
    if (dock) { dock.hidden = !narrowed; dock.innerHTML = narrowed ? `<span>${escape(scope)}</span><span aria-hidden="true">✕</span>` : ''; dock.setAttribute('aria-label', `Filtro ativo: ${scope}. Limpar filtros`); }
  }
  function markTab(animate = true) {
    const tabsEl = $('.editorial-rank .tabs'), on = tabsEl?.querySelector('[aria-selected="true"]');
    if (!on) return;
    tabsEl.querySelectorAll('[role="tab"]').forEach(t => { t.tabIndex = t === on ? 0 : -1; });
    const next = { x: on.offsetLeft, w: on.offsetWidth };
    if (animate && tabMark) { tabsEl.style.setProperty('--tab-x', tabMark.x + 'px'); tabsEl.style.setProperty('--tab-w', tabMark.w + 'px'); tabsEl.getBoundingClientRect(); }
    tabsEl.style.setProperty('--tab-x', next.x + 'px'); tabsEl.style.setProperty('--tab-w', next.w + 'px');
    tabMark = next;
  }
  function refresh() {
    state.popover = null;
    const focused = document.activeElement;
    const focusKey = focused?.dataset?.house ? ['house', focused.dataset.house] : focused?.dataset?.metric ? ['metric', focused.dataset.metric] : focused?.dataset?.tab ? ['tab', focused.dataset.tab] : null;
    const before = new Map([...document.querySelectorAll('.rank-card')].map(el => [el.dataset.person, el.getBoundingClientRect()]));
    const isSenado = state.house === 'senado';
    syncHouseElements();
    $('#rank-slot').innerHTML = rankingSection();
    if (!isSenado && $('#editorial-feature')) $('#editorial-feature').innerHTML = editorialFeature();
    if (!isSenado && state.answer?.type === 'rank') state.answer.ids = ranking('gastos').slice(0, 3).map(p => p.id);
    if (!isSenado) $('#answer-slot').innerHTML = answerHTML();
    if (focusKey) document.querySelector(`[data-${focusKey[0]}="${focusKey[1]}"]`)?.focus({ preventScroll: true });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && document.body.dataset.motion !== 'off') document.querySelectorAll('.rank-card').forEach(el => {
      const old = before.get(el.dataset.person), now = el.getBoundingClientRect();
      if (old) el.animate([{ transform: `translate(${old.left - now.left}px,${old.top - now.top}px)`, opacity: .65 }, { transform: 'none', opacity: 1 }], { duration: 400, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
    markTab();
    scopeChip();
    syncURL();
    document.dispatchEvent(new CustomEvent('clareia:change'));
  }
  // Words that name one category, matched at the start of a word in the normalized question. Generic words of the official names (parlamentar, atividade, federal, distrito, exceto, apoio) and "mandato" alone must never select a category.
  const categoryTerms = {
    'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.': ['divulga'],
    'PASSAGEM AÉREA - SIGEPA': ['passage', 'aerea', 'aereo'],
    'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES': ['locac', 'fretamento', 'veiculo'],
    'COMBUSTÍVEIS E LUBRIFICANTES.': ['combust', 'lubrific'],
    'MANUTENÇÃO DE ESCRITÓRIO DE APOIO À ATIVIDADE PARLAMENTAR': ['escritorio'],
    'SERVIÇO DE TÁXI, PEDÁGIO E ESTACIONAMENTO': ['taxi', 'pedagio', 'estacionamento'],
    'HOSPEDAGEM ,EXCETO DO PARLAMENTAR NO DISTRITO FEDERAL.': ['hospedag'],
    'TELEFONIA': ['telefon'],
    'COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA': ['auxilio', 'moradia']
  };
  const categoryFor = q => categories.find(c => (categoryTerms[c] || []).some(term => new RegExp(`\\b${term}`).test(q)));
  let askRun = 0;
  // `fixed` holds filters the caller already decided (a shared link); they win over what the words imply. The answer is computed once, from the final state.
  function ask(query, scroll = true, fixed = {}) {
    state.query = query.trim();
    if (!state.query) { $('#query').focus(); return; }
    if (state.house === 'senado') state.house = 'camara';
    // The category order and the monthly cells come from fornecedores.json, so an answer waits for it.
    if (!D.suppliersLoaded()) {
      const run = ++askRun, pendingQuery = state.query;
      state.answer = { type: 'loading' };
      refresh();
      D.loadSuppliers().then(() => {
        if (run !== askRun || state.house !== 'camara' || state.query !== pendingQuery) {
          if (run === askRun && state.answer?.type === 'loading') state.answer = null;
          return;
        }
        ask(pendingQuery, scroll, fixed);
      }, () => {
        if (run !== askRun || state.house !== 'camara' || state.query !== pendingQuery) {
          if (run === askRun && state.answer?.type === 'loading') state.answer = null;
          return;
        }
        state.answer = null;
        refresh();
      });
      return;
    }
    const q = norm(state.query), years = q.match(/\b20\d{2}\b/g);
    let message;
    const asked = years?.find(y => y !== state.year), askedPublished = asked && otherYears().includes(asked);
    if (askedPublished) message = ['Período de outro ano', `A pergunta cita ${asked}, mas você está vendo ${span()}.`, asked];
    else if (asked) message = ['Período fora desta versão', `Esta versão contém ${span()}. Outros períodos ainda não foram publicados.`];
    else if (/projet|propost|votou|votaram|votac|reforma|corrup|roub|honest|melhor|pior|patrimon|emenda|salario|president|senador|partido/.test(q)) message = ['Não temos esse dado publicado', window.ClareiaData.billsApproved || window.ClareiaData.votesApproved ? 'A busca responde só sobre despesas da cota parlamentar. Projetos e votações aprovados ficam nas seções de atividade; o que não está lá ainda não foi conferido.' : 'Esta versão cobre só as despesas da cota parlamentar. Projetos, votações, patrimônio e emendas ainda não foram coletados e conferidos.'];
    if (!message) {
      const matches = all().filter(p => p.name.split(' ').some(word => word.length > 2 && new RegExp(`\\b${norm(word)}\\b`).test(q)));
      if (matches.length === 1 && /compar|\bmais que\b|\bmenos que\b|\bversus\b/.test(q)) message = ['Qual é o outro representante?', `Neste recorte, você pode comparar ${all().map(p => p.name).join(', ')}.`];
      else if (matches.length > 2) message = ['Escolha duas pessoas para comparar', `Experimente: “${examples()[0]}”.`];
      else if (!matches.length && !/\bquem\b|maiores gastos|menores gastos|^(gastos|despesas)$/.test(q)) message = ['Vamos delimitar a investigação', `Não identifiquei uma pergunta compatível ou uma pessoa deste recorte. Experimente “${examples()[0]}” ou “Quem mais gastou por mês?”. A busca usa regras locais, sem IA conectada.`];
      else {
        Object.assign(state, { metric: /por mes|mensal|media/.test(q) ? 'mensal' : 'total', category: categoryFor(q) || 'Todas', tab: /quem.*menos|menor gasto/.test(q) ? 'menos' : 'gastos' }, fixed);
        if (matches.length === 2) {
          matches.sort((a, b) => q.indexOf(norm(first(a))) - q.indexOf(norm(first(b))));
          state.answer = { type: 'compare', ids: matches.map(p => p.id), kind: 'gastos' };
        } else if (matches.length === 1) state.answer = { type: 'profile', ids: [matches[0].id], kind: 'gastos' };
        else state.answer = { type: 'rank', ids: ranking('gastos').slice(0, 3).map(p => p.id), kind: 'gastos' };
      }
    }
    if (message) {
      const cleared = state.uf !== 'Brasil' || state.category !== 'Todas' || state.metric !== 'total' || state.tab !== 'gastos' || Boolean(window.Clareia.portalActive?.());
      document.dispatchEvent(new CustomEvent('clareia:reset'));
      state.uf = 'Brasil'; state.category = 'Todas'; state.metric = 'total'; state.tab = 'gastos';
      state.answer = { type: 'message', title: message[0], message: cleared ? `${message[1]} Os filtros ativos foram limpos.` : message[1], switchYear: message[2] };
    }
    $('#query').value = state.query;
    closeSuggestions(); refresh();
    if (scroll) $('#answer-slot').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  }
  // Views opened from inside the dialog keep a trail back; anything opened from the page starts a new one.
  let dialogTrail = [], dialogView = null, navigating = false;
  function openView(render) {
    const nested = $('#detail').open && dialogView && session;
    if (nested) dialogTrail.push(dialogView); else dialogTrail = [];
    dialogView = { render, title: '' };
    if (nested) {
      session.d++; session.views.length = session.d;
      try { history.pushState({ clareia: session.id, d: session.d }, '', location.href); } catch { /* file previews may restrict history */ }
    }
    navigating = true;
    try { return render(); } finally { navigating = false; }
  }
  function goBack() {
    if (session?.live && session.d > 0) { history.back(); return; }
    const previous = dialogTrail.pop(); if (!previous) return;
    dialogView = previous; navigating = true;
    try { return previous.render(); } finally { navigating = false; }
  }
  function showDialog(title, html, resetScroll = true, route = null) {
    const dialog = $('#detail');
    // A view opened from outside the dialog (page click, direct link, timeline) starts a new trail and can be returned to.
    if (!navigating) { dialogTrail = []; dialogView = { render: () => showDialog(title, html, resetScroll, route), title }; } else if (dialogView) dialogView.title = title;
    const back = dialogTrail.at(-1);
    if (back && !html.includes('data-action="back-to-list"')) html = `<button type="button" class="text-button dialog-back" data-action="dialog-back">← Voltar: ${escape(back.title)}</button>` + html;
    const opening = !dialog.open;
    if (opening) dialogTrigger = document.activeElement;
    dialog.classList.remove('records-wide');
    $('#detail-title').textContent = title; $('#detail-body').innerHTML = html;
    if (opening) dialog.showModal();
    recordView(title, html, resetScroll, route, opening);
    if (resetScroll) dialog.scrollTop = 0;
    $('#detail .close-button').focus({ preventScroll: true });
  }
  // Every dialog is one history entry, and each view opened inside it is another, so Back and Forward walk the same trail as the buttons.
  let session = null, sessionSeq = 0, restoring = false, adopting = false, afterRestore = null;
  const pageTitle = { value: document.title };
  const writeHistory = (method, state, url) => { try { history[method](state, '', url); } catch { /* file previews may restrict history */ } };
  function recordView(title, html, resetScroll, route, opening) {
    if (restoring) { if (route) document.title = route.title; return; }
    if (opening || !session) {
      pageTitle.value = document.title;
      session = { id: `${Date.now()}-${++sessionSeq}`, views: [], d: 0, live: true, base: adopting ? 'self' : 'beneath' };
      writeHistory(adopting ? 'replaceState' : 'pushState', { clareia: session.id, d: 0 }, route?.url ?? location.href);
    } else if (route) writeHistory('replaceState', history.state, route.url);
    if (route) document.title = route.title;
    session.views[session.d] = { render: dialogView?.render ?? (() => showDialog(title, html, resetScroll, route)), title, docTitle: document.title };
  }
  async function restoreView(index) {
    const view = session.views[index];
    session.d = index; session.live = true;
    dialogTrail = session.views.slice(0, index).map(v => ({ render: v.render, title: v.title }));
    dialogView = { render: view.render, title: view.title };
    restoring = true; navigating = true;
    try { await view.render(); } finally { restoring = false; navigating = false; }
    document.title = view.docTitle;
  }
  const slugOf = name => norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const deputyPath = p => `/deputado/${p.officialId}-${slugOf(p.name)}`;
  const senatorPath = s => `/senador/${s.senatorId}-${slugOf(s.name)}`;
  function parseRoute(path) {
    let parts; try { parts = path.split('/').filter(Boolean).map(decodeURIComponent); } catch { return { type: 'unknown' }; }
    if (!parts.length || (parts.length === 1 && parts[0] === 'index.html')) return null;
    if (parts[0] === 'deputado') { const m = parts.length === 2 ? /^(\d+)(?:-.*)?$/.exec(parts[1]) : null; return { type: 'deputado', id: m?.[1] ?? null, slug: m ? parts[1].slice(m[1].length + 1) : '' }; }
    if (parts[0] === 'senador') { const m = parts.length === 2 ? /^(\d+)(?:-.*)?$/.exec(parts[1]) : null; return { type: 'senador', id: m?.[1] ?? null, slug: m ? parts[1].slice(m[1].length + 1) : '' }; }
    if (parts[0] === 'estado' && parts.length === 2) return { type: 'estado', uf: parts[1].toUpperCase() };
    if (parts.length === 1 && ['sobre', 'correcoes', 'metodologia', 'dados-abertos', 'apoie'].includes(parts[0])) return { type: 'page', name: parts[0] };
    return { type: 'unknown' };
  }
  const NOT_FOUND = {
    deputado: ['Deputado(a) não encontrado(a)', 'Não existe deputado(a) com este endereço nesta versão dos dados. Confira o link ou procure pelo nome na busca. Nenhum outro perfil foi exibido no lugar.'],
    senador: ['Senador(a) não encontrado(a)', 'Não existe senador(a) com este endereço nesta versão dos dados. Confira o link ou consulte o ranking do Senado. Nenhum outro perfil foi exibido no lugar.'],
    estado: ['Estado não encontrado', 'Este endereço não corresponde a nenhuma UF. Use a sigla de duas letras, como SP ou BA, ou escolha um estado no mapa.'],
    unknown: ['Página não encontrada', 'Este endereço não existe no Clareia. Volte ao início para ver os rankings e a busca.']
  };
  function notFound(kind, url) {
    const [title, text] = NOT_FOUND[kind];
    showDialog(title, `<p class="records-note" role="alert">${text}</p><div class="action-row"><button type="button" class="outline-button primary" data-action="close">Ir para o início</button></div>`, true, { url, title: `${title} — Clareia` });
  }
  function openRoute(route, { initial = false } = {}) {
    const target = location.pathname + location.search;
    if (route.type === 'senador') {
      if (initial) writeHistory('replaceState', null, '/' + homeQuery());
      openSenatorRoute(route, target);
      return;
    }
    if (initial) writeHistory('replaceState', null, '/' + location.search);
    const found = route.type === 'deputado' && route.id ? person(route.id) : null;
    if (found) profile(found.id); else if (route.type === 'deputado' && route.id && D.years.length > 1) absentDeputy(route, target); else notFound(route.type, target);
  }
  let senatorRouteRun = 0;
  async function openSenatorRoute(route, target) {
    const run = ++senatorRouteRun;
    if (!D.senators || !route.id) { notFound('senador', target); return; }
    const stillActive = () => run === senatorRouteRun && $('#detail').open && $('#detail [data-senator-run]')?.dataset.senatorRun === String(run);
    showDialog('Perfil do senador', `<p class="records-note records-loading" data-senator-run="${run}" role="status">Carregando dados do Senado…</p>`, true, { url: target, title: 'Senado — Clareia' });
    let loaded;
    try { loaded = await loadSenatorsYear(state.year); }
    catch {
      if (!stillActive()) return;
      showDialog('Dados indisponíveis', '<p class="records-note" role="alert">Não foi possível carregar os dados do Senado agora. Nenhum valor foi estimado.</p><div class="action-row"><button type="button" class="outline-button primary" data-action="close">Fechar</button></div>', true, { url: target, title: 'Dados indisponíveis — Clareia' });
      return;
    }
    if (!stillActive()) return;
    const found = loaded.data?.senators.find(s => String(s.senatorId) === String(route.id) && senatorNamed(s));
    if (found) {
      if (senatorState.year === state.year && !senatorState.data) { senatorState.index = loaded.index; senatorState.data = loaded.data; senatorState.status = 'ready'; }
      senatorProfile(found, loaded.data);
      return;
    }
    const present = [];
    await Promise.all((loaded.index?.years ?? []).filter(y => String(y.year) !== state.year).map(async y => {
      try {
        const other = await loadSenatorsYear(y.year);
        if (other.data?.senators.some(s => String(s.senatorId) === String(route.id) && senatorNamed(s))) present.push(String(y.year));
      } catch { /* an unreachable year just does not get offered */ }
    }));
    if (!stillActive()) return;
    if (!present.length) { notFound('senador', target); return; }
    present.sort();
    const path = `/senador/${route.id}${route.slug ? '-' + route.slug : ''}`, link = y => `${path}${y === D.defaultYear ? '' : `?ano=${y}`}`;
    const title = `Sem dados em ${D.year}`;
    showDialog(title, `<p class="records-note" role="alert">Este(a) senador(a) não tem dados publicados em ${escape(D.year)}. Há dados em ${present.map(escape).join(' e ')}.</p><div class="action-row">${present.map(y => `<a class="outline-button primary" href="${escape(link(y))}">Ver em ${escape(y)}</a>`).join('')}<button type="button" class="outline-button" data-action="close">Ir para o início</button></div>`, true, { url: target, title: `${title} — Clareia` });
  }
  const EXERCISE_LABEL = { full: 'Exercício completo', partial: 'Exercício parcial', outside: 'Fora do mandato', unknown: 'Exercício não confirmado', conflict: 'Exercício em revisão' };
  function senatorProfile(s, yearData) {
    if (!senatorNamed(s)) return;
    const name = s.name.trim(), uf = senatorUf(s), exercised = senatorExercised(s), monthly = senatorMonthly(s);
    const route = { url: withYear(senatorPath(s)), title: `${name} — Clareia` };
    const types = Object.entries(s.byType).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
    const maxType = Math.max(1, ...types.map(([, v]) => Math.abs(v)));
    const byTypeHtml = types.length
      ? types.map(([tipo, cents]) => `<div class="category-row"><div class="category-head"><span>${escape(tipo)}</span><strong>${money(cents)}</strong></div><span class="track"><i style="width:${Math.abs(cents) / maxType * 100}%;opacity:.7"></i></span></div>`).join('')
      : '<p class="context">Nenhuma despesa registrada neste ano.</p>';
    const monthKeys = Object.keys(s.byMonth).map(Number).filter(m => m >= 1 && m <= 12).sort((a, b) => a - b);
    const byMonthHtml = monthKeys.length
      ? monthKeys.map(m => {
        const items = Object.entries(s.byMonth[String(m)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
        return `<div class="senator-month-group"><h4>${months[m - 1]} / ${escape(s.year)}</h4><ul class="senator-sublist">${items.map(([tipo, cents]) => `<li class="senator-item"><span>${escape(tipo)}</span><strong>${money(cents)}</strong></li>`).join('')}</ul></div>`;
      }).join('')
      : '<p class="context">Nenhuma despesa por mês registrada neste ano.</p>';
    const allSuppliers = Object.entries(s.suppliers).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
    const topSuppliers = allSuppliers.slice(0, 10);
    const suppliersHtml = topSuppliers.length
      ? `<ul class="senator-sublist">${topSuppliers.map(([labelName, cents]) => `<li class="senator-item"><span>${escape(labelName)}</span><strong>${money(cents)}</strong></li>`).join('')}</ul>${allSuppliers.length > topSuppliers.length ? `<p class="context">Mostrando os ${topSuppliers.length} principais de ${number(allSuppliers.length)} fornecedores.</p>` : ''}`
      : '<p class="context">Nenhum fornecedor registrado neste ano.</p>';
    const exerciseRows = [...(s.months || [])].sort((a, b) => a.month - b.month).map(m => {
      const ex = EXERCISE_LABEL[m.exercise] || m.exercise;
      const warn = m.exercise !== 'full';
      const isSub = typeof m.participation === 'string' && /suplente/i.test(m.participation);
      return `<li class="senator-month-row"><strong>${months[m.month - 1] || `Mês ${escape(m.month)}`}${m.uf ? ` · ${escape(m.uf)}` : ''}</strong><span class="senator-tags"><span class="senator-tag${warn ? ' senator-tag-warn' : ''}">${escape(ex)}</span>${isSub ? `<span class="senator-tag senator-tag-sub">${escape(m.participation)}</span>` : ''}</span></li>`;
    }).join('');
    const exerciseHtml = exerciseRows ? `<ul class="senator-months">${exerciseRows}</ul>` : '<p class="context">Sem cobertura mensal informada para este ano.</p>';
    const emptyCount = Number(s.review?.['empty-type'] ?? 0);
    const emptyNote = emptyCount > 0
      ? `<p class="records-note" role="note">${number(emptyCount)} ${emptyCount === 1 ? 'lançamento sem tipo de despesa ficou' : 'lançamentos sem tipo de despesa ficaram'} fora dos totais desta página.</p>`
      : '<p class="records-note">Lançamentos sem tipo de despesa ficam fora dos totais.</p>';
    const cutoffHtml = yearData?.collectedAt && s.months?.length ? `<p class="context cutoff">${escape(ClareiaView.cutoffLine(s.months.map(m => m.month), s.year, yearData.collectedAt))}</p>` : '';
    const html = `<div class="profile-head">${avatar({ name, photo: null })}<div><h3>${escape(name)}</h3><p class="context">Senador(a)${uf ? ` • ${escape(uf)}` : ''} • Código Senado ${escape(s.senatorId)}</p><p class="context">CEAPS ${escape(s.year)} • ${number(s.records)} ${s.records === 1 ? 'registro' : 'registros'}</p>${cutoffHtml}</div></div>` +
      `<div class="profile-stats"><div class="profile-stat"><span>Despesas em ${escape(s.year)}</span><strong>${money(s.totalCents)}</strong></div><div class="profile-stat"><span>Média por mês de exercício</span><strong>${monthly !== null ? money(monthly) : 'Sem mês de exercício'}</strong></div></div>` +
      `<p class="context">${exercised > 0 ? `${exercised} ${monthsWord(exercised)} com exercício completo ou parcial no ano.` : 'Sem exercício completo ou parcial no ano; fora do ranking por mês.'}</p>${emptyNote}` +
      `<section class="detail-section"><h3>Despesas por tipo</h3>${byTypeHtml}</section>` +
      `<section class="detail-section"><h3>Despesas por mês</h3>${byMonthHtml}</section>` +
      `<section class="detail-section"><h3>Principais fornecedores</h3>${suppliersHtml}</section>` +
      `<section class="detail-section"><h3>Exercício do mandato por mês</h3>${exerciseHtml}</section>` +
      `<div class="action-row"><button type="button" class="share-button" data-action="copy-senator-link" data-senator-id="${s.senatorId}">Compartilhar</button><button type="button" class="outline-button" data-action="methodology">Fontes e metodologia</button></div>` +
      `<div class="fixture-note">Dados oficiais do Senado Federal (CEAPS), versão ${escape((yearData?.publicationId || '').slice(0, 12))}. Verificações automáticas não são auditoria do gasto.</div>`;
    showDialog('Perfil do senador', html, true, route);
  }
  async function copySenatorLink(senatorId, button) {
    const s = senatorState.data?.senators.find(x => String(x.senatorId) === String(senatorId) && senatorNamed(x));
    if (!s) return;
    const url = location.origin + withYear(senatorPath(s));
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: `${s.name} — Clareia`, text: `Despesas de ${s.name} no Senado, com dados oficiais.`, url }); return; } catch (error) { if (error?.name === 'AbortError') return; } }
    const copied = () => { toast('Link do perfil copiado.'); const text = button.textContent; button.textContent = 'Link copiado'; setTimeout(() => { if (button.isConnected) button.textContent = text; }, 2000); };
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(url); copied(); return; } catch { /* falls back to a selectable field */ }
    let box = $('#profile-link-box');
    if (!box) { box = document.createElement('div'); box.id = 'profile-link-box'; box.className = 'manual-share'; box.innerHTML = `<label for="profile-link">Copie o link do perfil</label><input id="profile-link" readonly value="${escape(url)}">`; button.closest('.action-row').after(box); }
    const field = $('#profile-link'); field.focus(); field.select();
    try { if (document.execCommand('copy')) copied(); } catch { /* the selected field is the fallback */ }
  }
  async function absentDeputy(route, target) {
    const present = [];
    await Promise.all(D.years.filter(y => String(y.year) !== D.year).map(async y => {
      try { const other = await (await fetch(`${D.yearBase(y.year)}/index.json`)).json(); if (other.scope.ids.map(String).includes(route.id)) present.push(String(y.year)); } catch { /* an unreachable year just does not get offered */ }
    }));
    if (!present.length) { notFound('deputado', target); return; }
    present.sort();
    const path = `/deputado/${route.id}${route.slug ? '-' + route.slug : ''}`, link = y => `${path}${y === D.defaultYear ? '' : `?ano=${y}`}`;
    const title = `Sem dados em ${D.year}`;
    showDialog(title, `<p class="records-note" role="alert">Este(a) deputado(a) não tem despesas publicadas em ${escape(D.year)}. Há dados em ${present.map(escape).join(' e ')}.</p><div class="action-row">${present.map(y => `<a class="outline-button primary" href="${escape(link(y))}">Ver em ${escape(y)}</a>`).join('')}<button type="button" class="outline-button" data-action="close">Ir para o início</button></div>`, true, { url: target, title: `${title} — Clareia` });
  }
  function closeFromHistory() { if (session) session.live = false; $('#detail').close(); }
  window.addEventListener('popstate', async () => {
    const st = history.state;
    if (session && st?.clareia === session.id && session.views[st.d]) { await restoreView(st.d); const after = afterRestore; afterRestore = null; after?.(); return; }
    const route = parseRoute(location.pathname);
    if (route?.type === 'deputado' || route?.type === 'senador' || route?.type === 'unknown') {
      adopting = true;
      try { openRoute(route); } finally { adopting = false; }
    } else if ($('#detail').open) closeFromHistory();
  });
  const union = () => index.validation.sourceKind === 'annual-api-union';
  const sourceNote = () => `<div class="fixture-note">Dados oficiais da Câmara dos Deputados, versão ${escape(index.snapshotId.slice(0, 12))}. Verificações automáticas não são auditoria do gasto; revisão humana ampla ainda pende.</div>`;
  function sourceBlock(p) {
    return `<section class="detail-section"><div class="source-block">${icon('database')}<div><h3>Fonte oficial</h3><a href="https://dadosabertos.camara.leg.br/howtouse/2023-12-26-dados-ceap.html" target="_blank" rel="noopener noreferrer">Dados da cota parlamentar (CEAP) ↗︎</a><p>${union() ? 'Arquivo anual CEAP e API da Câmara, combinados porque nenhum está completo sozinho.' : 'Arquivo anual CEAP da Câmara.'} Cada registro leva ao arquivo de origem.</p></div></div></section>${sourceNote()}`;
  }
  function categoryBreakdown(p) {
    const list = categories.map(category => ({ category, total: sum(p.cells.filter(r => r.category === category)) })).filter(item => item.total !== 0).sort((x, y) => y.total - x.total);
    const max = Math.max(1, ...list.map(item => Math.abs(item.total)));
    return `<section class="detail-section"><h3>Despesas de ${escape(first(p))}</h3>${list.map(item => `<div class="category-row"><div class="category-head"><span>${escape(label(item.category))}</span><strong>${money(item.total)}</strong></div><small class="source-name">Nome na fonte: ${escape(item.category)}</small><span class="track"><i style="width:${Math.abs(item.total) / max * 100}%;opacity:.7"></i></span></div>`).join('')}<p class="context">Total do período: ${money(totalOf(p))}. ${state.category !== 'Todas' ? `O recorte atual usa apenas ${escape(label(state.category))}.` : ''}</p></section>`;
  }
  const monthSpan = ms => {
    const s = [...ms].sort((a, b) => a - b);
    return s.length > 2 && s.every((m, i) => i === 0 || m === s[i - 1] + 1) ? `${months[s[0] - 1]} a ${months[s.at(-1) - 1]}` : s.map(m => months[m - 1]).join(', ');
  };
  function ceilingEvidence(p) {
    const u = p.use, c = D.ceiling, why = { partial: 'mês parcial (posse ou afastamento no meio do mês): a cota é proporcional aos dias e a base de dias não é pública, então o mês fica fora das despesas e do limite', held: 'mês em revisão: fora da soma de despesas e do limite', noCeiling: 'sem teto confirmado' };
    const officialMonths = c.sources ? new Set(c.sources.filter(s => s.official).flatMap(s => s.months)) : null;
    const rows = u.counted.map(m => `<tr><td>${months[m.month - 1]}${officialMonths?.has(m.month) ? ' <small class="ceiling-official">(oficial)</small>' : ''}</td><td>${escape(m.uf)}</td><td>${money(m.expenseCents)}</td><td>${money(m.ceilingCents)}</td></tr>`).join('');
    const groupMap = new Map();
    for (const m of u.counted) { const key = `${m.uf}\0${m.ceilingCents}`, g = groupMap.get(key) ?? { uf: m.uf, ceilingCents: m.ceilingCents, count: 0 }; g.count++; groupMap.set(key, g); }
    const groups = [...groupMap.values()].map(g => `${escape(g.uf)}: ${g.count} ${monthsWord(g.count)} × ${money(g.ceilingCents)}`);
    const records = u.counted.reduce((n, m) => n + m.records, 0);
    const left = [...u.excluded.map(m => `<li><strong>${months[m.month - 1]}</strong>: ${why[m.reason]}.</li>`), ...(u.outside.length ? [`<li><strong>${u.outside.map(m => months[m - 1]).join(', ')}</strong>: fora do exercício do mandato, sem despesa; não contam como mês excluído.</li>`] : [])];
    const ranked = all().filter(comparable).filter(usable), above = ranked.filter(o => o.use.expenseCents > o.use.ceilingCents).length;
    const sourceLine = c.sources
      ? `(${c.sources.map(s => `${monthSpan(s.months)}: ${escape(s.act)} (${s.official ? `oficial, em vigor desde ${day(s.effectiveFrom)}` : `capturado em ${day(s.effectiveFrom)}`})`).join('; ')})`
      : `, ${escape(c.act)}, em vigor desde ${day(c.effectiveFrom)}`;
    const noteTail = c.note ? ` Nota: ${escape(c.note)}.` : '';
    const resultBox = c.note
      ? `<div class="calculation-result" title="${escape(c.note)}">${pctText(p)}*<small>do limite usado, calculado sobre as somas exatas em centavos</small><small class="ceiling-note">* ${escape(c.note)}</small></div>`
      : `<div class="calculation-result">${pctText(p)}<small>do limite usado, calculado sobre as somas exatas em centavos</small></div>`;
    showDialog('Como chegamos nisso?', `<p class="dialog-subtitle">A porcentagem do teto, passo a passo</p><p class="ceiling-warning"><strong>Atenção:</strong> ${above} de ${ranked.length} deputados comparáveis do país aparecem acima de 100% no ano. O limite usado aqui é só o valor base da UF: não inclui as passagens extras a Brasília pagas “além da cota” desde 2023, que nos dados aparecem como passagens comuns, nem os adicionais de líderes e de outros cargos. Por isso o % superestima o uso de muitos deputados. Use-o como referência entre estados, não como prova de que alguém passou do limite. Um mês isolado também pode passar de 100%, porque o saldo não usado acumula ao longo do ano.</p>
      <section class="evidence-step"><span class="step-number">1</span><div><h3>O que estamos calculando</h3><p>Quanto do limite mensal da cota parlamentar foi usado por ${escape(p.name)} em ${span()}: despesas ÷ limite, somados nos meses contados. A UF é a de representação em cada mês.</p></div></section>
      <section class="evidence-step"><span class="step-number">2</span><div><h3>Os ${u.counted.length} ${monthsWord(u.counted.length)} contados</h3><table class="data-table ceiling-table"><thead><tr><th>Mês</th><th>UF</th><th>Despesas</th><th>Limite da UF</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th colspan="2">Soma</th><td>${money(u.expenseCents)}</td><td>${money(u.ceilingCents)}</td></tr></tfoot></table></div></section>
      <section class="evidence-step"><span class="step-number">3</span><div><h3>Soma das despesas</h3><p>${records} registros oficiais, valor líquido, nos meses contados.</p><div class="calculation-result">${money(u.expenseCents)}<small>despesas dos meses contados</small></div></div></section>
      <section class="evidence-step"><span class="step-number">4</span><div><h3>Soma do limite</h3><p>${groups.join('; ')}.</p><div class="calculation-result">${money(u.ceilingCents)}<small>limite dos meses contados</small></div></div></section>
      <section class="evidence-step"><span class="step-number">5</span><div><h3>A divisão</h3><p>${money(u.expenseCents)} ÷ ${money(u.ceilingCents)} × 100</p>${resultBox}<div class="action-row"><button class="outline-button primary" data-action="records" data-id="${p.id}">Ver registros</button></div></div></section>
      <section class="evidence-step"><span class="step-number">6</span><div><h3>Meses fora da conta</h3>${left.length ? `${u.excluded.length ? `<p><strong>${u.excluded.length} ${monthsWord(u.excluded.length)} ${u.excluded.length === 1 ? "excluído" : "excluídos"}.</strong></p>` : ''}<ul class="ceiling-excluded">${left.join('')}</ul>` : '<p>Nenhum mês excluído: todos os meses de exercício entraram na conta.</p>'}</div></section>
      <p class="records-note" role="note">Limite: valor base mensal da UF${c.sources ? ' ' : ''}${sourceLine}.${noteTail} Não inclui adicionais de líderes e outros cargos. Um mês isolado pode passar de 100%, porque o saldo acumula no ano. Passagens extras a Brasília “além da cota” entram como passagens comuns e podem superestimar o %.</p>
      <div class="action-row"><button class="outline-button" data-action="methodology">Fontes e metodologia</button></div>${sourceNote()}`);
  }
  function ceilingMethod() {
    const c = D.ceiling;
    if (!c) return '';
    const howToRead = sourceLinks => `<div class="doc-callout"><p>Como ler: o saldo não usado acumula ao longo do ano (art. 13 do Ato 43), então um mês isolado pode passar de 100%. Os adicionais de líderes e de outros cargos e as missões do Parlamento do Mercosul não estão no limite usado. Os trechos aéreos extras a Brasília “além da cota”, previstos desde 2023, aparecem na fonte como passagens comuns e não estão no limite usado. Por isso muitos deputados aparecem acima de 100% no ano: o % superestima o uso e serve para comparar estados, não para afirmar que alguém passou do limite. O percentual não mede irregularidade, qualidade do mandato nem se relaciona a projetos ou votações. ${sourceLinks}.</p></div>`;
    const annexLink = `<a href="${escape(safeUrl(c.annexUrl))}" target="_blank" rel="noopener noreferrer">Ato da Mesa nº 43/2009, Anexo Único ↗︎</a>`;
    if (!c.sources) return `<h3>% do teto da cota usado</h3><p>Divide as despesas dos meses contados pelo limite mensal da cota da UF de representação nesses mesmos meses. O limite é o valor base do Anexo Único do <a href="${escape(safeUrl(c.annexUrl))}" target="_blank" rel="noopener noreferrer">Ato da Mesa nº 43/2009</a>, na redação dada pelo <a href="${escape(safeUrl(c.actUrl))}" target="_blank" rel="noopener noreferrer">Ato da Mesa nº 270/2023</a>, em vigor desde ${day(c.effectiveFrom)}. Contam os meses de exercício completo: o mês de posse ou afastamento no meio do mês, o mês em revisão e os meses fora do mandato ficam fora das duas somas. Só entram deputados comparáveis, e quem tem algum mês sem limite confirmado fica de fora, nunca com 0%.</p>${howToRead(`Fonte do limite: ${annexLink}`)}`;
    const official = c.sources.find(s => s.official), portal = c.sources.find(s => !s.official);
    const missingNames = (c.noCeilingMonths || []).map(m => months[m - 1].toLowerCase()).join(', ');
    const officialText = official ? `Em ${monthSpan(official.months).toLowerCase()}, o limite é o valor base oficial do Anexo Único do <a href="${escape(safeUrl(official.annexUrl))}" target="_blank" rel="noopener noreferrer">Ato da Mesa nº 43/2009</a>, na redação dada pelo <a href="${escape(safeUrl(official.actUrl))}" target="_blank" rel="noopener noreferrer">Ato da Mesa nº 270/2023</a>, em vigor desde ${day(official.effectiveFrom)}. ` : '';
    const missingText = missingNames ? `${missingNames.charAt(0).toUpperCase() + missingNames.slice(1)} não tem teto confirmado e fica fora das despesas e do limite. ` : '';
    const portalSpan = portal ? monthSpan(portal.months).toLowerCase() : '';
    const portalText = portal ? `${portalSpan.includes(' a ') ? 'De' : 'Em'} ${portalSpan}, os valores vêm da <a href="${escape(safeUrl(portal.annexUrl))}" target="_blank" rel="noopener noreferrer">página de gastos parlamentares da Câmara ↗︎</a> (capturados em ${day(portal.effectiveFrom)}). ` : '';
    const noteText = c.note ? `Nota: ${escape(c.note)}. ` : '';
    const sourceLinks = portal ? `Fontes do limite: ${annexLink} e <a href="${escape(safeUrl(portal.annexUrl))}" target="_blank" rel="noopener noreferrer">página da Câmara ↗︎</a>` : `Fonte do limite: ${annexLink}`;
    return `<h3>% do teto da cota usado</h3><p>Divide as despesas dos meses contados pelo limite mensal da cota da UF de representação nesses mesmos meses. ${officialText}${missingText}${portalText}${noteText}Contam os meses de exercício completo: o mês de posse ou afastamento no meio do mês, o mês em revisão, meses sem teto confirmado e os meses fora do mandato ficam fora das duas somas. Só entram deputados comparáveis, e quem tem algum outro mês sem limite confirmado fica de fora, nunca com 0%.</p>${howToRead(sourceLinks)}`;
  }
  function evidence(id, options = {}) {
    if (person(id)?.noExercise && options.kind !== 'projetos') { showDialog('Sem exercício confirmado', `<p>${escape(person(id).name)} não tem exercício de mandato confirmado em ${state.year} nas fontes oficiais, e não há despesas nesse período. Por isso não aparece valor nem entra no ranking de gastos.</p>`); return; }
    const p = person(id), kind = options.kind || state.tab, comparison = options.compare ? person(options.compare) : null;
    if (kind === 'projetos' && window.ClareiaData.billsApproved) { showDialog('Projetos aprovados', `<p class="records-note">${escape(p.name)} · ${billsPeriod()}</p><h3>${p.approved === null ? pending : approvedText(p)}</h3><p>Contamos PL, PLP e PEC apresentados em ${billsPeriod()} em que o deputado é proponente (autor), não apenas signatário, e que viraram norma jurídica: lei ordinária, lei complementar ou emenda constitucional, com a norma identificada no despacho oficial da Câmara.</p>${p.projects === null ? '' : `<p class="context">Apresentou ${number(p.projects)} como proponente no período; projetos apresentados não equivalem a leis aprovadas.</p>`}<p>A autoria e a situação de cada proposta estão na seção de atividade.</p><div class="action-row"><button class="outline-button" data-action="methodology">Fontes e metodologia</button></div>${sourceNote()}`); return; }
    if (kind === 'projetos') { showDialog('Projetos de lei', `<p class="records-note">Projetos de lei ainda não foram coletados nesta versão.</p><p>A próxima etapa inclui PL, PLP e PEC, separando autoria principal de coautoria. Nenhum número é mostrado antes da conferência.</p>${sourceNote()}`); return; }
    if (kind === 'teto' && p.use.status === 'ok') { ceilingEvidence(p); return; }
    const amount = value(p, 'gastos'), total = sum(cells(p));
    let formula = state.metric === 'mensal' ? `${money(total)} ÷ ${p.months} meses no recorte` : `Soma de ${count(cells(p))} registros = ${money(total)}`;
    let result = money(amount), resultCaption = state.metric === 'mensal' ? 'por mês no recorte' : 'no período';
    if (comparison) {
      const b = value(comparison, 'gastos'), c = compareValues(amount, b);
      if (c.percent === null) {
        formula = `${money(amount)} − ${money(b)}`;
        result = money(c.diff);
        resultCaption = c.equal ? 'valores iguais no recorte' : `${c.more ? 'a mais' : 'a menos'} no período, sem percentual: o valor de ${escape(first(comparison))} é ${b < 0 ? 'negativo' : 'zero'}`;
      } else {
        formula = `(${money(amount)} − ${money(b)}) ÷ ${money(b)} × 100`;
        result = `${number(c.percent)}%`;
        resultCaption = c.equal ? 'valores iguais no recorte' : `${c.more ? 'a mais' : 'a menos'} no período`;
      }
    }
    showDialog('Como chegamos nisso?', `<p class="dialog-subtitle">${comparison ? 'A comparação, passo a passo' : 'O cálculo, passo a passo'}</p>
      <section class="evidence-step"><span class="step-number">1</span><div><h3>O que estamos comparando</h3><p>Despesas da cota parlamentar (valor líquido) • ${span()}</p><p>${escape(p.name)}${comparison ? ` × ${escape(comparison.name)}` : ''}</p></div></section>
      ${exclusionNote(p) ? `<p class="records-note held-note" role="note">${exclusionNote(p)}</p>` : ''}
      <section class="evidence-step"><span class="step-number">2</span><div><h3>Quais registros entram</h3><p>${count(cells(p))} registros oficiais${comparison ? ` + ${count(cells(comparison))} de ${escape(comparison.name)}` : ''}, ${union() ? 'do arquivo anual e da API da Câmara' : 'do arquivo anual da Câmara'}. ${state.category !== 'Todas' ? `Categoria: ${escape(label(state.category))}.` : ''}</p><p>Identidade ligada ao ID oficial da Câmara ${escape(p.officialId)}${comparison ? ` e ${escape(comparison.officialId)}` : ''}. Cada valor foi convertido em centavos antes da soma.</p></div></section>
      <section class="evidence-step"><span class="step-number">3</span><div><h3>Como calculamos</h3><p>${formula}</p><div class="calculation-result">${result}<small>${resultCaption}</small></div><div class="action-row"><button class="outline-button primary" data-action="records" data-id="${p.id}">Ver registros</button></div></div></section>
      ${categoryBreakdown(p)}${sourceBlock(p)}`);
  }
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const date = s => new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  // The Câmara publishes ideDocumento 0 for internal phone charges (ramal, celular funcional, linha direta): an identifier placeholder, not an amount.
  const day = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : 'Não informada'; };
  const noDocument = r => String(r.documentId) === '0';
  const docLabel = r => noDocument(r) ? 'Sem documento fiscal (código 0 na fonte)' : `Documento ${escape(r.documentId)}`;
  const originLabel = r => r.origin === 'api' ? `Só na API (ausente do arquivo anual capturado em ${date(index.collectedAt)})` : r.origin === 'annual' ? 'Só no arquivo anual' : 'Arquivo anual e API';
  const recordRow = (p, r, who = false) => `<tr class="record-row" data-action="record" data-id="${p.id}" data-record="${escape(r.id)}"><td class="record-when">${monthNames[r.month]}/${state.year}<small>${docLabel(r.raw)}</small></td><td class="record-what"><span class="record-supplier">${escape(r.supplier)}</span><small class="record-meta">${escape(label(r.category))}${who ? ` · ${escape(first(p))}` : ''}<span class="record-extra"> · ${monthNames[r.month]}/${state.year} · ${docLabel(r.raw)}</span></small>${r.raw.origin ? `<small class="record-origin">${originLabel(r.raw)}</small>` : ''}</td><td class="record-amount">${money(r.amount)}</td><td class="record-go"><button type="button" class="text-button" aria-label="Conferir registro de ${escape(r.supplier)}: ${docLabel(r.raw)}">Conferir →</button></td></tr>`;
  const byRecordOrder = (x, y) => x.month - y.month || y.amount - x.amount;
  const recordListHTML = (caption, rows, total) => `<table class="record-list"><caption class="sr-only">${caption}</caption><thead><tr><th>Competência / documento</th><th>Fornecedor / categoria</th><th>Valor líquido</th><th><span class="sr-only">Ação</span></th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="4">Nenhum registro neste recorte. Isso não afirma ausência de despesas fora da cobertura.</td></tr>'}</tbody><tfoot><tr><th colspan="2">Total</th><td><strong class="record-list-total">${money(total)}</strong></td><td>${rows.length} itens</td></tr></tfoot></table>`;
  // The record detail goes back to whichever list opened it, with the same rows and filter.
  const rememberList = reopen => { listOrigin = reopen; };
  async function backToList(personId, recordId) {
    await (listOrigin || (() => recordTable(person(personId))))();
    const row = [...document.querySelectorAll('#detail .record-row')].find(tr => tr.dataset.record === recordId);
    row?.querySelector('button')?.focus();
  }
  // Totals come from the summary; a deputy's records file is fetched only when one of their lists is opened.
  const recordCache = new Map(), recordsReady = new Set();
  let recordRun = 0;
  function loadRecords(p) {
    const id = p.officialId;
    if (!recordCache.has(id)) recordCache.set(id, fetch(D.recordsUrl(id)).then(r => { if (r.status === 404 && !p.cells.length) return []; if (!r.ok) throw new Error(); return r.json(); }).then(raw => { recordsReady.add(id); return raw.map(x => ({ id: x.id, date: x.date, month: x.month - 1, category: x.category, amount: x.cents, supplier: x.supplierLabel ?? x.supplier, raw: x })); }).catch(error => { recordCache.delete(id); throw error; }));
    return recordCache.get(id);
  }
  // While a file loads the dialog says so. A late result is dropped if a newer request started or another dialog replaced the note.
  async function withRecords(people, render) {
    const run = ++recordRun, waiting = people.some(p => !recordsReady.has(p.officialId)), stillWanted = () => run === recordRun && (!waiting || Boolean($('#detail').open && $('#detail .records-loading')));
    // The trail belongs to the view that asked for the records, even though they arrive later.
    const nav = navigating, later = fn => { navigating = nav; try { fn(); } finally { navigating = false; } };
    if (waiting) showDialog('Registros oficiais', '<p class="records-note records-loading" role="status">Carregando registros oficiais…</p>');
    let lists;
    try { lists = await Promise.all(people.map(loadRecords)); }
    catch { if (stillWanted()) later(() => showDialog('Registros oficiais', '<p class="records-note" role="alert">Registros indisponíveis agora. Nenhum valor foi estimado.</p>')); return; }
    if (stillWanted()) later(() => render(lists));
  }
  function recordTable(p, month) {
    rememberList(() => recordTable(p, month));
    return withRecords([p], ([list]) => {
    const items = list.filter(r => inCategory(r) && (month === undefined || r.month === month)).sort(byRecordOrder);
    showDialog(`Registros de ${first(p)}`, `<p class="records-note">${month === undefined ? span() : `${monthNames[month]} ${state.year}`} • ${state.category === 'Todas' ? 'Todas as categorias' : `${escape(label(state.category))} (Nome na fonte: ${escape(state.category)})`} • ${items.length} registros oficiais.</p><div class="calculation-result">${money(sum(items))}<small>Soma exata dos registros abaixo</small></div><div class="action-row"><button class="outline-button" data-action="download" data-id="${p.id}" ${month === undefined ? '' : `data-month="${month}"`}>Baixar CSV</button>${dialogTrail.length ? '' : `<button class="outline-button" data-action="evidence" data-id="${p.id}" data-kind="gastos">Voltar ao cálculo</button>`}</div>${recordListHTML(`Registros de ${escape(p.name)}`, items.map(r => recordRow(p, r)), sum(items))}${sourceNote()}`);
    $('#detail').classList.add('records-wide');
    });
  }
  function recordDetail(p, id) {
    return withRecords([p], ([list]) => {
    const rec = list.find(x => x.id === id); if (!rec) { showDialog('Registros oficiais', '<p class="records-note" role="alert">Registro não encontrado nesta versão. Nenhum valor foi estimado.</p>'); return; }
    const r = rec.raw, api = r.origin === 'api';
    showDialog('O registro por trás do valor', `<p class="records-note">${escape(p.name)} · ${months[r.month - 1]} / ${escape(r.year)}</p><h3>${escape(r.supplierLabel ?? r.supplier)}</h3>${r.supplierLabel ? `<p class="context">Nome na fonte: ${escape(r.supplier)}</p>` : ''}<p>${escape(label(r.category))}</p><p class="context">Nome na fonte: ${escape(r.category)}</p>${r.origin ? `<p class="context">Fonte: ${originLabel(r)}</p>` : ''}${r.duplicateFlag ? '<p class="context" data-duplicate="possible">Possível duplicidade: a fonte traz outro lançamento com o mesmo documento e valor. Somamos todos, como a Câmara.</p>' : ''}${r.documentCents !== null && r.disallowedCents !== null && r.documentCents - r.disallowedCents === r.cents ? `<div class="formula"><span>Documento <b>${money(r.documentCents)}</b></span><span>− Glosa <b>${money(r.disallowedCents)}</b></span><span>= Líquido <b>${money(r.cents)}</b></span></div>` : `<div class="formula" data-equation="none"><span>Valor do documento <b>${money(r.documentCents)}</b></span><span>Glosa <b>${money(r.disallowedCents)}</b></span><span>Valor líquido <b>${money(r.cents)}</b></span></div>${r.sourceCents !== undefined ? '' : `<p class="context">${r.documentCents !== null && r.disallowedCents !== null ? 'Na fonte, documento − glosa não fecha com o líquido.' : 'A fonte não informa todos os campos da conta documento − glosa.'} O valor líquido é o publicado pela Câmara, sem recálculo.${r.cents < 0 ? ' Valor negativo: ajuste registrado na origem.' : ''}</p>`}`}${r.sourceCents !== undefined ? `<p class="context">Sinal corrigido conforme a página da Câmara (valor na fonte: ${money(r.sourceCents)})</p>` : ''}<p>${docLabel(r)} · número ${escape(r.documentNumber)}<br>${noDocument(r) ? '<span class="context">Cobrança interna de telefonia da Câmara. O "0" é o identificador de documento publicado na fonte, não um valor: o valor do lançamento é o líquido acima.</span><br>' : ''}Emissão informada: ${day(r.date)}</p><div class="action-row">${safeUrl(r.source.url) ? `<a class="outline-button primary" href="${escape(r.source.url)}" target="_blank" rel="noopener noreferrer">${api ? 'Abrir consulta oficial da API' : 'Baixar arquivo oficial'} ↗︎</a>` : ''}${safeUrl(r.receipt) ? `<a class="outline-button" href="${escape(r.receipt)}" target="_blank" rel="noopener noreferrer">Comprovante informado ↗︎</a>` : `<span class="context">${r.supplier === 'Nome não exibido pelo Clareia' || r.supplier === 'Fornecedor pessoa física' ? 'Comprovante não exibido pelo Clareia.' : 'Comprovante não informado na fonte.'}</span>`}</div><p class="context">O link do comprovante foi informado pela Câmara; sua disponibilidade e autenticidade não foram auditadas pelo Clareia.</p><details><summary>Rastreabilidade deste item</summary><dl class="trace"><dt>Coleta</dt><dd>${date(r.source.fetchedAt)} (Brasília)</dd><dt>${api ? 'Posição na página da API (base zero)' : 'Posição no CSV, sem cabeçalho (base zero)'}</dt><dd>${escape(r.source.row)}</dd>${r.source.sha256 ? `<dt>${api ? 'SHA-256 da página preservada' : 'SHA-256 do CSV preservado'}</dt><dd><code>${escape(r.source.sha256)}</code></dd>` : ''}<dt>ID desta ocorrência</dt><dd><code>${escape(r.id)}</code></dd></dl></details><button class="text-button" data-action="back-to-list" data-id="${p.id}" data-record="${escape(id)}">← Voltar aos registros</button>`);
    });
  }
  function socialLinks(p) {
    const links = p.social.filter(l => safeUrl(l.url));
    return links.length ? `<div class="social-links">${links.map(l => `<a href="${escape(l.url)}" data-network="${escape(l.network.toLowerCase())}" target="_blank" rel="noopener noreferrer" aria-label="${escape(l.network)} de ${escape(p.name)}" title="${escape(l.network)}">${icon(l.network)}</a>`).join('')}<small class="context">Redes informadas pelo(a) deputado(a) à Câmara</small></div>` : '';
  }
  function provisionalSection() {
    if (!D.provisional?.length) return '';
    return `<section class="detail-section provisional-section"><h3>Meses provisórios</h3><ul class="provisional-list">${D.provisional.map(i => `<li><strong>${months[i]}</strong>: provisório</li>`).join('')}</ul><p class="context">${escape(D.provisionalNote)}.</p></section>`;
  }
  function profile(id) {
    const p = person(id), peer = comparable(p) ? byTotal().find(other => other.id !== id) : null;
    const route = { url: withYear(deputyPath(p)), title: `${p.name} — Clareia` };
    showDialog('Perfil do representante', `<div class="profile-head">${avatar(p)}<div><h3>${escape(p.name)}</h3><p class="context">Deputado(a) federal • ${escape(context(p))} • ID Câmara ${escape(p.officialId)}</p>${p.party ? `<p class="context">${p.partyNote ? 'Partido sem confirmação mês a mês, dos eventos da legislatura (ver nota); UF' : window.ClareiaData.coverageApproved ? 'Partido por competência, conforme a cobertura aprovada; UF' : 'Partido atual e UF'} conforme o cadastro da Câmara consultado em ${date(p.profileFetchedAt)}.</p>` : ''}<p class="context">${D.coverage.length} meses publicados nesta versão (${span()})</p><p class="context cutoff">${cutoff()}</p>${socialLinks(p)}</div></div><div class="profile-stats"><button class="profile-stat" data-action="evidence" data-id="${id}" data-kind="gastos"><span>${state.metric === 'mensal' ? 'Despesa média / mês' : 'Despesas no recorte'}</span><strong>${p.noExercise ? `Sem exercício confirmado em ${state.year}` : p.heldMonths?.length && !p.cells.length ? 'Em revisão' : `${money(value(p, 'gastos'))} ↗︎`}</strong>${(!p.noExercise || p.exerciseReviewMonths?.length) && exclusionNote(p) ? `<small class="held-note">${escape(exclusionNote(p))}</small>` : ''}</button><button class="profile-stat" data-action="evidence" data-id="${id}" data-kind="projetos"><span>Projetos apresentados</span><strong>${p.projects === null ? pending : number(p.projects)}</strong></button></div>${p.noExercise || p.heldMonths?.length && !p.cells.length ? '' : categoryBreakdown(p)}${provisionalSection()}${peer ? `<div class="editorial-follow-up"><span>Continue investigando</span><button data-p-ask="${escape(`Compare ${p.name} e ${peer.name}`)}">Como ${escape(first(p))} se compara a ${escape(first(peer))}? →</button></div>` : ''}<div class="action-row">${peer ? `<button class="outline-button primary" data-action="profile-compare" data-id="${id}">Comparar com ${escape(first(peer))}</button>` : ''}<button class="outline-button" data-action="records" data-id="${id}">Abrir registros</button><button class="share-button" data-action="copy-link" data-id="${id}">Compartilhar</button>${D.shareImages ? `<button class="outline-button" data-action="share-image" data-id="${id}">Baixar imagem</button>` : ''}${safeUrl(p.sourceUrl) ? `<a class="outline-button" href="${escape(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">Cadastro na Câmara ↗︎</a>` : ''}</div>${sourceNote()}`, true, route);
  }
  function methodologyBody() {
    const v = index.validation, audit = index.audit, P = window.ClareiaPages;
    const auditLine = audit ? ` Releitura independente do arquivo anual: <b>${audit.status === 'passed' ? 'sem divergências' : 'divergência encontrada'}</b> (${number(audit.selected)} linhas, ${audit.groupsCompared !== undefined ? `${number(audit.groupsCompared)} grupos pessoa/mês/categoria` : `${number(audit.competences)} competências deputado/mês`}, ${date(audit.checkedAt)}).` : '';
    return `${P.pages.metodologia.somamos(union())}${P.pages.metodologia.conferimos(auditLine)}${P.pages.metodologia.senado}${window.ClareiaData.billsApproved ? `<h3>Projetos aprovados</h3><p>Contamos PL, PLP e PEC apresentados em ${billsPeriod()} em que o deputado aparece como proponente na lista de autores da Câmara e cuja norma (lei ordinária, lei complementar ou emenda constitucional) foi identificada no despacho oficial. Coautoria não conta. Projetos com a situação 'Transformado em Norma Jurídica' sem norma identificável, ou retidos para revisão, ficam fora, e por isso a contagem pode ficar abaixo do total real. Deputados sem proposições coletadas não entram no ranking.</p>` : ''}${ceilingMethod()}${P.pages.metodologia.anos(D.years, D.defaultYear)}${P.pages.metodologia.naoConcluimos}<h3>Limites desta versão</h3><ul>${v.limitations.map(l => `<li>${escape(l)}</li>`).join('')}</ul>${P.pages.metodologia.privacidade}<h3>Versão</h3><dl class="trace"><dt>Identificador</dt><dd><code class="hash" tabindex="0" title="${escape(index.snapshotId)}">${escape(index.snapshotId)}</code></dd><dt>Métrica</dt><dd><code>${escape(index.metric)}</code></dd><dt>Coleta</dt><dd>${date(index.collectedAt)} (Brasília)</dd><dt>Publicação</dt><dd>${date(index.publishedAt)} (Brasília)</dd></dl><p><a href="https://dadosabertos.camara.leg.br/howtouse/2023-12-26-dados-ceap.html" target="_blank" rel="noopener noreferrer">Dicionário oficial da CEAP ↗︎</a> · <a href="https://dadosabertos.camara.leg.br/swagger/api.html" target="_blank" rel="noopener noreferrer">Documentação da API ↗︎</a></p>`;
  }
  function auditTiles() {
    const a = index.audit;
    if (!a) return '';
    const unit = a.groupsCompared !== undefined ? ['grupos pessoa/mês/categoria', a.groupsCompared] : ['competências deputado/mês', a.competences];
    return `<div class="doc-stats"><div class="p-panel doc-stat"><strong>${number(a.selected)}</strong><span>linhas conferidas na releitura independente</span></div><div class="p-panel doc-stat"><strong>${number(unit[1])}</strong><span>${unit[0]}</span></div><div class="p-panel doc-stat"><strong>${a.status === 'passed' ? '0' : '!'}</strong><span>${a.status === 'passed' ? 'divergências' : 'divergência encontrada'}</span></div></div>`;
  }
  function methodology() {
    showDialog('Fontes e metodologia', `<div class="text-content"><p class="records-note"><a href="/metodologia">Abrir a página Metodologia →</a></p>${methodologyBody()}</div>`);
  }
  async function renderPage(name) {
    const P = window.ClareiaPages;
    document.body.dataset.model = model;
    $('#app').innerHTML = `<div class="site">${header()}<main id="main" class="text-page"><p class="p-small">Carregando…</p></main><footer class="footer"></footer></div>`;
    const main = $('#main');
    document.title = P.pages[name].title;
    if (name === 'sobre') main.innerHTML = P.pages.sobre.body();
    else if (name === 'apoie') { main.innerHTML = P.pages.apoie.body(); P.spy(); }
    else if (name === 'dados-abertos') {
      let manifest = null;
      try { const r = await fetch(`${base}/dados-abertos.json`); if (r.ok) manifest = await r.json(); } catch {}
      main.innerHTML = P.pages['dados-abertos'].body(manifest, base, { folderId: D.sharedBase.split('/').pop(), year: D.year, partialLabel: D.partialLabel, others: D.years.filter(y => String(y.year) !== D.year).map(y => ({ year: String(y.year), partial: y.partial})) });
      P.spy();
    }
    else if (name === 'metodologia') { const s = P.sections(`${auditTiles()}${methodologyBody()}`); main.innerHTML = P.layout('metodologia', 'Metodologia', 'Metodologia', 'Como somamos as despesas, o que conferimos e o que ainda não concluímos.', s.html, s.toc); P.spy(); }
    else {
      let list = [];
      try { const r = await fetch('/corrections.json'); if (!r.ok) throw new Error(); list = await r.json(); }
      catch { main.innerHTML = P.layout('correcoes', 'Correções', 'Correções', 'Como pedir a correção de um dado e o registro público do que foi corrigido.', '<p>Não foi possível carregar o registro de correções. Nenhum valor foi alterado.</p>'); return; }
      main.innerHTML = P.pages.correcoes.body(list, P.CONTACT_EMAIL);
    }
    P.reveal();
  }
  function toast(text) { const el = $('#toast'); el.textContent = text; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800); }
  const publicationId = () => D.sharedBase.split('/').pop();
  async function shareLink() {
    syncURL();
    const shared = new URL(location.href); shared.searchParams.set('v', publicationId());
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(shared.href); toast('Link com a investigação e os filtros copiado.'); }
    catch { showDialog('Compartilhar investigação', `<div class="manual-share"><p>Copie este link. Os filtros e a pergunta serão preservados.</p><label for="share-link">Link da consulta</label><input id="share-link" readonly value="${escape(shared.href)}"></div>`); $('#share-link').select(); }
  }
  function closeSuggestions() { const list = $('#suggestions'); if (!list) return; list.hidden = true; $('#query')?.setAttribute('aria-expanded', 'false'); }
  function exportCSV(id, month) {
    const p = person(id), whole = month === undefined && state.category === 'Todas';
    const save = (href, n) => { const a = document.createElement('a'); a.href = href; a.download = `clareia-${index.snapshotId.slice(0, 12)}-${p.officialId}${month === undefined ? '' : '-' + (month + 1)}.csv`; a.click(); toast(`CSV com ${n} registros oficiais preparado.`); };
    if (whole) { save(`${base}/deputados/${p.officialId}/despesas.csv`, count(p.cells)); return; }
    const keep = r => inCategory(r) && (month === undefined || month === r.month);
    loadRecords(p).then(list => { const items = list.filter(keep), href = URL.createObjectURL(new Blob([ClareiaView.csv(items.map(r => r.raw))], { type: 'text/csv;charset=utf-8' })); save(href, items.length); setTimeout(() => URL.revokeObjectURL(href), 1000); }, () => toast('Registros indisponíveis agora. Nenhum valor foi estimado.'));
  }
  // Resolves once the browser has gone back to the page entry, so callers that change the URL next do not write to the profile's entry.
  function closeDialog() {
    const dialog = $('#detail');
    if (!dialog.open) return Promise.resolve();
    const unwinding = session?.live && session.base === 'beneath';
    const settled = unwinding ? new Promise(resolve => { window.addEventListener('popstate', resolve, { once: true }); setTimeout(resolve, 500); }) : Promise.resolve();
    dialog.close();
    if (dialogTrigger?.isConnected) dialogTrigger.focus({ preventScroll: true });
    return settled;
  }
  async function downloadShareImage(id) {
    try {
      const names = await (await fetch(`${base}/share/index.json`)).json(), name = names[person(id).officialId];
      if (!name) throw new Error('No image');
      const a = document.createElement('a'); a.href = `${base}/share/${name}-square.jpg`; a.download = `clareia-${person(id).officialId}.jpg`; a.click();
      toast('Imagem para compartilhar preparada.');
    } catch { toast('Imagem indisponível agora.'); }
  }
  async function copyProfileLink(id, button) {
    const p = person(id), link = new URL(location.origin + withYear(deputyPath(p))), url = (link.searchParams.set('v', publicationId()), link.href);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: `${p.name} — Clareia`, text: `Despesas e atividade de ${p.name} na Câmara, com dados oficiais.`, url }); return; } catch (error) { if (error?.name === 'AbortError') return; } }
    const copied = () => { toast('Link do perfil copiado.'); const text = button.textContent; button.textContent = 'Link copiado'; setTimeout(() => { if (button.isConnected) button.textContent = text; }, 2000); };
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(url); copied(); return; } catch { /* falls back to a selectable field */ }
    let box = $('#profile-link-box');
    if (!box) { box = document.createElement('div'); box.id = 'profile-link-box'; box.className = 'manual-share'; box.innerHTML = `<label for="profile-link">Copie o link do perfil</label><input id="profile-link" readonly value="${escape(url)}">`; button.closest('.action-row').after(box); }
    const field = $('#profile-link'); field.focus(); field.select();
    try { if (document.execCommand('copy')) copied(); } catch { /* the selected field is the fallback */ }
  }
  async function copyPixKey(button) {
    const key = $('#pix-key'), label = button.textContent;
    const done = () => { button.textContent = 'Chave copiada'; setTimeout(() => { if (button.isConnected) button.textContent = label; }, 2000); };
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(key.textContent); done(); return; } catch { /* the selected text is the fallback */ }
    const range = document.createRange(); range.selectNodeContents(key);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }
  document.addEventListener('keydown', event => {
    const tab = event.target.closest?.('[role="tab"][data-tab]');
    if (!tab) return;
    const all = [...tab.parentElement.querySelectorAll('[role="tab"][data-tab]')], i = all.indexOf(tab);
    const to = { ArrowRight: (i + 1) % all.length, ArrowLeft: (i - 1 + all.length) % all.length, Home: 0, End: all.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    all[to].click();
    document.querySelector(`[role="tab"][data-tab="${all[to].dataset.tab}"]`)?.focus();
  });
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action],[data-house],[data-tab],[data-metric],[data-question],[data-year]');
    if (!event.target.closest('.search-wrap')) closeSuggestions();
    if (!target) return;
    if (target.tagName === 'A' && target.dataset.action === 'senator-profile') {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
    }
    if (target.tagName === 'A' && !target.href) event.preventDefault();
    if (target.dataset.house) {
      const next = target.dataset.house === 'senado' && D.senators ? 'senado' : 'camara';
      if (next !== state.house) {
        state.house = next;
        state.barLimit = BAR_STEP;
        if (next === 'senado') {
          askRun++;
          if (state.answer?.type === 'loading') state.answer = null;
          if (state.tab === 'projetos') state.tab = 'gastos';
          ensureSenatorsLoaded();
        }
        refresh();
      }
      return;
    }
    if (target.dataset.tab) { state.tab = target.dataset.tab; state.barLimit = BAR_STEP; refresh(); return; }
    if (target.dataset.metric) { state.metric = target.dataset.metric; refresh(); return; }
    if (target.dataset.question) { ask(target.dataset.question); return; }
    if (target.dataset.year) { switchYear(target.dataset.year); return; }
    const id = target.dataset.id, action = target.dataset.action;
    if (action === 'close') closeDialog();
    else if (action === 'feature') feature(id);
    else if (action === 'evidence') openView(() => evidence(id, { kind: target.dataset.kind }));
    else if (action === 'dialog-back') goBack();
    else if (action === 'answer-evidence' && state.answer?.ids?.length) evidence(state.answer.ids[0], { kind: state.answer.kind, compare: state.answer.type === 'compare' ? state.answer.ids[1] : null });
    else if (action === 'bars-more' || action === 'bars-less') { const before = state.barLimit; state.barLimit = action === 'bars-more' ? before + BAR_STEP : BAR_STEP; $('#comparison').outerHTML = barSection(); (action === 'bars-more' ? document.querySelectorAll('#bar-chart .bar-row')[before] : document.querySelector('[data-action=bars-more]'))?.focus({ preventScroll: action === 'bars-more' }); }
    else if (action === 'csv-ranking') downloadRankingCsv('ranking');
    else if (action === 'csv-state') downloadRankingCsv('state', target.dataset.uf);
    else if (action === 'records') openView(() => recordTable(person(id)));
    else if (action === 'back-to-list' && session?.live && session.d > 0 && dialogTrail.length) { afterRestore = () => [...document.querySelectorAll('#detail .record-row')].find(tr => tr.dataset.record === target.dataset.record)?.querySelector('button')?.focus(); history.back(); }
    else if (action === 'back-to-list') { const previous = dialogTrail.pop(); if (previous) dialogView = previous; navigating = Boolean(previous); try { backToList(id, target.dataset.record); } finally { navigating = false; } }
    else if (action === 'record') openView(() => recordDetail(person(id), target.dataset.record));
    else if (action === 'month') openView(() => recordTable(person(id), Number(target.dataset.month)));
    else if (action === 'profile') D.loadSuppliers().then(() => openView(() => profile(id)), () => {});
    else if (action === 'senator-profile') {
      const s = senatorState.data?.senators.find(x => String(x.senatorId) === String(target.dataset.senatorId) && senatorNamed(x));
      if (s) openView(() => senatorProfile(s, senatorState.data));
    }
    else if (action === 'copy-senator-link') copySenatorLink(target.dataset.senatorId, target);
    else if (action === 'methodology') methodology();
    else if (action === 'focus-search') { if (state.house === 'senado') return; $('#query')?.focus(); $('#query')?.scrollIntoView({ block: 'center' }); }
    else if (action === 'profile-compare') { const peer = byTotal().find(o => o.id !== id); closeDialog().then(() => ask(`Compare ${person(id).name} e ${peer.name}`)); }
    else if (action === 'share') shareLink();
    else if (action === 'copy-link') copyProfileLink(id, target);
    else if (action === 'copy-pix') copyPixKey(target);
    else if (action === 'share-image') downloadShareImage(id);
    else if (action === 'reset') { document.dispatchEvent(new CustomEvent('clareia:reset')); state.uf = 'Brasil'; state.category = 'Todas'; state.metric = 'total'; state.tab = 'gastos'; state.query = ''; state.answer = null; $('#query').value = ''; $('#answer-slot').innerHTML = ''; refresh(); $('#query').focus({ preventScroll: true }); closeSuggestions(); toast(`Filtros limpos: Brasil, todas as categorias, valor total.`); }
    else if (action === 'download') exportCSV(id, target.hasAttribute('data-month') ? Number(target.dataset.month) : undefined);
  });
  const carryYear = event => {
    const a = event.target.closest?.('a[href^="/"]');
    if (!a || D.year === D.defaultYear || a.target === '_blank') return;
    const url = new URL(a.href);
    if (!url.searchParams.has('ano') && ['/', '/sobre', '/correcoes', '/metodologia', '/dados-abertos', '/apoie', '/api'].includes(url.pathname)) { url.searchParams.set('ano', D.year); a.href = url.pathname + url.search + url.hash; }
  };
  document.addEventListener('click', carryYear, true);
  document.addEventListener('auxclick', carryYear, true);
  document.addEventListener('change', event => { if (event.target.matches?.('[data-year-select]')) switchYear(event.target.value); });
  document.addEventListener('submit', event => { if (event.target.id === 'search-form') { event.preventDefault(); ask($('#query').value); } });
  document.addEventListener('focusin', event => { if (event.target.id === 'query') { $('#suggestions').hidden = false; $('#query').setAttribute('aria-expanded', 'true'); } });
  document.addEventListener('focusout', () => { setTimeout(() => { if (!document.activeElement.closest('.search-wrap')) closeSuggestions(); }, 0); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSuggestions();
    if (event.target.matches('.chart-point') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    if (event.target.id === 'query' && event.key === 'ArrowDown') { event.preventDefault(); $('#suggestions button')?.focus(); }
  });
  $('#detail').addEventListener('click', event => { if (event.target === $('#detail')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right) closeDialog(); } });
  $('#detail').addEventListener('close', () => {
    senatorRouteRun++;
    dialogTrail = []; dialogView = null;
    if (session?.live) {
      session.live = false;
      if (session.base === 'beneath') history.go(-(session.d + 1)); else writeHistory('replaceState', null, '/' + homeQuery());
    }
    document.title = pageTitle.value;
    const a = document.activeElement; if (dialogTrigger?.isConnected && (!a || a === document.body || $('#detail').contains(a))) dialogTrigger.focus({ preventScroll: true }); });
  layout();
  if (state.house === 'senado') ensureSenatorsLoaded();
  markTab(false);
  scopeChip();
  document.fonts?.ready.then(() => markTab(false));
  window.Clareia = { yearSelector, yearQuery, parseRoute, openRoute, deputyPath, senatorPath, pageTitle, setPath, exclusionNote, fewMonths, MIN_MONTHS, listMore, logo, label, context, model, state, all, person, comparable, partialNote, ranking, cells, count, loadRecords, withRecords, sum, money, compact, number, share, shareBase, escape, photo, avatar, icon, ask, evidence, profile, recordTable, recordRow, recordListHTML, byRecordOrder, recordDetail, rememberList, showDialog, closeDialog, methodology, renderPage, toast, refresh, scopeChip, sourceBlock, span, pending, approvedText, billsPeriod, byTotal, compareValues };
  window.addEventListener('resize', () => markTab(false));
  if (state.query && state.house === 'camara') ask(state.query, false, fromURL);
})();
