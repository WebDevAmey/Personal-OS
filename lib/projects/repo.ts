// lib/projects/repo.ts — ownership-scoped project persistence (ADR-006).
// Names are unique per user among non-deleted projects (case-insensitive,
// partial unique index Project_userId_name_active_key).
import { ConflictError, NotFoundError, ValidationError } from '@/lib/db/errors';
import { type Tx, isUniqueViolation, reader, withTransaction } from '@/lib/db/tx';
import type { ActorType, Project } from '@/lib/generated/prisma/client';
import { recordAudit } from '@/lib/audit/audit-events';

export type { Project };

export interface ProjectContext {
  actorType?: ActorType;
  agentRunId?: string;
  proposedActionId?: string;
  requestId?: string;
  tx?: Tx;
  now?: Date;
}

export interface ProjectInput {
  name: string;
  description?: string | null;
  color?: string | null;
  sortOrder?: number;
}

export interface ProjectWithCounts extends Project {
  openTaskCount: number;
}

function normalizeName(name: unknown): string {
  if (typeof name !== 'string' || name.trim().length === 0) throw new ValidationError('NAME_REQUIRED', 'Project name is required', 'name');
  const n = name.replace(/\s+/g, ' ').trim();
  if (n.length > 100) throw new ValidationError('NAME_TOO_LONG', 'Project name is longer than 100 characters', 'name');
  return n;
}

function validColor(color: string | null | undefined): string | null | undefined {
  if (color === undefined || color === null) return color;
  // Design-system token name, not a hex value (docs/03 Project.color).
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(color)) throw new ValidationError('INVALID_COLOR', 'Color must be a design token name', 'color');
  return color;
}

async function loadOwned(tx: Tx, userId: string, id: string, includeDeleted = false): Promise<Project> {
  const p = await tx.project.findFirst({ where: { id, userId, ...(includeDeleted ? {} : { deletedAt: null }) } });
  if (!p) throw new NotFoundError('Project', id);
  return p;
}

async function nameGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isUniqueViolation(e) || (e instanceof Error && /Project_userId_name_active_key/.test(e.message))) {
      throw new ConflictError('Project', 'NAME_TAKEN');
    }
    throw e;
  }
}

const actor = (ctx: ProjectContext): ActorType => ctx.actorType ?? 'USER';

export async function createProject(userId: string, input: ProjectInput, ctx: ProjectContext = {}): Promise<Project> {
  const name = normalizeName(input.name);
  return nameGuard(() =>
    withTransaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          userId,
          name,
          description: input.description ?? null,
          color: validColor(input.color) ?? null,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      await recordAudit(tx, { userId, actorType: actor(ctx), action: 'project.create', entityType: 'Project', entityId: project.id, agentRunId: ctx.agentRunId, proposalId: ctx.proposedActionId, requestId: ctx.requestId });
      return project;
    }, { tx: ctx.tx }),
  );
}

export async function getProject(userId: string, projectId: string, opts: { tx?: Tx } = {}): Promise<Project> {
  return loadOwned(reader(opts.tx), userId, projectId);
}

/** Case-insensitive lookup by name (resolve_project, quick-capture `#project`). */
export async function findProjectByName(userId: string, name: string, opts: { tx?: Tx } = {}): Promise<Project | null> {
  return reader(opts.tx).project.findFirst({ where: { userId, deletedAt: null, name: { equals: name.trim(), mode: 'insensitive' } } });
}

export async function listProjects(userId: string, opts: { includeArchived?: boolean; tx?: Tx } = {}): Promise<ProjectWithCounts[]> {
  const tx = reader(opts.tx);
  const projects = await tx.project.findMany({
    where: { userId, deletedAt: null, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });
  if (projects.length === 0) return [];
  const counts = await tx.task.groupBy({
    by: ['projectId'],
    where: { userId, deletedAt: null, archivedAt: null, status: { in: ['INBOX', 'TODO', 'IN_PROGRESS'] }, projectId: { in: projects.map((p) => p.id) } },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((c) => [c.projectId, c._count._all]));
  return projects.map((p) => ({ ...p, openTaskCount: byId.get(p.id) ?? 0 }));
}

async function casProject(tx: Tx, userId: string, id: string, expectedVersion: number, data: Record<string, unknown>, includeDeleted = false): Promise<Project> {
  const res = await tx.project.updateMany({
    where: { id, userId, version: expectedVersion, ...(includeDeleted ? {} : { deletedAt: null }) },
    data: { ...data, version: { increment: 1 } },
  });
  if (res.count === 0) {
    const current = await tx.project.findFirst({ where: { id, userId, ...(includeDeleted ? {} : { deletedAt: null }) }, select: { version: true } });
    if (!current) throw new NotFoundError('Project', id);
    throw new ConflictError('Project', 'VERSION_MISMATCH', { id, currentVersion: current.version, expectedVersion });
  }
  return tx.project.findFirstOrThrow({ where: { id, userId } });
}

export async function updateProject(
  userId: string,
  projectId: string,
  expectedVersion: number,
  patch: Partial<ProjectInput>,
  ctx: ProjectContext = {},
): Promise<Project> {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = normalizeName(patch.name);
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.color !== undefined) data.color = validColor(patch.color);
  if (patch.sortOrder !== undefined) data.sortOrder = patch.sortOrder;
  return nameGuard(() =>
    withTransaction(async (tx) => {
      const before = await loadOwned(tx, userId, projectId);
      const project = await casProject(tx, userId, projectId, expectedVersion, data);
      await recordAudit(tx, {
        userId,
        actorType: actor(ctx),
        action: 'project.update',
        entityType: 'Project',
        entityId: projectId,
        agentRunId: ctx.agentRunId,
        proposalId: ctx.proposedActionId,
        requestId: ctx.requestId,
        metadata: { fields: Object.keys(data), before: Object.fromEntries(Object.keys(data).map((k) => [k, (before as Record<string, unknown>)[k]])) },
      });
      return project;
    }, { tx: ctx.tx }),
  );
}

export async function setProjectArchived(userId: string, projectId: string, expectedVersion: number, archived: boolean, ctx: ProjectContext = {}): Promise<Project> {
  return withTransaction(async (tx) => {
    const project = await casProject(tx, userId, projectId, expectedVersion, { archivedAt: archived ? (ctx.now ?? new Date()) : null });
    await recordAudit(tx, { userId, actorType: actor(ctx), action: 'project.archive', entityType: 'Project', entityId: projectId, metadata: { archived }, requestId: ctx.requestId });
    return project;
  }, { tx: ctx.tx });
}

/**
 * Soft delete: the project disappears from lists and its name becomes
 * reusable. Its tasks keep projectId (so restore brings them back) until the
 * 30-day purge detaches them (FK ON DELETE SET NULL).
 */
export async function deleteProject(userId: string, projectId: string, expectedVersion: number, ctx: ProjectContext = {}): Promise<Project> {
  return withTransaction(async (tx) => {
    const project = await casProject(tx, userId, projectId, expectedVersion, { deletedAt: ctx.now ?? new Date() });
    await recordAudit(tx, { userId, actorType: actor(ctx), action: 'project.delete', entityType: 'Project', entityId: projectId, agentRunId: ctx.agentRunId, proposalId: ctx.proposedActionId, requestId: ctx.requestId });
    return project;
  }, { tx: ctx.tx });
}

export async function restoreProject(userId: string, projectId: string, expectedVersion: number, ctx: ProjectContext = {}): Promise<Project> {
  return nameGuard(() =>
    withTransaction(async (tx) => {
      await loadOwned(tx, userId, projectId, true);
      const project = await casProject(tx, userId, projectId, expectedVersion, { deletedAt: null }, true);
      await recordAudit(tx, { userId, actorType: actor(ctx), action: 'project.restore', entityType: 'Project', entityId: projectId, requestId: ctx.requestId });
      return project;
    }, { tx: ctx.tx }),
  );
}

/** Retention job: hard-deletes projects soft-deleted before `olderThan` (tasks are detached by the FK). */
export async function purgeDeletedProjects(opts: { olderThan?: Date; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = opts.olderThan ?? new Date(now.getTime() - 30 * 86_400_000);
  return withTransaction(async (tx) => {
    const rows = await tx.project.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true, userId: true }, take: 1000 });
    if (rows.length === 0) return 0;
    await tx.project.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    for (const r of rows) await recordAudit(tx, { userId: r.userId, actorType: 'SYSTEM', action: 'project.purge', entityType: 'Project', entityId: r.id });
    return rows.length;
  });
}
