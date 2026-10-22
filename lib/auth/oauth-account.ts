// lib/auth/oauth-account.ts
// Finds, links or creates the user for a verified OAuth identity.
//
// Order: provider id first (stable across email changes), then verified email.
// Callers MUST pass only a provider-verified email (Google `email_verified`,
// GitHub `selectVerifiedEmail`).
//
// Linking rules (SEC-B-005, account pre-hijack):
// - Existing VERIFIED account with that email: the provider id is linked and
//   sessionVersion is bumped (a new sign-in method was added, so older
//   sessions are revoked and only this sign-in's fresh token is valid).
// - Existing UNVERIFIED account (only legacy rows; sign-up no longer creates
//   them): nobody has proved the password-holder owns the address, so the
//   password is dropped, the row is marked verified (the provider just proved
//   ownership), lockout state is cleared and sessionVersion bumped. A squatter's
//   password can therefore never become valid on the real owner's account.
//   The owner can set a password later with "Forgot password".
import { prisma } from '@/lib/prisma';
import type { User } from '@/lib/generated/prisma/client';
import { findUserByEmail } from './http';

export type OAuthProviderField = 'googleId' | 'githubId';

export interface OAuthIdentity {
  field: OAuthProviderField;
  providerId: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

export type OAuthResolution =
  | { ok: true; user: User; outcome: 'existing' | 'linked' | 'created'; droppedPassword: boolean }
  | { ok: false; reason: 'conflict' };

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

export async function resolveOAuthUser(identity: OAuthIdentity): Promise<OAuthResolution> {
  const { field, providerId, name, image } = identity;
  const email = identity.email.trim().toLowerCase();

  const byProvider = await prisma.user.findUnique({ where: { [field]: providerId } as { googleId: string } });
  if (byProvider) return { ok: true, user: byProvider, outcome: 'existing', droppedPassword: false };

  const byEmail = await findUserByEmail(email);
  if (!byEmail) {
    try {
      const user = await prisma.user.create({
        data: { email, [field]: providerId, name: name ?? undefined, image: image ?? undefined, emailVerified: true },
      });
      return { ok: true, user, outcome: 'created', droppedPassword: false };
    } catch (error) {
      if (isUniqueConstraintError(error)) return { ok: false, reason: 'conflict' };
      throw error;
    }
  }

  if (byEmail[field] && byEmail[field] !== providerId) {
    // The email's account is already linked to a different identity at this
    // provider; never silently re-point it.
    return { ok: false, reason: 'conflict' };
  }

  const droppedPassword = !byEmail.emailVerified && byEmail.password !== null;
  try {
    const user = await prisma.user.update({
      where: { id: byEmail.id },
      data: {
        [field]: providerId,
        sessionVersion: { increment: 1 },
        ...(byEmail.emailVerified
          ? {}
          : { emailVerified: true, password: null, failedLoginAttempts: 0, lockedUntil: null }),
      },
    });
    return { ok: true, user, outcome: 'linked', droppedPassword };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, reason: 'conflict' };
    throw error;
  }
}
