import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

assert.equal(manifest.main, './dist/extension.js');
assert.equal(manifest.activationEvents.includes('onLanguage:vsk'), true);
assert.equal(manifest.contributes.languages[0].id, 'vsk');
assert.deepEqual(manifest.contributes.languages[0].extensions, ['.vsk']);
assert.equal(manifest.contributes.commands.some((c) => c.command === 'vesk.restartLsp'), true);
assert.equal(manifest.configuration.properties['vesk.tailwind.completion'].default, true);
assert.equal(manifest.configuration.properties['vesk.autoCloseTags'].default, true);
assert.equal(existsSync(resolve(root, 'dist/extension.js')), true);
assert.equal(existsSync(resolve(root, 'lsp-server/index.mjs')), true);

const extension = readFileSync(resolve(root, 'src/extension.ts'), 'utf8');
for (const behavior of [
  'volar/client/autoInsert',
  'vesk.restartLsp',
  'emmet.includeLanguages',
  "documentSelector: [{ scheme: 'file', language: 'vsk' }]",
]) {
  assert.equal(extension.includes(behavior), true, `extension is missing ${behavior}`);
}

console.log('VS Code extension manifest/integration contract: PASS');
