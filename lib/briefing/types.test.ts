import { describe, expect, it } from 'vitest';
import { BriefingRequestedSchema, dedupeKeyFor } from './types';

const valid = { userId: 'user_a', localDate: '2026-10-22', dedupeKey: 'user_a-2026-10-22', trigger: 'SCHEDULED' };

describe('BriefingRequestedSchema (ARCH-005)', () => {
  it('accepts a well-formed first-run and retry payload', () => {
    expect(BriefingRequestedSchema.safeParse(valid).success).toBe(true);
    expect(BriefingRequestedSchema.safeParse({ ...valid, dedupeKey: dedupeKeyFor('user_a', '2026-10-22', 2), trigger: 'RETRY' }).success).toBe(true);
  });

  it.each([
    ['missing userId', { ...valid, userId: undefined }],
    ['userId with SQL/odd characters', { ...valid, userId: "a' OR 1=1 --" }],
    ['userId as array', { ...valid, userId: ['user_a', 'user_b'] }],
    ['impossible date', { ...valid, localDate: '2026-02-30', dedupeKey: 'user_a-2026-02-30' }],
    ['ISO timestamp instead of local date', { ...valid, localDate: '2026-10-22T06:30:00Z' }],
    ['dedupeKey for another user', { ...valid, dedupeKey: 'user_b-2026-10-22' }],
    ['unknown trigger', { ...valid, trigger: 'MANUAL' }],
    ['extra keys (e.g. smuggled token)', { ...valid, accessToken: 'ya29.x' }],
    ['not an object', 'user_a'],
  ])('rejects %s', (_label, payload) => {
    expect(BriefingRequestedSchema.safeParse(payload).success).toBe(false);
  });
});
