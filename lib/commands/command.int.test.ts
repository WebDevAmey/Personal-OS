// Command pipeline against the real test database; the model, Google, web
// and embeddings are fakes (lib/commands/test-support). The model runs through
// the real generateText loop, so tool schemas, handles, policy and execution
// are all exercised for real.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@/lib/generated/prisma/client';
import { deleteUsers, makeTask, testPrisma as prisma } from '@/lib/test/factories';
import { floatingDate } from '@/lib/time';
import { handleCommand } from './service';
import { command, eventCount, expectKind, makeCommandUser, referenceOf, resolveStep, TODAY } from './test-fixtures';
import { handleIn } from './test-support';

const users: User[] = [];
afterAll(async () => {
  await deleteUsers(...users);
});

describe('rescheduling', () => {
  let u: User;
  beforeEach(async () => {
    u = await makeCommandUser(users);
  });

  it('E1: "Move the report to tomorrow" with one match executes and writes a TaskEvent', async () => {
    const t = await makeTask(u.id, { title: 'Q3 report', dueAt: TODAY, dueHasTime: false });
    const r = command(u.id, 'Move the report to tomorrow', [
      resolveStep('the report'),
      ({ results }) => [{ tool: 'propose_update_task', input: { task: handleIn(results, 'tsk_h_'), changes: { due: 'tomorrow' } } }],
    ], { final: 'Moved Q3 report to Thu 22 Oct.' });
    const res = expectKind(await r.go(), 'executed');
    expect(res.actions).toHaveLength(1);
    expect(res.actions[0].undo?.taskEventId).toBeTruthy();
    const after = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.dueAt?.toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(await prisma.taskEvent.count({ where: { taskId: t.id } })).toBe(1);
  });

  it('three "Finish report" tasks: clarification with distinguishing details and no mutation; picking one executes without the model', async () => {
    const work = await prisma.project.create({ data: { userId: u.id, name: 'Work' } });
    const uni = await prisma.project.create({ data: { userId: u.id, name: 'Uni' } });
    await makeTask(u.id, { title: 'Finish report', dueAt: TODAY, projectId: work.id });
    const target = await makeTask(u.id, { title: 'Finish report', dueAt: floatingDate('2026-10-23'), projectId: uni.id });
    await makeTask(u.id, { title: 'Finish report' });
    const r = command(u.id, 'Move the report to tomorrow', [
      resolveStep('the report'),
      ({ results }) => [{ tool: 'propose_update_task', input: { task: referenceOf(results[0].value), changes: { due: 'tomorrow' } } }],
    ]);
    const res = expectKind(await r.go(), 'clarification');
    expect(res.options).toHaveLength(3);
    expect(res.message).toContain('Thu 22 Oct');
    expect(new Set(res.options.map((o) => o.detail)).size).toBe(3);
    expect(await eventCount(u.id)).toBe(0);

    const pick = res.options.find((o) => o.detail?.startsWith('Uni'))!;
    const callsBefore = r.model.doGenerateCalls.length;
    const answered = await handleCommand(u.id, { clientRequestId: randomUUID(), replyTo: { runId: res.runId, optionId: pick.id } }, r.deps);
    expectKind(answered, 'executed');
    expect(r.model.doGenerateCalls.length).toBe(callsBefore);
    const moved = await prisma.task.findUniqueOrThrow({ where: { id: target.id } });
    expect(moved.dueAt?.toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(await eventCount(u.id)).toBe(1);
    // The clarification is single-use.
    const again = await handleCommand(u.id, { clientRequestId: randomUUID(), replyTo: { runId: res.runId, optionId: pick.id } }, r.deps);
    expect(again.kind).toBe('error');
    expect(await eventCount(u.id)).toBe(1);
  });

  it('an ambiguous reference the model never acts on still becomes a clarification (the server never guesses)', async () => {
    await makeTask(u.id, { title: 'Finish report' });
    await makeTask(u.id, { title: 'Finish report' });
    const r = command(u.id, 'Move the report to tomorrow', [resolveStep('the report')], { final: 'Moved the report.' });
    const res = expectKind(await r.go(), 'clarification');
    expect(res.options).toHaveLength(2);
    expect(await eventCount(u.id)).toBe(0);
  });

  it('"move it to tomorrow" with no antecedent asks which task', async () => {
    await makeTask(u.id, { title: 'Pay rent', dueAt: TODAY });
    await makeTask(u.id, { title: 'Call mum', dueAt: floatingDate('2026-10-19') });
    const r = command(u.id, 'move it to tomorrow', [
      resolveStep('it'),
      ({ results }) => [{ tool: 'propose_update_task', input: { task: referenceOf(results[0].value), changes: { due: 'tomorrow' } } }],
    ]);
    const res = expectKind(await r.go(), 'clarification');
    expect(res.question).toMatch(/which task/i);
    expect(res.options.map((o) => o.label).sort()).toEqual(['Call mum', 'Pay rent']);
    expect(await eventCount(u.id)).toBe(0);
  });

  it('E13: "Move it to Friday" with no open tasks never guesses', async () => {
    const r = command(u.id, 'Move it to Friday', [resolveStep('it')], { final: "You don't have any open tasks to move." });
    const res = await r.go();
    expect(['answer', 'clarification']).toContain(res.kind);
    expect(await eventCount(u.id)).toBe(0);
  });

  it('a focused task is the antecedent for "it"', async () => {
    const t = await makeTask(u.id, { title: 'Pay rent', dueAt: TODAY });
    await makeTask(u.id, { title: 'Call mum', dueAt: TODAY });
    const r = command(u.id, 'move it to tomorrow', [
      resolveStep('it'),
      ({ results }) => [{ tool: 'propose_update_task', input: { task: handleIn(results, 'tsk_h_'), changes: { due: 'tomorrow' } } }],
    ], { body: { context: { focusedTaskId: t.id } } });
    expectKind(await r.go(), 'executed');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).dueAt?.toISOString()).toBe('2026-10-22T00:00:00.000Z');
  });

  it('"after lunch" with no lunch preference asks, saves the answer and resumes the reminder', async () => {
    const v = await makeCommandUser(users, { workdayStart: '09:00', workdayEnd: '18:00' });
    const r = command(v.id, 'Remind me after lunch to call the bank', [[{ tool: 'propose_create_reminder', input: { title: 'call the bank', at: 'after lunch' } }]]);
    const res = expectKind(await r.go(), 'clarification');
    expect(res.question).toMatch(/lunch/i);
    expect(res.options.map((o) => o.label)).toEqual(expect.arrayContaining(['12:30', '13:00', '13:30', '14:00']));
    expect(await prisma.reminder.count({ where: { userId: v.id } })).toBe(0);

    const pick = res.options.find((o) => o.label === '13:30')!;
    const done = expectKind(await handleCommand(v.id, { clientRequestId: randomUUID(), replyTo: { runId: res.runId, optionId: pick.id } }, r.deps), 'executed');
    expect(done.message).toContain('13:30');
    const reminder = await prisma.reminder.findFirstOrThrow({ where: { userId: v.id } });
    expect(reminder.remindAt.toISOString()).toBe('2026-10-21T17:30:00.000Z');
    expect((await prisma.userPreference.findUniqueOrThrow({ where: { userId: v.id } })).lunchEndsAt).toBe('13:30');
    expect(await prisma.agentAction.count({ where: { userId: v.id, toolName: 'set_preference' } })).toBe(1);
  });
});
