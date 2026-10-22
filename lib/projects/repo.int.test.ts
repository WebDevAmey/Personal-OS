import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { User } from '@/lib/generated/prisma/client';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/db/errors';
import { deleteUsers, makeTask, makeUser, testPrisma as prisma } from '@/lib/test/factories';
import {
  createProject,
  deleteProject,
  findProjectByName,
  getProject,
  listProjects,
  purgeDeletedProjects,
  restoreProject,
  setProjectArchived,
  updateProject,
} from './repo';

let A: User;
let B: User;

beforeEach(async () => {
  await deleteUsers(A, B);
  A = await makeUser({ label: 'proj_a' });
  B = await makeUser({ label: 'proj_b' });
});

afterAll(async () => deleteUsers(A, B));

describe('project repo', () => {
  it('creates, reads, lists with open-task counts and audits', async () => {
    const p = await createProject(A.id, { name: '  Thesis   writing ', color: 'blue' });
    expect(p).toMatchObject({ userId: A.id, name: 'Thesis writing', color: 'blue', version: 1 });
    await makeTask(A.id, { projectId: p.id, status: 'TODO' });
    await makeTask(A.id, { projectId: p.id, status: 'DONE' });
    await makeTask(A.id, { projectId: p.id, status: 'TODO', deletedAt: new Date() });
    expect((await getProject(A.id, p.id)).id).toBe(p.id);
    const list = await listProjects(A.id);
    expect(list).toHaveLength(1);
    expect(list[0].openTaskCount).toBe(1);
    expect((await findProjectByName(A.id, 'THESIS WRITING'))?.id).toBe(p.id);
    const audit = await prisma.auditEvent.findMany({ where: { userId: A.id, entityId: p.id } });
    expect(audit.map((a) => a.action)).toEqual(['project.create']);
  });

  it('validates name and color', async () => {
    await expect(createProject(A.id, { name: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(createProject(A.id, { name: 'x'.repeat(101) })).rejects.toBeInstanceOf(ValidationError);
    await expect(createProject(A.id, { name: 'ok', color: '#ff0000' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a duplicate active name per user (case-insensitive) but allows it for another user', async () => {
    await createProject(A.id, { name: 'Home' });
    await expect(createProject(A.id, { name: 'home' })).rejects.toMatchObject({ reason: 'NAME_TAKEN' });
    await expect(createProject(B.id, { name: 'Home' })).resolves.toMatchObject({ userId: B.id });
  });

  it('updates with optimistic concurrency', async () => {
    const p = await createProject(A.id, { name: 'Work' });
    const u = await updateProject(A.id, p.id, 1, { name: 'Work stuff', description: 'desc' });
    expect(u).toMatchObject({ name: 'Work stuff', description: 'desc', version: 2 });
    await expect(updateProject(A.id, p.id, 1, { name: 'stale' })).rejects.toMatchObject({ reason: 'VERSION_MISMATCH' });
    const other = await createProject(A.id, { name: 'Other' });
    await expect(updateProject(A.id, other.id, 1, { name: 'WORK STUFF' })).rejects.toMatchObject({ reason: 'NAME_TAKEN' });
  });

  it('archives and unarchives', async () => {
    const p = await createProject(A.id, { name: 'Old' });
    const a = await setProjectArchived(A.id, p.id, 1, true);
    expect(a.archivedAt).not.toBeNull();
    expect(await listProjects(A.id)).toHaveLength(0);
    expect(await listProjects(A.id, { includeArchived: true })).toHaveLength(1);
    const u = await setProjectArchived(A.id, p.id, 2, false);
    expect(u.archivedAt).toBeNull();
  });

  it('soft-deletes (name reusable), restores, and refuses restore when the name is taken', async () => {
    const p = await createProject(A.id, { name: 'Garden' });
    const d = await deleteProject(A.id, p.id, 1);
    expect(d.deletedAt).not.toBeNull();
    await expect(getProject(A.id, p.id)).rejects.toBeInstanceOf(NotFoundError);
    const again = await createProject(A.id, { name: 'Garden' });
    await expect(restoreProject(A.id, p.id, 2)).rejects.toMatchObject({ reason: 'NAME_TAKEN' });
    await deleteProject(A.id, again.id, 1);
    const r = await restoreProject(A.id, p.id, 2);
    expect(r.deletedAt).toBeNull();
  });

  it('purges projects deleted more than 30 days ago and detaches their tasks', async () => {
    const p = await createProject(A.id, { name: 'Ancient' });
    const t = await makeTask(A.id, { projectId: p.id });
    await deleteProject(A.id, p.id, 1, { now: new Date(Date.now() - 31 * 86_400_000) });
    const recent = await createProject(A.id, { name: 'Recent' });
    await deleteProject(A.id, recent.id, 1);
    expect(await purgeDeletedProjects()).toBeGreaterThanOrEqual(1);
    expect(await prisma.project.findUnique({ where: { id: p.id } })).toBeNull();
    expect(await prisma.project.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).projectId).toBeNull();
  });

  describe('cross-user isolation: B cannot read or mutate A’s project', () => {
    const cases: [string, (id: string) => Promise<unknown>][] = [
      ['getProject', (id) => getProject(B.id, id)],
      ['updateProject', (id) => updateProject(B.id, id, 1, { name: 'hijack' })],
      ['setProjectArchived', (id) => setProjectArchived(B.id, id, 1, true)],
      ['deleteProject', (id) => deleteProject(B.id, id, 1)],
      ['restoreProject', (id) => restoreProject(B.id, id, 1)],
    ];
    it.each(cases)('%s → NotFound, row unchanged', async (_name, call) => {
      const p = await createProject(A.id, { name: 'Secret' });
      await expect(call(p.id)).rejects.toBeInstanceOf(NotFoundError);
      const row = await prisma.project.findUniqueOrThrow({ where: { id: p.id } });
      expect(row).toMatchObject({ name: 'Secret', version: 1, archivedAt: null, deletedAt: null });
      expect(await findProjectByName(B.id, 'Secret')).toBeNull();
      expect(await listProjects(B.id)).toHaveLength(0);
    });
  });

  it('ConflictError is a repo error with details', async () => {
    const p = await createProject(A.id, { name: 'C' });
    const err = await updateProject(A.id, p.id, 7, { name: 'D' }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.details).toMatchObject({ currentVersion: 1, expectedVersion: 7 });
  });
});
