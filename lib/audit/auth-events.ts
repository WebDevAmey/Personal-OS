// lib/audit/auth-events.ts
// ADR-012 security audit trail: one AuthEvent row per auth outcome.
//
// What is stored: event type, userId when known, the normalised email address
// (ADR-012 / docs/03: stored as-is and scrubbed on account deletion), client
// IP, user agent, and small structured metadata (method, reason). Passwords,
// OTP codes, tokens, cookies and provider responses are never passed here;
// metadata is additionally run through the logger's redaction as a safety net.
//
// The current `AuthEventType` enum (prisma/schema.prisma) only has the
// original ten values. The finer-grained events in docs/03 §AuthEventType
// (LOGIN_RATE_LIMITED, OTP_*, OAUTH_LOGIN_*, PASSKEY_LOGIN_*, SESSIONS_REVOKED)
// are recorded under the closest existing type with `metadata.event` set to
// the fine-grained name, so queries can filter on it today and the mapping
// can switch to native enum values once WS-1 adds them.
import { prisma } from '@/lib/prisma';
import { logger, redact } from '@/lib/observability/logger';
import type { AuthEventType } from '@/lib/generated/prisma/client';
import { Prisma } from '@/lib/generated/prisma/client';
import { clientIp, requestId, userAgent } from '@/lib/security/request-meta';

export type AuthEventName =
  | 'SIGN_UP'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGIN_RATE_LIMITED'
  | 'ACCOUNT_LOCKED'
  | 'LOGOUT'
  | 'SESSIONS_REVOKED'
  | 'OTP_SENT'
  | 'OTP_VERIFIED'
  | 'OTP_FAILED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'PASSWORD_RESET_FAILED'
  | 'OAUTH_LOGIN_SUCCESS'
  | 'OAUTH_LOGIN_FAILURE'
  | 'OAUTH_LINKED'
  | 'PASSKEY_ADDED'
  | 'PASSKEY_REMOVED'
  | 'PASSKEY_LOGIN_SUCCESS'
  | 'PASSKEY_LOGIN_FAILURE'
  | 'CSRF_BLOCKED';

const STORED_TYPE: Record<AuthEventName, AuthEventType> = {
  SIGN_UP: 'SIGN_UP',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGIN_RATE_LIMITED: 'LOGIN_FAILURE',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  LOGOUT: 'LOGOUT',
  SESSIONS_REVOKED: 'LOGOUT',
  OTP_SENT: 'SIGN_UP',
  OTP_VERIFIED: 'SIGN_UP',
  OTP_FAILED: 'LOGIN_FAILURE',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  PASSWORD_RESET_FAILED: 'LOGIN_FAILURE',
  OAUTH_LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  OAUTH_LOGIN_FAILURE: 'LOGIN_FAILURE',
  OAUTH_LINKED: 'OAUTH_LINKED',
  PASSKEY_ADDED: 'PASSKEY_ADDED',
  PASSKEY_REMOVED: 'PASSKEY_REMOVED',
  PASSKEY_LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  PASSKEY_LOGIN_FAILURE: 'LOGIN_FAILURE',
  CSRF_BLOCKED: 'LOGIN_FAILURE',
};

export function storedAuthEventType(name: AuthEventName): AuthEventType {
  return STORED_TYPE[name];
}

export interface AuthEventInput {
  event: AuthEventName;
  req?: Request;
  userId?: string | null;
  email?: string | null;
  /** Short machine-readable fields only (method, reason, scope). */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Writes one AuthEvent. Best effort: a failed audit write is logged at error
 * level but never changes the outcome the user sees.
 */
export async function recordAuthEvent(input: AuthEventInput): Promise<void> {
  const { event, req, userId, email, metadata } = input;
  const meta = redact({
    event,
    ...(metadata ?? {}),
    ...(req && requestId(req) ? { requestId: requestId(req) } : {}),
  }) as Prisma.InputJsonValue;
  try {
    await prisma.authEvent.create({
      data: {
        type: STORED_TYPE[event],
        userId: userId ?? null,
        email: email ? email.trim().toLowerCase().slice(0, 320) : null,
        ip: req ? clientIp(req) : null,
        userAgent: req ? userAgent(req) : null,
        metadata: meta,
      },
    });
  } catch (error) {
    logger.error('auth_event.write_failed', { event, error });
  }
}
