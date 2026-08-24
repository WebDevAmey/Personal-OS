import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebCapability } from './client';

const originalFetch = global.fetch;
beforeEach(() => { global.fetch = originalFetch; });

describe('createWebCapability', () => {
  it('searches via the Tavily API and maps results', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: 'Speculative Decoding explained', url: 'https://example.com/spec-decoding', content: 'A technique that...' }] }),
    }) as unknown as typeof fetch;

    const web = createWebCapability('fake-tavily-key');
    const results = await web.search('speculative decoding');

    expect(results).toEqual([{ title: 'Speculative Decoding explained', url: 'https://example.com/spec-decoding', snippet: 'A technique that...' }]);
  });

  it('reads full page content via the Tavily extract endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ raw_content: 'Full article text.' }] }),
    }) as unknown as typeof fetch;

    const web = createWebCapability('fake-tavily-key');
    const content = await web.read('https://example.com/spec-decoding');
    expect(content).toBe('Full article text.');
  });

  it('throws error on failed search request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }) as unknown as typeof fetch;

    const web = createWebCapability('invalid-key');
    await expect(web.search('test')).rejects.toThrow('Tavily search failed: 401');
  });

  it('throws error on failed extract request', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as unknown as typeof fetch;

    const web = createWebCapability('fake-key');
    await expect(web.read('https://example.com')).rejects.toThrow('Tavily extract failed: 500');
  });

  it('returns empty string when extract has no results', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [] }),
    }) as unknown as typeof fetch;

    const web = createWebCapability('fake-key');
    const content = await web.read('https://example.com');
    expect(content).toBe('');
  });
});
