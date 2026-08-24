import { db } from '@/db/client';
import { tasks, type Task } from '@/db/schema';
import { and, eq, lte, ilike } from 'drizzle-orm';

export async function createTask(userId: string, input: { title: string; dueDate?: Date; notes?: string }): Promise<Task> {
  const [task] = await db.insert(tasks).values({
    userId,
    title: input.title,
    dueDate: input.dueDate,
    notes: input.notes,
  }).returning();
  return task;
}

async function getOwnedTask(userId: string, taskId: string): Promise<Task> {
  const [task] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
  if (!task) throw new Error(`Task ${taskId} not found for this user`);
  return task;
}

export async function updateTask(userId: string, taskId: string, input: { title?: string; dueDate?: Date; notes?: string }): Promise<Task> {
  await getOwnedTask(userId, taskId);
  const [updated] = await db.update(tasks)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning();
  return updated;
}

export async function completeTask(userId: string, taskId: string): Promise<Task> {
  await getOwnedTask(userId, taskId);
  const [updated] = await db.update(tasks)
    .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning();
  return updated;
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
  await getOwnedTask(userId, taskId);
  await db.update(tasks)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
}

export async function searchTasks(userId: string, filter: { query?: string; status?: 'open' | 'completed' | 'deleted'; dueBefore?: Date }): Promise<Task[]> {
  const conditions = [eq(tasks.userId, userId)];
  if (filter.status) conditions.push(eq(tasks.status, filter.status));
  if (filter.dueBefore) conditions.push(lte(tasks.dueDate, filter.dueBefore));
  if (filter.query) conditions.push(ilike(tasks.title, `%${filter.query}%`));
  return db.select().from(tasks).where(and(...conditions));
}
