import { rollup } from '@rollup/wasm-node';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import typescript from '@rollup/plugin-typescript';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { copyFileSync } from 'node:fs';

const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

async function build() {
  const output = resolvePath(repoRoot, 'extension/vsk-vscode/lsp-server/index.mjs');
  const neovim = resolvePath(repoRoot, 'extension/vsk-neovim/lsp-server/index.mjs');
  const bundle = await rollup({
    input: resolvePath(repoRoot, 'packages/lsp/src/server.ts'),
    plugins: [
      resolve({
        extensions: ['.js', '.ts', '.mjs', '.cjs', '.json'],
        preferBuiltins: true,
      }),
      commonjs(),
      json(),
      typescript({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          resolveJsonModule: true,
          declaration: false,
          sourceMap: true,
          noEmit: true,
          lib: ['ES2022'],
        },
      }),
    ],
    external: [],
  });

  await bundle.write({
    file: output,
    format: 'esm',
    inlineDynamicImports: true,
    sourcemap: true,
  });

  console.log('LSP server bundle written to extension/vsk-vscode/lsp-server/index.mjs');

  copyFileSync(output, neovim);
  copyFileSync(output + '.map', neovim + '.map');

  console.log('LSP server bundle copied to extension/vsk-neovim/lsp-server/index.mjs');
}

build().catch(e => {
  console.error(e);
  process.exit(1);
});
