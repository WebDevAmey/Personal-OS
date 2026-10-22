// GET  /api/memory?q=&cursor=&deleted=1  — newest first, text filter
// POST /api/memory { content }            — saved now; the embedding is filled in by the background job
import { z } from 'zod';
import { listMemories, saveMemory } from '@/lib/memory/repo';
import { json, parseQuery, route } from '@/app/api/tasks/_lib/http';
import { MemoryContentSchema, toMemoryDTO } from '@/app/api/tasks/_lib/settings';

const Query = z.object({
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(512).optional(),
  deleted: z.enum(['0', '1']).optional(),
});

export async function GET(req: Request) {
  return route(req, {}, async ({ userId }) => {
    const q = parseQuery(req, Query);
    if (!q.ok) return q.response;
    const page = await listMemories(userId, { text: q.data.q || undefined, cursor: q.data.cursor ?? null, deleted: q.data.deleted === '1', limit: 50 });
    return json({ items: page.items.map(toMemoryDTO), nextCursor: page.nextCursor });
  });
}

export async function POST(req: Request) {
  return route(req, { body: MemoryContentSchema }, async ({ userId, body, requestId }) => {
    const memory = await saveMemory(userId, body.content, { source: 'MANUAL', requestId });
    return json({ memory: toMemoryDTO(memory) }, 201);
  });
}
