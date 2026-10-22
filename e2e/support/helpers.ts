// e2e/support/helpers.ts — sign-in through the real form, palette access and
// direct reads/writes of the local E2E database for assertions. Plain `pg`
// (not the app's Prisma client): specs observe the database from outside.
import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import { addDays, floatingDate, localDateOf } from '@/lib/time';
import { DATABASE_URL, PASSWORD, TIME_ZONE } from './config';

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}

export async function count(text: string, params: unknown[] = []): Promise<number> {
  const [row] = await sql<{ n: string }>(`SELECT count(*)::text AS n FROM (${text}) q`, params);
  return Number(row.n);
}

export interface TaskRow {
  id: string;
  title: string;
  dueAt: Date | null;
  dueHasTime: boolean;
  version: number;
  status: string;
  tags: string[];
}

export async function tasksOf(userId: string, where = 'TRUE', params: unknown[] = []): Promise<TaskRow[]> {
  return sql<TaskRow>(
    `SELECT id, title, "dueAt", "dueHasTime", version, status::text AS status, tags FROM "Task" WHERE "userId" = $1 AND ${where} ORDER BY id`,
    [userId, ...params],
  );
}

export async function insertTask(userId: string, title: string, dueAt: Date | null): Promise<string> {
  const id = `e2e_${Math.random().toString(36).slice(2, 12)}`;
  await sql(`INSERT INTO "Task" (id, "userId", title, status, "dueAt", "dueHasTime", "updatedAt") VALUES ($1, $2, $3, 'TODO', $4, false, now())`, [id, userId, title, dueAt]);
  return id;
}

export async function userId(email: string): Promise<string> {
  const [row] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [email]);
  if (!row) throw new Error(`no seeded user ${email}`);
  return row.id;
}

/** The user's local calendar date, offset by `days`, as stored for an all-day due date. */
export function localDay(days = 0): Date {
  return floatingDate(addDays(localDateOf(new Date(), TIME_ZONE), days));
}

/** Signs in with the real password form and waits to leave the sign-in page. */
export async function signIn(page: Page, email: string, callbackUrl?: string): Promise<void> {
  await page.goto(callbackUrl ? `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}` : '/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'));
}

export function palette(page: Page) {
  return page.getByRole('dialog', { name: 'Command bar' });
}

export function paletteInput(page: Page) {
  return palette(page).getByRole('combobox');
}

export async function openPalette(page: Page) {
  await page.keyboard.press('Control+k');
  const input = paletteInput(page);
  await expect(input).toBeFocused();
  return input;
}

export async function runCommand(page: Page, text: string): Promise<void> {
  const input = await openPalette(page);
  await input.fill(text);
  await input.press('Enter');
}
