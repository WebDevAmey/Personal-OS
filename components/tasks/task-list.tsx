import type { Task } from '@/db/schema';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <p>Nothing on your list. Enjoy it.</p>;
  }
  return (
    <ul className="space-y-2">
      {tasks.map((task) => (
        <li key={task.id}>
          <Card className="p-4 flex items-center justify-between">
            <span>{task.title}</span>
            {task.dueDate && <Badge>{task.dueDate.toLocaleDateString()}</Badge>}
          </Card>
        </li>
      ))}
    </ul>
  );
}
