// components/settings/passkey.ts — browser side of the WebAuthn ceremonies
// (AUTH-005/006). The server routes generate options, keep the challenge and
// verify; this file only bridges them to navigator.credentials.
import { browserSupportsWebAuthn, startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';

export type PasskeyResult = { ok: true; redirectTo?: string } | { ok: false; cancelled?: boolean; message: string };

async function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

function fromError(e: unknown): PasskeyResult {
  if (e instanceof WebAuthnError && (e.code === 'ERROR_CEREMONY_ABORTED' || e.name === 'NotAllowedError')) {
    return { ok: false, cancelled: true, message: 'Passkey request was cancelled.' };
  }
  if (e instanceof Error && e.name === 'NotAllowedError') return { ok: false, cancelled: true, message: 'Passkey request was cancelled.' };
  if (e instanceof WebAuthnError && e.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return { ok: false, message: 'This device already has a passkey for your account.' };
  }
  return { ok: false, message: "Couldn't use a passkey on this device." };
}

export function passkeysSupported(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

export async function registerPasskey(name?: string): Promise<PasskeyResult> {
  try {
    const optRes = await postJson('/api/auth/passkey/register/options');
    if (!optRes.ok) return { ok: false, message: optRes.status === 401 ? 'Your session expired. Sign in again.' : "Couldn't start passkey setup." };
    const attestation = await startRegistration({ optionsJSON: await optRes.json() });
    const res = await postJson('/api/auth/passkey/register/verify', { response: attestation, ...(name ? { name } : {}) });
    if (!res.ok) return { ok: false, message: "That passkey couldn't be verified. Try again." };
    return { ok: true };
  } catch (e) {
    return fromError(e);
  }
}

export async function signInWithPasskey(): Promise<PasskeyResult> {
  try {
    const optRes = await postJson('/api/auth/passkey/auth/options');
    if (optRes.status === 429) return { ok: false, message: 'Too many attempts. Wait a minute and try again.' };
    if (!optRes.ok) return { ok: false, message: "Couldn't start passkey sign-in." };
    const assertion = await startAuthentication({ optionsJSON: await optRes.json() });
    const res = await postJson('/api/auth/passkey/auth/verify', { response: assertion });
    const body = (await res.json().catch(() => ({}))) as { redirectTo?: string; error?: string };
    if (res.status === 429) return { ok: false, message: 'Too many attempts. Wait a minute and try again.' };
    if (!res.ok) return { ok: false, message: 'That passkey wasn’t recognised. Try another sign-in method.' };
    return { ok: true, redirectTo: body.redirectTo };
  } catch (e) {
    return fromError(e);
  }
}
