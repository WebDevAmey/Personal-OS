import { db } from '@/db/client';
import { agentActions } from '@/db/schema';
import { eq } from 'drizzle-orm';

/** Postgres SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION_CODE = '23505';

/**
 * True when `err` looks like a Postgres unique-constraint violation (as
 * thrown by the Neon driver, which surfaces the SQLSTATE on `err.code`).
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === UNIQUE_VIOLATION_CODE;
}

/**
 * Re-fetches the row for `idempotencyKey` and returns its output, but only
 * if it recorded a success. Used when our own insert lost a race against a
 * concurrent call for the same key - we defer to whichever call actually
 * won, rather than fabricating a result.
 */
async function loadWinningSuccessOutput<T>(idempotencyKey: string): Promise<{ found: true; output: T } | { found: false }> {
  const rows = await db.select().from(agentActions).where(eq(agentActions.idempotencyKey, idempotencyKey));
  const winner = rows[0];
  if (winner && winner.status === 'success') {
    return { found: true, output: winner.output as T };
  }
  return { found: false };
}

export async function withIdempotency<T>(
  ctx: { agentRunId: string; toolName: string; idempotencyKey: string; input: unknown },
  action: () => Promise<T>,
): Promise<T> {
  const existing = await db.select().from(agentActions).where(eq(agentActions.idempotencyKey, ctx.idempotencyKey));
  if (existing.length > 0) {
    // Only a recorded success is safe to treat as "already done" - a prior
    // error must not be replayed back to the caller as if it succeeded.
    if (existing[0].status === 'success') {
      return existing[0].output as T;
    }
    // Stale failed attempt: clear it so this retry can genuinely re-run the
    // action and record its own result under the same idempotency key
    // (the column is unique, so the old row must go before we insert).
    await db.delete(agentActions).where(eq(agentActions.idempotencyKey, ctx.idempotencyKey));
  }

  let output: T;
  try {
    output = await action();
  } catch (err) {
    try {
      await db.insert(agentActions).values({
        agentRunId: ctx.agentRunId,
        toolName: ctx.toolName,
        input: ctx.input,
        output: { error: String(err) },
        idempotencyKey: ctx.idempotencyKey,
        status: 'error',
      });
    } catch (insertErr) {
      // A concurrent call for the same key already recorded a result while
      // this action() was failing. If that call succeeded, defer to it
      // instead of masking it with an unrelated conflict error; otherwise
      // fall through and surface this call's real error below.
      if (isUniqueViolation(insertErr)) {
        const winner = await loadWinningSuccessOutput<T>(ctx.idempotencyKey);
        if (winner.found) return winner.output;
      } else {
        throw insertErr;
      }
    }
    throw err;
  }

  try {
    await db.insert(agentActions).values({
      agentRunId: ctx.agentRunId,
      toolName: ctx.toolName,
      input: ctx.input,
      output,
      idempotencyKey: ctx.idempotencyKey,
      status: 'success',
    });
  } catch (insertErr) {
    if (isUniqueViolation(insertErr)) {
      // Another concurrent call for the same key already recorded its
      // result while this call's action() was in flight (a genuine
      // duplicate retry racing itself, not normal operation). Defer to the
      // winning row instead of throwing a confusing second conflict.
      const winner = await loadWinningSuccessOutput<T>(ctx.idempotencyKey);
      if (winner.found) return winner.output;

      // The existing row isn't a success - e.g. a concurrent call's
      // action() failed and its 'error' row won the insert race just
      // before ours arrived, even though *our* action() succeeded. That
      // row is stale and must not be left in place: the next retry with
      // this key would delete it and re-run the action a second time,
      // discarding the valid output we already computed here. Clear the
      // stale row and persist our own success under the freed key,
      // mirroring the delete-then-insert handling above for a stale
      // pre-existing row.
      await db.delete(agentActions).where(eq(agentActions.idempotencyKey, ctx.idempotencyKey));
      try {
        await db.insert(agentActions).values({
          agentRunId: ctx.agentRunId,
          toolName: ctx.toolName,
          input: ctx.input,
          output,
          idempotencyKey: ctx.idempotencyKey,
          status: 'success',
        });
      } catch {
        // Extremely unlikely: a third concurrent writer raced us for the
        // freed key in this narrow window. Don't crash the caller over a
        // bookkeeping conflict - `output` is still a genuine, correct
        // result from our own action() call, so return it even though we
        // couldn't persist it here. Losing the audit row is better than
        // losing (or re-running) a real, already-completed mutation.
      }
      return output;
    }
    throw insertErr;
  }

  return output;
}
