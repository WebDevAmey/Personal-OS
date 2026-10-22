import { describe, expect, it } from 'vitest';
import { decide, type PolicyInput } from './policy';
import { classifyRisk } from './risk';
import type { Risk } from './types';

const base = (risk: Risk, over: Partial<PolicyInput> = {}): PolicyInput => ({
  risk,
  targetCount: risk === 'BULK' ? 3 : 1,
  tainted: false,
  resolution: 'unique',
  inferredFields: [],
  ...over,
});

// docs/04 §8.4: rows = risk, columns = untainted/unique · tainted · inferred value.
const MATRIX: Record<Risk, [string, string, string]> = {
  READ: ['auto', 'auto', 'auto'],
  REVERSIBLE: ['auto', 'confirm', 'auto'],
  CONSEQUENTIAL: ['auto', 'confirm', 'confirm'],
  DESTRUCTIVE: ['confirm', 'confirm', 'confirm'],
  BULK: ['confirm', 'confirm', 'confirm'],
  EXTERNAL: ['confirm', 'confirm', 'confirm'],
};

describe('decide (confirmation policy matrix)', () => {
  for (const [risk, [plain, tainted, inferred]] of Object.entries(MATRIX) as [Risk, [string, string, string]][]) {
    it(`${risk}: untainted → ${plain}, tainted → ${tainted}, inferred → ${inferred}`, () => {
      expect(decide(base(risk)).decision).toBe(plain);
      expect(decide(base(risk, { tainted: true })).decision).toBe(tainted);
      expect(decide(base(risk, { inferredFields: ['defaulted_time'] })).decision).toBe(inferred);
    });
  }

  it('adds untrusted_source to the reasons of any tainted mutation', () => {
    for (const risk of ['REVERSIBLE', 'CONSEQUENTIAL', 'DESTRUCTIVE', 'BULK', 'EXTERNAL'] as Risk[]) {
      const d = decide(base(risk, { tainted: true }));
      expect(d.decision).toBe('confirm');
      if (d.decision === 'confirm') expect(d.reasons).toContain('untrusted_source');
    }
  });

  it('names the static reason for destructive, bulk and external actions', () => {
    expect(decide(base('DESTRUCTIVE'))).toEqual({ decision: 'confirm', reasons: ['destructive'] });
    expect(decide(base('BULK'))).toEqual({ decision: 'confirm', reasons: ['bulk'] });
    expect(decide(base('EXTERNAL', { recipientCount: 1 }))).toEqual({ decision: 'confirm', reasons: ['external'] });
  });

  it('auto-executes a reversible action with an inferred value but marks the note', () => {
    expect(decide(base('REVERSIBLE', { inferredFields: ['dst_shifted'] }))).toEqual({ decision: 'auto', reasons: [], note: 'inferred_value' });
  });

  it('treats any reversible action on more than one entity as BULK (confirm)', () => {
    expect(decide(base('REVERSIBLE', { targetCount: 2 }))).toEqual({ decision: 'confirm', reasons: ['bulk'] });
  });

  it('hard-rejects bulk over 50 targets even untainted', () => {
    expect(decide(base('BULK', { targetCount: 51 }))).toMatchObject({ decision: 'reject', code: 'BULK_LIMIT' });
    expect(decide(base('BULK', { targetCount: 50 })).decision).toBe('confirm');
  });

  it('hard-rejects drafts with more than 10 recipients', () => {
    expect(decide(base('EXTERNAL', { recipientCount: 11 }))).toMatchObject({ decision: 'reject', code: 'TOO_MANY_RECIPIENTS' });
    expect(decide(base('EXTERNAL', { recipientCount: 10 })).decision).toBe('confirm');
  });

  it('hard-rejects targets not owned by the user and expired proposals', () => {
    expect(decide(base('REVERSIBLE', { allTargetsOwned: false }))).toMatchObject({ decision: 'reject', code: 'NOT_OWNED' });
    expect(decide(base('REVERSIBLE', { expired: true }))).toMatchObject({ decision: 'reject', code: 'EXPIRED' });
  });

  it('never executes against an ambiguous or missing resolution', () => {
    expect(decide(base('REVERSIBLE', { resolution: 'ambiguous' }))).toMatchObject({ decision: 'reject', code: 'UNRESOLVED' });
    expect(decide(base('REVERSIBLE', { resolution: 'none' }))).toMatchObject({ decision: 'reject', code: 'UNRESOLVED' });
  });
});

describe('classifyRisk', () => {
  it('uses the static class per tool', () => {
    expect(classifyRisk({ kind: 'task.update', targetCount: 1 })).toBe('REVERSIBLE');
    expect(classifyRisk({ kind: 'task.delete', targetCount: 1 })).toBe('DESTRUCTIVE');
    expect(classifyRisk({ kind: 'email.draft', targetCount: 0 })).toBe('EXTERNAL');
    expect(classifyRisk({ kind: 'memory.save', targetCount: 0 })).toBe('CONSEQUENTIAL');
  });

  it('escalates >1 target to BULK and clearing content to CONSEQUENTIAL', () => {
    expect(classifyRisk({ kind: 'task.complete', targetCount: 2 })).toBe('BULK');
    expect(classifyRisk({ kind: 'task.update', targetCount: 1, clearsContent: true })).toBe('CONSEQUENTIAL');
  });
});
