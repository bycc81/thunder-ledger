import type { FastifyInstance, FastifyReply } from 'fastify';

export type SessionClaims = { sub: string; username: string; role?: string; sessionVersion?: number };

export const SESSION_COOKIE_NAME = 'thunderledger_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function isProductionSessionCookie(): boolean {
  const configured = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (configured === 'true') return true;
  if (configured === 'false') return false;
  if (configured) throw new Error('SESSION_COOKIE_SECURE must be true or false');
  return process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
}

function sessionCookieBaseOptions() {
  const production = isProductionSessionCookie();
  return {
    httpOnly: true,
    path: '/',
    secure: production,
    sameSite: production ? 'none' as const : 'lax' as const,
  };
}

export function sessionCookieOptions() {
  return { ...sessionCookieBaseOptions(), maxAge: SESSION_TTL_SECONDS };
}

export async function setSessionCookie(app: FastifyInstance, reply: FastifyReply, claims: SessionClaims): Promise<void> {
  const token = await app.jwt.sign(claims, { expiresIn: `${SESSION_TTL_SECONDS}s` });
  reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions());
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE_NAME, sessionCookieBaseOptions());
}
