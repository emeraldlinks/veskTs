import type { Tool } from '../loop.js';

export function createWebTools(): Tool[] {
  return [
    {
      name: 'web.search',
      description: 'Search the web for information. Returns top results with titles and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'Number of results (1-10)' },
        },
        required: ['query'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const query = String((args as { query: string }).query || '').trim();
        const count = Math.min(10, Math.max(1, Number((args as { count?: number }).count) || 5));
        if (!query) return JSON.stringify({ error: 'missing query' });
        try {
          // Use DuckDuckGo HTML search (no key, fetch-only)
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const res = await fetch(url, { headers: { 'User-Agent': 'vesk-agentic/0.2.10' } });
          if (!res.ok) return JSON.stringify({ error: `search failed: ${res.status}` });
          const html = await res.text();
          // Very lightweight parse: extract result links/titles via string ops (no regex for complex parsing, just substring)
          const results: Array<{ title: string; url: string; snippet: string }> = [];
          let pos = 0;
          while (results.length < count) {
            const aIdx = html.indexOf('class="result__a"', pos);
            if (aIdx === -1) break;
            const hrefIdx = html.lastIndexOf('href="', aIdx);
            const hrefEnd = html.indexOf('"', hrefIdx + 6);
            const href = hrefIdx !== -1 && hrefEnd !== -1 ? html.slice(hrefIdx + 6, hrefEnd) : '';
            const titleStart = html.indexOf('>', aIdx) + 1;
            const titleEnd = html.indexOf('</a>', titleStart);
            const title = titleStart !== -1 && titleEnd !== -1 ? html.slice(titleStart, titleEnd).replace(/<[^>]*>/g, '').trim() : '';
            const snippetIdx = html.indexOf('class="result__snippet"', titleEnd);
            let snippet = '';
            if (snippetIdx !== -1) {
              const sStart = html.indexOf('>', snippetIdx) + 1;
              const sEnd = html.indexOf('</', sStart);
              snippet = sStart !== -1 && sEnd !== -1 ? html.slice(sStart, sEnd).replace(/<[^>]*>/g, '').trim().slice(0, 300) : '';
            }
            if (title && href) results.push({ title, url: href, snippet });
            pos = titleEnd + 1;
            if (pos <= aIdx) break;
          }
          if (results.length === 0) {
            // Fallback: try api.duckduckgo.com JSON
            try {
              const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
              const apiRes = await fetch(apiUrl);
              if (apiRes.ok) {
                const data = await apiRes.json() as { AbstractText?: string; RelatedTopics?: unknown[] };
                if (data.AbstractText) results.push({ title: query, url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`, snippet: String(data.AbstractText).slice(0, 300) });
              }
            } catch {}
          }
          return JSON.stringify({ query, count: results.length, results }, null, 2);
        } catch (e) {
          return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
        }
      },
    },
    {
      name: 'web.fetch',
      description: 'Fetch a web page and return its text content (first 8000 chars).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch' },
          maxChars: { type: 'number', description: 'Max chars to return' },
        },
        required: ['url'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const url = String((args as { url: string }).url || '').trim();
        const maxChars = Math.min(20000, Math.max(500, Number((args as { maxChars?: number }).maxChars) || 8000));
        if (!url) return JSON.stringify({ error: 'missing url' });
        try {
          // Basic SSRF guard: only http/https
          if (!url.startsWith('http://') && !url.startsWith('https://')) return JSON.stringify({ error: 'only http/https allowed' });
          const res = await fetch(url, { headers: { 'User-Agent': 'vesk-agentic/0.2.10' } });
          if (!res.ok) return JSON.stringify({ error: `fetch failed: ${res.status} ${res.statusText}` });
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const j = await res.text();
            return j.slice(0, maxChars);
          }
          const html = await res.text();
          // Strip tags naively
          let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          return text.slice(0, maxChars);
        } catch (e) {
          return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
        }
      },
    },
  ];
}
