import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { ToastProvider } from '@/components/app/toast';
import { CommandPalette } from './palette';
import { PaletteProvider, usePalette } from './palette-provider';

const refresh = vi.fn();
const router = { refresh, push: vi.fn(), replace: vi.fn() };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/tasks',
  useSearchParams: () => new URLSearchParams(),
}));

beforeAll(() => {
  // cmdk / Base UI rely on these browser APIs that jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function () {};
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  refresh.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

function Opener() {
  const p = usePalette();
  useEffect(() => p.setOpen(true), []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function renderPalette() {
  render(
    <ToastProvider>
      <PaletteProvider>
        <Opener />
        <CommandPalette />
      </PaletteProvider>
    </ToastProvider>,
  );
  return screen.findByRole('combobox');
}

async function submit(text: string) {
  const input = await screen.findByRole('combobox');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

function bodyOf(call: number) {
  return JSON.parse(fetchMock.mock.calls[call][1].body);
}

const clarification = {
  kind: 'clarification',
  runId: 'run_1',
  message: 'I found two tasks.',
  question: 'Which dentist task?',
  options: [
    { id: 'o1', label: 'Book dentist', detail: 'Due Fri' },
    { id: 'o2', label: 'Pay dentist bill' },
  ],
  allowFreeText: true,
};

describe('CommandPalette', () => {
  it('shows a clarification with option buttons and replies with a new clientRequestId', async () => {
    fetchMock.mockResolvedValueOnce(json(clarification));
    await renderPalette();
    await submit('move the dentist task to friday');
    expect(await screen.findByRole('heading', { name: 'Which dentist task?' })).toBeInTheDocument();
    const first = bodyOf(0);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/command');
    expect(first).toMatchObject({ input: 'move the dentist task to friday', source: 'typed', context: { page: 'tasks' } });
    expect(first.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);

    fetchMock.mockResolvedValueOnce(json({ kind: 'executed', runId: 'run_1', message: 'Moved Book dentist to Fri.', actions: [] }));
    fireEvent.click(screen.getByRole('button', { name: /book dentist/i }));
    await screen.findByText('Moved Book dentist to Fri.');
    const reply = bodyOf(1);
    expect(reply.replyTo).toEqual({ runId: 'run_1', optionId: 'o1' });
    expect(reply.clientRequestId).not.toBe(first.clientRequestId);
  });

  it('confirms a proposal, then undoes the executed action through /api/command/undo', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        kind: 'proposal',
        runId: 'run_2',
        message: 'This deletes 3 tasks.',
        proposal: {
          id: 'prop_1',
          tool: 'bulk_update_tasks',
          risk: 'BULK',
          summary: 'Delete 3 completed tasks',
          diff: [{ entity: 'Old task', field: 'deleted', before: null, after: 'yes' }],
          reasons: ['bulk'],
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
      }),
    );
    await renderPalette();
    await submit('delete my completed tasks');
    const confirm = await screen.findByRole('button', { name: /^confirm/i });
    fetchMock.mockResolvedValueOnce(
      json({
        kind: 'executed',
        runId: 'run_2',
        message: 'Deleted 3 tasks.',
        actions: [{ proposalId: 'prop_1', tool: 'bulk_update_tasks', entity: { type: 'task', id: 't1' }, summary: 'Deleted 3 tasks', undo: { taskEventId: 'ev_9' } }],
      }),
    );
    fireEvent.click(confirm);
    await screen.findByRole('region', { name: 'Done' }, { timeout: 4000 });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/command/confirm');
    expect(bodyOf(1)).toEqual({ proposalId: 'prop_1', decision: 'confirm' });

    fetchMock.mockResolvedValueOnce(json({ kind: 'answer', runId: 'b1', message: 'Undone 3 changes.' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Done' })).getByRole('button', { name: /undo/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls[2][0]).toBe('/api/command/undo');
    expect(bodyOf(2)).toEqual({ taskEventId: 'ev_9' });
  });

  it('cancels a proposal through /api/command/cancel', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        kind: 'proposal',
        runId: 'run_3',
        message: 'Delete this task?',
        proposal: { id: 'prop_2', tool: 'delete_task', risk: 'DESTRUCTIVE', summary: 'Delete Book dentist', diff: [], reasons: ['destructive'], expiresAt: new Date(Date.now() + 600_000).toISOString() },
      }),
    );
    await renderPalette();
    await submit('delete the dentist task');
    const cancel = await screen.findByRole('button', { name: /cancel/i });
    fetchMock.mockResolvedValueOnce(json({ kind: 'answer', runId: 'run_3', message: 'Cancelled — nothing changed.' }));
    fireEvent.click(cancel);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/command/cancel');
    expect(bodyOf(1)).toEqual({ proposalId: 'prop_2' });
  });

  it('shows a rate limit without a Retry button', async () => {
    fetchMock.mockResolvedValueOnce(json({ kind: 'error', error: { code: 'RATE_LIMITED', message: "You've hit the command limit — try again in a minute.", retryable: true } }, 429));
    await renderPalette();
    await submit('what is due today');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/command limit/i);
    expect(within(alert).queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('after a network failure, Retry resends the same clientRequestId', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline')).mockRejectedValueOnce(new TypeError('offline')).mockRejectedValueOnce(new TypeError('offline'));
    await renderPalette();
    await submit('what is due today');
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent(/couldn.t reach personal os/i);
    fetchMock.mockResolvedValueOnce(json({ kind: 'answer', runId: 'run_4', message: 'Two tasks are due today.' }));
    fireEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    await screen.findByText('Two tasks are due today.');
    const ids = fetchMock.mock.calls.map((_, i) => bodyOf(i).clientRequestId);
    expect(new Set(ids).size).toBe(1);
    expect(ids).toHaveLength(4);
  });

  it('maps an oversize input (413) to a clear message without retrying', async () => {
    fetchMock.mockResolvedValueOnce(json({ kind: 'error', error: { code: 'INPUT_TOO_LONG', message: "That's over 2,000 characters — try something shorter.", retryable: false } }, 413));
    await renderPalette();
    await submit('x'.repeat(50));
    expect(await screen.findByRole('alert')).toHaveTextContent(/over 2,000 characters/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('gives each new submission its own clientRequestId', async () => {
    fetchMock.mockResolvedValue(json({ kind: 'answer', runId: 'r', message: 'ok' }));
    await renderPalette();
    await submit('first');
    await screen.findByText('ok');
    await act(async () => {
      await submit('second');
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(0).clientRequestId).not.toBe(bodyOf(1).clientRequestId);
  });
});
