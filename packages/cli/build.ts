import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import * as esbuild from 'esbuild';
import { buildPackages } from './src/build-packages';
const __dirname = dirname(fileURLToPath(import.meta.url));
buildPackages();
await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: resolve(__dirname, 'dist/cli.js'),
  format: 'esm',
  sourcemap: false,
  external: ['typescript', 'ws', 'esbuild', 'sharp', 'zimmerframe', 'esrap'],
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

await esbuild.build({
  entryPoints: [resolve(__dirname, '..', 'haul', 'internal', 'sidecar', 'server.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: resolve(__dirname, 'dist/sidecar.js'),
  format: 'esm',
  sourcemap: false,
  external: ['typescript', '@vesk/compiler', '@vesk/compiler/*', '@vesk/runtime', '@vesk/runtime/*', 'esbuild', 'esbuild-wasm'],
});
