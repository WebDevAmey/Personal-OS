// lib/auth/cookies.ts
// Edge-safe: only touches the Request's Headers, no Prisma/bcrypt/Node-only
// APIs. Shared by the Google OAuth callback (Task 7) and the GitHub OAuth
// callback (Task 8).
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  const match = header.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}
