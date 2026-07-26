import { rollup } from '@rollup/wasm-node';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import typescript from '@rollup/plugin-typescript';

async function build() {
  const bundle = await rollup({
    input: '/home/joe/vesk/packages/lsp/src/server.ts',
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
    file: '/home/joe/vesk/extension/vsk-vscode/lsp-server/index.mjs',
    format: 'esm',
    sourcemap: true,
  });

  console.log('LSP server bundle written to extension/vsk-vscode/lsp-server/index.mjs');
}

build().catch(e => {
  console.error(e);
  process.exit(1);
});
