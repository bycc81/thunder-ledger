import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';
import { allowedOrigins, required } from './config.js';
import { checkDatabase } from './db/client.js';
import { registerAssetRoutes } from './assets.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(helmet);
  await app.register(cors, { origin: allowedOrigins() });
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) throw new Error('SESSION_SECRET is required');
  await app.register(jwt, { secret: sessionSecret });
  app.get('/api/healthz', async () => ({ status: 'ok' }));
  app.get('/api/readyz', async (_request, reply) => { try { await checkDatabase(); return { status: 'ready' }; } catch { return reply.code(503).send({ status: 'not_ready' }); } });
  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body ?? {};
    const expectedUser = process.env.ADMIN_USERNAME ?? 'admin';
    const expectedHash = process.env.ADMIN_PASSWORD_HASH;
    if (!username || !password || username !== expectedUser || !expectedHash || !(await bcrypt.compare(password, expectedHash))) {
      return reply.code(401).send({ code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' });
    }
    return { accessToken: await app.jwt.sign({ sub: username, role: 'admin' }, { expiresIn: '8h' }) };
  });
  app.get('/api/openapi.json', async () => ({ openapi: '3.0.3', info: { title: 'ThunderLedger API', version: '0.1.0' }, paths: {} }));
  await registerAssetRoutes(app);
  return app;
}
