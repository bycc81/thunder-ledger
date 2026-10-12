// Prototype-only mobile acceptance: local HTML with no API/network or business writes.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('./',import.meta.url)),output=path.join(root,'evidence','prototype');
await mkdir(output,{recursive:true});
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH):'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const observed=new Set(),checks=[];
const id=(n)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
try{
 for(const viewport of [{width:390,height:844},{width:430,height:932}]){
  const context=await browser.newContext({viewport,hasTouch:true});const page=await context.newPage();const errors=[],network=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))network.push(request.url())});
  const byId=(value)=>page.locator(`[data-ai-id="${value}"]`);
  const scan=async()=>{
   const ids=await page.locator('[data-ai-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.aiId));
   assert.equal(ids.length,new Set(ids).size,`Duplicate data-ai-id: ${ids.filter((id,index)=>ids.indexOf(id)!==index)}`);
   for(const value of ids){assert.match(value,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);observed.add(value)}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflow');
   if(await byId('settlement-member-details-popup').isVisible()){
    const body=byId('settlement-member-details-body');assert.ok(await body.evaluate(node=>node.scrollWidth<=node.clientWidth),'Popup body overflow');
    const box=await byId('settlement-member-details-popup').boundingBox();assert.ok(Math.abs(box.height-viewport.height*.9)<2,'90dvh popup');
    assert.ok(await byId('settlement-member-details-close').isVisible());
    const closeBox=await byId('settlement-member-details-close').boundingBox();assert.ok(closeBox.width>=44&&closeBox.height>=44);
   }
  };
  const screenshot=async(name)=>{await scan();await page.screenshot({path:path.join(output,`${viewport.width}-${name}.png`),animations:'disabled'})};
  const scenario=async(value)=>byId('prototype-scenario').selectOption(value);
  const openCost=async(index=1)=>{await byId(`settlement-cost-share-${id(index)}`).click();await byId('settlement-member-details-popup').waitFor()};
  const close=async()=>{await byId('settlement-member-details-close').click();assert.equal(await byId('settlement-member-details-popup').isVisible(),false)};
  await page.goto(pathToFileURL(path.join(root,'prototype','index.html')).href);
  await screenshot('step2');await openCost();await screenshot('step2-cost-popup');
  assert.match(await byId('settlement-member-details-summary').innerText(),/520\.00/);
  assert.equal(await byId('settlement-member-details-profit').count(),0);
  assert.equal(await byId('settlement-member-details-cost').getAttribute('open'),'');
  await byId(`settlement-member-details-source-quick-sale-${id(21)}`).locator('summary').click();
  assert.match(await byId(`settlement-member-details-source-quick-sale-${id(21)}`).innerText(),/695\.00|400\.00/);
  assert.match(await byId(`settlement-member-details-source-quick-sale-${id(21)}`).innerText(),/不推算补齐/);
  await screenshot('quick-source');
  await byId(`settlement-member-details-source-sale-${id(11)}`).locator('summary').click();
  await byId(`settlement-member-details-inventory-sale-${id(11)}`).click();
  assert.match(await byId(`settlement-member-details-source-sale-${id(11)}`).innerText(),/当前库存不代表销售发生前/);
  await screenshot('normal-source');
  await close();assert.equal(await byId(`settlement-cost-share-${id(1)}`).evaluate(node=>node===document.activeElement),true);
  await openCost(2);assert.match(await byId('settlement-member-details-summary').innerText(),/475\.07/);
  await byId('settlement-member-details-payments').locator('summary').click();assert.match(await byId('settlement-member-details-payments').innerText(),/0\.00/);
  await byId('settlement-member-details-expenses').locator('summary').click();assert.match(await byId('settlement-member-details-expenses').innerText(),/没有由你垫付/);
  await byId('settlement-member-details-receipts').locator('summary').click();assert.match(await byId('settlement-member-details-receipts').innerText(),/1030\.62/);
  await close();
  await byId('prototype-step-preview').click();await screenshot('step3');
  const openPreview=async(index=1)=>{await byId(`settlement-preview-member-details-${id(index)}`).click();await byId('settlement-member-details-popup').waitFor()};
  await openPreview();assert.equal(await byId('settlement-member-details-body').evaluate(node=>node.scrollTop),0,'Reopened popup starts at summary');await screenshot('step3-result-popup');assert.match(await byId('settlement-member-details-formula').innerText(),/389\.29/);
  for(const category of ['payments','expenses','receipts','profit']){await byId(`settlement-member-details-${category}`).locator('summary').click();await scan()}
  assert.match(await byId('settlement-member-details-profit').innerText(),/332\.52/);
  assert.match(await byId('settlement-member-details-payments').innerText(),/不额外加入应收/);
  await page.keyboard.press('Escape');assert.equal(await byId('settlement-member-details-popup').isVisible(),false);
  assert.equal(await byId(`settlement-preview-member-details-${id(1)}`).evaluate(node=>node===document.activeElement),true);
  await openPreview(2);assert.match(await byId('settlement-member-details-summary').innerText(),/本次应付/);await screenshot('dan-result');await close();
  for(const value of ['loading','error','empty','mismatch','missing','long-name','long']){
   await scenario(value);await openPreview();await screenshot(value);
   if(value==='loading')assert.equal(await byId('settlement-member-details-loading').isVisible(),true);
   if(value==='empty')assert.equal(await byId('settlement-member-details-empty').isVisible(),true);
   if(value==='mismatch'){
    assert.match(await byId('settlement-member-details-mismatch').innerText(),/519\.99/);
    assert.match(await byId(`settlement-member-details-cost-record-sale-${id(11)}`).innerText(),/199\.99/);
    assert.match(await byId('settlement-member-details-summary').innerText(),/389\.29/);
   }
   if(value==='missing')assert.match(await byId(`settlement-member-details-cost-record-quick-sale-${id(21)}`).innerText(),/缺少分摊记录/);
   if(value==='error'){await byId('settlement-member-details-retry').click();await byId('settlement-member-details-cost').waitFor();await screenshot('retry-success')}
   if(value==='long'){
    assert.equal(await byId('settlement-member-details-cost').locator('.transaction').count(),26);
    await byId('settlement-member-details-body').evaluate(node=>node.scrollTop=node.scrollHeight);
    await screenshot('long-bottom');assert.ok(await byId('settlement-member-details-close').isVisible());
   }
   await close();
  }
  await scenario('normal');await openPreview();
  // Native dialog keeps keyboard focus inside the popup.
  for(let i=0;i<18;i++){await page.keyboard.press('Tab');assert.ok(await page.evaluate(()=>document.activeElement===document.querySelector('dialog')||document.querySelector('dialog').contains(document.activeElement)))}
  await page.mouse.click(8,8);assert.equal(await byId('settlement-member-details-popup').isVisible(),false);
  assert.equal(await byId('settlement-next').isDisabled(),true,'Prototype cannot confirm a real bill');
  assert.deepEqual(network,[],'Prototype must not contact APIs');assert.deepEqual(errors,[]);
  checks.push(`${viewport.width}x${viewport.height}: both entries, two members, cost/source/categories, loading/error/retry/empty/mismatch/missing/long-name/long-list, focus/escape/backdrop, unique IDs, no overflow/network/business writes`);
  await context.close();
 }
 const registry=await readFile(path.join(root,'data-ai-id-registry.md'),'utf8');
 for(const[,value]of registry.matchAll(/\| `([^`]+)` \|/g)){if(!value.includes('{'))assert.ok(observed.has(value),`Unobserved registry ID: ${value}`)}
 await writeFile(path.join(output,'result.json'),JSON.stringify({checks,observedIds:[...observed].sort()},null,2));console.log(checks.join('\n'));
}finally{await browser.close()}
