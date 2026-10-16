import { scanApiRoutes, matchApiUrl } from '@vesk/compiler/src/api-routes';
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

	// ── A dynamic child must not swallow its parent's collection URL ──

	it('collection route is not swallowed by a dynamic child', () => {
		const d = createTestDir({
			'users/route.ts': '',
			'users/[id]/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/users');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/users');
		expect(match.params).toEqual({});
		cleanup();
	});

	it('dynamic child still matches its own segment', () => {
		const d = createTestDir({
			'users/route.ts': '',
			'users/[id]/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/users/42');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/users/:id');
		expect(match.params.id).toBe('42');
		cleanup();
	});

	it('collection route with a static sibling is not swallowed either', () => {
		const d = createTestDir({
			'users/route.ts': '',
			'users/me/route.ts': '',
			'users/[id]/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/users');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/users');
		cleanup();
	});

	it('a deeper dynamic grandchild cannot match an exhausted URL', () => {
		const d = createTestDir({
			'users/[id]/posts/route.ts': '',
			'users/[id]/posts/[pid]/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		// /api/users/42/posts — the [pid] leaf has no segment left to consume
		const match = matchApiUrl(tree, '/api/users/42/posts');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/users/:id/posts');
		expect(match.params).toEqual({ id: '42' });
		cleanup();
	});

	it('nested collection route under a dynamic parent is not swallowed', () => {
		const d = createTestDir({
			'users/[id]/posts/route.ts': '',
			'users/[id]/posts/[pid]/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/users/42/posts/9');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/users/:id/posts/:pid');
		expect(match.params).toEqual({ id: '42', pid: '9' });
		cleanup();
	});

	it('falls back to the dynamic handler when its children do not match', () => {
		const d = createTestDir({
			'users/[id]/route.ts': '',
			'users/[id]/posts/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		// `posts` must not steal the request from `[id]`'s own handler
		const match = matchApiUrl(tree, '/api/users/42');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/users/:id');
		expect(match.params).toEqual({ id: '42' });
		cleanup();
	});

	it('does not leak params from a failed branch into the fallback match', () => {
		const d = createTestDir({
			'items/[id]/route.ts': '',
			'items/[id]/nested/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		// `nested` claims `deep`, then fails (no `deep` segment left to give it)
		// — the fallback must not keep `nested`'s param behind.
		const match = matchApiUrl(tree, '/api/items/7/nested');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/items/:id/nested');
		expect(match.params).toEqual({ id: '7' });
		cleanup();
	});

	// ── Static beats dynamic regardless of directory order ──

	it('static sibling wins over a dynamic sibling', () => {
		const d = createTestDir({
			// '[id]' sorts before 'me' in readdir order — precedence must not
			// depend on that.
			'users/[id]/route.ts': '',
			'users/me/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/users/me');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/users/me');
		expect(match.params).toEqual({});
		cleanup();
	});

	it('static sibling wins over a dynamic sibling with a deeper dynamic child', () => {
		const d = createTestDir({
			'users/[id]/posts/route.ts': '',
			'users/me/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/users/me');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/users/me');
		cleanup();
	});

	it('dynamic sibling still matches a non-static segment', () => {
		const d = createTestDir({
			'users/[id]/route.ts': '',
			'users/me/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/users/42');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/users/:id');
		expect(match.params.id).toBe('42');
		cleanup();
	});

	// ── Catch-all ──

	it('catch-all collects a nested multi-segment tail', () => {
		const d = createTestDir({
			'files/[...rest]/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/files/a/b/c.png');
		expect(match).not.toBeNull();
		expect(match.params.rest).toBe('a/b/c.png');
		cleanup();
	});

	it('catch-all yields an empty tail rather than an undefined param', () => {
		const d = createTestDir({
			'files/[...rest]/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/files');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/files/:rest');
		expect(match.params.rest).toBe('');
		cleanup();
	});

	it('catch-all does not match when its parent consumed the whole URL', () => {
		const d = createTestDir({
			'files/route.ts': '',
			'files/[...rest]/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		// `files/route.ts` is the match — the catch-all has nothing left to eat
		const match = matchApiUrl(tree, '/api/files');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/files');
		expect(match.params).toEqual({});
		cleanup();
	});

	it('catch-all is preferred over a dynamic sibling with no handler', () => {
		const d = createTestDir({
			// `[id]` is a pure segment (no route.ts of its own), so it cannot
			// answer `/a/b` on its own and the catch-all takes the whole tail.
			'[id]/nested/route.ts': '',
			'[...rest]/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/a/b');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/:rest');
		expect(match.params.rest).toBe('a/b');
		cleanup();
	});

	it('dynamic sibling with a handler is tried before a catch-all', () => {
		const d = createTestDir({
			'[id]/route.ts': '',
			'[...rest]/route.ts': '',
		});
		const tree = scanApiRoutes(d);
		const match = matchApiUrl(tree, '/api/7');
		expect(match).not.toBeNull();
		expect(match.node.fullPath).toBe('/:id');
		expect(match.params).toEqual({ id: '7' });
		cleanup();
	});
});

// ── buildWebRequest body cap ─────────────────────────────────────

function makeBody(buf) {
	return { [Symbol.asyncIterator]: async function* () { yield buf; } };
}

(async () => {
  console.log('\nbuildWebRequest body limit');
  try {
    const { buildWebRequest, tooLargeError } = await import('@vesk/compiler/src/api-routes');
    // under the cap: json() works
    const small = buildWebRequest(
      { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, ...makeBody(Buffer.from('{"a":1}')) },
      'http://localhost/x',
      undefined,
      { maxBodyBytes: 1024 }
    );
    expect(await small.json()).toEqual({ a: 1 });

    // over the cap: getBody throws a 413
    let status = 0;
    const big = buildWebRequest(
      { method: 'POST', headers: { host: 'localhost' }, ...makeBody(Buffer.alloc(2048, 7)) },
      'http://localhost/x',
      undefined,
      { maxBodyBytes: 1024 }
    );
    try { await big.text(); } catch (e) { status = e.status || 0; }
    expect(status).toBe(413);

    const err = tooLargeError(1024);
    expect(err.status).toBe(413);
    passed += 3;
    console.log('  ✓ enforces maxBodyBytes with 413 (small ok, big rejected)');
  } catch (e) {
    failed++;
    console.log(`  ✗ body cap — ${e.message}`);
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  process.exit(failed > 0 ? 1 : 0);
})();
