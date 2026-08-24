import { db } from '@/db/client';
import { agentActions } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function withIdempotency<T>(
  ctx: { agentRunId: string; toolName: string; idempotencyKey: string; input: unknown },
  action: () => Promise<T>,
): Promise<T> {
  const existing = await db.select().from(agentActions).where(eq(agentActions.idempotencyKey, ctx.idempotencyKey));
  if (existing.length > 0) {
    return existing[0].output as T;
  }

  try {
    const output = await action();
    await db.insert(agentActions).values({
      agentRunId: ctx.agentRunId,
      toolName: ctx.toolName,
      input: ctx.input,
      output,
      idempotencyKey: ctx.idempotencyKey,
      status: 'success',
    });
    return output;
  } catch (err) {
    await db.insert(agentActions).values({
      agentRunId: ctx.agentRunId,
      toolName: ctx.toolName,
      input: ctx.input,
      output: { error: String(err) },
      idempotencyKey: ctx.idempotencyKey,
      status: 'error',
    });
    throw err;
  }
}
