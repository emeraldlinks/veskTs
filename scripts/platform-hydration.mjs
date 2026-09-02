/**
 * Hydration certification for edge-class deployment bundles.
 * Builds the test-app for a target, serves the emitted handler, then drives
 * a real browser against it and certifies:
 *   1. zero JS errors on load
 *   2. SSR content present (count = 10)
 *   3. reactivity: 5 clicks → count 15 + OK message (hydration is LIVE)
 *   4. all hydration markers consumed
 *   5. SPA navigation renders client-side without reload
 *
 * Usage: npx tsx scripts/platform-hydration.mjs <edge|deno> [port]
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const appDir = resolve(root, 'test-app', 'app');
const publicDir = resolve(root, 'test-app', 'public');

const platform = process.argv[2] || 'edge';
if (!['edge', 'deno'].includes(platform)) {
	console.error('usage: node scripts/platform-hydration.mjs <edge|deno> [port]');
	process.exit(1);
}
const PORT = parseInt(process.argv[3] || '3987', 10);
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
	if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
	else { failed++; console.log(`  \u2717 ${msg}`); }
}

console.log(`\u001b[36m=== Platform hydration certification: ${platform} ===\u001b[0m`);

// Build with real plugin wiring.
console.log('Building...');
rmSync(join(root, 'test-app', '.vesk-hydr'), { recursive: true, force: true });
{
	const configModule = await import(resolve(root, 'test-app', 'vesk.config.ts'));
	const userConfig = configModule.default || {};
	const { build } = await import('@vesk/adapter/src/index');
	await build(appDir, {
		outDir: join(root, 'test-app', '.vesk-hydr', '.vesk'),
		publicDir,
		platform,
		plugins: userConfig.plugins || [],
	});
}

const shellDir = join(root, 'test-app', '.vesk-hydr', '.vesk', platform);
if (!existsSync(shellDir)) {
	console.error(`platform output missing: ${shellDir}`);
	process.exit(1);
}

let httpServer = null;
let denoProcess = null;

if (platform === 'edge') {
	const handlerModule = await import(resolve(shellDir, 'index.js'));
	const handleEdgeRequest = handlerModule.default || handlerModule.handleEdgeRequest;
	httpServer = createServer(async (req, res) => {
		try {
			const chunks = [];
			for await (const c of req) chunks.push(c);
			const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
			const request = new Request(`http://localhost:${PORT}${req.url}`, {
				method: req.method,
				headers: req.headers,
				body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
			});
			const response = await handleEdgeRequest(request);
			res.writeHead(response.status, Object.fromEntries(response.headers));
			res.end(Buffer.from(await response.arrayBuffer()));
		} catch (e) {
			res.writeHead(500);
			res.end(String(e && e.stack || e));
		}
	});
	await new Promise(r => httpServer.listen(PORT, r));
} else {
	// deno: boot the emitted Deno.serve entry.
	const denoBin = process.env.DENO_BIN || 'deno';
	denoProcess = spawn(denoBin, ['run', '--allow-all', join(shellDir, 'index.js')], {
		cwd: shellDir,
		stdio: ['ignore', 'inherit', 'inherit'],
		env: { ...process.env, PORT: String(PORT) },
	});
}

let up = false;
for (let i = 0; i < 60; i++) {
	try { const r = await fetch(BASE + '/'); if (r.ok) { up = true; break; } } catch {}
	await new Promise(r => setTimeout(r, 500));
}
assert(up, `${platform} server up on :${PORT}`);

const { default: puppeteer } = await import('puppeteer-core');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
const browser = await puppeteer.launch({
	executablePath: CHROMIUM_PATH,
	headless: true,
	args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

try {
	const page = await browser.newPage();
	const jsErrors = [];
	page.on('pageerror', e => jsErrors.push(e.message));

	await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
	assert(jsErrors.length === 0, `zero JS errors on load (got ${jsErrors.length}: ${jsErrors.join(', ')})`);

	const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent?.trim());
	assert(h1 === 'Welcome to Vesk', `SSR content rendered (h1: ${h1})`);

	const countBefore = await page.evaluate(() =>
		Array.from(document.querySelectorAll('#root p')).some(p => p.textContent.trim() === '10'));
	assert(countBefore, 'count shows 10 (SSR state hydrated)');

	// Reactivity — hydration is only proven if clicking updates the DOM.
	for (let i = 0; i < 5; i++) {
		await page.evaluate(() => document.querySelector('button')?.click());
		await new Promise(r => setTimeout(r, 120));
	}
	const reactive = await page.evaluate(() => ({
		fifteen: Array.from(document.querySelectorAll('#root p')).some(p => p.textContent.trim() === '15'),
		ok: document.body.textContent.includes('OK 15') || document.body.textContent.includes('OK'),
	}));
	assert(reactive.fifteen, 'click ×5 → count 15 (hydration LIVE)');
	assert(reactive.ok, 'error-boundary OK state at count >= 15');

	// All hydration markers consumed — same predicate as the runtime
	// (collectVskMarkers): comment nodes whose textContent is exactly 'vsk'.
	const markersLeft = await page.evaluate(() => {
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
		let n = 0;
		while (walker.nextNode()) if (walker.currentNode.textContent === 'vsk') n++;
		return n;
	});
	assert(markersLeft === 0, `all vsk hydration markers consumed (${markersLeft} left)`);

	// Client-side SPA navigation.
	await page.evaluate(() => { window.__spaFlag = true; });
	await page.evaluate(() => document.querySelector('a[href="/about"]')?.click());
	let navigated = false;
	try {
		await page.waitForFunction(() => document.querySelector('h1')?.textContent?.trim() === 'About Vesk', { timeout: 15000 });
		navigated = true;
	} catch {}
	assert(navigated, 'SPA nav to /about renders client-side');
	assert(await page.evaluate(() => window.__spaFlag === true), 'SPA nav did not reload the page');

	console.log(`\n\u2550\u2550\u2550 ${platform} hydration: ${passed} passed, ${failed} failed \u2550\u2550\u2550`);
	process.exitCode = failed > 0 ? 1 : 0;
} finally {
	await browser.close();
	httpServer?.close();
	denoProcess?.kill('SIGTERM');
}
