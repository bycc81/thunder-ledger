// Local PostgreSQL only. All migrations and fixtures live in a fresh schema in a rolled-back transaction.
// Usage: node --env-file=.env docs/changes/20261012-transaction-reversal-filter/verify.mjs [--web]
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
process.env.SESSION_SECRET = 'transaction-reversal-acceptance-only';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(output, { recursive: true });
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const workspaceId = id(100), batchId = id(101), productId = id(102), channelId = id(103);
const users = [id(1), id(2), id(3)], checks = [], posts = [];
let failRebuild = false, failMembers = false;
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
  if (failRebuild && sql.includes('FROM inventory_purchases WHERE')) throw new Error('Injected ledger failure');
  return rawQuery(sql, params);
};
const assertResponse = (response, status = 200) => { assert.equal(response.statusCode, status, response.body); return response.json(); };
try {
  await rawQuery('BEGIN'); transaction = true;
  const schema = `transaction_reversal_test_${randomUUID().replaceAll('-', '')}`;
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
  const costItem = { name: '组合测试卡', quantity: 1, cost: '10.00', inventoryConsumptions: [], payerUserId: users[1], costShares: [{ userId: users[0], amount: '10.00' }] };
  const order = { totalPrice: '30.00', sellerUserId: users[0], occurredAt: '2026-10-12T04:00:00Z' };
  const quick = async (items = [costItem], overrides = {}) => assertResponse(await request('POST', 'quick-sales', { ...order, items, ...overrides })).id;
  const normal = async (overrides = {}) => assertResponse(await request('POST', 'sales', { ...order, productId, quantity: 1, ...overrides })).id;
  const expense = async (link = {}, name = '关联邮费') => assertResponse(await request('POST', 'expenses', { ...link, type: 'shipping', name, amount: '2.00', payerUserId: users[1], occurredAt: order.occurredAt })).id;
  const reverse = (source, saleId, reason = '登记错误') => request('POST', `${source}/${saleId}/reversals`, { reason });
  const active = async expenseId => !(await rawQuery('SELECT 1 FROM expense_reversals WHERE expense_id=$1', [expenseId])).rowCount;
  const draft = async () => assertResponse(await request('GET', 'settlements/draft'));
  const purchase = assertResponse(await request('POST', 'purchases', { productId, channelId, payerUserId: users[1], quantity: 20, totalCost: '200.00', costShares: [{ userId: users[0], amount: '200.00' }], occurredAt: '2026-10-11T04:00:00Z' })).id;
  const independentId = await expense({}, '独立材料费');
  const unrelatedSale = await quick(); const unrelatedExpense = await expense({ quickSaleId: unrelatedSale });
  for (const source of ['sales', 'quick-sales']) {
    const saleId = source === 'sales' ? await normal() : await quick([{ ...costItem, inventoryConsumptions: [{ productId, quantity: 1 }], payerUserId: undefined, costShares: undefined }]);
    const link = source === 'sales' ? { saleId } : { quickSaleId: saleId };
    const first = await expense(link), zero = assertResponse(await request('POST', 'expenses', { ...link, type: 'custom', name: '零费用', amount: '0.00', payerUserId: users[1], occurredAt: order.occurredAt })).id;
    const old = await expense(link, '已单独撤销费用'); assertResponse(await reverse('expenses', old, '原撤销原因'));
    const oldRow = (await rawQuery('SELECT reason,created_at,created_by FROM expense_reversals WHERE expense_id=$1', [old])).rows[0];
    const quantityBefore = assertResponse(await request('GET', 'inventory'))[0].availableQuantity;
    const response = assertResponse(await reverse(source, saleId)); assert.equal(response.reversedExpenseCount, 2);
    assert.equal(await active(first), false); assert.equal(await active(zero), false);
    assert.deepEqual((await rawQuery('SELECT reason,created_at,created_by FROM expense_reversals WHERE expense_id=$1', [old])).rows[0], oldRow);
    assert.equal(await active(independentId), true); assert.equal(await active(unrelatedExpense), true);
    assert.equal(assertResponse(await request('GET', 'inventory'))[0].availableQuantity, quantityBefore + 1);
    const alloc = (await rawQuery("SELECT COUNT(*)::int AS count FROM audit_logs WHERE action='expense.reverse' AND metadata->>'transactionId'=$1", [saleId])).rows[0]; assert.equal(alloc.count, 2);
    const candidates = await draft(); assert.ok(!candidates.transactions.some(row => row.id === saleId)); assert.ok(!candidates.expenses.some(row => [first, old, zero].includes(row.id)));
    assertResponse(await reverse(source, saleId), 409);
    assertResponse(await request('POST', 'expenses', { ...link, type: 'custom', name: '不能再关联', amount: '1.00', payerUserId: users[0], occurredAt: order.occurredAt }), 400);
    checks.push(`${source}: cascade multiple/zero fees, preserve prior reversal, independent/unrelated fees, inventory restored, audit/draft, duplicate/link-after-reversal rejected`);
  }
  // A linked expense can be explicitly selected into another historical bill. Never modify that bill.
  const settledSale = await quick();
  const settledInput = { saleIds: [], quickSaleIds: [settledSale], expenseIds: [], profitShares: users.map((userId, index) => ({ userId, percentage: index ? 0 : 100 })) };
  const isolatedPreview = assertResponse(await request('POST', 'settlements/preview', settledInput));
  assert.equal(isolatedPreview.expenseTotal, '0.00');
  const isolatedDetails = assertResponse(await request('POST', `settlements/members/${users[1]}/details`, { saleIds: [], quickSaleIds: [settledSale], expenseIds: [] }));
  assert.equal(isolatedDetails.totals.expensesPaid, '0.00'); assert.deepEqual(isolatedDetails.expenses, []);
  checks.push('Unselected quick-sale fees excluded from preview, member details and confirmed bill');
  const bill = assertResponse(await request('POST', 'settlements', settledInput)).id;
  assert.equal((await rawQuery('SELECT 1 FROM settlement_bill_expenses WHERE expense_id=$1', [unrelatedExpense])).rowCount, 0, 'Unselected quick sale expense must remain pending');
  for (const source of ['sales', 'quick-sales']) {
    const saleId = source === 'sales' ? await normal() : await quick();
    const link = source === 'sales' ? { saleId } : { quickSaleId: saleId };
    const unlocked = await expense(link), locked = await expense(link);
    await rawQuery("INSERT INTO settlement_bill_expenses(settlement_bill_id,expense_id,sale_id,quick_sale_id,name,amount_cents,payer_user_id,payer_username,occurred_at) SELECT $1,id,sale_id,quick_sale_id,name,amount_cents,payer_user_id,'付款成员',occurred_at FROM expenses WHERE id=$2", [bill, locked]);
    const result = assertResponse(await reverse(source, saleId), 409); assert.equal(result.code, 'LINKED_EXPENSE_SETTLED');
    assert.equal(await active(unlocked), true); assert.equal(await active(locked), true);
    const sale = assertResponse(await request('GET', source)).find(row => row.id === saleId); assert.equal(sale.reversalReason, null);
    checks.push(`${source}: settled linked expense blocks entire reversal without partial writes`);
  }
  assertResponse(await reverse('quick-sales', settledSale), 409);
  assertResponse(await request('POST', 'expenses', { quickSaleId: settledSale, type: 'custom', name: '账单后补录', amount: '1.00', payerUserId: users[0], occurredAt: order.occurredAt }), 400);
  const failingSale = await normal(), failingExpense = await expense({ saleId: failingSale });
  failRebuild = true; assertResponse(await reverse('sales', failingSale), 500); failRebuild = false;
  assert.equal(await active(failingExpense), true);
  assert.equal((await rawQuery('SELECT 1 FROM sale_reversals WHERE sale_id=$1', [failingSale])).rowCount, 0);
  assert.equal((await rawQuery("SELECT 1 FROM audit_logs WHERE metadata->>'transactionId'=$1", [failingSale])).rowCount, 0);
  checks.push('Injected ledger failure rolls back sale, linked fees and audit; settled sale/link rejected');
  assertResponse(await request('POST', `sales/${failingSale}/reversals`, { reason: '' }), 400);
  assertResponse(await request('POST', `sales/${failingSale}/reversals`, { reason: 'x' }, false), 401);
  await rawQuery("UPDATE batch_members SET role='viewer' WHERE batch_id=$1 AND user_id=$2", [batchId, users[0]]);
  assertResponse(await reverse('sales', failingSale), 403);
  await rawQuery("UPDATE batch_members SET role='owner' WHERE batch_id=$1 AND user_id=$2", [batchId, users[0]]);
  await rawQuery("UPDATE collaboration_batches SET status='closed' WHERE id=$1", [batchId]); assertResponse(await reverse('sales', failingSale), 409);
  await rawQuery("UPDATE collaboration_batches SET status='open' WHERE id=$1", [batchId]);
  const otherBatch = id(500); await rawQuery("INSERT INTO collaboration_batches(id,workspace_id,name,created_by) VALUES($1,$2,'另一个批次',$3)", [otherBatch, workspaceId, users[0]]);
  await rawQuery("INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,'owner')", [otherBatch, users[0]]);
  assertResponse(await app.inject({ method: 'POST', url: `/api/batches/${otherBatch}/sales/${failingSale}/reversals`, headers: { cookie }, payload: { reason: '越界' } }), 404);
  checks.push('Invalid reason, unauthenticated, viewer, closed batch and cross-batch restrictions');
  // Browser fixture batch contains both sources and all three actual states.
  const viewBatch = id(600); await rawQuery("INSERT INTO collaboration_batches(id,workspace_id,name,created_by) VALUES($1,$2,'页面验收批次',$3)", [viewBatch, workspaceId, users[0]]);
  for (const userId of users) await rawQuery("INSERT INTO batch_members(batch_id,user_id,role) VALUES($1,$2,'owner')", [viewBatch, userId]);
  const viewRequest = (method, suffix, payload) => app.inject({ method, url: `/api/batches/${viewBatch}/${suffix}`, headers: { cookie }, ...(payload ? { payload } : {}) });
  assertResponse(await viewRequest('POST', 'purchases', { productId, channelId, payerUserId: users[1], quantity: 10, totalCost: '100.00', costShares: [{ userId: users[0], amount: '100.00' }], occurredAt: '2026-10-11T04:00:00Z' }));
  const viewSales = {}, viewFees = {};
  for (const source of ['sales', 'quick-sales']) {
    const pending = assertResponse(await viewRequest('POST', source, { ...order, ...(source === 'sales' ? { productId, quantity: 1 } : { items: [costItem] }) })).id;
    const settled = assertResponse(await viewRequest('POST', source, { ...order, occurredAt: '2026-10-12T02:00:00Z', ...(source === 'sales' ? { productId, quantity: 1 } : { items: [costItem] }) })).id;
    const reversed = assertResponse(await viewRequest('POST', source, { ...order, occurredAt: '2026-10-12T01:00:00Z', ...(source === 'sales' ? { productId, quantity: 1 } : { items: [costItem] }) })).id;
    const fee = saleId => ({ type: 'shipping', name: source === 'sales' ? '普通销售邮费' : '快速售出邮费', amount: '2.00', payerUserId: users[1], occurredAt: order.occurredAt, ...(source === 'sales' ? { saleId } : { quickSaleId: saleId }) });
    viewFees[`${source}-pending`] = assertResponse(await viewRequest('POST', 'expenses', fee(pending))).id;
    viewFees[`${source}-settled`] = assertResponse(await viewRequest('POST', 'expenses', fee(settled))).id;
    viewFees[`${source}-reversed`] = assertResponse(await viewRequest('POST', 'expenses', fee(reversed))).id;
    assertResponse(await viewRequest('POST', `${source}/${reversed}/reversals`, { reason: '页面验收撤销' }));
    assertResponse(await viewRequest('POST', 'settlements', { ...settledInput, saleIds: source === 'sales' ? [settled] : [], quickSaleIds: source === 'quick-sales' ? [settled] : [] }));
    viewSales[source] = { pending, settled, reversed };
  }
  if (process.argv.includes('--web')) {
    const modulePath = process.env.PLAYWRIGHT_MODULE_PATH;
    const { chromium } = await import(modulePath ? pathToFileURL(modulePath) : 'playwright');
    browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const origin = process.env.WEB_ORIGIN || 'http://127.0.0.1:5665';
    for (const width of [390, 360]) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 800 }, isMobile: true, deviceScaleFactor: 1 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const req = route.request();
        if (failMembers && req.url().endsWith('/members')) { await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"test failure"}' }); return; }
        const response = await app.inject({ method: req.method(), url: new URL(req.url()).pathname, headers: { cookie, 'content-type': 'application/json' }, ...(req.postData() ? { payload: JSON.parse(req.postData()) } : {}) });
        await route.fulfill({ status: response.statusCode, contentType: 'application/json', body: response.body });
      });
      const at = name => page.locator(`[data-ai-id="${name}"]`);
      const saleRows = page.locator('[data-ai-id="sale-list"] article');
      const feeRows = page.locator('[data-ai-id="expense-list"] article');
      await page.goto(`${origin}/batches/${viewBatch}/transactions`);
      await at('transaction-sale-status-filter').waitFor();
      assert.equal(await at('transaction-sale-status-filter').inputValue(), 'pending'); assert.equal(await saleRows.count(), 2);
      assert.deepEqual(await at('transaction-sale-status-filter').locator('option').allTextContents(), ['待结账', '已结账', '已撤销', '全部']);
      for (const state of ['settled', 'reversed', 'all']) { await at('transaction-sale-status-filter').selectOption(state); assert.equal(await saleRows.count(), state === 'all' ? 6 : 2); }
      await at('transaction-product-keyword').locator('input').fill('组合测试卡'); assert.equal(await saleRows.count(), 3);
      await at('transaction-member-filter').getByRole('combobox').click(); await at(`transaction-member-filter-option-${users[1]}`).click(); await at('transaction-member-filter-apply').click();
      assert.equal(await saleRows.count(), 0); await at('transaction-sales-empty').waitFor();
      await at('transaction-clear-filters').click(); assert.equal(await saleRows.count(), 2); assert.equal(await at('transaction-sale-status-filter').inputValue(), 'pending');
      await at('transaction-member-filter-panel').waitFor({ state: 'hidden' });
      await at('transaction-sale-status-filter').focus(); assert.equal(await at('transaction-sale-status-filter').evaluate(node => node === document.activeElement), true);
      const ids = await page.locator('[data-ai-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-ai-id'))); assert.equal(new Set(ids).size, ids.length); assert.ok(ids.every(value => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const sourceTags = saleRows.locator('.source-tag');
      assert.deepEqual((await sourceTags.allTextContents()).sort(), ['快', '普']);
      for (const tag of await sourceTags.all()) {
        assert.equal(await tag.evaluate(node => getComputedStyle(node).position), 'absolute');
        assert.ok(await tag.getAttribute('aria-label'));
        const box = await tag.boundingBox(), row = await tag.locator('..').boundingBox();
        assert.ok(box.x + box.width <= row.x + row.width && box.y >= row.y && box.y + box.height <= row.y + row.height);
        assert.deepEqual(await tag.evaluate(node => ({ top: getComputedStyle(node).top, right: getComputedStyle(node).right })), { top: '0px', right: '0px' });
        const statusBox = await tag.locator('..').locator('.status-tag').boundingBox();
        assert.ok(box.y + box.height <= statusBox.y || box.x >= statusBox.x + statusBox.width || box.x + box.width <= statusBox.x, 'Corner source label must not overlap status');
      }
      for (const button of await saleRows.locator('.reverse').all()) {
        const box = await button.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
        assert.equal(await button.evaluate(node => getComputedStyle(node).fontSize), '13px');
      }
      await page.screenshot({ path: path.join(output, `sales-${width}.png`), fullPage: true });
      await at('transaction-expenses-tab').click(); assert.equal(await at('transaction-expense-status-filter').inputValue(), 'pending'); assert.equal(await feeRows.count(), 2);
      for (const state of ['settled', 'reversed', 'all']) { await at('transaction-expense-status-filter').selectOption(state); assert.equal(await feeRows.count(), state === 'all' ? 6 : 2); }
      await at('transaction-sales-tab').click(); assert.equal(await at('transaction-sale-status-filter').inputValue(), 'pending');
      await at('transaction-expenses-tab').click(); assert.equal(await at('transaction-expense-status-filter').inputValue(), 'all');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const expenseIds = await page.locator('[data-ai-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-ai-id'))); assert.equal(new Set(expenseIds).size, expenseIds.length);
      assert.ok((await at('expense-create-entry').boundingBox()).width >= 44);
      for (const button of await feeRows.locator('.reverse').all()) {
        const box = await button.boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
        assert.equal(await button.evaluate(node => getComputedStyle(node).fontSize), '13px');
      }
      await page.screenshot({ path: path.join(output, `expenses-${width}.png`), fullPage: true });
      if (width === 390) {
        await at('transaction-sales-tab').click(); await at(`sale-reversal-${viewSales.sales.pending}`).click(); await at('transaction-reversal-notice').waitFor();
        await at('transaction-reversal-dialog').getByRole('button', { name: '确认', exact: true }).click(); await page.locator('.van-toast').waitFor({ state: 'hidden' }); assert.equal(await at('transaction-reversal-dialog').isVisible(), true);
        await at('transaction-reversal-reason').locator('textarea').fill('页面验证联动');
        await page.screenshot({ path: path.join(output, 'cascade-confirm.png') });
        await at('transaction-reversal-dialog').getByRole('button', { name: '确认', exact: true }).click(); await at('transaction-reversal-dialog').waitFor({ state: 'hidden' }); await at('transaction-sale-status-filter').waitFor(); assert.equal(await saleRows.count(), 1);
        await at('transaction-expenses-tab').click(); await at('transaction-expense-status-filter').selectOption('pending'); assert.equal(await feeRows.count(), 1);
        await at('transaction-expense-status-filter').selectOption('reversed'); assert.equal(await feeRows.count(), 3);
        // Restore only the isolated fixture so both viewport screenshots use the same state mix.
        await rawQuery('DELETE FROM expense_reversals WHERE expense_id=$1', [viewFees['sales-pending']]); await rawQuery('DELETE FROM sale_reversals WHERE sale_id=$1', [viewSales.sales.pending]);
      }
      failMembers = true; await page.reload(); await page.getByText('交易记录加载失败，请重试', { exact: true }).waitFor(); failMembers = false;
      await page.getByRole('button', { name: '重试', exact: true }).click(); await at('transaction-sale-status-filter').waitFor();
      await rawQuery("UPDATE batch_members SET role='viewer' WHERE batch_id=$1 AND user_id=$2", [viewBatch, users[0]]);
      await page.reload(); await at('transaction-sale-status-filter').waitFor(); assert.equal(await page.locator('.reverse').count(), 0); assert.equal(await saleRows.count(), 2);
      await rawQuery("UPDATE batch_members SET role='owner' WHERE batch_id=$1 AND user_id=$2", [viewBatch, users[0]]);
      assert.deepEqual(errors, []); await page.close(); checks.push(`Mobile ${width}: defaults/options/intersections/empty/tab memory/sorting IDs/focus/error retry/viewer/no overflow${width === 390 ? '/real cascade' : ''}`);
    }
  }
  assert.equal(savepoint, false);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, database: 'isolated schema rolled back', web: Boolean(browser), webSource: 'Vite development UI' }, null, 2));
  console.log(`PASS: ${checks.length} acceptance groups`); checks.forEach(check => console.log(`- ${check}`));
} finally {
  if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); if (app) await app.close();
  pool.query = originalQuery; pool.connect = originalConnect;
  if (transaction) await rawQuery('ROLLBACK'); client.release(); await pool.end();
}
