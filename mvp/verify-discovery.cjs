const assert = require('node:assert/strict');
const path = require('node:path');
let chromium;
try { ({chromium}=require('playwright')); }
catch { ({chromium}=require(path.join(process.env.APPDATA,'npm/node_modules/playwright'))); }
const base=process.env.BASE_URL||'http://127.0.0.1:4173';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({reducedMotion:'reduce'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const model of ['investigacao','explorador','editorial']) {
      await page.goto(`${base}/?modelo=${model}`);
      await page.selectOption('#map-select','MG');
      await page.selectOption('#map-metric','average');
      assert.match(await page.locator('#atlas-detail').innerText(),/135\.000/);
      await page.locator('[data-p=map-evidence]').click();
      assert.match(await page.locator('#detail').innerText(),/não ajusta tempo em exercício/);
      await page.keyboard.press('Escape');
      await page.selectOption('#map-metric','projects');
      assert.match(await page.locator('#atlas-detail').innerText(),/30 projetos/);
      await page.locator('[data-p=apply-state]').click();
      assert.equal(await page.locator('#compare-a').inputValue(),'bruno');
      assert.equal(await page.locator('#compare-b').inputValue(),'diego');
      const points=page.locator('#linked-result .chart-point');
      assert.equal(await points.count(),15);
      // Range boundaries stay ordered, input nodes stay mounted during updates.
      await page.evaluate(()=>{
        const from=document.querySelector('#linked-from');window.fromNode=from;
        from.value=5;from.dispatchEvent(new Event('input',{bubbles:true}));
        const to=document.querySelector('#linked-to');to.value=3;to.dispatchEvent(new Event('input',{bubbles:true}));
      });
      assert.equal(await page.locator('#linked-from').inputValue(),'3');
      assert.equal(await page.locator('#linked-to').inputValue(),'3');
      assert(await page.evaluate(()=>window.fromNode===document.querySelector('#linked-from')));
      const expected=await page.evaluate(()=>window.Clareia.person('bruno').records.filter(r=>r.month===2).reduce((n,r)=>n+r.amount,0));
      assert.equal(await page.locator('.linked-totals strong').first().innerText(),expected.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}));
      await page.locator('#linked-result [data-id=bruno][data-month="2"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#detail tbody tr').count(),3);
      await page.keyboard.press('Escape');
      await page.locator('[data-p-drill="Passagens"]').click();
      await page.locator('[data-p-supplier]').click();
      assert.equal(await page.locator('#detail tbody tr').count(),15);
      assert.match(await page.locator('#detail').innerText(),/Passagens/);
      await page.keyboard.press('Escape');
      await page.selectOption('#map-select','BA');
      assert.match(await page.locator('#atlas-detail').innerText(),/Indisponível não significa zero/);
      for(const width of [390,1280]) {
        await page.setViewportSize({width,height:900});
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      }
      await page.locator('#comparacao').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.resolve(__dirname,`../output/qa/${model}-discovery.png`)});
      console.log(`PASS ${model}: map normalization, linked people, period totals, keyboard records, supplier drilldown and layout`);
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
