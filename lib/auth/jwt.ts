// lib/auth/jwt.ts
// Edge-safe: no Prisma, no bcrypt, no Node.js-only APIs. middleware.ts imports this directly.
import { SignJWT, jwtVerify } from 'jose';
import { SESSION_MAX_AGE_SECONDS, sessionCookieName } from './cookies';

export const JWT_ISSUER = 'personal-os';
export const JWT_AUDIENCE = 'personal-os:session';

// The cookie name is `__Host-session` in production and `session` elsewhere.
export { sessionCookieName };

function encodeSecret(value: string | undefined, name: string): Uint8Array | null {
  if (value === undefined || value === '') return null;
  if (value.length < 32) throw new Error(`${name} must be at least 32 characters long`);
  return new TextEncoder().encode(value);
}

// Read lazily so `next build` and modules that merely import this file do not
// need the secret; the first sign or verify fails loudly when it is missing.
function currentSecret(): Uint8Array {
  const secret = encodeSecret(process.env.JWT_SECRET, 'JWT_SECRET');
  if (!secret) throw new Error('JWT_SECRET must be set and at least 32 characters long');
  return secret;
}

function previousSecret(): Uint8Array | null {
  return encodeSecret(process.env.JWT_SECRET_PREVIOUS, 'JWT_SECRET_PREVIOUS');
}

export interface SessionPayload {
  userId: string;
  sessionVersion: number;
}

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId, sessionVersion: payload.sessionVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(currentSecret());
}

async function verifyWith(token: string, secret: Uint8Array): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      requiredClaims: ['exp', 'iat'],
    });
    if (typeof payload.userId !== 'string' || typeof payload.sessionVersion !== 'number') {
      return null;
    }
    return { userId: payload.userId, sessionVersion: payload.sessionVersion };
  } catch {
    return null;
  }
}

/**
 * Verifies with JWT_SECRET, then with JWT_SECRET_PREVIOUS when set (secret
 * rotation). Tokens are only ever signed with the current secret.
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const current = await verifyWith(token, currentSecret());
  if (current) return current;
  const previous = previousSecret();
  return previous ? verifyWith(token, previous) : null;
}
