// app/api/tasks/_lib/http.ts — shared plumbing for the thin UI routes
// (tasks, projects, preferences, memory, integrations).
//
// Every handler goes through `route()`:
//   1. requireUser()           → 401 without a valid session
//   2. csrfGuard()             → 403 cross-site / 415 non-JSON (state-changing methods only)
//   3. bounded body read       → 413 over the byte cap, 400 malformed JSON
//   4. Zod validation          → 400 with field issues
//   5. handler (repo calls)    → repo errors mapped: NotFound 404, Conflict 409, Validation 400
// Unexpected errors are logged (redacted) and returned as a generic 500.
// Folders prefixed with `_` are private in the App Router: this is not a route.
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { csrfGuard } from '@/lib/security/csrf';
import { requestId } from '@/lib/security/request-meta';
import { ConflictError, NotFoundError, ValidationError, isRepoError } from '@/lib/db/errors';
import { logger } from '@/lib/observability/logger';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
export const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function apiError(status: number, code: string, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, code, ...extra }, status);
}

class BodyError extends Error {
  constructor(readonly response: Response) {
    super('body');
  }
}

/** Reads at most `maxBytes` of the body; larger bodies are refused without buffering them. */
export async function readBoundedJson(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BodyError(apiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'));
  }
  if (!req.body) return undefined;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyError(apiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large'));
    }
    chunks.push(value);
  }
  if (size === 0) return undefined;
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError(apiError(400, 'INVALID_JSON', 'Request body is not valid JSON'));
  }
}

export function validationResponse(error: z.ZodError): Response {
  return apiError(400, 'INVALID_INPUT', 'Some fields are invalid', {
    issues: error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

/** Maps repository errors to HTTP. Another user's ids are reported exactly like missing ones. */
export function repoErrorResponse(e: unknown): Response | null {
  if (!isRepoError(e)) return null;
  if (e instanceof NotFoundError) return apiError(404, 'NOT_FOUND', `${e.entity} not found`);
  if (e instanceof ConflictError) {
    const messages: Record<string, string> = {
      VERSION_MISMATCH: 'This was changed elsewhere — reloaded the latest version.',
      CHANGED_SINCE: "Can't undo — this task changed since.",
      ALREADY_UNDONE: 'That change was already undone.',
      NAME_TAKEN: 'A project with that name already exists.',
      BULK_TARGETS_CHANGED: 'Some of these tasks changed since you selected them — review and try again.',
    };
    return apiError(409, 'CONFLICT', messages[e.reason] ?? 'This conflicts with a newer change.', {
      reason: e.reason,
      currentVersion: e.details?.currentVersion,
    });
  }
  if (e instanceof ValidationError) {
    if (e.message.includes('would create a cycle') || e.reason === 'DEPENDENCY_CYCLE') {
      return apiError(400, 'VALIDATION', 'That would create a loop', { reason: e.reason, field: e.field });
    }
    return apiError(400, 'VALIDATION', e.message, { reason: e.reason, field: e.field });
  }
  return null;
}

export interface RouteContext<B> {
  userId: string;
  body: B;
  requestId: string | undefined;
  req: Request;
}

interface RouteOptions<S extends z.ZodType> {
  body?: S;
  maxBytes?: number;
  /** Bodiless state-changing request (e.g. DELETE): Origin check only, no JSON content type. */
  bodiless?: boolean;
}

export async function route<S extends z.ZodType = z.ZodUndefined>(
  req: Request,
  opts: RouteOptions<S>,
  handler: (ctx: RouteContext<z.infer<S>>) => Promise<Response>,
): Promise<Response> {
  const mutating = !SAFE.has(req.method.toUpperCase());
  if (mutating) {
    const blocked = csrfGuard(req, { requireJson: !opts.bodiless });
    if (blocked) return blocked;
  }
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  let body: unknown = undefined;
  if (opts.body) {
    try {
      body = await readBoundedJson(req, opts.maxBytes ?? DEFAULT_MAX_BODY_BYTES);
    } catch (e) {
      if (e instanceof BodyError) return e.response;
      throw e;
    }
    const parsed = opts.body.safeParse(body);
    if (!parsed.success) return validationResponse(parsed.error);
    body = parsed.data;
  }

  try {
    return await handler({ userId: auth.userId, body: body as z.infer<S>, requestId: requestId(req) ?? undefined, req });
  } catch (e) {
    const mapped = repoErrorResponse(e);
    if (mapped) return mapped;
    logger.error('api.unhandled', { path: new URL(req.url).pathname, method: req.method, errorName: (e as Error)?.name });
    return apiError(500, 'INTERNAL', 'Something went wrong on our side.');
  }
}

/** Parses URL search params with a Zod object schema (GET routes). */
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): { ok: true; data: z.infer<S> } | { ok: false; response: Response } {
  const url = new URL(req.url);
  const raw: Record<string, string> = {};
  for (const [k, v] of url.searchParams) raw[k] = v;
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, response: validationResponse(parsed.error) };
}

/** Route params: ids are opaque strings, bounded so they can't be abused. */
export const IdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export function parseId(raw: string): string | null {
  const r = IdSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export const notFound = () => apiError(404, 'NOT_FOUND', 'Not found');
