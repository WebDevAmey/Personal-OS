import { describe, it, expect, vi } from 'vitest';
import { generateBriefing } from './daily-briefing';

vi.mock('@/lib/tasks/queries', () => ({ searchTasks: vi.fn().mockResolvedValue([{ title: 'Finish assembler assignment', dueDate: new Date('2026-08-24') }]) }));
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: vi.fn().mockResolvedValue({ text: JSON.stringify({ attentionItems: ['Finish assembler assignment'], digestItems: ['Speculative decoding trended today'] }) }) };
});

describe('generateBriefing', () => {
  it('combines email, calendar, and task signals into attention + digest items', async () => {
    const briefing = await generateBriefing({
      userId: 'user-1',
      email: { search: vi.fn().mockResolvedValue([]), read: vi.fn(), draft: vi.fn() },
      calendar: { search: vi.fn().mockResolvedValue([]) },
    });

    expect(briefing.attentionItems).toContain('Finish assembler assignment');
    expect(briefing.digestItems.length).toBeGreaterThan(0);
  });
});
