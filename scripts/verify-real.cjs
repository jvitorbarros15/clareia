const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require(path.join(process.env.APPDATA,'npm/node_modules/playwright')));}
const base=process.env.BASE_URL||'http://127.0.0.1:4174',out=path.resolve('output/qa');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({headless:true});const errors=[];
try{const page=await browser.newPage({viewport:{width:1360,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
await page.goto(base);await page.waitForSelector('#total');
const initial=await page.evaluate(async()=>fetch('/api/spending').then(r=>r.json()));const compare=initial.validation.apiComparison,union=initial.validation.sourceKind==='annual-api-union';assert.ok(union||initial.validation.sourceKind==='annual-csv');assert.equal(initial.validation.recordCount,compare.annualRecords+(union?compare.extraInApi:0));
assert.equal(await page.locator('.person').count(),3);assert.equal(await page.locator('#total').innerText(),(initial.totalCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
await page.waitForFunction(()=>[...document.querySelectorAll('.person img')].every(img=>img.complete&&img.naturalWidth>0));
await page.screenshot({path:path.join(out,'real-first-screen.png')});
await page.locator('[data-person="204534"]').click();await page.waitForURL(/person=204534/);await page.waitForFunction(()=>document.querySelector('#content').getAttribute('aria-busy')==='false');
await page.locator('[data-month="2"]').click();await page.waitForURL(/from=2/);await page.waitForFunction(()=>document.querySelector('#content').getAttribute('aria-busy')==='false');
await page.locator('.category').first().click();await page.waitForURL(/category=/);await page.waitForFunction(()=>document.querySelector('#content').getAttribute('aria-busy')==='false');
await page.locator('.supplier').first().click();await page.waitForURL(/supplier=/);await page.waitForFunction(()=>document.querySelector('#content').getAttribute('aria-busy')==='false');
const response=await page.evaluate(async()=>fetch('/api/spending'+location.search).then(r=>r.json()));
assert.equal(await page.locator('#records tbody tr').count(),response.records.length);assert.equal(await page.locator('#total').innerText(),(response.totalCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
await page.locator('[data-record]').first().click();await page.waitForSelector('dialog[open]');assert.match(await page.locator('#dialog-content').innerText(),/Documento/);assert.match(await page.locator('#dialog-content a.primary').getAttribute('href'),/^https:\/\/(www\.camara\.leg\.br\/cotas\/|dadosabertos\.camara\.leg\.br\/api\/v2\/)/);await page.keyboard.press('Escape');
const csvURL=await page.locator('#csv').getAttribute('href');const csv=await page.request.get(base+csvURL);assert.equal(csv.status(),200);assert.equal((await csv.text()).split('\r\n').length-1,response.records.length);
const share=page.url();await page.reload();await page.waitForSelector('#total');assert.equal(page.url(),share);
await page.locator('[data-action=evidence]').click();assert.match(await page.locator('#dialog-content').innerText(),/centavos/);await page.keyboard.press('Escape');
assert.equal((await page.request.get(base+'/api/spending?person=999')).status(),400);assert.equal((await page.request.get(base+'/api/spending?snapshot=unknown')).status(),503);
assert.equal((await page.request.get(base+'/data/raw/annual/Ano-2025.csv.zip')).status(),404);
assert.equal((await page.request.get(base+'/api/spending?snapshot=98d2b15d8a6d73722222cc0dc8e2a9d017391723ee141ef122aba0001e84c7cf')).status(),503);
assert.match(await page.locator('.api-discrepancy').innerText(),union?new RegExp(`${compare.paired} registros.*${compare.missingInApi} .*só no arquivo anual e ${compare.extraInApi} .*só na API`,'s'):new RegExp(`${compare.annualRecords} lançamentos; a API retornou ${compare.apiRecords}\\. Os ${compare.missingInApi} adicionais`));
// The two housing adjustments exist only in versions built before the Câmara dropped them from the file.
const housing='COMPLEMENTAÇÃO DO AUXÍLIO-MORADIA',adjusted=await page.evaluate(async c=>(await fetch('/api/spending?person=160976').then(r=>r.json())).categories.some(x=>x.category===c),housing);
if(adjusted){await page.goto(base+'/?person=160976&category='+encodeURIComponent(housing));await page.waitForFunction(()=>document.querySelector('#content').getAttribute('aria-busy')==='false'&&document.querySelectorAll('[data-record]').length>0);
assert.equal(await page.locator('[data-record]').count(),2);
await page.locator('[data-record]').first().click();await page.waitForSelector('dialog[open]');const adjustment=await page.locator('#dialog-content').innerText();await page.screenshot({path:path.join(out,'real-adjustment-dialog.png')});
assert.doesNotMatch(adjustment,/= Líquido/);assert.match(adjustment,/Glosa\s*Não informado/);assert.match(adjustment,/-R\$\s1\.747,00/);assert.match(adjustment,/sem recálculo/);await page.keyboard.press('Escape');
await page.locator('[data-action=evidence]').click();const evidence=await page.locator('#dialog-content').innerText();assert.match(evidence,/2 lançamentos/);assert.match(evidence,/-R\$\s3\.494,00/);assert.match(evidence,/arquivo anual/);await page.screenshot({path:path.join(out,'real-evidence-dialog.png')});await page.keyboard.press('Escape');}
await page.goto(share);await page.waitForSelector('#total');
assert.equal((await page.request.get(base+'/api/status')).status(),200);assert.equal((await page.request.get(base+'/portraits/999.jpg')).status(),404);
await page.locator('[data-action=reset]').click();await page.waitForFunction(()=>!location.search.includes('category='));await page.waitForFunction(()=>document.querySelector('#content').getAttribute('aria-busy')==='false');
for(const width of [390,768,1360]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`real-${width}.png`),fullPage:true});}
assert.deepEqual(errors,[]);const report={status:'passed',snapshotId:initial.snapshotId,checks:['real profiles','person/month/category/supplier filters','chart/table/CSV totals','source evidence modal','API discrepancy banner (counts and signed difference)','negative adjustment shown without false equation','version-pinned reload','invalid filters and unavailable snapshot','raw data not served','mobile/tablet/desktop overflow','no JavaScript errors']};fs.writeFileSync(path.join(out,'real-browser-verification.json'),JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
