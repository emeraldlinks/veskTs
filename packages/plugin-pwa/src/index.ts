/**
 * @vesk/plugin-pwa — Progressive Web App plugin for Vesk.
 *
 * - Generates manifest.webmanifest + sw.js + pwa-init.js at build start
 *   (written into publicDir so both dev and prod serve them as static files).
 * - Injects the manifest link / theme-color / apple meta tags / SW registration
 *   into the generated head for every page via the `onHead` hook — no manual
 *   layout edits and no inline scripts (CSP-safe): SW registration lives in the
 *   external `/pwa-init.js`.
 *
 * @module plugin-pwa
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve, join } from 'node:path';
import type { VeskPlugin } from '@vesk/types';

export interface PwaIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

export interface PwaOptions {
  /** App name — used for manifest name, short_name default. */
  name?: string;
  /** Short name for the homescreen prompt. */
  shortName?: string;
  description?: string;
  /** Base URL of the deployed site (default '/'). */
  scope?: string;
  /** Default locale — 'en-US'. */
  lang?: string;
  /** display mode: standalone | fullscreen | minimal-ui | browser. */
  display?: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser';
  /** Preferred orientation. */
  orientation?: 'any' | 'natural' | 'landscape' | 'landscape-primary' | 'landscape-secondary' | 'portrait' | 'portrait-primary' | 'portrait-secondary';
  themeColor?: string;
  backgroundColor?: string;
  icons?: PwaIcon[];
  /** Where the plugin writes its generated files (public dir of the app). */
  publicDir?: string;
  /** Disable auto service-worker generation (sw.js + pwa-init.js). */
  noServiceWorker?: boolean;
  /** Service-worker caching strategy (default 'stale-while-revalidate'). */
  swStrategy?: 'stale-while-revalidate' | 'cache-first' | 'network-first';
}

const DEFAULTS: Required<Pick<PwaOptions, 'name' | 'display' | 'scope' | 'lang' | 'themeColor' | 'backgroundColor' | 'swStrategy'>> & Pick<PwaOptions, 'shortName' | 'description' | 'orientation'> = {
  name: 'Vesk App',
  shortName: 'Vesk',
  description: 'A Vesk app',
  scope: '/',
  lang: 'en-US',
  display: 'standalone',
  orientation: 'any',
  themeColor: '#000000',
  backgroundColor: '#ffffff',
  swStrategy: 'stale-while-revalidate',
};

export const PWA_MANIFEST_URL = '/manifest.webmanifest';
export const PWA_SW_URL = '/sw.js';
export const PWA_INIT_URL = '/pwa-init.js';

/**
 * Solid-color RGBA PNG encoder (no image dependencies). Chrome's
 * installability audit requires the manifest icons to actually exist and be
 * fetchable, so the plugin writes real icon-192.png / icon-512.png files at
 * build time.
 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function hexToRgba(hex: string): [number, number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  const n = parseInt(h.slice(0, 8), 16);
  if (Number.isNaN(n)) return [0, 0, 0, 255];
  return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function solidPng(size: number, color: string): Buffer {
  const [r, g, b, a] = hexToRgba(color);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) {
    row[1 + x * 4] = r;
    row[2 + x * 4] = g;
    row[3 + x * 4] = b;
    row[4 + x * 4] = a;
  }
  const raw = Buffer.alloc(size * row.length);
  for (let y = 0; y < size; y++) row.copy(raw, y * row.length);
  const idat = deflateSync(raw);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function generateManifest(opts: PwaOptions): string {
  const name = opts.name || DEFAULTS.name;
  const shortName = opts.shortName || name;
  const icons = (opts.icons && opts.icons.length > 0)
    ? opts.icons.map(i => ({ src: i.src, sizes: i.sizes, type: i.type, ...(i.purpose ? { purpose: i.purpose } : {}) }))
    : [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }];
  const manifest = {
    name,
    short_name: shortName,
    ...(opts.description ? { description: opts.description } : {}),
    scope: opts.scope || DEFAULTS.scope,
    start_url: opts.scope || DEFAULTS.scope,
    id: opts.scope || DEFAULTS.scope,
    lang: opts.lang || DEFAULTS.lang,
    display: opts.display || DEFAULTS.display,
    ...(opts.orientation && opts.orientation !== 'any' ? { orientation: opts.orientation } : {}),
    ...(opts.themeColor ? { theme_color: opts.themeColor } : {}),
    ...(opts.backgroundColor ? { background_color: opts.backgroundColor } : {}),
    icons,
  };
  return JSON.stringify(manifest, null, 2);
}

function generateServiceWorker(strategy: PwaOptions['swStrategy']): string {
  const strat = strategy || DEFAULTS.swStrategy;
  return `// Vesk PWA — auto-generated service worker (strategy: ${strat})
const CACHE = 'vesk-pwa-v1';
self.addEventListener('install', (e) => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.protocol === 'chrome-extension:' || url.protocol === 'chrome:' || url.protocol === 'file:') return;
  e.respondWith((async () => {
    try {
${strat === 'cache-first'
  ? `      const cached = await caches.match(e.request);
      if (cached) return cached;
      const resp = await fetch(e.request);
      const cache = await caches.open(CACHE);
      cache.put(e.request, resp.clone());
      return resp;`
  : strat === 'network-first'
    ? `      const resp = await fetch(e.request);
      const cache = await caches.open(CACHE);
      cache.put(e.request, resp.clone());
      return resp;`
    : `      const cached = await caches.match(e.request);
      const resp = await fetch(e.request);
      if (resp && resp.ok) { const cache = await caches.open(CACHE); cache.put(e.request, resp.clone()); }
      return cached || resp;`
}
    } catch { return caches.match(e.request); }
  })());
});
`;
}

/** External (non-inline) service-worker registration script. */
function generatePwaInit(opts: PwaOptions): string {
  const scope = opts.scope || DEFAULTS.scope;
  return `// Vesk PWA — service-worker registration (external, CSP-safe)
(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(${JSON.stringify(PWA_SW_URL)}, { scope: ${JSON.stringify(scope)} }).catch(() => {});
  }
})();
`;
}

/** The head tags the `onHead` hook and `provides.pwaHeadTags` share. */
function headTags(opts: PwaOptions): string {
  const name = opts.name || DEFAULTS.name;
  const shortName = opts.shortName || name;
  const lines: string[] = [
    `<link rel="manifest" href="${PWA_MANIFEST_URL}" />`,
    `<meta name="theme-color" content="${opts.themeColor || DEFAULTS.themeColor}" />`,
  ];
  if (opts.backgroundColor) lines.push(`<meta name="background-color" content="${opts.backgroundColor}" />`);
  if (opts.name) lines.push(`<meta name="application-name" content="${name}" />`);
  if (opts.shortName) lines.push(`<meta name="apple-mobile-web-app-title" content="${shortName}" />`);
  if (opts.display === 'standalone') lines.push('<meta name="apple-mobile-web-app-capable" content="yes" />');
  const icons = (opts.icons && opts.icons.length > 0)
    ? opts.icons
    : [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }];
  for (const icon of icons) {
    if (icon.purpose && icon.purpose !== 'any') continue;
    lines.push(`<link rel="apple-touch-icon" href="${icon.src}" />`);
  }
  if (!opts.noServiceWorker) lines.push(`<script src="${PWA_INIT_URL}" defer></script>`);
  return lines.join('\n');
}

/**
 * Merge `tags` into an assembled head fragment without duplicating tags the
 * page (or an earlier hook) already declared. Dedup keys on the `rel=` /
 * `name=` / `src=` attribute value, so re-running against identical or slightly
 * different markup stays idempotent.
 */
function dedupInsert(headHtml: string, tags: string): string {
  const present = new Set(headHtml.split('\n').map((s) => s.trim()));
  const out: string[] = [];
  for (const raw of tags.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let key = '';
    const rel = line.indexOf('rel="');
    const name = line.indexOf('name="');
    const src = line.indexOf('src="');
    if (rel >= 0) key = line.slice(rel);
    else if (name >= 0) key = line.slice(name);
    else if (src >= 0) key = line.slice(src);
    else key = line;
    if (present.has(line)) continue;
    if (key && headHtml.includes(key)) continue;
    present.add(line);
    out.push(line);
  }
  if (out.length === 0) return headHtml;
  return (headHtml || '') + '\n' + out.join('\n');
}

// The VeskPlugin returned by the factory
export function pwaPlugin(opts: PwaOptions = {}): VeskPlugin {
  const name = opts.name || DEFAULTS.name;
  const shortName = opts.shortName || name;
  const publicDir = opts.publicDir || resolve(process.cwd(), 'public');

  function writeFiles(): void {
    try {
      mkdirSync(publicDir, { recursive: true });
      writeFileSync(join(publicDir, 'manifest.webmanifest'), generateManifest(opts), 'utf-8');
      if (!opts.icons || opts.icons.length === 0) {
        writeFileSync(join(publicDir, 'icon-192.png'), solidPng(192, opts.themeColor || DEFAULTS.themeColor));
        writeFileSync(join(publicDir, 'icon-512.png'), solidPng(512, opts.themeColor || DEFAULTS.themeColor));
      }
      if (!opts.noServiceWorker) {
        writeFileSync(join(publicDir, 'sw.js'), generateServiceWorker(opts.swStrategy), 'utf-8');
        writeFileSync(join(publicDir, 'pwa-init.js'), generatePwaInit(opts), 'utf-8');
      }
    } catch (e) {
      console.error(`[vesk/plugin-pwa] write error:`, e instanceof Error ? e.message : e);
    }
  }

  const provides: Record<string, (() => unknown) | unknown> = {
    pwaHeadTags: () => headTags(opts),
    pwaManifestLink: () => `<link rel="manifest" href="${PWA_MANIFEST_URL}" />`,
    pwaSwRegister: () => (opts.noServiceWorker ? '' : `<script src="${PWA_INIT_URL}" defer></script>`),
    pwaMetaThemeColor: () => `<meta name="theme-color" content="${opts.themeColor || DEFAULTS.themeColor}" />`,
    pwaName: () => name,
    pwaShortName: () => shortName,
  };

  return {
    name: '@vesk/plugin-pwa',
    dependencies: new Set<string>(),

    async onBuildStart(): Promise<void> {
      writeFiles();
    },

    async onFileWatch(filePath: string): Promise<{ handled: boolean }> {
      const base = publicDir;
      if (
        filePath === resolve(base, 'manifest.webmanifest') ||
        filePath === resolve(base, 'sw.js') ||
        filePath === resolve(base, 'pwa-init.js')
      ) {
        return { handled: true };
      }
      return { handled: false };
    },

    provides,

    async onHead(headHtml: string): Promise<string | null> {
      return dedupInsert(headHtml || '', headTags(opts));
    },

    async onRequest(ctx: { request: Request; set: (k: string, v: unknown) => void; get: (k: string) => unknown }): Promise<void> {
      const url = new URL(ctx.request.url);
      if (url.pathname === PWA_MANIFEST_URL) {
        try {
          const manifestPath = join(publicDir, 'manifest.webmanifest');
          if (existsSync(manifestPath)) {
            ctx.set('pwaManifestBody', readFileSync(manifestPath, 'utf-8'));
          }
        } catch { /* ignore */ }
      }
      if (url.pathname === PWA_SW_URL) {
        try {
          const swPath = join(publicDir, 'sw.js');
          if (existsSync(swPath)) {
            ctx.set('pwaSwBody', readFileSync(swPath, 'utf-8'));
          }
        } catch { /* ignore */ }
      }
      if (url.pathname === PWA_INIT_URL) {
        try {
          const initPath = join(publicDir, 'pwa-init.js');
          if (existsSync(initPath)) {
            ctx.set('pwaInitBody', readFileSync(initPath, 'utf-8'));
          }
        } catch { /* ignore */ }
      }
    },

    async onBuildEnd(): Promise<void> {
      writeFiles();
    },
  };
}

// Legacy named-export default for backward compat
export default pwaPlugin;