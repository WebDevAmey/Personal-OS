// SEC-R-002 proof of concept (independent review, 2026-10-22).
//
// lib/auth/safe-callback.ts checks the RAW string for a leading `//`, then
// returns the WHATWG-normalised pathname. Dot segments are removed during
// normalisation, so `/.//evil.example` passes every check and comes back as
// `//evil.example`, a protocol-relative URL. app/sign-in/page.tsx passes the
// result to router.push(), which treats a non-local URL as an external
// navigation: /sign-in?callbackUrl=/.//evil.example sends the user to
// https://evil.example right after a successful sign-in (SEC-B-011 bypass).
//
// These tests describe the required behaviour and FAIL against the current code.
import { describe, expect, it } from 'vitest';
import { safeCallback } from '@/lib/auth/safe-callback';

const ORIGIN = 'https://app.example';

describe('SEC-R-002: safeCallback must never return an off-site target', () => {
  for (const raw of ['/.//evil.example', '/a/..//evil.example', '/%2e//evil.example', '/./%2e//evil.example/path?x=1']) {
    it(`rejects ${raw}`, () => {
      const out = safeCallback(raw);
      expect(out.startsWith('//')).toBe(false);
      // Whatever is returned must resolve to the app's own origin.
      expect(new URL(out, ORIGIN).origin).toBe(ORIGIN);
    });
  }
});
