import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { User } from '@/lib/generated/prisma/client';
import { ConflictError, ValidationError } from '@/lib/db/errors';
import { deleteUsers, makeUser, testPrisma as prisma } from '@/lib/test/factories';
import { getPreferences, getUserTimeZone, updatePreferences } from './repo';

let A: User;
let B: User;
let bare: User;

beforeEach(async () => {
  await deleteUsers(A, B, bare);
  A = await makeUser({ label: 'pref_a', tz: 'America/New_York' });
  B = await makeUser({ label: 'pref_b', tz: 'Asia/Kolkata' });
  bare = await prisma.user.create({ data: { id: `test_pref_bare_${Date.now()}`, email: `bare_${Date.now()}@test.local` } });
});

afterAll(async () => deleteUsers(A, B, bare));

describe('preferences repo', () => {
  it('creates the default row on first read (get-or-default), once', async () => {
    const [p1, p2] = await Promise.all([getPreferences(bare.id), getPreferences(bare.id)]);
    expect(p1).toMatchObject({ userId: bare.id, timeZone: 'UTC', briefingHour: 6, briefingMinute: 30, weekStart: 1, version: 1 });
    expect(p2.userId).toBe(bare.id);
    expect(await prisma.userPreference.count({ where: { userId: bare.id } })).toBe(1);
  });

  it('updates fields, bumps version and records an audit event', async () => {
    const p = await updatePreferences(A.id, { timeZone: 'Europe/London', briefingHour: 7, workdayStart: '09:00', lunchEndsAt: null, locale: 'en-gb' });
    expect(p).toMatchObject({ timeZone: 'Europe/London', briefingHour: 7, workdayStart: '09:00', locale: 'en-GB', version: 2 });
    expect(await getUserTimeZone(A.id)).toBe('Europe/London');
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { userId: A.id, action: 'preference.update' } });
    expect(audit.metadata).toMatchObject({ before: { timeZone: 'America/New_York' }, after: { timeZone: 'Europe/London' } });
  });

  it('validates timeZone via Intl and every bounded field', async () => {
    const bad: Record<string, unknown>[] = [
      { timeZone: 'Mars/Olympus' },
      { timeZone: 'EST5EDT; DROP' },
      { briefingHour: 24 },
      { briefingMinute: -1 },
      { briefingHour: 1.5 },
      { weekStart: 7 },
      { workdayStart: '9:00' },
      { workdayEnd: '24:00' },
      { reducedMotion: 'LOUD' },
      { speechOutputEnabled: 'yes' },
      { locale: 'not a locale!!' },
      { userId: B.id },
    ];
    for (const patch of bad) {
      await expect(updatePreferences(A.id, patch as never)).rejects.toBeInstanceOf(ValidationError);
    }
    expect((await getPreferences(A.id)).version).toBe(1);
  });

  it('enforces expectedVersion when given', async () => {
    await updatePreferences(A.id, { briefingMinute: 0 }, { expectedVersion: 1 });
    await expect(updatePreferences(A.id, { briefingMinute: 15 }, { expectedVersion: 1 })).rejects.toBeInstanceOf(ConflictError);
    expect((await getPreferences(A.id)).briefingMinute).toBe(0);
  });

  it('an empty patch is a no-op', async () => {
    const p = await updatePreferences(A.id, {});
    expect(p.version).toBe(1);
  });

  it('cross-user: updating A never touches B', async () => {
    await updatePreferences(A.id, { timeZone: 'UTC' });
    const b = await getPreferences(B.id);
    expect(b).toMatchObject({ timeZone: 'Asia/Kolkata', version: 1 });
  });
});
