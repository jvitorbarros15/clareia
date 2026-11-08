const assert = require('node:assert/strict');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.APPDATA, 'npm/node_modules/playwright'))); }

const base = process.env.BASE_URL || 'http://127.0.0.1:4174';
const checks = [];
const check = (name, fn) => checks.push({ name, fn });
const text = async locator => (await locator.innerText()).replace(/\s+/g, ' ').trim();
const clean = value => value.replace(/\s+/g, ' ').trim();

let browser;
async function at(width, { height = 900, reducedMotion = 'no-preference' } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion });
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') page.errors.push(message.text()); });
  await page.goto(base);
  await page.waitForSelector('.full-portal');
  return page;
}

async function openRecords(page, personId) {
  await page.locator(`.bar-row[data-id="${personId}"]`).click();
  await page.waitForSelector('#detail[open]');
  await page.locator('#detail [data-action=records]').click();
}

// Expected values come from the published files, independently of the page code.
async function published(page) {
  return page.evaluate(async () => {
    const manifest = await fetch('/manifest.json').then(r => r.json());
    const index = await fetch(`/${manifest.base}/index.json`).then(r => r.json());
    const people = [];
    for (const id of index.scope.ids) {
      const records = await fetch(`/${manifest.base}/deputados/${id}/despesas.json`).then(r => r.json());
      people.push({ id, name: index.people.find(p => p.id === id).name, records });
    }
    const categories = {};
    for (const p of people) for (const r of p.records) categories[r.category] = (categories[r.category] || 0) + r.cents;
    return { people, categories, total: people.reduce((n, p) => n + p.records.reduce((m, r) => m + r.cents, 0), 0) };
  });
}

const NBSP = ' ';
const brl = cents => `${cents < 0 ? '−' : ''}R$${NBSP}${(Math.abs(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brlCompact = cents => Math.abs(cents) >= 100000
  ? `${cents < 0 ? '−' : ''}R$${NBSP}${(Math.abs(cents) / 100000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  : brl(cents);
const percentOf = value => (clean(value).match(/(\d+(?:,\d+)?)%/) || [])[1];

check('no JS errors on load at 1440 and 390', async () => {
  for (const width of [1440, 390]) {
    const page = await at(width);
    await page.waitForTimeout(300);
    assert.deepEqual(page.errors, [], `errors at ${width}`);
    await page.close();
  }
});

for (const reducedMotion of ['no-preference', 'reduce']) {
  // The owner chose to keep the count-up (2026-11-07): it must end on the published value, and assistive tech always gets the final value.
  check(`panorama count-up ends on the published values (${reducedMotion === 'reduce' ? 'reduced motion' : 'motion on'})`, async () => {
    const page = await at(1440, { reducedMotion });
    const data = await published(page);
    const expected = await page.evaluate(cents => window.Clareia.compact(cents), data.total);
    const button = page.locator('[data-p-summary=expenses]');
    assert.match(clean(await button.getAttribute('aria-label')), new RegExp('^' + clean(expected).replace(/[.$]/g, '\\$&')), 'aria-label carries the final value from the start');
    await page.evaluate(() => document.querySelector('#panorama').scrollIntoView());
    if (reducedMotion === 'reduce') assert.equal(await text(button.locator('strong')), clean(expected), 'no count-up under reduced motion');
    await page.waitForTimeout(1000);
    assert.equal(await text(button.locator('strong')), clean(expected), 'count-up ends on the published value');
    await page.close();
  });
}

check('no broken accents', async () => {
  const page = await at(1440);
  const body = await page.evaluate(() => document.body.innerText);
  assert.equal((body.match(/[a-zà-ú]\?[a-zà-ú]/gi) || []).join(', '), '', 'literal ? inside words');
  const details = await page.evaluate(() => [...document.querySelectorAll('[data-detail]')].map(el => el.dataset.detail).filter(d => d.includes('?')));
  assert.deepEqual(details, [], 'literal ? in hover details');
  await page.close();
});

check('one percentage per category', async () => {
  const page = await at(1440);
  await page.evaluate(() => document.querySelector('#despesas').scrollIntoView());
  await page.locator('.donut-legend [data-p-highlight="LOCAÇÃO OU FRETAMENTO DE VEÍCULOS AUTOMOTORES"]').click();
  await page.mouse.move(0, 0);
  const readout = await text(page.locator('.donut-readout'));
  const focus = await text(page.locator('.category-focus'));
  assert.ok(percentOf(readout), `percentage in the donut readout: ${readout}`);
  assert.equal(percentOf(readout), percentOf(focus), `readout "${readout}" vs focus "${focus}"`);
  assert.match(readout, /das despesas positivas/);
  assert.match(focus, /das despesas positivas/);
  await page.close();
});

check('adjustments explained', async () => {
  const page = await at(1440);
  const data = await published(page);
  const negative = Object.values(data.categories).filter(c => c < 0).reduce((n, c) => n + c, 0);
  assert.ok(negative < 0, 'the published sample has a negative category');
  const body = clean(await page.evaluate(() => document.body.innerText));
  assert.ok(body.includes(clean(`Ajustes negativos de ${brl(negative)} não entram nas fatias`)), `adjustment line for ${brl(negative)}`);
  await page.close();
});

check('scope labels follow the coverage', async () => {
  const page = await at(1440);
  const { n, span } = await page.evaluate(() => ({ n: window.Clareia.all().length, span: window.Clareia.span() }));
  const body = clean(await page.evaluate(() => document.body.innerText));
  for (const banned of ['Brasil ·', 'totais anuais', '· 2025 ·', 'jan–Fev']) assert.ok(!body.includes(banned), `body has "${banned}"`);
  assert.ok(body.includes(span), `body has ${span}`);
  assert.ok(body.includes(`Amostra · ${n} deputados`), `body has Amostra · ${n} deputados`);
  await page.close();
});

check('copy', async () => {
  const page = await at(1440);
  const data = await published(page);
  const body = clean(await page.evaluate(() => document.body.innerText));
  assert.ok(body.includes('Votações nominais ainda não foram coletadas'), 'votações copy');
  const negative = Object.values(data.categories).find(c => c < 0);
  assert.ok(negative < 0, 'the published sample has a negative category');
  assert.ok(body.includes(clean(brlCompact(negative))), `negative compact value ${brlCompact(negative)}`);
  await page.locator('#despesas .donut-caption [data-p=spend-evidence]').click();
  await page.waitForSelector('#detail[open]');
  assert.doesNotMatch(await page.locator('#detail-body').innerText(), /fict[íi]ci/i, 'no fictional wording in the evidence dialog');
  await page.close();
});

const settle = page => page.waitForTimeout(500);
const peopleOf = page => page.evaluate(() => window.Clareia.all().map(p => p.id));

check('record amount visible', async () => {
  for (const width of [1440, 390]) {
    const page = await at(width);
    for (const id of await peopleOf(page)) {
      await openRecords(page, id);
      await settle(page);
      const result = await page.evaluate(() => {
        const dialog = document.querySelector('#detail');
        const box = dialog.getBoundingClientRect();
        const amounts = [...dialog.querySelectorAll('.record-amount, tbody tr td:nth-child(3)')];
        const outside = amounts.filter(el => { const r = el.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5; }).length;
        const row = dialog.querySelector('.record-row');
        return {
          amounts: amounts.length, outside, rows: dialog.querySelectorAll('.record-row').length,
          scroll: [dialog.scrollWidth, dialog.clientWidth],
          rowDisplay: row && getComputedStyle(row).display,
          table: !!dialog.querySelector('table') && getComputedStyle(dialog.querySelector('table')).display === 'table',
          total: !!dialog.querySelector('.record-list-total'),
        };
      });
      assert.ok(result.amounts > 0, `amounts at ${width}`);
      assert.equal(result.outside, 0, `amount outside the dialog at ${width} for ${id}`);
      assert.ok(result.scroll[0] <= result.scroll[1], `dialog scroll ${result.scroll} at ${width}`);
      assert.ok(result.rows > 0 && result.rows === result.amounts, `.record-row hooks at ${width}: ${result.rows}/${result.amounts}`);
      assert.ok(result.total, 'record-list-total');
      if (width > 600) assert.ok(result.table, 'desktop keeps a table');
      else assert.notEqual(result.rowDisplay, 'table-row', 'mobile uses stacked rows');
      await page.keyboard.press('Escape');
      await settle(page);
    }
    await page.close();
  }
});

check('records sorted', async () => {
  const page = await at(1440);
  const data = await published(page);
  for (const person of data.people) {
    await openRecords(page, person.id);
    const ids = await page.locator('#detail [data-action=record]').evaluateAll(els => els.map(el => el.dataset.record));
    const byId = new Map(person.records.map(r => [r.id, r]));
    const shown = ids.map(id => byId.get(id));
    assert.ok(shown.every(Boolean), 'every row maps to a published record');
    for (let i = 1; i < shown.length; i++) {
      const a = shown[i - 1], b = shown[i];
      assert.ok(a.month < b.month || (a.month === b.month && a.cents >= b.cents), `${person.name}: row ${i} out of order`);
    }
    await page.keyboard.press('Escape');
    await settle(page);
  }
  await page.close();
});

check('dates formatted', async () => {
  const page = await at(1440);
  const data = await published(page);
  const person = data.people[0];
  await openRecords(page, person.id);
  const id = await page.locator('#detail [data-action=record]').first().evaluate(el => el.dataset.record);
  await page.locator('#detail [data-action=record]').first().click();
  const detail = clean(await page.locator('#detail-body').innerText());
  const published_ = person.records.find(r => r.id === id).date;
  const [y, m, d] = published_.slice(0, 10).split('-');
  assert.ok(detail.includes(`Emissão informada: ${d}/${m}/${y}`), `date ${d}/${m}/${y} in: ${detail.match(/Emissão informada: \S+/)}`);
  assert.doesNotMatch(detail, /T\d\d:\d\d/, 'no ISO time in the detail');
  await page.close();
});

check('keyboard drill', async () => {
  const page = await at(1440);
  const tabTo = async (predicate, limit, label) => {
    for (let i = 0; i < limit; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(predicate)) return;
    }
    assert.fail(`Tab never reached ${label}`);
  };
  await tabTo(() => document.activeElement?.id === 'total', 80, 'the hero value');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#detail[open]');
  await settle(page);
  await tabTo(() => document.activeElement?.dataset?.action === 'records', 10, 'Ver registros');
  await page.keyboard.press('Enter');
  await tabTo(() => !!document.activeElement?.closest('#detail .record-row'), 10, 'the first record row');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#detail-title').textContent === 'O registro por trás do valor');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#detail').open);
  await page.close();
});

check('bar values fit', async () => {
  for (const width of [1440, 390]) {
    const page = await at(width);
    await page.locator('.bar-section').scrollIntoViewIfNeeded();
    const rows = await page.evaluate(() => [...document.querySelectorAll('.bar-section .bar-row')].map(row => {
      const box = row.getBoundingClientRect(), value = row.querySelector('.bar-value').getBoundingClientRect();
      const name = row.querySelector('.bar-name').getBoundingClientRect(), track = row.querySelector('.track').getBoundingClientRect();
      return { overflow: value.right - box.right, sameLine: value.top < name.bottom - 1, track: [track.width, track.height] };
    }));
    assert.ok(rows.length >= 3, 'bar rows');
    for (const row of rows) {
      assert.ok(row.overflow <= 0.5, `value overflows its row by ${row.overflow}px at ${width}`);
      assert.ok(row.track[0] > 20 && row.track[1] > 0, `bar visible at ${width}: ${row.track}`);
      if (width <= 600) assert.ok(!row.sameLine, 'name and value share a line at 390');
    }
    await page.close();
  }
});

check('category labels', async () => {
  const page = await at(1440);
  const data = await published(page);
  const names = Object.keys(data.categories);
  const body = await page.evaluate(() => document.body.innerText);
  for (const name of names) assert.ok(!body.includes(name), `official name on the page: ${name}`);
  const labels = await page.evaluate(names => names.map(n => window.ClareiaData.label(n)), names);
  assert.ok(labels.includes('Passagens aéreas') && labels.includes('Divulgação do mandato'), labels.join(' | '));
  await page.locator('.bar-row').first().click();
  await page.waitForSelector('#detail[open]');
  const dialog = clean(await page.locator('#detail-body').innerText());
  assert.ok(dialog.includes('Nome na fonte: '), 'person dialog shows the official name');
  assert.ok(names.every(n => !dialog.includes(n) || dialog.includes(`Nome na fonte: ${n}`)), 'official name only as "Nome na fonte"');
  await page.keyboard.press('Escape');
  await settle(page);
  await page.locator('.donut-legend [data-p-highlight]').first().click();
  await page.locator('[data-p-drill]').first().click();
  await page.waitForSelector('#detail[open]');
  assert.ok(clean(await page.locator('#detail-body').innerText()).includes('Nome na fonte: '), 'category dialog shows the official name');
  await page.close();
});

check('search matches display labels and official names', async () => {
  const page = await at(1440);
  const category = await page.evaluate(() => { window.Clareia.ask('quem gastou mais com mandato'); return window.Clareia.state.category; });
  assert.equal(category, 'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.', 'a display-label word finds the official category');
  const param = await page.evaluate(() => new URLSearchParams(location.search).get('categoria'));
  assert.equal(param, 'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.', 'URL keeps the official name');
  const official = await page.evaluate(() => { window.Clareia.ask('quem gastou mais com combustiveis'); return window.Clareia.state.category; });
  assert.equal(official, 'COMBUSTÍVEIS E LUBRIFICANTES.', 'official words still match');
  await page.close();
});

check('month chart covers the period', async () => {
  const page = await at(1440);
  const info = await page.evaluate(() => {
    const D = window.ClareiaData, svg = document.querySelector('.linked-lines');
    const rect = el => el.getBoundingClientRect();
    const ticks = [...svg.querySelectorAll('.y-tick')].map(rect), labels = [...svg.querySelectorAll('.line-label')].map(rect);
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const parse = c => (c.match(/\d+/g) || []).slice(0, 3).map(Number);
    const strokes = [...svg.querySelectorAll('path[stroke]')].map(p => parse(getComputedStyle(p).stroke));
    return {
      axis: [...svg.querySelectorAll('text')].map(t => t.textContent.trim()).filter(t => D.monthNames.includes(t)),
      coverage: D.coverage.map(i => D.monthNames[i]),
      sliders: document.querySelectorAll('#linked-from, #linked-to').length,
      ticks: ticks.length, labels: labels.length, clash: labels.some(l => ticks.some(t => hit(l, t))),
      strokes, distance: strokes.length === 2 ? strokes[0].reduce((n, v, i) => n + Math.abs(v - strokes[1][i]), 0) : 0,
    };
  });
  assert.deepEqual(info.axis, info.coverage, 'x-axis shows exactly the coverage months');
  if (info.coverage.length < 3) assert.equal(info.sliders, 0, 'no range input below 3 months');
  assert.ok(info.ticks > 0 && info.labels === 2, `y ticks ${info.ticks}, series labels ${info.labels}`);
  assert.ok(!info.clash, 'series labels intersect y-tick labels');
  assert.ok(info.distance > 200, `series colors too similar: ${JSON.stringify(info.strokes)}`);
  await page.close();
});

check('donut panel', async () => {
  const page = await at(1440);
  await page.evaluate(() => document.querySelector('#despesas').scrollIntoView());
  const slack = await page.evaluate(() => {
    const panel = document.querySelector('.donut-panel'), box = panel.getBoundingClientRect();
    return box.bottom - Math.max(...[...panel.children].map(c => c.getBoundingClientRect().bottom));
  });
  assert.ok(slack <= 32, `donut card has ${Math.round(slack)}px of empty space under its content`);
  assert.ok(clean(await page.locator('.donut-readout').innerText()).includes('Selecione uma fatia ou uma linha da legenda'), 'prompt text');
  assert.equal(await page.locator('.category-path').count(), 0, 'no category link list');
  assert.doesNotMatch(clean(await page.locator('#despesas').innerText()), /Explorar .*↗/, 'no "Explorar … ↗"');
  const legend = page.locator('.donut-legend [data-p-highlight]:not(:disabled)');
  const first = await legend.nth(0).getAttribute('data-p-highlight'), second = await legend.nth(1).getAttribute('data-p-highlight');
  await legend.nth(0).click();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('.donut-legend [aria-pressed=true]').getAttribute('data-p-highlight'), second, 'ArrowDown moves the selection');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.pHighlight), second, 'focus follows');
  const value = await page.evaluate(name => {
    const C = window.Clareia;
    return C.money(C.sum(C.all().flatMap(C.records).filter(r => r.category === name)));
  }, second);
  assert.equal(clean(await page.locator('.donut-hole strong').innerText()), clean(value), 'center shows the exact value');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('.donut-legend [aria-pressed=true]').getAttribute('data-p-highlight'), first, 'ArrowUp moves back');
  const links = clean(await page.locator('#despesas').innerText()).match(/Ver fornecedores de [^→]+→/g) || [];
  assert.equal(links.length, 1, `one supplier link: ${links}`);
  await page.close();
});

check('negative category', async () => {
  const page = await at(1440);
  const data = await published(page);
  const [name, cents] = Object.entries(data.categories).find(([, c]) => c < 0);
  const row = page.locator(`.donut-legend [data-p-highlight="${name}"]`);
  const rowText = clean(await row.innerText());
  assert.ok(rowText.includes(clean(brl(cents))), `exact negative value in the row: ${rowText}`);
  assert.ok(/ajuste/.test(rowText), 'row says ajuste');
  assert.equal(await page.locator(`[data-donut-slice][data-p-highlight="${name}"]`).count(), 0, 'no slice for the negative category');
  await page.close();
});

check('comparison stacks on mobile', async () => {
  const page = await at(390);
  await page.locator('#comparacao').scrollIntoViewIfNeeded();
  const info = await page.evaluate(() => {
    const [a, b] = [...document.querySelectorAll('.compare-person')].map(el => el.getBoundingClientRect());
    const rows = [...document.querySelectorAll('.compare-category')].map(row => {
      const label = row.querySelector('b').getBoundingClientRect();
      return { height: label.height, lines: Math.round(label.height / parseFloat(getComputedStyle(row.querySelector('b')).lineHeight || 16)), right: row.getBoundingClientRect().right };
    });
    return { stacked: b.top >= a.bottom - 1, rows, scroll: document.documentElement.scrollWidth <= innerWidth };
  });
  assert.ok(info.stacked, 'the two people stack');
  assert.ok(info.scroll, 'no horizontal scroll');
  assert.ok(info.rows.every(r => r.lines <= 2 && r.right <= 390), `category labels: ${JSON.stringify(info.rows)}`);
  await page.close();
});

(async () => {
  browser = await chromium.launch({ headless: true });
  let failed = 0;
  try {
    for (const { name, fn } of checks) {
      try { await fn(); console.log(`PASS ${name}`); }
      catch (error) { failed++; console.log(`FAIL ${name}\n  ${String(error.message).split('\n').join('\n  ')}`); }
    }
  } finally { await browser.close(); }
  if (failed) { console.log(`${failed} of ${checks.length} checks failed`); process.exitCode = 1; }
})();
