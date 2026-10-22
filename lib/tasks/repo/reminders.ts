// lib/tasks/repo/reminders.ts — reminders (FR-250..253). A reminder may hang
// off a task (events go to the task's history) or stand alone.
import { ConflictError, NotFoundError, ValidationError } from '@/lib/db/errors';
import { type Tx, reader, withTransaction } from '@/lib/db/tx';
import type { Prisma, Reminder, ReminderChannel, ReminderStatus } from '@/lib/generated/prisma/client';
import type { MutationContext } from '../types';
import { normalizeTitle, validateSourceRef } from '../validation';
import { type RunCtx, loadOwnedTask, runMutation, writeEvent } from './internal';

export interface ReminderResult {
  reminder: Reminder;
  eventIds: string[];
  batchId: string;
  replayed: boolean;
}

export interface CreateReminderInput {
  taskId?: string | null;
  /** Defaults to the task title. Required for standalone reminders. */
  title?: string;
  remindAt: Date;
  channel?: ReminderChannel;
  sourceRef?: string | null;
}

async function loadOwnedReminder(tx: Tx, userId: string, id: string): Promise<Reminder> {
  const r = await tx.reminder.findFirst({ where: { id, userId } });
  if (!r) throw new NotFoundError('Reminder', id);
  return r;
}

function validInstant(d: Date, field: string): Date {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new ValidationError('INVALID_DATE', `${field} is not a valid date`, field);
  return d;
}

async function taskEvent(tx: Tx, userId: string, run: RunCtx, reminder: Reminder, type: 'REMINDER_SET' | 'REMINDER_CLEARED', before: object | null, after: object) {
  if (!reminder.taskId) return [];
  const task = await tx.task.findFirst({ where: { id: reminder.taskId, userId }, select: { version: true } });
  return [
    await writeEvent(tx, run, {
      userId,
      taskId: reminder.taskId,
      type,
      taskVersion: task?.version ?? 1,
      before: before as Record<string, unknown> | null,
      after: after as Record<string, unknown>,
    }),
  ];
}

const codec = (userId: string) => ({
  store: (r: ReminderResult) => ({ reminderId: r.reminder.id, eventIds: r.eventIds, batchId: r.batchId }) as Prisma.InputJsonValue,
  replay: async (tx: Tx, s: Record<string, unknown>) => ({
    reminder: await loadOwnedReminder(tx, userId, s.reminderId as string),
    eventIds: s.eventIds as string[],
    batchId: s.batchId as string,
    replayed: true,
  }),
});

export function createReminder(userId: string, input: CreateReminderInput, ctx: MutationContext = {}): Promise<ReminderResult> {
  return runMutation(
    userId,
    ctx,
    'reminder.create',
    async (tx, run) => {
      const remindAt = validInstant(input.remindAt, 'remindAt');
      let title = input.title;
      if (input.taskId) {
        const task = await loadOwnedTask(tx, userId, input.taskId);
        title ??= task.title;
      }
      const reminder = await tx.reminder.create({
        data: {
          userId,
          taskId: input.taskId ?? null,
          title: normalizeTitle(title),
          remindAt,
          channel: input.channel ?? 'IN_APP',
          sourceRef: validateSourceRef(input.sourceRef),
          createdAt: run.now,
        },
      });
      const eventIds = await taskEvent(tx, userId, run, reminder, 'REMINDER_SET', null, {
        reminderId: reminder.id,
        remindAt: remindAt.toISOString(),
        previousRemindAt: null,
      });
      return { reminder, eventIds, batchId: run.batchId, replayed: false };
    },
    codec(userId),
  );
}

/** Moves a pending reminder; bumps its version so a stale dispatch is skipped. */
export function rescheduleReminder(
  userId: string,
  reminderId: string,
  remindAt: Date,
  ctx: MutationContext & { expectedVersion?: number } = {},
): Promise<ReminderResult> {
  return runMutation(
    userId,
    ctx,
    'reminder.reschedule',
    async (tx, run) => {
      validInstant(remindAt, 'remindAt');
      const current = await loadOwnedReminder(tx, userId, reminderId);
      const version = ctx.expectedVersion ?? current.version;
      const res = await tx.reminder.updateMany({
        where: { id: reminderId, userId, version, status: { in: ['PENDING', 'SENT'] } },
        data: { remindAt, status: 'PENDING', attempts: 0, sentAt: null, seenAt: null, lastError: null, version: { increment: 1 } },
      });
      if (res.count === 0) {
        if (current.status === 'CANCELLED' || current.status === 'FAILED') {
          throw new ValidationError('REMINDER_CLOSED', 'This reminder was cancelled', 'reminderId');
        }
        throw new ConflictError('Reminder', 'VERSION_MISMATCH', { id: reminderId, currentVersion: current.version, expectedVersion: version });
      }
      const reminder = await loadOwnedReminder(tx, userId, reminderId);
      const eventIds = await taskEvent(tx, userId, run, reminder, 'REMINDER_SET', { reminderId, remindAt: current.remindAt.toISOString() }, {
        reminderId,
        remindAt: remindAt.toISOString(),
        previousRemindAt: current.remindAt.toISOString(),
      });
      return { reminder, eventIds, batchId: run.batchId, replayed: false };
    },
    codec(userId),
  );
}

export function cancelReminder(userId: string, reminderId: string, ctx: MutationContext = {}): Promise<ReminderResult> {
  return runMutation(
    userId,
    ctx,
    'reminder.cancel',
    async (tx, run) => {
      const current = await loadOwnedReminder(tx, userId, reminderId);
      if (current.status === 'CANCELLED') return { reminder: current, eventIds: [], batchId: run.batchId, replayed: false };
      await tx.reminder.updateMany({ where: { id: reminderId, userId }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      const reminder = await loadOwnedReminder(tx, userId, reminderId);
      const eventIds = await taskEvent(tx, userId, run, reminder, 'REMINDER_CLEARED', { reminderId, status: current.status }, {
        reminderId,
        status: 'CANCELLED',
      });
      return { reminder, eventIds, batchId: run.batchId, replayed: false };
    },
    codec(userId),
  );
}

/** In-app acknowledgement ("dismiss"). */
export async function markReminderSeen(userId: string, reminderId: string, opts: { now?: Date; tx?: Tx } = {}): Promise<Reminder> {
  return withTransaction(async (tx) => {
    await tx.reminder.updateMany({ where: { id: reminderId, userId, seenAt: null }, data: { seenAt: opts.now ?? new Date() } });
    return loadOwnedReminder(tx, userId, reminderId);
  }, { tx: opts.tx });
}

export async function getReminder(userId: string, reminderId: string, opts: { tx?: Tx } = {}): Promise<Reminder> {
  return loadOwnedReminder(reader(opts.tx), userId, reminderId);
}

export async function listReminders(
  userId: string,
  opts: { status?: ReminderStatus[]; taskId?: string; from?: Date; to?: Date; unseenOnly?: boolean; limit?: number; tx?: Tx } = {},
): Promise<Reminder[]> {
  return reader(opts.tx).reminder.findMany({
    where: {
      userId,
      ...(opts.status?.length ? { status: { in: opts.status } } : {}),
      ...(opts.taskId ? { taskId: opts.taskId } : {}),
      ...(opts.from || opts.to ? { remindAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } } : {}),
      ...(opts.unseenOnly ? { seenAt: null } : {}),
    },
    orderBy: [{ remindAt: 'asc' }, { id: 'asc' }],
    take: Math.min(Math.max(opts.limit ?? 100, 1), 500),
  });
}

// ───────────────────────── dispatch (reminder job) ─────────────────────────

/**
 * Claims a reminder for delivery: only a PENDING row still at `version`
 * (i.e. not rescheduled or cancelled since the event was emitted) is
 * returned. The caller delivers, then calls markReminderSent/Failed.
 */
export async function claimReminderForDispatch(userId: string, reminderId: string, version: number, opts: { tx?: Tx } = {}): Promise<Reminder | null> {
  const tx = reader(opts.tx);
  const res = await tx.reminder.updateMany({
    where: { id: reminderId, userId, version, status: 'PENDING' },
    data: { attempts: { increment: 1 } },
  });
  if (res.count === 0) return null;
  return tx.reminder.findFirst({ where: { id: reminderId, userId } });
}

export async function markReminderSent(userId: string, reminderId: string, version: number, opts: { now?: Date; tx?: Tx } = {}): Promise<boolean> {
  const res = await reader(opts.tx).reminder.updateMany({
    where: { id: reminderId, userId, version, status: 'PENDING' },
    data: { status: 'SENT', sentAt: opts.now ?? new Date() },
  });
  return res.count === 1;
}

export async function markReminderFailed(userId: string, reminderId: string, version: number, errorCode: string, opts: { tx?: Tx } = {}): Promise<boolean> {
  const res = await reader(opts.tx).reminder.updateMany({
    where: { id: reminderId, userId, version, status: 'PENDING' },
    data: { status: 'FAILED', lastError: errorCode.slice(0, 64) },
  });
  return res.count === 1;
}

/** Safety sweep: pending reminders already due (system job; returns ids only). */
export async function listDueReminders(now: Date, limit = 500, opts: { tx?: Tx } = {}) {
  return reader(opts.tx).reminder.findMany({
    where: { status: 'PENDING', remindAt: { lte: now } },
    select: { id: true, userId: true, version: true },
    orderBy: { remindAt: 'asc' },
    take: Math.min(limit, 1000),
  });
}
