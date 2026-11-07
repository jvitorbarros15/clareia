const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
let chromium;
try { ({chromium}=require('playwright')); } catch { ({chromium}=require(path.join(process.env.APPDATA,'npm/node_modules/playwright'))); }
const base=process.env.BASE_URL||'http://127.0.0.1:4173';
const out=path.resolve(__dirname,'../output/qa');fs.mkdirSync(out,{recursive:true});
const report={checks:[],errors:[],screenshots:[]};
function pass(text){report.checks.push(text);console.log('PASS '+text);}
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const ctx=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'});
  const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  async function close(){await page.keyboard.press('Escape');assert.equal(await page.locator('#detail').evaluate(d=>d.open),false);}
  for(const model of ['investigacao','explorador','editorial']){
   await page.goto(`${base}/?modelo=${model}`);await page.evaluate(()=>localStorage.clear());await page.reload();
   await page.waitForLoadState('networkidle');
   assert.equal(await page.locator('.full-portal>.p-section').count(),10);
   assert.equal(await page.locator('.site-header .brand-rays').count(),1);
   assert.equal(await page.locator('.uf-tile').count(),27);
   assert.equal(await page.locator('.project-card').count(),4);
   assert.equal(await page.locator('.vote-card').count(),3);
   assert.equal(await page.locator('.directory-card').count(),5);
   await page.locator('#spend-range').scrollIntoViewIfNeeded();
   await page.evaluate(()=>window.originalRange=document.querySelector('#spend-range'));
   const range=await page.locator('#spend-range').boundingBox();
   await page.mouse.move(range.x+range.width-4,range.y+range.height/2);await page.mouse.down();
   await page.mouse.move(range.x+range.width*.42,range.y+range.height/2,{steps:16});await page.mouse.up();
   const month=Number(await page.locator('#spend-range').inputValue());assert(month>1&&month<10);
   assert.equal(await page.evaluate(()=>window.originalRange===document.querySelector('#spend-range')),true);
   const expected=await page.evaluate(m=>window.Clareia.all().flatMap(p=>p.records).filter(r=>r.month<m&&r.category==='Divulgação').reduce((n,r)=>n+r.amount,0),month);
   const expectedText=new RegExp(expected.toLocaleString('pt-BR').replaceAll('.','\\.'));
   if(model==='editorial'){
    const shown=await page.locator('#despesas .supplier-list button').evaluateAll(bs=>bs.map(b=>[b.dataset.category,b.dataset.pSupplier,b.querySelector('b').textContent]));
    const actual=await page.evaluate(m=>{const rows=window.Clareia.all().flatMap(p=>p.records).filter(r=>r.month<m),seen=new Map();for(const r of rows){const k=r.category+'|'+r.supplier;seen.set(k,(seen.get(k)||0)+r.amount);}return [...seen].map(([k,v])=>[...k.split('|'),window.Clareia.compact(v)]);},month);
    assert.deepEqual([...shown].sort(),[...actual].sort(),'supplier list is one row per category and supplier');
    await page.locator('.category-path [data-p-drill="Divulgação"]').click();
    assert.match(await page.locator('#detail .calculation-result').innerText(),expectedText);
    await page.locator('#detail [data-p-supplier]').first().click();
   }else await page.locator('.donut-legend [data-p-category="Divulgação"]').click();
   assert.match(await page.locator('#detail .calculation-result').innerText(),expectedText);
   assert.equal(await page.locator('#detail tbody tr').count(),Math.min(month,12)*3+Math.min(month,3)+Math.min(month,6));
   await close();
   await page.locator('[data-p-uf=BA]').focus();await page.keyboard.press('Enter');
   assert.match(await page.locator('#atlas-detail').innerText(),/Indisponível não significa zero/);
   assert.doesNotMatch(await page.locator('#atlas-detail').innerText(),/R\$ 0/);
   await page.locator('#map-select').selectOption('MG');await page.locator('[data-p=apply-state]').click();
   assert.equal(await page.locator('[data-filter=uf]').inputValue(),'MG');
   assert.match(await page.locator('[data-p-summary=people]').innerText(),/2/);
   await page.locator('#roster-party').selectOption('PC');assert.equal(await page.locator('.directory-card').count(),1);
   await page.locator('#roster-query').fill('Carla');assert.match(await page.locator('.directory-card h3').innerText(),/Carla/);
   await page.locator('#roster-uf').selectOption('SP');assert.equal(await page.locator('.directory-card').count(),0);
   await page.locator('[data-p=clear-directory]').click();assert.equal(await page.locator('.directory-card').count(),5);
   const points=page.locator('#comparacao .chart-point');
   for(let i=0;i<await points.count();i++){
    const p=points.nth(i);await p.scrollIntoViewIfNeeded();const box=await p.boundingBox(),id=await p.getAttribute('data-id');
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
    const first=await page.evaluate(id=>window.Clareia.person(id).name.split(' ')[0],id);
    assert.match(await page.locator('#detail-title').innerText(),new RegExp('Registros de '+first),`${model} chart point ${i} opens ${first}`);await close();
   }
   await page.locator('#pessoas [data-p-add-compare=carla]').click();assert.equal(await page.locator('#compare-a').inputValue(),'carla');
   await page.locator('#compare-b').selectOption('ana');
   await page.locator('[data-p=compare-evidence]').click();assert.match(await page.locator('#detail').innerText(),model==='investigacao'?/37,5%/:/50%/);await close();
   await page.locator('[data-p=swap]').click();assert.equal(await page.locator('#compare-a').inputValue(),'ana');
   await page.locator('#pessoas [data-p-follow=ana]').click();assert.equal(await page.locator('#saved-count').innerText(),'1');
   await page.reload();assert.equal(await page.locator('#saved-count').innerText(),'1');
   await page.locator('[data-p-topic="Educação"]').click();assert.equal(await page.locator('.project-card').count(),1);
   await page.locator('.project-title').click();assert.match(await page.locator('#detail').innerText(),/Conectividade/);
   await page.locator('#detail [data-p-project-save="02"]').click();assert.equal(await page.locator('#detail [data-p-project-save="02"]').getAttribute('aria-pressed'),'true');await close();
   await page.locator('[data-p-topic=Todos]').click();await page.locator('#project-search').fill('inexistente');assert.equal(await page.locator('.project-card').count(),0);
   await page.locator('[data-p=clear-projects]').click();await page.locator('#project-stage').selectOption('Aprovado na Câmara');assert.equal(await page.locator('.project-card').count(),1);
   await page.locator('#voter').selectOption('diego');assert.deepEqual(await page.locator('.your-vote strong').allTextContents(),['Não','Ausente','Sim']);
   await page.locator('[data-p-vote=v2]').click();assert.equal(await page.locator('.vote-rollcall>div').count(),5);assert.match(await page.locator('#detail').innerText(),/Ausência e abstenção/);await close();
   for(const [key,expected] of [['trajectory',/84.320/],['assets',/580 mil/],['amendments',/450 mil/],['suppliers',/registros fictícios/]].filter(([key])=>model!=='editorial'||key!=='suppliers')){await page.locator(`[data-p-dossier=${key}]`).click();assert.match(await page.locator('#detail').innerText(),expected);await close();}
   await page.locator('#timeline-person').selectOption('carla');assert.match(await page.locator('.timeline-event').last().innerText(),/RJ/);
   await page.locator('[data-p=brief]').click();assert.match(await page.locator('#detail').innerText(),/Ana Martins/);await close();
   await page.locator('[data-p=assistant]').click();if(model==='editorial'){assert.equal(await page.evaluate(()=>document.activeElement.id),'query');await page.locator('#query').fill('Compare Ana e Bruno em 2025');await page.locator('#query').press('Enter');}else{await page.locator('#assistant-query').fill('Compare Ana e Bruno em 2025');await page.locator('#assistant-form button').click();}assert.match(await page.locator('.answer-summary').innerText(),/33,3%/);
   await page.locator('[data-p=coverage]').click();assert.match(await page.locator('#detail').innerText(),/24 delas não têm dados/);await close();
   await page.locator('[data-p=reset-saved]').click();assert.equal(await page.locator('#saved-count').innerText(),'');assert.equal(await page.locator('.saved-projects>b').innerText(),'0');
   for(const width of [360,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${model} overflow ${width}`);}
   await page.goto(`${base}/?modelo=${model}`);await page.waitForLoadState('networkidle');
   await page.screenshot({path:path.join(out,`${model}-full-desktop.png`),fullPage:true,animations:'disabled'});report.screenshots.push(`${model}-full-desktop.png`);
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,`${model}-full-mobile.png`),fullPage:true,animations:'disabled'});report.screenshots.push(`${model}-full-mobile.png`);
   await page.setViewportSize({width:1280,height:1000});
   pass(`${model}: slider drag, category records, map keyboard/empty state, shared filters, directory, comparison, favorites, projects, voting, dossiers, timeline, assistant and responsive layout`);
  }
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>localStorage.removeItem('clareia-motion'));
  await page.goto(`${base}/?modelo=explorador`);assert.equal(await page.locator('body').getAttribute('data-motion'),'on');
  await page.locator('#panorama').scrollIntoViewIfNeeded();await page.waitForFunction(()=>[...document.querySelectorAll('.p-stat')].every(e=>e.classList.contains('is-visible')));
  await page.waitForFunction(()=>document.querySelector('[data-p-summary=expenses] strong').textContent==='R$ 690 mil');
  await page.locator('#projetos .project-card').first().scrollIntoViewIfNeeded();await page.locator('#projetos .project-card').first().hover();
  assert.notEqual(await page.locator('#projetos .project-card').first().evaluate(e=>e.style.getPropertyValue('--tilt-x')),'');
  await page.locator('[data-p=motion]').click();assert.equal(await page.locator('body').getAttribute('data-motion'),'off');
  assert.equal(await page.locator('.p-reveal').evaluateAll(es=>es.every(e=>getComputedStyle(e).opacity==='1')),true);
  await page.reload();assert.equal(await page.locator('body').getAttribute('data-motion'),'off');
  await page.emulateMedia({reducedMotion:'reduce'});await page.reload();assert.equal(await page.locator('body').getAttribute('data-motion'),'off');
  pass('Motion: scroll reveal, settled counters, Explorer hover depth, opt-out persistence and reduced-motion preference');
  assert.deepEqual(report.errors,[]);pass('No runtime errors during complete-page interactions');report.status='passed';
 }finally{await browser.close();fs.writeFileSync(path.join(out,'portal-verification.json'),JSON.stringify(report,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
