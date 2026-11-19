// Built mobile UI acceptance with isolated API fixtures; never contacts production.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(output, { recursive: true });
const registry = await readFile(new URL('./data-ai-id-registry.md', import.meta.url), 'utf8')
  + await readFile(new URL('../20261112-login-service-wakeup/data-ai-id-registry.md', import.meta.url), 'utf8');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH) : 'playwright');
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    assert.ok(!pathname.startsWith('/api/'), 'All APIs must be intercepted');
    const asset = pathname.startsWith('/assets/') ? path.basename(pathname) : null;
    res.writeHead(200, { 'content-type': asset?.endsWith('.js') ? 'text/javascript' : asset?.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(await readFile(path.join(root, 'apps/web/dist', ...(asset ? ['assets', asset] : ['index.html']))));
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const checks = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let mode = 'limited', healthCalls = 0, captchaCalls = 0;
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const json = (status, data, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers });
      if (pathname === '/api/auth/session') return json(401, { secret: 'fixture-session-body-secret' });
      if (pathname === '/api/auth/login') return json(401, { secret: 'fixture-login-body-secret' });
      if (pathname === '/api/auth/captcha') {
        captchaCalls++;
        if (mode === 'limited') return json(429, { secret: 'fixture-body-secret' }, { 'x-render-routing': 'hibernate-rate-limited', 'cf-ray': 'fixture-ray-SEA', 'retry-after': '10', 'x-private-token': 'fixture-header-secret' });
        return json(200, { captchaId: 'fixture-captcha-id-secret', image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><!--fixture-image-secret--><text x="12" y="30" font-size="28">1234</text></svg>') });
      }
      if (pathname === '/api/healthz') {
        healthCalls++;
        if (mode === 'limited') return json(429, {}, { 'x-render-routing': 'hibernate-rate-limited', 'cf-ray': 'fixture-ray-SEA' });
        if (mode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>fixture-html-secret</html>' });
        if (mode === 'network') return route.abort('failed');
        if (mode === 'timeout') return;
        if (mode === 'unknown-limit') return json(429, {});
        return json(200, { status: 'ok' });
      }
      assert.fail(`Unexpected request: ${pathname}`);
    });
    const byId = id => page.locator(`[data-ai-id="${id}"]`);
    const toggle = byId('login-service-diagnostics-toggle');
    const report = byId('login-service-diagnostics-report');
    const button = byId('login-service-wakeup-button');
    const status = byId('login-service-wakeup-status');
    await page.goto(`${base}/login`);
    await button.waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-ai-id="login-captcha-refresh"]')?.disabled);
    const beforeExpand = { healthCalls, captchaCalls };
    await toggle.focus();
    await page.keyboard.press('Enter');
    await report.waitFor();
    assert.deepEqual({ healthCalls, captchaCalls }, beforeExpand, 'Opening diagnostics makes no requests');
    assert.match(await report.inputValue(), /hibernate-rate-limited/);
    assert.match(await report.inputValue(), /fixture-ray-SEA/);
    assert.match(await report.inputValue(), /尚未登录（正常）/);
    assert.match(await byId('login-service-diagnostics-summary').innerText(), /Render/);
    assert.equal(await byId('login-service-health-link').getAttribute('href'), '/api/healthz');
    assert.equal(await byId('login-service-origin-health-link').getAttribute('href'), 'https://thunder-ledger-api.onrender.com/api/healthz');
    assert.equal(await byId('login-service-origin-health-link').getAttribute('target'), '_blank');
    await byId('login-username').locator('input').fill('fixture-username-secret');
    await byId('login-password').locator('input').fill('fixture-password-secret');
    await button.click();
    await page.waitForFunction(() => document.querySelector('[data-ai-id="login-service-wakeup-status"]')?.textContent.includes('10 秒后'));
    assert.match(await status.innerText(), /Render/);
    mode = 'ok';
    await page.clock.runFor(10_000);
    await page.waitForFunction(() => document.querySelector('[data-ai-id="login-service-wakeup-status"]')?.textContent.includes('验证码已刷新'));
    assert.match(await report.inputValue(), /hibernate-rate-limited/, 'History survives recovery');
    assert.match(await byId('login-service-diagnostics-summary').innerText(), /响应正常/);
    const forbidden = /fixture-(?:username|password|body|header|session-body|login-body|captcha-id|image|html)-secret/;
    assert.doesNotMatch(await report.inputValue(), forbidden);
    assert.doesNotMatch(await page.evaluate(() => localStorage.getItem('thunderledger-service-diagnostics-v1')), forbidden);

    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedDiagnostic = text; } } }));
    await byId('login-service-diagnostics-copy').click();
    assert.equal(await page.evaluate(() => window.copiedDiagnostic), await report.inputValue());
    assert.match(await byId('login-service-diagnostics-feedback').innerText(), /已复制/);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
    await byId('login-service-diagnostics-copy').click();
    assert.match(await byId('login-service-diagnostics-feedback').innerText(), /长按复制/);
    assert.equal(await report.evaluate(node => node.selectionEnd - node.selectionStart), (await report.inputValue()).length);

    for (const id of ['login-service-diagnostics-toggle', 'login-service-diagnostics-copy', 'login-service-diagnostics-clear', 'login-service-health-link', 'login-service-origin-health-link']) {
      assert.ok((await byId(id).boundingBox()).height >= 44, `${id} touch target`);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    const ids = await page.locator('[data-ai-id]').evaluateAll(nodes => nodes.map(node => node.dataset.aiId));
    assert.equal(ids.length, new Set(ids).size);
    for (const id of ids) { assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/); assert.ok(registry.includes(`| ${id} |`), id); }
    await page.screenshot({ path: path.join(output, `${viewport.width}-recovered-history.png`), fullPage: true });

    await page.reload();
    await button.waitFor();
    await toggle.click();
    assert.match(await report.inputValue(), /hibernate-rate-limited/, 'History survives refresh');
    await byId('login-service-diagnostics-clear').click();
    assert.doesNotMatch(await report.inputValue(), /hibernate-rate-limited/);
    assert.equal(await page.evaluate(() => localStorage.getItem('thunderledger-service-diagnostics-v1')), null);

    // Test distinct failure classes without waiting through an entire retry round.
    for (const [testMode, expected] of [['html', /返回内容异常/], ['unknown-limit', /HTTP 429：请求被拒绝/], ['network', /未收到可读取/]]) {
      mode = testMode;
      await button.click();
      await page.waitForFunction(() => document.querySelector('[data-ai-id="login-service-wakeup-status"]')?.textContent.includes('10 秒后'));
      assert.match(await byId('login-service-diagnostics-summary').innerText(), expected);
      if (testMode === 'unknown-limit') assert.doesNotMatch(await byId('login-service-diagnostics-summary').innerText(), /Render/);
      mode = 'ok';
      await page.clock.runFor(10_000);
      await page.waitForFunction(() => document.querySelector('[data-ai-id="login-service-wakeup-status"]')?.textContent.includes('验证码已刷新'));
    }
    assert.doesNotMatch(await report.inputValue(), forbidden);
    await page.screenshot({ path: path.join(output, `${viewport.width}-diagnostic-results.png`), fullPage: true });

    // Check retention and restoration against an explicitly seeded local cache.
    await page.evaluate(() => {
      const now = Date.now();
      const entry = (time, ray) => ({ time, endpoint: '/healthz', elapsed: 50, status: 429, result: 'http-error', headers: { 'cf-ray': ray, authorization: 'fixture-header-secret' }, unexpected: 'fixture-body-secret' });
      localStorage.setItem('thunderledger-service-diagnostics-v1', JSON.stringify([
        entry(now - 25 * 60 * 60 * 1000, 'expired-record'),
        entry(now + 60_000, 'future-record'),
        { ...entry(now, 'invalid-record'), endpoint: '/auth/login' },
        ...Array.from({ length: 35 }, (_, index) => entry(now - index * 1000, `bounded-${index}`)),
      ]));
    });
    mode = 'ok';
    await page.reload();
    await button.waitFor();
    await toggle.click();
    await page.waitForFunction(() => !document.querySelector('[data-ai-id="login-captcha-refresh"]')?.disabled);
    const restored = await report.inputValue();
    assert.equal((restored.match(/ GET /g) || []).length, 30, 'Records are bounded to 30');
    assert.doesNotMatch(restored, /expired-record|future-record|invalid-record|bounded-34/);
    assert.doesNotMatch(restored, forbidden, 'Restored fields are allowlisted');

    // Storage denial must not turn a healthy API response into a login failure.
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new Error('storage unavailable'); };
      Storage.prototype.setItem = () => { throw new Error('storage unavailable'); };
      Storage.prototype.removeItem = () => { throw new Error('storage unavailable'); };
    });
    await page.reload();
    await button.waitFor();
    await toggle.click();
    await button.click();
    await page.waitForFunction(() => document.querySelector('[data-ai-id="login-service-wakeup-status"]')?.textContent.includes('验证码已刷新'));
    assert.match(await byId('login-service-diagnostics-summary').innerText(), /响应正常/);
    await byId('login-service-diagnostics-clear').click();
    assert.doesNotMatch(await report.inputValue(), /HTTP/);
    assert.deepEqual(errors, []);
    checks.push(`${viewport.width}x${viewport.height}: Render 429; expected session 401; recovery and refresh history; safe fields; clipboard success/fallback; manual links; generic 429/HTML/network distinction; 24h/30-record retention and restore allowlist; storage denial; clear; keyboard/touch/IDs/no overflow/screenshots`);
    await context.close();
  }
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ checks }, null, 2));
  console.log(checks.join('\n'));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
