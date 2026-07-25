import { scanApiRoutes, matchApiUrl } from './api-routes.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let passed = 0;
let failed = 0;

function describe(name, fn) {
	console.log(`\n${name}`);
	fn();
}

function it(name, fn) {
	try {
		fn();
		passed++;
		console.log(`  ✓ ${name}`);
	} catch (e) {
		failed++;
		console.log(`  ✗ ${name}`);
		console.log(`    ${e.message}`);
	}
}

function expect(actual) {
	return {
		toBe(expected) {
			if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		},
		not: {
			toBeNull() {
				if (actual === null) throw new Error('Expected not null');
			},
		},
		toBeNull() {
			if (actual !== null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
		},
		toEqual(expected) {
			const a = JSON.stringify(actual);
			const e = JSON.stringify(expected);
			if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
		},
		toContain(expected) {
			if (!actual.includes(expected)) throw new Error(`Expected "${actual}" to contain "${expected}"`);
		},
	};
}

let dir;
function createTestDir(structure) {
	dir = join(tmpdir(), 'vesk-api-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
	mkdirSync(dir, { recursive: true });
	for (const [path, content] of Object.entries(structure)) {
		const fullPath = join(dir, path);
		mkdirSync(dirname(fullPath), { recursive: true });
		writeFileSync(fullPath, content || 'export async function GET() { return Response.json({}); }');
	}
	return dir;
}

function cleanup() {
	try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

function dirname(p) {
	const idx = p.lastIndexOf('/');
	return idx === -1 ? '.' : p.slice(0, idx) || '.';
}

function findNode(nodes, path) {
	for (const n of nodes) {
		if (n.path === path) return n;
		const child = findNode(n.children || [], path);
		if (child) return child;
	}
	return null;
}

describe('scanApiRoutes', () => {

	it('returns empty array for missing directory', () => {
		const result = scanApiRoutes('/nonexistent');
		expect(result.length).toBe(0);
	});

	it('scans basic route at root', () => {
		const d = createTestDir({ 'route.ts': '' });
		const tree = scanApiRoutes(d);
		expect(tree.length).toBe(1);
		expect(tree[0].path).toBe('');
		expect(tree[0].filePath).not.toBeNull();
		cleanup();
	});

	it('scans nested routes', () => {
		const d = createTestDir({
			'users/route.ts': '',
			'users/[id]/route.ts': '',
			'products/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		expect(tree.length).toBe(1);
		expect(tree[0].path).toBe('');
		const users = findNode(tree, 'users');
		expect(users).not.toBeNull();
		expect(users.filePath).not.toBeNull();
		const id = findNode(tree, ':id');
		expect(id).not.toBeNull();
		expect(id.isDynamic).toBe(true);
		cleanup();
	});

	it('skips route groups (parenthesized dirs)', () => {
		const d = createTestDir({
			'(marketing)/route.ts': '',
			'(marketing)/products/route.ts': '',
			'users/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		// (marketing) is a route group — its route.ts and children should be promoted
		const marketing = findNode(tree, '(marketing)');
		expect(marketing).toBeNull();
		const products = findNode(tree, 'products');
		expect(products).not.toBeNull();
		expect(products.filePath).not.toBeNull();
		cleanup();
	});

	it('skips private directories starting with _', () => {
		const d = createTestDir({
			'_internal/helper.ts': '',
			'public/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const internal = findNode(tree, '_internal');
		expect(internal).toBeNull();
		const pub = findNode(tree, 'public');
		expect(pub).not.toBeNull();
		cleanup();
	});

	it('detects dynamic segments [param]', () => {
		const d = createTestDir({ '[slug]/route.ts': '' });
		const tree = scanApiRoutes(d);
		const slug = findNode(tree, ':slug');
		expect(slug).not.toBeNull();
		expect(slug.isDynamic).toBe(true);
		cleanup();
	});

	it('detects catch-all segments [...param]', () => {
		const d = createTestDir({ '[...path]/route.ts': '' });
		const tree = scanApiRoutes(d);
		const path = findNode(tree, ':path');
		expect(path).not.toBeNull();
		expect(path.isCatchAll).toBe(true);
		cleanup();
	});
});

describe('matchApiUrl', () => {

	it('matches root route', () => {
		const d = createTestDir({ 'route.ts': '' });
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api');
		expect(match).not.toBeNull();
		cleanup();
	});

	it('matches nested static route', () => {
		const d = createTestDir({ 'users/route.ts': '' });
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/users');
		expect(match).not.toBeNull();
		cleanup();
	});

	it('matches dynamic segment', () => {
		const d = createTestDir({ 'users/[id]/route.ts': '' });
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/users/42');
		expect(match).not.toBeNull();
		expect(match.params.id).toBe('42');
		cleanup();
	});

	it('matches catch-all segment', () => {
		const d = createTestDir({ '[...path]/route.ts': '' });
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/a/b/c');
		expect(match).not.toBeNull();
		expect(match.params.path).toBe('a/b/c');
		cleanup();
	});

	it('returns null for unmatched route', () => {
		const d = createTestDir({ 'users/route.ts': '' });
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/products');
		expect(match).toBeNull();
		cleanup();
	});

	it('matches route groups', () => {
		const d = createTestDir({
			'(marketing)/products/route.ts': '',
			'users/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/products');
		expect(match).not.toBeNull();
		cleanup();
	});
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
