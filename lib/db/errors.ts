// lib/db/errors.ts — typed errors raised by ownership-scoped repositories
// (ADR-006). Route handlers and the command executor map them to HTTP / tool
// results: NOT_FOUND → 404, CONFLICT → 409, VALIDATION → 400/422.
//
// A repo never says "this row exists but belongs to someone else": rows of
// another user are indistinguishable from rows that do not exist.

export type RepoErrorCode = 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION';

export abstract class RepoError extends Error {
  abstract readonly code: RepoErrorCode;
}

export class NotFoundError extends RepoError {
  readonly code = 'NOT_FOUND' as const;
  constructor(
    readonly entity: string,
    readonly id?: string,
  ) {
    super(`${entity} not found`);
    this.name = 'NotFoundError';
  }
}

export type ConflictReason =
  | 'VERSION_MISMATCH' // optimistic concurrency: row changed since it was read
  | 'NAME_TAKEN'
  | 'ALREADY_UNDONE'
  | 'CHANGED_SINCE' // undo refused: a later change touched the same task
  | 'SERIES_HAS_OPEN_OCCURRENCE'
  | 'BULK_TARGETS_CHANGED'
  | 'OPERATION_ID_REUSED'
  | 'OPERATION_INCOMPLETE';

export class ConflictError extends RepoError {
  readonly code = 'CONFLICT' as const;
  constructor(
    readonly entity: string,
    readonly reason: ConflictReason,
    readonly details?: { id?: string; currentVersion?: number; expectedVersion?: number },
  ) {
    super(`${entity} conflict: ${reason}`);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends RepoError {
  readonly code = 'VALIDATION' as const;
  constructor(
    readonly reason: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function isRepoError(e: unknown): e is RepoError {
  return e instanceof RepoError;
}
