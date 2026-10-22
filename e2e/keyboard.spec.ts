// e2e/keyboard.spec.ts — keyboard only: reach the task list with Tab, move
// with the arrow keys, complete a task with a key (docs/07, docs/09 §5 row 17).
import { expect, test } from '@playwright/test';
import { USERS } from './support/config';
import { signIn, tasksOf, userId } from './support/helpers';

test('navigate the task list and complete a task without the mouse', async ({ page }) => {
  const uid = await userId(USERS.keys);
  await signIn(page, USERS.keys);
  await page.goto('/tasks');
  const list = page.getByRole('list', { name: /tasks/i }).first();
  await expect(list.getByRole('listitem', { name: 'Keyboard task one' })).toBeVisible();

  // Tab until a task row has focus (the list uses a roving tabindex: one stop).
  let onRow = false;
  for (let i = 0; i < 40 && !onRow; i++) {
    await page.keyboard.press('Tab');
    onRow = await page.evaluate(() => document.activeElement?.hasAttribute('data-task-id') ?? false);
  }
  expect(onRow).toBe(true);
  const focusedTitle = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  const first = await focusedTitle();

  await page.keyboard.press('ArrowDown');
  const second = await focusedTitle();
  expect(second).not.toBe(first);
  await page.keyboard.press('ArrowUp');
  expect(await focusedTitle()).toBe(first);
  await page.keyboard.press('ArrowDown');
  expect(await focusedTitle()).toBe(second);

  // Complete the focused task.
  await page.keyboard.press('e');
  await expect
    .poll(async () => (await tasksOf(uid, 'title = $2', [second])).map((t) => t.status))
    .toEqual(['DONE']);
  const statuses = (await tasksOf(uid)).map((t) => [t.title, t.status]);
  expect(statuses.filter(([, s]) => s === 'DONE')).toEqual([[second, 'DONE']]);
});
