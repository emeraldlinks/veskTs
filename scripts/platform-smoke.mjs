/**
 * Platform deployment smoke test.
 * Builds the test-app for a deployment target and asserts the emitted
 * artifacts match the platform shell contract (handler bundle, manifest,
 * static layout). Optionally boots the Deno target for a live request check.
 *
 * Usage: npx tsx scripts/platform-smoke.mjs <platform> [outBase]
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const appDir = resolve(root, 'test-app', 'app');
const publicDir = resolve(root, 'test-app', 'public');

const platform = process.argv[2];
if (!platform) {
	console.error('usage: node scripts/platform-smoke.mjs <vercel|netlify|cloudflare|deno|aws>');
	process.exit(1);
}
// Deployment shells emit to resolve(outDir,'..','.vesk/<platform>') — matching
// real `vesk build` where outDir=<project>/.vesk.
const deployRoot = resolve(process.argv[3] || join(root, 'test-app', '.vesk-smoke', platform));
const outBase = join(deployRoot, '.vesk');

let passed = 0;
let failed = 0;
function assert(cond, msg) {
	if (cond) { passed++; console.log(`  \u2713 ${msg}`); }
	else { failed++; console.log(`  \u2717 ${msg}`); }
}

console.log(`\u001b[36m=== Platform smoke: ${platform} ===\u001b[0m`);
console.log('Building...');

const { build } = await import('@vesk/adapter/src/index');
	// Real plugin wiring (tailwind etc.) from the app's vesk.config.ts — tsx
	// imports the TS config directly.
	const configModule = await import(resolve(root, 'test-app', 'vesk.config.ts'));
	const userConfig = configModule.default || {};
	await build(appDir, {
		outDir: outBase,
		publicDir,
		platform,
		plugins: userConfig.plugins || [],
	});

const EXPECT = {
	vercel: ['.vesk/vercel/functions/__index.func/index.js', '.vesk/vercel/config.json', '.vesk/vercel/manifest.json'],
	netlify: ['.vesk/netlify/functions/__index.js', '.vesk/netlify/manifest.json'],
	cloudflare: ['.vesk/cloudflare/_worker.js', '.vesk/cloudflare/manifest.json'],
	deno: ['.vesk/deno/index.js', '.vesk/deno/manifest.json'],
	aws: ['.vesk/aws/index.mjs', '.vesk/aws/template.yaml', '.vesk/aws/manifest.json'],
};

const expected = EXPECT[platform];
if (!expected) {
	console.error(`unknown platform: ${platform}`);
	process.exit(1);
}

for (const rel of expected) {
	assert(existsSync(join(deployRoot, rel)), `${rel} emitted`);
}

// Handler bundle must have substance (compiled universal handler + bootstrap).
const shellPrefix = '.vesk/' + platform;
const handlerRel = shellPrefix + '/' + (platform === 'vercel' ? 'functions/__index.func/index.js'
	: platform === 'netlify' ? 'functions/__index.js'
	: platform === 'cloudflare' ? '_worker.js'
	: platform === 'aws' ? 'index.mjs'
	: 'index.js');
assert(statSync(join(deployRoot, handlerRel)).size > 10000, `handler bundle has substance (${statSync(join(deployRoot, handlerRel)).size} bytes)`);

// Static assets present. Layout differs per shell: 'platform' static mode
// nests under the platform dir, 'embedded' keeps it at the outDir root.
const staticCandidates = [join(deployRoot, '.vesk', 'static'), join(deployRoot, shellPrefix, 'static')];
const staticDir = staticCandidates.find(d => existsSync(d) && readdirSync(d).length > 0);
assert(!!staticDir, `static assets emitted (${staticCandidates.join(' | ')})`);
let tailwindOk = false;
let tailwindSize = 0;
for (const d of staticDir ? [staticDir, ...staticCandidates] : staticCandidates) {
	const f = join(d, '_tailwind.css');
	if (existsSync(f)) {
		tailwindSize = statSync(f).size;
		if (tailwindSize > 10000) { tailwindOk = true; break; }
	}
}
assert(tailwindOk, `_tailwind.css fully resolved (${tailwindSize} bytes)`);

// Manifest sanity: correct platform and runtime class.
const manifest = JSON.parse(readFileSync(join(deployRoot, shellPrefix, 'manifest.json'), 'utf-8'));
assert(manifest.platform === platform, `manifest platform = ${manifest.platform}`);
const wantRuntime = (platform === 'cloudflare' || platform === 'deno') ? 'edge' : 'node';
assert(manifest.runtime === wantRuntime, `manifest runtime = ${manifest.runtime} (want ${wantRuntime})`);
assert(Array.isArray(manifest.routes) && manifest.routes.includes('/'), 'manifest routes include /');

// Deno live smoke: boot the emitted server and request /.
if (platform === 'deno') {
	const denoBin = process.env.DENO_BIN || 'deno';
	let denoAvailable = true;
	try {
		const { execFileSync } = await import('node:child_process');
		execFileSync(denoBin, ['--version'], { stdio: 'ignore' });
	} catch {
		denoAvailable = false;
		console.log(`  - deno not available (\`${denoBin}\`); skipping live serve check`);
	}
	if (denoAvailable) {
	console.log(`Booting deno (${denoBin}) on :3997...`);
	const { spawn } = await import('node:child_process');
	const child = spawn(denoBin, ['run', '--allow-all', join(deployRoot, shellPrefix, 'index.js')], {
		cwd: join(deployRoot, shellPrefix),
		stdio: ['ignore', 'inherit', 'inherit'],
		env: { ...process.env, PORT: '3997' },
	});
	let up = false;
	for (let i = 0; i < 40; i++) {
		try {
			const res = await fetch('http://localhost:3997/');
			if (res.ok) {
				up = true;
				const html = await res.text();
				assert(html.includes('Welcome to Vesk'), 'deno serve GET / → 200 with SSR content');
				break;
			}
		} catch {}
		await new Promise(r => setTimeout(r, 500));
	}
	if (!up) assert(false, 'deno serve came up on :3997');
	child.kill('SIGTERM');
	}
}

console.log(`\n\u2550\u2550\u2550 ${platform}: ${passed} passed, ${failed} failed \u2550\u2550\u2550`);
process.exit(failed > 0 ? 1 : 0);
