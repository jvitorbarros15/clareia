const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.env.APPDATA,'npm/node_modules/playwright')));}
const base=process.env.BASE_URL||'http://127.0.0.1:4174',out=path.resolve('output/qa');fs.mkdirSync(out,{recursive:true});
const money=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\s+/g,' ').replace(/^-/,'−');
const text=s=>s.replace(/\s+/g,' ').trim();
(async()=>{const browser=await chromium.launch({headless:true});const errors=[],checks=[];
try{
  const page=await browser.newPage({viewport:{width:1360,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForSelector('.full-portal');
  // Expected values come from the published files, summed here in integer cents, independently of the page code.
  const data=await page.evaluate(async()=>{const m=await fetch('/manifest.json').then(r=>r.json()),index=await fetch(`/${m.base}/index.json`).then(r=>r.json());const people=[];for(const id of index.scope.ids){const recs=await fetch(`/${m.base}/deputados/${id}/despesas.json`).then(r=>r.json());people.push({id,name:index.people.find(p=>p.id===id).name,count:recs.length,cents:recs.reduce((n,r)=>n+r.cents,0),negative:recs.filter(r=>r.cents<0).map(r=>r.cents)});}return {base:m.base,index,people};});
  const close=async()=>{await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#detail').open);};
  assert.equal(await page.locator('.editorial-rank .rank-card').count(),Math.min(3,data.people.length));
  for(const p of data.people){
    await page.locator(`.bar-row[data-id="${p.id}"]`).click();await page.waitForSelector('#detail[open]');
    assert.equal(text(await page.locator('#detail .calculation-result').innerText()).split(' no período')[0],money(p.cents),`evidence total ${p.name}`);
    assert.match(await page.locator('#detail-body').innerText(),new RegExp(`${p.count} registros oficiais`));
    await page.locator('#detail [data-action=records]').click();
    assert.equal(await page.locator('#detail tbody tr').count(),p.count,`record rows ${p.name}`);
    assert.equal(text(await page.locator('#detail tfoot td strong').innerText()),money(p.cents),`record table total ${p.name}`);
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#detail [data-action=download]').click()]);
    assert.equal(fs.readFileSync(await download.path(),'utf8').split('\r\n').length-1,p.count,`CSV rows ${p.name}`);
    await page.locator('#detail [data-action=record]').first().click();
    const detail=await page.locator('#detail-body').innerText();assert.match(detail,/Documento|Sem documento fiscal/);assert.match(await page.locator('#detail-body a.primary').getAttribute('href'),/^https:\/\/(www\.camara\.leg\.br|dadosabertos\.camara\.leg\.br)\//);
    await close();
  }
  checks.push('evidence totals, record tables, CSV and record detail match the published files for every person');
  const total=data.people.reduce((n,p)=>n+p.cents,0);
  await page.locator('[data-p-summary=expenses]').click();await page.waitForSelector('#detail[open]');
  assert.equal(text(await page.locator('#detail .calculation-result').innerText()).split(' Soma')[0],money(total));await close();
  checks.push('overview total equals the sum of all records');
  // A negative adjustment keeps its sign and is never recomputed.
  const adjusted=data.people.find(p=>p.negative.length);
  if(adjusted){
    await page.locator(`.bar-row[data-id="${adjusted.id}"]`).click();await page.locator('#detail [data-action=records]').click();
    const row=page.locator('#detail tbody tr',{hasText:'−R$'}).first();await row.locator('[data-action=record]').click();
    const detail=text(await page.locator('#detail-body').innerText());assert.ok(detail.includes(money(Math.min(...adjusted.negative)))||adjusted.negative.some(c=>detail.includes(money(c))),'negative value keeps its sign');
    if(await page.locator('#detail .formula[data-equation=none]').count())assert.match(detail,/sem recálculo/);
    await page.screenshot({path:path.join(out,'real-adjustment-dialog.png')});await close();
    checks.push('negative adjustment shown with sign and without recomputation');
  }
  await page.locator('#query').fill(`${data.people[0].name.split(' ')[0]} gastou mais que ${data.people[1].name.split(' ')[0]}?`);await page.locator('#query').press('Enter');
  await page.waitForSelector('.answer-bars');assert.equal(await page.locator('.answer-row').count(),2);checks.push('search compares two people');
  const body=await page.locator('body').innerText();assert.doesNotMatch(body,/fict[íi]ci|demonstra[çt]/i,'no fictional wording');
  assert.match(await page.locator('#projetos').innerText(),/ainda não foram coletados/);checks.push('no fictional wording; uncollected sections say so');
  assert.equal((await page.request.get(base+'/_headers')).status(),404);
  assert.equal((await page.request.get(base+'/data/raw/annual/Ano-2025.csv.zip')).status(),404);checks.push('raw data and _headers not served');
  for(const width of [390,768,1360]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`);await page.screenshot({path:path.join(out,`real-${width}.png`),fullPage:true});}
  checks.push('mobile/tablet/desktop overflow');
  assert.deepEqual(errors,[]);checks.push('no JavaScript errors');
  const report={status:'passed',snapshotId:data.index.snapshotId,checks};fs.writeFileSync(path.join(out,'real-browser-verification.json'),JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
