import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sourceDir = dirname(require.resolve('swagger-ui-dist/swagger-ui-bundle.js'));
const targetDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'swagger-ui');
const files = [
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js',
  'LICENSE',
  'NOTICE',
  'swagger-ui-bundle.js.LICENSE.txt',
  'swagger-ui-standalone-preset.js.LICENSE.txt',
];

mkdirSync(targetDir, { recursive: true });
for (const file of files) {
  copyFileSync(resolve(sourceDir, file), resolve(targetDir, file));
}
