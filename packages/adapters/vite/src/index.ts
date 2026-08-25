/**
 * vite-plugin-vesk — Vite adapter for Vesk.
 * Transforms .vsk files to TSX via vskToTsx and lets Vite handle the rest.
 * Handles HMR via Vite's handleHotUpdate.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { vskToTsx } from '@vesk/compiler/src/vsk-tsx';

export interface VeskViteOptions {
  /**
   * Include pattern for .vsk files. Default /\.vsk$/.
   */
  include?: RegExp;
  /**
   * Exclude pattern. Default /node_modules/.
   */
  exclude?: RegExp;
}

export default function vesk(options: VeskViteOptions = {}) {
  const include = options.include ?? /\.vsk$/;
  const exclude = options.exclude ?? /node_modules/;

  return {
    name: 'vite-plugin-vesk',
    enforce: 'pre' as const,

    transform(code: string, id: string) {
      const [path] = id.split('?');
      if (!include.test(path) || exclude.test(path)) return null;
      if (!path.endsWith('.vsk')) return null;

      try {
        const tsx = vskToTsx(code);
        return {
          code: tsx,
          map: null,
        };
      } catch (e) {
        (this as unknown as { error: (msg: string) => never }).error(`[vite-plugin-vesk] Failed to compile ${id}: ${(e as Error).message}`);
      }
    },

    resolveId(id: string, importer?: string) {
      if (!importer) return null;
      // Allow omitting .vsk extension: import Foo from './Foo' where Foo.vsk exists
      if (id.startsWith('.') && !id.endsWith('.vsk') && !id.includes('?')) {
        const base = resolve(dirname(importer), id);
        for (const ext of ['.vsk', '.vsk?client']) {
          try {
            const full = base + ext;
            readFileSync(full);
            return full;
          } catch {}
        }
        // Try directory with .vsk
        try {
          const full = base + '.vsk';
          readFileSync(full);
          return full;
        } catch {}
      }
      return null;
    },

    handleHotUpdate(ctx: { file: string; server: { ws: { send: (msg: unknown) => void } } }) {
      if (ctx.file.endsWith('.vsk')) {
        ctx.server.ws.send({ type: 'full-reload' });
      }
    },
  };
}

export { vesk };
