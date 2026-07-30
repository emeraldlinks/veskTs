import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
const __dirname = dirname(fileURLToPath(import.meta.url));
await esbuild.build({
  entryPoints: [resolve(__dirname, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: resolve(__dirname, 'dist/cli.js'),
  format: 'esm',
  sourcemap: false,
  external: ['typescript', 'ws', 'esbuild'],
  logOverride: { 'direct-eval': 'silent' },
});
