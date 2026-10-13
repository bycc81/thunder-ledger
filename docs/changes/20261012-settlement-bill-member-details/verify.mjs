// Local PostgreSQL only. All migrations and fixtures live in a fresh schema in a rolled-back transaction.
// Usage: node --env-file=.env docs/changes/20261012-settlement-bill-member-details/verify.mjs [--web]
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getPool } from '../../../apps/backend/dist/db/client.js';
import { buildApp } from '../../../apps/backend/dist/app.js';
const databaseUrl = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname), 'Only a local development database is allowed');
process.env.SESSION_SECRET = 'bill-member-details-acceptance-only';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(output, { recursive: true });
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const workspaceId = id(100), batchId = id(101), productId = id(102), channelId = id(103);
const users = [id(1), id(2), id(3)], checks = [];
let failSnapshot = false, drift = false, readOnly = false; const statements = []; let snapshotWrites = 0;
const pool = getPool(), client = await pool.connect();
const execute = client.query.bind(client), originalQuery = pool.query, originalConnect = pool.connect;
// Serialize the shared transaction connection when production endpoints issue Promise.all queries.
let pendingQuery = Promise.resolve();
const rawQuery = (sql, params) => {
  const result = pendingQuery.then(() => execute(sql, params));
  pendingQuery = result.catch(() => {});
  return result;
};
let app, browser, transaction = false, savepoint = false;
const query = async (sql, params) => {
  if (/^BEGIN\b/i.test(sql)) { readOnly = sql.includes('READ ONLY'); assert.equal(savepoint, false); savepoint = true; return rawQuery('SAVEPOINT api_transaction'); }
  if (sql === 'COMMIT') { readOnly = false; savepoint = false; return rawQuery('RELEASE SAVEPOINT api_transaction'); }
  if (sql === 'ROLLBACK') { readOnly = false; await rawQuery('ROLLBACK TO SAVEPOINT api_transaction'); savepoint = false; return rawQuery('RELEASE SAVEPOINT api_transaction'); }
  if (readOnly) { assert.match(sql.trim(), /^SELECT\b/i); assert.doesNotMatch(sql, /FOR UPDATE/i); }
  statements.push(sql);
  if (failSnapshot && sql.startsWith('INSERT INTO settlement_bill_member_details') && ++snapshotWrites === 3) throw new Error('Injected snapshot failure');
  if (drift && sql.startsWith('SELECT a.quick_sale_id')) {
    drift = false;
    await rawQuery("UPDATE quick_sale_cost_allocations SET amount_cents=amount_cents+100 WHERE quick_sale_id=ANY($1::uuid[]) AND allocation_type='burden'", params);
  }
  return rawQuery(sql, params);
};
const assertResponse = (response, status = 200) => { assert.equal(response.statusCode, status, response.body); return response.json(); };
try {
  await rawQuery('BEGIN'); transaction = true;
  const schema = `bill_member_details_test_${randomUUID().replaceAll('-', '')}`;
  await rawQuery(`CREATE SCHEMA "${schema}"`);
  await rawQuery(`SET LOCAL search_path TO "${schema}"`);
  for (const file of (await readdir(path.join(root, 'apps/backend/migrations'))).filter(file => file.endsWith('.sql')).sort()) await rawQuery(await readFile(path.join(root, 'apps/backend/migrations', file), 'utf8'));
  await rawQuery(await readFile(path.join(root, 'apps/backend/migrations/025_settlement_bill_member_details.sql'), 'utf8'));
  checks.push('Fresh migrations and repeated migration 025');
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

  const purchaseInput = { productId, channelId, payerUserId: users[1], quantity: 10, totalCost: '100.00', costShares: [{ userId: users[0], amount: '40.00' }, { userId: users[1], amount: '60.00' }], occurredAt: '2026-10-11T04:00:00Z' };
  const purchase = assertResponse(await request('POST', 'purchases', purchaseInput));
  const order = { totalPrice: '30.00', sellerUserId: users[0], occurredAt: '2026-10-12T04:00:00Z' };
  const manual = { name: '独立小卡', quantity: 1, cost: '8.00', inventoryConsumptions: [], payerUserId: users[0], costShares: [{ userId: users[1], amount: '8.00' }] };
  const linked = { name: '组合专辑', quantity: 1, cost: '12.00', inventoryConsumptions: [{ productId, quantity: 1 }] };
  const normalId = assertResponse(await request('POST', 'sales', { ...order, productId, quantity: 1, feeMode: 'amount', feeAmount: '1.00' })).id;
  const quickId = assertResponse(await request('POST', 'quick-sales', { ...order, sellerUserId: users[1], items: [linked, manual] })).id;
  const expense = async (name, amount, link = {}) => assertResponse(await request('POST', 'expenses', { name, amount, type: 'shipping', payerUserId: users[1], occurredAt: order.occurredAt, ...link })).id;
  const linkedFee = await expense('组合邮费', '2.00', { quickSaleId: quickId });
  const independentFee = await expense('独立费用', '3.00');
  const selection = { saleIds: [normalId], quickSaleIds: [quickId], expenseIds: [independentFee] };
  const profitShares = users.map((userId, index) => ({ userId, percentage: index === 2 ? 0 : 50 }));
  const input = { ...selection, profitShares };
  const preview = assertResponse(await request('POST', 'settlements/preview', input));
  assert.equal(preview.costTotal, '30.00'); assert.equal(preview.profitTotal, '24.00');
  const pendingDetails = [];
  for (const userId of users) pendingDetails.push(assertResponse(await request('POST', `settlements/members/${userId}/details`, selection)));
  const confirmed = assertResponse(await request('POST', 'settlements', input));
  const { id: billId, ...confirmation } = confirmed;
  assert.deepEqual(confirmation, preview, 'snapshot insertion does not alter financial response');
  const detailPath = (bill = billId, user = users[0]) => `settlements/${bill}/members/${user}/details`;
  const snapshots = [];
  for (const [i, userId] of users.entries()) {
    const actual = assertResponse(await request('GET', detailPath(billId, userId)));
    assert.deepEqual(actual, { ...pendingDetails[i], snapshotStatus: 'confirmed' }); snapshots.push(actual);
    const member = preview.members.find(row => row.userId === userId);
    for (const key of ['costShare', 'purchasesPaid', 'expensesPaid', 'salesReceived']) assert.equal(actual.totals[key], member[key]);
    assert.equal(actual.issues.length, 0);
  }
  assert.equal(snapshots[0].transactions[0].source, 'quick_sale');
  assert.equal(snapshots[0].transactions[0].quickItems.length, 2);
  assert.equal(snapshots[1].expenses.length, 2);
  assert.ok(snapshots[1].expenses.some(row => row.id === linkedFee));
  checks.push('Confirmed snapshot equals pending details and original preview; both sales, manual/inventory quick items, fees, zero member, stable order');
  assertResponse(await request('POST', 'settlements', input), 409);
  checks.push('Duplicate settlement retains conflict behavior');

  // Any failure after earlier member snapshots have been written must undo the entire bill.
  const retryQuick = assertResponse(await request('POST', 'quick-sales', { ...order, items: [manual] })).id;
  const retryFee = await expense('待结邮费', '2.00', { quickSaleId: retryQuick });
  const retryInput = { saleIds: [], quickSaleIds: [retryQuick], expenseIds: [], profitShares };
  const beforeCounts = async () => (await rawQuery(`SELECT (SELECT COUNT(*) FROM settlement_bills)::int AS bills,(SELECT COUNT(*) FROM settlement_bill_member_details)::int AS details,(SELECT COUNT(*) FROM settlement_bill_quick_sales)::int AS quick,(SELECT COUNT(*) FROM settlement_bill_expenses)::int AS expenses,(SELECT COUNT(*) FROM settlement_member_results)::int AS members`)).rows[0];
  const before = await beforeCounts();
  failSnapshot = true;
  assertResponse(await request('POST', 'settlements', retryInput), 500);
  failSnapshot = false;
  assert.deepEqual(await beforeCounts(), before);
  assert.equal((await rawQuery('SELECT COUNT(*)::int AS n FROM settlement_bill_expenses WHERE expense_id=$1', [retryFee])).rows[0].n, 0);
  checks.push('Third-member snapshot failure rolls back bill, sale/fee bindings, member results and earlier snapshots');
  drift = true;
  assertResponse(await request('POST', 'settlements', retryInput), 409);
  assert.deepEqual(await beforeCounts(), before);
  checks.push('Allocation drift relative to computed results rejects confirmation and rolls back');
  const retryBill = assertResponse(await request('POST', 'settlements', retryInput)).id;

  const longIds = [];
  for (let i = 0; i < 26; i++) longIds.push(assertResponse(await request('POST', 'quick-sales', { ...order, items: [{ ...manual, name: `很长的商品名称用于移动端明细换行和滚动核对·专辑小卡组合第${i + 1}件` }] })).id);
  const longBill = assertResponse(await request('POST', 'settlements', { saleIds: [], quickSaleIds: longIds, expenseIds: [], profitShares })).id;

  // Actual purchase correction rebuilds current allocation rows but must not rewrite the bill.
  assertResponse(await request('PATCH', `purchases/${purchase.id}`, { ...purchaseInput, totalCost: '120.00', costShares: [{ userId: users[0], amount: '48.00' }, { userId: users[1], amount: '72.00' }], costCorrectionReason: '隔离测试采购更正' }));
  for (const [i, userId] of users.entries()) assert.deepEqual(assertResponse(await request('GET', detailPath(billId, userId))), snapshots[i]);
  await rawQuery("UPDATE users SET username='后来改名' WHERE id=$1", [users[1]]);
  await rawQuery("UPDATE products SET name='后来修改库存名称' WHERE id=$1", [productId]);
  await rawQuery("UPDATE quick_sale_items SET name='后来修改商品项' WHERE quick_sale_id=$1", [quickId]);
  await rawQuery('UPDATE quick_sale_cost_allocations SET amount_cents=999999 WHERE quick_sale_id=$1', [quickId]);
  const readStart = statements.length;
  for (const [i, userId] of users.entries()) assert.deepEqual(assertResponse(await request('GET', detailPath(billId, userId))), snapshots[i]);
  assert.ok(!statements.slice(readStart).some(sql => /FROM (sale_cost_allocations|quick_sale_cost_allocations|quick_sale_items)\b/.test(sql)));
  checks.push('Actual purchase correction, changed current names and allocation rows leave confirmed snapshots unchanged; GET only reads saved snapshot');

  // Emulate a pre-025 bill. Never infer historical allocation from current records.
  await rawQuery('DELETE FROM settlement_bill_member_details WHERE settlement_bill_id=$1', [retryBill]);
  await rawQuery("UPDATE quick_sale_items SET name='历史来源当前名字',cost_cents=99999 WHERE quick_sale_id=$1", [retryQuick]);
  await rawQuery('DELETE FROM quick_sale_cost_allocations WHERE quick_sale_id=$1', [retryQuick]);
  const legacyStart = statements.length;
  const legacy = assertResponse(await request('GET', detailPath(retryBill, users[1])));
  assert.equal(legacy.snapshotStatus, 'legacy'); assert.ok(legacy.notice.includes('未保存'));
  assert.equal(legacy.totals.costTotal, '8.00'); assert.equal(legacy.totals.costShare, '8.00');
  assert.equal(legacy.transactions[0].productName, '独立小卡'); assert.equal(legacy.transactions[0].cost, '8.00');
  assert.equal(legacy.transactions[0].costShare, null); assert.deepEqual(legacy.transactions[0].allocations, []);
  assert.equal(legacy.transactions[0].quickItems.length, 0); assert.equal(legacy.expenses.length, 1);
  assert.ok(!statements.slice(legacyStart).some(sql => /FROM (sale_cost_allocations|quick_sale_cost_allocations|quick_sale_items)\b/.test(sql)));
  checks.push('Legacy bill displays immutable sales/fees/member summaries and explicitly unknown allocations, never current ledger');

  assertResponse(await request('GET', detailPath(), undefined, false), 401);
  assertResponse(await request('GET', detailPath(billId, id(4))), 404);
  assertResponse(await request('GET', detailPath(id(999))), 404);
  assertResponse(await request('GET', detailPath('invalid')), 400);
  const otherBatch = id(900);
  await rawQuery("INSERT INTO collaboration_batches(id,workspace_id,name,created_by) VALUES($1,$2,'其他批次',$3)", [otherBatch, workspaceId, users[0]]);
  await rawQuery("INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,'owner')", [otherBatch, users[0]]);
  assertResponse(await app.inject({ method: 'GET', url: `/api/batches/${otherBatch}/${detailPath()}`, headers: { cookie } }), 404);
  const outsiderCookie = `thunderledger_session=${app.jwt.sign({ sub: id(4), sessionVersion: 0 })}`;
  assertResponse(await app.inject({ method: 'GET', url: `/api/batches/${batchId}/${detailPath()}`, headers: { cookie: outsiderCookie } }), 404);
  await rawQuery("UPDATE batch_members SET role='viewer' WHERE batch_id=$1 AND user_id=$2", [batchId, users[0]]);
  assertResponse(await request('GET', detailPath()));
  await rawQuery("UPDATE collaboration_batches SET status='closed' WHERE id=$1", [batchId]);
  assertResponse(await request('GET', detailPath()));
  await rawQuery('DELETE FROM batch_members WHERE batch_id=$1 AND user_id=$2', [batchId, users[1]]);
  assert.deepEqual(assertResponse(await request('GET', detailPath(billId, users[1]))), snapshots[1]);
  checks.push('401/404/400, cross-batch and outside access; viewer, closed batch and departed target member remain readable');

  if (process.argv.includes('--web')) {
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH) : 'playwright');
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const origin = process.env.WEB_ORIGIN || 'http://127.0.0.1:5665';
    for (const width of [390, 425]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
      const errors = [], requests = [];
      page.on('pageerror', err => errors.push(err.message));
      let failNext = false, delayed = false, releaseDelayed, delayedStarted;
      await page.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()).pathname;
        requests.push(url);
        if (url.endsWith('/details') && failNext) { failNext = false; await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"测试明细加载失败"}' }); return; }
        const response = await app.inject({ method: req.method(), url, headers: { cookie, 'content-type': 'application/json' }, ...(req.postData() ? { payload: JSON.parse(req.postData()) } : {}) });
        if (url.endsWith('/details') && delayed) { delayed = false; delayedStarted?.(); await new Promise(resolve => { releaseDelayed = resolve; }); }
        await route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
      });
      const at = name => page.locator(`[data-ai-id="${name}"]`);
      const open = user => at(`settlement-detail-member-details-${user}`);
      const body = at('settlement-member-details-body');
      const stable = () => page.waitForFunction(() => { const el = document.querySelector('[data-ai-id="settlement-member-details-popup"]'); if (!el) return false; const box = el.getBoundingClientRect(); return Math.abs(box.top - innerHeight * .1) < 1; });
      const shot = name => page.screenshot({ path: path.join(output, `${width}-${name}.png`), fullPage: false });
      await page.goto(`${origin}/batches/${batchId}/settlements/${billId}`);
      await open(users[0]).waitFor();
      assert.ok((await open(users[0]).boundingBox()).height >= 44);
      await shot('bill');
      await open(users[0]).click();
      await at('settlement-member-details-summary').waitFor(); await stable();
      assert.ok((await at('settlement-member-details-snapshot-notice').innerText()).includes('确认时保存'));
      assert.ok((await at('settlement-member-details-formula').innerText()).includes('账单确认时结果'));
      assert.equal(await at('settlement-member-details-mismatch').count(), 0);
      await shot('confirmed-cost');
      await at(`settlement-member-details-source-sale-${normalId}`).locator('summary').click();
      const inventory = at(`settlement-member-details-inventory-sale-${normalId}`);
      assert.ok((await inventory.innerText()).includes('当前库存参考'));
      const popupPromise = page.waitForEvent('popup'); await inventory.click(); const reference = await popupPromise;
      await reference.waitForURL(`**/batches/${batchId}/inventory/${productId}`); await reference.close();
      assert.equal(await at('settlement-member-details-popup').isVisible(), true);
      await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
      for (const category of ['payments', 'expenses', 'receipts', 'profit']) {
        await at(`settlement-member-details-${category}`).locator('summary').click();
        assert.equal(await at(`settlement-member-details-${category}`).getAttribute('open'), '');
      }
      await shot('confirmed-categories');
      assert.ok((await at('settlement-member-details-close').boundingBox()).height >= 44);
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('[data-ai-id="settlement-member-details-body"] *')].filter(node => node.getClientRects().length).every(node => node.getBoundingClientRect().right <= innerWidth + 1)));
      await page.keyboard.press('Escape'); await at('settlement-member-details-popup').waitFor({ state: 'hidden' });
      assert.equal(await open(users[0]).evaluate(node => node === document.activeElement), true);
      const count = () => requests.filter(url => url.endsWith(`/members/${users[0]}/details`)).length;
      const cached = count(); await open(users[0]).click(); await at('settlement-member-details-summary').waitFor(); await stable(); assert.equal(count(), cached);
      await at('settlement-member-details-close').click();
      failNext = true;
      await open(users[1]).click(); await at('settlement-member-details-error').waitFor();
      assert.ok((await at('settlement-member-details-error').innerText()).includes('已确认账单金额保持不变'));
      await shot('error'); await at('settlement-member-details-retry').click(); await at('settlement-member-details-summary').waitFor(); await stable();
      await at('settlement-member-details-expenses').locator('summary').click(); assert.ok((await body.innerText()).includes('组合邮费'));
      await at('settlement-member-details-close').click();
      delayed = true;
      const started = new Promise(resolve => { delayedStarted = resolve; });
      await open(users[2]).click(); await started;
      await at('settlement-member-details-loading').waitFor(); await at('settlement-member-details-close').click();
      await open(users[0]).click(); await at('settlement-member-details-summary').waitFor(); await stable();
      const lateResponse = page.waitForResponse(response => response.url().endsWith(`/members/${users[2]}/details`));
      releaseDelayed();
      await lateResponse;
      assert.ok((await page.locator('.panel-header h2').innerText()).includes('卖出成员'));
      await at('settlement-member-details-close').click();
      delayed = true;
      const routeStarted = new Promise(resolve => { delayedStarted = resolve; });
      await open(users[2]).click(); await routeStarted;
      await page.evaluate(url => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(url), `/batches/${batchId}/settlements/${retryBill}`);
      await at(`settlement-detail-quick-sale-${retryQuick}`).waitFor();
      const oldBillResponse = page.waitForResponse(response => response.url().endsWith(`/members/${users[2]}/details`));
      releaseDelayed(); await oldBillResponse;
      await at('settlement-member-details-popup').waitFor({ state: 'hidden' });
      await open(users[1]).click(); await at('settlement-member-details-summary').waitFor(); await stable();
      assert.ok((await at('settlement-member-details-snapshot-notice').innerText()).includes('历史账单未保存'));
      assert.ok((await body.innerText()).includes('缺少分摊记录'));
      assert.ok((await body.innerText()).includes('独立小卡'));
      assert.equal(await at('settlement-member-details-mismatch').count(), 0);
      await shot('legacy-cost');
      await at('settlement-member-details-expenses').locator('summary').click(); assert.ok((await body.innerText()).includes('待结邮费'));
      await at('settlement-member-details-close').click();
      await page.evaluate(url => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(url), `/batches/${batchId}/settlements/${longBill}`);
      await at(`settlement-detail-quick-sale-${longIds[0]}`).waitFor();
      await open(users[1]).click(); await at('settlement-member-details-summary').waitFor(); await stable();
      assert.equal(await page.locator('[data-ai-id^="settlement-member-details-cost-record-"]').count(), 26);
      await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
      assert.ok(await body.evaluate(node => node.scrollHeight > node.clientHeight));
      assert.ok((await at('settlement-member-details-close').boundingBox()).y < 150);
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('[data-ai-id="settlement-member-details-body"] *')].filter(node => node.getClientRects().length).every(node => node.getBoundingClientRect().right <= innerWidth + 1)));
      await shot('long-list-bottom'); await at('settlement-member-details-close').click();
      assert.equal(errors.length, 0, errors.join('\n')); await page.close();
    }
    checks.push('390×844 and 425×844: confirmed/legacy snapshots, categories, original IDs, 44px, no overflow, focus/Escape, cache, error/retry, stale member/bill requests, long names/26 records and inventory reference');
  }
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  if (browser) await browser.close();
  if (app) await app.close();
  pool.query = originalQuery; pool.connect = originalConnect;
  if (transaction) await rawQuery('ROLLBACK');
  client.release(); await pool.end();
}
