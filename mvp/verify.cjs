/* Browser verification. Uses a separately installed Playwright; no runtime dependency. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.APPDATA, 'npm/node_modules/playwright')); }
const base = process.env.BASE_URL || 'http://127.0.0.1:4173';
const output = path.resolve(__dirname, '../output/qa');
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], screenshots: [], errors: [] };
const checked = label => { report.checks.push(label); console.log('PASS ' + label); };

(async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), sandbox);
  for (const model of ['investigacao', 'explorador', 'editorial']) {
    for (const year of ['2024', '2025']) {
      for (const p of sandbox.window.ClareiaData.dataset(model, year)) {
        assert.equal(p.records.reduce((n, r) => n + r.amount, 0), p.total);
        assert.equal(p.byCategory.reduce((a, b) => a + b, 0), p.total);
        assert.equal(new Set(p.records.map(r => r.id)).size, p.records.length);
        assert(p.records.every(r => Number.isInteger(r.amount) && r.amount >= 0 && r.month < p.months));
      }
    }
  }
  checked('All models and years: records, categories and exercise months reconcile');

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('response', res => { if (res.status() >= 400 && res.url().startsWith(base)) report.errors.push(`${res.status()} ${res.url()}`); });
    async function open(model, query = '') {
      const response = await page.goto(`${base}/?modelo=${model}${query}`);
      assert.equal(response.status(), 200);
      await page.waitForLoadState('networkidle');
    }
    async function screenshot(name) {
      await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true, animations: 'disabled' });
      report.screenshots.push(name + '.png');
    }
    const first = () => page.locator('.rank-card').first().getAttribute('data-person');
    for (const model of ['investigacao', 'explorador', 'editorial']) {
      await open(model);
      assert.equal(await first(), 'ana');
      assert.equal(await page.locator('.rank-card').count(), 3);
      assert.equal(await page.locator('body').getAttribute('data-model'), model);
      assert.equal(await page.locator('.prototype-bar').count(), 0);
      await screenshot(model + '-desktop');
      for (const width of [360, 390, 768]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${model}: overflow at ${width}`);
        if (width === 390) await screenshot(model + '-mobile');
      }
      await page.setViewportSize({ width: 1280, height: 1000 });
      await page.locator('.metric-toggle [data-metric=mensal]').click();
      assert.equal(await first(), 'diego');
      assert.match(await page.locator('.rank-card').first().innerText(), /30 mil/);
      await page.locator('.metric-toggle [data-metric=total]').click();
      await page.locator('[data-tab=projetos]').click();
      assert.equal(await first(), 'carla');
      assert.match(await page.locator('.rank-card').first().innerText(), /32/);
      if (model === 'explorador') {
        await page.locator('[data-tab=votacoes]').click();
        assert.equal(await first(), 'carla');
        assert.match(await page.locator('.rank-card').first().innerText(), /92/);
      }
      await page.locator('[data-tab=gastos]').click();
      await page.locator('[data-filter=uf]').selectOption('MG');
      assert.equal(await first(), 'bruno');
      assert.equal(await page.locator('.rank-card').count(), 2);
      await page.locator('[data-filter=year]').selectOption('2024');
      assert.match(await page.locator('.rank-card').first().innerText(), /162 mil/);
      await page.locator('[data-filter=uf]').selectOption('Brasil');
      await page.locator('[data-filter=year]').selectOption('2025');

      await page.locator('#query').fill('Ana gastou mais que Bruno em 2025?');
      await page.locator('#search-form').evaluate(form => form.requestSubmit());
      assert.match(await page.locator('.answer-summary').innerText(), /33,3% mais/);
      await page.locator('[data-action=answer-evidence]').click();
      assert.equal(await page.locator('#detail').evaluate(el => el.open), true);
      assert.match(await page.locator('.calculation-result').innerText(), /33,3%/);
      assert.match(await page.locator('#detail-body').innerText(), /240.000.*180.000/);
      await screenshot(model + '-evidence');
      await page.locator('[data-action=records]').click();
      assert.equal(await page.locator('#detail tbody tr').count(), 36);
      assert.match(await page.locator('#detail tfoot').innerText(), /240.000/);
      const downloadPromise = page.waitForEvent('download');
      await page.locator('[data-action=download]').click();
      const download = await downloadPromise;
      const downloaded = await download.path();
      const csv = fs.readFileSync(downloaded, 'utf8');
      assert.equal(csv.split('\r\n').length, 37);
      assert.match(csv, /DEMO-2025-ana/);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#detail').evaluate(el => el.open), false);
      assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'answer-evidence');

      await page.locator('#query').fill('Quem de MG gastou mais com passagens?');
      await page.locator('#search-form').evaluate(form => form.requestSubmit());
      assert.match(await page.locator('.answer-summary').innerText(), /Bruno Costa lidera/);
      assert.match(await page.locator('.answer-row').first().innerText(), /90 mil/);
      await page.locator('[data-filter=year]').selectOption('2024');
      await page.locator('.metric-toggle [data-metric=mensal]').click();
      const shared = page.url();
      await page.goto(shared);
      assert.equal(await page.locator('[data-filter=year]').inputValue(), '2024');
      assert.equal(await page.locator('.metric-toggle [data-metric=mensal]').getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('.answer').innerText(), /2024/);

      for (const [query, expected] of [
        ['Como Ana votou na reforma?', /Não temos evidência/],
        ['Quanto João gastou?', /Vamos delimitar/],
        ['Compare Ana e João', /Qual é o outro/],
        ['Ana em 2026', /Período fora/],
        ['Compare 2024 e 2025', /Escolha um ano/],
        ['<img src=x onerror=alert(1)>', /Vamos delimitar/]
      ]) {
        await page.locator('#query').fill(query);
        await page.locator('#search-form').evaluate(form => form.requestSubmit());
        assert.match(await page.locator('.answer').innerText(), expected);
      }
      checked(model + ': default composition, responsive widths, rankings, filters, search, evidence, CSV, focus and shared state');
    }

    await open('explorador');
    await page.locator('.bar-row').first().click();
    assert.equal(await page.locator('#evidence-pop').count(), 1);
    await screenshot('explorador-popover');
    await page.locator('#evidence-pop [data-action=evidence]').click();
    assert.match(await page.locator('#detail-body').innerText(), /240 mil/);
    await page.keyboard.press('Escape');
    await page.locator('.chart-point').first().focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#detail tbody tr').count(), 3);
    await page.keyboard.press('Escape');
    await page.locator('[data-action=chart-table]').click();
    assert.equal(await page.locator('#chart-table').isVisible(), true);
    await page.locator('[data-series=ana]').click();
    assert.equal(await page.locator('.line-chart .series').count(), 2);
    await page.locator('[data-action=reverse]').click();
    assert.equal(await first(), 'fernanda');
    assert.equal(await page.locator('.bar-row[data-id=diego]').count(), 0);
    checked('Explorer: evidence popover, keyboard chart point, table, legend, eligibility for smallest expenses');

    await open('editorial');
    await page.locator('.portrait-button').first().click();
    assert.match(await page.locator('#detail-body').innerText(), /Ana Martins/);
    await page.locator('[data-action=profile-compare]').click();
    assert.match(await page.locator('.answer-summary').innerText(), /33,3%/);
    await page.locator('footer [data-action=methodology]').click();
    assert.match(await page.locator('#detail-body').innerText(), /sem IA|não há modelo de IA/);
    await page.keyboard.press('Escape');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('[data-action=share]').click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, page.url());
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    await page.locator('[data-action=share]').click();
    assert.equal(await page.locator('#share-link').inputValue(), page.url());
    checked('Profile comparison, methodology, clipboard success and manual-copy fallback');

    await open('investigacao');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-action=answer-evidence]').click();
    assert.equal(await page.locator('#detail').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await screenshot('investigacao-mobile-evidence');
    checked('Mobile evidence drawer fits viewport');
    assert.deepEqual(report.errors, []);
    checked('No browser JavaScript errors or failed local asset requests');
    report.status = 'passed';
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
