// Integration tests for the projects, preferences, memory and integrations
// UI routes: 401, CSRF 403, validation 400, cross-user 404, happy paths.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSessionCookie } from '@/lib/auth/session';
import { apiRequest } from '@/lib/auth/test-helpers';
import { deleteUsers, makeUser, testPrisma } from '@/lib/test/factories';
import type { User } from '@/lib/generated/prisma/client';
import { GET as projectsGET, POST as projectsPOST } from '@/app/api/projects/route';
import { GET as projectGET, PATCH as projectPATCH, DELETE as projectDELETE } from '@/app/api/projects/[id]/route';
import { GET as prefsGET, PATCH as prefsPATCH } from './route';
import { GET as memoryGET, POST as memoryPOST } from '@/app/api/memory/route';
import { PATCH as memoryPATCH, DELETE as memoryDELETE, POST as memoryRestore } from '@/app/api/memory/[id]/route';
import { GET as integrationsGET } from '@/app/api/integrations/route';
import { DELETE as googleDELETE } from '@/app/api/integrations/google/route';

let alice: User;
let bob: User;
let a: string;
let b: string;

beforeAll(async () => {
  alice = await makeUser({ label: 'set_alice' });
  bob = await makeUser({ label: 'set_bob' });
  a = (await createSessionCookie(alice)).split(';')[0];
  b = (await createSessionCookie(bob)).split(';')[0];
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await deleteUsers(alice, bob);
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (path: string, cookie?: string) => apiRequest(path, undefined, { method: 'GET', cookie });

describe('projects', () => {
  it('requires a session and same-origin writes', async () => {
    expect((await projectsGET(get('/api/projects'))).status).toBe(401);
    expect((await projectsPOST(apiRequest('/api/projects', { name: 'X' }, { cookie: a, origin: 'https://evil.example' }))).status).toBe(403);
  });

  it('validates input', async () => {
    expect((await projectsPOST(apiRequest('/api/projects', { name: '' }, { cookie: a }))).status).toBe(400);
    expect((await projectsPOST(apiRequest('/api/projects', { name: 'x'.repeat(101) }, { cookie: a }))).status).toBe(400);
  });

  it('creates, renames and hides another user’s project', async () => {
    const created = await projectsPOST(apiRequest('/api/projects', { name: 'Health' }, { cookie: a }));
    expect(created.status).toBe(201);
    const { project } = await created.json();
    const dup = await projectsPOST(apiRequest('/api/projects', { name: 'health' }, { cookie: a }));
    expect(dup.status).toBe(409);

    const renamed = await projectPATCH(apiRequest(`/api/projects/${project.id}`, { version: project.version, name: 'Wellbeing' }, { method: 'PATCH', cookie: a }), params(project.id));
    expect((await renamed.json()).project.name).toBe('Wellbeing');

    expect((await projectGET(get(`/api/projects/${project.id}`, b), params(project.id))).status).toBe(404);
    expect((await projectPATCH(apiRequest(`/api/projects/${project.id}`, { version: 2, name: 'x' }, { method: 'PATCH', cookie: b }), params(project.id))).status).toBe(404);
    expect((await projectDELETE(apiRequest(`/api/projects/${project.id}?version=2`, undefined, { method: 'DELETE', cookie: b }), params(project.id))).status).toBe(404);
    const bobList = await (await projectsGET(get('/api/projects', b))).json();
    expect(bobList.projects).toEqual([]);
  });
});

describe('preferences', () => {
  it('requires a session', async () => {
    expect((await prefsGET(get('/api/preferences'))).status).toBe(401);
  });

  it('updates known fields and rejects unknown or invalid ones', async () => {
    const ok = await prefsPATCH(apiRequest('/api/preferences', { lunchEndsAt: '13:30', speechOutputEnabled: true, timeZone: 'Europe/London' }, { method: 'PATCH', cookie: a }));
    expect(ok.status).toBe(200);
    const { preferences } = await ok.json();
    expect(preferences).toMatchObject({ lunchEndsAt: '13:30', speechOutputEnabled: true, timeZone: 'Europe/London' });

    expect((await prefsPATCH(apiRequest('/api/preferences', { lunchEndsAt: '25:00' }, { method: 'PATCH', cookie: a }))).status).toBe(400);
    expect((await prefsPATCH(apiRequest('/api/preferences', { timeZone: 'Mars/Olympus' }, { method: 'PATCH', cookie: a }))).status).toBe(400);
    expect((await prefsPATCH(apiRequest('/api/preferences', { sessionVersion: 0 }, { method: 'PATCH', cookie: a }))).status).toBe(400);
    expect((await prefsPATCH(apiRequest('/api/preferences', { briefingHour: 2 }, { method: 'PATCH', cookie: a }))).status).toBe(400);
  });

  it('keeps each user’s preferences separate', async () => {
    const bobs = await (await prefsGET(get('/api/preferences', b))).json();
    expect(bobs.preferences.lunchEndsAt).toBeNull();
  });

  it('rejects cross-site preference writes', async () => {
    expect((await prefsPATCH(apiRequest('/api/preferences', { lunchEndsAt: '12:00' }, { method: 'PATCH', cookie: a, origin: 'https://evil.example' }))).status).toBe(403);
  });
});

describe('memory', () => {
  it('requires a session and validates content', async () => {
    expect((await memoryGET(get('/api/memory'))).status).toBe(401);
    expect((await memoryPOST(apiRequest('/api/memory', { content: '' }, { cookie: a }))).status).toBe(400);
    expect((await memoryPOST(apiRequest('/api/memory', { content: 'x'.repeat(4001) }, { cookie: a }))).status).toBe(400);
  });

  it('saves, edits, deletes and restores; other users get 404', async () => {
    const res = await memoryPOST(apiRequest('/api/memory', { content: 'Wifi password is in the blue notebook' }, { cookie: a }));
    expect(res.status).toBe(201);
    const { memory } = await res.json();
    expect(memory.embedded).toBe(false);

    expect((await memoryPATCH(apiRequest(`/api/memory/${memory.id}`, { content: 'stolen' }, { method: 'PATCH', cookie: b }), params(memory.id))).status).toBe(404);
    expect((await memoryDELETE(apiRequest(`/api/memory/${memory.id}`, undefined, { method: 'DELETE', cookie: b }), params(memory.id))).status).toBe(404);

    const edited = await memoryPATCH(apiRequest(`/api/memory/${memory.id}`, { content: 'Wifi password: blue notebook, top shelf' }, { method: 'PATCH', cookie: a }), params(memory.id));
    expect((await edited.json()).memory.content).toContain('top shelf');

    expect((await memoryDELETE(apiRequest(`/api/memory/${memory.id}`, undefined, { method: 'DELETE', cookie: a }), params(memory.id))).status).toBe(200);
    const listed = await (await memoryGET(get('/api/memory', a))).json();
    expect(listed.items.find((m: { id: string }) => m.id === memory.id)).toBeUndefined();
    expect((await memoryRestore(apiRequest(`/api/memory/${memory.id}`, undefined, { cookie: a }), params(memory.id))).status).toBe(200);

    const filtered = await (await memoryGET(get('/api/memory?q=notebook', a))).json();
    expect(filtered.items).toHaveLength(1);
    const bobs = await (await memoryGET(get('/api/memory?q=notebook', b))).json();
    expect(bobs.items).toHaveLength(0);
  });
});

describe('integrations', () => {
  it('reports not connected, then connected with plain-language scopes', async () => {
    expect((await integrationsGET(get('/api/integrations'))).status).toBe(401);
    let body = await (await integrationsGET(get('/api/integrations', a))).json();
    expect(body.integrations[0].state).toBe('not_connected');

    await testPrisma.integrationAccount.create({
      data: {
        userId: alice.id,
        provider: 'google',
        accountEmail: 'alice@gmail.test',
        accessToken: 'plain-legacy-token',
        refreshToken: 'plain-legacy-refresh',
        scopes: 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly',
      },
    });
    body = await (await integrationsGET(get('/api/integrations', a))).json();
    expect(body.integrations[0]).toMatchObject({ state: 'limited', accountEmail: 'alice@gmail.test', granted: ['Read email', 'Read calendar'], missing: ['Create drafts'] });
    // Bob sees nothing of Alice's account.
    expect((await (await integrationsGET(get('/api/integrations', b))).json()).integrations[0].state).toBe('not_connected');
  });

  it('keeps the row when Google cannot be reached, deletes it after revocation', async () => {
    expect((await googleDELETE(apiRequest('/api/integrations/google', undefined, { method: 'DELETE', cookie: a, origin: 'https://evil.example' }))).status).toBe(403);

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    const failed = await googleDELETE(apiRequest('/api/integrations/google', undefined, { method: 'DELETE', cookie: a }));
    expect(failed.status).toBe(503);
    expect(await testPrisma.integrationAccount.count({ where: { userId: alice.id } })).toBe(1);

    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await googleDELETE(apiRequest('/api/integrations/google', undefined, { method: 'DELETE', cookie: a }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).integration.state).toBe('not_connected');
    expect(fetchMock).toHaveBeenCalledWith('https://oauth2.googleapis.com/revoke', expect.anything());
    expect(await testPrisma.integrationAccount.count({ where: { userId: alice.id } })).toBe(0);
  });
});
