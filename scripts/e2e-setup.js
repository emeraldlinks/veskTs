import { build } from '../packages/adapter/src/index.js';
import { startProdServer } from '../packages/adapter/src/prod-server.js';
import { startDevServer } from '../packages/adapter/src/dev-server.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, rmSync } from 'fs';
import { connect } from 'net';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const appDir = resolve(root, 'test-app', 'app');
const publicDir = resolve(root, 'test-app', 'public');
const outDir = resolve(root, 'test-app', '.vesk', 'e2e');

const PROD_PORT = parseInt(process.env.VESK_E2E_PROD_PORT || '3099');
const DEV_PORT = parseInt(process.env.VESK_E2E_DEV_PORT || '3002');

function waitForPort(port, timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for port ${port}`)), timeout);
    function tryConnect() {
      const s = connect(port, '127.0.0.1');
      s.on('connect', () => {
        s.destroy();
        clearTimeout(timer);
        resolve();
      });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - start > timeout) { clearTimeout(timer); reject(new Error(`Timeout waiting for port ${port}`)); }
        else setTimeout(tryConnect, 200);
      });
    }
    setTimeout(tryConnect, 100);
  });
}

try { execSync('lsof -ti:' + PROD_PORT + ' -ti:' + DEV_PORT + ' 2>/dev/null | xargs -r kill 2>/dev/null', { stdio: 'ignore' }); } catch {}
try { rmSync(outDir, { recursive: true }); } catch {}
mkdirSync(resolve(outDir, 'static'), { recursive: true });

console.error('Building production (code-split)...');
await build(appDir, { outDir, publicDir, codeSplit: true });

console.error('Starting production server...');
const prodServer = await startProdServer(outDir, { port: PROD_PORT });
await waitForPort(PROD_PORT);

console.error('Starting dev server...');
const devServer = await startDevServer(appDir, { port: DEV_PORT, publicDir, block: false });
await waitForPort(DEV_PORT);

console.log('E2E_SERVERS_READY');

process.on('SIGTERM', () => {
  prodServer?.close();
  devServer?.close();
  process.exit(0);
});

await new Promise(() => {}); // keep alive
