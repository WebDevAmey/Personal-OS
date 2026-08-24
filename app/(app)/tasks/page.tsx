import { auth } from '@/auth';
import { searchTasks } from '@/lib/tasks/queries';
import { TaskList } from '@/components/tasks/task-list';

export default async function TasksPage() {
  const session = await auth();
  const tasks = await searchTasks(session!.user!.id!, { status: 'open' });
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Tasks</h1>
      <TaskList tasks={tasks} />
    </main>
  );
}
