// lib/memory/queries.ts — compatibility adapter (deprecated).
//
// Keeps the pre-v2 signatures and return shape ({ id, userId, content,
// createdAt }, never the embedding) for lib/ai/tools until it moves to
// lib/memory/repo.ts. Implemented over the repo, so writes are audited and
// soft-deleted memories are excluded from search. New code must import from
// '@/lib/memory/repo' and inject its embedder.
import { embed } from '@/lib/ai/embeddings';
import { saveMemory as repoSave, searchMemories } from './repo';

export interface LegacyMemory {
  id: string;
  userId: string;
  content: string;
  createdAt: Date;
}

export async function saveMemory(userId: string, content: string): Promise<LegacyMemory> {
  const m = await repoSave(userId, content, { embed, source: 'COMMAND' });
  return { id: m.id, userId: m.userId, content: m.content, createdAt: m.createdAt };
}

export async function searchMemory(userId: string, query: string, limit = 5): Promise<LegacyMemory[]> {
  const hits = await searchMemories(userId, query, { embed, limit });
  return hits.map((h) => ({ id: h.id, userId: h.userId, content: h.content, createdAt: h.createdAt }));
}
