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
async function at(width, { height = 900, reducedMotion = 'no-preference', search = '', init } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion });
  page.errors = [];
  page.on('pageerror', error => page.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') page.errors.push(message.text()); });
  if (init) await page.addInitScript(init);
  await page.goto(search ? `${base}/${search}` : base);
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
      const meta = index.people.find(p => p.id === id);
      people.push({ id, name: meta.name, uf: meta.uf, records });
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
  const category = await page.evaluate(() => { window.Clareia.ask('quem gastou mais com divulgação'); return window.Clareia.state.category; });
  assert.equal(category, 'DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR.', 'a category term finds the official category');
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
  const data = await published(page);
  const value = brl(data.categories[second]);
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

const searchFor = async (page, q) => { await page.locator('#query').fill(q); await page.locator('#query').press('Enter'); await page.waitForTimeout(400); };

check('search filter is visible', async () => {
  const page = await at(1440);
  await searchFor(page, 'quem gastou mais com passagens');
  const sentence = await text(page.locator('#editorial-feature'));
  assert.match(sentence, /em passagens aéreas/, `Destaque names the filter: ${sentence}`);
  const chip = page.locator('#scope-chip');
  assert.ok(await chip.isVisible(), 'chip visible');
  assert.match(await text(chip), /✕/, 'chip has a close mark');
  assert.match(await text(chip), /Passagens aéreas/);
  await page.evaluate(() => scrollTo(0, 2400));
  await page.waitForTimeout(300);
  const dock = page.locator('.section-dock #dock-filter');
  assert.ok(await dock.isVisible(), 'filter visible in the dock');
  assert.match(await text(dock), /Passagens aéreas/);
  const box = await dock.boundingBox();
  assert.ok(box.y >= 0 && box.y < 120, 'dock filter is inside the sticky dock');
  await searchFor(page, 'quem votou melhor');
  assert.ok(await page.locator('.answer-message').count(), 'out-of-scope answer shown');
  assert.ok(await chip.isHidden(), 'chip cleared');
  assert.ok(await dock.isHidden(), 'dock filter cleared');
  assert.equal(await page.evaluate(() => window.Clareia.state.category), 'Todas', 'filter cleared');
  await page.close();
});

check('filtered mobile', async () => {
  const page = await at(390);
  await searchFor(page, 'quem gastou mais com passagens');
  const data = await published(page);
  const filtered = data.people.flatMap(p => p.records).filter(r => r.category === 'PASSAGEM AÉREA - SIGEPA').reduce((n, r) => n + r.cents, 0);
  assert.ok(filtered > 0, 'the published sample has air-ticket expenses');
  const expected = brlCompact(filtered);
  await page.evaluate(() => document.querySelector('#panorama').scrollIntoView());
  await page.waitForTimeout(1200);
  assert.equal(await text(page.locator('[data-p-summary=expenses] strong')), clean(expected), 'panorama total equals the filtered sum');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
  await page.close();
});

check('short heading hierarchy', async () => {
  const page = await at(1440);
  const found = await page.evaluate(() => {
    const visible = el => el.offsetParent && !el.closest('dialog') && !el.classList.contains('sr-only');
    const pick = (selector, skip) => [...document.querySelectorAll(selector)].filter(el => visible(el) && !el.closest(skip)).map(el => {
      const s = getComputedStyle(el);
      return { text: el.textContent.trim().slice(0, 30), size: parseFloat(s.fontSize), spacing: parseFloat(s.letterSpacing) / parseFloat(s.fontSize) };
    });
    return {
      h1: pick('h1', 'x'),
      h2: pick('main section h2, .full-portal section h2', '.bar-section'),
      h3: pick('main section h3, .full-portal section h3', '.person-name, .directory-person, .timeline-event'),
    };
  });
  assert.ok(found.h2.length >= 5, 'section h2 found');
  assert.ok(found.h3.length >= 5, 'section h3 found');
  assert.equal(new Set(found.h2.map(h => h.size)).size, 1, `one h2 size: ${JSON.stringify(found.h2.map(h => [h.text, h.size]))}`);
  for (const h of found.h2) assert.ok(Math.abs(h.spacing + 0.035) <= 0.005, `h2 letter-spacing ${h.text}: ${h.spacing.toFixed(4)}em`);
  assert.equal(new Set(found.h3.map(h => h.size)).size, 1, `one h3 size: ${JSON.stringify(found.h3.map(h => [h.text, h.size]))}`);
  assert.ok(found.h3[0].size < found.h2[0].size, 'h3 smaller than h2');
  assert.ok(found.h1[0].size >= 90, `hero h1 keeps its editorial size (${found.h1[0].size})`);
  await page.close();
});

for (const width of [1440, 390]) {
  check(`dock indicator on its rule (${width})`, async () => {
    const page = await at(width);
    for (const id of ['despesas', 'atlas']) {
      await page.evaluate(target => document.getElementById(target).scrollIntoView(), id);
      await page.waitForTimeout(700);
      const geometry = await page.evaluate(() => {
        const dock = document.querySelector('.section-dock');
        const link = dock.querySelector('a.current');
        if (!link) return null;
        const after = getComputedStyle(link, '::after');
        const l = link.getBoundingClientRect();
        const d = dock.getBoundingClientRect();
        const top = l.top + parseFloat(after.top);
        const bottom = top + parseFloat(after.height);
        const left = l.left;
        const right = l.left + parseFloat(after.width);
        const hits = [...document.querySelectorAll('main *, .full-portal *')].filter(el => {
          if (dock.contains(el) || el.contains(dock)) return false;
          const r = el.getBoundingClientRect();
          return r.width && r.height && r.top >= d.bottom - 0.5 && r.left < right && r.right > left && r.top < bottom - 0.5;
        }).map(el => el.tagName + '.' + el.className);
        return { bottom, dockBottom: d.bottom, hits };
      });
      assert.ok(geometry, `${id}: current dock link exists`);
      assert.ok(Math.abs(geometry.bottom - geometry.dockBottom) <= 1, `${id}: indicator bottom ${geometry.bottom} vs dock bottom ${geometry.dockBottom}`);
      assert.deepEqual(geometry.hits, [], `${id}: indicator overlaps content below the dock`);
    }
    await page.close();
  });
}

check('ranking tabs aligned', async () => {
  for (const width of [1440, 390]) {
    const page = await at(width);
    const gap = await page.evaluate(() => {
      const tabs = document.querySelector('.editorial-rank .tabs');
      const first = tabs.querySelector('button');
      const node = [...first.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()) || first;
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().left - tabs.getBoundingClientRect().left;
    });
    assert.ok(Math.abs(gap) <= 1, `first tab text offset ${gap}px at ${width}`);
    await page.close();
  }
});

const reach = `(() => {
  const TARGET = 'button,a[href],summary,select,input,textarea,[role=button],[data-action],[data-p],.uf-tile';
  const name = el => (el.getAttribute('aria-label') || el.textContent || String(el.className.baseVal ?? el.className) || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 40);
  return (el, label) => {
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const r = [...(el.querySelector('.chart-dot') || el).getClientRects()].sort((a, b) => b.width - a.width)[0] || el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const edges = [[0, -21], [21, 0], [0, 21], [-21, 0]], corners = [[-21, -21], [21, -21], [21, 21], [-21, 21]];
    const pts = (el.matches('.uf-tile') ? edges : [...edges, ...corners]).map(([dx, dy]) => [cx + dx, cy + dy]);
    const fail = [], neighbours = new Set();
    const gap = (a, b) => Math.max(0, a.left - b.right, b.left - a.right, a.top - b.bottom, b.top - a.bottom);
    const near = [...document.querySelectorAll(TARGET)].filter(o => o !== el && !el.contains(o) && !o.contains(el) && gap(r, o.getBoundingClientRect()) < 44 && o.getBoundingClientRect().width).map(o => ({ o, b: o.getBoundingClientRect() }));
    for (const [x, y] of pts) {
      const hit = document.elementFromPoint(x, y);
      if (hit && (el === hit || el.contains(hit))) continue;
      const other = hit && hit.closest(TARGET);
      const hitNear = near.find(n => n.o === other);
      // Not clickable here: excused only when the point really hits another target closer than 44px, and named in the report.
      if (hitNear) { neighbours.add(name(other)); continue; }
      fail.push(Math.round(x - cx) + ',' + Math.round(y - cy) + ' hits ' + (hit ? hit.tagName + '.' + String(hit.className.baseVal ?? hit.className).slice(0, 30) : 'nothing'));
    }
    return { label, name: name(el), fail, neighbours: [...neighbours] };
  };
})()`;

// Samples the corners and edge midpoints of a 44x44 box centred on each target; a hit on another target closer than 44px is an exception, listed by name.
async function measureTargets(page, selectors) {
  const report = { fails: [], exceptions: [] };
  for (const [label, selector] of selectors) {
    const results = await page.evaluate(({ selector, label, reach }) => {
      const measure = eval(reach);
      return [...document.querySelectorAll(selector)].filter(el => { const r = el.getBoundingClientRect(); return (r.width || r.height) && getComputedStyle(el).visibility !== 'hidden' && !el.disabled; }).map(el => measure(el, label));
    }, { selector, label, reach });
    if (!results.length) report.fails.push(`${label}: none found`);
    for (const r of results) {
      if (r.fail.length) report.fails.push(`${label} "${r.name}": ${r.fail.join('; ')}`);
      else if (r.neighbours.length) report.exceptions.push(`${label} "${r.name}" shares its box with ${r.neighbours.join(', ')}`);
    }
  }
  return report;
}

for (const width of [1440, 768, 390]) {
  check(`real 44px targets (${width})`, async () => {
    const page = await at(width);
    await page.waitForTimeout(1200);
    const main = await measureTargets(page, [
      ['header search', '.header-search'], ['value button', '.value-button'], ['footer links', '.footer-links a, .footer-links button'],
      ['swap', '.swap-button'], ['Visão inicial', '[data-p=map-reset]'], ['chart point', '.chart-point'], ['legend row', '.donut-legend [data-p-highlight]'],
      ['panorama stat', '[data-p-summary]'], ['month bar', '.p-mini-bars button'], ['map tile', '.uf-tile'],
    ]);
    await page.locator('.bar-row').first().click();
    await page.waitForSelector('#detail[open]');
    await page.locator('#detail [data-action=records]').click();
    await page.waitForTimeout(300);
    const list = await measureTargets(page, [['dialog close', '#detail .close-button'], ['record Conferir', '#detail .record-go button'], ['dialog buttons', '#detail .action-row button']]);
    await page.locator('#detail .record-row').first().click();
    await page.waitForTimeout(300);
    const detail = await measureTargets(page, [
      ['dialog close', '#detail .close-button'], ['dialog buttons', '#detail .action-row a, #detail .dialog-body > .text-button'], ['Rastreabilidade', '#detail summary'],
    ]);
    const dialog = { fails: [...list.fails, ...detail.fails], exceptions: [...list.exceptions, ...detail.exceptions] };
    for (const e of [...main.exceptions, ...dialog.exceptions]) console.log(`  EXCEPTION (${width}) ${e}`);
    assert.deepEqual([...main.fails, ...dialog.fails], [], `targets whose 44x44 box is not clickable at ${width}`);
    await page.close();
  });
}

check('no "reembols" in the interface', async () => {
  for (const width of [1440, 390]) {
    const page = await at(width);
    const scan = () => page.evaluate(() => {
      const labels = [...document.querySelectorAll('[aria-label],[title],[alt],[placeholder]')].flatMap(e => ['aria-label', 'title', 'alt', 'placeholder'].map(a => e.getAttribute(a) || ''));
      return [document.body.innerText, ...labels, ...[...document.querySelectorAll('dialog')].map(d => d.textContent)].join('\n');
    });
    const found = [];
    const look = async step => { if (/reembols/i.test(await scan())) found.push(step); };
    await look('page');
    await page.locator('.bar-row').first().click(); await page.waitForSelector('#detail[open]'); await look('evidence');
    await page.locator('#detail [data-action=records]').click(); await look('records');
    await page.keyboard.press('Escape');
    await page.locator('.portrait-button').first().click(); await page.waitForSelector('#detail[open]'); await look('profile');
    await page.keyboard.press('Escape');
    for (const sel of ['[data-p-summary=expenses]', '#despesas [data-p=spend-evidence]', '[data-p=map-evidence]', '[data-p=compare-evidence]', '[data-action=methodology]']) {
      await page.locator(sel).first().click(); await page.waitForSelector('#detail[open]'); await look(sel); await page.keyboard.press('Escape');
    }
    await page.locator('#despesas .donut-legend [data-p-highlight]').first().click();
    await page.locator('#despesas [data-p-drill]').click(); await look('supplier dialog'); await page.keyboard.press('Escape');
    await page.locator('#map-metric').selectOption('average'); await look('map average');
    assert.deepEqual(found, [], `"reembols" found at ${width}`);
    await page.close();
  }
});

check('panorama dialog reuses the record rows', async () => {
  const page = await at(1440);
  const data = await published(page);
  await page.locator('[data-p-summary=expenses]').click();
  await page.waitForSelector('#detail[open]');
  const info = await page.evaluate(() => {
    const d = document.querySelector('#detail');
    const rows = [...d.querySelectorAll('.record-row')].map(r => ({
      when: r.querySelector('.record-when').childNodes[0].textContent.trim(), amount: r.querySelector('.record-amount').textContent,
      supplier: !!r.querySelector('.record-supplier'), meta: !!r.querySelector('.record-meta'), go: !!r.querySelector('.record-go button'),
      hasId: Boolean(r.dataset.record) && r.textContent.includes(r.dataset.record),
    }));
    return { rows, note: d.querySelector('.records-note').textContent.trim(), text: d.innerText, months: window.ClareiaData.monthNames };
  });
  assert.equal(info.rows.length, data.people.reduce((n, p) => n + p.records.length, 0), 'one row per published record');
  assert.ok(info.rows.every(r => r.supplier && r.meta && r.go), 'supplier, category/document line and Conferir on every row');
  assert.ok(!info.rows.some(r => r.hasId), 'no record id as visible text');
  assert.doesNotMatch(info.text, /[0-9a-f]{24,}/i, 'no hash in the dialog text');
  assert.doesNotMatch(info.note, /[·•\-–]\s*$/, `scope line ends with a separator: ${info.note}`);
  const cents = s => Math.round(parseFloat(s.replace(/[^\d,\-−]/g, '').replace('−', '-').replace('.', '').replace(',', '.')) * 100);
  const order = info.rows.map(r => [info.months.indexOf(r.when.split('/')[0]), cents(r.amount)]);
  for (let i = 1; i < order.length; i++) assert.ok(order[i][0] > order[i - 1][0] || (order[i][0] === order[i - 1][0] && order[i][1] <= order[i - 1][1]), `default record ordering broken at row ${i}`);
  await page.locator('#detail .record-row').first().click();
  assert.match(await text(page.locator('#detail-title')), /registro/i, 'a row opens the record detail');
  await page.close();
});

check('supplier note names companies and individuals', async () => {
  const page = await at(1440);
  const body = clean(await page.evaluate(() => document.body.innerText));
  assert.ok(body.includes("Fornecedores com CNPJ aparecem pela razão social, que pode ser o nome de um empresário individual. Pessoa física sem CNPJ aparece como 'Fornecedor pessoa física'."), 'N5 note');
  assert.ok(!body.includes('Fornecedor pessoa física aparece sem nome'), 'old note gone');
  await page.close();
});

check('per-month bars label months and values', async () => {
  for (const width of [1440, 390]) {
    const page = await at(width);
    const data = await published(page);
    const info = await page.evaluate(() => {
      const D = window.ClareiaData;
      return { coverage: D.coverage, names: D.monthNames, bars: [...document.querySelectorAll('.p-mini-bars button')].map(b => {
        const small = b.querySelector('small'), bar = b.querySelector(':scope > span:not(.bar-value)'), value = b.querySelector('.bar-value');
        return { label: small && small.textContent.trim(), value: value && value.textContent.replace(/\s+/g, ' ').trim(), valueBottom: value && value.getBoundingClientRect().bottom, barTop: bar && bar.getBoundingClientRect().top };
      }) };
    });
    assert.equal(info.bars.length, info.coverage.length, 'one bar per covered month');
    info.bars.forEach((b, k) => {
      assert.equal(b.label, info.names[info.coverage[k]], 'label comes from the data (Jan/Fev)');
      const month = data.people.flatMap(p => p.records).filter(r => r.month === info.coverage[k] + 1).reduce((n, r) => n + r.cents, 0);
      assert.equal(b.value, clean(brlCompact(month)), `value of ${b.label} equals the published records`);
      assert.ok(b.valueBottom <= b.barTop + 0.5, 'value sits above the bar');
    });
    await page.close();
  }
});

check('record detail spacing and buttons', async () => {
  const page = await at(1440);
  const styles = () => page.evaluate(() => [...document.querySelectorAll('#detail .action-row a, #detail .action-row button')].map(b => { const s = getComputedStyle(b); return { primary: b.classList.contains('primary'), line: s.textDecorationLine, bg: s.backgroundColor, border: s.borderTopColor, color: s.color, radius: s.borderTopLeftRadius, text: b.textContent.trim() }; }));
  await openRecords(page, (await peopleOf(page))[0]);
  const fromList = await styles();
  await page.locator('#detail .record-row').first().click();
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const row = document.querySelector('#detail .action-row'), notice = row.nextElementSibling;
    return { gap: notice.getBoundingClientRect().top - row.getBoundingClientRect().bottom, notice: notice.textContent.slice(0, 30) };
  });
  const buttons = [...fromList, ...await styles()];
  assert.ok(info.gap >= 8 - 0.5 && info.gap <= 8.5, `gap before the notice is ${info.gap}px: ${info.notice}`);
  assert.ok(buttons.every(b => !b.line.includes('underline')), `underlined button: ${JSON.stringify(buttons.filter(b => b.line.includes('underline')))}`);
  const secondary = buttons.filter(b => !b.primary);
  assert.ok(secondary.length >= 3, 'secondary buttons found');
  assert.equal(new Set(secondary.map(b => [b.bg, b.border, b.color, b.radius].join('|'))).size, 1, `one secondary button style: ${JSON.stringify(secondary)}`);
  await page.close();
});

check('Ver registros is the solid primary', async () => {
  const page = await at(1440);
  await page.locator('.bar-row').first().click();
  await page.waitForSelector('#detail[open]');
  const s = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#detail [data-action=records]')); return { bg: c.backgroundColor, color: c.color }; });
  assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(s.bg), `Ver registros background is ${s.bg}`);
  assert.notEqual(s.bg, s.color, 'text differs from the fill');
  await page.close();
});

check('out-of-scope search brings the answer into view (390)', async () => {
  const page = await at(390);
  await searchFor(page, 'quem votou melhor');
  await page.waitForTimeout(900);
  const box = await page.evaluate(() => { const r = document.querySelector('.answer-message').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
  assert.ok(box.top >= 0 && box.bottom <= box.h, `answer at ${Math.round(box.top)}-${Math.round(box.bottom)} of ${box.h}`);
  await page.close();
});

check('arrow keys move the donut legend selection', async () => {
  const page = await at(1440);
  const rows = page.locator('#despesas .donut-legend [data-p-highlight]');
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#despesas .donut-legend [aria-pressed=true]').count(), 1);
  const first = await page.locator('#despesas .donut-legend [aria-pressed=true]').getAttribute('data-p-highlight');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  const second = await page.locator('#despesas .donut-legend [aria-pressed=true]').getAttribute('data-p-highlight');
  assert.notEqual(first, second, 'selection moved');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.pHighlight), second, 'focus follows the selection');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#despesas .donut-legend [aria-pressed=true]').getAttribute('data-p-highlight'), first, 'ArrowUp goes back');
  await page.close();
});


check('low-res portrait', async () => {
  for (const width of [1440, 390]) {
    const page = await at(width);
    await page.evaluate(() => document.querySelectorAll('.photo img').forEach(img => { img.loading = 'eager'; }));
    await page.waitForFunction(() => [...document.querySelectorAll('.photo img')].every(img => img.complete));
    const imgs = await page.evaluate(() => [...document.querySelectorAll('.photo img')].filter(img => img.offsetParent).map(img => {
      const r = img.getBoundingClientRect(), frame = img.closest('.photo').getBoundingClientRect(), fit = getComputedStyle(img).objectFit;
      const scale = fit === 'cover' ? Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight) : r.width / img.naturalWidth;
      return { src: img.getAttribute('src').slice(-30), natural: img.naturalWidth, scale, centered: Math.abs((r.left + r.width / 2) - (frame.left + frame.width / 2)) <= 1 };
    }));
    assert.ok(imgs.length > 0, 'portraits rendered');
    const low = imgs.filter(i => i.natural < 200);
    assert.ok(low.length > 0, `a portrait under 200 px natural width exists at ${width}: ${JSON.stringify(imgs.map(i => i.natural))}`);
    for (const i of low) { assert.ok(i.scale <= 1.5 + 0.01, `${i.src} (${i.natural}px) upscaled ${i.scale.toFixed(2)}x at ${width}`); assert.ok(i.centered, `${i.src} centered at ${width}`); }
    await page.close();
  }
});

check('logo is vector', async () => {
  const page = await at(1440);
  const logos = await page.evaluate(() => ['.site-header .logo', '.footer .logo'].map(sel => {
    const logo = document.querySelector(sel);
    const all = [logo, ...logo.querySelectorAll('*')];
    return {
      sel,
      inlineSvg: !!logo.querySelector('svg[aria-label="Clareia"]'),
      textNodes: logo.querySelectorAll('text').length + (logo.textContent.trim() ? 1 : 0),
      arial: all.filter(el => /arial/i.test(getComputedStyle(el).fontFamily)).map(el => el.tagName),
    };
  }));
  for (const l of logos) {
    assert.ok(l.inlineSvg, `${l.sel}: inline svg with aria-label="Clareia"`);
    assert.equal(l.textNodes, 0, `${l.sel}: wordmark is outlines, not text`);
    assert.deepEqual(l.arial, [], `${l.sel}: no element computes Arial`);
  }
  await page.close();
});

check('map starts neutral', async () => {
  for (const width of [1440, 390]) {
    const page = await at(width);
    const data = await published(page);
    const state = await page.evaluate(async () => {
      const manifest = await fetch('/manifest.json').then(r => r.json());
      const index = await fetch(`/${manifest.base}/index.json`).then(r => r.json());
      return {
        uf: Object.fromEntries(index.people.map(p => [p.id, p.uf])),
        selected: document.querySelectorAll('.uf-tile.selected, .uf-tile[aria-pressed=true]').length,
        detail: document.querySelector('#atlas-detail').innerText.replace(/\s+/g, ' '),
        tiles: [...document.querySelectorAll('.uf-tile.has-data')].map(t => ({ uf: t.dataset.pUf, lines: [...t.querySelectorAll('text')].map(x => x.textContent.trim()) })),
      };
    });
    assert.equal(state.selected, 0, `no tile selected on load at ${width}`);
    assert.match(state.detail, /Escolha um estado/, `prompt at ${width}`);
    const byUf = {};
    for (const p of data.people) byUf[state.uf[p.id]] = (byUf[state.uf[p.id]] || 0) + p.records.reduce((n, r) => n + r.cents, 0);
    assert.ok(state.tiles.length > 0, 'tiles with data exist');
    for (const t of state.tiles) {
      const expected = clean(brlCompact(byUf[t.uf])).replace(/^R\$ /, '');
      assert.deepEqual(t.lines, [t.uf, expected], `${t.uf} tile shows its compact value at ${width}`);
    }
    await page.locator('[data-p-uf=SP]').click();
    assert.equal(await page.locator('.uf-tile.selected').count(), 1, 'clicking a tile selects it');
    await page.locator('[data-p=map-reset]').click();
    assert.equal(await page.locator('.uf-tile.selected').count(), 0, 'reset returns to neutral');
    assert.match(await text(page.locator('#atlas-detail')), /Escolha um estado/);
    await page.close();
  }
});

check('launcher at 390', async () => {
  const page = await at(390);
  const shown = () => page.evaluate(() => { const l = document.querySelector('.assistant-launcher'), s = getComputedStyle(l); return s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05; });
  for (const y of [0, 150, 300, 450, 600]) {
    await page.evaluate(y => scrollTo(0, y), y);
    await page.waitForTimeout(400);
    const inView = await page.evaluate(() => { const r = document.querySelector('#query').getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    if (inView) assert.ok(!(await shown()), `launcher visible with #query in view at scroll ${y}`);
  }
  await page.evaluate(() => scrollTo(0, 2400));
  await page.waitForTimeout(400);
  assert.ok(await shown(), 'launcher visible far below the search');
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(400);
  const overlap = await page.evaluate(() => {
    const note = document.querySelector('.editorial-handwritten').getBoundingClientRect();
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    return ['.hero-portrait .photo', '.section-dock'].map(s => [s, document.querySelector(s)]).filter(([, el]) => el && hit(note, el.getBoundingClientRect())).map(([s]) => s);
  });
  assert.deepEqual(overlap, [], 'the handwritten note overlaps');
  await page.close();
});

check('hero value affordance', async () => {
  const page = await at(1440);
  const underline = () => page.evaluate(() => getComputedStyle(document.querySelector('#total')).textDecorationLine);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#total')).cursor), 'pointer');
  await page.locator('#total').hover();
  await page.waitForTimeout(250);
  assert.match(await underline(), /underline/, 'underline on hover');
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  await page.keyboard.press('Tab');
  await page.evaluate(() => document.querySelector('#total').focus());
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'total');
  await page.waitForTimeout(250);
  assert.match(await underline(), /underline/, 'underline on focus');
  await page.close();
});

check('closing band', async () => {
  const page = await at(1440);
  const band = await page.evaluate(() => {
    const el = document.querySelector('#perguntar');
    const b = el.getBoundingClientRect();
    const rects = [...el.querySelectorAll('h2, p, button, h3, a')].map(e => e.getBoundingClientRect()).filter(r => r.width && r.height);
    return { text: el.innerText, left: b.left, right: b.right, rects: rects.map(r => ({ left: r.left, right: r.right })) };
  });
  assert.doesNotMatch(band.text, /\bAPI\b/, 'no "API" in the closing copy');
  const mid = (band.left + band.right) / 2, half = (band.right - band.left) / 2;
  const rightHalf = band.rects.filter(r => r.left >= mid - 1);
  assert.ok(rightHalf.length > 0, 'right half has content');
  assert.ok(Math.max(...rightHalf.map(r => r.right)) >= band.right - 0.12 * half, 'right half content reaches the band edge');
  assert.ok(Math.min(...band.rects.map(r => r.left)) < mid, 'left half has content');
  await page.close();
});

check('mobile comparison', async () => {
  const page = await at(390);
  const m = await page.evaluate(() => {
    const board = document.querySelector('.comparison-board');
    const people = [...board.querySelectorAll('.compare-person')].map(e => e.getBoundingClientRect());
    const lines = el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map(r => Math.round(r.top / 4))).size;
    };
    const lineCount = el => {
      const cs = getComputedStyle(el);
      const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.25 : parseFloat(cs.lineHeight);
      return Math.round(el.getBoundingClientRect().height / lh);
    };
    const section = document.querySelector('#comparacao').getBoundingClientRect();
    const cats = [...document.querySelectorAll('.compare-category')];
    const overflow = cats.flatMap(c => [...c.children].filter(k => k.getBoundingClientRect().right > section.right + 0.5).map(k => k.textContent.trim()));
    return {
      stacked: people[1].top >= people[0].bottom - 1,
      totals: [...board.querySelectorAll('.compare-total')].map(e => ({ text: e.innerText.replace(/\s+/g, ' '), lines: lines(e) })),
      labels: cats.map(c => ({ text: c.querySelector('b').innerText, lines: lineCount(c.querySelector('b')) })),
      overflow,
      scroll: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  assert.ok(m.stacked, 'the two people stack');
  for (const t of m.totals) assert.equal(t.lines, 1, `arrow stays on the value line: ${t.text}`);
  for (const l of m.labels) assert.ok(l.lines <= 2, `category label ≤ 2 lines: ${l.text} (${l.lines})`);
  assert.deepEqual(m.overflow, [], 'category values stay inside the section');
  assert.ok(m.scroll <= 0, 'no horizontal scroll');
  await page.close();
});


const AUX = 'COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA';
const sumCents = (data, name, category, month) => data.people.find(p => p.name === name).records
  .filter(r => (!category || r.category === category) && (!month || r.month === month)).reduce((n, r) => n + r.cents, 0);
const pickPair = async (page, data, a, b) => {
  await page.locator('#comparacao').scrollIntoViewIfNeeded();
  await page.locator('#compare-a').selectOption(String(data.people.find(p => p.name === a).id));
  await page.locator('#compare-b').selectOption(String(data.people.find(p => p.name === b).id));
};

check('search category terms do not over-match', async () => {
  const page = await at(1440);
  const data = await published(page);
  const names = Object.keys(data.categories);
  const norm = v => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const find = word => names.find(n => norm(n).includes(word));
  const category = q => page.evaluate(q => { window.Clareia.ask(q); return window.Clareia.state.category; }, q);
  for (const q of ['Quem mais gastou na cota parlamentar?', 'Quem mais gastou como deputado federal?', 'Quem mais gastou no mandato?', 'Quem mais gastou no distrito federal?', 'Quem mais gastou com apoio parlamentar?', 'Quem mais gastou com atividade parlamentar, exceto viagens?']) {
    assert.equal(await category(q), 'Todas', `"${q}" must not filter a category`);
  }
  for (const [q, word] of [['Quem mais gastou com divulgação?', 'divulga'], ['Quem mais gastou com passagens?', 'passagem'], ['Quem mais gastou com combustíveis?', 'combust'], ['Quem mais gastou com hospedagem?', 'hospedagem'], ['Quem mais gastou com telefonia?', 'telefonia'], ['Quem mais gastou com aluguel de veículos?', 'locacao'], ['Quem mais gastou com táxi?', 'taxi'], ['Quem mais gastou com escritório?', 'escritorio'], ['Quem mais gastou com auxílio-moradia?', 'moradia']]) {
    assert.equal(await category(q), find(word), `"${q}" finds the ${word} category`);
  }
  await page.close();
});

check('comparison with a zero or negative base has no percentage', async () => {
  const page = await at(1440, { search: `?categoria=${encodeURIComponent(AUX)}` });
  const data = await published(page);
  const tiririca = sumCents(data, 'Tiririca', AUX), acacio = sumCents(data, 'Acácio Favacho', AUX);
  assert.ok(tiririca < 0 && acacio === 0, 'the published sample has a negative and a zero total in the category');
  const diff = Math.abs(tiririca - acacio);
  await pickPair(page, data, 'Tiririca', 'Acácio Favacho');
  let center = clean(await page.locator('.comparison-center').innerText());
  assert.ok(!center.includes('%'), `no percent when the base is zero: ${center}`);
  assert.ok(center.includes(clean(brlCompact(diff))), `difference ${brlCompact(diff)} in: ${center}`);
  assert.match(center, /a menos para Tiririca do que para Acácio/, `direction a < b: ${center}`);
  await page.locator('[data-p=swap]').click();
  center = clean(await page.locator('.comparison-center').innerText());
  assert.ok(!center.includes('%'), `no percent after swap (base is negative): ${center}`);
  assert.ok(center.includes(clean(brlCompact(diff))), `difference after swap: ${center}`);
  assert.match(center, /a mais para Acácio do que para Tiririca/, `direction a > b after swap: ${center}`);
  await page.locator('[data-p=compare-evidence]').click();
  await page.waitForSelector('#detail[open]');
  let result = clean(await page.locator('#detail .calculation-result').innerText());
  assert.ok(!result.includes('%') && result.includes(clean(brl(diff))), `evidence result: ${result}`);
  await page.keyboard.press('Escape');
  for (const [q, direction] of [['Compare Tiririca e Acácio com auxílio-moradia', 'menos'], ['Compare Acácio e Tiririca com auxílio-moradia', 'mais']]) {
    await page.evaluate(q => window.Clareia.ask(q, false), q);
    const summary = clean(await page.locator('.answer-summary').innerText());
    assert.ok(!summary.includes('%') && !/100/.test(summary), `answer without percent: ${summary}`);
    assert.ok(summary.includes(clean(brl(diff))), `answer shows the difference: ${summary}`);
    assert.ok(new RegExp(`\\b${direction}\\b`).test(summary), `answer direction "${direction}": ${summary}`);
    await page.locator('[data-action=answer-evidence]').click();
    await page.waitForSelector('#detail[open]');
    result = clean(await page.locator('#detail .calculation-result').innerText());
    assert.ok(!result.includes('%') && result.includes(clean(brl(diff))), `answer evidence result: ${result}`);
    await page.keyboard.press('Escape');
  }
  await page.close();
});

check('comparison with a positive base keeps its percentage', async () => {
  const page = await at(1440);
  const data = await published(page);
  const a = sumCents(data, 'Acácio Favacho'), b = sumCents(data, 'Tiririca');
  await pickPair(page, data, 'Acácio Favacho', 'Tiririca');
  const expected = (Math.abs(a - b) / b * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const center = clean(await page.locator('.comparison-center').innerText());
  assert.ok(center.includes(`${expected}%`) && /a mais para Acácio/.test(center), `${expected}% in: ${center}`);
  await page.close();
});

check('month click scopes every label to the selected month', async () => {
  const page = await at(1440);
  const data = await published(page);
  const jan = data.people.reduce((n, p) => n + sumCents(data, p.name, null, 1), 0);
  await page.locator('#despesas [data-p-month="1"]').click();
  const section = clean(await page.locator('#despesas').innerText());
  assert.ok(!/Jan–Jan/.test(section), 'no "Jan–Jan"');
  assert.ok(!section.includes('Jan–Fev'), `full period next to January-only data: ${section.match(/.{30}Jan–Fev.{10}/)}`);
  assert.equal(clean(await page.locator('#despesas .range-heading h3').innerText()), 'Por mês · Jan 2025');
  assert.equal(clean(await page.locator('.donut-hole span').innerText()), 'Jan 2025');
  assert.equal(clean(await page.locator('.donut-hole strong').innerText()), clean(brlCompact(jan)), 'donut total is January only');
  await page.locator('#despesas .donut-caption [data-p=spend-evidence]').click();
  await page.waitForSelector('#detail[open]');
  const note = clean(await page.locator('#detail .records-note').first().innerText());
  assert.ok(note.includes('Jan 2025') && !note.includes('Jan–Fev'), `dialog scope: ${note}`);
  assert.equal(clean(await page.locator('#detail .calculation-result').innerText()).split(' Soma')[0], clean(brl(jan)), 'dialog total is January only');
  await page.keyboard.press('Escape');
  await page.locator('.metric-toggle [data-metric=mensal]').click();
  await page.locator('#scope-chip [data-action=reset]').click();
  assert.equal(clean(await page.locator('#despesas .range-heading h3').innerText()), 'Por mês · Jan–Fev 2025', 'Limpar resets the month');
  assert.equal(await page.locator('.p-mini-bars button.included').count(), 2, 'both months included again');
  await page.close();
});

check('monthly chart with negative values uses a true axis', async () => {
  const page = await at(1440, { search: `?categoria=${encodeURIComponent(AUX)}` });
  const data = await published(page);
  await pickPair(page, data, 'Tiririca', 'Acácio Favacho');
  const lo = sumCents(data, 'Tiririca', AUX, 1);
  assert.ok(lo < 0 && sumCents(data, 'Acácio Favacho', AUX, 1) === 0, 'January: negative and zero');
  const chart = await page.evaluate(() => {
    const svg = document.querySelector('.linked-lines');
    return {
      ticks: [...svg.querySelectorAll('.y-tick')].map(t => t.textContent.replace(/\s+/g, ' ').trim()),
      points: [...svg.querySelectorAll('.chart-point')].map(g => ({ label: g.getAttribute('aria-label'), cy: +g.dataset.cy })),
    };
  });
  assert.deepEqual([...chart.ticks].sort(), [lo, lo / 2, 0].map(v => clean(brlCompact(v))).sort(), `tick labels are true values: ${chart.ticks}`);
  assert.ok(chart.points.every(p => Number.isFinite(p.cy) && p.cy > 0 && p.cy < 255), `points inside the plot: ${JSON.stringify(chart.points)}`);
  const y = who => chart.points.find(p => p.label.startsWith(who) && p.label.includes('Jan')).cy;
  assert.ok(y('Tiririca') > y('Acácio'), 'the negative value is drawn below zero');
  await page.close();
});

check('shared link keeps metric, tab and category', async () => {
  const cat = 'TELEFONIA';
  const page = await at(1440, { search: `?q=${encodeURIComponent('Quem mais gastou?')}&metrica=mensal&aba=menos&categoria=${encodeURIComponent(cat)}` });
  const state = await page.evaluate(() => ({ metric: window.Clareia.state.metric, tab: window.Clareia.state.tab, category: window.Clareia.state.category, search: location.search }));
  assert.deepEqual([state.metric, state.tab, state.category], ['mensal', 'menos', cat], 'state follows the shared link');
  const params = new URLSearchParams(state.search);
  assert.deepEqual([params.get('metrica'), params.get('aba'), params.get('categoria')], ['mensal', 'menos', cat], 'URL keeps the parameters');
  assert.equal(await text(page.locator('.metric-toggle [aria-pressed=true]')), 'Por mês');
  await page.close();
});

check('map explanation lists its rows and coverage text is accurate', async () => {
  const page = await at(1440);
  const data = await published(page);
  await page.locator('[data-p=map-evidence]').click();
  await page.waitForSelector('#detail[open]');
  const rows = await page.locator('#detail table tbody tr').evaluateAll(trs => trs.map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim())));
  const byUf = {};
  for (const p of data.people) { byUf[p.uf] ||= { n: 0, cents: 0 }; byUf[p.uf].n++; byUf[p.uf].cents += p.records.reduce((n, r) => n + r.cents, 0); }
  assert.equal(rows.length, Object.keys(byUf).length, `one row per UF with deputies: ${JSON.stringify(rows)}`);
  for (const [uf, v] of Object.entries(byUf)) {
    const row = rows.find(r => r[0].includes(uf));
    assert.ok(row, `row for ${uf}`);
    assert.deepEqual([row[1], row[2]], [String(v.n), clean(brl(v.cents))], `${uf} profiles and exact value`);
  }
  await page.keyboard.press('Escape');
  await page.locator('[data-p=coverage]').click();
  await page.waitForSelector('#detail[open]');
  const coverage = clean(await page.locator('#detail-body').innerText());
  assert.ok(!/\bUF\b|partido/i.test(coverage), `coverage says UF or partido are not collected: ${coverage}`);
  await page.close();
});

check('chart hit areas do not loop the resize observer', async () => {
  const counters = () => {
    window.__ro = { made: 0, observe: 0, writes: 0 };
    const Native = window.ResizeObserver;
    window.ResizeObserver = class extends Native {
      constructor(callback) { window.__ro.made++; super(callback); }
      observe(...args) { window.__ro.observe++; return super.observe(...args); }
    };
    const set = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) { if (this.classList && this.classList.contains('chart-hit')) window.__ro.writes++; return set.call(this, name, value); };
  };
  const page = await at(1440, { init: counters });
  const read = () => page.evaluate(() => ({ ...window.__ro }));
  await page.waitForTimeout(1200);
  const first = await read();
  await page.waitForTimeout(1500);
  assert.deepEqual(await read(), first, 'idle: no new observers or writes');
  assert.ok(first.made <= 1, `observers created: ${first.made}`);
  const data = await published(page);
  await pickPair(page, data, 'Tabata Amaral', 'Tiririca');
  await page.waitForTimeout(500);
  const second = await read();
  await page.waitForTimeout(1500);
  assert.deepEqual(await read(), second, 'idle after changing the pair');
  assert.ok(second.made <= 1, `still one observer: ${second.made}`);
  await page.close();
});

check('Explorar a state with one deputy keeps a valid pair', async () => {
  const page = await at(1440);
  const data = await published(page);
  const solo = Object.entries(data.people.reduce((m, p) => ({ ...m, [p.uf]: (m[p.uf] || 0) + 1 }), {})).find(([, n]) => n === 1)[0];
  await page.locator('#map-select').selectOption(solo);
  await page.locator('[data-p=apply-state]').click();
  const [a, b] = await page.evaluate(() => [document.querySelector('#compare-a').value, document.querySelector('#compare-b').value]);
  assert.notEqual(a, b, `the comparison compares ${a} with itself`);
  await page.close();
});

check('closing a dialog opened from the category panel returns focus', async () => {
  const page = await at(1440);
  await page.evaluate(() => document.querySelector('#despesas').scrollIntoView());
  await page.locator('.donut-legend [data-p-highlight]').first().click();
  await page.locator('[data-p-drill]').click();
  await page.waitForSelector('#detail[open]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#detail').open);
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[data-p-drill]'))), true, 'focus back on "Ver fornecedores"');
  await page.locator('.supplier-list [data-p-supplier]').first().click();
  await page.waitForSelector('#detail[open]');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#detail').open);
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.supplier-list [data-p-supplier]'))), true, 'focus back on the supplier row');
  await page.close();
});

check('saving by keyboard keeps focus in the same section', async () => {
  const page = await at(1440);
  for (const section of ['#comparacao', '#pessoas']) {
    const button = page.locator(`${section} [data-p-follow]`).last();
    const id = await button.getAttribute('data-p-follow');
    await button.focus();
    await page.keyboard.press('Enter');
    const where = await page.evaluate(() => ({ section: document.activeElement.closest('section')?.id, id: document.activeElement.dataset.pFollow }));
    assert.deepEqual(where, { section: section.slice(1), id }, `focus after saving from ${section}`);
  }
  await page.close();
});

check('Visão inicial keeps focus', async () => {
  const page = await at(1440);
  await page.locator('[data-p-uf=SP]').click();
  await page.locator('[data-p=map-reset]').click();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.p), 'map-reset');
  await page.close();
});

check('external text is escaped once', async () => {
  const page = await at(1440);
  const probe = await page.evaluate(() => {
    const C = window.Clareia, D = window.ClareiaData;
    const [p] = C.all(), category = D.categories[1];
    const name = `D'Ávila & <u data-xss=name>Filho</u>`, catName = `Foo & 'bar' <u data-xss=cat>x</u>`;
    p.name = name; p.party = `PX<u data-xss=party>`;
    D.categories[1] = catName;
    for (const person of C.all()) for (const r of person.records) if (r.category === category) r.category = catName;
    C.refresh();
    return { name, shown: D.label(catName) };
  });
  const inspect = async step => {
    assert.equal(await page.locator('u[data-xss]').count(), 0, `markup injected at ${step}`);
    const body = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('dialog')].map(d => d.innerText).join('\n'));
    assert.ok(!/&amp;|&#39;|&lt;/.test(body), `double escaping at ${step}`);
  };
  await inspect('page');
  const body = await page.evaluate(() => document.body.innerText);
  assert.ok(body.includes(probe.name), 'the name renders literally, once');
  assert.ok(body.includes(probe.shown), 'the category renders literally, once');
  const aria = await page.evaluate(() => [...document.querySelectorAll('[data-p-follow]')].map(b => b.getAttribute('aria-label')));
  assert.ok(aria.some(l => l.endsWith(probe.name)), 'attribute keeps the exact name');
  await page.locator('.bar-row').first().click(); await page.waitForSelector('#detail[open]'); await inspect('evidence');
  await page.keyboard.press('Escape');
  await page.locator('.portrait-button').first().click(); await page.waitForSelector('#detail[open]'); await inspect('profile');
  await page.keyboard.press('Escape');
  await page.locator('#despesas .donut-legend [data-p-highlight]').nth(1).click();
  await page.locator('#despesas [data-p-drill]').click(); await page.waitForSelector('#detail[open]'); await inspect('supplier dialog');
  await page.keyboard.press('Escape');
  await page.close();
});

(async () => {
  browser =await chromium.launch({ headless: true });
  let failed = 0;
  try {
    for (const { name, fn } of checks) {
      try { await fn(); console.log(`PASS ${name}`); }
      catch (error) { failed++; console.log(`FAIL ${name}\n  ${String(error.message).split('\n').join('\n  ')}`); }
    }
  } finally { await browser.close(); }
  if (failed) { console.log(`${failed} of ${checks.length} checks failed`); process.exitCode = 1; }
})();
