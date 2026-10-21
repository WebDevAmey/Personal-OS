// lib/integrations/web/client.ts
//
// Tavily web search. The request goes to one fixed endpoint; no caller- or
// model-supplied URL is ever fetched by this server (no SSRF surface), and
// redirects are refused. Results are third-party text: capped, truncated
// and flagged untrusted.
import { logger as defaultLogger, type Logger } from '@/lib/observability/logger';
import {
  IntegrationInputError,
  ProviderUnavailableError,
  RateLimitedError,
  parseRetryAfter,
} from '../errors';
import { clip } from '../text';
import type { WebCapability, WebResult } from '../types';

export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
export const WEB_TIMEOUT_MS = 8_000;
export const DEFAULT_WEB_RESULTS = 5;
export const MAX_WEB_RESULTS = 10;
export const MAX_WEB_QUERY_LENGTH = 256;
export const MAX_WEB_SNIPPET_CHARS = 500;
const MAX_TITLE_CHARS = 200;
const MAX_URL_CHARS = 2_048;
const MAX_RESPONSE_BYTES = 1_000_000;

export interface WebClientOptions {
  timeoutMs?: number;
  logger?: Logger;
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL_CHARS) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function createWebCapability(apiKey: string, opts: WebClientOptions = {}): WebCapability {
  const log = opts.logger ?? defaultLogger;

  return {
    async search(query: string, searchOpts: { limit?: number } = {}): Promise<WebResult[]> {
      const q = typeof query === 'string' ? query.trim() : '';
      if (q.length === 0) throw new IntegrationInputError('tavily', 'query', 'must not be empty');
      if (q.length > MAX_WEB_QUERY_LENGTH) throw new IntegrationInputError('tavily', 'query', `at most ${MAX_WEB_QUERY_LENGTH} characters`);
      if (!apiKey) throw new ProviderUnavailableError('tavily', { retryable: false, reason: 'not_configured', operation: 'search' });
      const limit = searchOpts.limit === undefined || !Number.isFinite(searchOpts.limit)
        ? DEFAULT_WEB_RESULTS
        : Math.min(MAX_WEB_RESULTS, Math.max(1, Math.floor(searchOpts.limit)));

      let res: Response;
      try {
        res = await fetch(TAVILY_SEARCH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            query: q,
            max_results: limit,
            search_depth: 'basic',
            include_answer: false,
            include_raw_content: false,
            include_images: false,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(opts.timeoutMs ?? WEB_TIMEOUT_MS),
        });
      } catch (err) {
        const reason = ['AbortError', 'TimeoutError'].includes((err as Error)?.name) ? 'timeout' : 'network';
        log.warn('integration.web.search_failed', { reason });
        throw new ProviderUnavailableError('tavily', { retryable: true, reason, operation: 'search' });
      }

      if (!res.ok) {
        log.warn('integration.web.search_failed', { status: res.status });
        if (res.status === 429) throw new RateLimitedError('tavily', parseRetryAfter(res.headers?.get?.('retry-after')));
        throw new ProviderUnavailableError('tavily', {
          retryable: res.status >= 500,
          status: res.status,
          // 401/403 is our API key, not the user's grant: an operator problem.
          reason: res.status === 401 || res.status === 403 ? 'auth_rejected' : res.status >= 500 ? 'server_error' : 'request_rejected',
          operation: 'search',
        });
      }

      let json: { results?: unknown };
      try {
        const text = await res.text();
        if (text.length > MAX_RESPONSE_BYTES) throw new Error('too large');
        json = JSON.parse(text) as { results?: unknown };
      } catch {
        throw new ProviderUnavailableError('tavily', { retryable: true, reason: 'bad_response', operation: 'search' });
      }

      const results: WebResult[] = [];
      for (const r of Array.isArray(json?.results) ? json.results : []) {
        if (results.length >= limit) break;
        const item = r as { title?: unknown; url?: unknown; content?: unknown };
        const url = safeUrl(item.url);
        if (!url) continue;
        results.push({
          title: clip(typeof item.title === 'string' ? item.title : '', MAX_TITLE_CHARS),
          url,
          snippet: clip(typeof item.content === 'string' ? item.content : '', MAX_WEB_SNIPPET_CHARS),
          untrusted: true,
        });
      }
      return results;
    },
  };
}
