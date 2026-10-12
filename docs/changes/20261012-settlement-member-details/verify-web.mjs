import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {sale,fixture,root,output,id,batchId,members,reset,app,selection} from './fixture.mjs';
const cookie=`thunderledger_session=${app.jwt.sign({sub:id(1),sessionVersion:1})}`;
let browser,server,failDetails=false,delayDetails=0,mismatchDetails=false,detailsCalls=[],posted=[];const checks=[];
try{
 const dist=path.join(root,'apps/web/dist');
 server=createServer(async(req,res)=>{try{
  if(req.url.startsWith('/api/')){let raw='';for await(const chunk of req)raw+=chunk;const payload=raw?JSON.parse(raw):undefined;
   if(req.method==='POST')posted.push({url:req.url,payload});
   if(req.url.endsWith('/details')){detailsCalls.push({url:req.url,payload});if(delayDetails)await new Promise(resolve=>setTimeout(resolve,delayDetails));if(failDetails){res.writeHead(500,{'content-type':'application/json'});res.end('{"message":"明细加载失败，请重试。"}');return}}
   const response=await app.inject({method:req.method,url:req.url,headers:{cookie,'content-type':'application/json'},...(raw?{payload}:{})});
   let body=response.body;if(mismatchDetails&&req.url.endsWith('/details')&&response.statusCode===200){const data=response.json();data.totals.costShare='519.99';body=JSON.stringify(data)}
   res.writeHead(response.statusCode,{'content-type':'application/json'});res.end(body);return;
  }
  const pathname=new URL(req.url,'http://localhost').pathname;const asset=pathname.startsWith('/assets/')?path.basename(pathname):null;res.writeHead(200,{'content-type':asset?.endsWith('.js')?'text/javascript':asset?.endsWith('.css')?'text/css':'text/html'});res.end(await readFile(asset?path.join(dist,'assets',asset):path.join(dist,'index.html')));
 }catch(error){res.writeHead(500);res.end(String(error))}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH?pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH):'playwright');browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const observed=new Set();
 for(const viewport of [{width:390,height:844},{width:430,height:932}]){
  reset();const {normal,allocations}=fixture;failDetails=false;delayDetails=0;mismatchDetails=false;const context=await browser.newContext({viewport,hasTouch:true});const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const byId=value=>page.locator(`[data-ai-id="${value}"]`);const popup=()=>byId('settlement-member-details-popup');
  const snapshot=async(name)=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow');if(await popup().isVisible())assert.ok(await byId('settlement-member-details-body').evaluate(node=>node.scrollWidth<=node.clientWidth),'No popup overflow');const ids=await page.locator('[data-ai-id]').evaluateAll(nodes=>nodes.filter(node=>node.getBoundingClientRect().width>0).map(node=>node.dataset.aiId));assert.equal(ids.length,new Set(ids).size,'Visible IDs unique');ids.forEach(value=>{assert.match(value,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);observed.add(value)});await page.screenshot({path:path.join(output,`${viewport.width}-${name}.png`),animations:'disabled'})};
  const close=async()=>{await byId('settlement-member-details-close').click();await popup().waitFor({state:'hidden'})};
  const open=async(member=1,preview=false)=>{await byId(preview?`settlement-preview-member-details-${id(member)}`:`settlement-cost-share-${id(member)}`).click();await popup().waitFor();await byId('settlement-member-details-cost').waitFor()};
  await page.goto(`${base}/batches/${batchId}/settlements/new`);await byId('settlement-sales-list').waitFor();await byId('settlement-sales-select-all').click();
  // Apply a keyword that hides the selected quick sale; details must include it anyway.
  await byId('settlement-product-keyword').locator('input').fill('普通');await byId('settlement-next').click();await byId('settlement-profit-allocation').waitFor();
  await byId(`settlement-profit-share-${id(1)}`).locator('input').fill('50');await byId(`settlement-profit-share-${id(2)}`).locator('input').fill('50');await byId(`settlement-profit-share-${id(3)}`).locator('input').fill('0');
  const countBefore=detailsCalls.length;await open();assert.deepEqual(detailsCalls.at(-1).payload,{saleIds:[id(11)],quickSaleIds:[id(21)],expenseIds:[id(41)]});assert.match(await byId('settlement-member-details-summary').innerText(),/520\.00/);assert.equal(await byId('settlement-member-details-profit').count(),0);await snapshot('step2');
  await byId(`settlement-member-details-source-quick-sale-${id(21)}`).locator('summary').click();assert.match(await byId(`settlement-member-details-source-quick-sale-${id(21)}`).innerText(),/350\.00/);assert.match(await byId(`settlement-member-details-source-quick-sale-${id(21)}`).innerText(),/未关联库存/);await snapshot('quick-source');
  await byId(`settlement-member-details-source-sale-${id(11)}`).locator('summary').click();assert.match(await byId(`settlement-member-details-source-sale-${id(11)}`).innerText(),/不推算销售前/);await snapshot('normal-source');
  const popupPagePromise=context.waitForEvent('page');await byId(`settlement-member-details-inventory-sale-${id(11)}`).click();const inventoryPage=await popupPagePromise;await inventoryPage.waitForURL(`**/inventory/${id(200)}`);await inventoryPage.close();assert.equal(await popup().isVisible(),true,'Inventory reference preserves parent state');
  await close();assert.equal(await byId(`settlement-cost-share-${id(1)}`).evaluate(node=>node===document.activeElement),true);
  await open();assert.equal(detailsCalls.length,countBefore+1,'Successful details cached');await close();await open(2);assert.match(await byId('settlement-member-details-summary').innerText(),/475\.07/);await close();
  await open(3);assert.match(await byId('settlement-member-details-cost').innerText(),/没有由你承担/);for(const category of ['payments','expenses','receipts']){await byId(`settlement-member-details-${category}`).locator('summary').click();await snapshot(`zero-${category}`)}await close();
  await byId('settlement-next').click();await byId('settlement-preview').waitFor();await open(1,true);assert.equal(detailsCalls.length,countBefore+4,'Preview refresh invalidates cached details');assert.match(await byId('settlement-member-details-formula').innerText(),/166\.01/);await snapshot('step3');
  for(const category of ['payments','expenses','receipts','profit']){await byId(`settlement-member-details-${category}`).locator('summary').click();await snapshot(`category-${category}`)}
  assert.match(await byId('settlement-member-details-payments').innerText(),/995\.07/);assert.match(await byId('settlement-member-details-expenses').innerText(),/52\.25/);assert.match(await byId('settlement-member-details-receipts').innerText(),/349\.22/);
  await page.keyboard.press('Escape');await popup().waitFor({state:'hidden'});assert.equal(await byId(`settlement-preview-member-details-${id(1)}`).evaluate(node=>node===document.activeElement),true);
  // Late request cannot replace a newly selected member after closing.
  await page.getByText('返回',{exact:true}).click();await page.getByText('返回',{exact:true}).click();await byId('settlement-sales-list').waitFor();await byId('settlement-next').click();await byId('settlement-profit-allocation').waitFor();
  delayDetails=1800;await byId(`settlement-cost-share-${id(1)}`).click();await byId('settlement-member-details-loading').waitFor();await snapshot('loading');await close();delayDetails=0;await open(2);await page.waitForTimeout(2000);assert.match(await byId('settlement-member-details-summary').innerText(),/475\.07/);assert.match(await popup().innerText(),/dan · 结算明细/);await close();
  await page.getByText('返回',{exact:true}).click();await byId('settlement-sales-list').waitFor();await byId('settlement-next').click();await byId('settlement-profit-allocation').waitFor();
  failDetails=true;await byId(`settlement-cost-share-${id(1)}`).click();await byId('settlement-member-details-error').waitFor();await snapshot('error');failDetails=false;await byId('settlement-member-details-retry').click();await byId('settlement-member-details-cost').waitFor();await close();
  await page.getByText('返回',{exact:true}).click();await byId('settlement-sales-list').waitFor();await byId('settlement-next').click();await byId('settlement-profit-allocation').waitFor();mismatchDetails=true;await open();await byId('settlement-member-details-mismatch').waitFor();await snapshot('mismatch');assert.match(await byId(`settlement-cost-share-${id(1)}`).innerText(),/520\.00/);mismatchDetails=false;await close();
  await page.getByText('返回',{exact:true}).click();await byId('settlement-sales-list').waitFor();await byId('settlement-next').click();await byId('settlement-profit-allocation').waitFor();fixture.missing=true;await open();await byId('settlement-member-details-missing').waitFor();assert.match(await byId(`settlement-member-details-cost-record-quick-sale-${id(21)}`).innerText(),/缺少分摊/);await snapshot('missing');fixture.missing=false;await close();
  await byId('settlement-next').click();await byId('settlement-preview').waitFor();const previewPayload=posted.filter(row=>row.url.endsWith('/preview')).at(-1).payload;assert.deepEqual(previewPayload,{...selection(),expenseIds:[id(41)],profitShares:[{userId:id(1),percentage:50},{userId:id(2),percentage:50},{userId:id(3),percentage:0}]});
  // Long live records/long name accepted by real endpoint, still scroll below fixed header.
  members[0].username='follow · 用于验证长姓名换行且关闭按钮可见的参与人员';normal[0].productName='普通商品 · 很长的商品名称与组合款式，用于测试金额和来源展开不被挤出';
  for(let n=0;n<24;n++){const row=sale(1000+n,'sale',1,100,200,`2026-10-${String(11-Math.floor(n/12)).padStart(2,'0')}T02:00:00Z`);normal.push(row);allocations.push({saleId:row.id,source:'sale',userId:id(1),username:members[0].username,type:'burden',amountCents:'100'},{saleId:row.id,source:'sale',userId:id(1),username:members[0].username,type:'payer',amountCents:'100'})}
  await page.reload();await byId('settlement-sales-list').waitFor();await byId('settlement-sales-select-all').click();await byId('settlement-next').click();await byId('settlement-profit-allocation').waitFor();await open();assert.equal(await byId('settlement-member-details-cost').locator('.transaction').count(),26);await snapshot('long');await byId('settlement-member-details-body').evaluate(node=>node.scrollTop=node.scrollHeight);await snapshot('long-bottom');const headerBox=await byId('settlement-member-details-close').boundingBox();assert.ok(headerBox.y>0&&headerBox.y<viewport.height*.25);
  await page.keyboard.press('Escape');await popup().waitFor({state:'hidden'});assert.deepEqual(errors,[]);members[0].username='follow';
  checks.push(`UI ${viewport.width}x${viewport.height}: step2/3, sources, stock reference preserving state, hidden selections, formulas, zero states, cache/invalidation, delayed close/member switch, errors/retry/mismatch/missing, long name+26 rows, Escape/focus, unique IDs/no overflow; original preview payload unchanged`);await context.close();
 }

await writeFile(path.join(output,'web-result.json'),JSON.stringify({checks,observedIds:[...observed].sort()},null,2));console.log(checks.join('\n'));
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await app.close()}
