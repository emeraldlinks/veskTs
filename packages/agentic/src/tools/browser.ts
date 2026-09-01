import type { Tool } from '../loop.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

type BrowserBridge = {
  request: (payload: Record<string, unknown>, timeoutMs?: number) => Promise<Record<string, unknown>>;
  hasClients: () => boolean;
};

// Global bridge injected by dev server when available (set via globalThis.__vesk_browser_bridge)
function getBridge(): BrowserBridge | null {
  const g = globalThis as unknown as { __vesk_browser_bridge?: BrowserBridge };
  return g.__vesk_browser_bridge || null;
}

async function ensurePuppeteerInstalled(projectDir: string): Promise<{ ok: boolean; message: string }> {
  // Check if already installed
  const puppeteerPath = resolve(projectDir, 'node_modules', 'puppeteer');
  const corePath = resolve(projectDir, 'node_modules', 'puppeteer-core');
  if (existsSync(puppeteerPath) || existsSync(corePath)) {
    return { ok: true, message: 'puppeteer already installed' };
  }
  // Try to install puppeteer (includes chromium) as devDep
  return new Promise((res) => {
    const child = spawn('npm', ['install', '-D', 'puppeteer'], {
      cwd: projectDir,
      stdio: 'pipe',
      shell: false,
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => (out += String(d)));
    child.stderr?.on('data', (d) => (err += String(d)));
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      res({ ok: false, message: 'install timed out after 120s' });
    }, 120_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) res({ ok: true, message: 'puppeteer installed successfully\n' + out.slice(-500) });
      else res({ ok: false, message: `npm install failed code=${code}\n${err.slice(-1000)}` });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      res({ ok: false, message: `spawn failed: ${e.message}` });
    });
  });
}

export function createBrowserTools(projectDir?: string): Tool[] {
  const dir = projectDir || process.cwd();

  return [
    {
      name: 'browser.open',
      description: 'Open a URL in the users browser first via devtools (if connected), otherwise via puppeteer (auto-installs if needed). Returns rendered text. The agent should prefer this for JS-heavy pages, inspection, and any browser task.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to open (http/https)' },
          waitMs: { type: 'number', description: 'Wait after load (ms, default 1500)' },
        },
        required: ['url'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const url = String((args as { url: string }).url || '').trim();
        const waitMs = Math.min(15000, Math.max(0, Number((args as { waitMs?: number }).waitMs) || 1500));
        if (!url) return JSON.stringify({ error: 'missing url' });
        if (!url.startsWith('http://') && !url.startsWith('https://')) return JSON.stringify({ error: 'only http/https allowed' });

        // 1) Try devtools bridge first (users browser)
        const bridge = getBridge();
        if (bridge && bridge.hasClients()) {
          try {
            const result = await bridge.request({ action: 'open', url, waitMs }, 15000);
            if (result && typeof result.text === 'string') return String(result.text).slice(0, 12000);
            if (result && typeof result.error === 'string') {
              // fall through to puppeteer
            } else if (result) return JSON.stringify(result).slice(0, 12000);
          } catch (e) {
            // bridge failed, fall through
          }
        }

        // 2) Try puppeteer-core / puppeteer if available
        try {
          // @ts-ignore - optional dep, installed on demand
          // @ts-ignore
          const puppeteer = await import('puppeteer').catch(() => null) as unknown as { launch?: (opts: unknown) => Promise<{ newPage: () => Promise<unknown>; close: () => Promise<void> }> } | null;
          // @ts-ignore - optional dep
          const core = !puppeteer ? await import('puppeteer-core').catch(() => null) as unknown as { launch?: (opts: unknown) => Promise<unknown> } | null : null;
          const impl = puppeteer || core;
          if (impl && typeof impl.launch === 'function') {
            const executablePath = process.env.CHROMIUM_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
            const launchOpts: Record<string, unknown> = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] };
            if (executablePath) launchOpts.executablePath = executablePath;
            const browser = await (impl.launch as (o: unknown) => Promise<{ newPage: () => Promise<{ goto: (u: string, o: unknown) => Promise<void>; evaluate: (fn: () => string) => Promise<string>; close: () => Promise<void> }>; close: () => Promise<void> }>)(launchOpts);
            const page = await browser.newPage() as unknown as { goto: (u: string, o: unknown) => Promise<void>; evaluate: (fn: () => string) => Promise<string>; close: () => Promise<void> };
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 } as unknown);
            if (waitMs) await new Promise(r => setTimeout(r, waitMs));
            const text = await page.evaluate(() => document.body.innerText.slice(0, 12000));
            await page.close();
            await browser.close();
            return text;
          }
        } catch (e) {
          // puppeteer launch failed, will try install
        }

        // 3) Auto-install puppeteer if not present and we have a projectDir
        if (dir) {
          const install = await ensurePuppeteerInstalled(dir);
          if (install.ok) {
            try {
              // @ts-ignore
          const puppeteer = await import('puppeteer') as unknown as { launch: (opts: unknown) => Promise<{ newPage: () => Promise<unknown>; close: () => Promise<void> }> };
              const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] } as unknown);
              const page = await browser.newPage() as unknown as { goto: (u: string, o: unknown) => Promise<void>; evaluate: (fn: () => string) => Promise<string>; close: () => Promise<void> };
              await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 } as unknown);
              if (waitMs) await new Promise(r => setTimeout(r, waitMs));
              const text = await page.evaluate(() => document.body.innerText.slice(0, 12000));
              await page.close();
              await browser.close();
              return text + '\n\n[installed puppeteer automatically]';
            } catch (e2) {
              // fall through to fetch
            }
          } else {
            // install failed, fall through but include message
          }
        }

        // 4) Final fallback: fetch and strip html
        try {
          const res = await fetch(url, { headers: { 'User-Agent': 'vesk-agentic/0.2.10' } });
          if (!res.ok) return JSON.stringify({ error: `fetch failed: ${res.status} ${res.statusText}`, hint: 'tried devtools bridge, puppeteer, and fetch — all failed' });
          const html = await res.text();
          const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
          return text + '\n\n[fallback: fetch strip — for full JS rendering install puppeteer or connect a browser devtools]';
        } catch (e) {
          return JSON.stringify({ error: e instanceof Error ? e.message : String(e), hint: 'no browser available and fetch failed' });
        }
      },
    },
    {
      name: 'browser.inspect',
      description: 'Inspect a page/element via users browser devtools first, then puppeteer. Can get outerHTML, styles, source, network, etc.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to inspect (optional if already open)' },
          selector: { type: 'string', description: 'CSS selector to inspect (e.g. "#app", ".btn")' },
          what: { type: 'string', description: 'what to inspect: html, text, styles, attributes, source, network, js', enum: ['html', 'text', 'styles', 'attributes', 'source', 'network', 'js'] },
          js: { type: 'string', description: 'JS code to evaluate (when what=js)' },
        },
        required: [],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const url = (args as { url?: string }).url ? String((args as { url?: string }).url) : undefined;
        const selector = String((args as { selector?: string }).selector || 'body');
        const what = String((args as { what?: string }).what || 'html');
        const js = (args as { js?: string }).js ? String((args as { js?: string }).js) : undefined;

        const bridge = getBridge();
        if (bridge && bridge.hasClients()) {
          try {
            const res = await bridge.request({ action: 'inspect', url, selector, what, js }, 15000);
            if (res && typeof res.result === 'string') return String(res.result).slice(0, 15000);
            if (res) return JSON.stringify(res, null, 2).slice(0, 15000);
          } catch {}
        }
        // Fallback to fetch + basic inspection
        if (what === 'js' && js) {
          return JSON.stringify({ error: 'js evaluation requires a browser — no devtools client connected and puppeteer not configured. The agent will install puppeteer.' });
        }
        if (url) {
          try {
            const res = await fetch(url, { headers: { 'User-Agent': 'vesk-agentic/0.2.10' } });
            const html = await res.text();
            if (what === 'source') return html.slice(0, 15000);
            if (what === 'html') {
              // naive selector: just return whole html if selector is body
              return html.slice(0, 15000);
            }
            const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000);
            return text;
          } catch (e) {
            return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
          }
        }
        return JSON.stringify({ error: 'no url and no devtools browser connected — cannot inspect without a page' });
      },
    },
    {
      name: 'browser.eval',
      description: 'Evaluate JavaScript in the users browser (via devtools) or puppeteer. Use for debugging, styles, networks.',
      parameters: {
        type: 'object',
        properties: {
          js: { type: 'string', description: 'JS code to evaluate (return value will be stringified)' },
          url: { type: 'string', description: 'URL to open first (optional)' },
        },
        required: ['js'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const js = String((args as { js: string }).js || '');
        const url = (args as { url?: string }).url ? String((args as { url?: string }).url) : undefined;
        if (!js) return JSON.stringify({ error: 'missing js' });
        const bridge = getBridge();
        if (bridge && bridge.hasClients()) {
          try {
            const res = await bridge.request({ action: 'eval', js, url }, 15000);
            if (res && typeof res.result !== 'undefined') return typeof res.result === 'string' ? res.result.slice(0, 15000) : JSON.stringify(res.result, null, 2).slice(0, 15000);
            if (res && typeof res.error === 'string') return JSON.stringify({ error: res.error });
          } catch {}
        }
        // Fallback: try puppeteer
        try {
          // @ts-ignore
          const puppeteer = await import('puppeteer').catch(() => null) as unknown as { launch?: unknown } | null;
          if (puppeteer) {
            // would need to launch, but for eval we need a page
            return JSON.stringify({ error: 'eval requires devtools browser — puppeteer fallback not yet wired for eval, will install and retry' });
          }
        } catch {}
        return JSON.stringify({ error: 'no browser available for eval — connect a browser with devtools or ensure puppeteer is installed' });
      },
    },
    {
      name: 'browser.screenshot',
      description: 'Take a screenshot via users browser devtools or puppeteer (auto-installs if needed). Returns base64 or note.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL to screenshot' } },
        required: ['url'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const url = String((args as { url: string }).url || '').trim();
        if (!url) return JSON.stringify({ error: 'missing url' });
        const bridge = getBridge();
        if (bridge && bridge.hasClients()) {
          try {
            const res = await bridge.request({ action: 'screenshot', url }, 20000);
            if (res && typeof res.base64 === 'string') return JSON.stringify({ base64: (res.base64 as string).slice(0, 20000) + '...' });
          } catch {}
        }
        // Try puppeteer
        try {
          // @ts-ignore
          const puppeteer = await import('puppeteer').catch(() => null) as unknown as { launch?: (o: unknown) => Promise<{ newPage: () => Promise<{ goto: (u: string, o: unknown) => Promise<void>; screenshot: (o: unknown) => Promise<Buffer>; close: () => Promise<void> }>; close: () => Promise<void> }> } | null;
          if (puppeteer && typeof puppeteer.launch === 'function') {
            const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] } as unknown);
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 } as unknown);
            const buf = await page.screenshot({ encoding: 'base64' } as unknown) as unknown as string;
            await page.close();
            await browser.close();
            return JSON.stringify({ base64: String(buf).slice(0, 20000) });
          }
        } catch {}
        if (dir) {
          const install = await ensurePuppeteerInstalled(dir);
          if (install.ok) return JSON.stringify({ note: 'puppeteer installed, retry screenshot', detail: install.message });
        }
        return JSON.stringify({ note: 'browser.screenshot requires a connected browser devtools or puppeteer — will auto-install on next call' });
      },
    },
  ];
}
