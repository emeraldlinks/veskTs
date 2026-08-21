import { rollup } from '@rollup/wasm-node';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import typescript from '@rollup/plugin-typescript';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';

const repoRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Ensure a module-scope `__filename` is defined in the generated bundle.
 * The bundled TypeScript `tsserver.js` runtime references `__filename` in
 * `getNodeSystem()`/`isFileSystemCaseSensitive()` but never defines it. When the
 * full TypeScript library is pulled in (it historically was not), the runtime
 * crashes on startup with `ReferenceError: __filename is not defined in ES module scope`.
 * Declaring it at the top of the single-module bundle makes every build self-contained.
 */
function ensureModuleFilename(file) {
  let src = readFileSync(file, 'utf8');
  if (src.includes('const __filename = fileURLToPath(import.meta.url);')) return;
  if (!src.includes('__filename')) return;
  const lines = src.split('\n');
  let i = 0;
  while (i < lines.length && /^\s*import\s/.test(lines[i])) i++;
  lines.splice(i, 0, 'const __filename = fileURLToPath(import.meta.url);');
  writeFileSync(file, lines.join('\n'), 'utf8');
}

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

  ensureModuleFilename(output);

  console.log('LSP server bundle written to extension/vsk-vscode/lsp-server/index.mjs');

  copyFileSync(output, neovim);
  copyFileSync(output + '.map', neovim + '.map');

  console.log('LSP server bundle copied to extension/vsk-neovim/lsp-server/index.mjs');
}

build().catch(e => {
  console.error(e);
  process.exit(1);
});
