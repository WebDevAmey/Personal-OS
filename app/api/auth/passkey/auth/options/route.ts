// app/api/auth/passkey/auth/options/route.ts
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { prisma } from '@/lib/prisma';
import { RP_ID } from '@/lib/auth/webauthn';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export async function POST() {
  // Get all passkey credentials to exclude (prevents re-authenticating
  // with a credential that's already registered for this user).
  const credentials = await prisma.passkeyCredential.findMany({
    select: { id: true, transports: true },
  });

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    // Require users to use a previously-registered authenticator
    allowCredentials: credentials.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransport[],
    })),
    userVerification: 'required',
  });

  // Store the challenge for verification (no userId yet — this is
  // usernameless/discoverable login, so we don't know who the user is
  // until they authenticate with their passkey).
  await prisma.webAuthnChallenge.create({
    data: {
      challenge: options.challenge,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  return Response.json(options);
}
