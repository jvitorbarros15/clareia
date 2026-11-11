/* Loads the active published version and exposes it in the shape the editorial interface reads. Amounts stay in cents. */
(async () => {
  'use strict';
  const app = document.getElementById('app');
  const json = async url => { const r = await fetch(url); if (!r.ok) throw new Error('Versão indisponível. Nenhum valor foi estimado.'); return r.json(); };
  const load = src => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Falha ao carregar ' + src)); document.body.appendChild(s); });
  try {
    const manifest = await json('/manifest.json'), base = '/' + manifest.base, [index, summary, suppliers] = await Promise.all(['index', 'summary', 'fornecedores'].map(name => json(`${base}/${name}.json`)));
    if (suppliers.publicationId !== summary.publicationId) throw new Error('Versão indisponível. Nenhum valor foi estimado.');
    // Only an approved monthly coverage can name the party of a past expense; otherwise the current one is labelled as such.
    const partyOfPeriod = (id, current) => {
      if (!summary.coverageId) return current ? `${current} (atual)` : null;
      const months = summaryOf.get(id)?.months ?? [], served = months.filter(m => m.partyStatus !== 'not-applicable');
      if (!served.length || served.some(m => m.partyStatus === 'unavailable' || m.partyStatus === 'unknown')) return 'Partido indisponível';
      if (served.some(m => m.partyStatus === 'review' || m.partyStatus === 'conflict')) return 'Partido em revisão';
      const parties = [...new Set(served.flatMap(m => m.party ? [m.party] : m.partyValues))];
      return parties.join(' / ');
    };
    const lastConfirmedParty = id => [...(summaryOf.get(id)?.months ?? [])].filter(m => m.partyStatus === 'single' && m.party).sort((a, b) => b.month - a.month)[0]?.party ?? null;
    const monthNames =['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    // Zero is only a fact for someone in office: without confirmed exercise there is nothing to compare.
    const withoutConfirmedExercise = (id, records) => { if (!summary.coverageId || records) return false; const months = summaryOf.get(id)?.months ?? []; return months.length > 0 && months.every(m => !m.exercise || ['unknown', 'outside', 'conflict'].includes(m.exercise)); };
    // Without an approved coverage every published month counts; with one, months outside the mandate do not.
    // Only a month reported outside the mandate drops out, and never one with an expense: a spent month always enters the divisor.
    const exercised = m => m.exercise !== 'outside' || m.records > 0;
    const summaryOf = new Map(summary.people.map(p => [p.id, p]));
    const monthsOf = id => summary.coverageId ? summaryOf.get(id)?.months ?? [] : null;
    const exercisedMonths = id => { const months = monthsOf(id); return months ? months.filter(exercised).length : index.scope.months.length; };
    const servedMonths = id => { const months = monthsOf(id); return Math.max(1, months ? months.filter(m => exercised(m) && !m.held).length : index.scope.months.length - (index.validation.heldMonths?.[id] ?? 0)); };
    if (index.validation.testNotice) { const notice = document.createElement('div'); notice.className = 'test-notice'; notice.setAttribute('role', 'note'); notice.textContent = index.validation.testNotice; document.body.prepend(notice); }
    // Totals per month, category and supplier: individual records are fetched only when someone opens a list.
    const people = index.scope.ids.map(id => {
      const info = index.people.find(p => p.id === id) || { name: 'ID ' + id }, own = summaryOf.get(id);
      const cells = (suppliers.people[id] ?? []).map(([month, category, supplier, cents, count]) => ({ month: month - 1, category: suppliers.categories[category], supplier: suppliers.suppliers[supplier], amount: cents, count }));
      return { id: String(id), officialId: id, name: info.name, photo: info.photo ? `${base}/portraits/${id}.jpg` : null, sourceUrl: info.sourceUrl, uf: info.uf ?? null, party: partyOfPeriod(id, info.party ?? null), partyInReview: partyOfPeriod(id, info.party ?? null) === 'Partido em revisão',lastConfirmedParty: lastConfirmedParty(id),profileFetchedAt: info.profileFetchedAt, months: servedMonths(id), exercisedMonths: exercisedMonths(id), noExercise: withoutConfirmedExercise(id, own?.records ?? 0), heldMonths: (own?.months ?? []).filter(m => m.held).map(m => m.month - 1), projects: own?.bills?.proposed ?? null, approved: own?.bills?.norms ?? null, votes: null, cells, total: own?.cents ?? 0 };
    });
    const byCategory = new Map();
    for (const p of people) for (const r of p.cells) byCategory.set(r.category, (byCategory.get(r.category) || 0) + Math.abs(r.amount));
    const categories = [...byCategory].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const labels = { 'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.': 'Divulgação do mandato', 'PASSAGEM AÉREA - SIGEPA': 'Passagens aéreas', 'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES': 'Locação de veículos', 'COMBUSTÍVEIS E LUBRIFICANTES.': 'Combustíveis', 'MANUTENÇÃO DE ESCRITÓRIO DE APOIO À ATIVIDADE PARLAMENTAR': 'Escritório de apoio', 'SERVIÇO DE TÁXI, PEDÁGIO E ESTACIONAMENTO': 'Táxi, pedágio e estacionamento', 'HOSPEDAGEM ,EXCETO DO PARLAMENTAR NO DISTRITO FEDERAL.': 'Hospedagem (fora do DF)', 'TELEFONIA': 'Telefonia', 'COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA': 'Auxílio-moradia (complementação)', 'PASSAGEM AÉREA - REEMBOLSO': 'Passagens aéreas (compradas pelo deputado)', 'PASSAGEM AÉREA - RPA': 'Passagens aéreas (RPA)', 'PASSAGEM AÉREA - MISSÃO OFICIAL': 'Passagens aéreas (missão oficial)' };
    // Display only: filters, URLs, CSV and search keep the official name.
    const label = category => { if (labels[category]) return labels[category]; const text = category.replace(/\s+,/g, ',').replace(/\.$/, '').trim().toLowerCase(); return text.charAt(0).toUpperCase() + text.slice(1); };
    window.ClareiaData = { coverageApproved: Boolean(summary.coverageId), billsApproved: Boolean(summary.billsId), votesApproved: Boolean(summary.votesId), billsYears: summary.billsYears || [], votesYears: summary.votesYears || [], activitySummary: id => summary.people.find(p => String(p.id) === String(id)), activityUrl: id => `${base}/atividade/${id}.json`, recordsUrl: id => `${base}/deputados/${id}/despesas.json`, label, dataset: () => people, categories, monthNames, index, base, year: String(index.scope.year), coverage: index.scope.months.map(m => m - 1) };
    await load('/app.js');
    await load('/portal.js');
  } catch (error) {
    app.innerHTML = `<main id="main" class="empty"><h1>Este recorte não está disponível.</h1><p>${String(error.message).replace(/[&<>"']/g, '')}</p><p>Nenhum valor foi estimado.</p></main>`;
  }
})();
