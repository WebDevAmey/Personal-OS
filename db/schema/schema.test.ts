import { describe, it, expect } from 'vitest';
import { tasks, memories, dailyBriefings, agentRuns, agentActions, integrationAccounts } from './index';

describe('schema exports', () => {
  it('exposes every V1 table', () => {
    expect(tasks).toBeDefined();
    expect(memories).toBeDefined();
    expect(dailyBriefings).toBeDefined();
    expect(agentRuns).toBeDefined();
    expect(agentActions).toBeDefined();
    expect(integrationAccounts).toBeDefined();
  });
});
