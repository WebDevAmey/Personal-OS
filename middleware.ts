// middleware.ts
// Edge filter in front of every route (deny by default):
//
// - Every page and API route requires a session cookie whose JWT verifies,
//   except the explicit public allowlist below. This is an early filter only:
//   the signature/expiry check cannot see revocation (sessionVersion), so
//   every protected page and handler must still call getSession()/
//   requireUser()/requirePageUser() from lib/auth/session.ts.
// - Unauthenticated pages redirect to /sign-in?callbackUrl=<path>; API
//   routes get a 401 JSON body.
// - State-changing /api requests must pass the same-origin check
//   (lib/security/csrf.ts), except server-to-server endpoints.
// - Sets x-request-id (correlation) and x-pos-pathname (used by
//   requirePageUser to build callbackUrl) on the forwarded request.
import { NextResponse, type NextRequest } from 'next/server';
import { verifySessionToken } from '@/lib/auth/jwt';
import { sessionCookieName } from '@/lib/auth/cookies';
import { checkSameOrigin } from '@/lib/security/csrf';

const PUBLIC_PAGES = new Set(['/', '/sign-in', '/sign-up', '/verify-otp', '/forgot-password', '/reset-password']);

// API routes reachable without a session. Anything under /api/auth that acts
// on the signed-in user (sessions, passkey registration) is NOT listed.
const PUBLIC_API_PREFIXES = [
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/verify-otp',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/logout',
  '/api/auth/google',
  '/api/auth/github',
  '/api/auth/passkey/auth/',
  '/api/inngest',
  '/api/health',
  // LEGACY Auth.js endpoints served by app/api/auth/[...nextauth] until the
  // ADR-002 cutover deletes it (AUTH-010); remove these entries with it.
  '/api/auth/signin',
  '/api/auth/signout',
  '/api/auth/callback',
  '/api/auth/session',
  '/api/auth/csrf',
  '/api/auth/providers',
  '/api/auth/error',
];

// Server-to-server endpoints authenticated by their own signatures; browsers
// never call them, so the Origin check does not apply.
const CSRF_EXEMPT_PREFIXES = ['/api/inngest'];

const STATIC_FILE = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|webm|mp4|json|txt|xml|woff2?|ttf|css|js|map)$/i;

function matchesPrefix(pathname: string, prefix: string): boolean {
  if (prefix.endsWith('/')) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return PUBLIC_API_PREFIXES.some((p) => matchesPrefix(pathname, p));
  if (PUBLIC_PAGES.has(pathname)) return true;
  if (pathname.startsWith('/_next/')) return true;
  // Files served from /public (lottie JSON, images, video).
  return STATIC_FILE.test(pathname);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function forward(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  const incoming = request.headers.get('x-request-id');
  const requestId = incoming && UUID.test(incoming) ? incoming : crypto.randomUUID();
  headers.set('x-request-id', requestId);
  headers.set('x-pos-pathname', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('x-request-id', requestId);
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  if (isApi && !CSRF_EXEMPT_PREFIXES.some((p) => matchesPrefix(pathname, p))) {
    const csrf = checkSameOrigin(request);
    if (!csrf.ok) {
      return NextResponse.json(
        { error: 'Cross-site request blocked', code: 'CSRF_BLOCKED', reason: csrf.reason },
        { status: 403 },
      );
    }
  }

  if (isPublicPath(pathname)) return forward(request);

  const token = request.cookies.get(sessionCookieName())?.value;
  const payload = token ? await verifySessionToken(token) : null;
  if (payload) return forward(request);

  if (isApi) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const signInUrl = new URL('/sign-in', request.url);
  signInUrl.searchParams.set('callbackUrl', `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  // Everything except Next's build output and image optimiser.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
