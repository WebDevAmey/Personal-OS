// lib/audit/audit-events.ts — AuditEvent writer for non-auth data mutations
// (docs/03 §4). Call it with the mutating transaction so the audit row
// commits or rolls back with the change. Auth outcomes use AuthEvent instead.
import type { Tx } from '@/lib/db/tx';
import { reader } from '@/lib/db/tx';
import type { ActorType, Prisma } from '@/lib/generated/prisma/client';
import { redact } from '@/lib/observability/logger';

export type AuditAction =
  | 'project.create'
  | 'project.update'
  | 'project.archive'
  | 'project.delete'
  | 'project.restore'
  | 'preference.update'
  | 'memory.create'
  | 'memory.update'
  | 'memory.delete'
  | 'memory.restore'
  | 'memory.purge'
  | 'task.bulk_update'
  | 'task.purge'
  | (string & {});

export interface AuditEntry {
  userId: string | null;
  actorType: ActorType;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  agentRunId?: string | null;
  proposalId?: string | null;
  requestId?: string | null;
  /** Redacted diff summary. Never content bodies, tokens or embeddings. */
  metadata?: Record<string, unknown>;
}

export async function recordAudit(tx: Tx | undefined, entry: AuditEntry): Promise<void> {
  await reader(tx).auditEvent.create({
    data: {
      userId: entry.userId,
      actorType: entry.actorType,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      agentRunId: entry.agentRunId ?? null,
      proposalId: entry.proposalId ?? null,
      requestId: entry.requestId ?? null,
      metadata: entry.metadata ? (redact(entry.metadata) as Prisma.InputJsonValue) : undefined,
    },
  });
}

/** A user's own audit trail, newest first (Settings → Security/Activity). */
export async function listAuditEvents(userId: string, opts: { limit?: number; tx?: Tx } = {}) {
  return reader(opts.tx).auditEvent.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
  });
}
