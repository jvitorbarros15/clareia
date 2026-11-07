/* Loads the active published version and exposes it in the shape the editorial interface reads. Amounts stay in cents. */
(async () => {
  'use strict';
  const app = document.getElementById('app');
  const json = async url => { const r = await fetch(url); if (!r.ok) throw new Error('Versão indisponível. Nenhum valor foi estimado.'); return r.json(); };
  const load = src => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Falha ao carregar ' + src)); document.body.appendChild(s); });
  try {
    const manifest = await json('/manifest.json'), base = '/' + manifest.base, index = await json(base + '/index.json');
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const people = await Promise.all(index.scope.ids.map(async id => {
      const r = await fetch(`${base}/deputados/${id}/despesas.json`);
      if (!r.ok && r.status !== 404) throw new Error('Versão indisponível. Nenhum valor foi estimado.');
      const raw = r.status === 404 ? [] : await r.json(), info = index.people.find(p => p.id === id) || { name: 'ID ' + id };
      const records = raw.map(x => ({ id: x.id, date: x.date, month: x.month - 1, category: x.category, amount: x.cents, supplier: x.supplier, raw: x }));
      return { id: String(id), officialId: id, name: info.name, photo: info.photo ? `${base}/portraits/${id}.jpg` : null, sourceUrl: info.sourceUrl, uf: null, months: index.scope.months.length, projects: null, votes: null, records, total: records.reduce((n, x) => n + x.amount, 0) };
    }));
    const byCategory = new Map();
    for (const p of people) for (const r of p.records) byCategory.set(r.category, (byCategory.get(r.category) || 0) + Math.abs(r.amount));
    const categories = [...byCategory].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    window.ClareiaData = { dataset: () => people, categories, monthNames, index, base, year: String(index.scope.year), coverage: index.scope.months.map(m => m - 1) };
    await load('/app.js');
    await load('/portal.js');
  } catch (error) {
    app.innerHTML = `<main id="main" class="empty"><h1>Este recorte não está disponível.</h1><p>${String(error.message).replace(/[&<>"']/g, '')}</p><p>Nenhum valor foi estimado.</p></main>`;
  }
})();
