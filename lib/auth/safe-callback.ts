// lib/auth/safe-callback.ts
// Open-redirect guard for `callbackUrl` (SEC-B-011, SEC-R-002). Pure and
// isomorphic: the sign-in page (client) and requirePageUser (server) both use it.
//
// Only same-origin relative paths are accepted. The raw value must start with
// one `/` and contain no backslash, control character, whitespace or encoded
// slash/backslash in its path. It is then normalised with the WHATWG URL
// parser against a dummy origin, and the checks are repeated on the
// NORMALISED result, which is what the caller navigates to: dot segments can
// turn `/.//evil.example` into the protocol-relative `//evil.example`.
// Anything else falls back to `/today`.

export const DEFAULT_CALLBACK = '/today';
const MAX_LENGTH = 512;
const BASE = 'http://callback.invalid';

// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\s\\]/;
/** Percent-encoded `/`, `\` or `%` (double encoding) in the path part. */
const ENCODED_SEPARATOR = /%(?:2f|5c|25)/i;

function isSafeRelative(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !UNSAFE_CHARS.test(path);
}

export function safeCallback(raw: string | null | undefined, fallback: string = DEFAULT_CALLBACK): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  if (!isSafeRelative(raw)) return fallback;
  const rawPath = raw.split(/[?#]/, 1)[0];
  if (ENCODED_SEPARATOR.test(rawPath)) return fallback;
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE) return fallback;
    const out = `${url.pathname}${url.search}${url.hash}`;
    // Validate the value that is actually returned, not only the input.
    if (!isSafeRelative(url.pathname) || UNSAFE_CHARS.test(out)) return fallback;
    if (new URL(out, BASE).origin !== BASE) return fallback;
    // Never bounce back into the auth pages themselves.
    if (/^\/(sign-in|sign-up)(\/|$)/.test(url.pathname)) return fallback;
    return out;
  } catch {
    return fallback;
  }
}
