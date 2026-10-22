import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import type { User } from '@/lib/generated/prisma/client';
import { deleteUsers, makeUser, testPrisma as prisma } from '@/lib/test/factories';
import { createTask, updateTask, completeTask, deleteTask, searchTasks } from './queries';

// Compatibility adapter over lib/tasks/repo.ts: same signatures and return
// shape as the Drizzle-era module, now backed by Prisma.
let A: User;
let B: User;

beforeEach(async () => {
  await deleteUsers(A, B);
  A = await makeUser({ label: 'compat_a' });
  B = await makeUser({ label: 'compat_b' });
});

afterAll(async () => deleteUsers(A, B));

describe('tasks domain library (compat adapter)', () => {
  it('creates a task owned by the given user', async () => {
    const task = await createTask(A.id, { title: 'Finish assembler assignment' });
    expect(task.userId).toBe(A.id);
    expect(task.title).toBe('Finish assembler assignment');
    expect(task.status).toBe('open');
  });

  it('updates the due date of a task the user owns', async () => {
    const task = await createTask(A.id, { title: 'Reply to recruiter' });
    const friday = new Date('2026-08-28T00:00:00Z');
    const updated = await updateTask(A.id, task.id, { dueDate: friday });
    expect(updated.dueDate).toEqual(friday);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.dueHasTime).toBe(false);
  });

  it('keeps a timed due date as timed', async () => {
    const at = new Date('2026-08-28T15:30:00Z');
    const task = await createTask(A.id, { title: 'Call', dueDate: at, notes: 'bring numbers' });
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row).toMatchObject({ dueHasTime: true, description: 'bring numbers' });
    expect(task.notes).toBe('bring numbers');
  });

  it('refuses to update a task owned by a different user', async () => {
    const task = await createTask(A.id, { title: 'Private task' });
    await expect(updateTask(B.id, task.id, { title: 'hijacked' })).rejects.toThrow();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).title).toBe('Private task');
  });

  it('marks a task completed and stamps completedAt', async () => {
    const task = await createTask(A.id, { title: 'Review Figma prototype' });
    const completed = await completeTask(A.id, task.id);
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).not.toBeNull();
  });

  it('soft-deletes a task (deletedAt set, reported as deleted)', async () => {
    const task = await createTask(A.id, { title: 'Old task' });
    await deleteTask(A.id, task.id);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.deletedAt).not.toBeNull();
    const deleted = await searchTasks(A.id, { status: 'deleted' });
    expect(deleted.map((t) => t.id)).toEqual([task.id]);
    expect(deleted[0].status).toBe('deleted');
    expect(await searchTasks(A.id, {})).toHaveLength(0);
  });

  it("searches only within the calling user's tasks", async () => {
    await createTask(A.id, { title: 'Task for A' });
    await createTask(B.id, { title: 'Task for B' });
    const results = await searchTasks(A.id, {});
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Task for A');
  });

  it('filters by status, text and dueBefore (inclusive)', async () => {
    const due = new Date('2026-09-01T00:00:00Z');
    const t1 = await createTask(A.id, { title: 'Pay invoice', dueDate: due });
    const t2 = await createTask(A.id, { title: 'Water plants', dueDate: new Date('2026-09-05T00:00:00Z') });
    await completeTask(A.id, t2.id);
    expect((await searchTasks(A.id, { status: 'open' })).map((t) => t.id)).toEqual([t1.id]);
    expect((await searchTasks(A.id, { status: 'completed' })).map((t) => t.id)).toEqual([t2.id]);
    expect((await searchTasks(A.id, { query: 'invoice' })).map((t) => t.id)).toEqual([t1.id]);
    expect((await searchTasks(A.id, { dueBefore: due })).map((t) => t.id)).toEqual([t1.id]);
  });
});
