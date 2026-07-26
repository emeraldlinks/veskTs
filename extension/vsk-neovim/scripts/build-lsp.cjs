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

// Check if we're in the vesk monorepo
const buildScript = path.join(repoRoot, 'scripts', 'build-lsp.js');
if (fs.existsSync(buildScript)) {
  console.log('[vesk] Building LSP server from monorepo...');
  execSync('node scripts/build-lsp.js', { cwd: repoRoot, stdio: 'inherit' });
  // Copy built server into plugin directory for standalone use
  const src = path.join(repoRoot, 'extension', 'vsk-vscode', 'lsp-server', 'index.mjs');
  const dst = path.join(pluginDir, 'lsp-server', 'index.mjs');
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log('[vesk] LSP server copied to plugin.');
  }
} else {
  console.log('[vesk] WARN: Not inside the vesk monorepo. LSP server must be built manually.');
  console.log(`[vesk] Clone the repo and run: node scripts/build-lsp.js`);
}
