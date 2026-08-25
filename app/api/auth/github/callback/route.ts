// app/api/auth/github/callback/route.ts
import { exchangeGithubCode, fetchGithubUser, fetchGithubUserEmails, selectVerifiedEmail } from '@/lib/auth/github-oauth';
import { prisma } from '@/lib/prisma';
import { signSessionToken } from '@/lib/auth/jwt';
import { readCookie } from '@/lib/auth/cookies';

// Duck-typed rather than `instanceof Prisma.PrismaClientKnownRequestError`:
// the generated client's error class doesn't survive test mocking cleanly
// (a mocked reject value is a plain object, not a real instance), and the
// `code` field is the only part of the shape this route actually depends
// on. Mirrors app/api/auth/google/callback/route.ts.
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code) return Response.json({ error: 'Missing code' }, { status: 400 });

  // CSRF check: the state cookie was set by app/api/auth/github/route.ts
  // right before redirecting to GitHub, and must come back unchanged as the
  // callback's ?state= param. Both values are required and must match —
  // there is no fallback path that lets a missing cookie or a missing/blank
  // query param slip through, since either one being falsy would make an
  // attacker-forged callback (no cookie of their own, or a guessed/omitted
  // state) indistinguishable from a legitimate one.
  const cookieState = readCookie(req, 'github_oauth_state');
  if (!cookieState || !state || cookieState !== state) {
    return Response.json({ error: 'Invalid OAuth state — possible CSRF, please try signing in again' }, { status: 400 });
  }

  const accessToken = await exchangeGithubCode(code);
  const profile = await fetchGithubUser(accessToken);

  // GitHub's OAuth flow doesn't return an ID token, and /user's bare
  // `email` field can be null (private email setting) and carries no
  // verification signal even when present. The only trustworthy source is
  // /user/emails, which GitHub explicitly labels each address's
  // verified/primary status on. This must run — and reject on failure —
  // before ANY prisma.user lookup/create/update, or an attacker who
  // controls an unverified "victim@example.com" GitHub email could get
  // linked into the victim's existing account.
  const emails = await fetchGithubUserEmails(accessToken);
  const verifiedEmail = selectVerifiedEmail(emails);
  if (!verifiedEmail) {
    return Response.json({ error: 'GitHub account has no verified email address' }, { status: 400 });
  }

  const githubId = String(profile.id);

  // Look up by githubId FIRST. A user's GitHub-associated verified email
  // can change after their first sign-in here; if we only ever looked up by
  // email, that person would come back through the CREATE branch below with
  // their (unchanged) githubId, collide with their own existing row's
  // unique githubId constraint, and be permanently locked out. githubId is
  // the stable identifier for "same GitHub account", so it takes priority
  // over email.
  let user = await prisma.user.findUnique({ where: { githubId } });

  if (!user) {
    // Not found by githubId — fall back to linking/creating by email, so an
    // existing password- or Google-created account gets *linked* rather
    // than shadowed by a second, duplicate row for the same person.
    user = await prisma.user.findUnique({ where: { email: verifiedEmail } });
    if (!user) {
      try {
        user = await prisma.user.create({
          data: { email: verifiedEmail, githubId, name: profile.name, image: profile.avatar_url, emailVerified: true },
        });
      } catch (error) {
        // A racing request (or a stale githubId collision we didn't catch
        // above) can still trip the unique constraint on email or githubId
        // here. Surface a clean error instead of an unhandled 500.
        if (isUniqueConstraintError(error)) {
          return Response.json({ error: 'An account for this GitHub identity already exists' }, { status: 409 });
        }
        throw error;
      }
    } else if (!user.githubId) {
      // Not reassigning `user` from the result here is deliberate: this
      // update only ever touches `githubId`, so the `id`/`sessionVersion`
      // already in hand from the lookup above stay correct for everything
      // used below.
      await prisma.user.update({ where: { id: user.id }, data: { githubId } });
    }
  }

  const sessionToken = await signSessionToken({ userId: user.id, sessionVersion: user.sessionVersion });
  const isProd = process.env.NODE_ENV === 'production';
  const sessionCookie = `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? '; Secure' : ''}`;
  // Clear the one-time state cookie now that it's served its purpose —
  // otherwise it sits valid (and reusable, if somehow recaptured) for the
  // rest of its 5-minute Max-Age. A Response can only take one `Set-Cookie`
  // via the `headers: {...}` object shorthand (later keys overwrite
  // earlier ones), so both cookies are appended individually here.
  const clearStateCookie = 'github_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  const headers = new Headers({ Location: '/today' });
  headers.append('Set-Cookie', sessionCookie);
  headers.append('Set-Cookie', clearStateCookie);

  return new Response(null, { status: 307, headers });
}
