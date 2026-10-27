'use client';
// components/tasks/task-page.tsx — the task detail as a full page
// (/tasks/:id), for links and narrow screens.
import { useRouter } from 'next/navigation';
import { TaskDetail } from './task-detail';

export function TaskPage({ taskId, field }: { taskId: string; field?: string | null }) {
  const router = useRouter();
  return (
    <div className="rounded-xl bg-surface shadow-card">
      <TaskDetail taskId={taskId} field={field} onDeleted={() => router.push('/tasks')} />
    </div>
  );
}
