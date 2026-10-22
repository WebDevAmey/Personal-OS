// lib/commands/test-fixtures.ts — DB fixtures shared by the command
// integration tests. Test-only; never imported by application code.
import { randomUUID } from 'node:crypto';
import type { User } from '@/lib/generated/prisma/client';
import { makeUser, testPrisma as prisma } from '@/lib/test/factories';
import { floatingDate } from '@/lib/time';
import { handleCommand } from './service';
import { fakeDeps, scriptedModel, type FakeGoogle, type Step } from './test-support';
import type { CommandResponse } from './types';

// docs/00 §5.4.3: Wed 21 Oct 2026, 08:05 America/New_York.
export const NOW = new Date('2026-10-21T12:05:00Z');
export const TODAY = floatingDate('2026-10-21');
export const DEFAULT_PREFS = { workdayStart: '09:00', workdayEnd: '18:00', lunchEndsAt: '13:00' };

export async function makeCommandUser(created: User[], prefs: Record<string, unknown> = DEFAULT_PREFS): Promise<User> {
  const u = await makeUser({ prefs });
  created.push(u);
  return u;
}

export async function connectGoogle(userId: string): Promise<void> {
  await prisma.integrationAccount.create({ data: { userId, provider: 'google', accessToken: 'v1:test', scopes: 'gmail.readonly gmail.compose calendar.readonly' } });
}

export interface RunOptions {
  google?: FakeGoogle;
  final?: string;
  body?: Record<string, unknown>;
  now?: Date;
}

export function command(userId: string, input: string, steps: Step[], opts: RunOptions = {}) {
  const model = scriptedModel(steps, opts.final ?? '');
  const deps = fakeDeps({ model, now: opts.now ?? NOW, google: opts.google });
  const body = { clientRequestId: randomUUID(), input, ...opts.body };
  return { model, deps, body, go: () => handleCommand(userId, body, deps, { requestId: randomUUID() }) };
}

export const resolveStep = (reference: string): Step => [{ tool: 'resolve_task', input: { reference } }];
export const eventCount = (userId: string) => prisma.taskEvent.count({ where: { userId } });

export function expectKind<K extends CommandResponse['kind']>(res: CommandResponse, kind: K): Extract<CommandResponse, { kind: K }> {
  if (res.kind !== kind) throw new Error(`expected ${kind}, got ${JSON.stringify(res)}`);
  return res as Extract<CommandResponse, { kind: K }>;
}

/** The `reference` set handle of an ambiguous resolve_task result. */
export function referenceOf(value: unknown): string {
  const ref = (value as { reference?: string }).reference;
  if (!ref) throw new Error(`no reference in ${JSON.stringify(value)}`);
  return ref;
}
