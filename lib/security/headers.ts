// lib/security/headers.ts
// Security headers (SEC-B-018), applied to every response.
//
// CSP trade-off: this is a static, nonce-free policy so pages stay statically
// renderable and cacheable. Next 15's App Router inlines its bootstrap and RSC
// payload scripts, which a nonce-free policy can only allow with
// 'unsafe-inline' in script-src. What the policy still provides: scripts
// load only from this origin (no third-party script hosts), no plugins
// (object-src 'none'), no <base> hijacking, no framing (frame-ancestors
// 'none'), form posts only to this origin and the two OAuth providers, and
// fetch/XHR/WebSocket only to this origin. It does NOT stop an injected
// inline <script>; React's escaping (no dangerouslySetInnerHTML) is the XSS
// control. Moving to a per-request nonce + 'strict-dynamic' (set in
// middleware) removes 'unsafe-inline' at the cost of forcing every page to
// render dynamically; revisit if any HTML-injection sink is introduced.
// 'unsafe-eval' is allowed only in development (React Refresh needs it).

export function contentSecurityPolicy(production: boolean = process.env.NODE_ENV === 'production'): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(production ? [] : ["'unsafe-eval'"])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com', 'https://avatars.githubusercontent.com'],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", 'blob:'],
    'connect-src': ["'self'", ...(production ? [] : ['ws:', 'wss:'])],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", 'https://accounts.google.com', 'https://github.com'],
    'frame-ancestors': ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (production) policy.push('upgrade-insecure-requests');
  return policy.join('; ');
}

export function securityHeaders(production: boolean = process.env.NODE_ENV === 'production'): { key: string; value: string }[] {
  const headers = [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(production) },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Microphone is used by voice capture (ADR-015) on our own origin only.
    { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ];
  if (production) {
    // HSTS only in production: on localhost it would pin http://localhost to HTTPS.
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' });
  }
  return headers;
}
