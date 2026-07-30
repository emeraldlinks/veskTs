import * as esbuild from 'esbuild';
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/cli.js',
  format: 'esm',
  sourcemap: false,
  external: ['typescript', 'ws', 'esbuild'],
  logOverride: { 'direct-eval': 'silent' },
});
