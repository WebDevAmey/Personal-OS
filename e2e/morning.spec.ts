// e2e/morning.spec.ts — the 8 AM acceptance test in a real browser
// (docs/00 §9, docs/09 §6.2; REL-001, BRIEF-008, AI-009).
//
// Global setup ran the real scheduler + generation jobs for 08:00 local
// today. Here the user signs in through the real form, opens Today without
// clicking anything, reads a grounded briefing, and reschedules the report by
// natural language; then, with three matching tasks, the server asks instead
// of guessing.
import { expect, test } from '@playwright/test';
import { USERS } from './support/config';
import { count, insertTask, localDay, palette, runCommand, signIn, sql, tasksOf, userId } from './support/helpers';

test('8 AM: briefing is ready on Today, "Move the report to tomorrow" executes, ambiguity asks first', async ({ page }) => {
  const uid = await userId(USERS.morning);
  const [report] = await tasksOf(uid, 'title = $2', ['Finish the quarterly report']);
  expect(report.dueAt?.toISOString()).toBe(localDay(0).toISOString());

  // The run was prepared by the scheduler before the user arrived.
  const runs = await sql<{ status: string; trigger: string }>('SELECT status::text, trigger::text FROM "BriefingRun" WHERE "userId" = $1', [uid]);
  expect(runs).toEqual([{ status: 'SUCCEEDED', trigger: 'SCHEDULED' }]);

  await signIn(page, USERS.morning);
  await page.goto('/today');

  // ── Briefing, visible with no interaction ──
  const briefing = page.getByRole('region', { name: 'Needs attention' });
  await expect(briefing).toBeVisible();
  await expect(briefing.getByText('Preparing')).toHaveCount(0);
  const item = (title: RegExp | string) => briefing.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title }) });
  const reportItem = item('Finish the quarterly report');
  await expect(reportItem.getByText('Due today')).toBeVisible();
  await expect(reportItem.getByRole('button', { name: 'Task: Finish the quarterly report' })).toBeVisible(); // source chip
  await expect(reportItem.getByText('Inferred', { exact: true })).toHaveCount(0); // a fact
  await expect(item('Renew passport').getByText('Overdue')).toBeVisible();
  const inferred = item(/Plan team offsite/);
  await expect(inferred.getByText('Inferred', { exact: true })).toBeVisible();
  await expect(inferred.getByRole('button', { name: 'Task: Plan team offsite' })).toBeVisible();
  // Google is not connected: the briefing says so instead of failing.
  await expect(briefing.getByText('Connect Google to include email and calendar.')).toBeVisible();

  // ── One-turn reschedule ──
  const runsBefore = await count('SELECT 1 FROM "AgentRun" WHERE "userId" = $1', [uid]);
  await runCommand(page, 'Move the report to tomorrow');
  const done = palette(page).getByRole('region', { name: 'Done' });
  await expect(done).toBeVisible();
  await expect(done).toContainText('Finish the quarterly report');
  await expect(done.getByRole('button', { name: 'Undo' })).toBeVisible();

  const [moved] = await tasksOf(uid, 'id = $2', [report.id]);
  expect(moved.dueAt?.toISOString()).toBe(localDay(1).toISOString());
  expect(moved.dueHasTime).toBe(false);
  expect(moved.version).toBe(report.version + 1);
  const events = await sql<{ type: string; agentRunId: string | null }>('SELECT type::text, "agentRunId" FROM "TaskEvent" WHERE "taskId" = $1', [report.id]);
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe('UPDATED');
  const agentRuns = await sql<{ id: string; input: string; status: string; model: string }>(
    'SELECT id, input, status::text, model FROM "AgentRun" WHERE "userId" = $1 ORDER BY "createdAt" DESC',
    [uid],
  );
  expect(agentRuns).toHaveLength(runsBefore + 1);
  expect(agentRuns[0]).toMatchObject({ input: 'Move the report to tomorrow', model: 'e2e-scripted' });
  expect(events[0].agentRunId).toBe(agentRuns[0].id);

  // ── Three matching tasks: clarification, no mutation ──
  const extra = [await insertTask(uid, 'Finish report', localDay(0)), await insertTask(uid, 'Finish report', localDay(3))];
  const ids = [report.id, ...extra];
  const snapshot = async () => (await tasksOf(uid, 'id = ANY($2)', [ids])).map((t) => ({ id: t.id, dueAt: t.dueAt?.toISOString(), version: t.version }));
  const before = await snapshot();
  const eventsBefore = await count('SELECT 1 FROM "TaskEvent" WHERE "userId" = $1', [uid]);

  await page.reload();
  await runCommand(page, 'Move the report to tomorrow');
  const options = palette(page).getByRole('list', { name: '3 options' });
  await expect(options).toBeVisible();
  await expect(palette(page).getByRole('heading', { name: /which/i })).toBeVisible();
  expect(await snapshot()).toEqual(before);
  expect(await count('SELECT 1 FROM "TaskEvent" WHERE "userId" = $1', [uid])).toBe(eventsBefore);

  // Pick one of the two new "Finish report" tasks.
  await options.getByRole('button').filter({ hasText: /^\d?Finish report/ }).first().click();
  await expect(palette(page).getByRole('region', { name: 'Done' })).toBeVisible();
  const after = await snapshot();
  const changed = after.filter((t, i) => t.version !== before[i].version);
  expect(changed).toHaveLength(1);
  expect(extra).toContain(changed[0].id);
  expect(changed[0].dueAt).toBe(localDay(1).toISOString());
  expect(await count('SELECT 1 FROM "TaskEvent" WHERE "userId" = $1', [uid])).toBe(eventsBefore + 1);
});
