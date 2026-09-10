/**
 * Build script for vesk.nvim Neovim plugin.
 * Called by lazy.nvim's `build` option.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const pluginDir = path.resolve(__dirname, '..');
// The plugin is at extension/vsk-neovim/ — repo root is two levels up
const repoRoot = path.resolve(pluginDir, '../..');

// Prebuilt bundle shipped inside the plugin (git-tracked)
const localServer = path.join(pluginDir, 'lsp-server', 'index.mjs');

// Check if we're in the vesk monorepo
const buildScript = path.join(repoRoot, 'scripts', 'build-lsp.js');
if (fs.existsSync(buildScript)) {
  console.log('[vesk] Building LSP server from monorepo...');
  execSync('node scripts/build-lsp.js', { cwd: repoRoot, stdio: 'inherit' });
  // Copy built server into plugin directory for standalone use
  const src = path.join(repoRoot, 'extension', 'vsk-vscode', 'lsp-server', 'index.mjs');
  const dst = localServer;
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log('[vesk] LSP server copied to plugin.');
  }
} else if (fs.existsSync(localServer)) {
  // Standalone clone: the prebuilt bundle ships with the plugin (git-tracked),
  // so there is nothing to build. Just confirm it is usable.
  const size = fs.statSync(localServer).size;
  if (size > 1_000_000) {
    console.log(`[vesk] Using prebuilt LSP server (${(size / 1024 / 1024).toFixed(1)} MB).`);
  } else {
    console.warn('[vesk] WARN: lsp-server/index.mjs looks truncated. Reinstall the plugin.');
  }
} else {
  console.warn('[vesk] WARN: Not inside the vesk monorepo and no prebuilt LSP server found.');
  console.warn('[vesk] Reinstall the plugin (git clone ) or copy extension/vsk-vscode/lsp-server/index.mjs into lsp-server/.');
}
