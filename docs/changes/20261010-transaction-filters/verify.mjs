// Run backend and Web builds before this script. Only synthetic data is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = process.env.THUNDERLEDGER_EVIDENCE_DIR || fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(output, { recursive: true });
assert.ok(process.env.SESSION_SECRET, 'Provide an isolated SESSION_SECRET through the environment');
assert.ok(process.env.DATABASE_URL, 'Provide a fixture DATABASE_URL through the environment');
const { buildApp } = await import(pathToFileURL(path.join(root, 'apps/backend/dist/app.js')));
const { getPool } = await import(pathToFileURL(path.join(root, 'apps/backend/dist/db/client.js')));
const uuid = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const batchId = uuid(100), workspaceId = uuid(101);
const initialMembers = [
  { id: uuid(1), username: 'follow', role: 'editor' },
  { id: uuid(2), username: 'dan', role: 'editor' },
  { id: uuid(3), username: '暂无销售人员', role: 'viewer' },
  { id: uuid(4), username: 'follow', role: 'viewer' },
];
const sale = (n, member, name, occurredAt, createdAt, extras = {}) => ({
  id: uuid(n), productId: uuid(200 + n), productName: name, displayName: name,
  productGroupName: null, variantName: null, quantity: 1,
  totalPriceCents: '9000', consumedCostCents: '2000', costCents: '2000', serviceFeeCents: '144',
  salesChannel: '闲鱼', feeMode: 'amount', feeRateBasisPoints: null,
  sellerUserId: uuid(member), sellerUsername: initialMembers.find((item) => item.id === uuid(member)).username,
  occurredAt, createdAt, note: null, reversalReason: null, reversedAt: null, settled: false,
  ...extras,
});
// Deliberately scramble input, including equal times and differing timezone offsets.
const normal = [
  sale(11, 1, 'MMN单封 · 樱', '2026-10-09T07:53:00Z', '2026-10-10T08:00:00Z', { reversalReason: '重复录入' }),
  sale(12, 2, '日咖1.0幸运卡 · 允', '2026-10-10T13:44:00+08:00', '2026-10-10T08:10:00Z'),
  sale(13, 4, '同名人员商品', '2026-10-08T07:00:00Z', '2026-10-10T08:12:00Z', { settled: true }),
  sale(14, 1, '内部商品名称', '2026-10-09T07:53:00Z', '2026-10-10T08:05:00Z', { productGroupName: 'MMN单封', variantName: '樱' }),
];
const quick = [
  sale(21, 1, 'MMN单封 · 樱 + 相册', '2026-10-10T05:45:00Z', '2026-10-10T08:06:00Z'),
  sale(22, 2, '组合卡 + mmn单封 · 樱', '2026-10-09T07:53:00Z', '2026-10-10T08:03:00Z'),
];
const expenses = [{ id: uuid(31), name: '邮费', amountCents: '800', payerUserId: uuid(2), payerUsername: 'dan', occurredAt: '2026-10-10T05:00:00Z', reversalReason: null, settled: false }];
let members = [...initialMembers], emptySales = false, failMembers = false, batchRole = 'editor';
const result = (rows) => ({ rows, rowCount: rows.length });
const queries = [];
const pool = getPool();
pool.query = async (sql, params = []) => {
  queries.push(sql);
  assert.ok(sql.trim().startsWith('SELECT'), 'Only fixture reads are allowed');
  if (sql.includes('SELECT username,status,session_version FROM users')) return result([{ username: 'follow', status: 'active', session_version: 1 }]);
  if (sql.includes('SELECT workspace_id FROM collaboration_batches')) return result([{ workspace_id: workspaceId }]);
  if (sql.includes('SELECT wm.role FROM workspace_members')) return result([{ role: 'editor' }]);
  if (sql.includes('SELECT role FROM batch_members')) return result(batchRole ? [{ role: batchRole }] : []);
  if (sql.includes('SELECT u.id,u.username,m.role,m.created_at FROM batch_members')) return result(members);
  if (sql.includes('FROM sales s')) return result(emptySales ? [] : normal);
  if (sql.includes('FROM quick_sales qs')) return result(emptySales ? [] : quick);
  if (sql.includes('FROM expenses e')) return result(expenses);
  if (sql.includes('FROM workspaces w JOIN workspace_members')) return result([{ id: workspaceId, name: '测试工作区', kind: 'collaborative', role: 'editor' }]);
  if (sql.includes('SELECT DISTINCT b.id,b.workspace_id')) return result([{ id: batchId, workspace_id: workspaceId, name: '测试批次', role: batchRole, status: 'open' }]);
  if (sql.includes('AS invited_at FROM users')) return result(initialMembers);
  throw new Error(`Unexpected fixture query: ${sql}`);
};
pool.connect = async () => { throw new Error('This acceptance must not open a database connection'); };
const app = await buildApp();
await app.ready();
const cookie = `thunderledger_session=${app.jwt.sign({ sub: uuid(1), username: 'follow', sessionVersion: 1 })}`;
const request = (suffix, authenticated = true) => app.inject({ method: 'GET', url: `/api/batches/${batchId}/${suffix}`, headers: authenticated ? { cookie } : {} });
const checks = [], observedIds = new Set();
let browser, server;
try {
  for (const suffix of ['sales', 'quick-sales', 'expenses', 'members']) {
    assert.equal((await request(suffix, false)).statusCode, 401);
    batchRole = null;
    assert.equal((await request(suffix)).statusCode, 404);
    batchRole = 'viewer';
    assert.equal((await request(suffix)).statusCode, 200);
  }
  batchRole = 'editor';
  const apiSales = (await request('sales')).json();
  const apiQuick = (await request('quick-sales')).json();
  assert.equal(apiSales.length, 4);
  assert.equal(apiQuick.length, 2);
  assert.equal(apiSales.find((item) => item.id === uuid(14)).displayName, 'MMN单封 · 樱');
  assert.equal(apiQuick[0].source, 'quick_sale');
  assert.equal((await request('members')).json().length, 4);
  checks.push('API: real read routes, missing session 401, no batch access 404, viewer read 200, member/seller/name/date contracts');

  const dist = path.join(root, 'apps/web/dist');
  server = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/')) {
        assert.equal(req.method, 'GET', 'No mutation requests allowed');
        if (req.url.endsWith('/members') && req.url.includes('/batches/') && failMembers) {
          res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"message":"fixture failure"}'); return;
        }
        // Only detail navigation is in scope; render its destination with a fixture.
        const detailId = req.url.match(/\/(?:sales|quick-sales)\/([a-f0-9-]+)$/)?.[1];
        if (detailId) {
          const record = [...apiSales, ...apiQuick].find((item) => item.id === detailId);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ...record, grossProfit: '68.56', inventoryConsumedCost: '20.00', expenses: [], items: [], settlement: null })); return;
        }
        const response = await app.inject({ method: req.method, url: req.url, headers: { cookie } });
        res.writeHead(response.statusCode, { 'content-type': 'application/json' }); res.end(response.body); return;
      }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const asset = pathname.startsWith('/assets/') ? path.basename(pathname) : null;
      const content = await readFile(asset ? path.join(dist, 'assets', asset) : path.join(dist, 'index.html'));
      res.writeHead(200, { 'content-type': asset?.endsWith('.js') ? 'text/javascript' : asset?.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(content);
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH) : 'playwright');
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const byId = (id) => page.locator(`[data-ai-id="${id}"]`);
    const rows = () => byId('sale-list').locator('article');
    const ids = () => rows().evaluateAll((items) => items.map((item) => item.dataset.aiId));
    const expected = (items) => items.map(([source, n]) => `${source}-item-${uuid(n)}`);
    const expectRows = async (items) => {
      const want = expected(items);
      await page.waitForFunction((want) => JSON.stringify([...document.querySelectorAll('[data-ai-id="sale-list"] article')].map((node) => node.dataset.aiId)) === JSON.stringify(want), want);
      assert.deepEqual(await ids(), want);
    };
    const load = async () => {
      await page.goto(`${base}/batches/${batchId}/transactions`);
      await byId('transaction-product-keyword').waitFor();
    };
    const open = async () => {
      await byId('transaction-member-filter-trigger').click();
      await byId('transaction-member-filter-panel').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('.multi-select-popover')?.className.match(/enter-(active|from)/));
    };
    const filter = async (memberIds) => {
      await open(); await byId('transaction-member-filter-reset').click();
      for (const id of memberIds) await byId(`transaction-member-filter-option-${uuid(id)}`).click();
      await byId('transaction-member-filter-apply').click();
      await byId('transaction-member-filter-panel').waitFor({ state: 'hidden' });
    };
    const snapshot = async (name) => {
      const visibleIds = await page.locator('[data-ai-id]').evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().width > 0).map((node) => node.dataset.aiId));
      assert.equal(visibleIds.length, new Set(visibleIds).size, 'Duplicate visible data-ai-id');
      visibleIds.forEach((id) => observedIds.add(id));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
      await page.screenshot({ animations: 'disabled', path: path.join(output, `${viewport.width}-${name}.png`) });
    };
    const all = [['quick-sale', 21], ['sale', 12], ['sale', 14], ['quick-sale', 22], ['sale', 11], ['sale', 13]];
    const input = () => byId('transaction-product-keyword').locator('input');
    await load(); await expectRows(all); await snapshot('default');
    await input().fill('  mmn  ');
    await expectRows([['quick-sale', 21], ['sale', 14], ['quick-sale', 22], ['sale', 11]]);
    await filter([2]); await expectRows([['quick-sale', 22]]);
    await filter([1, 2]); await expectRows([['quick-sale', 21], ['sale', 14], ['quick-sale', 22], ['sale', 11]]);
    await snapshot('combined');
    await input().fill('相册'); await expectRows([['quick-sale', 21]]);
    await input().fill('   '); await expectRows(all.slice(0, 5));
    await byId('transaction-clear-filters').click(); await expectRows(all);
    assert.equal(await input().inputValue(), '');
    await filter([4]); await expectRows([['sale', 13]]); // same username, different user ID
    await filter([3]); await expectRows([]); await snapshot('empty');
    assert.match(await byId('transaction-sales-empty').innerText(), /没有符合筛选条件/);
    await byId('transaction-clear-filters').click(); await expectRows(all);
    await open();
    assert.equal(await byId('transaction-member-filter-options').locator('.van-checkbox').count(), 4);
    const field = byId('transaction-member-filter');
    const labelBox = await field.locator('.select-label').boundingBox();
    const selectBox = await field.getByRole('combobox').boundingBox();
    assert.ok(labelBox.x + labelBox.width < selectBox.x, 'Label must be left of select');
    assert.ok(Math.abs(labelBox.y + labelBox.height / 2 - selectBox.y - selectBox.height / 2) < 2, 'Label and select must align on one row');
    assert.equal(await page.locator('.van-overlay').count(), 0, 'No select overlay');

    assert.equal(await page.locator('.van-overlay').count(), 0, 'Select popup must not dim the page');
    const triggerBox = await byId('transaction-member-filter-trigger').locator('..').boundingBox();
    const panelBox = await byId('transaction-member-filter-panel').boundingBox();
    assert.ok(Math.abs(panelBox.width - triggerBox.width) < 2, 'Menu must match select width');
    assert.ok(Math.abs(panelBox.x - triggerBox.x) < 2, 'Menu must align with select');
    assert.ok(panelBox.y >= triggerBox.y + triggerBox.height, 'Menu must open below select');
    await snapshot('dropdown');
    await byId(`transaction-member-filter-option-${uuid(1)}`).click();
    await page.mouse.click(10, viewport.height - 100);
    await byId('transaction-member-filter-panel').waitFor({ state: 'hidden' });
    await open();
    assert.equal(await byId(`transaction-member-filter-option-${uuid(1)}`).getAttribute('aria-checked'), 'false');
    await byId('transaction-member-filter-apply').click(); await expectRows(all);
    const triggerButton = byId('transaction-member-filter').locator('[role="combobox"]').first();
    await triggerButton.focus(); await page.keyboard.press('Enter');
    await byId('transaction-member-filter-panel').waitFor({ state: 'visible' });
    await byId(`transaction-member-filter-option-${uuid(2)}`).focus(); await page.keyboard.press('Escape');
    await byId('transaction-member-filter-panel').waitFor({ state: 'hidden' }); await expectRows(all);
    await input().fill('不存在的商品'); await expectRows([]);
    await byId('transaction-expenses-tab').click();
    assert.equal(await byId('expense-list').locator('article').count(), 1);
    await byId('transaction-sales-tab').click(); await expectRows([]);
    await byId('transaction-clear-filters').click(); await expectRows(all);
    assert.match(await byId(`sale-status-${uuid(11)}`).innerText(), /已撤销/);
    assert.match(await byId(`sale-status-${uuid(13)}`).innerText(), /已结账/);
    for (const [source, n] of [['sale', 12], ['quick-sale', 21]]) {
      const reversal = byId(`${source}-reversal-${uuid(n)}`);
      await reversal.focus(); await page.keyboard.press('Enter');
      await byId('transaction-reversal-dialog').waitFor({ state: 'visible' });
      assert.ok(page.url().endsWith('/transactions'), 'Reversal must not open detail');
      await byId('transaction-reversal-dialog').getByRole('button', { name: '取消' }).click();
      await byId('transaction-reversal-dialog').waitFor({ state: 'hidden' });
      await byId(`${source}-item-${uuid(n)}`).focus(); await page.keyboard.press('Enter');
      await page.waitForURL(source === 'sale' ? `**/transactions/sales/${uuid(n)}` : `**/quick-sales/${uuid(n)}`);
      await load(); await expectRows(all);
    }
    members = [...initialMembers, ...Array.from({ length: 69 }, (_, i) => ({ id: uuid(300 + i), username: `长名称批次人员${i + 1}`, role: 'viewer' }))];
    await load(); await open();
    assert.equal(await byId('transaction-member-filter-options').locator('.van-checkbox').count(), 73);
    await byId('transaction-member-filter-options').evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const applyBox = await byId('transaction-member-filter-apply').boundingBox();
    assert.ok(applyBox.y + applyBox.height <= viewport.height, 'Confirm button outside viewport');
    await snapshot('long-members');
    await byId('transaction-member-filter-apply').click();
    members = [];
    await load(); await open(); await byId('transaction-members-empty').waitFor();
    await snapshot('no-members');
    await byId('transaction-member-filter-apply').click();
    members = [...initialMembers]; emptySales = true;
    await load(); assert.match(await byId('transaction-sales-empty').innerText(), /还没有销售记录/);
    emptySales = false; failMembers = true;
    await page.goto(`${base}/batches/${batchId}/transactions`); await byId('transaction-error').waitFor();
    await snapshot('error'); failMembers = false;
    await byId('transaction-retry').click(); await byId('transaction-product-keyword').waitFor(); await expectRows(all);
    assert.deepEqual(errors, [], 'Browser runtime errors');
    checks.push(`UI ${viewport.width}x${viewport.height}: mixed chronological order, ties/timezones, keyword/multi-member/combined filters, same-name IDs, el-select-style anchored popup without overlay, reset/cancel/keyboard, empty/error/retry, details/reversal, expense isolation, 73 members, stable IDs, no overflow`);
    await context.close();
  }
  const registry = await readFile(new URL('./data-ai-id-registry.md', import.meta.url), 'utf8');
  for (const id of observedIds) {
    if (!/^(transaction-|sale-|quick-sale-|expense-)/.test(id)) continue;
    const normalized = id.replace(/00000000-0000-4000-8000-[0-9a-f]{12}/, id.startsWith('transaction-member-filter-option-') ? '{userId}' : id.startsWith('quick-sale-') ? '{quickSaleId}' : id.startsWith('expense-') ? '{expenseId}' : '{saleId}');
    assert.ok(registry.includes(`\`${normalized}\``), `Unregistered ID: ${id}`);
  }
  checks.push('Registry: all observed business IDs registered, ASCII kebab-case and unique');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, queryCount: queries.length, observedIds: [...observedIds].sort() }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await app.close();
  await pool.end();
}
