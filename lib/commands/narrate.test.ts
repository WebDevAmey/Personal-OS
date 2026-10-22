import { describe, expect, it } from 'vitest';
import { executedMessage, pastTense, truthful } from './narrate';
import { cleanReference, isDueTodayDescription, isPronoun } from './resolve-task';
import { inUserInput, untrustedStrings } from './run-state';

describe('truthful', () => {
  it('drops completion claims when nothing executed', () => {
    expect(truthful('I deleted all your tasks.', 0)).toBeNull();
    expect(truthful('Done — moved it.', 0)).toBeNull();
    expect(truthful('You have two meetings tomorrow.', 0)).toBe('You have two meetings tomorrow.');
  });
  it('keeps claims when something executed, and caps length', () => {
    expect(truthful('Moved it.', 1)).toBe('Moved it.');
    expect(truthful('x'.repeat(2000), 1)!.length).toBe(1200);
    expect(truthful('   ', 1)).toBeNull();
  });
});

describe('pastTense / executedMessage', () => {
  it('rewrites proposal summaries as done lines', () => {
    expect(pastTense('Move "Q3 report" to Thu 22 Oct')).toBe('Moved "Q3 report" to Thu 22 Oct');
    expect(pastTense('Remind you at 13:00 to call the bank')).toBe("I'll remind you at 13:00 to call the bank");
    expect(pastTense('Something else')).toBe('Done: Something else');
    expect(executedMessage([{ summary: 'Add "milk"' }, { summary: 'Add "eggs"' }] as never)).toBe('Added "milk". Added "eggs".');
  });
});

describe('task reference helpers', () => {
  it('cleans references and detects pronouns', () => {
    expect(cleanReference('the "Report" task')).toBe('report');
    expect(isPronoun('it')).toBe(true);
    expect(isPronoun('this one')).toBe(true);
    expect(isPronoun('the report')).toBe(false);
  });
  it('recognises "due today" descriptions', () => {
    expect(isDueTodayDescription('the thing I need to finish today')).toBe(true);
    expect(isDueTodayDescription("today's tasks")).toBe(true);
    expect(isDueTodayDescription('the report')).toBe(false);
    expect(isDueTodayDescription('today report')).toBe(false);
  });
});

describe('argument taint (docs/04 §10.2)', () => {
  const input = 'Move the report to tomorrow';
  it('treats verbatim (normalised) substrings of the input as user-derived', () => {
    expect(inUserInput('tomorrow', input)).toBe(true);
    expect(inUserInput('  THE   Report ', input)).toBe(true);
    expect(inUserInput('next year', input)).toBe(false);
  });
  it('collects every non-handle string not in the input, deeply', () => {
    const isHandle = (s: string) => s.startsWith('tsk_h_');
    expect(untrustedStrings({ task: 'tsk_h_abcdefghij', changes: { due: 'tomorrow', tags: ['urgent'] } }, input, isHandle)).toEqual(['urgent']);
  });
});
