import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db/client';
import { tasks, users } from '@/db/schema';
import { createTask, updateTask, completeTask, deleteTask, searchTasks } from './queries';
import { eq } from 'drizzle-orm';

const USER_A = 'user-a';
const USER_B = 'user-b';

beforeEach(async () => {
  await db.delete(tasks);
  await db.delete(users);
  await db.insert(users).values([
    { id: USER_A, email: 'user-a@test.com' },
    { id: USER_B, email: 'user-b@test.com' },
  ]);
});

describe('tasks domain library', () => {
  it('creates a task owned by the given user', async () => {
    const task = await createTask(USER_A, { title: 'Finish assembler assignment' });
    expect(task.userId).toBe(USER_A);
    expect(task.title).toBe('Finish assembler assignment');
    expect(task.status).toBe('open');
  });

  it('updates the due date of a task the user owns', async () => {
    const task = await createTask(USER_A, { title: 'Reply to recruiter' });
    const friday = new Date('2026-08-28T00:00:00Z');
    const updated = await updateTask(USER_A, task.id, { dueDate: friday });
    expect(updated.dueDate).toEqual(friday);
  });

  it('refuses to update a task owned by a different user', async () => {
    const task = await createTask(USER_A, { title: 'Private task' });
    await expect(updateTask(USER_B, task.id, { title: 'hijacked' })).rejects.toThrow();
  });

  it('marks a task completed and stamps completedAt', async () => {
    const task = await createTask(USER_A, { title: 'Review Figma prototype' });
    const completed = await completeTask(USER_A, task.id);
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).not.toBeNull();
  });

  it('soft-deletes a task by setting status to deleted', async () => {
    const task = await createTask(USER_A, { title: 'Old task' });
    await deleteTask(USER_A, task.id);
    const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(row.status).toBe('deleted');
  });

  it('searches only within the calling user\'s tasks', async () => {
    await createTask(USER_A, { title: 'Task for A' });
    await createTask(USER_B, { title: 'Task for B' });
    const results = await searchTasks(USER_A, {});
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Task for A');
  });
});
