// /api/command route handlers end to end: session cookie, CSRF, size cap,
// error envelope and status codes. getCommandDeps is replaced with fakes so
// no model or Google call leaves the process.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/lib/generated/prisma/client';
import { createSessionCookie } from '@/lib/auth/session';
import { apiRequest } from '@/lib/auth/test-helpers';
import type { CommandDeps } from '@/lib/commands/deps';
import { fakeDeps, handleIn, scriptedModel, type Step } from '@/lib/commands/test-support';
import { makeCommandUser, NOW, TODAY } from '@/lib/commands/test-fixtures';
import { deleteUsers, makeTask, testPrisma as prisma } from '@/lib/test/factories';

const holder: { deps: CommandDeps | null } = { deps: null };
vi.mock('@/lib/commands/deps', () => ({
  getCommandDeps: () => {
    if (!holder.deps) throw new Error('test did not set deps');
    return holder.deps;
  },
}));

const { POST: command } = await import('./route');
const { POST: confirm } = await import('./confirm/route');
const { POST: cancel } = await import('./cancel/route');
const { POST: undo } = await import('./undo/route');

const users: User[] = [];
let u: User;
let cookie: string;

afterAll(async () => {
  await deleteUsers(...users);
});

beforeEach(async () => {
  u = await makeCommandUser(users);
  cookie = (await createSessionCookie(u)).split(';')[0];
  holder.deps = null;
});

function scriptModel(steps: Step[], final = '') {
  const model = scriptedModel(steps, final);
  holder.deps = fakeDeps({ model, now: NOW });
  return model;
}

const moveReport: Step[] = [
  [{ tool: 'resolve_task', input: { reference: 'the report' } }],
  ({ results }) => [{ tool: 'propose_update_task', input: { task: handleIn(results, 'tsk_h_'), changes: { due: 'tomorrow' } } }],
];

describe('POST /api/command', () => {
  it('401 without a session, in the error envelope', async () => {
    const res = await command(apiRequest('/api/command', { clientRequestId: randomUUID(), input: 'hi' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ kind: 'error', error: { code: 'UNAUTHENTICATED' } });
  });

  it('403 for a cross-origin request, before any work', async () => {
    const model = scriptModel([]);
    const res = await command(apiRequest('/api/command', { clientRequestId: randomUUID(), input: 'hi' }, { cookie, origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(await prisma.agentRun.count({ where: { userId: u.id } })).toBe(0);
  });

  it('415 for a non-JSON body', async () => {
    const res = await command(apiRequest('/api/command', 'input=hi', { cookie, contentType: 'text/plain' }));
    expect(res.status).toBe(415);
  });

  it('413 INPUT_TOO_LONG over 2,000 characters (docs/04 §12)', async () => {
    const model = scriptModel([]);
    const res = await command(apiRequest('/api/command', { clientRequestId: randomUUID(), input: 'a'.repeat(2001) }, { cookie }));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ kind: 'error', error: { code: 'INPUT_TOO_LONG' } });
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('413 for an oversized raw body and 400 for malformed JSON or shape', async () => {
    scriptModel([]);
    const big = await command(apiRequest('/api/command', JSON.stringify({ clientRequestId: randomUUID(), input: 'x', pad: 'p'.repeat(20_000) }), { cookie }));
    expect(big.status).toBe(413);
    const bad = await command(apiRequest('/api/command', '{not json', { cookie }));
    expect(bad.status).toBe(400);
    const shape = await command(apiRequest('/api/command', { input: 'no request id' }, { cookie }));
    expect(shape.status).toBe(400);
    expect(await shape.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('200 executed with no-store, then undo restores the task', async () => {
    const t = await makeTask(u.id, { title: 'Q3 report', dueAt: TODAY });
    scriptModel(moveReport);
    const res = await command(apiRequest('/api/command', { clientRequestId: randomUUID(), input: 'Move the report to tomorrow' }, { cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.kind).toBe('executed');

    const undone = await undo(apiRequest('/api/command/undo', { taskEventId: body.actions[0].undo.taskEventId }, { cookie }));
    expect(undone.status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).dueAt?.toISOString()).toBe(TODAY.toISOString());
  });
});

describe('confirm, cancel and undo routes', () => {
  async function deleteProposal() {
    await makeTask(u.id, { title: 'Book dentist' });
    scriptModel([
      [{ tool: 'resolve_task', input: { reference: 'the dentist task' } }],
      ({ results }) => [{ tool: 'propose_delete_task', input: { task: handleIn(results, 'tsk_h_') } }],
    ]);
    const res = await command(apiRequest('/api/command', { clientRequestId: randomUUID(), input: 'Delete the dentist task' }, { cookie }));
    const body = await res.json();
    expect(body.kind).toBe('proposal');
    return body.proposal.id as string;
  }

  it('confirm requires a session and same origin', async () => {
    const id = await deleteProposal();
    expect((await confirm(apiRequest('/api/command/confirm', { proposalId: id }))).status).toBe(401);
    expect((await confirm(apiRequest('/api/command/confirm', { proposalId: id }, { cookie, origin: 'https://evil.example' }))).status).toBe(403);
    expect((await prisma.proposedAction.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
  });

  it("another user's proposal is 404", async () => {
    const id = await deleteProposal();
    const other = await makeCommandUser(users);
    const otherCookie = (await createSessionCookie(other)).split(';')[0];
    const res = await confirm(apiRequest('/api/command/confirm', { proposalId: id }, { cookie: otherCookie }));
    expect(res.status).toBe(404);
    expect((await prisma.proposedAction.findUniqueOrThrow({ where: { id } })).status).toBe('PENDING');
  });

  it('confirm executes once; a repeat replays 200; cancel after confirm is refused', async () => {
    const id = await deleteProposal();
    const a = await confirm(apiRequest('/api/command/confirm', { proposalId: id }, { cookie }));
    const b = await confirm(apiRequest('/api/command/confirm', { proposalId: id }, { cookie }));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await b.json()).actions).toEqual((await a.json()).actions);
    expect(await prisma.taskEvent.count({ where: { userId: u.id } })).toBe(1);
    const late = await cancel(apiRequest('/api/command/cancel', { proposalId: id }, { cookie }));
    expect(late.status).toBeGreaterThanOrEqual(400);
  });

  it('cancel withdraws the proposal', async () => {
    const id = await deleteProposal();
    const res = await cancel(apiRequest('/api/command/cancel', { proposalId: id }, { cookie }));
    expect(res.status).toBe(200);
    expect((await prisma.proposedAction.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
  });

  it("undo of another user's event is 404", async () => {
    const other = await makeCommandUser(users);
    await makeTask(other.id, { title: 'Q3 report', dueAt: TODAY });
    const otherCookie = (await createSessionCookie(other)).split(';')[0];
    scriptModel(moveReport);
    const body = await (await command(apiRequest('/api/command', { clientRequestId: randomUUID(), input: 'Move the report to tomorrow' }, { cookie: otherCookie }))).json();
    const res = await undo(apiRequest('/api/command/undo', { taskEventId: body.actions[0].undo.taskEventId }, { cookie }));
    expect(res.status).toBe(404);
  });
});
