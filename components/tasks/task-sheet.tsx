'use client';
// components/tasks/task-sheet.tsx — the task detail as a side sheet driven
// by `?task=<id>` (and `?field=` to focus one control), so any list, the
// palette or a briefing source chip can open it and Back closes it.
import { useId } from 'react';
import { useSearchParams } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { Maximize2, X } from 'lucide-react';
import Link from 'next/link';
import { useApp } from '@/components/app/app-context';
import { TaskDetail } from './task-detail';

const iconBtn =
  'grid size-8 place-items-center rounded-md text-subtle-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring';

export function TaskSheet() {
  const params = useSearchParams();
  const app = useApp();
  const taskId = params.get('task');
  const field = params.get('field');
  const titleId = useId();
  return (
    <Dialog.Root open={Boolean(taskId)} onOpenChange={(open) => !open && app.closeTask()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/10 transition-opacity duration-180 data-ending-style:opacity-0 data-starting-style:opacity-0 md:bg-black/5 dark:bg-black/40" />
        <Dialog.Popup
          aria-labelledby={titleId}
          className="fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-y-auto bg-surface shadow-overlay outline-none transition-transform duration-240 ease-out data-ending-style:translate-x-full data-starting-style:translate-x-full sm:w-[var(--sheet-w)]"
        >
          {taskId && (
            <TaskDetail
              key={taskId}
              taskId={taskId}
              field={field}
              titleId={titleId}
              onDeleted={() => app.closeTask()}
              headerEnd={
                <>
                  <Link href={`/tasks/${encodeURIComponent(taskId)}`} className={iconBtn} aria-label="Open as a page" title="Open as a page">
                    <Maximize2 aria-hidden className="size-4" />
                  </Link>
                  <Dialog.Close className={iconBtn} aria-label="Close task">
                    <X aria-hidden className="size-4" />
                  </Dialog.Close>
                </>
              }
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
