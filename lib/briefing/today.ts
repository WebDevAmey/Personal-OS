// lib/briefing/today.ts — STUB (WS-6b), replaced by the WS-5 implementation
// at merge. It never touches the database: it reports "none" so the Today
// page exercises its "preparing" path, unless BRIEFING_STUB_FIXTURE=1 (local
// screenshots only), which returns a fixed example briefing.
import type { TodayBriefing } from './types';

export async function getTodayBriefing(userId: string, now: Date = new Date()): Promise<TodayBriefing> {
  void userId;
  if (process.env.BRIEFING_STUB_FIXTURE !== '1') return { status: 'none' };
  return {
    status: 'ready',
    briefing: {
      localDate: now.toISOString().slice(0, 10),
      generatedAt: new Date(now.getTime() - 90 * 60 * 1000),
      isStale: false,
      partialSources: ['calendar'],
      items: [
        {
          id: 'b1',
          kind: 'task',
          title: 'Finish Q3 report',
          reason: 'Due today, marked High.',
          priority: 3,
          isInferred: false,
          sources: [{ type: 'task', id: 'task_demo_report', label: 'Finish Q3 report' }],
          suggestedCommand: 'Move the Q3 report to tomorrow',
        },
        {
          id: 'b2',
          kind: 'email',
          title: 'Reply to Jordan Lee',
          reason: 'Unread since Tue 17:42; probably waiting on two call times this week.',
          priority: 2,
          isInferred: true,
          sources: [{ type: 'email', id: '18f2a9c0d1e2', label: 'Next steps — Staff Engineer role' }],
          suggestedCommand: 'Remind me about the recruiter email after lunch',
        },
        {
          id: 'b3',
          kind: 'task',
          title: 'Book dentist appointment',
          reason: 'Overdue since Monday.',
          priority: 2,
          isInferred: false,
          sources: [{ type: 'task', id: 'task_demo_dentist', label: 'Book dentist appointment' }],
        },
      ],
    },
  };
}

export async function ensureTodayBriefingQueued(userId: string, now: Date = new Date()): Promise<void> {
  void userId;
  void now;
}
