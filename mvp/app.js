(() => {
  'use strict';
  const { dataset, categories, monthNames } = window.ClareiaData;
  const models = { investigacao: 'Investigação', explorador: 'Explorador', editorial: 'Editorial' };
  const initial = new URLSearchParams(location.search);
  const model = Object.hasOwn(models, initial.get('modelo')) ? initial.get('modelo') : 'investigacao';
  const state = {
    year: ['2024', '2025'].includes(initial.get('ano')) ? initial.get('ano') : '2025',
    uf: ['SP', 'MG', 'RJ'].includes(initial.get('uf')) ? initial.get('uf') : 'Brasil',
    category: categories.includes(initial.get('categoria')) ? initial.get('categoria') : 'Todas',
    metric: initial.get('metrica') === 'mensal' ? 'mensal' : 'total',
    tab: ['menos', 'projetos', 'votacoes'].includes(initial.get('aba')) ? initial.get('aba') : 'gastos',
    query: initial.get('q') || '', featured: 'ana', answer: null, hiddenSeries: new Set(), popover: null
  };
  if (model !== 'explorador' && state.tab === 'votacoes') state.tab = 'gastos';
  let currentEvidence = null, dialogTrigger = null, toastTimer;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const norm = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const money = value => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: value % 1 ? 2 : 0 });
  const compact = value => value >= 1000 ? `R$ ${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : money(value);
  const number = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const sum = records => records.reduce((total, record) => total + record.amount, 0);
  const all = () => dataset(model, state.year);
  const person = id => all().find(p => p.id === id);
  const records = p => p.records.filter(r => state.category === 'Todas' || r.category === state.category);
  const isCount = () => ['projetos', 'votacoes'].includes(state.tab);
  function value(p, kind = state.tab) {
    let result = kind === 'projetos' ? p.projects : kind === 'votacoes' ? p.votes : sum(records(p));
    return state.metric === 'mensal' ? result / p.months : result;
  }
  const formatted = (p, kind = state.tab) => ['projetos', 'votacoes'].includes(kind) ? number(value(p, kind)) : compact(value(p, kind));
  function ranking() {
    return all().filter(p => (state.uf === 'Brasil' || p.uf === state.uf) && (state.tab !== 'menos' || p.months >= 6))
      .sort((a, b) => (state.tab === 'menos' ? value(a) - value(b) : value(b) - value(a)) || a.name.localeCompare(b.name, 'pt-BR'));
  }
  const icon = name => {
    const paths = {
      search: '<circle cx="10.5" cy="10.5" r="6.8"/><path d="m16 16 5 5"/>',
      arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
      external: '<path d="M8 5h11v11M19 5 5 19"/>',
      share: '<path d="M12 16V3m-4 4 4-4 4 4M7 10H4v11h16V10h-3"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
      table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
      database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v13c0 4 16 4 16 0V5M4 11c0 4 16 4 16 0"/>'
    };
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
  };
  // SVG viewports display isolated portrait assets, or crops of the original green concept.
  // No screenshot is used as a page background.
  function photo(p, kind = 'portrait') {
    let source = 'assets/portraits-editorial.png', imageWidth = 1774, imageHeight = 887;
    let rect;
    if (kind === 'hero') rect = { ana: [0, 65, 595, 822], bruno: [608, 65, 565, 822], carla: [1183, 65, 591, 822] }[p.id] || [0, 65, 595, 822];
    else if (model === 'investigacao') {
      source = 'assets/investigation.png';
      imageWidth = 1536; imageHeight = 1024;
      rect = { ana: [65, 665, 158, 163], bruno: [418, 662, 168, 165], carla: [771, 661, 156, 166], diego: [418, 662, 168, 165], fernanda: [771, 661, 156, 166] }[p.id];
      if (kind === 'avatar') rect = [rect[0] + 20, rect[1] + 29, rect[2] - 35, rect[3] - 29];
    } else {
      rect = { ana: [0, 65, 595, 822], bruno: [608, 65, 565, 822], carla: [1183, 65, 591, 822] }[p.id];
      if (kind === 'avatar' && rect) rect = [rect[0] + 75, 105, rect[2] - 150, 440];
    }
    if (['diego', 'fernanda'].includes(p.id)) return `<span class="initials" aria-label="${escape(p.name)} — sem retrato">${p.name.split(' ').map(w => w[0]).join('')}</span>`;
    return `<span class="photo"><svg viewBox="${rect.join(' ')}" preserveAspectRatio="xMidYMin slice" role="img" aria-label="Retrato fictício de ${escape(p.name)}"><image href="${source}" width="${imageWidth}" height="${imageHeight}"/></svg></span>`;
  }
  const avatar = p => `<span class="avatar">${photo(p, 'avatar')}</span>`;
  function modelURL(next) { const url = new URL(location.href); url.search = ''; url.searchParams.set('modelo', next); return url.href; }
  function syncURL() {
    const url = new URL(location.href);
    url.search = '';
    Object.entries({ modelo: model, ano: state.year, uf: state.uf, categoria: state.category, metrica: state.metric, aba: state.tab, q: state.query }).forEach(([key, val]) => { if (val) url.searchParams.set(key, val); });
    try { history.replaceState(null, '', url); } catch { /* file previews may restrict history */ }
  }
  function searchForm(compactHeader = false) {
    const placeholder = model === 'editorial' ? 'O que você quer investigar?' : 'Investigue um nome ou uma pergunta';
    const shown = state.query || (model === 'investigacao' ? 'Ana gastou mais que Bruno em 2025?' : '');
    return `<div class="search-wrap"><form class="search-form" id="search-form" role="search" autocomplete="off">
      ${model === 'editorial' ? '' : icon('search')}<label class="sr-only" for="query">Pergunte sobre os dados fictícios</label>
      <input id="query" name="q" value="${escape(shown)}" placeholder="${placeholder}" maxlength="300" aria-controls="suggestions" aria-expanded="false">
      <button class="search-submit" type="submit" aria-label="Investigar pergunta">${model === 'investigacao' && !compactHeader ? 'Investigar' : ''}${icon('arrow')}</button>
      </form><div id="suggestions" class="suggestions" hidden><p>Experimente na amostra fictícia</p>${['Ana gastou mais que Bruno em 2025?', 'Quem mais gastou por mês?', 'Quem de MG gastou mais com passagens?', 'Quem apresentou mais projetos?'].map(q => `<button type="button" data-question="${escape(q)}">${escape(q)} ${icon('external')}</button>`).join('')}</div></div>`;
  }
  function header() {
    const nav = model === 'editorial' ? '<a href="#rankings">Pessoas</a><a href="#comparison">Gastos</a><a href="#" data-action="votes">Votações</a>' : '<a href="#rankings">Explorar</a><a href="#" data-action="compare">Comparar</a><a href="#" data-action="methodology">Metodologia</a>';
    return `<header class="site-header"><a class="logo" href="${modelURL(model)}" aria-label="Clareia, início">clareia<svg class="brand-rays" viewBox="0 0 25 30" aria-hidden="true"><path d="M5 8 8 3M10 13l8-3M11 19l9 2M6 23l4 5"/></svg></a>
      ${model === 'explorador' ? searchForm(true) : model === 'editorial' ? '' : `<nav class="nav" aria-label="Navegação principal">${nav}</nav>`}
      ${model === 'editorial' ? `<button class="header-search" data-action="focus-search" aria-label="Ir para a busca">${icon('search')}</button>` : `<span class="demo-badge">${model === 'explorador' ? 'Dados fictícios' : 'Conceito • dados fictícios'}</span>`}</header>`;
  }
  function select(key, label, options) {
    return `<label class="select-label"><span class="sr-only">${label}</span><select data-filter="${key}" aria-label="${label}">${options.map(([val, name]) => `<option value="${escape(val)}" ${state[key] === val ? 'selected' : ''}>${name}</option>`).join('')}</select></label>`;
  }
  const yearSelect = () => select('year', 'Ano', [['2025', '2025'], ['2024', '2024']]);
  const ufSelect = () => select('uf', 'Estado', [['Brasil', 'Brasil'], ['SP', 'São Paulo'], ['MG', 'Minas Gerais'], ['RJ', 'Rio de Janeiro']]);
  const categorySelect = () => select('category', 'Categoria de despesa', [['Todas', 'Todas as despesas'], ...categories.map(c => [c, c])]);
  function metricToggle(short = false) {
    return `<div class="metric-toggle" role="group" aria-label="Forma de comparar"><button data-metric="total" aria-pressed="${state.metric === 'total'}">${short ? 'Total' : 'Total gasto'}</button><button data-metric="mensal" aria-pressed="${state.metric === 'mensal'}">${short ? 'Por mês' : 'Por mês em exercício'}</button></div>`;
  }
  function tabs() {
    const options = model === 'explorador' ? [['gastos', 'Gastos'], ['projetos', 'Projetos'], ['votacoes', 'Votações']] : model === 'editorial' ? [['gastos', 'Mais gastos'], ['menos', 'Menos gastos'], ['projetos', 'Projetos']] : [['gastos', 'Quem mais gastou'], ['menos', 'Quem menos gastou'], ['projetos', 'Projetos apresentados']];
    return `<div class="tabs" role="group" aria-label="Indicador do ranking">${options.map(([key, label]) => `<button data-tab="${key}" aria-pressed="${state.tab === key || (model === 'explorador' && key === 'gastos' && state.tab === 'menos')}">${label}</button>`).join('')}</div>`;
  }
  function caption(p) {
    const months = state.metric === 'mensal' && model === 'editorial' ? ` · ${p.months} ${p.months === 1 ? 'mês' : 'meses'} em exercício` : '';
    return baseCaption(p) + months;
  }
  function baseCaption(p) {
    if (state.tab === 'projetos') return `Projetos apresentados em ${state.year}${state.metric === 'mensal' ? ' / mês' : ''}`;
    if (state.tab === 'votacoes') return `Participações nominais em ${state.year}${state.metric === 'mensal' ? ' / mês' : ''}`;
    return `${state.metric === 'mensal' ? 'Média mensal' : 'Cota parlamentar'} · ${state.year}`;
  }
  function cards() {
    const ranked = ranking(), top = ranked.slice(0, 3), max = Math.max(1, ...ranked.map(p => value(p)));
    if (!top.length) return '<div class="empty-state"><b>Nenhum perfil neste recorte.</b><p>Experimente outra seleção de estado.</p><button class="outline-button" data-action="reset">Limpar filtros</button></div>';
    return top.map((p, i) => `<article class="rank-card ${model === 'investigacao' ? 'inv-card' : model === 'editorial' ? 'editorial-card' : 'explorer-card'}" data-person="${p.id}">
      <button class="portrait-button" data-action="profile" data-id="${p.id}" aria-label="Abrir perfil fictício de ${p.name}">${photo(p)}<span class="rank-number">${model === 'editorial' ? '0' : model === 'investigacao' ? '#' : ''}${i + 1}</span></button>
      <div class="card-info"><h3 class="person-name">${p.name}</h3><button class="value-button" data-action="evidence" data-id="${p.id}" aria-label="${p.name}: ${formatted(p)}. Como chegamos nisso?">${formatted(p)}</button>
      ${model === 'investigacao' ? `<span class="track"><i style="width:${value(p) / max * 100}%"></i></span><button class="text-button" data-action="evidence" data-id="${p.id}">Ver composição ↗</button>` : `<p class="card-caption">${caption(p)}</p>`}</div></article>`).join('');
  }
  function rankNote() {
    return state.tab === 'projetos' ? 'Projetos apresentados não equivalem a leis aprovadas.' : state.tab === 'votacoes' ? 'Contagem de participações. Não é uma nota de desempenho.' : state.tab === 'menos' ? 'Menores gastos: apenas perfis com ao menos 6 meses em exercício.' : 'Cota parlamentar é a verba mensal que reembolsa despesas do mandato, como passagens e divulgação. Gasto maior não significa irregularidade.';
  }
  function barSection() {
    const ranked = ranking(), max = Math.max(1, ...ranked.map(p => value(p)));
    const title = state.tab === 'projetos' ? `Projetos apresentados em ${state.year}` : state.tab === 'votacoes' ? `Participações em votações · ${state.year}` : model === 'editorial' ? `Comparativo de gastos em ${state.year}` : `${state.metric === 'mensal' ? 'Média mensal' : 'Total de gastos'} por parlamentar`;
    return `<section class="bar-section" id="comparison"><h2>${title}</h2><div class="bar-chart" id="bar-chart">${ranked.map((p, i) => `<button class="bar-row" data-action="${model === 'explorador' ? 'popover' : 'evidence'}" data-id="${p.id}" aria-label="${p.name}, ${formatted(p)}: ver cálculo" style="--opacity:${Math.max(.25, 1 - i * .18)}">${avatar(p)}<span class="bar-name">${p.name}</span><span class="track"><i style="width:${value(p) / max * 100}%"></i></span><span class="bar-value">${formatted(p)}</span></button>`).join('')}</div></section>`;
  }
  function rankingSection() {
    if (model === 'investigacao') return `<section class="rank-section" id="rankings" aria-labelledby="rank-title"><h2 id="rank-title" class="section-heading">Mude o recorte. Descubra o contexto.</h2>${tabs()}<div class="filters"><div class="selects">${yearSelect()}${ufSelect()}${categorySelect()}</div>${metricToggle()}</div><div class="cards">${cards()}</div><p class="rank-note">${icon('info')}${rankNote()}</p></section>`;
    if (model === 'editorial') return `<section class="editorial-rank" id="rankings" aria-labelledby="editorial-rank-title"><h2 id="editorial-rank-title" class="sr-only">Rankings de parlamentares</h2>${tabs()}<div class="editorial-controls"><div class="selects">${yearSelect()}${ufSelect()}</div>${metricToggle(true)}</div><div class="cards">${cards()}</div><p class="ranking-context">${rankNote()}</p>${barSection()}</section>`;
    return `<section class="explorer-rank" id="rankings" aria-label="Explore os rankings">${tabs()}<div class="cards explorer-cards">${cards()}</div><div class="filters explorer-filters">${metricToggle(true)}<div class="selects">${ufSelect()}${yearSelect()}</div></div><div class="explorer-extra">${categorySelect()}<button data-action="reverse">${state.tab === 'menos' ? 'Ver maiores gastos ↑' : 'Ver menores gastos ↓'}</button></div>${barSection()}<p class="ranking-context">${rankNote()}</p></section>`;
  }
  function monthly(p) { return monthNames.map((_, month) => month < p.months ? sum(records(p).filter(r => r.month === month)) : null); }
  function chart() {
    const ppl = all().filter(p => state.uf === 'Brasil' || p.uf === state.uf).slice(0, model === 'investigacao' ? 2 : 3);
    const visible = ppl.filter(p => !state.hiddenSeries.has(p.id));
    const rows = visible.map(p => ({ p, values: monthly(p) }));
    const maxValue = Math.max(10000, ...rows.flatMap(row => row.values).filter(v => v !== null));
    const step = Math.ceil(maxValue / 3 / 5000) * 5000, max = step * 3;
    const small = innerWidth <= 700;
    const W = small ? Math.max(300, innerWidth - 38) : 940;
    const H = small ? 190 : model === 'investigacao' ? 155 : 220, left = 64, right = 10, top = 12, bottom = 27;
    const x = i => left + i * (W - left - right) / 11, y = v => H - bottom - v / max * (H - bottom - top);
    const colors = ['var(--accent)', 'var(--chart2)', 'var(--chart3)'];
    let svg = '';
    for (let i = 0; i <= 3; i++) svg += `<line class="grid" x1="${left}" x2="${W - right}" y1="${y(i * step)}" y2="${y(i * step)}"/><text x="${left - 9}" y="${y(i * step) + 4}" text-anchor="end">${compact(i * step)}</text>`;
    monthNames.forEach((name, i) => { svg += `<line class="grid" x1="${x(i)}" x2="${x(i)}" y1="${top}" y2="${H - bottom}" opacity=".55"/>${!small || i % 3 === 0 || i === 11 ? `<text x="${x(i)}" y="${H - 5}" text-anchor="middle">${name}</text>` : ''}`; });
    rows.forEach(({ p, values }) => {
      const color = colors[ppl.indexOf(p)];
      svg += `<path class="series" stroke="${color}" d="${values.map((v, i) => v === null ? '' : `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ')}"/>`;
      values.forEach((v, i) => { if (v !== null) svg += `<circle class="chart-point" role="button" tabindex="0" data-action="month" data-id="${p.id}" data-month="${i}" aria-label="${p.name}, ${monthNames[i]} ${state.year}: ${money(v)}. Abrir registros" cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${color}"><title>${p.name} · ${monthNames[i]}: ${money(v)}</title></circle>`; });
    });
    return `<section class="chart-section" id="history"><div class="chart-head"><h2>${model === 'explorador' ? 'Veja como muda ao longo do ano' : 'Como os gastos mudaram'}</h2><div class="chart-legend" role="group" aria-label="Séries do gráfico">${ppl.map((p, i) => `<button data-series="${p.id}" style="--color:${colors[i]}" aria-pressed="${!state.hiddenSeries.has(p.id)}">${p.name}</button>`).join('')}</div></div><div class="chart-frame"><svg class="line-chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="Reembolsos mensais fictícios em ${state.year}. Pontos abrem registros.">${svg}</svg></div><button class="chart-table-toggle" data-action="chart-table" aria-expanded="false">${icon('table')} Ver dados em tabela</button><div class="table-scroll" id="chart-table" hidden><table class="data-table"><caption class="sr-only">Reembolsos mensais em reais, ${state.year}</caption><thead><tr><th>Mês</th>${ppl.map(p => `<th>${p.name}</th>`).join('')}</tr></thead><tbody>${monthNames.map((month, i) => `<tr><th scope="row">${month}</th>${ppl.map(p => `<td>${monthly(p)[i] === null ? 'Sem exercício' : money(monthly(p)[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  }
  function answerHTML() {
    if (!state.answer) return '';
    const answer = state.answer;
    if (answer.type === 'message') return `<section class="answer" aria-label="Resposta da investigação"><p class="eyebrow">Assistente demonstrativo • sem IA conectada</p><div class="answer-message"><h3>${escape(answer.title)}</h3><p>${escape(answer.message)}</p><div class="answer-next"><span>Tente:</span>${['Quem mais gastou por mês?', 'Quem apresentou mais projetos?'].map(q => `<button type="button" class="outline-button" data-question="${escape(q)}">${escape(q)}</button>`).join('')}</div></div></section>`;
    const ppl = answer.ids.map(person).filter(Boolean), max = Math.max(1, ...ppl.map(p => value(p, answer.kind)));
    let summary = '';
    if (answer.type === 'compare') {
      const a = value(ppl[0], answer.kind), b = value(ppl[1], answer.kind), ratio = b ? Math.abs((a - b) / b * 100) : null;
      summary = a === b ? `${ppl[0].name.split(' ')[0]} e ${ppl[1].name.split(' ')[0]} têm o mesmo valor no recorte.` : ratio === null ? 'O segundo valor é zero; não há percentual de comparação definido.' : `${ppl[0].name.split(' ')[0]} registrou ${number(ratio)}% ${a > b ? 'mais' : 'menos'} ${answer.kind === 'projetos' ? 'projetos' : 'despesas'} no período.`;
    } else summary = `${ppl[0].name} ${answer.type === 'rank' ? 'lidera este recorte' : 'na amostra demonstrativa'}.`;
    const unit = answer.kind === 'projetos' ? 'Projetos apresentados' : state.category === 'Todas' ? 'Cota parlamentar' : state.category;
    return `<section class="answer" aria-label="Resultado da investigação"><p class="eyebrow">Resultado da investigação</p><div class="answer-bars">${ppl.map(p => `<div class="answer-row">${avatar(p)}<b>${p.name}</b><strong>${formatted(p, answer.kind)}</strong><span class="track"><i style="width:${value(p, answer.kind) / max * 100}%"></i></span></div>`).join('')}</div><div class="answer-bottom"><div><p class="answer-summary">${summary}</p><p class="context">${unit} • Jan–Dez ${state.year} • ${ppl.every(p => p.months === 12) ? '12 meses em exercício' : ppl.map(p => `${p.name.split(' ')[0]}: ${p.months} meses`).join(' / ')}${state.metric === 'mensal' ? ' • média mensal' : ''}</p></div><div class="answer-actions"><button class="outline-button primary" data-action="answer-evidence">Como chegamos nisso? ${icon('external')}</button><button class="outline-button" data-action="share">${icon('share')} Compartilhar</button></div></div></section>`;
  }
  function layout() {
    document.body.dataset.model = model;
    document.title = `Clareia · ${models[model]} · MVP`;
    let main;
    if (model === 'investigacao') main = `<section class="investigation-hero"><p class="eyebrow">Política, com evidências</p><h1>Pergunte. Compare. Confira.</h1><p class="subtitle">Investigue os números dos seus representantes.</p>${searchForm()}<div id="answer-slot" aria-live="polite">${answerHTML()}</div></section><div id="rank-slot">${rankingSection()}</div><div id="chart-slot">${chart()}</div>`;
    else if (model === 'editorial') main = `<section class="editorial-hero"><h1 class="editorial-title">O poder,<em>em números.</em></h1><div class="editorial-left"><p class="editorial-subtitle">Dados públicos para uma sociedade mais informada.</p>${searchForm()}</div><div class="hero-portrait" id="hero-portrait">${photo(person(state.featured), 'hero')}</div><p class="editorial-handwritten">Todo número<br>tem uma<br>fonte.</p><div class="editorial-feature" id="editorial-feature">${editorialFeature()}</div></section><div id="answer-slot" aria-live="polite">${answerHTML()}</div><div id="rank-slot">${rankingSection()}</div>`;
    else main = `<section class="explorer-hero"><h1>Quem está no topo?<em>Você escolhe o recorte.</em></h1></section><div id="answer-slot" aria-live="polite">${answerHTML()}</div><div id="rank-slot">${rankingSection()}</div><div id="chart-slot">${chart()}</div>`;
    $('#app').innerHTML = `<div class="prototype-bar"><span class="prototype-label">CLAREIA / ESTUDOS DE INTERFACE</span><nav class="model-links" aria-label="Escolha o modelo">${Object.entries(models).map(([key, name], i) => `<a href="${modelURL(key)}" ${key === model ? 'aria-current="page"' : ''}>0${i + 1} · ${name}</a>`).join('')}</nav><span class="prototype-label">MVP INTERATIVO</span></div><div class="site">${header()}<main id="main">${main}</main><footer class="footer"><span>Pessoas, retratos e dados fictícios. Assistente demonstrativo, sem IA conectada.</span><button data-action="methodology">Fontes e metodologia ↗</button></footer></div>`;
  }
  function editorialFeature() {
    const p = person(state.featured);
    const choices = ['ana', 'bruno', 'carla'].map(id => person(id)).map(c => `<button type="button" data-action="feature" data-id="${c.id}" aria-pressed="${c.id === p.id}">${avatar(c)}<span>${c.name.split(' ')[0]}</span></button>`).join('');
    return `<p class="eyebrow">Destaque · perfil fictício</p><button class="feature-value" data-action="evidence" data-id="${p.id}" data-kind="gastos" data-amount="${value(p, 'gastos')}">${compact(value(p, 'gastos'))}</button><p>${state.metric === 'mensal' ? 'é a média mensal' : 'foi o total'} ${state.category === 'Todas' ? 'de reembolsos' : 'em ' + state.category.toLowerCase()} de ${p.name} em ${state.year}.</p><button class="text-button" data-action="evidence" data-id="${p.id}" data-kind="gastos">Como chegamos nisso? ↗</button><div class="feature-switch" role="group" aria-label="Escolha quem aparece no destaque"><span>Destacar</span>${choices}</div>`;
  }
  // Swapping the featured person: portrait reopens, the figure counts from the old value to the new one.
  function feature(id) {
    if (id === state.featured) return;
    const from = Number($('#editorial-feature .feature-value')?.dataset.amount) || 0;
    state.featured = id;
    $('#editorial-feature').innerHTML = editorialFeature();
    const portrait = $('#hero-portrait');
    portrait.innerHTML = photo(person(id), 'hero');
    const moving = !matchMedia('(prefers-reduced-motion: reduce)').matches && document.body.dataset.motion !== 'off';
    $('#editorial-feature [data-action="feature"][aria-pressed="true"]')?.focus({ preventScroll: true });
    if (!moving) return;
    portrait.animate([{ clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0)' }], { duration: 560, easing: 'cubic-bezier(.77,0,.175,1)' });
    const el = $('#editorial-feature .feature-value'), to = Number(el.dataset.amount), start = performance.now();
    const tick = now => { const t = Math.min(1, (now - start) / 420), e = 1 - Math.pow(1 - t, 3); el.textContent = compact(Math.round(from + (to - from) * e)); if (t < 1 && el.isConnected) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  // The tab indicator starts where the previous tab was, then travels to the new one.
  let tabMark = null;
  // A search can narrow the whole page; while it does, a chip names the slice and offers the way back.
  function scopeChip() {
    if (model !== 'editorial') return;
    let chip = $('#scope-chip');
    if (!chip) { chip = document.createElement('div'); chip.id = 'scope-chip'; chip.className = 'scope-chip'; chip.setAttribute('role', 'status'); $('#answer-slot').before(chip); }
    const narrowed = state.uf !== 'Brasil' || state.category !== 'Todas' || state.metric === 'mensal';
    chip.hidden = !narrowed;
    chip.innerHTML = narrowed ? `<span>Filtrando: ${[state.uf === 'Brasil' ? 'Brasil' : state.uf, state.category === 'Todas' ? 'todas as categorias' : state.category, state.metric === 'mensal' ? 'por mês' : 'total'].join(' · ')}</span><button type="button" data-action="reset">Limpar</button>` : '';
  }
  function markTab(animate = true) {
    const tabs = $('.editorial-rank .tabs'), on = tabs?.querySelector('[aria-pressed="true"]');
    if (!on) return;
    const next = { x: on.offsetLeft, w: on.offsetWidth };
    if (animate && tabMark) { tabs.style.setProperty('--tab-x', tabMark.x + 'px'); tabs.style.setProperty('--tab-w', tabMark.w + 'px'); tabs.getBoundingClientRect(); }
    tabs.style.setProperty('--tab-x', next.x + 'px'); tabs.style.setProperty('--tab-w', next.w + 'px');
    tabMark = next;
  }
  function refresh() {
    state.popover = null;
    const focused = document.activeElement;
    const focusKey = focused?.dataset.filter ? ['filter', focused.dataset.filter] : focused?.dataset.metric ? ['metric', focused.dataset.metric] : focused?.dataset.tab ? ['tab', focused.dataset.tab] : null;
    const before = new Map([...document.querySelectorAll('.rank-card')].map(el => [el.dataset.person, el.getBoundingClientRect()]));
    $('#rank-slot').innerHTML = rankingSection();
    if ($('#chart-slot')) $('#chart-slot').innerHTML = chart();
    // A narrowed state features the portrait-bearing person from that state, so the hero follows the scope.
    const local = ['ana', 'bruno', 'carla'].find(id => person(id).uf === state.uf);
    if (local && local !== state.featured && $('#hero-portrait')) { state.featured = local; $('#hero-portrait').innerHTML = photo(person(local), 'hero'); }
    if ($('#editorial-feature')) $('#editorial-feature').innerHTML = editorialFeature();
    if (state.answer?.type === 'rank') state.answer.ids = ranking().slice(0, 3).map(p => p.id);
    if (state.answer?.type === 'rank' && !state.answer.ids.length) state.answer = { type: 'message', title: 'Nenhum perfil neste recorte.', message: 'Altere o estado ou limpe os filtros para explorar a demonstração.' };
    $('#answer-slot').innerHTML = answerHTML();
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
  function ask(query, scroll = true) {
    state.query = query.trim();
    if (!state.query) { $('#query').focus(); return; }
    const q = norm(state.query), years = q.match(/\b20\d{2}\b/g);
    const unsupported = years?.find(y => !['2024', '2025'].includes(y));
    let message;
    if (unsupported) message = ['Período fora da demonstração', 'Esta amostra contém apenas 2024 e 2025. Escolha um desses anos.'];
    else if (new Set(years || []).size > 1) message = ['Escolha um ano para esta comparação', 'Neste MVP, as comparações usam um único ano por vez: 2024 ou 2025.'];
    else if (/votou|votaram|reforma|corrup|roub|honest|melhor|pior|patrimon|emenda|salario|president|senador/.test(q)) message = ['Não temos evidência para responder isso', 'O assistente consulta gastos e projetos fictícios. As votações da página são cenários ilustrativos, na seção Votações; patrimônio, emendas e avaliações morais não estão na amostra.'];
    if (!message) {
      if (years?.length) state.year = years[0];
      const matches = all().filter(p => p.name.split(' ').some(word => new RegExp(`\\b${norm(word)}\\b`).test(q)));
      if (matches.length === 1 && /compar|\bmais que\b|\bmenos que\b|\bversus\b/.test(q)) message = ['Qual é o outro representante?', 'Na amostra, você pode comparar Ana Martins, Bruno Costa, Carla Nunes, Diego Rocha e Fernanda Lima.'];
      else if (matches.length > 2) message = ['Escolha duas pessoas para comparar', 'Experimente: “Compare Ana e Bruno em 2025”.'];
      else if (!matches.length && !/\bquem\b|\branking\b|maiores gastos|menores gastos|mais projetos|menos projetos|^(gastos|projetos|despesas)$/.test(q)) message = ['Vamos delimitar a investigação', 'Não identifiquei uma pergunta compatível ou uma pessoa da amostra. Experimente “Ana gastou mais que Bruno?” ou “Quem de MG gastou mais com passagens?”. O assistente usa regras locais, sem IA conectada.'];
      else {
        state.metric = /por mes|mensal|media/.test(q) ? 'mensal' : 'total';
        state.category = /passage/.test(q) ? 'Passagens' : /divulga/.test(q) ? 'Divulgação' : /outras/.test(q) ? 'Outras' : 'Todas';
        state.uf = /\bmg\b|minas/.test(q) ? 'MG' : /\bsp\b|sao paulo/.test(q) ? 'SP' : /\brj\b|rio de janeiro/.test(q) ? 'RJ' : 'Brasil';
        const kind = /projet|propost/.test(q) ? 'projetos' : 'gastos';
        state.tab = kind === 'projetos' ? kind : /quem.*menos|menor gasto/.test(q) ? 'menos' : 'gastos';
        if (matches.length === 2) {
          matches.sort((a, b) => q.indexOf(norm(a.name.split(' ')[0])) - q.indexOf(norm(b.name.split(' ')[0])));
          state.answer = { type: 'compare', ids: matches.map(p => p.id), kind };
        } else if (matches.length === 1) state.answer = { type: 'profile', ids: [matches[0].id], kind };
        else state.answer = { type: 'rank', ids: ranking().slice(0, 3).map(p => p.id), kind };
      }
    }
    if (message) state.answer = { type: 'message', title: message[0], message: message[1] };
    $('#query').value = state.query;
    closeSuggestions(); refresh();
    if (scroll) $('#answer-slot').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  }
  function showDialog(title, html, resetScroll = true) {
    const dialog = $('#detail');
    if (!dialog.open) dialogTrigger = document.activeElement;
    $('#detail-title').textContent = title; $('#detail-body').innerHTML = html;
    if (!dialog.open) dialog.showModal();
    if (resetScroll) dialog.scrollTop = 0;
    $('#detail .close-button').focus({ preventScroll: true });
  }
  const fixtureNote = '<div class="fixture-note">Neste MVP, pessoas, valores e registros são fictícios. Nenhum número foi consultado na Câmara. A fonte abaixo é uma referência para a futura integração.</div>';
  function sourceBlock(p) {
    return `<section class="detail-section"><div class="source-block">${icon('database')}<div><h3>Fonte prevista</h3><a href="https://dadosabertos.camara.leg.br/swagger/api.html" target="_blank" rel="noopener noreferrer">Dados Abertos da Câmara ↗</a><p>Documentação da futura integração. Dados desta tela: amostra local de demonstração.</p><button class="outline-button" data-action="records" data-id="${p.id}">Ver registros fictícios</button></div></div></section>${fixtureNote}`;
  }
  function categoryBreakdown(p) {
    const list = categories.map(category => ({ category, total: sum(p.records.filter(r => r.category === category)) }));
    const max = Math.max(1, ...list.map(item => item.total));
    return `<section class="detail-section"><h3>Despesas de ${p.name.split(' ')[0]}</h3>${list.map(item => `<div class="category-row"><span>${item.category}</span><div><strong>${compact(item.total)}</strong><span class="track"><i style="width:${item.total / max * 100}%;opacity:.7"></i></span></div></div>`).join('')}<p class="context">Composição do total anual: ${money(p.total)}. ${state.category !== 'Todas' ? `O recorte atual usa apenas ${state.category}.` : ''}</p></section>`;
  }
  function evidence(id, options = {}) {
    const p = person(id), kind = options.kind || state.tab, comparison = options.compare ? person(options.compare) : null;
    currentEvidence = { id, kind, compare: comparison?.id };
    const count = ['projetos', 'votacoes'].includes(kind);
    const amount = value(p, kind), total = count ? kind === 'projetos' ? p.projects : p.votes : sum(records(p));
    let formula = state.metric === 'mensal' ? `${money(total)} ÷ ${p.months} meses em exercício` : `Soma de ${records(p).length} registros = ${money(total)}`;
    let result = count ? number(amount) : compact(amount), resultCaption = state.metric === 'mensal' ? 'por mês em exercício' : 'no período';
    if (count) formula = `${total} ${kind === 'projetos' ? 'projetos distintos de autoria principal' : 'participações nominais'}${state.metric === 'mensal' ? ` ÷ ${p.months} meses` : ''}`;
    if (comparison) {
      const b = value(comparison, kind), percent = b ? (amount - b) / b * 100 : null;
      formula = `(${count ? number(amount) : money(amount)} − ${count ? number(b) : money(b)}) ÷ ${count ? number(b) : money(b)} × 100`;
      result = percent === null ? 'Indefinido' : `${number(Math.abs(percent))}%`;
      resultCaption = percent === null ? 'O denominador é zero.' : percent === 0 ? 'valores iguais no recorte' : `${percent > 0 ? 'a mais' : 'a menos'} no período`;
    }
    const metricName = kind === 'projetos' ? 'Projetos apresentados' : kind === 'votacoes' ? 'Participações em votações' : 'Reembolsos da cota parlamentar';
    showDialog('Como chegamos nisso?', `<p class="dialog-subtitle">${comparison ? 'A comparação, passo a passo' : 'O cálculo, passo a passo'}</p>
      <section class="evidence-step"><span class="step-number">1</span><div><h3>O que estamos comparando</h3><p>${metricName} • ${state.year}</p><p>${p.name}${comparison ? ` × ${comparison.name}` : ''}</p></div></section>
      <section class="evidence-step"><span class="step-number">2</span><div><h3>Quais registros entram</h3><p>${count ? 'Amostra demonstrativa de atividade parlamentar' : `${records(p).length} registros fictícios${comparison ? ` + ${records(comparison).length} de ${comparison.name}` : ''}`}. Janeiro a dezembro. ${!count && state.category !== 'Todas' ? `Categoria: ${state.category}.` : ''}</p><p>${p.name.split(' ')[0]}: ${p.months} meses em exercício${comparison ? `; ${comparison.name.split(' ')[0]}: ${comparison.months} meses` : ''}.</p></div></section>
      <section class="evidence-step"><span class="step-number">3</span><div><h3>Como calculamos</h3><p>${formula}</p><div class="calculation-result">${result}<small>${resultCaption}</small></div></div></section>
      ${count ? `<section class="detail-section"><h3>Definição do indicador</h3><p class="records-note">${kind === 'projetos' ? 'Contagem de projetos distintos de autoria principal. Não mede leis aprovadas, qualidade ou impacto.' : 'Quantidade de participações em votações nominais. Não informa o sentido do voto nem é uma nota de desempenho.'}</p><button class="outline-button" data-action="activity" data-id="${id}" data-kind="${kind}">Ver itens fictícios</button></section>${fixtureNote}` : categoryBreakdown(p) + sourceBlock(p)}`);
  }
  function recordTable(p, month) {
    const items = records(p).filter(r => month === undefined || r.month === month);
    currentEvidence = { id: p.id, month, kind: 'gastos' };
    showDialog(`Registros de ${p.name.split(' ')[0]}`, `<p class="records-note">${month === undefined ? 'Jan–Dez' : monthNames[month]} ${state.year} • ${state.category === 'Todas' ? 'Todas as categorias' : state.category} • ${items.length} registros de demonstração.</p><div class="calculation-result">${money(sum(items))}<small>Soma exata dos registros abaixo</small></div><div class="action-row"><button class="outline-button" data-action="download" data-id="${p.id}" ${month === undefined ? '' : `data-month="${month}"`}>Baixar CSV</button><button class="text-button" data-action="evidence" data-id="${p.id}" data-kind="gastos">Voltar ao cálculo</button></div><div class="table-scroll"><table class="data-table"><caption class="sr-only">Registros fictícios de ${p.name}</caption><thead><tr><th>Data / identificação</th><th>Categoria</th><th>Valor</th></tr></thead><tbody>${items.map(r => `<tr><td>${r.date.split('-').reverse().join('/')}<br><small>${r.id}</small></td><td>${r.category}<br><small>${r.supplier}</small></td><td>${money(r.amount)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="2">Total</th><td><strong>${money(sum(items))}</strong></td></tr></tfoot></table></div>${fixtureNote}`);
  }
  function activity(id, kind) {
    const p = person(id), total = kind === 'projetos' ? p.projects : p.votes;
    showDialog(kind === 'projetos' ? 'Projetos de demonstração' : 'Votações de demonstração', `<p class="records-note">${p.name} • ${total} itens fictícios em ${state.year}. Identificadores DEMO não correspondem a proposições reais.</p><div class="table-scroll"><table class="data-table"><thead><tr><th>Identificador</th><th>Registro</th></tr></thead><tbody>${Array.from({ length: total }, (_, i) => `<tr><td>DEMO-${p.id.toUpperCase()}-${String(i + 1).padStart(3, '0')}</td><td>${kind === 'projetos' ? 'Projeto apresentado · autoria principal' : 'Participação registrada'}</td></tr>`).join('')}</tbody></table></div>${fixtureNote}`);
  }
  function profile(id) {
    const p = person(id);
    showDialog('Perfil do representante', `<div class="profile-head">${avatar(p)}<div><h3>${p.name}</h3><p class="context">Deputado(a) federal fictício(a) • ${p.uf}</p><p class="context">${p.months} meses em exercício em ${state.year}</p></div></div><div class="profile-stats"><button class="profile-stat" data-action="evidence" data-id="${id}" data-kind="gastos"><span>${state.metric === 'mensal' ? 'Reembolso médio / mês' : 'Reembolsos no recorte'}</span><strong>${compact(value(p, 'gastos'))} ↗</strong></button><button class="profile-stat" data-action="evidence" data-id="${id}" data-kind="projetos"><span>Projetos${state.metric === 'mensal' ? ' / mês' : ''}</span><strong>${number(value(p, 'projetos'))} ↗</strong></button></div>${categoryBreakdown(p)}<div class="action-row"><button class="outline-button primary" data-action="profile-compare" data-id="${id}">Comparar com ${id === 'ana' ? 'Bruno' : 'Ana'}</button><button class="outline-button" data-action="records" data-id="${id}">Abrir registros</button></div>${fixtureNote}`);
  }
  function methodology() {
    showDialog('Fontes e metodologia', `<div class="text-content"><p>Este é um MVP de interface com três composições visuais independentes. Todos os nomes, retratos, valores e registros são fictícios. O assistente usa regras locais; não há modelo de IA nem integração com APIs.</p><h3>Como calculamos</h3><ul><li>Gastos: soma dos registros de reembolso do ano e da categoria selecionados.</li><li>Por mês: total dividido pelos meses em exercício, não apenas pelos meses com despesas.</li><li>Menores gastos: perfis com ao menos seis meses em exercício.</li><li>Projetos: itens distintos de autoria principal; não significa aprovação.</li><li>Votações: contagem demonstrativa de participações; não mede o sentido do voto.</li><li>Empates: ordem alfabética. Meses sem exercício aparecem como “Sem exercício”.</li></ul><h3>Mesmos filtros, mesmos cálculos</h3><p>Rankings, busca, gráficos e registros usam a mesma amostra. O modelo Investigação usa R$ 150 mil para Carla; os demais usam R$ 120 mil, preservando os valores dos esboços. São conjuntos demonstrativos separados.</p><h3>O que a busca entende</h3><p>Nomes da amostra, comparação de duas pessoas, maiores/menores gastos, projetos, passagens, divulgação, média mensal, estados SP/MG/RJ e anos 2024/2025. Perguntas fora da cobertura recebem uma explicação.</p><h3>Futura fonte oficial</h3><p><a href="https://dadosabertos.camara.leg.br/swagger/api.html" target="_blank" rel="noopener noreferrer">Documentação dos Dados Abertos da Câmara ↗</a></p><p>A fonte é uma referência de integração. Não sustenta os números fictícios deste MVP.</p></div>`);
  }
  function popover(id) {
    $('#evidence-pop')?.remove();
    if (state.popover === id) { state.popover = null; return; }
    state.popover = id;
    const p = person(id), count = isCount();
    const div = document.createElement('div'); div.id = 'evidence-pop'; div.className = 'evidence-pop';
    div.setAttribute('role', 'region'); div.setAttribute('aria-label', `Evidências de ${p.name}`);
    div.innerHTML = `<div class="pop-heading"><b>De onde vem esse valor?</b><button class="close-button" data-action="close-pop" aria-label="Fechar evidências">×</button></div><dl>${count ? `<dt>${state.tab === 'projetos' ? 'Projetos' : 'Participações'}</dt><dd>${formatted(p)}</dd>` : `<dt>${state.metric === 'mensal' ? 'Média mensal' : 'Cota parlamentar'}</dt><dd>${formatted(p)}</dd><dt>Registros no recorte</dt><dd>${records(p).length}</dd>`}</dl><p class="context">Jan–Dez ${state.year} • ${p.name}</p><button class="text-button" data-action="evidence" data-id="${id}">Abrir ${count ? 'detalhamento' : 'registros'} ↗</button>`;
    $('#bar-chart').appendChild(div);
  }
  function toast(text) { const el = $('#toast'); el.textContent = text; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800); }
  async function share() {
    syncURL();
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(location.href); toast('Link com a investigação e os filtros copiado.'); }
    catch { showDialog('Compartilhar investigação', `<div class="manual-share"><p>Copie este link. A seleção de modelo, filtros e pergunta será preservada.</p><label for="share-link">Link da consulta</label><input id="share-link" readonly value="${escape(location.href)}"><p class="context">Links locais funcionam no computador em que o MVP está aberto.</p></div>`); $('#share-link').select(); }
  }
  function closeSuggestions() { $('#suggestions').hidden = true; $('#query').setAttribute('aria-expanded', 'false'); }
  function exportCSV(id, month) {
    const p = person(id), items = records(p).filter(r => month === undefined || month === r.month);
    const csv = '\ufeff' + [['identificador', 'data', 'categoria', 'fornecedor_ficticio', 'valor_reais'], ...items.map(r => [r.id, r.date, r.category, r.supplier, r.amount.toFixed(2).replace('.', ',')])].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `clareia-DEMO-${id}-${state.year}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('CSV de registros fictícios preparado.');
  }
  function closeDialog() { $('#detail').close(); if (dialogTrigger?.isConnected) dialogTrigger.focus({ preventScroll: true }); }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action],[data-tab],[data-metric],[data-series],[data-question]');
    if (!event.target.closest('.search-wrap')) closeSuggestions();
    if (!target) return;
    if (target.tagName === 'A') event.preventDefault();
    if (target.dataset.tab) { state.tab = target.dataset.tab; refresh(); return; }
    if (target.dataset.metric) { state.metric = target.dataset.metric; refresh(); return; }
    if (target.dataset.series) { const id = target.dataset.series; state.hiddenSeries.has(id) ? state.hiddenSeries.delete(id) : state.hiddenSeries.add(id); $('#chart-slot').innerHTML = chart(); document.querySelector(`[data-series="${id}"]`).focus({ preventScroll: true }); return; }
    if (target.dataset.question) { ask(target.dataset.question); return; }
    const id = target.dataset.id, action = target.dataset.action;
    if (action === 'close') closeDialog();
    else if (action === 'feature') feature(id);
    else if (action === 'evidence') evidence(id, { kind: target.dataset.kind });
    else if (action === 'answer-evidence' && state.answer?.ids?.length) evidence(state.answer.ids[0], { kind: state.answer.kind, compare: state.answer.type === 'compare' ? state.answer.ids[1] : null });
    else if (action === 'records') recordTable(person(id));
    else if (action === 'month') recordTable(person(id), Number(target.dataset.month));
    else if (action === 'profile') profile(id);
    else if (action === 'activity') activity(id, target.dataset.kind);
    else if (action === 'methodology') methodology();
    else if (action === 'focus-search') { $('#query').focus(); $('#query').scrollIntoView({ block: 'center' }); }
    else if (action === 'compare') { ask('Compare Ana e Bruno em ' + state.year); $('#query').focus(); }
    else if (action === 'profile-compare') { closeDialog(); ask(`Compare ${person(id).name} e ${id === 'ana' ? 'Bruno Costa' : 'Ana Martins'} em ${state.year}`); }
    else if (action === 'share') share();
    else if (action === 'popover') popover(id);
    else if (action === 'close-pop') { $('#evidence-pop')?.remove(); state.popover = null; }
    else if (action === 'votes') { if ($('#votacoes')) $('#votacoes').scrollIntoView({behavior:'smooth'}); else showDialog('Votações', '<p>Votações reais ainda não estão integradas.</p>'); }
    else if (action === 'reverse') { state.tab = state.tab === 'menos' ? 'gastos' : 'menos'; refresh(); }
    else if (action === 'reset') { state.uf = 'Brasil'; state.category = 'Todas'; if (model === 'editorial') { state.metric = 'total'; if (state.featured !== 'ana') { state.featured = 'ana'; $('#hero-portrait').innerHTML = photo(person('ana'), 'hero'); } } if (model === 'editorial') { state.query = ''; state.answer = null; $('#query').value = ''; $('#answer-slot').innerHTML = ''; } refresh(); if (model === 'editorial') { $('#editorial-feature .feature-value')?.focus({ preventScroll: true }); toast('Filtros limpos: Brasil, todas as categorias, valor total.'); } }
    else if (action === 'chart-table') { const table = $('#chart-table'); table.hidden = !table.hidden; target.setAttribute('aria-expanded', String(!table.hidden)); }
    else if (action === 'download') exportCSV(id, target.hasAttribute('data-month') ? Number(target.dataset.month) : undefined);
  });
  document.addEventListener('change', event => { const key = event.target.dataset.filter; if (key) { state[key] = event.target.value; refresh(); } });
  document.addEventListener('submit', event => { if (event.target.id === 'search-form') { event.preventDefault(); ask($('#query').value); } });
  document.addEventListener('focusin', event => { if (event.target.id === 'query') { $('#suggestions').hidden = false; $('#query').setAttribute('aria-expanded', 'true'); } });
  document.addEventListener('focusout', () => { setTimeout(() => { if (!document.activeElement.closest('.search-wrap')) closeSuggestions(); }, 0); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSuggestions();
    if (event.target.matches('.chart-point') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    if (event.target.id === 'query' && event.key === 'ArrowDown') { event.preventDefault(); $('#suggestions button')?.focus(); }
  });
  $('#detail').addEventListener('click', event => { if (event.target === $('#detail')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right) closeDialog(); } });
  // 'close' fires a task later; only restore focus if nothing else has taken it since (Escape key path).
  $('#detail').addEventListener('close', () => { const a = document.activeElement; if (dialogTrigger?.isConnected && (!a || a === document.body || $('#detail').contains(a))) dialogTrigger.focus({ preventScroll: true }); });
  if (model === 'investigacao' && !state.query) state.answer = { type: 'compare', ids: ['ana', 'bruno'], kind: 'gastos' };
  layout();
  markTab(false);
  scopeChip();
  document.fonts?.ready.then(() => markTab(false));
  window.Clareia = { model, state, all, person, records, sum, money, compact, number, escape, photo, avatar, icon, ask, evidence, profile, recordTable, showDialog, closeDialog, methodology, toast, refresh, sourceBlock };
  window.addEventListener('resize', () => { if ($('#chart-slot')) $('#chart-slot').innerHTML = chart(); markTab(false); });
  if (state.query) {
    const restored = {};
    for (const [key, param] of Object.entries({ year: 'ano', uf: 'uf', category: 'categoria', metric: 'metrica', tab: 'aba' })) {
      if (initial.has(param)) restored[key] = state[key];
    }
    ask(state.query, false);
    Object.assign(state, restored);
    refresh();
  }
})();
