// Package the VS Code extension into a .vsix without vsce.
//
// vsce is not installed in this repo, so this script rebuilds the client
// bundle, verifies the LSP server bundle exists, and assembles a .vsix with
// the same layout vsce produces:
//
//   extension.vsixmanifest
//   [Content_Types].xml
//   extension/package.json
//   extension/language-configuration.json
//   extension/LICENSE.txt
//   extension/syntaxes/vsk.tmLanguage.json
//   extension/lsp-server/index.mjs (+ .map)
//   extension/dist/extension.js (+ .map)
//
// The version is bumped (patch) in package.json and stamped into the manifest
// so VS Code treats the artifact as an upgrade over the previous build.
//
// Usage: node scripts/package-vsix.js [--version 0.3.14]

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = resolve(repoRoot, 'extension/vsk-vscode');
const pkgPath = resolve(extDir, 'package.json');

const requestedVersion = (() => {
  const flag = process.argv.indexOf('--version');
  return flag !== -1 && process.argv[flag + 1] ? process.argv[flag + 1] : null;
})();

function nextPatch(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = requestedVersion ?? nextPatch(pkg.version);
if (pkg.version !== version) {
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`package.json version bumped to ${version}`);
}

// 1. Rebuild the client bundle.
console.log('Building client bundle...');
execSync('npm run build', { cwd: extDir, stdio: 'inherit' });

// 2. The LSP server bundle must exist (built by scripts/build-lsp.js).
const serverBundle = resolve(extDir, 'lsp-server/index.mjs');
if (!existsSync(serverBundle)) {
  console.error(`LSP server bundle not found at ${serverBundle}`);
  console.error('Build it first: node scripts/build-lsp.js');
  process.exit(1);
}

// 3. Assemble the vsix payload.
const work = resolve(repoRoot, '.vsix-work');
rmSync(work, { recursive: true, force: true });
mkdirSync(resolve(work, 'extension/dist'), { recursive: true });
mkdirSync(resolve(work, 'extension/lsp-server'), { recursive: true });
mkdirSync(resolve(work, 'extension/syntaxes'), { recursive: true });

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="vesk-vscode" Version="${version}" Publisher="vesk" />
    <DisplayName>Vesk Language Support</DisplayName>
    <Description xml:space="preserve">Language support for .vsk component files</Description>
    <Tags>vesk,vsk,.vsk,Vesk,__ext_vsk</Tags>
    <Categories>Programming Languages,Linters</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.85.0" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="https://github.com/emeraldlinks/veskTs.git" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Getstarted" Value="https://github.com/emeraldlinks/veskTs.git" />
      <Property Id="Microsoft.VisualStudio.Services.Links.GitHub" Value="https://github.com/emeraldlinks/veskTs.git" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Support" Value="https://github.com/emeraldlinks/veskTs/issues" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Learn" Value="https://github.com/emeraldlinks/veskTs#readme" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
    <License>extension/LICENSE.txt</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
  </Assets>
</PackageManifest>
`;

writeFileSync(resolve(work, 'extension.vsixmanifest'), manifest, 'utf8');

const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".json" ContentType="application/json"/><Default Extension=".map" ContentType="application/json"/><Default Extension=".mjs" ContentType="application/javascript"/><Default Extension=".txt" ContentType="text/plain"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>`;
writeFileSync(resolve(work, '[Content_Types].xml'), contentTypes, 'utf8');

const copy = (from, to) => {
  writeFileSync(resolve(work, to), readFileSync(from));
};

copy(resolve(extDir, 'package.json'), 'extension/package.json');
copy(resolve(extDir, 'language-configuration.json'), 'extension/language-configuration.json');
copy(resolve(extDir, 'LICENSE'), 'extension/LICENSE.txt');
copy(resolve(extDir, 'syntaxes/vsk.tmLanguage.json'), 'extension/syntaxes/vsk.tmLanguage.json');
copy(resolve(extDir, 'lsp-server/index.mjs'), 'extension/lsp-server/index.mjs');
if (existsSync(resolve(extDir, 'lsp-server/index.mjs.map'))) {
  copy(resolve(extDir, 'lsp-server/index.mjs.map'), 'extension/lsp-server/index.mjs.map');
}
copy(resolve(extDir, 'dist/extension.js'), 'extension/dist/extension.js');
if (existsSync(resolve(extDir, 'dist/extension.js.map'))) {
  copy(resolve(extDir, 'dist/extension.js.map'), 'extension/dist/extension.js.map');
}

// 4. zip the payload (definitely deterministic: store order, no timestamps).
const out = resolve(extDir, `vesk-vscode-${version}.vsix`);
rmSync(out, { force: true });
const archive = resolve(work, 'archive');

const py = `
import zipfile, os, sys
arch = zipfile.ZipFile(${JSON.stringify(archive)}, 'w', zipfile.ZIP_DEFLATED, compresslevel=9)
root = ${JSON.stringify(work)}
order = [
  'extension.vsixmanifest',
  '[Content_Types].xml',
  'extension/package.json',
  'extension/language-configuration.json',
  'extension/LICENSE.txt',
  'extension/syntaxes/vsk.tmLanguage.json',
  'extension/lsp-server/index.mjs.map',
  'extension/lsp-server/index.mjs',
  'extension/dist/extension.js.map',
  'extension/dist/extension.js',
]
for rel in order:
    p = os.path.join(root, rel)
    if not os.path.exists(p):
        continue
    zi = zipfile.ZipInfo(rel)
    zi.compress_type = zipfile.ZIP_DEFLATED
    zi.external_attr = 0o644 << 16
    with open(p, 'rb') as f:
        arch.writestr(zi, f.read())
arch.close()
`;

const pyFile = resolve(work, 'zip.py');
writeFileSync(pyFile, py, 'utf8');
execSync(`python3 ${pyFile}`, { stdio: 'inherit' });
writeFileSync(out, readFileSync(archive));
rmSync(work, { recursive: true, force: true });

const size = readFileSync(out).length;
console.log(`Packaged ${out} (${(size / 1024 / 1024).toFixed(1)} MB)`);