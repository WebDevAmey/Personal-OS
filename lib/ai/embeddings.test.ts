import { describe, it, expect, vi, beforeEach } from 'vitest';
import { embed } from './embeddings';

const originalFetch = global.fetch;

beforeEach(() => { global.fetch = originalFetch; });

describe('embed', () => {
  it('returns a 512-dimension vector for voyage-3-lite', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: new Array(512).fill(0.01) }] }),
    }) as unknown as typeof fetch;

    const vector = await embed('remind me to ask Rahul about the API tomorrow');
    expect(vector).toHaveLength(512);
  });

  it('throws when the Voyage API returns an error status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }) as unknown as typeof fetch;
    await expect(embed('anything')).rejects.toThrow('Voyage embedding request failed');
  });
});
