// Isolated verification: real Fastify handlers, fixture database, built Web UI.
// Run backend/web builds first; set PLAYWRIGHT_MODULE_PATH if Playwright is outside the repo.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(output, { recursive: true });
assert.ok(process.env.SESSION_SECRET, 'Provide an isolated SESSION_SECRET through the environment');
assert.ok(process.env.DATABASE_URL, 'Provide a fixture DATABASE_URL through the environment');
const { buildApp } = await import(pathToFileURL(path.join(root, 'apps/backend/dist/app.js')));
const { getPool } = await import(pathToFileURL(path.join(root, 'apps/backend/dist/db/client.js')));
const uuid = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const batchId = uuid(100), workspaceId = uuid(101);
const fixtureMembers = [
  { id: uuid(1), username: 'follow' },
  { id: uuid(2), username: 'dan' },
  { id: uuid(3), username: '暂无销售人员' },
];
let memberRows = [...fixtureMembers];
const sale = (n, member, source, name) => ({
  id: uuid(n), source, productId: source === 'sale' ? uuid(200) : null,
  productName: name, productGroupName: null, variantName: null, quantity: 1,
  totalPriceCents: '5000', consumedCostCents: '2000', serviceFeeCents: '0',
  sellerUserId: fixtureMembers[member].id, sellerUsername: fixtureMembers[member].username,
  occurredAt: '2026-10-09T07:53:00.000Z',
});
const normal = [sale(11, 0, 'sale', 'MMN单封 · 樱'), sale(12, 1, 'sale', 'MMN单封 · 樱'), sale(13, 0, 'sale', 'wvs镜子卡 · 恩')];
const quick = [sale(21, 0, 'quick_sale', '组合快速售出'), sale(22, 1, 'quick_sale', '另一笔快速售出')];
const expenses = [
  { id: uuid(31), saleId: uuid(11), quickSaleId: null, name: '普通销售邮费', amountCents: '500', payerUserId: uuid(1), payerUsername: 'follow' },
  { id: uuid(32), saleId: null, quickSaleId: uuid(21), name: '快速售出邮费', amountCents: '500', payerUserId: uuid(1), payerUsername: 'follow' },
  { id: uuid(33), saleId: null, quickSaleId: null, name: '其他费用', amountCents: '500', payerUserId: uuid(2), payerUsername: 'dan' },
];
let emptySales = false, batchRole = 'owner', failDraft = false;
let recommendationPayload, previewPayload;
let released = 0;
const result = (rows) => ({ rows, rowCount: rows.length });
const query = async (sql, params = []) => {
  if (sql.includes('SELECT username,status,session_version FROM users')) return result([{ username: 'follow', status: 'active', session_version: 1 }]);
  if (sql.includes('SELECT workspace_id FROM collaboration_batches')) return result([{ workspace_id: workspaceId }]);
  if (sql.includes('SELECT wm.role FROM workspace_members')) return result([{ role: 'editor' }]);
  if (sql.includes('SELECT role FROM batch_members')) return result([{ role: batchRole }]);
  if (sql.includes('SELECT status FROM collaboration_batches')) return result([{ status: 'open' }]);
  if (sql.includes('SELECT u.id,u.username FROM batch_members')) return result(memberRows);
  if (sql.includes('FROM sale_cost_allocations') || sql.includes('FROM quick_sale_cost_allocations')) {
    const list = sql.includes('FROM quick_sale_cost_allocations') ? quick : normal;
    const amounts = new Map();
    for (const item of list.filter((item) => params[0].includes(item.id))) amounts.set(item.sellerUserId, (amounts.get(item.sellerUserId) ?? 0) + Number(item.consumedCostCents));
    return result([...amounts].map(([userId, amount]) => ({ userId, amount: String(amount) })));
  }
  if (sql.includes('FROM sales s') || sql.includes('FROM quick_sales qs')) {
    const rows = emptySales ? [] : sql.includes('FROM sales s') ? normal : quick;
    return result(params[1] ? rows.filter((item) => params[1].includes(item.id)) : rows);
  }
  if (sql.includes('FROM expenses e')) {
    const rows = emptySales ? [] : expenses;
    return result(params[3] ? rows.filter((item) => params[3].includes(item.id)) : rows);
  }
  throw new Error(`Unexpected fixture query: ${sql}`);
};
// Replace the entire pool boundary before any query: no database connections or writes.
const pool = getPool();
pool.query = query;
pool.connect = async () => ({ query, release() { released += 1; } });
const app = await buildApp();
await app.ready();
const cookie = `thunderledger_session=${app.jwt.sign({ sub: uuid(1), username: 'follow', sessionVersion: 1 })}`;
const request = (method, suffix, payload, authenticated = true) => app.inject({ method, url: `/api/batches/${batchId}/settlements/${suffix}`, headers: authenticated ? { cookie } : {}, ...(payload ? { payload } : {}) });
let browser, server;
const checks = [];
try {
  assert.equal((await request('GET', 'draft', undefined, false)).statusCode, 401);
  batchRole = 'viewer';
  assert.equal((await request('GET', 'draft')).statusCode, 403);
  batchRole = 'owner';
  const draftResponse = await request('GET', 'draft');
  assert.equal(draftResponse.statusCode, 200);
  const draft = draftResponse.json();
  assert.deepEqual(draft.members, fixtureMembers);
  assert.equal(draft.sales.length, 3);
  assert.equal(draft.transactions.filter((item) => item.source === 'quick_sale').length, 2);
  for (const item of draft.transactions) assert.ok(draft.members.some((member) => member.id === item.sellerUserId));
  const recommendation = await request('POST', 'recommendation', { saleIds: [uuid(11), uuid(13)], quickSaleIds: [uuid(21)] });
  assert.equal(recommendation.statusCode, 200);
  assert.equal(recommendation.json().costTotal, '60.00');
  assert.equal(recommendation.json().costShares.length, 3);
  assert.equal((await request('POST', 'recommendation', { saleIds: [], quickSaleIds: [] })).statusCode, 400);
  assert.equal((await request('POST', 'recommendation', { saleIds: [uuid(99)], quickSaleIds: [] })).statusCode, 409);
  checks.push('API: missing session 401, viewer 403, draft member/seller contract, mixed-sale recommendation, empty selection 400, stale selection 409');

  const dist = path.join(root, 'apps/web/dist');
  server = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/')) {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        if (req.url.endsWith('/draft') && failDraft) { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"message":"fixture failure"}'); return; }
        if (req.url.endsWith('/recommendation')) recommendationPayload = JSON.parse(raw);
        if (req.url.endsWith('/preview')) previewPayload = JSON.parse(raw);
        const response = await app.inject({ method: req.method, url: req.url, headers: { cookie, 'content-type': 'application/json' }, ...(raw ? { payload: raw } : {}) });
        res.writeHead(response.statusCode, { 'content-type': 'application/json' });
        res.end(response.body);
        return;
      }
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const asset = pathname.startsWith('/assets/') ? path.basename(pathname) : null;
      const content = await readFile(asset ? path.join(dist, 'assets', asset) : path.join(dist, 'index.html'));
      res.writeHead(200, { 'content-type': asset?.endsWith('.js') ? 'text/javascript' : asset?.endsWith('.css') ? 'text/css' : 'text/html' });
      res.end(content);
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const moduleName = process.env.PLAYWRIGHT_MODULE_PATH;
  const { chromium } = await import(moduleName ? pathToFileURL(moduleName) : 'playwright');
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu', '--renderer-process-limit=1'] });
  const observedIds = new Set();
  for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const byId = (id) => page.locator(`[data-ai-id="${id}"]`);
    const rows = () => byId('settlement-sales-list').locator('.choice-row');
    const snapshotIds = async () => {
      const ids = await page.locator('[data-ai-id]').evaluateAll((nodes) => nodes.filter((node) => node.getBoundingClientRect().width > 0).map((node) => node.dataset.aiId));
      assert.equal(ids.length, new Set(ids).size, 'Duplicate visible data-ai-id');
      ids.forEach((id) => observedIds.add(id));
    };
    const open = async () => { await byId('settlement-member-filter-trigger').click(); await byId('settlement-member-filter-panel').waitFor({ state: 'visible' }); await page.waitForFunction(() => !document.querySelector('.van-dropdown-item__content')?.className.match(/enter-(active|from)/)); };
    const filter = async (ids) => {
      await open();
      await byId('settlement-member-filter-reset').click();
      for (const id of ids) await byId(`settlement-member-filter-option-${id}`).click();
      await byId('settlement-member-filter-apply').click();
      await byId('settlement-member-filter-panel').waitFor({ state: 'hidden' });
    };
    const checked = async (id) => byId(id).locator('input').isChecked();
    const summary = async () => byId('settlement-member-filter-summary').innerText();
    await page.goto(`${base}/batches/${batchId}/settlements/new`);
    await byId('settlement-member-filter-trigger').waitFor();
    assert.equal(await rows().count(), 5);
    await page.screenshot({ animations: 'disabled', path: path.join(output, `${viewport.width}-default.png`) });
    await open();
    assert.equal(await byId('settlement-member-filter-options').locator('.van-checkbox').count(), 3);
    await snapshotIds();
    await page.screenshot({ animations: 'disabled', path: path.join(output, `${viewport.width}-dropdown.png`) });
    await byId(`settlement-member-filter-option-${uuid(1)}`).click();
    // Dismiss without confirmation, then reopen: applied filter and checkbox draft stay unchanged.
    await page.locator('.van-overlay').click({ position: { x: 10, y: 300 } });
    await open();
    assert.equal(await byId(`settlement-member-filter-option-${uuid(1)}`).getAttribute('aria-checked'), 'false');
    await byId('settlement-member-filter-apply').click();
    await byId('settlement-member-filter-panel').waitFor({ state: 'hidden' });
    assert.equal(await rows().count(), 5);
    await filter([uuid(1)]);
    assert.equal(await rows().count(), 3);
    await byId('settlement-sales-select-all').click();
    assert.match(await summary(), /已选 3 笔/);
    assert.equal(await checked(`settlement-expense-${uuid(31)}`), true);
    assert.equal(await checked(`settlement-expense-${uuid(32)}`), true);
    await page.screenshot({ animations: 'disabled', path: path.join(output, `${viewport.width}-filtered.png`) });
    await filter([uuid(2)]);
    assert.equal(await rows().count(), 2);
    assert.match(await summary(), /筛选外 3 笔/);
    await byId('settlement-sales-select-all').click();
    assert.match(await summary(), /已选 5 笔/);
    await byId('settlement-sales-clear').click();
    assert.match(await summary(), /已选 3 笔/);
    await filter([uuid(1), uuid(2)]);
    assert.equal(await rows().count(), 5);
    assert.equal(await checked(`settlement-sale-${uuid(11)}`), true);
    assert.equal(await checked(`settlement-sale-${uuid(12)}`), false);
    await filter([uuid(3)]);
    assert.equal(await rows().count(), 0);
    assert.match(await byId('settlement-sales-empty').innerText(), /暂无待结算销售/);
    assert.equal(await byId('settlement-sales-select-all').isDisabled(), true);
    await snapshotIds();
    await page.screenshot({ animations: 'disabled', path: path.join(output, `${viewport.width}-empty.png`) });
    await byId('settlement-next').click();
    await byId('settlement-profit-allocation').waitFor();
    assert.deepEqual(recommendationPayload, { saleIds: [uuid(11), uuid(13)], quickSaleIds: [uuid(21)] });
    assert.equal(await byId('settlement-profit-allocation').locator('.field-row').count(), 3);
    await page.getByText('返回', { exact: true }).click();
    await byId('settlement-sales-empty').waitFor();
    await filter([]);
    assert.equal(await rows().count(), 5);
    await byId(`settlement-sale-${uuid(11)}`).click();
    assert.equal(await checked(`settlement-expense-${uuid(31)}`), false);
    assert.equal(await checked(`settlement-expense-${uuid(32)}`), true);
    await byId(`settlement-expense-${uuid(33)}`).click();
    await byId('settlement-next').click();
    await byId('settlement-profit-allocation').waitFor();
    await byId('settlement-next').click();
    await byId('settlement-preview').waitFor();
    assert.deepEqual(previewPayload.saleIds, [uuid(13)]);
    assert.deepEqual(previewPayload.quickSaleIds, [uuid(21)]);
    assert.deepEqual(new Set(previewPayload.expenseIds), new Set([uuid(32), uuid(33)]));
    assert.equal(previewPayload.profitShares.length, 3);
    await page.getByText('返回', { exact: true }).click();
    await page.getByText('返回', { exact: true }).click();
    await byId('settlement-sales-list').waitFor();
    await byId('settlement-sales-clear').click();
    await byId('settlement-next').click();
    await page.getByText('请至少选择一笔销售', { exact: true }).waitFor();
    assert.equal(await byId('settlement-sales-list').isVisible(), true);
    // Check keyboard activation on the actual Vant trigger.
    const trigger = byId('settlement-member-filter').locator('[role="button"]').first();
    await trigger.focus();
    await trigger.press('Enter');
    await byId('settlement-member-filter-panel').waitFor({ state: 'visible' });
    await trigger.press('Space');
    await byId('settlement-member-filter-panel').waitFor({ state: 'hidden' });
    // A person with the same display name must still match by ID, never by name.
    memberRows = fixtureMembers.map((member, index) => index === 2 ? { ...member, username: 'follow' } : member);
    await page.reload();
    await byId('settlement-member-filter-trigger').waitFor();
    await filter([uuid(3)]);
    assert.equal(await rows().count(), 0);
    // Long member lists scroll while retaining visible actions.
    memberRows = [...fixtureMembers, ...Array.from({ length: 70 }, (_, i) => ({ id: uuid(1000 + i), username: `长姓名批次人员用于检查移动端换行-${i}` }))];
    await page.reload();
    await byId('settlement-member-filter-trigger').waitFor();
    await open();
    const panel = await byId('settlement-member-filter-panel').boundingBox();
    const apply = await byId('settlement-member-filter-apply').boundingBox();
    assert.ok(panel.y + panel.height <= viewport.height, 'Dropdown panel outside viewport');
    assert.ok(apply.y + apply.height <= viewport.height, 'Dropdown actions outside viewport');
    assert.ok(await byId('settlement-member-filter-options').evaluate((el) => el.scrollHeight > el.clientHeight));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Horizontal overflow');
    await page.screenshot({ animations: 'disabled', path: path.join(output, `${viewport.width}-long-members.png`) });
    memberRows = [...fixtureMembers];
    failDraft = true;
    await page.reload();
    await page.getByText('结算草稿加载失败，请返回后重试').waitFor();
    failDraft = false;
    await page.getByText('重试', { exact: true }).click();
    await byId('settlement-member-filter-trigger').waitFor();
    emptySales = true;
    await page.reload();
    await byId('settlement-sales-empty').waitFor();
    assert.equal(await rows().count(), 0);
    emptySales = false;
    assert.deepEqual(errors, []);
    checks.push(`UI ${viewport.width}x${viewport.height}: all-member options, single/multi/reset/cancel, visible select/clear, hidden selections, empty state, linked expenses, recommendation/preview payload, back navigation, minimum selection, keyboard, duplicate names, long-list scroll, error/retry, no-data state, no overflow`);
    await context.close();
  }
  const registry = await readFile(new URL('./data-ai-id-registry.md', import.meta.url), 'utf8');
  for (const [, id] of registry.matchAll(/\| `([^`]+)` \|/g)) {
    if (!id.includes('{')) assert.ok(observedIds.has(id), `Registered ID not observed: ${id}`);
  }
  checks.push('data-ai-id: registered static IDs observed; visible IDs unique; member/sale IDs stable');
  await writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, releasedClients: released, limitations: ['Database SQL results use synthetic fixtures; no live database or production data tested.', 'No confirmed bill is created; recommendation and preview are exercised.'] }, null, 2) + '\n');
  console.log(checks.join('\n'));
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await app.close();
  await pool.end();
}
