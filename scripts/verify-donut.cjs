const assert = require('node:assert/strict');
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require(path.join(process.env.APPDATA, 'npm/node_modules/playwright'))); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:4174');
    await page.waitForSelector('[data-donut-slice]');
    await page.locator('.donut-svg').scrollIntoViewIfNeeded();
    const total = await page.locator('.donut-hole strong').innerText();
    const slices = page.locator('[data-donut-slice]');
    assert.ok(await slices.count() > 1);
    // Aim at the middle of the first arc, not its bounding-box center (which can be in the hole).
    const point = await page.evaluate(() => {
      const C = window.Clareia;
      const rows = C.all().filter(p => C.state.uf === 'Brasil' || p.uf === C.state.uf).flatMap(C.cells);
      const name = document.querySelector('[data-donut-slice]').dataset.pHighlight;
      const categories = [...new Set(rows.map(r => r.category))];
      const positive = categories.reduce((n, category) => n + Math.max(0, C.sum(rows.filter(r => r.category === category))), 0);
      const share = C.sum(rows.filter(r => r.category === name)) / positive;
      const angle = -Math.PI / 2 + Math.PI * share;
      const point = new DOMPoint(100 + 90 * Math.cos(angle), 100 + 90 * Math.sin(angle))
        .matrixTransform(document.querySelector('.donut-svg').getScreenCTM());
      return { x: point.x, y: point.y, name, label: window.ClareiaData.label(name) };
    });
    await page.mouse.move(point.x, point.y);
    assert.equal(await page.locator('.donut-readout strong').innerText(), point.label);
    assert.equal(await page.locator('[data-donut-slice][aria-pressed=true]').count(), 0);
    await page.mouse.click(point.x, point.y);
    await page.mouse.move(0, 0);
    assert.equal(await page.locator('[data-donut-slice][aria-pressed=true]').count(), 1);
    assert.equal(await page.locator('.donut-legend [aria-pressed=true]').getAttribute('data-p-highlight'), point.name);
    assert.match(await page.locator('.donut-hole strong').innerText(), /^R\$\s[\d.]+,\d\d$/, 'the center shows the selected category exact value');
    assert.ok(await page.locator('.category-bar-part').count() > 0);
    await page.locator('#despesas h2').click();
    assert.equal(await page.locator('[data-donut-slice][aria-pressed=true]').count(), 0);
    assert.equal(await page.locator('.donut-segment.is-dimmed').count(), 0);
    assert.equal(await page.locator('.category-bar-part').count(), 0);
    assert.equal(await page.locator('.donut-hole strong').innerText(), total);
    await page.locator('.donut-legend [data-p-highlight]').first().click();
    assert.equal(await page.locator('[data-donut-slice][aria-pressed=true]').count(), 1);
    const second = await slices.nth(1).getAttribute('data-p-highlight');
    await slices.nth(1).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('[data-donut-slice][aria-pressed=true]').getAttribute('data-p-highlight'), second);
    await page.keyboard.press('Space');
    assert.equal(await page.locator('[data-donut-slice][aria-pressed=true]').count(), 0);
    await slices.first().focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-p-month="1"]').click();
    assert.equal(await page.locator('[data-donut-slice][aria-pressed=true]').getAttribute('data-p-highlight'), point.name);
    await page.locator('[data-p=clear-highlight]').click();
    assert.equal(await page.locator('[data-donut-slice][aria-pressed=true]').count(), 0);
    const adjustment = page.locator('.donut-legend [data-detail*="ajuste negativo"]');
    if (await adjustment.count()) {
      const net = await page.locator('.donut-hole strong').innerText();
      await adjustment.first().click();
      assert.match(await page.locator('.donut-readout span').innerText(), /ajuste negativo/);
      assert.equal(await page.locator('.donut-hole strong').innerText(), net);
      assert.equal(await page.locator('[data-donut-slice][aria-pressed=true]').count(), 0);
      assert.ok(await page.locator('.donut-adjustment').isVisible());
      await page.locator('[data-p=clear-highlight]').click();
    }
    const category = await slices.first().getAttribute('data-p-highlight');
    await page.evaluate(category => { window.Clareia.state.category = category; window.Clareia.refresh(); }, category);
    assert.equal(await page.locator('circle[data-donut-slice]').count(), 1);
    await page.locator('circle[data-donut-slice]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('circle[data-donut-slice]').getAttribute('aria-pressed'), 'true');
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 960 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.equal(await slices.first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    assert.deepEqual(errors, []);
    console.log('PASS: donut pointer hover/click, persistent selection, legend and monthly highlights, keyboard toggle, period changes, clearing, responsive layout and reduced motion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
