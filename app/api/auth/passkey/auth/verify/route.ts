// app/api/auth/passkey/auth/verify/route.ts
import { z } from 'zod';
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from '@simplewebauthn/server';
import { prisma } from '@/lib/prisma';
import { RP_ID, ORIGIN } from '@/lib/auth/webauthn';
import { signSessionToken } from '@/lib/auth/jwt';

const Schema = z.object({
  response: z.object({}).passthrough(),
  credentialId: z.string(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 400 });
  const { response, credentialId } = parsed.data;

  // Look up the challenge (no userId filter — discoverable login).
  const challengeRecord = await prisma.webAuthnChallenge.findFirst({
    where: { expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!challengeRecord) {
    return Response.json({ error: 'Challenge expired or not found' }, { status: 400 });
  }

  // Look up the credential in our database.
  const credential = await prisma.passkeyCredential.findUnique({
    where: { id: credentialId },
  });
  if (!credential) {
    return Response.json({ error: 'Credential not found' }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports as AuthenticatorTransport[],
      },
    });
  } catch {
    return Response.json({ error: 'Passkey verification failed' }, { status: 400 });
  }

  if (!verification.verified || !verification.authenticationInfo) {
    return Response.json({ error: 'Passkey verification failed' }, { status: 400 });
  }

  // Update the credential counter to prevent replay attacks.
  const { newCounter } = verification.authenticationInfo;
  await prisma.passkeyCredential.update({
    where: { id: credential.id },
    data: { counter: newCounter, lastUsedAt: new Date() },
  });

  // Fetch the user to get their sessionVersion for the JWT.
  const user = await prisma.user.findUnique({
    where: { id: credential.userId },
    select: { id: true, sessionVersion: true },
  });
  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 400 });
  }

  // Single-use: delete the challenge.
  await prisma.webAuthnChallenge.delete({ where: { id: challengeRecord.id } });

  // Issue a session.
  const sessionToken = await signSessionToken({
    userId: user.id,
    sessionVersion: user.sessionVersion,
  });

  const isProd = process.env.NODE_ENV === 'production';
  const sessionCookie = `session=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${isProd ? '; Secure' : ''}`;

  const headers = new Headers({ Location: '/today' });
  headers.append('Set-Cookie', sessionCookie);

  return new Response(null, { status: 307, headers });
}
