import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebCapability } from './client';

const originalFetch = global.fetch;
beforeEach(() => { global.fetch = originalFetch; });

describe('createWebCapability', () => {
  it('searches via the Tavily API and maps results', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: 'Speculative Decoding explained', url: 'https://example.com/spec-decoding', content: 'A technique that...' }] }),
    }) as any;

    const web = createWebCapability('fake-tavily-key');
    const results = await web.search('speculative decoding');

    expect(results).toEqual([{ title: 'Speculative Decoding explained', url: 'https://example.com/spec-decoding', snippet: 'A technique that...' }]);
  });

  it('reads full page content via the Tavily extract endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ raw_content: 'Full article text.' }] }),
    }) as any;

    const web = createWebCapability('fake-tavily-key');
    const content = await web.read('https://example.com/spec-decoding');
    expect(content).toBe('Full article text.');
  });
});
