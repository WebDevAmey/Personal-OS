// lib/auth/safe-callback.ts
// Open-redirect guard for `callbackUrl` (SEC-B-011). Pure and isomorphic: the
// sign-in page (client) and requirePageUser (server) both use it.
//
// Only same-origin relative paths are accepted: one leading `/`, not `//`
// (protocol-relative), no backslashes (browsers treat `/\evil.com` as
// `//evil.com`), no control characters or whitespace, and nothing that
// resolves to another origin. Anything else falls back to `/today`.

export const DEFAULT_CALLBACK = '/today';
const MAX_LENGTH = 512;
const BASE = 'http://callback.invalid';

export function safeCallback(raw: string | null | undefined, fallback: string = DEFAULT_CALLBACK): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  if (raw.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE) return fallback;
    // Never bounce back into the auth pages themselves.
    if (/^\/(sign-in|sign-up)(\/|$)/.test(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
