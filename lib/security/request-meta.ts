// lib/security/request-meta.ts
// Edge-safe helpers that read client metadata from a Request.
//
// Trust assumption: the app runs behind Vercel's edge, which overwrites
// `x-real-ip` and `x-forwarded-for` with the connecting client's address, so a
// client cannot choose its own rate-limit key. Behind any other proxy, make
// sure it does the same before relying on per-IP limits.

export function clientIp(req: Request): string {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = req.headers.get('x-forwarded-for');
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
