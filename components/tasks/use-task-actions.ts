'use client';
// components/tasks/use-task-actions.ts — complete/reopen/delete/undo with
// toasts and server refresh, shared by lists, the detail sheet and Today.
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { notify } from '@/components/app/toast';
import { ApiError, tasksApi } from './api';
import type { TaskDTO } from './types';

export function useTaskActions() {
  const router = useRouter();

  const undo = useCallback(
    async (token: { eventId: string } | { batchId: string }, label = 'Undone') => {
      try {
        await tasksApi.undo(token);
        notify({ title: label, tone: 'success' });
      } catch (e) {
        notify({ title: "Couldn't undo", description: e instanceof ApiError ? e.message : undefined, tone: 'error' });
      }
      router.refresh();
    },
    [router],
  );

  const fail = useCallback(
    (e: unknown, what: string) => {
      const conflict = e instanceof ApiError && e.isConflict;
      notify({
        title: conflict ? 'This task was changed elsewhere — reloaded' : `Couldn't ${what}`,
        description: !conflict && e instanceof ApiError ? e.message : undefined,
        tone: 'error',
      });
      router.refresh();
    },
    [router],
  );

  const toggleComplete = useCallback(
    async (task: TaskDTO): Promise<TaskDTO | null> => {
      const reopening = task.status === 'DONE' || task.status === 'CANCELLED';
      try {
        const r = await tasksApi.action(task.id, { action: reopening ? 'reopen' : 'complete' });
        const blocked = r.warnings?.includes('BLOCKED_BY_OPEN_DEPENDENCY');
        notify({
          title: reopening ? `Reopened ${task.title}` : `Completed ${task.title}`,
          description: blocked ? 'It was still blocked by an open task.' : undefined,
          tone: 'success',
          action: r.undoEventId ? { label: 'Undo', run: () => undo({ eventId: r.undoEventId! }) } : undefined,
        });
        router.refresh();
        return r.task;
      } catch (e) {
        fail(e, reopening ? 'reopen the task' : 'complete the task');
        return null;
      }
    },
    [fail, router, undo],
  );

  const remove = useCallback(
    async (task: TaskDTO) => {
      try {
        const r = await tasksApi.remove(task.id, task.version);
        notify({
          title: `Deleted ${task.title}`,
          description: 'You can restore it for 30 days.',
          tone: 'success',
          action: r.undoEventId ? { label: 'Undo', run: () => undo({ eventId: r.undoEventId! }, 'Restored') } : undefined,
        });
        router.refresh();
        return true;
      } catch (e) {
        fail(e, 'delete the task');
        return false;
      }
    },
    [fail, router, undo],
  );

  return { toggleComplete, remove, undo, fail, refresh: router.refresh };
}
