/* Loads the active published version and exposes it in the shape the editorial interface reads. Amounts stay in cents. */
(async () => {
  'use strict';
  const app = document.getElementById('app');
  const json = async url => { const r = await fetch(url); if (!r.ok) throw new Error('Versão indisponível. Nenhum valor foi estimado.'); return r.json(); };
  const load = src => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Falha ao carregar ' + src)); document.body.appendChild(s); });
  try {
    const manifest = await json('/manifest.json'), pick = ClareiaView.yearFolder(manifest, new URLSearchParams(location.search).get('ano')), base = '/' + pick.folder, shared = '/' + manifest.base, [index, summary] = await Promise.all(['index', 'summary'].map(name => json(`${base}/${name}.json`)));
    const monthNames =['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    // Without an approved coverage every published month counts; with one, months outside the mandate do not.
    // Only a month reported outside the mandate drops out, and never one with an expense: a spent month always enters the divisor.
    const exercised = m => m.exercise !== 'outside' || m.records > 0 || m.exerciseReview;
    const summaryOf = new Map(summary.people.map(p => [p.id, p]));
    const monthsOf = id => summary.coverageId ? summaryOf.get(id)?.months ?? [] : null;
    const servedMonths = id => { const months = monthsOf(id); return Math.max(1, months ? months.filter(m => exercised(m) && !m.held).length : index.scope.months.length - (index.validation.heldMonths?.[id] ?? 0)); };
    const linkedVersion = new URLSearchParams(location.search).get('v');
    if (linkedVersion && linkedVersion !== shared.split('/').pop()) { const note = document.createElement('div'); note.className = 'test-notice'; note.setAttribute('role', 'note'); note.setAttribute('data-version-note', ''); note.innerHTML = 'Os dados foram atualizados desde este link. <a href="/correcoes">Ver o registro de correções</a>'; document.body.prepend(note); }
    if (index.validation.testNotice) { const notice = document.createElement('div'); notice.className = 'test-notice'; notice.setAttribute('role', 'note'); notice.textContent = index.validation.testNotice; document.body.prepend(notice); }
    // Until fornecedores.json arrives, each person has one cell per category (the published totals). Month and supplier cells replace them in place.
    // Individual records are fetched only when someone opens a list.
    const people = index.scope.ids.map(id => {
      const info = index.people.find(p => p.id === id) || { name: 'ID ' + id }, own = summaryOf.get(id);
      const cells = (own?.categories ?? []).map(c => ({ month: null, category: c.category, supplier: null, amount: c.cents, count: c.records }));
      return { id: String(id), officialId: id, name: info.name, photo: info.photo ? `${shared}/portraits/${id}.jpg` : null, sourceUrl: info.sourceUrl, social: info.social ?? [], uf: info.uf ?? null, ufNote: info.ufNote ?? null, party: own.party, partyNote: own.partyNote, partyInReview: own.partyInReview, lastConfirmedParty: own.lastConfirmedParty, profileFetchedAt: info.profileFetchedAt, months: servedMonths(id), exercisedMonths: own.exercisedMonths, noExercise: own.noExercise, heldMonths: own.heldMonths.map(m => m - 1), exerciseReviewMonths: (own.exerciseReviewMonths ?? []).map(m => m - 1), comparable: own.comparable, use: ClareiaView.ceilingUse(own?.months ?? [], summary.ceiling, Boolean(summary.coverageId)), projects: own?.bills?.proposed ?? null, approved: own?.bills?.norms ?? null, votes: null, cells, total: own?.cents ?? 0 };
    });
    // Same names as the published list; the order is the one of the monthly cells, which only the supplier file carries.
    const categories = [...summary.categories];
    const labels = { 'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.': 'Divulgação do mandato', 'PASSAGEM AÉREA - SIGEPA': 'Passagens aéreas', 'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES': 'Locação de veículos', 'COMBUSTÍVEIS E LUBRIFICANTES.': 'Combustíveis', 'MANUTENÇÃO DE ESCRITÓRIO DE APOIO À ATIVIDADE PARLAMENTAR': 'Escritório de apoio', 'SERVIÇO DE TÁXI, PEDÁGIO E ESTACIONAMENTO': 'Táxi, pedágio e estacionamento', 'HOSPEDAGEM ,EXCETO DO PARLAMENTAR NO DISTRITO FEDERAL.': 'Hospedagem (fora do DF)', 'TELEFONIA': 'Telefonia', 'COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA': 'Auxílio-moradia (complementação)', 'PASSAGEM AÉREA - REEMBOLSO': 'Passagens aéreas (compradas pelo deputado)', 'PASSAGEM AÉREA - RPA': 'Passagens aéreas (requisição da Câmara)', 'PASSAGEM AÉREA - MISSÃO OFICIAL': 'Passagens aéreas (missão oficial)' };
    // Display only: filters, URLs, CSV and search keep the official name.
    const label = category => { if (labels[category]) return labels[category]; const text = category.replace(/\s+,/g, ',').replace(/\.$/, '').trim().toLowerCase(); return text.charAt(0).toUpperCase() + text.slice(1); };
    const VERSION_ERROR = 'Versão indisponível. Nenhum valor foi estimado.';
    const gate = document.createElement('div');
    gate.className = 'supplier-pending';
    gate.innerHTML = '<p class="loading-note" role="status">Carregando gastos por categoria e fornecedor…</p>';
    let suppliersPromise = null, suppliersDone = false;
    const loadSuppliers = () => suppliersPromise ??= json(`${base}/fornecedores.json`).then(suppliers => {
      if (suppliers.publicationId !== summary.publicationId) throw new Error(VERSION_ERROR);
      for (const p of people) p.cells = (suppliers.people[p.officialId] ?? []).map(([month, category, supplier, cents, count]) => ({ month: month - 1, category: suppliers.categories[category], supplier: suppliers.suppliers[supplier], amount: cents, count }));
      const byCategory = new Map();
      for (const p of people) for (const r of p.cells) byCategory.set(r.category, (byCategory.get(r.category) || 0) + Math.abs(r.amount));
      categories.splice(0, categories.length, ...[...byCategory].sort((a, b) => b[1] - a[1]).map(([c]) => c));
      suppliersDone = true;
      gate.remove();
    }).catch(error => {
      gate.innerHTML = `<p class="loading-note" role="alert">Gastos por fornecedor indisponíveis. ${error.message === VERSION_ERROR ? 'Nenhum valor foi estimado.' : 'Tente novamente mais tarde.'}</p>`;
      throw error;
    });
    const provisionalNote = 'pode aumentar: a Câmara aceita comprovantes até 90 dias depois';
    const provisional = ClareiaView.provisionalMonths(index.scope.months, index.scope.year, index.collectedAt).map(m => m - 1);
    window.ClareiaData = { minMonths: summary.minMonths, ceiling: summary.ceiling ?? null, coverageApproved: Boolean(summary.coverageId), billsApproved: Boolean(summary.billsId), votesApproved: Boolean(summary.votesId), billsYears: summary.billsYears || [], votesYears: summary.votesYears || [], activitySummary: id => summary.people.find(p => String(p.id) === String(id)), activityUrl: id => `${shared}/atividade/${id}.json`, recordsUrl: id => `${base}/deputados/${id}/despesas.json`, label, dataset: () => people, categories, monthNames, index, base, sharedBase: shared, year: String(index.scope.year), defaultYear: String(manifest.defaultYear ?? index.scope.year), years: manifest.years ?? [], partial: index.scope.months.length < 12, partialLabel: index.scope.months.length < 12 ? ClareiaView.partialLabel(index.scope.months, index.scope.year) : '', provisional, provisionalNote, ceilingPending: !summary.ceiling && !pick.isDefault, shareImages: Boolean(index.shareImages) && pick.isDefault, senators: Boolean(manifest.senators), yearBase: year => '/' + ClareiaView.yearFolderOf(manifest, year), coverage: index.scope.months.map(m => m - 1), suppliersLoaded: () => suppliersDone, loadSuppliers };
    await load('/app.js');
    document.getElementById('main').append(gate);
    // The supplier file is needed by the sections below the ranking: it starts when they come near the viewport, or at once for a deep link.
    const eager = location.pathname !== '/' || location.hash !== '' || !('IntersectionObserver' in window);
    if (eager) loadSuppliers().catch(() => {});
    else {
      const watch = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { watch.disconnect(); loadSuppliers().catch(() => {}); } }, { rootMargin: '1200px 0px' });
      watch.observe(gate);
      // Without a scroll the sections below never reach the viewport, so the file also starts once the first screen is drawn and the browser is idle.
      (window.requestIdleCallback ?? (run => setTimeout(run, 1500)))(() => loadSuppliers().catch(() => {}), { timeout: 4000 });
    }
    await load('/portal.js');
  } catch (error) {
    app.innerHTML = `<main id="main" class="empty"><h1>Este recorte não está disponível.</h1><p>${String(error.message).replace(/[&<>"']/g, '')}</p><p>Nenhum valor foi estimado.</p></main>`;
  }
})();
