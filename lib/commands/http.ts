// lib/commands/http.ts — shared wrapper for the /api/command* route handlers
// (docs/04 §9). Order: same-origin + JSON check, session, raw size cap, JSON
// parse, then the handler. Every failure uses the §12 error envelope.
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/auth/session';
import { logger } from '@/lib/observability/logger';
import { csrfGuard } from '@/lib/security/csrf';
import { errorBody, jsonResponse, type CommandResponse } from './types';

/** Raw body cap. 2,000 input characters can be up to ~8 KB of UTF-8 plus JSON escaping. */
export const MAX_BODY_BYTES = 16 * 1024;

export type RouteHandler = (userId: string, body: unknown, meta: { requestId: string }) => Promise<CommandResponse>;

export async function commandRoute(req: Request, handler: RouteHandler): Promise<Response> {
  const blocked = csrfGuard(req);
  if (blocked) return blocked;
  const session = await requireUser(req);
  if (session instanceof Response) return jsonResponse(errorBody('UNAUTHENTICATED'));

  const requestId = req.headers.get('x-request-id')?.slice(0, 64) || randomUUID();
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return jsonResponse(errorBody('INPUT_TOO_LONG'));
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return jsonResponse(errorBody('INVALID_INPUT'));
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return jsonResponse(errorBody('INPUT_TOO_LONG'));
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse(errorBody('INVALID_INPUT'));
  }

  try {
    return jsonResponse(await handler(session.userId, body, { requestId }));
  } catch (err) {
    logger.error('command.route_failed', { requestId, err });
    return jsonResponse(errorBody('INTERNAL'));
  }
}
