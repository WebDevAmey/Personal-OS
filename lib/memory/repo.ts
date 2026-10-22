// lib/memory/repo.ts — ownership-scoped Memory persistence (docs/03 §2, §5.3).
//
// Rules:
// - The embedding vector never leaves this module: every read selects an
//   explicit column list without "embedding" (it would otherwise end up in
//   tool results, AgentAction.output and logs).
// - Every raw SQL statement filters by "userId" (ARCH-001 / docs/03 §6).
// - The embedder is injected so this module has no provider dependency and
//   tests never call the network. If embedding fails the memory is still
//   saved with a NULL embedding ("pending") and can be backfilled later via
//   listMemoriesPendingEmbedding + setMemoryEmbedding.
import { NotFoundError, ValidationError } from '@/lib/db/errors';
import { type Tx, reader, withTransaction } from '@/lib/db/tx';
import { Prisma, type ActorType, type MemorySource } from '@/lib/generated/prisma/client';
import { recordAudit } from '@/lib/audit/audit-events';
import { logger } from '@/lib/observability/logger';

export const EMBEDDING_DIMENSIONS = 512;
export const DEFAULT_EMBEDDING_MODEL = 'voyage-3-lite';
export const MEMORY_MAX_LENGTH = 4000;
export const MEMORY_RETENTION_DAYS = 30;

export type EmbedFn = (text: string) => Promise<number[]>;

export interface MemoryRecord {
  id: string;
  userId: string;
  content: string;
  source: MemorySource;
  embeddingModel: string;
  /** false while the embedding is pending (embedder failed or not run yet). */
  embedded: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemorySearchHit {
  id: string;
  userId: string;
  content: string;
  source: MemorySource;
  createdAt: Date;
  /** Cosine similarity in [-1, 1]; 1 = identical direction. */
  similarity: number;
}

export interface MemoryContext {
  actorType?: ActorType;
  agentRunId?: string;
  proposedActionId?: string;
  requestId?: string;
  tx?: Tx;
  now?: Date;
}

const SELECT = Prisma.sql`"id", "userId", "content", "source", "embeddingModel", ("embedding" IS NOT NULL) AS "embedded", "deletedAt", "createdAt", "updatedAt"`;

function normalizeContent(content: unknown): string {
  if (typeof content !== 'string') throw new ValidationError('CONTENT_REQUIRED', 'Memory content is required', 'content');
  const c = content.trim();
  if (c.length === 0) throw new ValidationError('CONTENT_REQUIRED', 'Memory content is required', 'content');
  if (c.length > MEMORY_MAX_LENGTH) throw new ValidationError('CONTENT_TOO_LONG', `Memory content is longer than ${MEMORY_MAX_LENGTH} characters`, 'content');
  return c;
}

/** Validates an embedder result and renders it as a pgvector literal. */
export function toVectorLiteral(v: unknown): string {
  if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new ValidationError('INVALID_EMBEDDING', `Embedding must be ${EMBEDDING_DIMENSIONS} finite numbers`, 'embedding');
  }
  return `[${v.join(',')}]`;
}

async function tryEmbed(embed: EmbedFn | undefined, text: string): Promise<string | null> {
  if (!embed) return null;
  try {
    return toVectorLiteral(await embed(text));
  } catch (e) {
    logger.warn('memory.embed_failed', { error: e instanceof Error ? e.name : 'unknown' });
    return null;
  }
}

async function loadOwned(tx: Tx, userId: string, id: string, includeDeleted = false): Promise<MemoryRecord> {
  const rows = await tx.$queryRaw<MemoryRecord[]>(Prisma.sql`
    SELECT ${SELECT} FROM "Memory"
    WHERE "id" = ${id} AND "userId" = ${userId} ${includeDeleted ? Prisma.empty : Prisma.sql`AND "deletedAt" IS NULL`}`);
  if (rows.length === 0) throw new NotFoundError('Memory', id);
  return rows[0];
}

function audit(tx: Tx, userId: string, action: string, id: string, ctx: MemoryContext, metadata?: Record<string, unknown>) {
  return recordAudit(tx, {
    userId,
    actorType: ctx.actorType ?? 'USER',
    action,
    entityType: 'Memory',
    entityId: id,
    agentRunId: ctx.agentRunId,
    proposalId: ctx.proposedActionId,
    requestId: ctx.requestId,
    metadata,
  });
}

export async function saveMemory(
  userId: string,
  content: string,
  opts: MemoryContext & { embed?: EmbedFn; source?: MemorySource; embeddingModel?: string } = {},
): Promise<MemoryRecord> {
  const text = normalizeContent(content);
  // Embed before opening the transaction: provider latency must not hold a DB connection.
  const vector = await tryEmbed(opts.embed, text);
  return withTransaction(async (tx) => {
    const created = await tx.memory.create({
      data: { userId, content: text, source: opts.source ?? 'COMMAND', embeddingModel: opts.embeddingModel ?? DEFAULT_EMBEDDING_MODEL },
      select: { id: true },
    });
    if (vector) {
      await tx.$executeRaw`UPDATE "Memory" SET "embedding" = ${vector}::vector WHERE "id" = ${created.id} AND "userId" = ${userId}`;
    }
    await audit(tx, userId, 'memory.create', created.id, opts, { source: opts.source ?? 'COMMAND', embedded: vector !== null, length: text.length });
    return loadOwned(tx, userId, created.id);
  }, { tx: opts.tx });
}

export async function getMemory(userId: string, id: string, opts: { tx?: Tx } = {}): Promise<MemoryRecord> {
  return loadOwned(reader(opts.tx), userId, id);
}

/**
 * Semantic search over the user's live, embedded memories. The query
 * embedding is computed by the injected embedder; failures propagate (the
 * caller decides whether to degrade).
 */
export async function searchMemories(
  userId: string,
  query: string,
  opts: { embed: EmbedFn; limit?: number; minSimilarity?: number; tx?: Tx },
): Promise<MemorySearchHit[]> {
  const q = normalizeContent(query);
  const literal = toVectorLiteral(await opts.embed(q));
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 5), 1), 50);
  const rows = await reader(opts.tx).$queryRaw<MemorySearchHit[]>(Prisma.sql`
    SELECT "id", "userId", "content", "source", "createdAt",
           (1 - ("embedding" <=> ${literal}::vector))::float8 AS "similarity"
    FROM "Memory"
    WHERE "userId" = ${userId} AND "deletedAt" IS NULL AND "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${literal}::vector, "id"
    LIMIT ${limit}`);
  return opts.minSimilarity === undefined ? rows : rows.filter((r) => r.similarity >= opts.minSimilarity!);
}

export interface MemoryPage {
  items: MemoryRecord[];
  nextCursor: string | null;
}

function encodeCursor(m: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ c: m.createdAt.toISOString(), id: m.id })).toString('base64url');
}

function decodeCursor(cursor: string): { c: Date; id: string } {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { c: string; id: string };
    const c = new Date(v.c);
    if (typeof v.id !== 'string' || Number.isNaN(c.getTime())) throw new Error('bad');
    return { c, id: v.id };
  } catch {
    throw new ValidationError('INVALID_CURSOR', 'Invalid cursor', 'cursor');
  }
}

/** Newest first, keyset-paginated on (createdAt, id). */
export async function listMemories(
  userId: string,
  opts: { limit?: number; cursor?: string | null; deleted?: boolean; text?: string; tx?: Tx } = {},
): Promise<MemoryPage> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 200);
  const after = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = await reader(opts.tx).$queryRaw<MemoryRecord[]>(Prisma.sql`
    SELECT ${SELECT} FROM "Memory"
    WHERE "userId" = ${userId}
      AND ${opts.deleted ? Prisma.sql`"deletedAt" IS NOT NULL` : Prisma.sql`"deletedAt" IS NULL`}
      ${opts.text ? Prisma.sql`AND "content" ILIKE ${'%' + opts.text.replace(/[\\%_]/g, (m) => '\\' + m) + '%'}` : Prisma.empty}
      ${after ? Prisma.sql`AND ("createdAt", "id") < (${after.c}, ${after.id})` : Prisma.empty}
    ORDER BY "createdAt" DESC, "id" DESC
    LIMIT ${limit + 1}`);
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null };
}

/** Edits the content and re-embeds it (embedding becomes pending if the embedder fails). */
export async function updateMemory(userId: string, id: string, content: string, opts: MemoryContext & { embed?: EmbedFn } = {}): Promise<MemoryRecord> {
  const text = normalizeContent(content);
  await loadOwned(reader(opts.tx), userId, id);
  const vector = await tryEmbed(opts.embed, text);
  return withTransaction(async (tx) => {
    const n = await tx.$executeRaw`
      UPDATE "Memory" SET "content" = ${text}, "embedding" = ${vector}::vector, "updatedAt" = now()
      WHERE "id" = ${id} AND "userId" = ${userId} AND "deletedAt" IS NULL`;
    if (n === 0) throw new NotFoundError('Memory', id);
    await audit(tx, userId, 'memory.update', id, opts, { embedded: vector !== null, length: text.length });
    return loadOwned(tx, userId, id);
  }, { tx: opts.tx });
}

export async function deleteMemory(userId: string, id: string, ctx: MemoryContext = {}): Promise<MemoryRecord> {
  return withTransaction(async (tx) => {
    const res = await tx.memory.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: ctx.now ?? new Date() } });
    if (res.count === 0) throw new NotFoundError('Memory', id);
    await audit(tx, userId, 'memory.delete', id, ctx);
    return loadOwned(tx, userId, id, true);
  }, { tx: ctx.tx });
}

export async function restoreMemory(userId: string, id: string, ctx: MemoryContext = {}): Promise<MemoryRecord> {
  return withTransaction(async (tx) => {
    const res = await tx.memory.updateMany({ where: { id, userId, deletedAt: { not: null } }, data: { deletedAt: null } });
    if (res.count === 0) throw new NotFoundError('Memory', id);
    await audit(tx, userId, 'memory.restore', id, ctx);
    return loadOwned(tx, userId, id);
  }, { tx: ctx.tx });
}

/** Hard-deletes one of the user's memories immediately ("delete forever"). */
export async function purgeMemory(userId: string, id: string, ctx: MemoryContext = {}): Promise<void> {
  await withTransaction(async (tx) => {
    const res = await tx.memory.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new NotFoundError('Memory', id);
    await audit(tx, userId, 'memory.purge', id, ctx);
  }, { tx: ctx.tx });
}

/** Hard-deletes every memory the user has (settings → "forget everything"). Returns the count. */
export async function purgeAllMemoriesForUser(userId: string, ctx: MemoryContext = {}): Promise<number> {
  return withTransaction(async (tx) => {
    const res = await tx.memory.deleteMany({ where: { userId } });
    await recordAudit(tx, { userId, actorType: ctx.actorType ?? 'USER', action: 'memory.purge', entityType: 'Memory', requestId: ctx.requestId, metadata: { scope: 'all', count: res.count } });
    return res.count;
  }, { tx: ctx.tx });
}

/** Retention job: hard-deletes memories soft-deleted more than 30 days ago (docs/03 §7). */
export async function purgeDeletedMemories(opts: { now?: Date; olderThan?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = opts.olderThan ?? new Date(now.getTime() - MEMORY_RETENTION_DAYS * 86_400_000);
  return withTransaction(async (tx) => {
    const rows = await tx.memory.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true, userId: true }, take: 1000 });
    if (rows.length === 0) return 0;
    await tx.memory.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    for (const r of rows) await recordAudit(tx, { userId: r.userId, actorType: 'SYSTEM', action: 'memory.purge', entityType: 'Memory', entityId: r.id, metadata: { reason: 'retention' } });
    return rows.length;
  });
}

/** Backfill support: live memories still waiting for an embedding (oldest first). */
export async function listMemoriesPendingEmbedding(userId: string, opts: { limit?: number; tx?: Tx } = {}): Promise<MemoryRecord[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 500);
  return reader(opts.tx).$queryRaw<MemoryRecord[]>(Prisma.sql`
    SELECT ${SELECT} FROM "Memory"
    WHERE "userId" = ${userId} AND "deletedAt" IS NULL AND "embedding" IS NULL
    ORDER BY "createdAt", "id" LIMIT ${limit}`);
}

/** Stores an embedding computed out of band. Returns false if the memory is gone or its content changed. */
export async function setMemoryEmbedding(userId: string, id: string, embedding: number[], opts: { expectedContent?: string; tx?: Tx } = {}): Promise<boolean> {
  const literal = toVectorLiteral(embedding);
  const n = await reader(opts.tx).$executeRaw`
    UPDATE "Memory" SET "embedding" = ${literal}::vector
    WHERE "id" = ${id} AND "userId" = ${userId} AND "deletedAt" IS NULL
      ${opts.expectedContent !== undefined ? Prisma.sql`AND "content" = ${opts.expectedContent}` : Prisma.empty}`;
  return n > 0;
}
