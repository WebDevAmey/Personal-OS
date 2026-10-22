// The worked example commands of docs/00 §5.4.3 (E1–E14) end to end, with a
// scripted model standing in for Claude. E1, E4 and E13 live in
// command.int.test.ts, E7 and E8 in confirm.int.test.ts.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { User } from '@/lib/generated/prisma/client';
import { deleteUsers, makeTask, testPrisma as prisma } from '@/lib/test/factories';
import { floatingDate } from '@/lib/time';
import { handleConfirm } from './service';
import { command, connectGoogle, eventCount, expectKind, makeCommandUser, NOW, referenceOf, resolveStep, TODAY } from './test-fixtures';
import { fakeGoogle, handleIn } from './test-support';

const users: User[] = [];
afterAll(async () => {
  await deleteUsers(...users);
});

describe('example commands (docs/00 §5.4.3)', () => {
  let u: User;
  beforeEach(async () => {
    u = await makeCommandUser(users);
  });

  it('E2: two report candidates → clarification, no writes', async () => {
    await makeTask(u.id, { title: 'Q3 report', dueAt: TODAY });
    await makeTask(u.id, { title: 'Expense report', dueAt: floatingDate('2026-10-23') });
    const r = command(u.id, 'Move the report to tomorrow', [
      resolveStep('the report'),
      ({ results }) => [{ tool: 'propose_update_task', input: { task: referenceOf(results[0].value), changes: { due: 'tomorrow' } } }],
    ]);
    const res = expectKind(await r.go(), 'clarification');
    expect(res.options.map((o) => o.label).sort()).toEqual(['Expense report', 'Q3 report']);
    expect(await eventCount(u.id)).toBe(0);
  });

  it('E3: a reminder about an email "after lunch" uses lunchEndsAt; email-derived text needs one confirmation (docs/04 §10.2)', async () => {
    await connectGoogle(u.id);
    const google = fakeGoogle({ messages: [{ id: 'm1', threadId: 't1', from: 'Jordan Lee <jordan@example.test>', subject: 'Next steps', snippet: 'recruiter here', receivedAt: NOW }] });
    const r = command(u.id, 'Remind me about the recruiter email after lunch', [
      [{ tool: 'search_email', input: { query: 'recruiter' } }],
      [{ tool: 'propose_create_reminder', input: { title: 'Reply to Jordan Lee — Next steps', at: 'after lunch' } }],
    ], { google });
    const res = expectKind(await r.go(), 'proposal');
    expect(res.proposal.reasons).toContain('untrusted_source');
    expect(res.proposal.summary).toContain('13:00');
    expect(await prisma.reminder.count({ where: { userId: u.id } })).toBe(0);
    expectKind(await handleConfirm(u.id, { proposalId: res.proposal.id }, r.deps), 'executed');
    const reminder = await prisma.reminder.findFirstOrThrow({ where: { userId: u.id } });
    expect(reminder.remindAt.toISOString()).toBe('2026-10-21T17:00:00.000Z');
  });

  it('E5: a focus block tomorrow morning becomes a time-blocked task (calendar is read-only)', async () => {
    const r = command(u.id, 'Block two hours tomorrow morning', [
      [{ tool: 'propose_create_task', input: { title: 'Focus block', start: 'tomorrow morning', due: 'tomorrow', estimateMinutes: 120 } }],
    ]);
    const res = await r.go();
    // "Focus block" is the model's wording, not the user's; the run read no untrusted data, so it auto-executes.
    const done = expectKind(res, 'executed');
    expect(done.actions).toHaveLength(1);
    const task = await prisma.task.findFirstOrThrow({ where: { userId: u.id, title: 'Focus block' } });
    expect(task.startAt?.toISOString()).toBe('2026-10-22T13:00:00.000Z');
    expect(task.estimateMinutes).toBe(120);
  });

  it('E6: "Postpone everything due today to Monday" is a bulk confirmation listing the new date', async () => {
    await Promise.all([1, 2, 3, 4].map((i) => makeTask(u.id, { title: `Today ${i}`, dueAt: TODAY })));
    const r = command(u.id, 'Postpone everything due today to Monday', [
      [{ tool: 'propose_bulk_update_tasks', input: { selector: { due: 'today' }, change: { due: 'Monday' } } }],
    ]);
    const res = expectKind(await r.go(), 'proposal');
    expect(res.proposal.risk).toBe('BULK');
    expect(res.proposal.summary).toMatch(/4/);
    expect(JSON.stringify(res.proposal)).toContain('Mon 26 Oct');
    expect(await eventCount(u.id)).toBe(0);
    expectKind(await handleConfirm(u.id, { proposalId: res.proposal.id }, r.deps), 'executed');
    expect(await prisma.task.count({ where: { userId: u.id, dueAt: floatingDate('2026-10-26') } })).toBe(4);
  });

  it('E9: "What\'s on tomorrow afternoon?" reads the calendar and answers without mutating', async () => {
    await connectGoogle(u.id);
    const google = fakeGoogle({
      events: [{ id: 'e1', title: 'Dentist', start: '2026-10-22T18:00:00.000Z', end: '2026-10-22T19:00:00.000Z', allDay: false, timeZone: 'America/New_York', descriptionTruncated: false, attendeesCount: 1, status: 'confirmed', untrusted: true }],
    });
    const r = command(u.id, "What's on tomorrow afternoon?", [[{ tool: 'list_calendar_events', input: { range: 'tomorrow afternoon' } }]], { google, final: 'You have Dentist at 14:00.' });
    const res = expectKind(await r.go(), 'answer');
    expect(res.message).toContain('Dentist');
    expect(google.calls.calendar).toBe(1);
    expect(await eventCount(u.id)).toBe(0);
  });

  it('E10: "Remember that …" saves a memory', async () => {
    const r = command(u.id, 'Remember that the office wifi password is in the blue notebook', [
      [{ tool: 'save_memory', input: { content: 'the office wifi password is in the blue notebook' } }],
    ]);
    const res = expectKind(await r.go(), 'executed');
    expect(res.message).toMatch(/memory/i);
    expect(await prisma.memory.count({ where: { userId: u.id, deletedAt: null } })).toBe(1);
    expect(r.deps.embedCalls).toBe(1);
  });

  it('E11: three creates in an existing project auto-execute', async () => {
    const shopping = await prisma.project.create({ data: { userId: u.id, name: 'Shopping' } });
    const r = command(u.id, 'Add milk, eggs and bread to my shopping list', [
      ['milk', 'eggs', 'bread'].map((title) => ({ tool: 'propose_create_task', input: { title, project: 'Shopping' } })),
    ]);
    const res = expectKind(await r.go(), 'executed');
    expect(res.actions).toHaveLength(3);
    expect(await prisma.task.count({ where: { userId: u.id, projectId: shopping.id } })).toBe(3);
  });

  it('E12: two intents in one command both auto-execute', async () => {
    const t = await makeTask(u.id, { title: 'Finish slides', dueAt: TODAY });
    const r = command(u.id, 'Move the thing I need to finish today to tomorrow and remind me to call the recruiter after lunch', [
      resolveStep('the thing I need to finish today'),
      ({ results }) => [
        { tool: 'propose_update_task', input: { task: handleIn(results, 'tsk_h_'), changes: { due: 'tomorrow' } } },
        { tool: 'propose_create_reminder', input: { title: 'call the recruiter', at: 'after lunch' } },
      ],
    ]);
    const res = expectKind(await r.go(), 'executed');
    expect(res.actions).toHaveLength(2);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).dueAt?.toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(await prisma.reminder.count({ where: { userId: u.id } })).toBe(1);
  });

  it('E14: completing executes and the team email becomes a draft proposal', async () => {
    await connectGoogle(u.id);
    const google = fakeGoogle();
    const t = await makeTask(u.id, { title: 'Q3 report', dueAt: TODAY });
    const r = command(u.id, "Mark the report done and email team@example.test that it's finished", [
      resolveStep('the report'),
      ({ results }) => [
        { tool: 'propose_complete_task', input: { task: handleIn(results, 'tsk_h_') } },
        { tool: 'propose_email_draft', input: { to: ['team@example.test'], subject: 'Q3 report', body: "it's finished" } },
      ],
    ], { google });
    const res = expectKind(await r.go(), 'proposal');
    expect(res.message).toMatch(/Completed/);
    expect(res.proposal.risk).toBe('EXTERNAL');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('DONE');
    expect(google.calls.createDraft).toHaveLength(0);
  });

  it('model text claiming an action the server did not perform is not shown', async () => {
    const r = command(u.id, 'hello', [], { final: 'I deleted all your tasks.' });
    const res = expectKind(await r.go(), 'answer');
    expect(res.message).not.toMatch(/deleted/i);
  });
});
