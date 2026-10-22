import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import type { User } from '@/lib/generated/prisma/client';
import { NotFoundError, ValidationError } from '@/lib/db/errors';
import { deleteUsers, makeUser, testPrisma as prisma } from '@/lib/test/factories';
import {
  type EmbedFn,
  deleteMemory,
  getMemory,
  listMemories,
  listMemoriesPendingEmbedding,
  purgeAllMemoriesForUser,
  purgeDeletedMemories,
  purgeMemory,
  restoreMemory,
  saveMemory,
  searchMemories,
  setMemoryEmbedding,
  updateMemory,
} from './repo';

// Topic-based fake embedder: one axis block per keyword, so cosine distance
// is meaningful. No network.
const TOPICS = ['rahul', 'milk', 'gym', 'thesis'];
function vec(text: string): number[] {
  const v = new Array(512).fill(0);
  const t = text.toLowerCase();
  TOPICS.forEach((k, i) => {
    if (t.includes(k)) for (let j = 0; j < 8; j++) v[i * 8 + j] = 1;
  });
  if (v.every((x) => x === 0)) v[511] = 1;
  return v;
}
const embed: EmbedFn = vi.fn(async (t: string) => vec(t));
const failing: EmbedFn = async () => {
  throw new Error('voyage down');
};

let A: User;
let B: User;

beforeEach(async () => {
  await deleteUsers(A, B);
  A = await makeUser({ label: 'mem_a' });
  B = await makeUser({ label: 'mem_b' });
});

afterAll(async () => deleteUsers(A, B));

const hasEmbedding = async (id: string) =>
  (await prisma.$queryRaw<{ e: boolean }[]>`SELECT ("embedding" IS NOT NULL) AS e FROM "Memory" WHERE id = ${id}`)[0].e;

describe('memory repo', () => {
  it('saves with an embedding, never returns the vector, and audits without content', async () => {
    const m = await saveMemory(A.id, '  Rahul prefers email  ', { embed, source: 'MANUAL' });
    expect(m).toMatchObject({ userId: A.id, content: 'Rahul prefers email', source: 'MANUAL', embedded: true });
    expect(m).not.toHaveProperty('embedding');
    expect(await hasEmbedding(m.id)).toBe(true);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { userId: A.id, action: 'memory.create', entityId: m.id } });
    expect(JSON.stringify(audit.metadata)).not.toContain('Rahul');
  });

  it('saves as pending when the embedder fails, and the backfill fills it', async () => {
    const m = await saveMemory(A.id, 'gym on Tuesdays', { embed: failing });
    expect(m.embedded).toBe(false);
    const pending = await listMemoriesPendingEmbedding(A.id);
    expect(pending.map((p) => p.id)).toEqual([m.id]);
    expect(await listMemoriesPendingEmbedding(B.id)).toHaveLength(0);
    expect(await setMemoryEmbedding(A.id, m.id, vec(m.content), { expectedContent: 'changed' })).toBe(false);
    expect(await setMemoryEmbedding(B.id, m.id, vec(m.content))).toBe(false);
    expect(await setMemoryEmbedding(A.id, m.id, vec(m.content), { expectedContent: m.content })).toBe(true);
    expect((await getMemory(A.id, m.id)).embedded).toBe(true);
  });

  it('validates content length and embedding shape', async () => {
    await expect(saveMemory(A.id, '   ', { embed })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveMemory(A.id, 'x'.repeat(4001), { embed })).rejects.toBeInstanceOf(ValidationError);
    // A malformed vector from the provider is treated as an embed failure (pending), not stored.
    const m = await saveMemory(A.id, 'thesis draft', { embed: async () => [1, 2, 3] });
    expect(m.embedded).toBe(false);
    await expect(searchMemories(A.id, 'thesis', { embed: async () => [Number.NaN] })).rejects.toBeInstanceOf(ValidationError);
  });

  it('searches by cosine similarity within the user, excluding deleted and pending rows', async () => {
    const r = await saveMemory(A.id, 'Ask Rahul about the API', { embed });
    const milk = await saveMemory(A.id, 'Buy milk', { embed });
    await saveMemory(A.id, 'Rahul pending', { embed: failing });
    const gone = await saveMemory(A.id, 'Rahul old note', { embed });
    await deleteMemory(A.id, gone.id);
    await saveMemory(B.id, 'Rahul is B’s friend', { embed });

    const hits = await searchMemories(A.id, 'rahul', { embed, limit: 10 });
    expect(hits.map((h) => h.id)).toEqual([r.id, milk.id]);
    expect(hits[0].similarity).toBeCloseTo(1, 5);
    expect(hits[1].similarity).toBeCloseTo(0, 5);
    expect(hits[0]).not.toHaveProperty('embedding');
    expect(Object.keys(hits[0]).sort()).toEqual(['content', 'createdAt', 'id', 'similarity', 'source', 'userId']);
    expect((await searchMemories(A.id, 'rahul', { embed, minSimilarity: 0.5 })).map((h) => h.id)).toEqual([r.id]);
    expect((await searchMemories(B.id, 'rahul', { embed })).every((h) => h.userId === B.id)).toBe(true);
  });

  it('lists newest first with keyset pagination, text filter and trash view', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const m = await saveMemory(A.id, `note ${i} 100%_done`, { embed });
      await prisma.memory.update({ where: { id: m.id }, data: { createdAt: new Date(Date.UTC(2026, 0, 1 + i)) } });
      ids.push(m.id);
    }
    const p1 = await listMemories(A.id, { limit: 2 });
    expect(p1.items.map((m) => m.id)).toEqual([ids[4], ids[3]]);
    const p2 = await listMemories(A.id, { limit: 2, cursor: p1.nextCursor });
    expect(p2.items.map((m) => m.id)).toEqual([ids[2], ids[1]]);
    const p3 = await listMemories(A.id, { limit: 2, cursor: p2.nextCursor });
    expect(p3.items.map((m) => m.id)).toEqual([ids[0]]);
    expect(p3.nextCursor).toBeNull();
    expect((await listMemories(A.id, { text: 'note 3' })).items.map((m) => m.id)).toEqual([ids[3]]);
    expect((await listMemories(A.id, { text: '%' })).items).toHaveLength(5); // literal %, not a wildcard
    expect((await listMemories(A.id, { text: 'x%' })).items).toHaveLength(0);
    await deleteMemory(A.id, ids[0]);
    expect((await listMemories(A.id, { deleted: true })).items.map((m) => m.id)).toEqual([ids[0]]);
    expect((await listMemories(B.id)).items).toHaveLength(0);
    await expect(listMemories(A.id, { cursor: 'garbage' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('updates content and re-embeds', async () => {
    const m = await saveMemory(A.id, 'Buy milk', { embed });
    const u = await updateMemory(A.id, m.id, 'Ask Rahul instead', { embed });
    expect(u).toMatchObject({ content: 'Ask Rahul instead', embedded: true });
    expect((await searchMemories(A.id, 'rahul', { embed }))[0].id).toBe(m.id);
    const pending = await updateMemory(A.id, m.id, 'gym', { embed: failing });
    expect(pending.embedded).toBe(false);
  });

  it('soft-deletes, restores, purges one and purges all', async () => {
    const m = await saveMemory(A.id, 'thesis', { embed });
    await deleteMemory(A.id, m.id);
    await expect(getMemory(A.id, m.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteMemory(A.id, m.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await restoreMemory(A.id, m.id)).deletedAt).toBeNull();
    await purgeMemory(A.id, m.id);
    expect(await prisma.memory.findUnique({ where: { id: m.id } })).toBeNull();

    await saveMemory(A.id, 'one', { embed });
    await saveMemory(A.id, 'two', { embed });
    const keepB = await saveMemory(B.id, 'B keeps this', { embed });
    expect(await purgeAllMemoriesForUser(A.id)).toBe(2);
    expect(await prisma.memory.count({ where: { userId: A.id } })).toBe(0);
    expect(await prisma.memory.findUnique({ where: { id: keepB.id } })).not.toBeNull();
  });

  it('retention purge removes only memories deleted more than 30 days ago', async () => {
    const old = await saveMemory(A.id, 'old', { embed });
    const recent = await saveMemory(A.id, 'recent', { embed });
    await deleteMemory(A.id, old.id, { now: new Date(Date.now() - 31 * 86_400_000) });
    await deleteMemory(A.id, recent.id);
    expect(await purgeDeletedMemories()).toBeGreaterThanOrEqual(1);
    expect(await prisma.memory.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.memory.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });

  describe('cross-user isolation: B cannot read or mutate A’s memory', () => {
    const cases: [string, (id: string) => Promise<unknown>][] = [
      ['getMemory', (id) => getMemory(B.id, id)],
      ['updateMemory', (id) => updateMemory(B.id, id, 'hijack', { embed })],
      ['deleteMemory', (id) => deleteMemory(B.id, id)],
      ['restoreMemory', (id) => restoreMemory(B.id, id)],
      ['purgeMemory', (id) => purgeMemory(B.id, id)],
    ];
    it.each(cases)('%s → NotFound, row unchanged', async (_n, call) => {
      const m = await saveMemory(A.id, 'Rahul secret', { embed });
      await expect(call(m.id)).rejects.toBeInstanceOf(NotFoundError);
      const row = await prisma.memory.findUniqueOrThrow({ where: { id: m.id } });
      expect(row).toMatchObject({ content: 'Rahul secret', deletedAt: null });
      expect(await searchMemories(B.id, 'rahul', { embed })).toHaveLength(0);
    });

    it('purgeAllMemoriesForUser(B) leaves A’s memories', async () => {
      const m = await saveMemory(A.id, 'mine', { embed });
      await purgeAllMemoriesForUser(B.id);
      expect(await prisma.memory.findUnique({ where: { id: m.id } })).not.toBeNull();
    });
  });

  it('vector search uses the HNSW index when the planner is forced off seq scans', async () => {
    await saveMemory(A.id, 'Rahul', { embed });
    const literal = `[${vec('rahul').join(',')}]`;
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT id FROM "Memory" WHERE "deletedAt" IS NULL AND "embedding" IS NOT NULL ORDER BY "embedding" <=> '${literal}'::vector LIMIT 5`,
      );
    });
    expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toContain('Memory_embedding_hnsw_idx');
  });
});
