// Command pipeline against the real test database; the model, Google, web
// and embeddings are fakes (lib/commands/test-support). The model runs through
// the real generateText loop, so tool schemas, handles, policy and execution
// are all exercised for real.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@/lib/generated/prisma/client';
import { deleteUsers, makeTask, makeUser, testPrisma as prisma } from '@/lib/test/factories';
import { floatingDate } from '@/lib/time';
import { handleCommand, handleConfirm } from './service';
import { fakeDeps, fakeGoogle, handleIn, scriptedModel, type Step } from './test-support';
import type { CommandResponse } from './types';

// docs/00 §5.4.3: Wed 21 Oct 2026, 08:05 America/New_York.
const NOW = new Date('2026-10-21T12:05:00Z');
const TODAY = floatingDate('2026-10-21');
const users: User[] = [];

afterAll(async () => {
  await deleteUsers(...users);
});

async function user(prefs: Record<string, unknown> = { workdayStart: '09:00', workdayEnd: '18:00', lunchEndsAt: '13:00' }): Promise<User> {
  const u = await makeUser({ prefs });
  users.push(u);
  return u;
}

async function connectGoogle(userId: string) {
  await prisma.integrationAccount.create({ data: { userId, provider: 'google', accessToken: 'v1:test', scopes: 'gmail.readonly gmail.compose calendar.readonly' } });
}

function run(userId: string, input: string, steps: Step[], extra: { google?: ReturnType<typeof fakeGoogle>; final?: string; body?: Record<string, unknown>; now?: Date } = {}) {
  const model = scriptedModel(steps, extra.final ?? '');
  const deps = fakeDeps({ model, now: extra.now ?? NOW, google: extra.google });
  const body = { clientRequestId: randomUUID(), input, ...extra.body };
  return { model, deps, body, go: () => handleCommand(userId, body, deps, { requestId: randomUUID() }) };
}

const resolve = (reference: string): Step => [{ tool: 'resolve_task', input: { reference } }];
const events = (userId: string) => prisma.taskEvent.count({ where: { userId } });

function expectKind<K extends CommandResponse['kind']>(res: CommandResponse, kind: K): Extract<CommandResponse, { kind: K }> {
  if (res.kind !== kind) throw new Error(`expected ${kind}, got ${JSON.stringify(res)}`);
  return res as Extract<CommandResponse, { kind: K }>;
}

describe('rescheduling', () => {
  let u: User;
  beforeEach(async () => {
    u = await user();
  });

  it('E1: "Move the report to tomorrow" with one match executes and writes a TaskEvent', async () => {
    const t = await makeTask(u.id, { title: 'Q3 report', dueAt: TODAY, dueHasTime: false });
    const r = run(u.id, 'Move the report to tomorrow', [
      resolve('the report'),
      ({ results }) => [{ tool: 'propose_update_task', input: { task: handleIn(results, 'tsk_h_'), changes: { due: 'tomorrow' } } }],
    ], { final: 'Moved Q3 report to Thu 22 Oct.' });
    const res = expectKind(await r.go(), 'executed');
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].undo.taskEventId).toBeTruthy();
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.dueAt?.toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(await prisma.taskEvent.count({ where: { taskId: t.id } })).toBe(1);
  });
});
