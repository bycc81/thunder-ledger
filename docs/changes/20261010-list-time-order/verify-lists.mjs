// Read-only acceptance: real handlers, isolated SQL boundary and built mobile UI.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = fileURLToPath(new URL('./evidence/lists/', import.meta.url));
await mkdir(output, { recursive: true });
assert.ok(process.env.SESSION_SECRET && process.env.DATABASE_URL, 'Provide isolated fixture env');
const { buildApp } = await import(pathToFileURL(path.join(root, 'apps/backend/dist/app.js')));
const { getPool } = await import(pathToFileURL(path.join(root, 'apps/backend/dist/db/client.js')));
const uuid = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const workspaceId = uuid(101), batchId = uuid(100), billId = uuid(102);
const product = (n, name, createdAt) => ({ id: uuid(n), name, description: null, referencePrice: '1.00', firstObjectKey: null, createdAt, updatedAt: createdAt });
// Different sources interleave. Non-chronological fixture arrays ensure the Web really sorts.
const groups = [
  { ...product(203, '旧商品组', '2026-10-08T00:00:00Z'), variants: [{ id: uuid(213), name: '旧款' }] },
  { ...product(201, '新商品组', '2026-10-10T08:00:00+08:00'), variants: [{ id: uuid(211), name: '新款' }, { id: uuid(212), name: '次新款' }] },
];
const products = [product(204, '旧单品', '2026-10-07T00:00:00Z'), product(202, '中间单品', '2026-10-09T00:00:00Z'), product(211, '新款', '2026-10-10T00:00:00Z')];
const batchProducts = [
  { id: uuid(211), name: '新款', groupId: uuid(201), groupName: '新商品组', variantName: '新款', availableQuantity: 5 },
  { id: uuid(202), name: '中间单品', groupId: null, groupName: null, variantName: null, availableQuantity: 5 },
  { id: uuid(212), name: '次新款', groupId: uuid(201), groupName: '新商品组', variantName: '次新款', availableQuantity: 5 },
  { id: uuid(213), name: '旧款', groupId: uuid(203), groupName: '旧商品组', variantName: '旧款', availableQuantity: 5 },
  { id: uuid(204), name: '旧单品', groupId: null, groupName: null, variantName: null, availableQuantity: 5 },
];
const transaction = (n, name, occurredAt) => ({ id: uuid(n), productName: name, quantity: 1, totalPriceCents: '1000', consumedCostCents: '100', serviceFeeCents: '0', sellerUsername: '测试人员', occurredAt });
const normal = [transaction(11, '早卖出普通商品', '2026-10-09T22:00:00Z'), transaction(12, '最新普通商品', '2026-10-10T10:00:00+08:00')];
const quick = [transaction(21, '中间快速商品', '2026-10-10T01:00:00Z'), transaction(22, '同时快速商品', '2026-10-10T10:00:00+08:00')];
const statements = [], contracts = new Set(), checks = [];
let catalogEmpty = false, failCatalog = false;
const result = (rows) => ({ rows, rowCount: rows.length });
const ordered = (sql, pattern, name) => { assert.match(sql, pattern, name); contracts.add(name); };
const query = async (sql, params = []) => {
  assert.match(sql.trim(), /^SELECT\b/i, 'Acceptance cannot mutate data');
  statements.push({ sql, params });
  if (sql.includes('SELECT username,status,session_version FROM users')) return result([{ username: params[0] === uuid(90) ? (process.env.ADMIN_USERNAME ?? 'admin') : '测试人员', status: 'active', session_version: 1 }]);
  if (sql.includes('SELECT workspace_id FROM collaboration_batches')) return result([{ workspace_id: workspaceId }]);
  if (sql.includes('SELECT wm.role FROM workspace_members')) return result([{ role: 'editor' }]);
  if (sql.includes('SELECT role FROM batch_members')) return result([{ role: 'owner' }]);
  if (sql.includes('FROM workspaces w') && !sql.includes('SELECT DISTINCT')) {
    ordered(sql, /ORDER BY creator_member\.created_at DESC NULLS LAST,w\.id/, 'workspace creator-join time proxy (both roles)');
    return result([{ id: workspaceId, name: '新工作区', kind: 'collaborative', role: 'editor' }, { id: uuid(105), name: '旧工作区', kind: 'collaborative', role: 'editor' }]);
  }
  if (sql.includes('AS invited_at FROM users')) {
    ordered(sql, /ORDER BY wm\.created_at DESC,u\.id/, 'workspace member join order');
    return result([{ id: uuid(2), username: '新加入人员', role: 'editor' }, { id: uuid(1), username: '旧加入人员', role: 'editor' }]);
  }
  if (sql.includes('SELECT u.id,u.username,m.role,m.created_at')) {
    ordered(sql, /ORDER BY m\.created_at DESC,u\.id/, 'batch participant join order');
    return result([{ id: uuid(2), username: '新加入人员', role: 'editor' }, { id: uuid(1), username: '旧加入人员', role: 'owner' }]);
  }
  if (sql.includes('SELECT DISTINCT b.id,b.workspace_id')) return result([{ id: batchId, workspace_id: workspaceId, name: '测试批次', status: 'open', role: 'owner', memberRole: 'owner', workspaceRole: 'editor' }]);
  if (sql.includes('FROM product_group_templates')) {
    ordered(sql, /ORDER BY v\.position/, 'template variant position preserved');
    return result([{ id: uuid(300), name: '模板', variants: [{ id: uuid(302), name: '先款', position: 1 }, { id: uuid(301), name: '后款', position: 2 }] }]);
  }
  if (sql.includes('FROM product_groups g')) {
    ordered(sql, /ORDER BY p\.created_at DESC,p\.id/, 'actual variant creation order');
    return result(catalogEmpty ? [] : groups);
  }
  if (sql.includes('FROM product_group_images gi')) {
    ordered(sql, /ORDER BY gi\.position/, 'image position preserved');
    return result([]);
  }
  if (sql.includes('AS "availableQuantity" FROM products p')) {
    ordered(sql, /ORDER BY p\.created_at DESC,p\.id/, 'normal sale product creation order');
    return result(batchProducts);
  }
  if (sql.includes('FROM product_images pi') && !sql.includes('FROM products p')) return result([]);
  if (sql.includes('FROM products p') && sql.includes('WHERE p.id=$1')) return result(products.filter((item) => item.id === params[0]));
  if (sql.includes('FROM products p')) return result(catalogEmpty ? [] : products.filter((item) => !params[1] || item.name.includes(params[1])));
  if (sql.includes('FROM inventory_purchases ip')) {
    ordered(sql, /ORDER BY MAX\(ip\.occurred_at\) DESC,MAX\(ip\.created_at\) DESC,ip\.product_id/, 'inventory newest procurement business time');
    return result([{ productId: uuid(202), productName: '中间单品', availableQuantity: 5, totalCostCents: '1000', purchaseCount: 1 }]);
  }
  if (sql.includes('FROM manual_channels')) return result([]);
  if (sql.includes('FROM settlement_bills WHERE id=')) return result([{ id: billId, confirmedAt: '2026-10-10T04:00:00Z', saleTotalCents: '4000', serviceFeeTotalCents: '0', expenseTotalCents: '0', costTotalCents: '400', profitTotalCents: '3600' }]);
  if (sql.includes('FROM settlement_member_results')) {
    ordered(sql, /ORDER BY username/, 'settlement member result order preserved');
    return result([]);
  }
  if (sql.includes('FROM settlement_transfer_suggestions')) {
    ordered(sql, /ORDER BY sequence/, 'transfer business order preserved');
    return result([]);
  }
  if (sql.includes('FROM settlement_bill_sales')) return result(normal);
  if (sql.includes('FROM settlement_bill_quick_sales')) return result(quick);
  if (sql.includes('FROM settlement_bill_expenses') || sql.includes('FROM settlement_adjustment_bills')) return result([]);
  throw new Error(`Unexpected SQL: ${sql}`);
};
const pool = getPool(); pool.query = query;
pool.connect = async () => { throw new Error('No database connections in fixture acceptance'); };
const app = await buildApp(); await app.ready();
const cookie = `thunderledger_session=${app.jwt.sign({ sub: uuid(1), username: '测试人员', sessionVersion: 1 })}`;
const adminCookie = `thunderledger_session=${app.jwt.sign({ sub: uuid(90), sessionVersion: 1 })}`;
const get = (url, session = cookie) => app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: session } });
let server, browser;
try {
  for (const url of ['/workspaces', `/workspaces/${workspaceId}/members`, `/batches/${batchId}/members`, `/workspaces/${workspaceId}/product-groups`, `/workspaces/${workspaceId}/product-group-templates`, `/batches/${batchId}/products`, `/batches/${batchId}/inventory`]) {
    const response = await get(url); assert.equal(response.statusCode, 200, `${url}: ${response.body}`);
  }
  assert.equal((await get('/workspaces', adminCookie)).statusCode, 200);
  const bill = await get(`/batches/${batchId}/settlements/${billId}`);
  assert.equal(bill.statusCode, 200);
  assert.deepEqual(bill.json().transactions.map((item) => item.id), [22, 12, 21, 11].map(uuid), 'Confirmed bill: descending epoch time, stable source ties');
  const originalTime = normal[1].occurredAt;
  normal[1].occurredAt = new Date(originalTime);
  assert.deepEqual((await get(`/batches/${batchId}/settlements/${billId}`)).json().transactions.map((item) => item.id), [22, 12, 21, 11].map(uuid), 'pg Date objects preserve instant ordering');
  normal[1].occurredAt = originalTime;
  checks.push(`API: ${contracts.size} query ordering contracts, ordinary/admin workspaces, mixed confirmed-bill timezones/ties/pg Date`);
  const dist = path.join(root, 'apps/web/dist');
  server = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/')) {
        if (failCatalog && /\/(products|product-groups)(\?|$)/.test(req.url) && req.url.includes('/workspaces/')) { res.writeHead(500); res.end('{}'); return; }
        const response = await app.inject({ method: req.method, url: req.url, headers: { cookie } });
        res.writeHead(response.statusCode, { 'content-type': 'application/json' }); res.end(response.body); return;
      }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const asset = pathname.startsWith('/assets/') ? path.basename(pathname) : null;
      res.writeHead(200, { 'content-type': asset?.endsWith('.js') ? 'text/javascript' : asset?.endsWith('.css') ? 'text/css' : 'text/html' });
      res.end(await readFile(asset ? path.join(dist, 'assets', asset) : path.join(dist, 'index.html')));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH) : 'playwright');
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true }); const page = await context.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    const byId = (id) => page.locator(`[data-ai-id="${id}"]`);
    const screenshot = async (name) => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      const ids = await page.locator('[data-ai-id]').evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().width > 0).map((node) => node.dataset.aiId));
      assert.equal(ids.length, new Set(ids).size, `Stable unique visible data-ai-id: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
      await page.screenshot({ path: path.join(output, `${viewport.width}-${name}.png`), animations: 'disabled' });
    };
    await page.goto(`${base}/products`); await byId('product-catalog-list').waitFor();
    const catalogIds = [201, 202, 203, 204].map((n) => `product-${n % 2 ? 'group-item' : 'item'}-${uuid(n)}`);
    assert.deepEqual(await byId('product-catalog-list').locator('article').evaluateAll((nodes) => nodes.map((node) => node.dataset.aiId)), catalogIds, 'Mixed catalog creation-time order and group variants excluded');
    await screenshot('catalog');
    await byId(`product-group-item-${uuid(201)}`).press('Enter');
    await page.waitForURL(`**/product-groups/${uuid(201)}`);
    await byId('product-group-detail-variants').waitFor();
    assert.deepEqual(await byId('product-group-detail-variants').locator('.variant-list>div').evaluateAll((nodes) => nodes.map((node) => node.dataset.aiId)), [211, 212].map((n) => `product-group-detail-variant-${uuid(n)}`));
    await screenshot('group-detail');
    await page.goto(`${base}/products`); await byId('product-catalog-list').waitFor();
    await byId(`product-item-${uuid(202)}`).press('Enter'); await page.waitForURL(`**/products/${uuid(202)}`);
    await page.goto(`${base}/products`); await byId('product-catalog-list').waitFor();
    await byId('product-search').locator('input').fill('中间'); await byId('product-search-submit').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-ai-id="product-catalog-list"] article').length === 1);
    assert.equal(await byId(`product-item-${uuid(202)}`).isVisible(), true);
    await byId('product-search').locator('input').fill('不存在'); await byId('product-search-submit').click(); await byId('product-search-empty').waitFor();
    await byId('product-search-empty-clear').click(); await byId('product-catalog-list').waitFor();
    await byId(`product-group-purchase-${uuid(201)}`).click(); await byId('product-group-purchase-batch-picker').waitFor();
    await byId('product-group-purchase-batch-picker').getByText('确认', { exact: true }).click();
    await page.waitForURL(`**/inventory/purchases/new?productGroupId=${uuid(201)}`);
    await byId('inventory-purchase-target').waitFor(); await byId('inventory-purchase-target').click();
    const picker = byId('inventory-purchase-target-picker'); await picker.waitFor();
    assert.deepEqual(await picker.locator('.van-picker-column__item').allTextContents(), ['商品组 · 新商品组', '中间单品', '商品组 · 旧商品组', '旧单品']);
    await screenshot('purchase-picker');
    await page.goto(`${base}/batches/${batchId}/transactions/sales/new`);
    await byId('sale-product-select').waitFor(); await byId('sale-product-select').click(); await byId('sale-product-picker').waitFor();
    assert.deepEqual(await byId('sale-product-picker').locator('.van-picker-column__item').allTextContents(), ['新商品组', '中间单品', '旧商品组', '旧单品']);
    await byId('sale-product-picker').getByText('确认', { exact: true }).click(); await byId('sale-variant-picker').waitFor();
    assert.deepEqual(await byId('sale-variant-picker').locator('.van-picker-column__item').allTextContents(), ['新款（可卖 5 件）', '次新款（可卖 5 件）']);
    await screenshot('variant-picker');
    await page.goto(`${base}/batches/${batchId}/settlements/${billId}`); await byId('settlement-detail-transactions').waitFor();
    assert.deepEqual(await byId('settlement-detail-transactions').locator('.row').evaluateAll((nodes) => nodes.map((node) => node.dataset.aiId)), [22, 12, 21, 11].map((n) => `settlement-detail-${n >= 20 ? 'quick-sale' : 'sale'}-${uuid(n)}`));
    await byId('settlement-detail-transactions').scrollIntoViewIfNeeded();
    await screenshot('bill-detail');
    catalogEmpty = true; await page.goto(`${base}/products`); await byId('product-list-empty').waitFor(); await screenshot('catalog-empty'); catalogEmpty = false;
    failCatalog = true; await page.reload(); await byId('product-list-error').waitFor(); await screenshot('catalog-error'); failCatalog = false;
    await byId('product-list-retry').click(); await byId('product-catalog-list').waitFor();
    // Rapid route navigation can cancel detail requests, but must not produce JS exceptions.
    assert.deepEqual(errors, []);
    checks.push(`UI ${viewport.width}x${viewport.height}: mixed catalog/search/empty/error/retry/routes/purchase-picker/normal-sale-picker/variant-picker/bill detail, screenshots, unique IDs, no overflow`);
    await context.close();
  }
  await writeFile(path.join(output, 'queries.json'), JSON.stringify([...new Map(statements.map((item) => [item.sql, item])).values()], null, 2));
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, contracts: [...contracts] }, null, 2));
  console.log(checks.join('\n'));
} finally { await browser?.close(); if (server) await new Promise((resolve) => server.close(resolve)); await app.close(); }
