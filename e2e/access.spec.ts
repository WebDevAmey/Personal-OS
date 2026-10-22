// e2e/access.spec.ts — unauthenticated pages redirect to sign-in, and one
// user cannot read or change another user's task (docs/09 §5 rows 3–5).
import { expect, test } from '@playwright/test';
import { BASE_URL, USERS } from './support/config';
import { signIn, tasksOf, userId } from './support/helpers';

test('unauthenticated /today redirects to /sign-in with the callback', async ({ page }) => {
  const res = await page.goto('/today');
  expect(new URL(page.url()).pathname).toBe('/sign-in');
  expect(new URL(page.url()).searchParams.get('callbackUrl')).toBe('/today');
  expect(res?.ok()).toBe(true);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

  const api = await page.request.get('/api/tasks');
  expect(api.status()).toBe(401);
});

test('signing in from the redirect returns to the requested page', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Ftasks/);
  await signIn(page, USERS.beta, '/tasks');
  await expect(page).toHaveURL(`${BASE_URL}/tasks`);
});

test("user B gets 404 for user A's task, and cannot change it", async ({ page }) => {
  const [alphaTask] = await tasksOf(await userId(USERS.alpha));
  const [betaTask] = await tasksOf(await userId(USERS.beta));

  await signIn(page, USERS.beta);
  const own = await page.request.get(`/api/tasks/${betaTask.id}`);
  expect(own.status()).toBe(200);

  const read = await page.request.get(`/api/tasks/${alphaTask.id}`);
  expect(read.status()).toBe(404);
  expect(JSON.stringify(await read.json())).not.toContain('Alpha private task');

  const write = await page.request.patch(`/api/tasks/${alphaTask.id}`, {
    data: { title: 'pwned', version: alphaTask.version },
    headers: { Origin: BASE_URL },
  });
  expect(write.status()).toBe(404);
  const history = await page.request.get(`/api/tasks/${alphaTask.id}/history`);
  expect(history.status()).toBe(404);

  const [unchanged] = await tasksOf(await userId(USERS.alpha), 'id = $2', [alphaTask.id]);
  expect(unchanged).toEqual(alphaTask);
});
