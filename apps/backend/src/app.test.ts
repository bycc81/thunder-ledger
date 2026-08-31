import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from './app.js';

process.env.SESSION_SECRET = 'test-secret-only';
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';

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
  const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong' } });
  assert.equal(response.statusCode, 401);
  await app.close();
});
