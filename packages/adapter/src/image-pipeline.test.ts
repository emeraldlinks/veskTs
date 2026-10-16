/**
 * Image pipeline tests.
 *
 * The shipped pipeline wrote variants to `<out>/static/images` while
 * `<Image src="/hero.png" />` emits `srcset="/hero-640w.png …"` — a path the
 * prod server never serves (the site root is `<out>/static/public`). Every
 * srcset URL 404'd while the build reported success. These tests assert that
 * for every emitted srcset URL there is a file on disk at the location the
 * server would look.
 *
 * Runs with or without `sharp`: without it the pipeline copies originals, and
 * the tests still assert reachability (a copy is still reachable).
 */
import { optimizeImages, collectImageRefs } from '@vesk/adapter/src/image-pipeline';
import { generateSrcsetForTest } from './image-pipeline.test-helpers';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;
function it(name: string, fn: () => void | Promise<void>) {
	return Promise.resolve()
		.then(fn)
		.then(() => { passed++; console.log(`  ✓ ${name}`); })
		.catch((e: unknown) => { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); });
}
function expect(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

/** A tiny valid PNG (1x1, transparent). */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
	'base64',
);

async function makeApp(pages: Record<string, string>, images: Record<string, Buffer>): Promise<{ appDir: string; outDir: string }> {
	const root = mkdtempSync(join(tmpdir(), 'vesk-img-'));
	const appDir = join(root, 'app');
	const pub = join(root, 'public');
	const outDir = join(root, '.vesk');
	mkdirSync(appDir, { recursive: true });
	mkdirSync(pub, { recursive: true });
	mkdirSync(outDir, { recursive: true });
	for (const [p, c] of Object.entries(pages)) {
		const f = join(appDir, p);
		mkdirSync(join(f, '..'), { recursive: true });
		writeFileSync(f, c);
	}
	for (const [p, buf] of Object.entries(images)) {
		const f = join(pub, p);
		mkdirSync(join(f, '..'), { recursive: true });
		writeFileSync(f, buf);
	}
	return { appDir, outDir, root } as { appDir: string; outDir: string };
}

/** Where the prod server looks for a site-root-relative URL. */
function servedPath(outDir: string, url: string): string {
	return resolve(outDir, 'static', 'public', url.replace(/^\//, ''));
}

async function main() {
	console.log('\nimage pipeline — srcset reachability');

	// ── the regression that shipped broken ──
	await it('writes every emitted srcset URL where the server will serve it', async () => {
		const { appDir, outDir, root } = await makeApp(
			{ 'page.vsk': `<Image src="/hero.png" alt="h" width={100} height={100} />` },
			{ 'hero.png': PNG },
		);
		try {
			await optimizeImages(appDir, outDir);
			const srcset = generateSrcsetForTest('/hero.png', [640, 1280]);
			expect(srcset.length > 0, 'srcset should not be empty');
			for (const url of srcset.map(s => s.url)) {
				const p = servedPath(outDir, url);
				expect(existsSync(p), `${url} should exist at ${p} — srcset URLs 404 otherwise`);
			}
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	// ── nested source paths keep their directory ──
	await it('preserves a subdirectory in the srcset URL', async () => {
		const { appDir, outDir, root } = await makeApp(
			{ 'page.vsk': `<Image src="/photos/hero.png" alt="h" />` },
			{ 'photos/hero.png': PNG },
		);
		try {
			await optimizeImages(appDir, outDir);
			const srcset = generateSrcsetForTest('/photos/hero.png', [640]);
			for (const { url } of srcset) {
				expect(existsSync(servedPath(outDir, url)), `${url} must be reachable`);
			}
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	// ── the server must also route the directory that was written ──
	await it('does not write to the unserved static/images directory', async () => {
		const { appDir, outDir, root } = await makeApp(
			{ 'page.vsk': `<Image src="/hero.png" alt="h" />` },
			{ 'hero.png': PNG },
		);
		try {
			await optimizeImages(appDir, outDir);
			expect(!existsSync(resolve(outDir, 'static', 'images', 'hero-640w.png')),
				'nothing should be written under static/images (no route serves it)');
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	// ── no silent failure when the source is missing ──
	await it('reports a missing source rather than silently succeeding', async () => {
		const { appDir, outDir, root } = await makeApp(
			{ 'page.vsk': `<Image src="/nope.png" alt="h" />` },
			{},
		);
		try {
			const errors: string[] = [];
			const orig = console.error;
			console.error = (m: unknown) => { errors.push(String(m)); };
			let result;
			try { result = await optimizeImages(appDir, outDir); }
			finally { console.error = orig; }
			expect(result.length === 0, 'a missing image produces no result');
			expect(errors.some(e => e.includes('not found')), `must warn about the missing file, got: ${errors.join('|')}`);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	// ── unsupported formats ──
	await it('rejects an unsupported format with a clear message', async () => {
		const { appDir, outDir, root } = await makeApp(
			{ 'page.vsk': `<Image src="/a.svg" alt="h" />` },
			{ 'a.svg': Buffer.from('<svg/>') },
		);
		try {
			const errors: string[] = [];
			const orig = console.error;
			console.error = (m: unknown) => { errors.push(String(m)); };
			try { await optimizeImages(appDir, outDir); }
			finally { console.error = orig; }
			expect(errors.some(e => e.includes('unsupported')), `expected an unsupported-format warning, got: ${errors.join('|')}`);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	// ── STRESS: many images across nested dirs, all must be reachable ──
	await it('stress: 25 images across 5 nested dirs are all reachable', async () => {
		const pages: Record<string, string> = {};
		const images: Record<string, Buffer> = {};
		const urls: string[] = [];
		const dirs = ['a', 'b/c', 'd/e/f', 'g', 'h/i'];
		for (let i = 0; i < 25; i++) {
			const dir = dirs[i % dirs.length];
			const name = `img${i}.png`;
			const url = `/${dir}/${name}`;
			urls.push(url);
			images[`${dir}/${name}`] = PNG;
		}
		pages['page.vsk'] = urls.map(u => `<Image src="${u}" alt="x" />`).join('\n');
		const { appDir, outDir, root } = await makeApp(pages, images);
		try {
			const results = await optimizeImages(appDir, outDir);
			expect(results.length === 25, `expected 25 processed images, got ${results.length}`);
			for (const u of urls) {
				const srcset = generateSrcsetForTest(u, [640, 1280]);
				for (const { url } of srcset) {
					expect(existsSync(servedPath(outDir, url)), `stress: ${url} unreachable`);
				}
			}
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	// ── STRESS: names that could collide or escape ──
	await it('stress: dotted and dotted-directory names stay reachable', async () => {
		const pages = {
			'page.vsk': [
				'<Image src="/v1.2.3.png" alt="a" />',
				'<Image src="/my.dir/file.name.png" alt="b" />',
				'<Image src="/noext" alt="c" />',
			].join('\n'),
		};
		const images: Record<string, Buffer> = {
			'v1.2.3.png': PNG,
			'my.dir/file.name.png': PNG,
			'noext': PNG,
		};
		const { appDir, outDir, root } = await makeApp(pages, images);
		try {
			await optimizeImages(appDir, outDir);
			for (const u of ['/v1.2.3.png', '/my.dir/file.name.png']) {
				for (const { url } of generateSrcsetForTest(u, [640])) {
					expect(existsSync(servedPath(outDir, url)), `${u} → ${url} unreachable`);
				}
			}
			// An extension-less source has no usable format and must be
			// REPORTED, not silently skipped — and must not be expected to
			// resolve, because nothing is generated for it.
			expect(!existsSync(servedPath(outDir, '/noext-640w.png')),
				'a rejected extension-less source must not half-produce a variant');
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	// ── STRESS: repeated refs must not collide ──
	await it('stress: the same image referenced twice still resolves', async () => {
		const { appDir, outDir, root } = await makeApp(
			{
				'page.vsk': '<Image src="/hero.png" alt="a" />\n<Image src="/hero.png" alt="b" />',
				'blog/page.vsk': '<Image src="/hero.png" alt="c" />',
			},
			{ 'hero.png': PNG },
		);
		try {
			await optimizeImages(appDir, outDir);
			for (const { url } of generateSrcsetForTest('/hero.png', [640])) {
				expect(existsSync(servedPath(outDir, url)), `${url} unreachable`);
			}
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	// ── STRESS: refs in components/ and layouts, not just page.vsk ──
	await it('stress: finds <Image> in a component file too', async () => {
		const { appDir, outDir, root } = await makeApp(
			{
				'components/Hero.vsk': '<Image src="/hero.png" alt="h" />',
				'page.vsk': '<Hero />',
			},
			{ 'hero.png': PNG },
		);
		try {
			const refs = collectImageRefs(appDir);
			expect(refs.some(r => r.src === '/hero.png'), `component ref should be discovered, got ${JSON.stringify(refs.map(r => r.src))}`);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	// ── output files are real files, not empty ──
	await it('writes non-empty files', async () => {
		const { appDir, outDir, root } = await makeApp(
			{ 'page.vsk': '<Image src="/hero.png" alt="h" />' },
			{ 'hero.png': PNG },
		);
		try {
			await optimizeImages(appDir, outDir);
			for (const { url } of generateSrcsetForTest('/hero.png', [640])) {
				const p = servedPath(outDir, url);
				expect(existsSync(p), `${p} missing`);
				expect(statSync(p).size > 0, `${p} is empty`);
			}
		} finally { rmSync(root, { recursive: true, force: true }); }
	});

	console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
	if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });