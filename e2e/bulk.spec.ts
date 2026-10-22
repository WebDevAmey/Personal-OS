// e2e/bulk.spec.ts — a bulk command is a proposal that needs confirmation;
// confirming applies it exactly once, and a replayed confirm after a reload
// changes nothing (docs/04 §8.4, §9.2; REL-007).
import { expect, test } from '@playwright/test';
import { BASE_URL, USERS } from './support/config';
import { count, palette, runCommand, signIn, sql, tasksOf, userId } from './support/helpers';

test('bulk tag: proposal → confirm → applied once; reload + re-confirm is a no-op', async ({ page }) => {
  const uid = await userId(USERS.bulk);
  const bulkTasks = () => tasksOf(uid, "title LIKE 'Bulk prep:%'");
  const before = await bulkTasks();
  expect(before).toHaveLength(3);

  await signIn(page, USERS.bulk);
  await page.goto('/today');
  const commandResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/command' && r.request().method() === 'POST');
  await runCommand(page, 'Tag all bulk prep tasks with errands');
  const body = (await (await commandResponse).json()) as { kind: string; proposal: { id: string; risk: string } };
  expect(body.kind).toBe('proposal');
  expect(body.proposal.risk).toBe('BULK');

  const proposal = palette(page).getByRole('region', { name: /Confirm 3 changes/ });
  await expect(proposal).toBeVisible();
  await expect(proposal.getByText('Changes several items')).toBeVisible();
  await expect(proposal.getByRole('list', { name: 'Changes' }).getByRole('listitem')).toHaveCount(3);
  // Nothing has changed yet.
  expect(await bulkTasks()).toEqual(before);
  expect(await count('SELECT 1 FROM "TaskEvent" WHERE "userId" = $1', [uid])).toBe(0);

  await proposal.getByRole('button', { name: /^Confirm/ }).click();
  await expect(palette(page).getByRole('region', { name: 'Done' })).toBeVisible();

  const after = await bulkTasks();
  for (const t of after) expect(t.tags).toEqual(['errands']);
  expect(after.map((t) => t.version)).toEqual(before.map((t) => t.version + 1));
  const [other] = await tasksOf(uid, "title = 'Water the plants'");
  expect(other.tags).toEqual([]);
  const events = await sql<{ batchId: string | null }>('SELECT "batchId" FROM "TaskEvent" WHERE "userId" = $1', [uid]);
  expect(events).toHaveLength(3);
  expect(new Set(events.map((e) => e.batchId)).size).toBe(1);
  const [action] = await sql<{ status: string }>('SELECT status::text FROM "ProposedAction" WHERE id = $1', [body.proposal.id]);
  expect(action.status).toBe('EXECUTED');

  // Reload, then replay the confirm (a double-submit or a retried request).
  await page.reload();
  const replay = await page.request.post('/api/command/confirm', {
    data: { proposalId: body.proposal.id, decision: 'confirm' },
    headers: { Origin: BASE_URL },
  });
  expect(replay.status()).toBe(200);
  expect(((await replay.json()) as { kind: string }).kind).toBe('executed');
  expect(await bulkTasks()).toEqual(after);
  expect(await count('SELECT 1 FROM "TaskEvent" WHERE "userId" = $1', [uid])).toBe(3);
});
