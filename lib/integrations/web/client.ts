import type { WebCapability, WebResult } from '../types';

export function createWebCapability(apiKey: string): WebCapability {
  return {
    async search(query: string): Promise<WebResult[]> {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query }),
      });
      if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
      const json = await res.json();
      return json.results.map((r: { title: string; url: string; content: string }) => ({ title: r.title, url: r.url, snippet: r.content }));
    },

    async read(url: string): Promise<string> {
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, urls: [url] }),
      });
      if (!res.ok) throw new Error(`Tavily extract failed: ${res.status}`);
      const json = await res.json();
      return json.results[0]?.raw_content ?? '';
    },
  };
}
