/* Loads the active published version and exposes it in the shape the editorial interface reads. Amounts stay in cents. */
(async () => {
  'use strict';
  const app = document.getElementById('app');
  const json = async url => { const r = await fetch(url); if (!r.ok) throw new Error('Versão indisponível. Nenhum valor foi estimado.'); return r.json(); };
  const load = src => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Falha ao carregar ' + src)); document.body.appendChild(s); });
  try {
    const manifest = await json('/manifest.json'), base = '/' + manifest.base, index = await json(base + '/index.json'), summary = await json(base + '/summary.json');
    // Only an approved monthly coverage can name the party of a past expense; otherwise the current one is labelled as such.
    const partyOfPeriod = (id, current) => {
      if (!summary.coverageId) return current ? `${current} (atual)` : null;
      const months = summary.people.find(p => p.id === id)?.months ?? [], served = months.filter(m => m.partyStatus !== 'not-applicable');
      if (!served.length || served.some(m => m.partyStatus === 'unavailable' || m.partyStatus === 'unknown')) return 'Partido indisponível';
      if (served.some(m => m.partyStatus === 'review' || m.partyStatus === 'conflict')) return 'Partido em revisão';
      const parties = [...new Set(served.flatMap(m => m.party ? [m.party] : m.partyValues))];
      return parties.join(' / ');
    };
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    // Zero is only a fact for someone in office: without confirmed exercise there is nothing to compare.
    const withoutConfirmedExercise = (id, raw) => { if (!summary.coverageId || raw.length) return false; const months = summary.people.find(p => p.id === id)?.months ?? []; return months.length > 0 && months.every(m => !m.exercise || m.exercise === 'unknown' || m.exercise === 'outside'); };
    if (index.validation.testNotice) { const notice = document.createElement('div'); notice.className = 'test-notice'; notice.setAttribute('role', 'note'); notice.textContent = index.validation.testNotice; document.body.prepend(notice); }
    const people = await Promise.all(index.scope.ids.map(async id => {
      const r = await fetch(`${base}/deputados/${id}/despesas.json`);
      if (!r.ok && r.status !== 404) throw new Error('Versão indisponível. Nenhum valor foi estimado.');
      const raw = r.status === 404 ? [] : await r.json(), info = index.people.find(p => p.id === id) || { name: 'ID ' + id };
      const records = raw.map(x => ({ id: x.id, date: x.date, month: x.month - 1, category: x.category, amount: x.cents, supplier: x.supplier, raw: x }));
      return { id: String(id), officialId: id, name: info.name, photo: info.photo ? `${base}/portraits/${id}.jpg` : null, sourceUrl: info.sourceUrl, uf: info.uf ?? null, party: partyOfPeriod(id, info.party ?? null), profileFetchedAt: info.profileFetchedAt, months: index.scope.months.length - (index.validation.heldMonths?.[id] ?? 0), noExercise: withoutConfirmedExercise(id, raw), projects: summary.people.find(p => p.id === id)?.bills?.proposed ?? null, votes: null, records, total: records.reduce((n, x) => n + x.amount, 0) };
    }));
    const byCategory = new Map();
    for (const p of people) for (const r of p.records) byCategory.set(r.category, (byCategory.get(r.category) || 0) + Math.abs(r.amount));
    const categories = [...byCategory].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    const labels = { 'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.': 'Divulgação do mandato', 'PASSAGEM AÉREA - SIGEPA': 'Passagens aéreas', 'LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES': 'Locação de veículos', 'COMBUSTÍVEIS E LUBRIFICANTES.': 'Combustíveis', 'MANUTENÇÃO DE ESCRITÓRIO DE APOIO À ATIVIDADE PARLAMENTAR': 'Escritório de apoio', 'SERVIÇO DE TÁXI, PEDÁGIO E ESTACIONAMENTO': 'Táxi, pedágio e estacionamento', 'HOSPEDAGEM ,EXCETO DO PARLAMENTAR NO DISTRITO FEDERAL.': 'Hospedagem (fora do DF)', 'TELEFONIA': 'Telefonia', 'COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA': 'Auxílio-moradia (complementação)' };
    // Display only: filters, URLs, CSV and search keep the official name.
    const label = category => { if (labels[category]) return labels[category]; const text = category.replace(/\s+,/g, ',').replace(/\.$/, '').trim().toLowerCase(); return text.charAt(0).toUpperCase() + text.slice(1); };
    window.ClareiaData = { coverageApproved: Boolean(summary.coverageId), billsApproved: Boolean(summary.billsId), votesApproved: Boolean(summary.votesId), billsYears: summary.billsYears || [], votesYears: summary.votesYears || [], activitySummary: id => summary.people.find(p => String(p.id) === String(id)), activityUrl: id => `${base}/atividade/${id}.json`, label, dataset: () => people, categories, monthNames, index, base, year: String(index.scope.year), coverage: index.scope.months.map(m => m - 1) };
    await load('/app.js');
    await load('/portal.js');
  } catch (error) {
    app.innerHTML = `<main id="main" class="empty"><h1>Este recorte não está disponível.</h1><p>${String(error.message).replace(/[&<>"']/g, '')}</p><p>Nenhum valor foi estimado.</p></main>`;
  }
})();
