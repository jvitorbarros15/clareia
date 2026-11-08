(() => {
  'use strict';
  const D = window.ClareiaData;
  const { categories, monthNames, index, base, label } = D;
  const model = 'editorial';
  const initial = new URLSearchParams(location.search);
  const ids = D.dataset().map(p => p.id);
  const totalOf = p => p.records.reduce((n, r) => n + r.amount, 0);
  const byTotal = () => [...D.dataset()].sort((a, b) => totalOf(b) - totalOf(a));
  const state = {
    year: D.year, uf: 'Brasil',
    category: categories.includes(initial.get('categoria')) ? initial.get('categoria') : 'Todas',
    metric: initial.get('metrica') === 'mensal' ? 'mensal' : 'total',
    tab: ['menos', 'projetos'].includes(initial.get('aba')) ? initial.get('aba') : 'gastos',
    query: initial.get('q') || '', featured: ids.includes(initial.get('destaque')) ? initial.get('destaque') : byTotal()[0]?.id, answer: null, hiddenSeries: new Set(), popover: null
  };
  let dialogTrigger = null, toastTimer;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const norm = value => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Amounts are integer cents from the published version; every exact value shows its cents.
  const money = cents => cents === null ? 'Não informado' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/^-/, '−');
  const compact = cents => Math.abs(cents) >= 100000 ? `${cents < 0 ? '−' : ''}R$\u00a0${(Math.abs(cents) / 100000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : money(Math.round(cents));
  const number = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  // Positive categories are the only ones drawn as slices, so they are the base of every percentage on the page.
  const shareBase = groups => groups.reduce((n, g) => n + Math.max(0, g.value), 0);
  const share = (value, base) => `${(base > 0 ? value / base * 100 : 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  const sum = records => records.reduce((total, record) => total + record.amount, 0);
  const all = () => D.dataset();
  const person = id => all().find(p => p.id === id);
  const first = p => p.name.split(' ')[0];
  const records = p => p.records.filter(r => state.category === 'Todas' || r.category === state.category);
  const span = () => { const c = D.coverage; return `${monthNames[c[0]]}–${monthNames[c.at(-1)]} ${state.year}`; };
  const pending = 'Ainda não coletado';
  // Party is the Câmara's current status at collection time, not a historical attribution.
  const context = p => [p.uf, p.party].filter(Boolean).join(' · ') || 'Deputado(a) federal';
  function value(p, kind = state.tab) {
    if (kind === 'projetos') return null;
    const result = sum(records(p));
    return state.metric === 'mensal' ? result / p.months : result;
  }
  const formatted = (p, kind = state.tab) => kind === 'projetos' ? pending : compact(value(p, kind));
  function ranking() {
    return all().filter(p => state.uf === 'Brasil' || p.uf === state.uf).sort((a, b) => (state.tab === 'menos' ? value(a) - value(b) : value(b) - value(a)) || a.name.localeCompare(b.name, 'pt-BR'));
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
  function photo(p) {
    if (!p.photo) return `<span class="initials" aria-label="${escape(p.name)} — sem retrato">${escape(p.name.split(' ').map(w => w[0]).join('').slice(0, 2))}</span>`;
    return `<span class="photo"><img src="${escape(p.photo)}" alt="Retrato oficial de ${escape(p.name)}" loading="lazy"></span>`;
  }
  const avatar = p => `<span class="avatar">${photo(p)}</span>`;
  function syncURL() {
    const url = new URL(location.href);
    url.search = '';
    Object.entries({ categoria: state.category === 'Todas' ? '' : state.category, metrica: state.metric === 'total' ? '' : state.metric, aba: state.tab === 'gastos' ? '' : state.tab, destaque: state.featured, q: state.query }).forEach(([key, val]) => { if (val) url.searchParams.set(key, val); });
    try { history.replaceState(null, '', url); } catch { /* file previews may restrict history */ }
  }
  const examples = () => { const [a, b] = byTotal(); return [`${first(a)} gastou mais que ${first(b)}?`, 'Quem mais gastou por mês?', 'Quem mais gastou com passagens?', 'Quem gastou menos?']; };
  function searchForm() {
    return `<div class="search-wrap"><form class="search-form" id="search-form" role="search" autocomplete="off">
      <label class="sr-only" for="query">Pergunte sobre os dados</label>
      <input id="query" name="q" value="${escape(state.query)}" placeholder="O que você quer investigar?" maxlength="300" aria-controls="suggestions" aria-expanded="false">
      <button class="search-submit" type="submit" aria-label="Investigar pergunta">${icon('arrow')}</button>
      </form><div id="suggestions" class="suggestions" hidden><p>Experimente nesta amostra</p>${examples().map(q => `<button type="button" data-question="${escape(q)}">${escape(q)} ${icon('arrow')}</button>`).join('')}</div></div>`;
  }
  function header() {
    return `<header class="site-header"><a class="logo" href="/" aria-label="Clareia, início">clareia<svg class="brand-rays" viewBox="0 0 25 30" aria-hidden="true"><path d="M5 8 8 3M10 13l8-3M11 19l9 2M6 23l4 5"/></svg></a>
      <button class="header-search" data-action="focus-search" aria-label="Ir para a busca">${icon('search')}</button></header>`;
  }
  function metricToggle() {
    return `<div class="metric-toggle" role="group" aria-label="Forma de comparar"><button data-metric="total" aria-pressed="${state.metric === 'total'}">Total</button><button data-metric="mensal" aria-pressed="${state.metric === 'mensal'}">Por mês</button></div>`;
  }
  function tabs() {
    return `<div class="tabs" role="group" aria-label="Indicador">${[['gastos', 'Mais gastos'], ['menos', 'Menos gastos'], ['projetos', 'Projetos']].map(([key, label]) => `<button data-tab="${key}" aria-pressed="${state.tab === key}">${label}</button>`).join('')}</div>`;
  }
  function caption(p) {
    return `${state.metric === 'mensal' ? 'Média mensal' : 'Cota parlamentar'} · ${span()} · ${p.months} ${p.months === 1 ? 'mês' : 'meses'} no recorte`;
  }
  function cards() {
    if (state.tab === 'projetos') return `<div class="empty-state"><b>Projetos de lei ainda não foram coletados.</b><p>A próxima etapa inclui PL, PLP e PEC da Câmara, separando autoria principal de coautoria. Nenhum número é mostrado antes da conferência.</p><button class="outline-button" data-tab="gastos">Ver gastos</button></div>`;
    return ranking().slice(0, 3).map((p, i) => `<article class="rank-card editorial-card" data-person="${p.id}">
      <button class="portrait-button" data-action="profile" data-id="${p.id}" aria-label="Abrir perfil de ${escape(p.name)}">${photo(p)}<span class="rank-number">0${i + 1}</span></button>
      <div class="card-info"><h3 class="person-name">${escape(p.name)}</h3><p class="editorial-person-context">${context(p)}</p><button class="value-button" data-action="evidence" data-id="${p.id}" aria-label="${escape(p.name)}: ${money(value(p))}. Como chegamos nisso?">${formatted(p)}</button>
      <p class="card-caption">${caption(p)}</p><button class="editorial-proof" data-action="evidence" data-id="${p.id}">Como chegamos nisso? →</button></div></article>`).join('');
  }
  function rankNote() {
    return state.tab === 'projetos' ? 'Projetos apresentados não equivalem a leis aprovadas.' : 'Amostra técnica de três deputados, não é ranking nacional. Cota parlamentar é a verba mensal que reembolsa despesas do mandato, como passagens, combustível e divulgação. Gasto maior não significa irregularidade.';
  }
  function barSection() {
    if (state.tab === 'projetos') return '';
    const ranked = ranking(), max = Math.max(1, ...ranked.map(p => Math.abs(value(p))));
    return `<section class="bar-section" id="comparison"><h2>Comparativo de gastos · ${span()}</h2><div class="bar-chart" id="bar-chart">${ranked.map((p, i) => `<button class="bar-row" data-action="evidence" data-id="${p.id}" aria-label="${escape(p.name)}, ${money(value(p))}: ver cálculo" style="--opacity:${Math.max(.25, 1 - i * .18)}"><span class="bar-rank">${String(i + 1).padStart(2, '0')}</span>${avatar(p)}<span class="bar-name">${escape(p.name)}</span><span class="track"><i style="width:${Math.abs(value(p)) / max * 100}%"></i></span><span class="bar-value">${money(value(p))}</span></button>`).join('')}</div></section>`;
  }
  function editorialFollowUp() {
    if (state.tab === 'projetos') return '';
    const monthly = state.metric === 'mensal';
    return `<div class="editorial-follow-up"><span>Continue investigando</span><button type="button" data-metric="${monthly ? 'total' : 'mensal'}">${monthly ? 'E se compararmos o total do período?' : 'A ordem muda quando comparamos por mês?'} →</button></div>`;
  }
  function rankingSection() {
    return `<section class="editorial-rank" id="rankings" aria-labelledby="editorial-rank-title"><h2 id="editorial-rank-title" class="sr-only">Deputados da amostra</h2>${tabs()}<div class="editorial-controls"><div class="selects"><span class="real-year">${span()}</span></div>${metricToggle()}</div><div class="cards">${cards()}</div><p class="ranking-context">${rankNote()}</p>${barSection()}${editorialFollowUp()}</section>`;
  }
  function answerHTML() {
    if (!state.answer) return '';
    const answer = state.answer;
    if (answer.type === 'message') return `<section class="answer" aria-label="Resposta da investigação"><p class="eyebrow">Busca por regras locais · sem IA conectada</p><div class="answer-message"><h3>${escape(answer.title)}</h3><p>${escape(answer.message)}</p><div class="answer-next"><span>Tente:</span>${examples().slice(0, 2).map(q => `<button type="button" class="outline-button" data-question="${escape(q)}">${escape(q)}</button>`).join('')}</div></div></section>`;
    const ppl = answer.ids.map(person).filter(Boolean), max = Math.max(1, ...ppl.map(p => Math.abs(value(p, answer.kind))));
    let summary = '';
    if (answer.type === 'compare') {
      const a = value(ppl[0], answer.kind), b = value(ppl[1], answer.kind), ratio = b ? Math.abs((a - b) / b * 100) : null;
      summary = a === b ? `${first(ppl[0])} e ${first(ppl[1])} têm o mesmo valor no recorte.` : ratio === null ? 'O segundo valor é zero; não há percentual de comparação definido.' : `${first(ppl[0])} registrou ${number(ratio)}% ${a > b ? 'mais' : 'menos'} despesas no período.`;
    } else summary = `${ppl[0].name} ${answer.type === 'rank' ? 'lidera este recorte' : 'nesta amostra'}.`;
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
  function layout() {
    document.body.dataset.model = model;
    const main = `<section class="editorial-hero"><h1 class="editorial-title">O poder,<em>em números.</em></h1><div class="editorial-left"><p class="editorial-subtitle">Dados públicos para uma sociedade mais informada.</p>${searchForm()}<div class="editorial-search-examples" aria-label="Perguntas para experimentar"><span>Experimente:</span><button type="button" data-question="Quem mais gastou?">Quem mais gastou? ↗</button><button type="button" data-question="${escape(examples()[0])}">${escape(examples()[0])} ↗</button></div></div><div class="hero-portrait" id="hero-portrait">${photo(person(state.featured))}</div>${handwrittenNote()}<div class="editorial-feature" id="editorial-feature">${editorialFeature()}</div></section><div id="answer-slot" aria-live="polite">${answerHTML()}</div><div id="rank-slot">${rankingSection()}</div>`;
    $('#app').innerHTML = `<div class="site">${header()}<main id="main">${main}</main><footer class="footer"></footer></div>`;
  }
  function editorialFeature() {
    const p = person(state.featured);
    const choices = byTotal().slice(0, 3).map(c => `<button type="button" data-action="feature" data-id="${c.id}" aria-pressed="${c.id === p.id}">${avatar(c)}<span>${escape(first(c))}</span></button>`).join('');
    return `<p class="eyebrow">Destaque · dados oficiais</p><button class="feature-value" id="total" data-action="evidence" data-id="${p.id}" data-kind="gastos" data-amount="${value(p, 'gastos')}">${compact(value(p, 'gastos'))}</button><p>${state.metric === 'mensal' ? 'é a média mensal' : 'foi o total'} ${state.category === 'Todas' ? 'de reembolsos' : 'em ' + escape(label(state.category).toLowerCase())} de ${escape(p.name)} em ${span()}.</p><button class="text-button" data-action="evidence" data-id="${p.id}" data-kind="gastos">Como chegamos nisso? →</button><div class="feature-switch" role="group" aria-label="Escolha quem aparece no destaque"><span>Destacar</span>${choices}</div>`;
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
    const narrowed = state.uf !== 'Brasil' || state.category !== 'Todas' || state.metric === 'mensal';
    chip.hidden = !narrowed;
    chip.innerHTML = narrowed ? `<span>Filtrando: ${escape([state.uf === 'Brasil' ? null : state.uf, state.category === 'Todas' ? null : label(state.category), state.metric === 'mensal' ? 'por mês' : null].filter(Boolean).join(' · '))}</span><button type="button" data-action="reset">Limpar</button>` : '';
  }
  function markTab(animate = true) {
    const tabsEl = $('.editorial-rank .tabs'), on = tabsEl?.querySelector('[aria-pressed="true"]');
    if (!on) return;
    const next = { x: on.offsetLeft, w: on.offsetWidth };
    if (animate && tabMark) { tabsEl.style.setProperty('--tab-x', tabMark.x + 'px'); tabsEl.style.setProperty('--tab-w', tabMark.w + 'px'); tabsEl.getBoundingClientRect(); }
    tabsEl.style.setProperty('--tab-x', next.x + 'px'); tabsEl.style.setProperty('--tab-w', next.w + 'px');
    tabMark = next;
  }
  function refresh() {
    state.popover = null;
    const focused = document.activeElement;
    const focusKey = focused?.dataset.metric ? ['metric', focused.dataset.metric] : focused?.dataset.tab ? ['tab', focused.dataset.tab] : null;
    const before = new Map([...document.querySelectorAll('.rank-card')].map(el => [el.dataset.person, el.getBoundingClientRect()]));
    $('#rank-slot').innerHTML = rankingSection();
    if ($('#editorial-feature')) $('#editorial-feature').innerHTML = editorialFeature();
    if (state.answer?.type === 'rank') state.answer.ids = ranking().slice(0, 3).map(p => p.id);
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
  // Category words a question may use, matched against the official names and the display labels.
  const categoryFor = q => categories.find(c => norm(`${c} ${label(c)}`).split(/[^a-z]+/).filter(w => w.length > 5).some(w => q.includes(w.slice(0, 7))));
  function ask(query, scroll = true) {
    state.query = query.trim();
    if (!state.query) { $('#query').focus(); return; }
    const q = norm(state.query), years = q.match(/\b20\d{2}\b/g);
    let message;
    if (years?.some(y => y !== state.year)) message = ['Período fora desta versão', `Esta versão contém ${span()}. Outros períodos ainda não foram publicados.`];
    else if (/projet|propost|votou|votaram|votac|reforma|corrup|roub|honest|melhor|pior|patrimon|emenda|salario|president|senador|partido/.test(q)) message = ['Não temos esse dado publicado', 'Esta versão cobre só as despesas da cota parlamentar. Projetos, votações, patrimônio e emendas ainda não foram coletados e conferidos.'];
    if (!message) {
      const matches = all().filter(p => p.name.split(' ').some(word => word.length > 2 && new RegExp(`\\b${norm(word)}\\b`).test(q)));
      if (matches.length === 1 && /compar|\bmais que\b|\bmenos que\b|\bversus\b/.test(q)) message = ['Qual é o outro representante?', `Nesta amostra, você pode comparar ${all().map(p => p.name).join(', ')}.`];
      else if (matches.length > 2) message = ['Escolha duas pessoas para comparar', `Experimente: “${examples()[0]}”.`];
      else if (!matches.length && !/\bquem\b|maiores gastos|menores gastos|^(gastos|despesas)$/.test(q)) message = ['Vamos delimitar a investigação', `Não identifiquei uma pergunta compatível ou uma pessoa da amostra. Experimente “${examples()[0]}” ou “Quem mais gastou por mês?”. A busca usa regras locais, sem IA conectada.`];
      else {
        state.metric = /por mes|mensal|media/.test(q) ? 'mensal' : 'total';
        state.category = categoryFor(q) || 'Todas';
        state.tab = /quem.*menos|menor gasto/.test(q) ? 'menos' : 'gastos';
        if (matches.length === 2) {
          matches.sort((a, b) => q.indexOf(norm(first(a))) - q.indexOf(norm(first(b))));
          state.answer = { type: 'compare', ids: matches.map(p => p.id), kind: 'gastos' };
        } else if (matches.length === 1) state.answer = { type: 'profile', ids: [matches[0].id], kind: 'gastos' };
        else state.answer = { type: 'rank', ids: ranking().slice(0, 3).map(p => p.id), kind: 'gastos' };
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
    dialog.classList.remove('records-wide');
    $('#detail-title').textContent = title; $('#detail-body').innerHTML = html;
    if (!dialog.open) dialog.showModal();
    if (resetScroll) dialog.scrollTop = 0;
    $('#detail .close-button').focus({ preventScroll: true });
  }
  const union = () => index.validation.sourceKind === 'annual-api-union';
  const sourceNote = () => `<div class="fixture-note">Dados oficiais da Câmara dos Deputados, versão ${escape(index.snapshotId.slice(0, 12))}. Verificações automáticas não são auditoria do gasto; revisão humana ampla ainda pende.</div>`;
  function sourceBlock(p) {
    return `<section class="detail-section"><div class="source-block">${icon('database')}<div><h3>Fonte oficial</h3><a href="https://dadosabertos.camara.leg.br/howtouse/2023-12-26-dados-ceap.html" target="_blank" rel="noopener noreferrer">Dados da cota parlamentar (CEAP) ↗</a><p>${union() ? 'Arquivo anual CEAP e API da Câmara, combinados porque nenhum está completo sozinho.' : 'Arquivo anual CEAP da Câmara.'} Cada registro leva ao arquivo de origem.</p></div></div></section>${sourceNote()}`;
  }
  function categoryBreakdown(p) {
    const list = categories.map(category => ({ category, total: sum(p.records.filter(r => r.category === category)) })).filter(item => item.total !== 0).sort((x, y) => y.total - x.total);
    const max = Math.max(1, ...list.map(item => Math.abs(item.total)));
    return `<section class="detail-section"><h3>Despesas de ${escape(first(p))}</h3>${list.map(item => `<div class="category-row"><div class="category-head"><span>${escape(label(item.category))}</span><strong>${money(item.total)}</strong></div><small class="source-name">Nome na fonte: ${escape(item.category)}</small><span class="track"><i style="width:${Math.abs(item.total) / max * 100}%;opacity:.7"></i></span></div>`).join('')}<p class="context">Total do período: ${money(totalOf(p))}. ${state.category !== 'Todas' ? `O recorte atual usa apenas ${escape(label(state.category))}.` : ''}</p></section>`;
  }
  function evidence(id, options = {}) {
    const p = person(id), kind = options.kind || state.tab, comparison = options.compare ? person(options.compare) : null;
    if (kind === 'projetos') { showDialog('Projetos de lei', `<p class="records-note">Projetos de lei ainda não foram coletados nesta versão.</p><p>A próxima etapa inclui PL, PLP e PEC, separando autoria principal de coautoria. Nenhum número é mostrado antes da conferência.</p>${sourceNote()}`); return; }
    const amount = value(p, 'gastos'), total = sum(records(p));
    let formula = state.metric === 'mensal' ? `${money(total)} ÷ ${p.months} meses no recorte` : `Soma de ${records(p).length} registros = ${money(total)}`;
    let result = money(amount), resultCaption = state.metric === 'mensal' ? 'por mês no recorte' : 'no período';
    if (comparison) {
      const b = value(comparison, 'gastos'), percent = b ? (amount - b) / b * 100 : null;
      formula = `(${money(amount)} − ${money(b)}) ÷ ${money(b)} × 100`;
      result = percent === null ? 'Indefinido' : `${number(Math.abs(percent))}%`;
      resultCaption = percent === null ? 'O denominador é zero.' : percent === 0 ? 'valores iguais no recorte' : `${percent > 0 ? 'a mais' : 'a menos'} no período`;
    }
    showDialog('Como chegamos nisso?', `<p class="dialog-subtitle">${comparison ? 'A comparação, passo a passo' : 'O cálculo, passo a passo'}</p>
      <section class="evidence-step"><span class="step-number">1</span><div><h3>O que estamos comparando</h3><p>Reembolsos da cota parlamentar (valor líquido) • ${span()}</p><p>${escape(p.name)}${comparison ? ` × ${escape(comparison.name)}` : ''}</p></div></section>
      <section class="evidence-step"><span class="step-number">2</span><div><h3>Quais registros entram</h3><p>${records(p).length} registros oficiais${comparison ? ` + ${records(comparison).length} de ${escape(comparison.name)}` : ''}, ${union() ? 'do arquivo anual e da API da Câmara' : 'do arquivo anual da Câmara'}. ${state.category !== 'Todas' ? `Categoria: ${escape(label(state.category))}.` : ''}</p><p>Identidade ligada ao ID oficial da Câmara ${p.officialId}${comparison ? ` e ${comparison.officialId}` : ''}. Cada valor foi convertido em centavos antes da soma.</p></div></section>
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
  function recordTable(p, month) {
    const items = records(p).filter(r => month === undefined || r.month === month).sort((x, y) => x.month - y.month || y.amount - x.amount);
    const row = r => `<tr class="record-row" data-action="record" data-id="${p.id}" data-record="${escape(r.id)}"><td class="record-when">${monthNames[r.month]}/${state.year}<small>${docLabel(r.raw)}</small></td><td class="record-what"><span class="record-supplier">${escape(r.supplier)}</span><small class="record-meta">${escape(label(r.category))}<span class="record-extra"> · ${monthNames[r.month]}/${state.year} · ${docLabel(r.raw)}</span></small>${r.raw.origin ? `<small class="record-origin">${originLabel(r.raw)}</small>` : ''}</td><td class="record-amount">${money(r.amount)}</td><td class="record-go"><button type="button" class="text-button" aria-label="Conferir registro de ${escape(r.supplier)}: ${docLabel(r.raw)}">Conferir →</button></td></tr>`;
    showDialog(`Registros de ${first(p)}`, `<p class="records-note">${month === undefined ? span() : `${monthNames[month]} ${state.year}`} • ${state.category === 'Todas' ? 'Todas as categorias' : `${escape(label(state.category))} (Nome na fonte: ${escape(state.category)})`} • ${items.length} registros oficiais.</p><div class="calculation-result">${money(sum(items))}<small>Soma exata dos registros abaixo</small></div><div class="action-row"><button class="outline-button" data-action="download" data-id="${p.id}" ${month === undefined ? '' : `data-month="${month}"`}>Baixar CSV</button><button class="outline-button" data-action="evidence" data-id="${p.id}" data-kind="gastos">Voltar ao cálculo</button></div><table class="record-list"><caption class="sr-only">Registros de ${escape(p.name)}</caption><thead><tr><th>Competência / documento</th><th>Fornecedor / categoria</th><th>Valor líquido</th><th><span class="sr-only">Ação</span></th></tr></thead><tbody>${items.map(row).join('') || '<tr><td colspan="4">Nenhum registro neste recorte. Isso não afirma ausência de despesas fora da cobertura.</td></tr>'}</tbody><tfoot><tr><th colspan="2">Total</th><td><strong class="record-list-total">${money(sum(items))}</strong></td><td>${items.length} itens</td></tr></tfoot></table>${sourceNote()}`);
    $('#detail').classList.add('records-wide');
  }
  function recordDetail(p, id) {
    const rec = p.records.find(x => x.id === id); if (!rec) return;
    const r = rec.raw, api = r.origin === 'api';
    showDialog('O registro por trás do valor', `<p class="records-note">${escape(p.name)} · ${months[r.month - 1]} / ${r.year}</p><h3>${escape(r.supplier)}</h3><p>${escape(label(r.category))}</p><p class="context">Nome na fonte: ${escape(r.category)}</p>${r.origin ? `<p class="context">Fonte: ${originLabel(r)}</p>` : ''}${r.documentCents !== null && r.disallowedCents !== null && r.documentCents - r.disallowedCents === r.cents ? `<div class="formula"><span>Documento <b>${money(r.documentCents)}</b></span><span>− Glosa <b>${money(r.disallowedCents)}</b></span><span>= Líquido <b>${money(r.cents)}</b></span></div>` : `<div class="formula" data-equation="none"><span>Valor do documento <b>${money(r.documentCents)}</b></span><span>Glosa <b>${money(r.disallowedCents)}</b></span><span>Valor líquido <b>${money(r.cents)}</b></span></div><p class="context">A fonte não informa todos os campos da conta documento − glosa. O valor líquido é o publicado pela Câmara, sem recálculo.${r.cents < 0 ? ' Valor negativo: ajuste registrado na origem.' : ''}</p>`}<p>${docLabel(r)} · número ${escape(r.documentNumber)}<br>${noDocument(r) ? '<span class="context">Cobrança interna de telefonia da Câmara. O "0" é o identificador de documento publicado na fonte, não um valor: o valor do lançamento é o líquido acima.</span><br>' : ''}Emissão informada: ${day(r.date)}</p><div class="action-row"><a class="outline-button primary" href="${escape(r.source.url)}" target="_blank" rel="noopener noreferrer">${api ? 'Abrir consulta oficial da API' : 'Baixar arquivo oficial'} ↗</a>${r.receipt ? `<a class="outline-button" href="${escape(r.receipt)}" target="_blank" rel="noopener noreferrer">Comprovante informado ↗</a>` : '<span class="context">Comprovante não informado na fonte.</span>'}</div><p class="context">O link do comprovante foi informado pela Câmara; sua disponibilidade e autenticidade não foram auditadas pelo Clareia.</p><details><summary>Rastreabilidade deste item</summary><dl class="trace"><dt>Coleta</dt><dd>${date(r.source.fetchedAt)} (Brasília)</dd><dt>${api ? 'Posição na página da API (base zero)' : 'Posição no CSV, sem cabeçalho (base zero)'}</dt><dd>${r.source.row}</dd><dt>${api ? 'SHA-256 da página preservada' : 'SHA-256 do CSV preservado'}</dt><dd><code>${r.source.sha256}</code></dd><dt>ID desta ocorrência</dt><dd><code>${escape(r.id)}</code></dd></dl></details><button class="text-button" data-action="records" data-id="${p.id}">← Voltar aos registros</button>`);
  }
  function profile(id) {
    const p = person(id), peer = byTotal().find(other => other.id !== id);
    showDialog('Perfil do representante', `<div class="profile-head">${avatar(p)}<div><h3>${escape(p.name)}</h3><p class="context">Deputado(a) federal • ${escape(context(p))} • ID Câmara ${p.officialId}</p>${p.party ? `<p class="context">Partido e UF conforme o cadastro da Câmara consultado em ${date(p.profileFetchedAt)}.</p>` : ''}<p class="context">${p.months} meses publicados nesta versão (${span()})</p></div></div><div class="profile-stats"><button class="profile-stat" data-action="evidence" data-id="${id}" data-kind="gastos"><span>${state.metric === 'mensal' ? 'Reembolso médio / mês' : 'Reembolsos no recorte'}</span><strong>${money(value(p, 'gastos'))} ↗</strong></button><button class="profile-stat" data-action="evidence" data-id="${id}" data-kind="projetos"><span>Projetos</span><strong>${pending}</strong></button></div>${categoryBreakdown(p)}${peer ? `<div class="editorial-follow-up"><span>Continue investigando</span><button data-p-ask="${escape(`Compare ${p.name} e ${peer.name}`)}">Como ${escape(first(p))} se compara a ${escape(first(peer))}? →</button></div>` : ''}<div class="action-row">${peer ? `<button class="outline-button primary" data-action="profile-compare" data-id="${id}">Comparar com ${escape(first(peer))}</button>` : ''}<button class="outline-button" data-action="records" data-id="${id}">Abrir registros</button>${p.sourceUrl ? `<a class="outline-button" href="${escape(p.sourceUrl)}" target="_blank" rel="noopener noreferrer">Cadastro na Câmara ↗</a>` : ''}</div>${sourceNote()}`);
  }
  function methodology() {
    const v = index.validation, audit = index.audit, compare = v.apiComparison;
    showDialog('Fontes e metodologia', `<div class="text-content"><h3>O que somamos</h3><p>O valor líquido publicado pela Câmara, por competência financeira: o campo <code>vlrLiquido</code> do arquivo anual CEAP${union() ? ' e, nos registros que só a API traz, o <code>valorLiquido</code> da API' : ''}. Salário, gabinete e emendas não entram nesta conta.</p><h3>O que conferimos</h3><p>Duas capturas de cada fonte, identidade pelo ID oficial e contas em centavos, reconciliadas com uma segunda soma e com o banco.${audit ? ` Releitura independente do arquivo anual: <b>${audit.status === 'passed' ? 'sem divergências' : 'divergência encontrada'}</b> (${audit.selected} linhas, ${audit.groupsCompared} grupos pessoa/mês/categoria, ${date(audit.checkedAt)}).` : ''}</p>${compare?.paired !== undefined ? `<p>${compare.paired} registros (${money(compare.originCents.both)}) estão nas duas fontes, ${compare.missingInApi} (${money(compare.originCents.annual)}) só no arquivo anual e ${compare.extraInApi} (${money(compare.originCents.api)}) só na API.</p>` : compare?.missingInApi ? `<p>O arquivo anual contém ${compare.annualRecords} lançamentos; a API retornou ${compare.apiRecords}. Os ${compare.missingInApi} adicionais estão incluídos.</p>` : ''}<h3>O que não concluímos</h3><p>Gasto maior não demonstra irregularidade. O recorte não mede qualidade do mandato nem faz nova subtração de restituições. Fornecedor pessoa física aparece sem nome.</p><h3>Limites desta versão</h3><ul>${v.limitations.map(l => `<li>${escape(l)}</li>`).join('')}</ul><h3>Versão</h3><dl class="trace"><dt>Versão</dt><dd><code>${escape(index.snapshotId)}</code></dd><dt>Métrica</dt><dd><code>${escape(index.metric)}</code></dd><dt>Coleta</dt><dd>${date(index.collectedAt)} (Brasília)</dd><dt>Publicação</dt><dd>${date(index.publishedAt)} (Brasília)</dd></dl><p><a href="https://dadosabertos.camara.leg.br/howtouse/2023-12-26-dados-ceap.html" target="_blank" rel="noopener noreferrer">Dicionário oficial da CEAP ↗</a> · <a href="https://dadosabertos.camara.leg.br/swagger/api.html" target="_blank" rel="noopener noreferrer">Documentação da API ↗</a></p></div>`);
  }
  function toast(text) { const el = $('#toast'); el.textContent = text; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2800); }
  async function shareLink() {
    syncURL();
    try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(location.href); toast('Link com a investigação e os filtros copiado.'); }
    catch { showDialog('Compartilhar investigação', `<div class="manual-share"><p>Copie este link. Os filtros e a pergunta serão preservados.</p><label for="share-link">Link da consulta</label><input id="share-link" readonly value="${escape(location.href)}"></div>`); $('#share-link').select(); }
  }
  function closeSuggestions() { $('#suggestions').hidden = true; $('#query').setAttribute('aria-expanded', 'false'); }
  function exportCSV(id, month) {
    const p = person(id), items = records(p).filter(r => month === undefined || month === r.month);
    const whole = month === undefined && state.category === 'Todas';
    const a = document.createElement('a');
    a.href = whole ? `${base}/deputados/${p.officialId}/despesas.csv` : URL.createObjectURL(new Blob([ClareiaView.csv(items.map(r => r.raw))], { type: 'text/csv;charset=utf-8' }));
    a.download = `clareia-${index.snapshotId.slice(0, 12)}-${p.officialId}${month === undefined ? '' : '-' + (month + 1)}.csv`;
    a.click(); if (!whole) setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast(`CSV com ${items.length} registros oficiais preparado.`);
  }
  function closeDialog() { $('#detail').close(); if (dialogTrigger?.isConnected) dialogTrigger.focus({ preventScroll: true }); }
  document.addEventListener('click', event => {
    const target = event.target.closest('[data-action],[data-tab],[data-metric],[data-question]');
    if (!event.target.closest('.search-wrap')) closeSuggestions();
    if (!target) return;
    if (target.tagName === 'A' && !target.href) event.preventDefault();
    if (target.dataset.tab) { state.tab = target.dataset.tab; refresh(); return; }
    if (target.dataset.metric) { state.metric = target.dataset.metric; refresh(); return; }
    if (target.dataset.question) { ask(target.dataset.question); return; }
    const id = target.dataset.id, action = target.dataset.action;
    if (action === 'close') closeDialog();
    else if (action === 'feature') feature(id);
    else if (action === 'evidence') evidence(id, { kind: target.dataset.kind });
    else if (action === 'answer-evidence' && state.answer?.ids?.length) evidence(state.answer.ids[0], { kind: state.answer.kind, compare: state.answer.type === 'compare' ? state.answer.ids[1] : null });
    else if (action === 'records') recordTable(person(id));
    else if (action === 'record') recordDetail(person(id), target.dataset.record);
    else if (action === 'month') recordTable(person(id), Number(target.dataset.month));
    else if (action === 'profile') profile(id);
    else if (action === 'methodology') methodology();
    else if (action === 'focus-search') { $('#query').focus(); $('#query').scrollIntoView({ block: 'center' }); }
    else if (action === 'profile-compare') { const peer = byTotal().find(o => o.id !== id); closeDialog(); ask(`Compare ${person(id).name} e ${peer.name}`); }
    else if (action === 'share') shareLink();
    else if (action === 'reset') { state.uf = 'Brasil'; state.category = 'Todas'; state.metric = 'total'; state.tab = 'gastos'; state.query = ''; state.answer = null; $('#query').value = ''; $('#answer-slot').innerHTML = ''; refresh(); $('#query').focus({ preventScroll: true }); closeSuggestions(); toast('Filtros limpos: Brasil, todas as categorias, valor total.'); }
    else if (action === 'download') exportCSV(id, target.hasAttribute('data-month') ? Number(target.dataset.month) : undefined);
  });
  document.addEventListener('submit', event => { if (event.target.id === 'search-form') { event.preventDefault(); ask($('#query').value); } });
  document.addEventListener('focusin', event => { if (event.target.id === 'query') { $('#suggestions').hidden = false; $('#query').setAttribute('aria-expanded', 'true'); } });
  document.addEventListener('focusout', () => { setTimeout(() => { if (!document.activeElement.closest('.search-wrap')) closeSuggestions(); }, 0); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSuggestions();
    if (event.target.matches('.chart-point') && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    if (event.target.id === 'query' && event.key === 'ArrowDown') { event.preventDefault(); $('#suggestions button')?.focus(); }
  });
  $('#detail').addEventListener('click', event => { if (event.target === $('#detail')) { const box = event.target.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right) closeDialog(); } });
  $('#detail').addEventListener('close', () => { const a = document.activeElement; if (dialogTrigger?.isConnected && (!a || a === document.body || $('#detail').contains(a))) dialogTrigger.focus({ preventScroll: true }); });
  layout();
  markTab(false);
  scopeChip();
  document.fonts?.ready.then(() => markTab(false));
  window.Clareia = { label, context, model, state, all, person, records, sum, money, compact, number, share, shareBase, escape, photo, avatar, icon, ask, evidence, profile, recordTable, recordDetail, showDialog, closeDialog, methodology, toast, refresh, sourceBlock, span, pending, byTotal };
  window.addEventListener('resize', () => markTab(false));
  if (state.query) ask(state.query, false);
})();
