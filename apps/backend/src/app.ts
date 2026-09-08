import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'node:crypto';
import { allowedOrigins } from './config.js';
import { checkDatabase, getPool } from './db/client.js';
import { registerAssetRoutes } from './assets.js';
import { auth, registerAccessRoutes, type AccessRequest } from './access.js';
import { registerProductRoutes } from './products.js';
import { registerInventoryRoutes } from './inventory.js';
import { registerSalesExpenseRoutes } from './sales-expenses.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(helmet);
  await app.register(cors, { origin: allowedOrigins() });
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) throw new Error('SESSION_SECRET is required');
  await app.register(jwt, { secret: sessionSecret });

  const captchas = new Map<string, { code: string; expiresAt: number }>();
  const loginFailures = new Map<string, { count: number; windowStartedAt: number; blockedUntil: number }>();
  const captchaTtlMs = 5 * 60 * 1000;
  const failureWindowMs = 60 * 1000;
  const maxFailures = 5;

  function pruneAuthState(now: number) {
    for (const [id, challenge] of captchas) if (challenge.expiresAt <= now) captchas.delete(id);
    for (const [ip, state] of loginFailures) {
      if (state.blockedUntil <= now && now - state.windowStartedAt > failureWindowMs) loginFailures.delete(ip);
    }
  }

  function recordLoginFailure(ip: string, now: number) {
    const previous = loginFailures.get(ip);
    const state = previous && now - previous.windowStartedAt <= failureWindowMs ? previous : { count: 0, windowStartedAt: now, blockedUntil: 0 };
    state.count += 1;
    if (state.count >= maxFailures) state.blockedUntil = now + failureWindowMs;
    loginFailures.set(ip, state);
  }

  function captchaSvg(code: string): string {
    const bars = Array.from({ length: 4 }, (_, index) => `<path d="M${18 + index * 34} 4l${index % 2 ? 6 : -5} 32"/>`).join('');
    const digits = [...code].map((digit, index) => `<text x="${22 + index * 34}" y="30" transform="rotate(${index % 2 ? 5 : -5} ${28 + index * 34} 24)">${digit}</text>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40" viewBox="0 0 160 40" role="img" aria-label="登录验证码"><rect width="160" height="40" rx="8" fill="#f5f7f9"/><g stroke="#b9c1cb" stroke-width="1">${bars}</g><g fill="#181d26" font-family="monospace" font-size="28" font-weight="700">${digits}</g></svg>`;
  }

  app.get('/api/healthz', async () => ({ status: 'ok' }));
  app.get('/api/readyz', async (_request, reply) => { try { await checkDatabase(); return { status: 'ready' }; } catch { return reply.code(503).send({ status: 'not_ready' }); } });
  app.get('/api/auth/captcha', async (_request, reply) => {
    const now = Date.now();
    pruneAuthState(now);
    const captchaId = randomUUID();
    const code = String(randomInt(0, 10000)).padStart(4, '0');
    captchas.set(captchaId, { code, expiresAt: now + captchaTtlMs });
    return reply.send({ captchaId, image: `data:image/svg+xml,${encodeURIComponent(captchaSvg(code))}` });
  });
  app.get('/api/auth/session', async (request, reply) => {
    const accessRequest = request as AccessRequest;
    if (!(await auth(accessRequest, reply))) return;
    return {
      authenticated: true,
      username: accessRequest.access!.username,
      role: (request.user as { role?: string }).role,
      superAdmin: accessRequest.access!.superAdmin
    };
  });
  app.post<{ Body: { username?: string; password?: string; captchaId?: string; captchaCode?: string } }>('/api/auth/login', async (request, reply) => {
    const now = Date.now();
    pruneAuthState(now);
    const ip = request.ip;
    const failureState = loginFailures.get(ip);
    if (failureState && failureState.blockedUntil > now) return reply.code(429).send({ code: 'LOGIN_RATE_LIMITED', message: 'Login attempts are temporarily limited' });

    const { username, password, captchaId, captchaCode } = request.body ?? {};
    const challenge = captchaId ? captchas.get(captchaId) : undefined;
    const validCaptcha = Boolean(challenge && challenge.expiresAt > now && captchaCode && captchaCode.length === 4 && /^\d{4}$/.test(captchaCode) && captchaCode === challenge.code);
    if (!validCaptcha) {
      if (challenge) captchas.delete(captchaId!);
      recordLoginFailure(ip, now);
      return reply.code(401).send({ code: 'INVALID_LOGIN_CHALLENGE', message: 'Invalid or expired captcha' });
    }
    captchas.delete(captchaId!);

    // Database users are preferred when the access migration is available; the
    // environment administrator remains a compatibility/bootstrap account.
    try {
      const row = (await getPool().query('SELECT id, username, password_hash, status, session_version FROM users WHERE username=$1', [username ?? ''])).rows[0] as { id: string; username: string; password_hash: string; status: string; session_version: number } | undefined;
      if (row) {
        if (row.status !== 'active' || !password || !(await bcrypt.compare(password, row.password_hash))) { recordLoginFailure(ip, now); return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' }); }
        loginFailures.delete(ip);
        return { accessToken: await app.jwt.sign({ sub: row.id, username: row.username, sessionVersion: row.session_version }, { expiresIn: '8h' }) };
      }
    } catch { /* database may be unavailable during bootstrap or legacy tests */ }

    const expectedUser = process.env.ADMIN_USERNAME ?? 'admin';
    const expectedHash = process.env.ADMIN_PASSWORD_HASH;
    if (!username || !password || username !== expectedUser || !expectedHash || !(await bcrypt.compare(password, expectedHash))) {
      recordLoginFailure(ip, now);
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' });
    }
    loginFailures.delete(ip);
    try {
      const pool = getPool();
      await pool.query('INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3) ON CONFLICT (username) DO NOTHING', [randomUUID(), expectedUser, expectedHash]);
      const row = (await pool.query('SELECT id,username,status,session_version FROM users WHERE username=$1', [expectedUser])).rows[0] as { id: string; username: string; status: string; session_version: number } | undefined;
      if (row?.status === 'active') return { accessToken: await app.jwt.sign({ sub: row.id, username: row.username, sessionVersion: row.session_version }, { expiresIn: '8h' }) };
    } catch { /* database may be unavailable during bootstrap or legacy tests */ }
    return { accessToken: await app.jwt.sign({ sub: username, username, role: 'admin' }, { expiresIn: '8h' }) };
  });
  app.get('/api/openapi.json', async () => ({ openapi: '3.0.3', info: { title: 'ThunderLedger API', version: '0.1.0' }, paths: {} }));
  await registerAssetRoutes(app);
  await registerAccessRoutes(app);
  await registerProductRoutes(app);
  await registerInventoryRoutes(app);
  await registerSalesExpenseRoutes(app);
  return app;
}
