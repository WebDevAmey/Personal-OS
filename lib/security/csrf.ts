// lib/security/csrf.ts
// CSRF defence for cookie-authenticated, state-changing requests (SEC-B-010).
// Edge-safe: middleware.ts and route handlers both use it.
//
// Usage in a route handler (POST/PATCH/PUT/DELETE):
//
//   const blocked = csrfGuard(req);          // Origin check + JSON content type
//   if (blocked) return blocked;
//
// or `assertSameOrigin(req)` alone for bodiless requests.
//
// Policy, in order:
//   1. Safe methods (GET, HEAD, OPTIONS) always pass.
//   2. If `Origin` is present it must equal the app origin
//      (NEXT_PUBLIC_APP_URL). `Origin: null` is rejected.
//   3. Otherwise `Sec-Fetch-Site` must be `same-origin`.
//   4. A request with neither header is rejected. Every current browser sends
//      `Origin` on cross-site POSTs and `Sec-Fetch-Site` on all requests, so
//      only non-browser clients (which cannot carry a victim's cookies) are
//      affected by this rule.
// SameSite=Lax on the session cookie remains the first layer; this check also
// covers login CSRF, where the attacker's goal is to set a cookie rather than
// use one.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type CsrfFailure = 'cross_origin' | 'null_origin' | 'cross_site_fetch' | 'missing_origin' | 'not_json';

export type CsrfResult = { ok: true } | { ok: false; reason: CsrfFailure };

function allowedOrigins(req: Request): Set<string> {
  const origins = new Set<string>();
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      origins.add(new URL(configured).origin);
    } catch {
      // A malformed NEXT_PUBLIC_APP_URL leaves only the dev fallback below.
    }
  }
  // Outside production the request's own origin is accepted too, so preview
  // ports and test hosts work. Production trusts only the configured origin,
  // since `req.url` can reflect an internal host behind the platform proxy.
  if (process.env.NODE_ENV !== 'production') {
    try {
      origins.add(new URL(req.url).origin);
    } catch {
      // ignore
    }
  }
  return origins;
}

export function checkSameOrigin(req: Request): CsrfResult {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return { ok: true };

  const origin = req.headers.get('origin');
  if (origin !== null) {
    if (origin === 'null') return { ok: false, reason: 'null_origin' };
    return allowedOrigins(req).has(origin) ? { ok: true } : { ok: false, reason: 'cross_origin' };
  }

  const site = req.headers.get('sec-fetch-site');
  if (site !== null) {
    return site === 'same-origin' ? { ok: true } : { ok: false, reason: 'cross_site_fetch' };
  }

  return { ok: false, reason: 'missing_origin' };
}

/** True when the body is declared as JSON (blocks `text/plain` form posts). */
export function isJsonRequest(req: Request): boolean {
  const type = req.headers.get('content-type');
  if (!type) return false;
  return type.split(';')[0].trim().toLowerCase() === 'application/json';
}

function forbidden(reason: CsrfFailure): Response {
  return Response.json({ error: 'Cross-site request blocked', code: 'CSRF_BLOCKED', reason }, { status: 403 });
}

/** Returns a 403 Response when the request fails the same-origin check, else null. */
export function assertSameOrigin(req: Request): Response | null {
  const result = checkSameOrigin(req);
  return result.ok ? null : forbidden(result.reason);
}

/**
 * Same-origin check plus `Content-Type: application/json` for requests with a
 * body. Returns a 403/415 Response to send, or null when the request may proceed.
 */
export function csrfGuard(req: Request, { requireJson = true }: { requireJson?: boolean } = {}): Response | null {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  if (requireJson && !SAFE_METHODS.has(req.method.toUpperCase()) && !isJsonRequest(req)) {
    return Response.json({ error: 'Content-Type must be application/json', code: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }
  return null;
}
