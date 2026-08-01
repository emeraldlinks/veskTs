import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { scanRoutes, matchUrl, collectSources, generateRouteManifest } from '@vesk/compiler/src/router';

let passed = 0;
let failed = 0;

function test(name, fn) {
	try { fn(); passed++; console.log(`  ✓ ${name}`); }
	catch (e) { failed++; console.log(`  ✗ ${name} — ${e.message}`); }
}

function expect(actual) {
	return {
		toBe(expected) {
			if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		},
		toEqual(expected) {
			const a = JSON.stringify(actual);
			const b = JSON.stringify(expected);
			if (a !== b) throw new Error(`expected ${b}, got ${a}`);
		},
		toContain(expected) {
			if (!actual.includes(expected)) throw new Error(`expected to contain ${expected}`);
		},
		toBeTruthy() { if (!actual) throw new Error(`expected truthy, got ${actual}`); },
		toBeNull() { if (actual !== null) throw new Error(`expected null, got ${actual}`); },
		toBeGreaterThanOrEqual(expected) { if (actual < expected) throw new Error(`expected ${actual} >= ${expected}`); },
		not: {
			toBeNull() { if (actual === null) throw new Error(`expected not null`); },
		}
	};
}

function createFixture(files) {
	const tmp = mkdtempSync('/tmp/vesk-router-test-');
	for (const [path, content] of Object.entries(files)) {
		const fullPath = join(tmp, path);
		mkdirSync(join(fullPath, '..'), { recursive: true });
		writeFileSync(fullPath, content || '');
	}
	return tmp;
}

function cleanup(tmp) {
	try { rmSync(tmp, { recursive: true }); } catch {}
}

// ── Tests ──────────────────────────────────────────────────────

console.log('Route Scanner\n');

test('scans empty dir returns empty tree', () => {
	const tmp = createFixture({});
	const tree = scanRoutes(tmp);
	expect(tree.length).toBe(0);
	cleanup(tmp);
});

test('scans root page.vsk', () => {
	const tmp = createFixture({
		'app/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	expect(tree.length).toBe(1);
	expect(tree[0].fullPath).toBe('/');
	expect(tree[0].page).toBeTruthy();
	cleanup(tmp);
});

test('scans root layout + page', () => {
	const tmp = createFixture({
		'app/layout.vsk': '',
		'app/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	expect(tree.length).toBe(1);
	expect(tree[0].fullPath).toBe('/');
	expect(tree[0].layout).toBeTruthy();
	expect(tree[0].page).toBeTruthy();
	cleanup(tmp);
});

test('scans nested route', () => {
	const tmp = createFixture({
		'app/layout.vsk': '',
		'app/page.vsk': '',
		'app/about/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	expect(tree.length).toBe(1); // root node
	expect(tree[0].children.length).toBe(1);
	expect(tree[0].children[0].fullPath).toBe('/about');
	expect(tree[0].children[0].page).toContain('Page_');
	cleanup(tmp);
});

test('scans dynamic route [slug]', () => {
	const tmp = createFixture({
		'app/layout.vsk': '',
		'app/blog/[slug]/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	// root → blog → [slug]
	const blog = tree[0].children.find(c => c.path === 'blog');
	expect(blog).toBeTruthy();
	expect(blog.children.length).toBe(1);
	const slug = blog.children[0];
	expect(slug.isDynamic).toBe(true);
	expect(slug.path).toBe(':slug');
	expect(slug.fullPath).toBe('/blog/:slug');
	expect(slug.page).toBeTruthy();
	cleanup(tmp);
});

test('scans catch-all [...path]', () => {
	const tmp = createFixture({
		'app/docs/[...path]/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	// root → docs → [...path]
	const docs = tree[0].children.find(c => c.path === 'docs');
	expect(docs).toBeTruthy();
	expect(docs.children.length).toBe(1);
	const catchAll = docs.children[0];
	expect(catchAll.isCatchAll).toBe(true);
	expect(catchAll.path).toContain(':');
	cleanup(tmp);
});

test('route groups (parenthesized)', () => {
	const tmp = createFixture({
		'app/(marketing)/page.vsk': '',
		'app/(marketing)/layout.vsk': '',
		'app/(dashboard)/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	expect(tree.length).toBe(1); // groups are children of root
	expect(tree[0].children.length).toBe(2);
	for (const child of tree[0].children) {
		expect(child.isGroup).toBe(true);
	}
	cleanup(tmp);
});

test('private folders (_ prefix) are ignored', () => {
	const tmp = createFixture({
		'app/page.vsk': '',
		'app/_private/page.vsk': '',
		'app/_private/_components/helper.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	expect(tree[0].children.length).toBe(0);
	cleanup(tmp);
});

test('generates unique component names', () => {
	const tmp = createFixture({
		'app/page.vsk': '',
		'app/about/page.vsk': '',
		'app/blog/[slug]/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const sources = collectSources(tree);
	const names = [...sources.keys()];
	expect(names.length).toBe(3);
	// Page at root → Page_index (root dir = 'app', relative = '', parts = [])
	// Page at about → Page_about
	// Page at [slug] → slug (after cleaning brackets)
	expect(names.filter(n => n.startsWith('Page_')).length).toBe(3);
	cleanup(tmp);
});

console.log('\nRoute matching\n');

test('matches root path', () => {
	const tmp = createFixture({
		'app/layout.vsk': '',
		'app/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const match = matchUrl(tree, '/');
	expect(match).not.toBeNull();
	expect(match.nodes.length).toBeGreaterThanOrEqual(1);
	cleanup(tmp);
});

test('matches nested path', () => {
	const tmp = createFixture({
		'app/layout.vsk': '',
		'app/page.vsk': '',
		'app/about/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const match = matchUrl(tree, '/about');
	expect(match).not.toBeNull();
	const pageNode = match.nodes.find(n => n.page);
	expect(pageNode).toBeTruthy();
	cleanup(tmp);
});

test('matches dynamic segment and extracts params', () => {
	const tmp = createFixture({
		'app/blog/[slug]/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const match = matchUrl(tree, '/blog/hello-world');
	expect(match).not.toBeNull();
	expect(match.params.slug).toBe('hello-world');
	cleanup(tmp);
});

test('matches catch-all', () => {
	const tmp = createFixture({
		'app/docs/[...path]/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const match = matchUrl(tree, '/docs/guide/getting-started');
	expect(match).not.toBeNull();
	expect(match.params.path).toBe('guide/getting-started');
	cleanup(tmp);
});

console.log('\nRoute manifest generation\n');

test('generates import statements for all components', () => {
	const tmp = createFixture({
		'app/layout.vsk': '',
		'app/page.vsk': '',
		'app/about/page.vsk': '',
	});
	const tree = scanRoutes(join(tmp, 'app'));
	const code = generateRouteManifest(tree, { importPrefix: '../' });
	// Should have imports for page and layout components
	expect(code).toContain('import { Layout_');
	expect(code).toContain('import { Page_');
	expect(code).toContain('export default');
	cleanup(tmp);
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
console.log('All router tests passed!');
