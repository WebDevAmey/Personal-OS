import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import type { BriefingItem, TodayBriefing } from '@/lib/briefing/types';
import { PaletteProvider } from '@/components/command/palette-provider';
import { BriefingPanel, POLL_INTERVAL_MS, POLL_LIMIT_MS, type BriefingPanelProps } from './briefing-panel';

const refresh = vi.fn();
const router = { refresh, push: vi.fn(), replace: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/today',
  useSearchParams: () => new URLSearchParams(),
}));

const TODAY = '2026-10-22';

const items: BriefingItem[] = [
  {
    id: 'i1',
    kind: 'task',
    title: 'Finish Q3 report',
    reason: 'Due today · High priority',
    priority: 'high',
    isInferred: false,
    sources: [{ type: 'task', id: 'task_q3', label: 'Finish Q3 report' }],
    suggestedCommand: 'Move the Q3 report to tomorrow',
  },
  {
    id: 'i2',
    kind: 'email',
    title: 'Reply to Jordan Lee',
    reason: 'Unread since Tue; asks for two call times this week.',
    priority: 'medium',
    isInferred: true,
    sources: [{ type: 'email', id: '18f2a9c0d1e2', label: 'Jordan Lee · Next steps' }],
  },
];

function ready(over: Partial<NonNullable<TodayBriefing['briefing']>> = {}, status: TodayBriefing['status'] = 'ready'): TodayBriefing {
  return { status, briefing: { localDate: TODAY, generatedAt: '2026-10-22T06:31:00.000Z', isStale: false, partialSources: [], items, ...over } };
}

function renderPanel(props: Partial<BriefingPanelProps> = {}) {
  return render(
    <PaletteProvider>
      <BriefingPanel result={ready()} today={TODAY} google="connected" taskStates={{}} {...props} />
    </PaletteProvider>,
  );
}

beforeEach(() => refresh.mockClear());
afterEach(() => vi.useRealTimers());

describe('BriefingPanel', () => {
  it('renders items with always-visible sources and labels inference', () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Finish Q3 report' })).toBeInTheDocument();
    const inferred = screen.getByText('Inferred');
    expect(inferred).toHaveAccessibleDescription(/concluded this from the sources below/i);
    // The fact item carries no Inferred badge.
    expect(screen.getAllByText('Inferred')).toHaveLength(1);
    const email = screen.getByRole('link', { name: /gmail: jordan lee · next steps/i });
    expect(email).toHaveAttribute('target', '_blank');
    expect(email).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(screen.getByRole('button', { name: /task: finish q3 report/i })).toBeInTheDocument();
  });

  it('marks items whose task was completed since the briefing', () => {
    renderPanel({ taskStates: { task_q3: { status: 'DONE', due: null, deleted: false } } });
    expect(screen.getByText(/done since briefing/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /move the q3 report/i })).not.toBeInTheDocument();
  });

  it('shows the partial-source banner and a stale notice', () => {
    renderPanel({ result: ready({ partialSources: ['calendar'], isStale: true }) });
    const banners = screen.getAllByRole('status');
    expect(banners.some((b) => /google calendar couldn.t be reached/i.test(b.textContent ?? ''))).toBe(true);
    expect(screen.getByText(/may be out of date/i)).toBeInTheDocument();
  });

  it('shows the Connect Google card from the integration status, not from an item', () => {
    renderPanel({ google: 'not_connected', result: { status: 'ready', briefing: { ...ready().briefing!, items: [] } } });
    expect(screen.getByText(/connect google to include email and calendar/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect' })).toHaveAttribute('href', '/api/auth/google');
    expect(screen.getByText(/nothing needs you right now/i)).toBeInTheDocument();
  });

  it('shows a retry when the run failed', () => {
    renderPanel({ result: { status: 'failed' } });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t prepare today.s briefing/i);
    expect(within(alert).getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('polls every 3 s while preparing and stops after 90 s', () => {
    vi.useFakeTimers();
    renderPanel({ result: { status: 'preparing' } });
    expect(screen.getByText(/preparing your briefing/i)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(POLL_INTERVAL_MS * 3));
    expect(refresh).toHaveBeenCalledTimes(3);
    act(() => vi.advanceTimersByTime(POLL_LIMIT_MS));
    const calls = refresh.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(POLL_LIMIT_MS / POLL_INTERVAL_MS);
    expect(screen.getByText(/taking longer than usual/i)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(POLL_INTERVAL_MS * 5));
    expect(refresh).toHaveBeenCalledTimes(calls);
  });
});
