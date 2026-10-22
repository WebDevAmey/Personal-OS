// Integration tests for the UI task routes against the local test database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSessionCookie } from '@/lib/auth/session';
import { apiRequest } from '@/lib/auth/test-helpers';
import { deleteUsers, makeTask, makeUser } from '@/lib/test/factories';
import type { User } from '@/lib/generated/prisma/client';
import { GET as listGET, POST as createPOST } from './route';
import { GET as detailGET, PATCH as detailPATCH, DELETE as detailDELETE } from './[id]/route';
import { POST as actionPOST } from './[id]/actions/route';
import { POST as undoPOST } from './undo/route';
import { POST as bulkPOST } from './bulk/route';
import { GET as historyGET } from './[id]/history/route';

let alice: User;
let bob: User;
let aliceCookie: string;
let bobCookie: string;

beforeAll(async () => {
  alice = await makeUser({ label: 'ui_alice', tz: 'America/New_York' });
  bob = await makeUser({ label: 'ui_bob' });
  aliceCookie = (await createSessionCookie(alice)).split(';')[0];
  bobCookie = (await createSessionCookie(bob)).split(';')[0];
});

afterAll(async () => {
  await deleteUsers(alice, bob);
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (path: string, cookie?: string) => apiRequest(path, undefined, { method: 'GET', cookie });

describe('auth and CSRF', () => {
  it('returns 401 without a session', async () => {
    expect((await listGET(get('/api/tasks'))).status).toBe(401);
    expect((await createPOST(apiRequest('/api/tasks', { title: 'x' }))).status).toBe(401);
  });

  it('returns 403 for a cross-site write even with a valid cookie', async () => {
    const res = await createPOST(apiRequest('/api/tasks', { title: 'x' }, { cookie: aliceCookie, origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
  });

  it('returns 415 for a non-JSON write', async () => {
    const res = await createPOST(apiRequest('/api/tasks', 'title=x', { cookie: aliceCookie, contentType: 'text/plain' }));
    expect(res.status).toBe(415);
  });
});

describe('validation', () => {
  it('rejects an empty title with 400 and field issues', async () => {
    const res = await createPOST(apiRequest('/api/tasks', { title: '   ' }, { cookie: aliceCookie }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('rejects unknown fields and bad dates', async () => {
    expect((await createPOST(apiRequest('/api/tasks', { title: 'a', userId: bob.id }, { cookie: aliceCookie }))).status).toBe(400);
    expect((await createPOST(apiRequest('/api/tasks', { title: 'a', due: { date: '2026-13-40' } }, { cookie: aliceCookie }))).status).toBe(400);
  });

  it('rejects oversized bodies with 413', async () => {
    const res = await createPOST(apiRequest('/api/tasks', { title: 'a', description: 'x'.repeat(40_000) }, { cookie: aliceCookie }));
    expect(res.status).toBe(413);
  });

  it('rejects an invalid view', async () => {
    expect((await listGET(get('/api/tasks?view=nope', aliceCookie))).status).toBe(400);
  });
});

describe('create, read, update, complete, undo', () => {
  it('parses quick capture deterministically', async () => {
    const res = await createPOST(apiRequest('/api/tasks', { capture: '+ Book dentist tomorrow !2 @health' }, { cookie: aliceCookie }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task.title).toBe('Book dentist');
    expect(body.task.priority).toBe(3);
    expect(body.task.tags).toEqual(['health']);
    expect(body.task.dueHasTime).toBe(false);
    expect(body.task.status).toBe('TODO');
  });

  it('lands undated captures in the Inbox and reports unknown projects without creating them', async () => {
    const res = await createPOST(apiRequest('/api/tasks', { capture: 'Call the bank #nosuchproject' }, { cookie: aliceCookie }));
    const body = await res.json();
    expect(body.task.status).toBe('INBOX');
    expect(body.task.projectId).toBeNull();
    expect(body.unknownProject).toBe('nosuchproject');
  });

  it('updates with optimistic concurrency and reports stale versions as 409', async () => {
    const created = await (await createPOST(apiRequest('/api/tasks', { title: 'Write report' }, { cookie: aliceCookie }))).json();
    const id = created.task.id;
    const ok = await detailPATCH(apiRequest(`/api/tasks/${id}`, { version: 1, priority: 4, due: { date: '2026-10-23', time: '15:00' } }, { method: 'PATCH', cookie: aliceCookie }), params(id));
    expect(ok.status).toBe(200);
    const updated = (await ok.json()).task;
    expect(updated.priority).toBe(4);
    expect(updated.due).toEqual({ date: '2026-10-23', time: '15:00' });
    const stale = await detailPATCH(apiRequest(`/api/tasks/${id}`, { version: 1, title: 'x' }, { method: 'PATCH', cookie: aliceCookie }), params(id));
    expect(stale.status).toBe(409);
  });

  it('completes a task and undoes it', async () => {
    const t = await makeTask(alice.id, { title: 'Finish Q3 report' });
    const done = await actionPOST(apiRequest(`/api/tasks/${t.id}/actions`, { action: 'complete' }, { cookie: aliceCookie }), params(t.id));
    expect(done.status).toBe(200);
    const body = await done.json();
    expect(body.task.status).toBe('DONE');
    const undo = await undoPOST(apiRequest('/api/tasks/undo', { eventId: body.undoEventId }, { cookie: aliceCookie }));
    expect(undo.status).toBe(200);
    expect((await undo.json()).tasks[0].status).toBe('TODO');
    const history = await (await historyGET(get(`/api/tasks/${t.id}/history`, aliceCookie), params(t.id))).json();
    expect(history.events.map((e: { type: string }) => e.type)).toEqual(['UNDONE', 'COMPLETED']);
    expect(history.events[1].undone).toBe(true);
  });

  it('lists the today view with groups and local dates', async () => {
    const res = await listGET(get('/api/tasks?view=all', aliceCookie));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.items.length).toBeGreaterThan(0);
  });
});

describe('cross-user isolation', () => {
  it("treats another user's task as not found on every route", async () => {
    const t = await makeTask(alice.id, { title: 'Private' });
    expect((await detailGET(get(`/api/tasks/${t.id}`, bobCookie), params(t.id))).status).toBe(404);
    expect((await detailPATCH(apiRequest(`/api/tasks/${t.id}`, { version: 1, title: 'pwned' }, { method: 'PATCH', cookie: bobCookie }), params(t.id))).status).toBe(404);
    expect((await detailDELETE(apiRequest(`/api/tasks/${t.id}`, undefined, { method: 'DELETE', cookie: bobCookie }), params(t.id))).status).toBe(404);
    expect((await actionPOST(apiRequest(`/api/tasks/${t.id}/actions`, { action: 'complete' }, { cookie: bobCookie }), params(t.id))).status).toBe(404);
    expect((await historyGET(get(`/api/tasks/${t.id}/history`, bobCookie), params(t.id))).status).toBe(404);
    expect(
      (await bulkPOST(apiRequest('/api/tasks/bulk', { ids: [t.id], change: { complete: true }, mode: 'apply' }, { cookie: bobCookie }))).status,
    ).toBe(404);
    const bobList = await (await listGET(get('/api/tasks?view=all', bobCookie))).json();
    expect(bobList.items.find((i: { task: { id: string } }) => i.task.id === t.id)).toBeUndefined();
  });
});

describe('bulk', () => {
  it('previews then applies with one batch undo', async () => {
    const a = await makeTask(alice.id, { title: 'Bulk A' });
    const b = await makeTask(alice.id, { title: 'Bulk B' });
    const preview = await (await bulkPOST(apiRequest('/api/tasks/bulk', { ids: [a.id, b.id], change: { priority: 3 }, mode: 'preview' }, { cookie: aliceCookie }))).json();
    expect(preview.count).toBe(2);
    const applied = await bulkPOST(apiRequest('/api/tasks/bulk', { ids: [a.id, b.id], change: { priority: 3 }, mode: 'apply', expected: preview.expected }, { cookie: aliceCookie }));
    expect(applied.status).toBe(200);
    const { batchId } = await applied.json();
    const undo = await undoPOST(apiRequest('/api/tasks/undo', { batchId }, { cookie: aliceCookie }));
    expect(undo.status).toBe(200);
    expect((await undo.json()).tasks.every((t: { priority: number }) => t.priority === 0)).toBe(true);
  });
});
