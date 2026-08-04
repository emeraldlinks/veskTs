import {
  mkdirSync, copyFileSync, readdirSync, statSync, existsSync,
  writeFileSync, rmSync, readFileSync,
} from 'node:fs';
import { resolve, join, extname, dirname } from 'node:path';
import type { SsgRouteResult } from '@vesk/adapter/src/types';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

export function ensureCleanDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

export function copyDirContents(srcDir: string, destDir: string): void {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDirContents(srcPath, destPath);
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
    }
  }
}

export function writeFile(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

/**
 * Lay out `.vesk/static/**` into a platform `static/` directory using the
 * URL scheme the SSR output expects:
 *   /_vesk/static/*  <- .vesk/static/*
 *   /_vesk/runtime.js <- .vesk/static/client.js (alias)
 *   /* (public)       <- .vesk/static/public/*
 */
export function writePlatformStatic(buildStaticDir: string, platformStaticDir: string): void {
  mkdirSync(platformStaticDir, { recursive: true });

  const publicDir = resolve(buildStaticDir, 'public');
  if (existsSync(publicDir)) {
    copyDirContents(publicDir, platformStaticDir);
  }

  const assetsDir = resolve(platformStaticDir, '_vesk', 'static');
  copyDirContents(buildStaticDir, assetsDir);

  const runtimeAlias = resolve(platformStaticDir, '_vesk', 'runtime.js');
  const clientPath = resolve(buildStaticDir, 'client.js');
  if (existsSync(clientPath)) {
    mkdirSync(dirname(runtimeAlias), { recursive: true });
    copyFileSync(clientPath, runtimeAlias);
  }
}

/**
 * Write SSG pages into a platform static dir. They land under
 * `_vesk/static/public/<path>.html` — the exact location the platform
 * handler's prerendered 308 redirect points to — plus a `<path>/index.html`
 * twin for trailing-slash URLs. `route.html` is the prerendered file path.
 */
export function writePrerenderedStatic(prerenderedRoutes: SsgRouteResult[], platformStaticDir: string): void {
  for (const route of prerenderedRoutes) {
    if (!existsSync(route.html)) continue;
    const content = readFileSync(route.html);
    const htmlRel = route.path === '/' ? 'index.html' : `${route.path.replace(/^\//, '')}.html`;
    const target = resolve(platformStaticDir, '_vesk', 'static', 'public', htmlRel);
    writeFile(target, content);
    if (route.path !== '/' && route.path.endsWith('/')) {
      const dirIndex = resolve(platformStaticDir, '_vesk', 'static', 'public', `${route.path.replace(/^\//, '')}index.html`);
      writeFile(dirIndex, content);
    }
  }
}

/**
 * Recursively list the files of a static dir as `{ rel, buffer }` so a target
 * runtime without a filesystem (generic edge) can inline them into the bundle.
 */
export function listStaticDir(dir: string): Array<{ rel: string; buffer: Buffer }> {
  const out: Array<{ rel: string; buffer: Buffer }> = [];
  if (!existsSync(dir)) return out;
  function walk(d: string, prefix: string): void {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const rel = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(full).isDirectory()) {
        walk(full, rel);
      } else {
        out.push({ rel, buffer: readFileSync(full) });
      }
    }
  }
  walk(dir, '');
  return out;
}

export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] || 'application/octet-stream';
}
