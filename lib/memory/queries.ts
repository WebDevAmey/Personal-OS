import { db } from '@/db/client';
import { memories, type Memory } from '@/db/schema';
import { embed } from '@/lib/ai/embeddings';
import { sql } from 'drizzle-orm';

function vectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

export async function saveMemory(userId: string, content: string): Promise<Memory> {
  const embedding = await embed(content);
  const [memory] = await db.insert(memories).values({ userId, content, embedding }).returning();
  return memory;
}

export async function searchMemory(userId: string, query: string, limit = 5): Promise<Omit<Memory, 'embedding'>[]> {
  const queryEmbedding = await embed(query);
  const literal = vectorLiteral(queryEmbedding);
  // Intentionally omit `embedding` from the SELECT list: the caller only
  // needs it to drive `ORDER BY <=>` below, never the raw vector back - up
  // to `limit` rows' worth of 512-float vectors would otherwise get
  // serialized into the model's context (lib/ai/tools/index.ts's
  // search_memory tool result) and into agent_actions.output jsonb on every
  // memory search.
  const result = await db.execute<Omit<Memory, 'embedding'>>(sql`
    SELECT id, user_id AS "userId", content, created_at AS "createdAt"
    FROM memories
    WHERE user_id = ${userId}
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);
  return result.rows;
}
