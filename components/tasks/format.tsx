// components/tasks/format.tsx — priority glyphs and due-date meta (docs/07 §11.4).
import { ChevronDown, ChevronUp, ChevronsUp, Equal } from 'lucide-react';
import { addDays } from '@/lib/time';
import { cn } from '@/components/app/cn';
import { formatShortDate } from './capture';
import type { LocalDateTime } from './types';

const GLYPHS = {
  4: { Icon: ChevronsUp, cls: 'text-priority-urgent', label: 'Urgent priority' },
  3: { Icon: ChevronUp, cls: 'text-priority-high', label: 'High priority' },
  2: { Icon: Equal, cls: 'text-priority-medium', label: 'Medium priority' },
  1: { Icon: ChevronDown, cls: 'text-priority-low', label: 'Low priority' },
} as const;

export function PriorityGlyph({ priority, className }: { priority: number; className?: string }) {
  const g = GLYPHS[priority as keyof typeof GLYPHS];
  if (!g) return null;
  return (
    <span className={cn('inline-flex items-center', g.cls, className)} title={g.label}>
      <g.Icon aria-hidden className="size-4" />
      <span className="sr-only">{g.label}</span>
    </span>
  );
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  return formatShortDate(date);
}

export function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
}

export function dueText(due: LocalDateTime, today: string): string {
  const day = dayLabel(due.date, today);
  return due.time ? `${day} ${formatTime12(due.time)}` : day;
}

export function DueMeta({ due, today, overdue, done }: { due: LocalDateTime; today: string; overdue: boolean; done?: boolean }) {
  const text = dueText(due, today);
  return (
    <time
      dateTime={due.time ? `${due.date}T${due.time}` : due.date}
      className={cn(
        'tabular text-meta whitespace-nowrap',
        done ? 'text-subtle-foreground' : overdue ? 'text-danger' : due.date === today ? 'font-medium text-foreground' : 'text-subtle-foreground',
      )}
    >
      {overdue && !done ? `Overdue · ${text}` : text}
    </time>
  );
}

export function groupHeading(group: string, today: string): string {
  switch (group) {
    case 'overdue':
      return 'Overdue';
    case 'today':
      return 'Today';
    case 'later':
      return 'Later';
    case 'INBOX':
      return 'Inbox';
    case 'TODO':
      return 'To do';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'DONE':
      return 'Done';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return /^\d{4}-\d{2}-\d{2}$/.test(group) ? dayLabel(group, today) : group;
  }
}

/** Project.color is a design-token name (docs/03), e.g. "brand" or "chart-2". */
export function projectColor(color: string | null): string {
  return color && /^[a-z][a-z0-9-]{0,31}$/.test(color) ? `var(--${color}, var(--border-strong))` : 'var(--border-strong)';
}
