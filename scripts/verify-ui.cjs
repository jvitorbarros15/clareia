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
  check(`panorama values are final at first paint (${reducedMotion === 'reduce' ? 'reduced motion' : 'motion on'})`, async () => {
    const page = await at(1440, { reducedMotion });
    const data = await published(page);
    const expected = await page.evaluate(cents => window.Clareia.compact(cents), data.total);
    await page.evaluate(() => document.querySelector('#panorama').scrollIntoView());
    const stat = page.locator('[data-p-summary=expenses] strong');
    assert.equal(await text(stat), clean(expected), 'value right after scrolling into view');
    await page.waitForTimeout(150);
    assert.equal(await text(stat), clean(expected), 'value stays final');
    assert.equal(await page.locator('[data-counter]').count(), 0, 'no counter markup is left');
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
