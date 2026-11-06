import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import * as esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Bundles `src/index.ts` → `dist/cli.js`.
 *
 * The CLI is a single esbuild bundle that INLINES `@vesk/compiler` and
 * `@vesk/adapter`. That is why a compiler source edit is not visible to
 * `vesk build` until this step re-runs — patching `packages/compiler/dist`
 * alone leaves the CLI's inlined copy stale (a bare-specifier SSR bundling fix
 * shipped exactly this way once and silently did nothing on Vercel).
 *
 * Kept in its own module so both `build.ts` (npm run build) and
 * `build-packages.ts` (the incremental post-compiler-edit rebuild) can invoke
 * it without an import cycle.
 */
export async function bundleCli(): Promise<void> {
  await esbuild.build({
    entryPoints: [resolve(__dirname, 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: resolve(__dirname, '../dist/cli.js'),
    format: 'esm',
    sourcemap: false,
    external: ['typescript', 'ws', 'esbuild', 'sharp', 'zimmerframe', 'esrap', 'puppeteer', 'puppeteer-core'],
    logOverride: { 'direct-eval': 'silent' },
    plugins: [{
      name: 'ts-prefer',
      setup(build) {
        build.onResolve({ filter: /\.js$/ }, args => {
          const absPath = resolve(dirname(args.importer), args.path);
          if (!absPath.includes('/packages/compiler/') && !absPath.includes('/packages/adapter/')) return;
          const tsPath = absPath.replace(/\.js$/, '.ts');
          if (existsSync(tsPath)) {
            return { path: tsPath };
          }
        });
      },
    }],
  });
}
