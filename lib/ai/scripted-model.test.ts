// e2e/fixtures/model-script.ts (used by lib/ai/scripted-model.ts): phrase matching and briefing items from the real prompt shape.
import { describe, expect, it } from 'vitest';
import { wrapUntrusted } from '@/lib/integrations/untrusted';
import { briefingItemsFor, findCommandScript } from '@/e2e/fixtures/model-script';

describe('model script', () => {
  it('matches the acceptance phrase case-insensitively', () => {
    expect(findCommandScript('Move the report to tomorrow')).not.toBeNull();
    expect(findCommandScript('move the report to Friday')).toBeNull();
  });

  it('builds fact items for due/overdue tasks and one inferred item, citing prompt ids only', () => {
    const tasks = [
      { type: 'task', id: 't1', title: 'Finish the "quarterly" report', bucket: 'today', priority: 'high', due: '2026-10-22', status: 'TODO' },
      { type: 'task', id: 't2', title: 'Renew passport', bucket: 'overdue', priority: 'none', due: '2026-10-19', status: 'TODO' },
      { type: 'task', id: 't3', title: 'Plan offsite', bucket: 'upcoming', priority: 'none', due: '2026-10-24', status: 'TODO' },
    ];
    const items = briefingItemsFor(`Tasks:\n\n${wrapUntrusted('task', tasks, { ref: 'tasks' })}`);
    expect(items.map((i) => [i.sources[0].id, i.isInferred])).toEqual([
      ['t1', false],
      ['t2', false],
      ['t3', true],
    ]);
    expect(items[0].title).toBe('Finish the "quarterly" report');
  });
});
