import { db } from '@/db/client';
import { memories, type Memory } from '@/db/schema';
import { embed } from '@/lib/ai/embeddings';
import { sql } from 'drizzle-orm';

function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

export async function saveMemory(userId: string, content: string): Promise<Omit<Memory, 'embedding'>> {
  const embedding = await embed(content);
  // Intentionally scope `.returning()` to everything except `embedding`:
  // this row flows straight into lib/ai/tools/index.ts's save_memory tool
  // result, which IS wrapped in idempotent(...) - the full 512-float vector
  // would otherwise get written into agent_actions.output jsonb (and
  // returned to the model as the tool result) on every single memory save.
  const [memory] = await db.insert(memories).values({ userId, content, embedding })
    .returning({ id: memories.id, userId: memories.userId, content: memories.content, createdAt: memories.createdAt });
  return memory;
}

export async function searchMemory(userId: string, query: string, limit = 5): Promise<Omit<Memory, 'embedding'>[]> {
  const queryEmbedding = await embed(query);
  const literal = vectorLiteral(queryEmbedding);
  // Intentionally omit `embedding` from the SELECT list: the caller only
  // needs it to drive `ORDER BY <=>` below, never the raw vector back. This
  // is defense-in-depth hygiene for search_memory's tool result (which is
  // NOT wrapped in idempotent(...)) - the actual audit-log leak this guards
  // saveMemory against above is the one that matters, since save_memory IS
  // idempotency-wrapped and writes its return value into agent_actions.output.
  const result = await db.execute<Omit<Memory, 'embedding'>>(sql`
    SELECT id, user_id AS "userId", content, created_at AS "createdAt"
    FROM memories
    WHERE user_id = ${userId}
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);
  return result.rows;
}
