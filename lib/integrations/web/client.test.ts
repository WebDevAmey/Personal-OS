// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/lib/observability/logger';
import { IntegrationInputError, ProviderUnavailableError, RateLimitedError } from '../errors';
import { TAVILY_SEARCH_URL, createWebCapability } from './client';

const KEY = 'tvly-secret-api-key-value';
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mockFetch(impl: (...args: unknown[]) => unknown) {
  const fn = vi.fn(impl);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function ok(body: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(body), headers: new Headers() };
}

function fail(status: number, headers: Record<string, string> = {}) {
  return { ok: false, status, text: async () => `error mentioning ${KEY}`, headers: new Headers(headers) };
}

describe('createWebCapability.search', () => {
  it('POSTs to the fixed Tavily endpoint with a timeout and maps results as untrusted', async () => {
    const fetchMock = mockFetch(async () => ok({ results: [{ title: 'Speculative Decoding explained', url: 'https://example.com/spec-decoding', content: 'A technique that...' }] }));

    const results = await createWebCapability(KEY).search('speculative decoding');

    expect(results).toEqual([{ title: 'Speculative Decoding explained', url: 'https://example.com/spec-decoding', snippet: 'A technique that...', untrusted: true }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TAVILY_SEARCH_URL);
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ query: 'speculative decoding', max_results: 5, include_raw_content: false });
    expect(body).not.toHaveProperty('api_key');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
  });

  it('caps result count and truncates snippets and titles', async () => {
    const results = Array.from({ length: 20 }, (_, i) => ({ title: 'T'.repeat(1000), url: `https://example.com/${i}`, content: 'c'.repeat(5000) }));
    mockFetch(async () => ok({ results }));
    const web = createWebCapability(KEY);

    const five = await web.search('x');
    expect(five).toHaveLength(5);
    expect(five[0].snippet.length).toBeLessThanOrEqual(500);
    expect(five[0].title.length).toBeLessThanOrEqual(200);
    expect(await web.search('x', { limit: 99 })).toHaveLength(10);
  });

  it('drops results whose URL is not http(s)', async () => {
    mockFetch(async () => ok({ results: [
      { title: 'a', url: 'javascript:alert(1)', content: 'x' },
      { title: 'b', url: 'file:///etc/passwd', content: 'x' },
      { title: 'c', url: 'https://user:pass@example.com/', content: 'x' },
      { title: 'd', url: 'https://example.com/ok', content: 'x' },
    ] }));
    expect((await createWebCapability(KEY).search('x')).map((r) => r.title)).toEqual(['d']);
  });

  it('rejects empty and over-long queries without a network call', async () => {
    const fetchMock = mockFetch(async () => ok({ results: [] }));
    const web = createWebCapability(KEY);
    await expect(web.search('')).rejects.toBeInstanceOf(IntegrationInputError);
    await expect(web.search('q'.repeat(257))).rejects.toBeInstanceOf(IntegrationInputError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps 5xx and timeouts to retryable ProviderUnavailableError, without leaking the key', async () => {
    const lines: string[] = [];
    const web = createWebCapability(KEY, { logger: createLogger({}, (l) => lines.push(l)) });

    mockFetch(async () => fail(502));
    const e502 = await web.search('x').catch((e: Error) => e);
    expect(e502).toBeInstanceOf(ProviderUnavailableError);
    expect((e502 as ProviderUnavailableError).retryable).toBe(true);

    mockFetch(async () => { throw new DOMException('timed out', 'TimeoutError'); });
    const eTimeout = await web.search('x').catch((e: Error) => e);
    expect(eTimeout).toBeInstanceOf(ProviderUnavailableError);
    expect((eTimeout as ProviderUnavailableError).reason).toBe('timeout');

    for (const err of [e502, eTimeout]) expect(`${(err as Error).message} ${JSON.stringify(err)}`).not.toContain(KEY);
    expect(lines.join('\n')).not.toContain(KEY);
  });

  it('maps 401 to a non-retryable operator error and 429 to RateLimitedError', async () => {
    mockFetch(async () => fail(401));
    const e401 = await createWebCapability(KEY).search('x').catch((e: Error) => e);
    expect(e401).toBeInstanceOf(ProviderUnavailableError);
    expect((e401 as ProviderUnavailableError).retryable).toBe(false);

    mockFetch(async () => fail(429, { 'retry-after': '2' }));
    const e429 = await createWebCapability(KEY).search('x').catch((e: Error) => e);
    expect(e429).toBeInstanceOf(RateLimitedError);
    expect((e429 as RateLimitedError).retryAfterMs).toBe(2000);
  });

  it('exposes no URL-fetching method (no SSRF surface)', () => {
    const web = createWebCapability(KEY) as unknown as Record<string, unknown>;
    expect(Object.keys(web)).toEqual(['search']);
    const code = readFileSync(path.join(process.cwd(), 'lib/integrations/web/client.ts'), 'utf8');
    const fetchTargets = [...code.matchAll(/fetch\(\s*([^,)]+)/g)].map((m) => m[1].trim());
    expect(fetchTargets).toEqual(['TAVILY_SEARCH_URL']);
  });
});
