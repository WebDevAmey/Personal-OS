import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/db/client';
import { memories, users } from '@/db/schema';
import { saveMemory, searchMemory } from './queries';
import { inArray } from 'drizzle-orm';

vi.mock('@/lib/ai/embeddings', () => ({
  embed: vi.fn(async (text: string) => {
    // Deterministic fake embedding, chosen so cosine distance genuinely
    // discriminates between the two "topics" below (not just constant-fill
    // vectors, which are all cosine-identical regardless of magnitude and
    // would make ORDER BY a no-op / insertion-order artifact).
    const vector = new Array(512).fill(0);
    if (text.includes('Rahul') || text.includes('API')) {
      // "Rahul/API" topic: unit vector along the first 10 axes.
      for (let i = 0; i < 10; i++) vector[i] = 1;
    } else {
      // Unrelated topic: unit vector along a disjoint set of axes
      // (orthogonal to the topic above -> cosine distance of 1).
      for (let i = 500; i < 510; i++) vector[i] = 1;
    }
    return vector;
  }),
}));

// Prefixed so these fixture rows can never collide with another test
// file's fixture rows in the same shared `users` table (e.g.
// lib/tasks/queries.test.ts), which matters because Vitest runs test
// files in parallel by default and each file's beforeEach only deletes
// its own scoped rows.
const USER_A = 'memory-test-user-a';
const USER_B = 'memory-test-user-b';

beforeEach(async () => {
  await db.delete(memories).where(inArray(memories.userId, [USER_A, USER_B]));
  await db.delete(users).where(inArray(users.id, [USER_A, USER_B]));
  await db.insert(users).values([
    { id: USER_A, email: 'memory-test-user-a@test.com' },
    { id: USER_B, email: 'memory-test-user-b@test.com' },
  ]);
});

describe('memory domain library', () => {
  it('stores a memory with its embedding', async () => {
    const memory = await saveMemory(USER_A, 'Ask Rahul about the API tomorrow');
    expect(memory.userId).toBe(USER_A);
    expect(memory.content).toBe('Ask Rahul about the API tomorrow');
  });

  it('returns the closest memory first for a semantically related query', async () => {
    await saveMemory(USER_A, 'Ask Rahul about the API tomorrow');
    await saveMemory(USER_A, 'Buy milk on the way home');
    const results = await searchMemory(USER_A, 'API', 5);
    expect(results[0].content).toBe('Ask Rahul about the API tomorrow');
  });

  it('only searches the calling user\'s memories', async () => {
    await saveMemory(USER_B, 'Ask Rahul about the API tomorrow');
    const results = await searchMemory(USER_A, 'API', 5);
    expect(results).toHaveLength(0);
  });
});
