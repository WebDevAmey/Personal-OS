import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskList } from './task-list';
import type { TaskDTO, TaskListItemDTO } from './types';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/tasks',
  useSearchParams: () => new URLSearchParams(),
}));

const TODAY = '2026-10-22';

function task(id: string, title: string, over: Partial<TaskDTO> = {}): TaskDTO {
  return {
    id,
    title,
    description: null,
    status: 'TODO',
    priority: 0,
    dueAt: null,
    dueHasTime: false,
    due: null,
    start: null,
    estimateMinutes: null,
    projectId: null,
    parentId: null,
    tags: [],
    recurrenceRule: null,
    recurrenceText: null,
    snoozedUntil: null,
    source: 'MANUAL',
    sourceRef: null,
    completedAt: null,
    deletedAt: null,
    version: 1,
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
    isOverdue: false,
    isDueToday: false,
    ...over,
  } as TaskDTO;
}

const items: TaskListItemDTO[] = [
  { task: task('t1', 'Reply to recruiter', { due: { date: TODAY, time: null }, isDueToday: true, priority: 3 }), group: 'today' },
  { task: task('t2', 'Book dentist'), group: 'later' },
  { task: task('t3', 'Renew passport'), group: 'later' },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  refresh.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

function rows() {
  return screen.getAllByRole('listitem').filter((el) => el.hasAttribute('data-task-id'));
}

describe('TaskList', () => {
  it('renders titles, due text and group headings', () => {
    render(<TaskList items={items} today={TODAY} label="All tasks" grouped />);
    expect(screen.getByText('Reply to recruiter')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Today/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Later/ })).toBeInTheDocument();
    expect(screen.getByText('High priority')).toBeInTheDocument();
  });

  it('shows the empty state when there are no tasks', () => {
    render(<TaskList items={[]} today={TODAY} label="All tasks" empty={<p>Nothing on your list</p>} />);
    expect(screen.getByText(/nothing on your list/i)).toBeInTheDocument();
  });

  it('moves the roving focus with J/K and arrow keys', () => {
    render(<TaskList items={items} today={TODAY} label="All tasks" />);
    const [r1, r2, r3] = rows();
    expect(r1).toHaveAttribute('tabindex', '0');
    act(() => r1.focus());
    fireEvent.keyDown(r1, { key: 'j' });
    expect(document.activeElement).toBe(r2);
    fireEvent.keyDown(r2, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(r3);
    fireEvent.keyDown(r3, { key: 'k' });
    expect(document.activeElement).toBe(r2);
    fireEvent.keyDown(r2, { key: 'Home' });
    expect(document.activeElement).toBe(r1);
    fireEvent.keyDown(r1, { key: 'End' });
    expect(document.activeElement).toBe(r3);
  });

  it('opens the focused task with Enter and a field with D', () => {
    const onOpen = vi.fn();
    render(<TaskList items={items} today={TODAY} label="All tasks" onOpen={onOpen} />);
    const [r1] = rows();
    act(() => r1.focus());
    fireEvent.keyDown(r1, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('t1', undefined);
    fireEvent.keyDown(r1, { key: 'd' });
    expect(onOpen).toHaveBeenCalledWith('t1', 'due');
  });

  it('selects with X and shows the bulk toolbar, Esc clears it', () => {
    render(<TaskList items={items} today={TODAY} label="All tasks" />);
    const [r1, r2] = rows();
    act(() => r1.focus());
    fireEvent.keyDown(r1, { key: 'x' });
    fireEvent.keyDown(r1, { key: 'J', shiftKey: true });
    const toolbar = screen.getByRole('toolbar');
    expect(within(toolbar).getByText(/2 selected/i)).toBeInTheDocument();
    fireEvent.keyDown(r2, { key: 'Escape' });
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('completes the focused task with E optimistically and calls the action route', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ task: { ...items[0].task, status: 'DONE', version: 2 }, undoEventId: 'ev1' }));
    render(<TaskList items={items} today={TODAY} label="All tasks" />);
    const [r1] = rows();
    act(() => r1.focus());
    fireEvent.keyDown(r1, { key: 'e' });
    expect(within(r1).getByRole('checkbox', { name: /reopen reply to recruiter/i })).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/tasks/t1/actions');
    expect(JSON.parse(init.body)).toMatchObject({ action: 'complete' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('rolls back the optimistic completion when the server refuses', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Nope', code: 'INTERNAL' }, 500));
    render(<TaskList items={items} today={TODAY} label="All tasks" />);
    const [r1] = rows();
    act(() => r1.focus());
    fireEvent.keyDown(r1, { key: ' ' });
    await waitFor(() =>
      expect(within(r1).getByRole('checkbox', { name: /complete reply to recruiter/i })).toHaveAttribute('aria-checked', 'false'),
    );
  });

  it('asks for confirmation before deleting, listing the affected titles', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ count: 1, titles: ['Book dentist'], expected: [{ id: 't2', version: 1 }] }));
    render(<TaskList items={items} today={TODAY} label="All tasks" />);
    const [, r2] = rows();
    act(() => r2.focus());
    fireEvent.keyDown(r2, { key: 'Delete' });
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Book dentist')).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ ids: ['t2'], mode: 'preview' });
    fetchMock.mockResolvedValueOnce(jsonResponse({ batchId: 'b1', tasks: [items[1].task] }));
    fireEvent.click(within(dialog).getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ ids: ['t2'], mode: 'apply', expected: [{ id: 't2', version: 1 }] });
  });
});
