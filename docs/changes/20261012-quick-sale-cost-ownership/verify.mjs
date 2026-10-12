// Local PostgreSQL only. All migrations and fixtures live in a fresh schema in a rolled-back transaction.
// Usage: node --env-file=.env docs/changes/20261012-quick-sale-cost-ownership/verify.mjs [--web]
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getPool } from '../../../apps/backend/dist/db/client.js';
import { buildApp } from '../../../apps/backend/dist/app.js';
import { rebuildQuickSaleCostAllocations } from '../../../apps/backend/dist/quick-sales.js';
const databaseUrl = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname), 'Only a local development database is allowed');
process.env.SESSION_SECRET = 'quick-sale-cost-acceptance-only';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(output, { recursive: true });
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const workspaceId = id(100), batchId = id(101), productId = id(102), channelId = id(103);
const users = [id(1), id(2), id(3)], checks = [], posts = [];
const pool = getPool(), client = await pool.connect();
const execute = client.query.bind(client), originalQuery = pool.query, originalConnect = pool.connect;
// Serialize the shared transaction connection when production endpoints issue Promise.all queries.
let pendingQuery = Promise.resolve();
const rawQuery = (sql, params) => {
  const result = pendingQuery.then(() => execute(sql, params));
  pendingQuery = result.catch(() => {});
  return result;
};
let app, browser, server, transaction = false, savepoint = false;
const query = async (sql, params) => {
  if (/^BEGIN\b/i.test(sql)) { assert.equal(savepoint, false); savepoint = true; return rawQuery('SAVEPOINT api_transaction'); }
  if (sql === 'COMMIT') { savepoint = false; return rawQuery('RELEASE SAVEPOINT api_transaction'); }
  if (sql === 'ROLLBACK') { await rawQuery('ROLLBACK TO SAVEPOINT api_transaction'); savepoint = false; return rawQuery('RELEASE SAVEPOINT api_transaction'); }
  return rawQuery(sql, params);
};
const assertResponse = (response, status = 200) => { assert.equal(response.statusCode, status, response.body); return response.json(); };
try {
  await rawQuery('BEGIN'); transaction = true;
  const schema = `quick_sale_cost_test_${randomUUID().replaceAll('-', '')}`;
  await rawQuery(`CREATE SCHEMA "${schema}"`);
  await rawQuery(`SET LOCAL search_path TO "${schema}"`);
  for (const file of (await readdir(path.join(root, 'apps/backend/migrations'))).filter(file => file.endsWith('.sql')).sort()) await rawQuery(await readFile(path.join(root, 'apps/backend/migrations', file), 'utf8'));
  await rawQuery(await readFile(path.join(root, 'apps/backend/migrations/024_quick_sale_item_cost_allocations.sql'), 'utf8'));
  checks.push('Fresh migrations and repeated migration 024');
  for (const [index, userId] of [...users, id(4)].entries()) await rawQuery('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)', [userId, ['卖出成员', '付款成员', '承担成员', '批次外成员'][index], 'not-a-login-hash']);
  await rawQuery("INSERT INTO workspaces(id,name,kind,created_by) VALUES($1,'成本测试工作区','collaborative',$2)", [workspaceId, users[0]]);
  await rawQuery("INSERT INTO collaboration_batches(id,workspace_id,name,created_by) VALUES($1,$2,'成本测试批次',$3)", [batchId, workspaceId, users[0]]);
  for (const userId of users) {
    await rawQuery("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'editor')", [workspaceId, userId]);
    await rawQuery("INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,'owner')", [batchId, userId]);
  }
  await rawQuery("INSERT INTO products(id,workspace_id,name,created_by,updated_by) VALUES($1,$2,'测试库存',$3,$3)", [productId, workspaceId, users[0]]);
  await rawQuery("INSERT INTO manual_channels(id,workspace_id,name,created_by) VALUES($1,$2,'测试采购渠道',$3)", [channelId, workspaceId, users[0]]);
  pool.query = query; pool.connect = async () => ({ query, release() {} });
  app = await buildApp(); app.log.level = 'silent'; await app.ready();
  const token = app.jwt.sign({ sub: users[0], sessionVersion: 0 }), cookie = `thunderledger_session=${token}`;
  const request = (method, suffix, payload, authenticated = true) => app.inject({ method, url: `/api/batches/${batchId}/${suffix}`, headers: authenticated ? { cookie } : {}, ...(payload === undefined ? {} : { payload }) });
  const manual = (overrides = {}) => ({ name: '临时商品', quantity: 1, cost: '10.01', inventoryConsumptions: [], payerUserId: users[1], costShares: [{ userId: users[0], amount: '4.00' }, { userId: users[2], amount: '6.01' }], ...overrides });
  const order = items => ({ totalPrice: '30.00', sellerUserId: users[0], occurredAt: '2026-10-12T04:00:00Z', items });
  const create = async items => assertResponse(await request('POST', 'quick-sales', order(items))).id;
  const detail = async saleId => assertResponse(await request('GET', `quick-sales/${saleId}`));
  const allocations = async saleId => (await rawQuery('SELECT allocation_type AS type,user_id AS "userId",amount_cents::int AS amount FROM quick_sale_cost_allocations WHERE quick_sale_id=$1 ORDER BY allocation_type,user_id', [saleId])).rows;
  const expected = (burdenA, burdenC, payerB) => [{ type: 'burden', userId: users[0], amount: burdenA }, { type: 'burden', userId: users[2], amount: burdenC }, { type: 'payer', userId: users[1], amount: payerB }];
  const singleId = await create([manual()]);
  assert.deepEqual(await allocations(singleId), expected(400, 601, 1001));
  const singleDetail = await detail(singleId);
  assert.equal(singleDetail.items[0].costAllocationSource, 'manual');
  assert.equal(singleDetail.inventoryConsumedCost, '0.00');
  assert.equal(singleDetail.items[0].costAllocations.find(row => row.allocationType === 'payer').userId, users[1]);
  checks.push('Manual payer differs from seller; multiple burdens conserved; detail exposes ownership');
  for (const badItem of [manual({ payerUserId: undefined }), manual({ costShares: [] }), manual({ costShares: [{ userId: users[2], amount: '10.00' }] }), manual({ payerUserId: id(4) }), manual({ costShares: [{ userId: id(4), amount: '10.01' }] }), manual({ costShares: [{ userId: users[0], amount: '4.00' }, { userId: users[0], amount: '6.01' }] })]) assertResponse(await request('POST', 'quick-sales', order([badItem])), 400);
  const zeroId = await create([manual({ cost: '0.00', costShares: [{ userId: users[2], amount: '0.00' }] })]);
  assert.equal((await detail(zeroId)).items[0].costAllocationSource, 'manual');
  assert.equal((await allocations(zeroId)).reduce((sum, row) => sum + row.amount, 0), 0);
  checks.push('Missing/duplicate/mismatched/cross-batch ownership rejected; zero cost accepted');
  assertResponse(await request('POST', 'quick-sales', order([manual()]), false), 401);
  await rawQuery("UPDATE batch_members SET role='viewer' WHERE batch_id=$1 AND user_id=$2", [batchId, users[0]]);
  assertResponse(await request('POST', 'quick-sales', order([manual()])), 403);
  await rawQuery("UPDATE batch_members SET role='owner' WHERE batch_id=$1 AND user_id=$2", [batchId, users[0]]);
  await rawQuery("UPDATE collaboration_batches SET status='closed' WHERE id=$1", [batchId]);
  assertResponse(await request('POST', 'quick-sales', order([manual()])), 409);
  await rawQuery("UPDATE collaboration_batches SET status='open' WHERE id=$1", [batchId]);
  checks.push('Authentication, viewer and closed batch restrictions');
  const purchaseInput = { productId, channelId, payerUserId: users[1], quantity: 10, totalCost: '100.00', costShares: [{ userId: users[2], amount: '100.00' }], occurredAt: '2026-10-11T04:00:00Z' };
  const purchaseId = assertResponse(await request('POST', 'purchases', purchaseInput)).id;
  const linked = { name: '库存商品', quantity: 1, cost: '20.00', inventoryConsumptions: [{ productId, quantity: 1 }] };
  assertResponse(await request('POST', 'quick-sales', order([{ ...linked, payerUserId: users[0] }])), 400);
  const mixedId = await create([manual(), linked]);
  assert.deepEqual(await allocations(mixedId), expected(400, 2601, 3001));
  assert.equal((await detail(mixedId)).inventoryConsumedCost, '10.00');
  const rec = assertResponse(await request('POST', 'settlements/recommendation', { saleIds: [], quickSaleIds: [mixedId] }));
  assert.equal(rec.costTotal, '30.01');
  assert.equal(rec.costShares.find(row => row.userId === users[2]).amount, '26.01');
  const settlementInput = { saleIds: [], quickSaleIds: [mixedId], expenseIds: [], profitShares: users.map((userId, index) => ({ userId, percentage: index ? 0 : 100 })) };
  const preview = assertResponse(await request('POST', 'settlements/preview', settlementInput));
  assert.equal(preview.members.find(row => row.userId === users[1]).purchasesPaid, '30.01');
  assert.equal(preview.members.find(row => row.userId === users[2]).costShare, '26.01');
  assert.equal(preview.members.reduce((sum, row) => sum + Math.round(Number(row.net) * 100), 0), 0);
  checks.push('Mixed inventory/manual allocation and real settlement recommendation/preview');
  assertResponse(await request('PATCH', `purchases/${purchaseId}`, { ...purchaseInput, payerUserId: users[0], costShares: [{ userId: users[0], amount: '100.00' }], costCorrectionReason: '测试更正归属' }));
  const after = await allocations(mixedId);
  assert.deepEqual(after, [{ type: 'burden', userId: users[0], amount: 2400 }, { type: 'burden', userId: users[2], amount: 601 }, { type: 'payer', userId: users[0], amount: 2000 }, { type: 'payer', userId: users[1], amount: 1001 }]);
  await rebuildQuickSaleCostAllocations({ query }, mixedId);
  assert.deepEqual(await allocations(mixedId), after);
  checks.push('Actual purchase correction and repeated rebuild preserve manual ownership');
  const legacyId = id(200), legacyItemId = id(201);
  await rawQuery("INSERT INTO quick_sales(id,batch_id,total_price_cents,seller_user_id,occurred_at,created_by) VALUES($1,$2,1000,$3,'2026-10-12T03:00:00Z',$3)", [legacyId, batchId, users[0]]);
  await rawQuery("INSERT INTO quick_sale_items(id,quick_sale_id,position,name,quantity,cost_cents) VALUES($1,$2,0,'历史临时商品',1,501)", [legacyItemId, legacyId]);
  await rebuildQuickSaleCostAllocations({ query }, legacyId);
  assert.deepEqual(await allocations(legacyId), [{ type: 'burden', userId: users[0], amount: 501 }, { type: 'payer', userId: users[0], amount: 501 }]);
  assert.equal((await detail(legacyId)).items[0].costAllocationSource, 'legacy_seller');
  const reversedId = await create([linked]);
  const inventoryBefore = assertResponse(await request('GET', 'inventory'))[0].availableQuantity;
  assertResponse(await request('POST', `quick-sales/${reversedId}/reversals`, { reason: '测试撤销' }));
  assert.equal(assertResponse(await request('GET', 'inventory'))[0].availableQuantity, inventoryBefore + 1);
  assertResponse(await request('POST', `quick-sales/${reversedId}/reversals`, { reason: '重复撤销' }), 409);
  const billId = assertResponse(await request('POST', 'settlements', { ...settlementInput, quickSaleIds: [singleId] })).id;
  assert.ok(billId);
  assertResponse(await request('POST', `quick-sales/${singleId}/reversals`, { reason: '已结账' }), 409);
  checks.push('Legacy fallback, reversal restores inventory, settled sale reversal refused');
  if (process.argv.includes('--web')) {
    const dist = path.join(root, 'apps/web/dist');
    server = createServer(async (req, res) => {
      try {
        if (req.url.startsWith('/api/')) {
          let raw = ''; for await (const chunk of req) raw += chunk;
          if (req.method === 'POST' && req.url.endsWith('/quick-sales')) posts.push(JSON.parse(raw));
          const response = await app.inject({ method: req.method, url: req.url, headers: { cookie, 'content-type': 'application/json' }, ...(raw ? { payload: JSON.parse(raw) } : {}) });
          res.writeHead(response.statusCode, { 'content-type': 'application/json' }); res.end(response.body); return;
        }
        const requested = req.url.split('?')[0];
        const file = path.join(dist, requested.startsWith('/assets/') ? requested.slice(1) : 'index.html');
        const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
        res.writeHead(200, { 'content-type': type }); res.end(await readFile(file));
      } catch (error) { res.writeHead(500); res.end('Acceptance server error'); console.error(error); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
    const { chromium } = await import(modulePath ? pathToFileURL(modulePath) : 'playwright');
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    for (const width of [390, 360]) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 800 }, isMobile: true, deviceScaleFactor: 1 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const at = name => page.locator(`[data-ai-id="${name}"]`), input = name => at(name).locator('input');
      const prefix = 'quick-sale-item-item-0';
      await page.goto(`${origin}/batches/${batchId}/quick-sales/new`);
      await at(`${prefix}-payer`).waitFor();
      assert.equal(await at(`${prefix}-payer`).inputValue(), '');
      await input('quick-sale-total-price').fill('30.00');
      await input(`${prefix}-name`).fill('移动端临时商品');
      await input(`${prefix}-cost`).fill('10.01');
      await at('quick-sale-submit').click();
      await page.getByText('未关联库存的商品需选择付款人，且成本承担合计须等于本单成本', { exact: true }).waitFor();
      assert.equal(posts.length, width === 390 ? 0 : 1);
      await at(`${prefix}-payer`).selectOption(users[1]);
      await at(`${prefix}-share-add`).click();
      await at(`${prefix}-share-add`).click();
      await at(`${prefix}-share-share-1-member`).selectOption(users[2]);
      await at(`${prefix}-share-distribute`).click();
      assert.equal(await at(`${prefix}-share-share-0-amount`).inputValue(), '5.00');
      assert.equal(await at(`${prefix}-share-share-1-amount`).inputValue(), '5.01');
      await at(`${prefix}-share-add`).click();
      await at(`${prefix}-share-share-2-remove`).click();
      assert.equal(await at(`${prefix}-share-share-1-amount`).inputValue(), '5.01');
      // The linked switch and chooser must hide ownership only after actual inventory selection.
      await at(`${prefix}-link-toggle`).click();
      await at(`${prefix}-payer`).waitFor();
      await at(`${prefix}-inventory-pick`).click();
      await at(`inventory-picker-item-${productId}`).click();
      await at('inventory-picker-confirm').click();
      await at(`${prefix}-ownership-inventory`).waitFor();
      assert.equal(await at(`${prefix}-payer`).count(), 0);
      await at(`${prefix}-link-toggle`).click();
      assert.equal(await at(`${prefix}-payer`).inputValue(), users[1]);
      assert.equal(await at(`${prefix}-share-share-1-amount`).inputValue(), '5.01');
      const ids = await page.locator('[data-ai-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-ai-id')));
      assert.equal(new Set(ids).size, ids.length, 'Unique data-ai-id');
      assert.ok(ids.every(value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.locator('.van-toast').waitFor({ state: 'hidden' });
      for (const control of await at(`${prefix}-ownership`).locator('select,input').all()) {
        const box = await control.boundingBox(); assert.ok(box.height >= 44);
        const frame = await control.locator('..').evaluate(node => { const style = getComputedStyle(node, '::before'); return { top: style.top, bottom: style.bottom }; });
        assert.deepEqual(frame, { top: '4px', bottom: '4px' });
        await control.focus(); assert.equal(await control.evaluate(node => node === document.activeElement), true);
      }
      await at(`${prefix}-ownership`).screenshot({ path: path.join(output, `ownership-${width}.png`) });
      await page.screenshot({ path: path.join(output, `form-${width}.png`), fullPage: true });
      const submit = page.waitForResponse(response => response.url().endsWith('/quick-sales') && response.request().method() === 'POST');
      await at('quick-sale-submit').click();
      const saved = await submit; assert.equal(saved.status(), 200, await saved.text());
      await page.waitForURL(/quick-sales\/[0-9a-f-]+$/);
      await page.getByText('付款人：付款成员 · ¥10.01', { exact: true }).waitFor();
      await page.getByText('成本承担：承担成员 · ¥5.01', { exact: true }).waitFor();
      assert.equal(posts.at(-1).items[0].payerUserId, users[1]);
      assert.deepEqual(posts.at(-1).items[0].costShares.map(row => row.amount), ['5.00', '5.01']);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.locator('.van-toast').waitFor({ state: 'hidden' });
      await page.screenshot({ path: path.join(output, `detail-${width}.png`), fullPage: true });
      assert.deepEqual(errors, []); await page.close();
      checks.push(`Mobile ${width}: required validation, add/remove/equal split, inventory toggle draft, real save/detail, IDs and no overflow`);
    }
  }
  assert.equal(savepoint, false);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, database: 'isolated local schema; outer transaction rolled back', web: Boolean(browser) }, null, 2));
  console.log(`PASS: ${checks.length} acceptance groups`);
  checks.forEach(check => console.log(`- ${check}`));
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  if (app) await app.close();
  pool.query = originalQuery; pool.connect = originalConnect;
  if (transaction) await rawQuery('ROLLBACK');
  client.release(); await pool.end();
}
