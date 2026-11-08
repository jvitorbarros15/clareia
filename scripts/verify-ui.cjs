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
