// Built UI acceptance; all API responses are fixtures, no production requests.
// Run after Web build. PLAYWRIGHT_MODULE_PATH may point to an external Playwright install.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = fileURLToPath(new URL('./evidence/', import.meta.url));
await mkdir(output, { recursive: true });
const registry = await readFile(new URL('./data-ai-id-registry.md', import.meta.url), 'utf8');
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
let browser;
const checks = [], observed = new Set();
const poll = async (fn, message) => {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(message);
};
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let healthMode = 'limited', captchaMode = 'limited', retryAfter;
    let healthCalls = 0, captchaCalls = 0;
    const posts = [];
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const json = (status, body, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers });
      if (pathname === '/api/auth/session') return json(401, { code: 'UNAUTHORIZED' });
      if (pathname === '/api/auth/captcha') {
        captchaCalls++;
        if (captchaMode === 'limited') return json(429, {});
        if (captchaMode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Challenge</html>' });
        return json(200, { captchaId: `fixture-${captchaCalls}`, image: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><text x="10" y="30" font-size="28">1234</text></svg>') });
      }
      if (pathname === '/api/healthz') {
        healthCalls++;
        if (healthMode === 'ok') return json(200, { status: 'ok' });
        if (healthMode === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Challenge</html>' });
        if (healthMode === 'network') return route.abort('failed');
        return json(429, {}, retryAfter ? { 'retry-after': retryAfter } : {});
      }
      if (pathname === '/api/auth/login') {
        posts.push(route.request().postDataJSON());
        return json(401, { code: 'INVALID_CREDENTIALS' });
      }
      return json(200, []);
    });
    const byId = id => page.locator(`[data-ai-id="${id}"]`);
    const button = byId('login-service-wakeup-button');
    const status = byId('login-service-wakeup-status');
    const statusHas = text => poll(async () => (await status.innerText()).includes(text), `Expected status: ${text}`);
    const snapshot = async name => {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      const ids = await page.locator('[data-ai-id]').evaluateAll(nodes => nodes.map(node => node.dataset.aiId));
      assert.equal(ids.length, new Set(ids).size, 'Unique IDs');
      for (const id of ids) { assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/); assert.ok(registry.includes(`| ${id} |`)); observed.add(id); }
      const box = await button.boundingBox();
      assert.ok(box.height >= 44 && box.y + box.height <= viewport.height, 'Wake button visible and touchable');
      assert.ok(box.width <= 120 && box.x + box.width >= viewport.width - 32 && box.y >= viewport.height - 200, 'Compact button at bottom right');
      const statusBox = await status.boundingBox();
      assert.ok(statusBox.y >= box.y + box.height && viewport.height - statusBox.y - statusBox.height >= 59, 'Explanation below button with raised bottom spacing');
      const submitBox = await byId('login-submit').boundingBox();
      assert.ok(box.y >= submitBox.y + submitBox.height, 'Footer does not cover login');
      await page.screenshot({ path: path.join(output, `${viewport.width}-${name}.png`), animations: 'disabled' });
    };
    await page.goto(`${base}/login`);
    await poll(async () => await button.isVisible() && await button.isEnabled(), 'Wake entry usable after initial 429');
    assert.equal(await status.innerText(), '服务未响应时，点击尝试唤醒。', 'Initial footer explains the wake button');
    assert.equal(await button.evaluate(node => getComputedStyle(node).borderTopWidth), '1px', 'Compact button has a visible border');
    await snapshot('initial-error');
    await byId('login-username').locator('input').fill('fixture-user');
    await byId('login-password').locator('input').fill('fixture-password');
    await button.focus();
    await page.keyboard.press('Enter');
    await statusHas('10 秒后');
    assert.equal(await button.isDisabled(), true);
    assert.equal(await byId('login-submit').isDisabled(), true);
    assert.equal(await byId('login-captcha-refresh').isDisabled(), true);
    await button.evaluate(node => { node.click(); node.click(); });
    assert.equal(healthCalls, 1, 'Duplicate clicks do not send more requests');
    await snapshot('waiting');
    healthMode = 'ok'; captchaMode = 'ok';
    await page.clock.runFor(10_000);
    await statusHas('验证码已刷新');
    assert.equal(healthCalls, 2);
    assert.equal(await byId('login-error').count(), 0, 'Old captcha error cleared');
    assert.equal(await byId('login-username').locator('input').inputValue(), 'fixture-user');
    assert.equal(await byId('login-password').locator('input').inputValue(), 'fixture-password');
    assert.equal(posts.length, 0, 'Wake never submits credentials');
    await snapshot('recovered');
    await page.setViewportSize({ width: viewport.width, height: 500 });
    const shortButton = await button.boundingBox();
    const shortForm = await byId('login-form').boundingBox();
    assert.ok(shortButton.y >= shortForm.y + shortForm.height, 'Short viewport scrolls without covering form');
    await page.screenshot({ path: path.join(output, `${viewport.width}-short.png`), fullPage: true, animations: 'disabled' });
    await page.setViewportSize(viewport);

    // Ordinary login still sends the original credential/captcha contract.
    await byId('login-captcha').locator('input').fill('1234');
    const captchaId = `fixture-${captchaCalls}`;
    await byId('login-submit').click();
    await poll(() => posts.length === 1, 'Login request observed');
    assert.deepEqual(posts[0], { username: 'fixture-user', password: 'fixture-password', captchaId, captchaCode: '1234' });
    await poll(async () => (await byId('login-error').innerText()).includes('用户名、密码或验证码错误'), 'Credential error retained');

    // A 200 HTML challenge must never be reported as success.
    healthMode = 'html';
    const before = healthCalls;
    await button.click();
    for (const seconds of [10, 20, 30]) {
      await statusHas(`${seconds} 秒后`);
      await page.clock.runFor(seconds * 1000);
    }
    await statusHas('暂时无法连接');
    assert.equal(healthCalls - before, 4, 'Bounded retry count for invalid health responses');
    await page.clock.runFor(120_000);
    assert.equal(healthCalls - before, 4, 'No background polling after exhaustion');
    await snapshot('exhausted');

    healthMode = 'limited';
    const beforeLimited = healthCalls;
    await button.click();
    for (const seconds of [10, 20, 30]) {
      await statusHas(`${seconds} 秒后`);
      await page.clock.runFor(seconds * 1000);
    }
    await statusHas('暂时无法连接');
    assert.equal(healthCalls - beforeLimited, 4, 'Persistent 429 stops after four attempts');
    retryAfter = '180';
    const beforeLongRetry = healthCalls;
    await button.click(); await statusHas('暂时无法连接');
    assert.equal(healthCalls - beforeLongRetry, 1, 'Long Retry-After stops this round');
    retryAfter = '25';
    await button.click(); await statusHas('25 秒后');
    const beforeRetry = healthCalls;
    await page.clock.runFor(24_000);
    assert.equal(healthCalls, beforeRetry, 'Retry-After is respected');
    healthMode = 'ok'; captchaMode = 'html';
    await page.clock.runFor(1000);
    await statusHas('但验证码加载失败');
    assert.ok(!(await status.innerText()).includes('请继续登录'));
    await snapshot('captcha-failed');
    captchaMode = 'ok';
    await byId('login-captcha-refresh').click();
    await poll(async () => await byId('login-error').count() === 0, 'Manual captcha recovery');

    // Leave via client-side navigation while waiting; no later health requests.
    retryAfter = undefined; healthMode = 'network';
    await button.click(); await statusHas('10 秒后');
    const beforeLeave = healthCalls;
    await page.evaluate(() => { history.pushState({}, '', '/register'); dispatchEvent(new PopStateEvent('popstate')); });
    await byId('login-page').waitFor({ state: 'hidden' });
    await page.clock.runFor(120_000);
    assert.equal(healthCalls, beforeLeave, 'Unmount cancels scheduled retry');
    assert.deepEqual(errors, []);
    checks.push(`${viewport.width}x${viewport.height}: initial 429; keyboard wake; duplicate suppression; 429 recovery; preserved credentials; unchanged login payload; HTML challenge rejection; retry bound; Retry-After; captcha failure/manual recovery; network error and unmount; IDs/screenshots/no overflow`);
    await context.close();
  }
  // Native XHR timeouts and in-flight cancellation use real time, not a fake response.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.clock.install();
  let nativeHealthCalls = 0;
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/session' || pathname === '/api/healthz') {
      if (pathname === '/api/healthz') nativeHealthCalls++;
      return;
    }
    return route.fulfill({ status: 429, contentType: 'application/json', body: '{}' });
  });
  const started = Date.now();
  await page.goto(`${base}/login`);
  const nativeButton = page.locator('[data-ai-id="login-service-wakeup-button"]');
  await nativeButton.waitFor({ timeout: 15_000 });
  assert.ok(Date.now() - started < 15_000, 'Session timeout exposes login page');
  await nativeButton.click();
  await page.waitForFunction(() => document.querySelector('[data-ai-id="login-service-wakeup-status"]')?.textContent.includes('10 秒后'), undefined, { timeout: 20_000 });
  assert.equal(nativeHealthCalls, 1, 'Health timeout enters delayed retry');
  await page.clock.runFor(10_000);
  await poll(() => nativeHealthCalls === 2, 'Second health request started');
  const cancelled = page.waitForEvent('requestfailed', req => req.url().endsWith('/api/healthz'));
  await page.evaluate(() => { history.pushState({}, '', '/register'); dispatchEvent(new PopStateEvent('popstate')); });
  await cancelled;
  await page.clock.runFor(120_000);
  assert.equal(nativeHealthCalls, 2, 'In-flight request aborted without further retries');
  await context.close();
  checks.push('Real XHR: session timeout exposes login; 15s health timeout enters retry; unmount aborts in-flight health request');
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, observedIds: [...observed] }, null, 2));
  console.log(checks.join('\n'));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
