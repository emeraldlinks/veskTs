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
 * Strip `#!` shebang lines from the bundle. Rollup hoists the entry's
 * (bin.ts) shebang below its own import prologue, where it is a SyntaxError;
 * ensureModuleFilename would otherwise push it to line 2. The server is always
 * spawned as `node index.mjs`, so the shebang is dead weight.
 */
function stripShebang(file) {
  let src = readFileSync(file, 'utf8');
  const stripped = src.split('\n').filter((line, i) => !(i === 0 && line.startsWith('#!')) && !/^#!\/usr\/bin\/env node\s*$/.test(line)).join('\n');
  if (stripped !== src) writeFileSync(file, stripped, 'utf8');
}

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
    input: resolvePath(repoRoot, 'packages/lsp/src/bin.ts'),
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
    // Must stay []: the packaged vsix ships without node_modules (vsce
    // --no-dependencies), so any external bare specifier (typescript,
    // prettier, volar-service-*) crashes the server on startup with
    // ERR_MODULE_NOT_FOUND. Full bundling also keeps one module instance per
    // package, preserving the volar-service-typescript monkey-patch identity.
    external: [],
  });

  await bundle.write({
    file: output,
    format: 'esm',
    inlineDynamicImports: true,
    sourcemap: true,
  });

  stripShebang(output);
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
