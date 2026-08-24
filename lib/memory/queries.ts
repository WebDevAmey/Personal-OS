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

export async function searchMemory(userId: string, query: string, limit = 5): Promise<Memory[]> {
  const queryEmbedding = await embed(query);
  const literal = vectorLiteral(queryEmbedding);
  const result = await db.execute<Memory>(sql`
    SELECT id, user_id AS "userId", content, embedding, created_at AS "createdAt"
    FROM memories
    WHERE user_id = ${userId}
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${limit}
  `);
  return result.rows;
}
