// lib/test/factories.ts — DB fixtures for integration tests (docs/09 §3).
// Each test file creates its own users with random ids and deletes them in
// afterAll; deleting a user cascades to everything it owns.
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { Prisma, Task, User } from '@/lib/generated/prisma/client';
import { isSafeTestDatabaseUrl } from './global-db-setup';

export function assertSafeTestDb(): void {
  if (!isSafeTestDatabaseUrl(process.env.DATABASE_URL)) {
    throw new Error('Integration tests need DATABASE_URL pointing at a local test database (see docs/09 §2.2)');
  }
}

export interface MakeUserOptions {
  tz?: string;
  prefs?: Omit<Prisma.UserPreferenceUncheckedCreateInput, 'userId'>;
  label?: string;
}

export async function makeUser(opts: MakeUserOptions = {}): Promise<User> {
  assertSafeTestDb();
  const id = `test_${opts.label ?? 'u'}_${randomUUID().slice(0, 12)}`;
  return prisma.user.create({
    data: {
      id,
      email: `${id}@test.local`,
      emailVerified: true,
      preference: { create: { timeZone: opts.tz ?? 'America/New_York', ...opts.prefs } },
    },
  });
}

export async function deleteUsers(...users: (User | string | undefined)[]): Promise<void> {
  const ids = users.filter(Boolean).map((u) => (typeof u === 'string' ? u : u!.id));
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

/** Inserts a task row directly (bypassing the repo) for read-side tests. */
export async function makeTask(userId: string, data: Partial<Prisma.TaskUncheckedCreateInput> = {}): Promise<Task> {
  return prisma.task.create({ data: { title: 'Test task', status: 'TODO', ...data, userId } });
}

export { prisma as testPrisma };
