const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.env.APPDATA,'npm/node_modules/playwright')));}
const argv=process.argv.slice(2),all=argv.includes('--all'),seedAt=argv.indexOf('--seed'),seed=seedAt<0?20261110:Number(argv[seedAt+1]);
const base=process.env.BASE_URL||'http://127.0.0.1:4174',out=path.resolve('output/qa');fs.mkdirSync(out,{recursive:true});
const money=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\s+/g,' ').replace(/^-/,'−');
const text=s=>s.replace(/\s+/g,' ').trim();
const random=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
(async()=>{const browser=await chromium.launch({headless:true});const errors=[],checks=[];
try{
  const page=await browser.newPage({viewport:{width:1360,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForSelector('.full-portal');
  // Expected values come from the published files, summed here in integer cents, independently of the page code.
  const data=await page.evaluate(async()=>{const m=await fetch('/manifest.json').then(r=>r.json()),index=await fetch(`/${m.base}/index.json`).then(r=>r.json());const people=[];for(const id of index.scope.ids.filter(id=>!index.withoutData.includes(id))){const recs=await fetch(`/${m.base}/deputados/${id}/despesas.json`).then(r=>r.json());people.push({id,name:index.people.find(p=>p.id===id).name,count:recs.length,cents:recs.reduce((n,r)=>n+r.cents,0),negative:recs.filter(r=>r.cents<0).map(r=>r.cents)});}return {base:m.base,domains:Object.keys(m.domains),index,people};});
  const close=async()=>{await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#detail').open);};
  assert.equal(await page.locator('.editorial-rank .rank-card').count(),Math.min(3,data.people.length));
  // The ranking shows 10 bars at a time: expand it to the end, then read the order from the page.
  while(await page.locator('#comparison [data-action=bars-more]').count())await page.locator('#comparison [data-action=bars-more]').click();
  const order=(await page.locator('.bar-row').evaluateAll(rows=>rows.map(r=>Number(r.dataset.id)))),byId=new Map(data.people.map(p=>[p.id,p]));
  assert.ok(order.length&&order.every(id=>byId.has(id))&&new Set(order).size===order.length,'ranking lists only deputies with published expenses, once each');
  let chosen=order;
  if(!all&&order.length>30){const rest=order.slice(10,-10),next=random(seed),pool=[...rest];for(let i=pool.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}chosen=[...order.slice(0,10),...pool.slice(0,10),...order.slice(-10)];}
  for(const id of chosen){
    const p=byId.get(id);
    await page.locator(`.bar-row[data-id="${p.id}"]`).click();await page.waitForSelector('#detail[open]');
    assert.equal(text(await page.locator('#detail .calculation-result').innerText()).split(' no período')[0],money(p.cents),`evidence total ${p.name}`);
    assert.match(await page.locator('#detail-body').innerText(),new RegExp(`${p.count} registros oficiais`));
    await page.locator('#detail [data-action=records]').click();
    await page.waitForFunction(()=>document.querySelector('#detail').open&&!document.querySelector('#detail .records-loading'));
    assert.equal(await page.locator('#detail .record-row').count(),p.count,`record rows ${p.name}`);
    assert.equal(text(await page.locator('#detail .record-list-total').innerText()),money(p.cents),`record table total ${p.name}`);
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#detail [data-action=download]').click()]);
    assert.equal(fs.readFileSync(await download.path(),'utf8').split('\r\n').length-1,p.count,`CSV rows ${p.name}`);
    await page.locator('#detail .record-row').first().click();
    const detail=await page.locator('#detail-body').innerText();assert.match(detail,/Documento|Sem documento fiscal/);assert.match(await page.locator('#detail-body a.primary').getAttribute('href'),/^https:\/\/(www\.camara\.leg\.br|dadosabertos\.camara\.leg\.br)\//);
    await close();
  }
  checks.push(`evidence totals, record tables, CSV and record detail match the published files for ${chosen.length} of ${order.length} deputies (${all?'all':'first 10, last 10 and 10 seeded-random'})`);
  const total=data.people.reduce((n,p)=>n+p.cents,0);
  await page.locator('[data-p-summary=expenses]').click();await page.waitForSelector('#detail[open]');
  assert.equal(text(await page.locator('#detail .calculation-result').innerText()).split(' Soma')[0],money(total));await close();
  checks.push('overview total equals the sum of all records');
  // A negative adjustment keeps its sign and is never recomputed.
  const adjusted=data.people.find(p=>p.negative.length);
  if(adjusted){
    await page.locator(`.bar-row[data-id="${adjusted.id}"]`).click();await page.locator('#detail [data-action=records]').click();
    const row=page.locator('#detail .record-row',{hasText:'−R$'}).first();await row.click();
    const detail=text(await page.locator('#detail-body').innerText());assert.ok(detail.includes(money(Math.min(...adjusted.negative)))||adjusted.negative.some(c=>detail.includes(money(c))),'negative value keeps its sign');
    if(await page.locator('#detail .formula[data-equation=none]').count())assert.match(detail,/sem recálculo/);
    await page.screenshot({path:path.join(out,'real-adjustment-dialog.png')});await close();
    checks.push('negative adjustment shown with sign and without recomputation');
  }
  const tokens=new Map();for(const p of data.index.people)for(const t of new Set(p.name.toLowerCase().split(' ')))tokens.set(t,(tokens.get(t)||0)+1);
  const pair=order.map(id=>byId.get(id).name.split(' ').find(t=>t.length>3&&tokens.get(t.toLowerCase())===1)).filter(Boolean).slice(0,2);assert.equal(pair.length,Math.min(2,order.length),'two deputies with a unique name token for the comparison');
  await page.locator('#query').fill(`${pair[0]} gastou mais que ${pair[1]}?`);await page.locator('#query').press('Enter');
  await page.waitForSelector('.answer-bars');assert.equal(await page.locator('.answer-row').count(),2);checks.push('search compares two people');
  const body=await page.locator('body').innerText();assert.doesNotMatch(body,/fict[íi]ci|demonstra[çt]/i,'no fictional wording');
  assert.match(await page.locator('#projetos').innerText(),data.domains.includes('projetos')?/Atividade do mandato/:/ainda não foram coletados/);checks.push('no fictional wording; uncollected sections say so');
  assert.equal((await page.request.get(base+'/_headers')).status(),404);
  assert.equal((await page.request.get(base+'/data/raw/annual/Ano-2025.csv.zip')).status(),404);checks.push('raw data and _headers not served');
  for(const width of [390,768,1360]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`);await page.screenshot({path:path.join(out,`real-${width}.png`),fullPage:true});}
  checks.push('mobile/tablet/desktop overflow');
  assert.deepEqual(errors,[]);checks.push('no JavaScript errors');
  const report={status:'passed',snapshotId:data.index.snapshotId,checks};fs.writeFileSync(path.join(out,'real-browser-verification.json'),JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
