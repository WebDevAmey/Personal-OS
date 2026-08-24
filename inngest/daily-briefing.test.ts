import { describe, it, expect, vi } from 'vitest';
import { generateBriefing } from './daily-briefing';

vi.mock('@/lib/tasks/queries', () => ({ searchTasks: vi.fn().mockResolvedValue([{ title: 'Finish assembler assignment', dueDate: new Date('2026-08-24') }]) }));

const mockGenerateObject = vi.fn().mockResolvedValue({
  object: { attentionItems: ['Finish assembler assignment'], digestItems: ['Speculative decoding trended today'] },
});
vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateObject: (...args: Parameters<typeof actual.generateObject>) => mockGenerateObject(...args) };
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

  // Finding 7: generateBriefing must use generateObject (schema-validated)
  // instead of generateText + JSON.parse, which was fragile against markdown
  // code fences/leading prose/truncation and burned duplicate Claude calls
  // on Inngest step retries when parsing failed.
  it('calls generateObject with a zod schema and returns result.object directly, without any JSON.parse', async () => {
    await generateBriefing({
      userId: 'user-1',
      email: { search: vi.fn().mockResolvedValue([]), read: vi.fn(), draft: vi.fn() },
      calendar: { search: vi.fn().mockResolvedValue([]) },
    });

    expect(mockGenerateObject).toHaveBeenCalledWith(expect.objectContaining({
      schema: expect.anything(),
    }));
  });
});
