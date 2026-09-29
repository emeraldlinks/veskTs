import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

// Icon contributions: the extension icon and the .vsk file icon theme.
assert.equal(manifest.icon, 'icons/vsk-file-icon.png');
const theme = manifest.contributes.iconThemes.find((t) => t.id === 'vesk-file-icons');
assert.ok(theme, 'manifest is missing the vsk-file-icons icon theme');
assert.equal(theme.path, './icons/vsk-icon-theme.json');

const iconPath = resolve(root, manifest.icon);
assert.equal(existsSync(iconPath), true, `extension icon is missing: ${manifest.icon}`);
const iconBytes = readFileSync(iconPath);
assert.equal(iconBytes.subarray(1, 4).toString('latin1'), 'PNG', 'extension icon is not a PNG');
assert.ok(iconBytes.readUInt32BE(16) >= 128, 'extension icon must be at least 128x128');
assert.ok(iconBytes.readUInt32BE(20) >= 128, 'extension icon must be at least 128x128');

const themePath = resolve(root, theme.path);
assert.equal(existsSync(themePath), true, `icon theme is missing: ${theme.path}`);
const themeJson = JSON.parse(readFileSync(themePath, 'utf8'));
assert.deepEqual(themeJson.fileExtensions, { vsk: '_vsk_file' });
const def = themeJson.iconDefinitions[themeJson.fileExtensions.vsk];
assert.ok(def, 'fileExtensions.vsk points at an undefined icon definition');
assert.equal(existsSync(resolve(dirname(themePath), def.iconPath)), true, 'icon theme iconPath does not resolve');

console.log('VS Code extension manifest/integration contract: PASS');
