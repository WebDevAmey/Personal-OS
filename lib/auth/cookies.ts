// lib/auth/cookies.ts
// Edge-safe cookie helpers: only touches Headers and process.env, no Prisma,
// bcrypt or Node-only APIs (middleware.ts imports this module).
//
// Every auth cookie is built here so the flags cannot drift between routes:
//   HttpOnly; SameSite=Lax; Path=/; explicit Max-Age; Secure in production.
// In production the name carries the `__Host-` prefix, which browsers only
// accept with Secure, Path=/ and no Domain attribute. That stops a sibling
// subdomain from planting ("tossing") a cookie with the same name.

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  const match = header.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return null;
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** Cookie name, with the `__Host-` prefix in production. */
export function cookieName(base: string): string {
  return isProduction() ? `__Host-${base}` : base;
}

export const SESSION_COOKIE_BASE = 'session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function sessionCookieName(): string {
  return cookieName(SESSION_COOKIE_BASE);
}

export interface CookieOptions {
  maxAgeSeconds: number;
}

/** Serialises a hardened Set-Cookie value. `base` is the unprefixed name. */
export function buildCookie(base: string, value: string, { maxAgeSeconds }: CookieOptions): string {
  const parts = [
    `${cookieName(base)}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(base: string): string {
  return buildCookie(base, '', { maxAgeSeconds: 0 });
}

export function buildSessionCookie(token: string): string {
  return buildCookie(SESSION_COOKIE_BASE, token, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS });
}

export function clearSessionCookie(): string {
  return clearCookie(SESSION_COOKIE_BASE);
}

/** Reads a cookie set with buildCookie (resolves the env-specific name). */
export function readAuthCookie(req: Request, base: string): string | null {
  return readCookie(req, cookieName(base));
}
