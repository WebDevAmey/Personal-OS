import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { User } from '@/lib/generated/prisma/client';
import { deleteUsers, makeUser } from '@/lib/test/factories';
import { saveMemory, searchMemory } from './queries';

vi.mock('@/lib/ai/embeddings', () => ({
  embed: vi.fn(async (text: string) => {
    // Deterministic fake embedding, chosen so cosine distance genuinely
    // discriminates between the two "topics" below (not just constant-fill
    // vectors, which are all cosine-identical regardless of magnitude and
    // would make ORDER BY a no-op / insertion-order artifact).
    const vector = new Array(512).fill(0);
    if (text.includes('Rahul') || text.includes('API')) {
      for (let i = 0; i < 10; i++) vector[i] = 1;
    } else {
      for (let i = 500; i < 510; i++) vector[i] = 1;
    }
    return vector;
  }),
}));

// Compatibility adapter over lib/memory/repo.ts; same signatures and return
// shape as the Drizzle-era module.
let A: User;
let B: User;

beforeEach(async () => {
  await deleteUsers(A, B);
  A = await makeUser({ label: 'mem_compat_a' });
  B = await makeUser({ label: 'mem_compat_b' });
});

afterAll(async () => deleteUsers(A, B));

describe('memory domain library (compat adapter)', () => {
  it('stores a memory with its embedding', async () => {
    const memory = await saveMemory(A.id, 'Ask Rahul about the API tomorrow');
    expect(memory.userId).toBe(A.id);
    expect(memory.content).toBe('Ask Rahul about the API tomorrow');
  });

  // save_memory is wrapped in idempotent(...) (lib/ai/tools/index.ts), so
  // whatever saveMemory returns is serialized into AgentAction.output and back
  // to the model; the 512-float embedding must never be part of it.
  it('does not include the raw embedding vector in the saved memory it returns', async () => {
    const memory = await saveMemory(A.id, 'Ask Rahul about the API tomorrow');
    expect(memory).not.toHaveProperty('embedding');
    expect(Object.keys(memory).sort()).toEqual(['content', 'createdAt', 'id', 'userId']);
  });

  it('returns the closest memory first for a semantically related query', async () => {
    await saveMemory(A.id, 'Ask Rahul about the API tomorrow');
    await saveMemory(A.id, 'Buy milk on the way home');
    const results = await searchMemory(A.id, 'API', 5);
    expect(results[0].content).toBe('Ask Rahul about the API tomorrow');
  });

  it("only searches the calling user's memories", async () => {
    await saveMemory(B.id, 'Ask Rahul about the API tomorrow');
    const results = await searchMemory(A.id, 'API', 5);
    expect(results).toHaveLength(0);
  });

  it('does not include the raw embedding vector in search results', async () => {
    await saveMemory(A.id, 'Ask Rahul about the API tomorrow');
    const results = await searchMemory(A.id, 'API', 5);
    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty('embedding');
    expect(Object.keys(results[0]).sort()).toEqual(['content', 'createdAt', 'id', 'userId']);
  });
});
