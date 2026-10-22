// lib/security/request-meta.ts
// Edge-safe helpers that read client metadata from a Request.
//
// Trust: `x-real-ip` and `x-forwarded-for` are client-settable unless a proxy
// overwrites them. Vercel's edge does (VERCEL=1), and so may a self-hosted
// proxy the operator declares with TRUST_PROXY_IP_HEADERS=1. A production
// server without either uses only the rightmost `x-forwarded-for` entry, the
// one appended by the nearest proxy, so a client cannot rotate its own
// rate-limit key (SEC-R-013). Dev and test keep the simple behaviour.

type Env = Record<string, string | undefined>;

export function trustsClientIpHeaders(env: Env = process.env): boolean {
  return env.VERCEL === '1' || env.TRUST_PROXY_IP_HEADERS === '1' || env.NODE_ENV !== 'production';
}

export function clientIp(req: Request, env: Env = process.env): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (!trustsClientIpHeaders(env)) {
    const last = forwarded?.split(',').at(-1)?.trim();
    return last ? last.slice(0, 64) : 'unknown';
  }
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 64);
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first.slice(0, 64);
  return 'unknown';
}

export function userAgent(req: Request): string | null {
  const ua = req.headers.get('user-agent');
  return ua ? ua.slice(0, 256) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestId(req: Request): string | null {
  const id = req.headers.get('x-request-id');
  return id && UUID.test(id) ? id : null;
}
