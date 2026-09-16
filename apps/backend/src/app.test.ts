import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { buildApp } from './app.js';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from './auth-session.js';
import { compareInventoryTimelineEvents } from './cost-ledger.js';
import { isSameOccurredAt, purchaseBusinessDate, purchaseCorrectionFixedFields } from './inventory.js';
import { formatReportDateTime } from './reports.js';
import { calculateSettlementMemberNet, settlementProfitPercentageBasisPoints } from './settlements.js';

process.env.SESSION_SECRET = 'test-secret-only';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

function cookieHeader(setCookie: string | string[] | undefined): string {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(value);
  return value.split(';', 1)[0];
}

test('production session cookie is Secure and SameSite=None', () => {
  const previous = process.env.SESSION_COOKIE_SECURE;
  process.env.SESSION_COOKIE_SECURE = 'true';
  try {
    const options = sessionCookieOptions();
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, 'none');
    assert.equal(options.httpOnly, true);
  } finally {
    if (previous === undefined) delete process.env.SESSION_COOKIE_SECURE;
    else process.env.SESSION_COOKIE_SECURE = previous;
  }
});

test('purchase business date keeps the Shanghai calendar date at UTC day boundary', () => {
  const occurredAt = '2026-09-09T16:00:00.000Z';
  assert.equal(purchaseBusinessDate(occurredAt), '2026-09-10');
  assert.equal(isSameOccurredAt(new Date(occurredAt), occurredAt), true);
});

test('purchase correction ignores legacy purchased_on mismatches', () => {
  const occurredAt = '2026-09-09T16:00:00.000Z';
  assert.deepEqual(
    purchaseCorrectionFixedFields({ channelId: 'channel-1', occurredAt }, { channelId: 'channel-1', occurredAt }),
    []
  );
  assert.deepEqual(
    purchaseCorrectionFixedFields({ channelId: 'channel-1', occurredAt }, { channelId: 'channel-2', occurredAt }),
    ['采购渠道']
  );
  assert.deepEqual(
    purchaseCorrectionFixedFields({ channelId: 'channel-1', occurredAt }, { channelId: 'channel-1', occurredAt: '2026-09-09T17:00:00.000Z' }),
    ['采购时间']
  );
});

test('inventory timeline sorts timestamps by epoch, not locale date strings', () => {
  const purchase = { id: 'purchase', kind: 'purchase' as const, occurredAtMs: Date.parse('2026-09-09T16:00:00.000Z') };
  const sale = { id: 'sale', kind: 'sale' as const, occurredAtMs: Date.parse('2026-09-10T02:12:00.000Z') };
  assert.ok(compareInventoryTimelineEvents(purchase, sale) < 0);
  assert.ok(compareInventoryTimelineEvents(sale, purchase) > 0);
});

test('report CSV time uses Shanghai YYYY-MM-DD HH:mm:ss format', () => {
  assert.equal(formatReportDateTime('2026-09-15T16:00:00.000Z'), '2026-09-16 00:00:00');
  assert.equal(formatReportDateTime('2026-09-16T01:02:03.000Z'), '2026-09-16 09:02:03');
});

test('settlement splits net profit and returns the configured cost share exactly once', () => {
  const profit = 1870;
  const dandanNet = calculateSettlementMemberNet({ profitAmount: profit, costRecovery: 0, salesReceived: 5000, expensesPaid: 0 });
  const adminNet = calculateSettlementMemberNet({ profitAmount: profit, costRecovery: 1260, salesReceived: 0, expensesPaid: 0 });
  assert.equal(dandanNet, -3130);
  assert.equal(adminNet, 3130);
  assert.equal(dandanNet + adminNet, 0);
});

test('settlement supports an equal default cost split independently from profit split', () => {
  const dandanNet = calculateSettlementMemberNet({ profitAmount: 1870, costRecovery: 630, salesReceived: 5000, expensesPaid: 0 });
  const adminNet = calculateSettlementMemberNet({ profitAmount: 1870, costRecovery: 630, salesReceived: 0, expensesPaid: 0 });
  assert.equal(dandanNet, -2500);
  assert.equal(adminNet, 2500);
  assert.equal(dandanNet + adminNet, 0);
});

test('settlement accepts profit percentages with up to two decimal places', () => {
  assert.equal(settlementProfitPercentageBasisPoints(33.33), 3333);
  assert.equal(settlementProfitPercentageBasisPoints(66.67), 6667);
  assert.equal(settlementProfitPercentageBasisPoints(33.333), null);
  assert.equal(settlementProfitPercentageBasisPoints(-1), null);
});

test('health endpoint is available', async () => {
  const app = await buildApp();
  const response = await app.inject({ method: 'GET', url: '/api/healthz' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
  await app.close();
});

test('login rejects invalid credentials', async () => {
  process.env.ADMIN_PASSWORD_HASH = '$2b$04$7EqJtq98hPqEX7fNZaFWoO4f4L4rKQm9L6q4vKqv4b6PjSg6QxY7G';
  const app = await buildApp();
  const captcha = await app.inject({ method: 'GET', url: '/api/auth/captcha' });
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong', captchaId: captcha.json().captchaId, captchaCode: '0000' } });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('captcha is required and single use', async () => {
  process.env.ADMIN_PASSWORD_HASH = '$2b$04$7EqJtq98hPqEX7fNZaFWoO4f4L4rKQm9L6q4vKqv4b6PjSg6QxY7G';
  const app = await buildApp();
  const captcha = await app.inject({ method: 'GET', url: '/api/auth/captcha' });
  const payload = captcha.json() as { captchaId: string; image: string };
  assert.equal(captcha.statusCode, 200);
  assert.match(payload.image, /^data:image\/svg\+xml,/);
  assert.equal('code' in payload, false);
  const code = decodeURIComponent(payload.image.split(',')[1]).match(/>(\d)<\/text>/g)?.join('').replace(/[^0-9]/g, '').slice(0, 4);
  assert.equal(code?.length, 4);
  const first = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong', captchaId: payload.captchaId, captchaCode: code } });
  assert.equal(first.statusCode, 401);
  const replay = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong', captchaId: payload.captchaId, captchaCode: code } });
  assert.equal(replay.statusCode, 401);
  await app.close();
});

test('login attempts are rate limited per IP', async () => {
  const app = await buildApp();
  for (let index = 0; index < 5; index += 1) {
    const captcha = await app.inject({ method: 'GET', url: '/api/auth/captcha' });
    const payload = captcha.json() as { captchaId: string };
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong', captchaId: payload.captchaId, captchaCode: '0000' } });
    assert.equal(response.statusCode, 401);
  }
  const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong' } });
  assert.equal(blocked.statusCode, 429);
  await app.close();
});

test('state-changing requests reject untrusted browser origins', async () => {
  const app = await buildApp();
  const response = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://untrusted.example' } });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), { code: 'INVALID_ORIGIN', message: '请求来源不被允许' });
  await app.close();
});

test('login sets an HttpOnly cookie and session rejects missing cookie', async () => {
  const password = 'session-test-password';
  process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash(password, 4);
  const app = await buildApp();
  const unauthorized = await app.inject({ method: 'GET', url: '/api/auth/session' });
  assert.equal(unauthorized.statusCode, 401);

  const captcha = await app.inject({ method: 'GET', url: '/api/auth/captcha' });
  const challenge = captcha.json() as { captchaId: string; image: string };
  const code = decodeURIComponent(challenge.image.split(',')[1]).match(/>(\d)<\/text>/g)?.join('').replace(/[^0-9]/g, '').slice(0, 4);
  assert.equal(code?.length, 4);
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password, captchaId: challenge.captchaId, captchaCode: code },
  });
  assert.equal(login.statusCode, 200);
  assert.deepEqual(login.json(), { authenticated: true });
  assert.equal('accessToken' in login.json(), false);
  const setCookie = login.headers['set-cookie'];
  const serialized = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.match(serialized ?? '', new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(serialized ?? '', /HttpOnly/i);
  assert.match(serialized ?? '', /SameSite=Lax/i);
  assert.doesNotMatch(serialized ?? '', /Secure/i);

  const authorized = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: cookieHeader(setCookie) } });
  assert.equal(authorized.statusCode, 200);
  assert.deepEqual(authorized.json(), { authenticated: true, username: 'admin', role: 'admin', superAdmin: true });

  const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: cookieHeader(setCookie) } });
  assert.equal(logout.statusCode, 200);
  assert.deepEqual(logout.json(), { ok: true });
  assert.match(String(logout.headers['set-cookie']), new RegExp(`^${SESSION_COOKIE_NAME}=`));
  assert.match(String(logout.headers['set-cookie']), /Max-Age=0/i);
  await app.close();
});
