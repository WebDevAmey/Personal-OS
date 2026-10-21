import { describe, it, expect } from 'vitest';
import { createLogger, redact, REDACTED } from './logger';

describe('redact', () => {
  it('redacts sensitive keys at any depth', () => {
    const out = redact({ user: { password: 'hunter2', accessToken: 'x', name: 'A' }, refresh_token: 'y' }) as { user: Record<string, unknown>; refresh_token: unknown };
    expect(out.user.password).toBe(REDACTED);
    expect(out.user.accessToken).toBe(REDACTED);
    expect(out.user.name).toBe('A');
    expect(out.refresh_token).toBe(REDACTED);
  });

  it('scrubs token-shaped substrings in free text', () => {
    const out = redact('failed with ya29.a0AfH6SMBabc and eyJhbGciOi.eyJzdWIi.sig') as string;
    expect(out).not.toContain('ya29.');
    expect(out).not.toContain('eyJhbGciOi');
  });

  it('truncates long strings and email bodies are dropped by key', () => {
    const out = redact({ body: 'secret email', note: 'a'.repeat(1000) }) as Record<string, string>;
    expect(out.body).toBe(REDACTED);
    expect(out.note.length).toBeLessThanOrEqual(501);
  });

  it('serialises errors without stack traces', () => {
    const out = redact(new Error('boom')) as Record<string, string>;
    expect(out).toEqual({ name: 'Error', message: 'boom' });
  });
});

describe('createLogger', () => {
  it('writes one JSON line with base and event fields', () => {
    const lines: string[] = [];
    const log = createLogger({ correlationId: 'c1' }, (l) => lines.push(l)).child({ userId: 'u1' });
    log.info('task.updated', { taskId: 't1', token: 'abc' });
    const record = JSON.parse(lines[0]);
    expect(record).toMatchObject({ level: 'info', event: 'task.updated', correlationId: 'c1', userId: 'u1', taskId: 't1', token: REDACTED });
  });
});
