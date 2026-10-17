/**
 * Manifest route-table tests.
 *
 * Every consumer of the manifest (prod-server, adapter dev-server, platform
 * handler) scans `routes` in order and takes the FIRST match, so both the
 * ORDER and the segment syntax written here are load-bearing routing behaviour.
 */
import { generateManifest } from '@vesk/adapter/src/manifest';
import type { RouteNode } from '@vesk/adapter/src/types';

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
	try { fn(); passed++; console.log(`  ✓ ${name}`); }
	catch (e: unknown) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
function expect(actual: unknown) {
	return {
		toBe(expected: unknown) {
			if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		},
		toBeNull() {
			if (actual !== null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
		},
		toBeTruthy() {
			if (!actual) throw new Error(`Expected truthy, got ${JSON.stringify(actual)}`);
		},
		toEqual(expected: unknown) {
			const a = JSON.stringify(actual), b = JSON.stringify(expected);
			if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
		},
	};
}

type ApiNode = {
	path: string;
	fullPath: string;
	isDynamic: boolean;
	isCatchAll: boolean;
	filePath: string | null;
	children: ApiNode[];
};

function api(fullPath: string, opts: { dynamic?: boolean; catchAll?: boolean } = {}): ApiNode {
	const isCatchAll = opts.catchAll === true;
	const isDynamic = opts.dynamic === true || isCatchAll;
	return {
		path: isDynamic ? ':' + fullPath.split('/').filter(Boolean).pop() : fullPath.split('/').filter(Boolean).pop() || '',
		fullPath,
		isDynamic,
		isCatchAll,
		filePath: `/app/api${fullPath}/route.ts`,
		children: [],
	};
}

function apiPaths(nodes: ApiNode[]): string[] {
	return generateManifest([], [], nodes as never, [], false).routes
		.filter(r => r.type === 'api')
		.map(r => r.path);
}

function apiFunctions(nodes: ApiNode[]): Array<[string, string]> {
	return generateManifest([], [], nodes as never, [], false).routes
		.filter(r => r.type === 'api')
		.map(r => [r.path, r.function]);
}

/** Reference implementation of the consumer-side matcher (prod-server). */
function matchPath(pattern: string, pathname: string): Record<string, string> | null {
	const patternParts = pattern.split('/').filter(Boolean);
	const pathParts = pathname.split('/').filter(Boolean);
	let pi = 0, pp = 0;
	const params: Record<string, string> = {};
	while (pi < pathParts.length && pp < patternParts.length) {
		const seg = patternParts[pp];
		if (seg.startsWith('*')) {
			params[seg.slice(1)] = pathParts.slice(pi).join('/');
			pi = pathParts.length;
			pp++;
		} else if (seg.startsWith(':')) {
			params[seg.slice(1)] = pathParts[pi];
			pi++; pp++;
		} else if (seg === pathParts[pi]) {
			pi++; pp++;
		} else {
			return null;
		}
	}
	if (pp === patternParts.length - 1 && patternParts[pp].startsWith('*')) {
		params[patternParts[pp].slice(1)] = pathParts.slice(pi).join('/');
		pp++;
	}
	return pp === patternParts.length && pi === pathParts.length ? params : null;
}

/** What prod-server does: first entry that matches wins. */
function resolve(nodes: ApiNode[], pathname: string): Record<string, string> | null {
	for (const p of apiPaths(nodes)) {
		const params = matchPath(p, pathname);
		if (params) return params;
	}
	return null;
}

console.log('\ngenerateManifest — API route table');

it('emits a catch-all segment as *name, not :name', () => {
	const paths = apiPaths([api('/files/:rest', { catchAll: true })]);
	expect(paths).toEqual(['/api/files/*rest']);
});

it('emits a dynamic segment as :name', () => {
	expect(apiPaths([api('/users/:id', { dynamic: true })])).toEqual(['/api/users/:id']);
});

it('a catch-all route matches a multi-segment path in prod', () => {
	const nodes = [api('/files/:rest', { catchAll: true })];
	expect(resolve(nodes, '/api/files/a/b/c.png')).toEqual({ rest: 'a/b/c.png' });
	expect(resolve(nodes, '/api/files/a')).toEqual({ rest: 'a' });
	expect(resolve(nodes, '/api/files')).toEqual({ rest: '' });
});

it('a catch-all route does not swallow a sibling static route', () => {
	// Directory scan order puts `[...rest]` before `me`; the manifest must not.
	const nodes = [api('/files/:rest', { catchAll: true }), api('/files/me')];
	expect(resolve(nodes, '/api/files/me')).toEqual({});
});

it('static API routes sort ahead of dynamic siblings', () => {
	const nodes = [api('/users/:id', { dynamic: true }), api('/users/me')];
	expect(apiPaths(nodes)).toEqual(['/api/users/me', '/api/users/:id']);
	expect(resolve(nodes, '/api/users/me')).toEqual({});
	expect(resolve(nodes, '/api/users/42')).toEqual({ id: '42' });
});

it('dynamic sorts ahead of catch-all at the same position', () => {
	const nodes = [api('/x/:rest', { catchAll: true }), api('/x/:id', { dynamic: true })];
	expect(apiPaths(nodes)).toEqual(['/api/x/:id', '/api/x/*rest']);
});

it('still requires an exact segment count for dynamic routes', () => {
	expect(resolve([api('/users/:id', { dynamic: true })], '/api/users/a/b')).toBeNull();
});

// The emitted `function` must match the filename api-function.ts actually
// writes. These drifted apart once: the manifest stripped the leading
// character off EVERY segment (`posts` -> `osts`) while the writer did not,
// so `/api/posts` pointed at `server/api/osts.js` and every static API route
// 404'd in a production build while dev kept working.
it('maps a static route to its own filename', () => {
	expect(apiFunctions([api('/posts')])).toEqual([['/api/posts', 'server/api/posts.js']]);
});

it('maps a dynamic route to its name without the prefix', () => {
	expect(apiFunctions([api('/echo/:msg', { dynamic: true })]))
		.toEqual([['/api/echo/:msg', 'server/api/echo_msg.js']]);
});

it('maps a catch-all route to its name without the prefix', () => {
	expect(apiFunctions([api('/files/:rest', { catchAll: true })]))
		.toEqual([['/api/files/*rest', 'server/api/files_rest.js']]);
});

it('never decapitates a static segment, whatever its length', () => {
	for (const seg of ['a', 'ab', 'abc', 'bench', 'protected', 'posts']) {
		expect(apiFunctions([api('/' + seg)])).toEqual([['/api/' + seg, `server/api/${seg}.js`]]);
	}
});

console.log('\ngenerateManifest — SSR route precedence');

function ssrRoute(fullPath: string, opts: { dynamic?: boolean; catchAll?: boolean } = {}): RouteNode {
	const seg = fullPath.split('/').filter(Boolean).pop() || '';
	const isDynamic = opts.dynamic === true || opts.catchAll === true;
	return {
		path: fullPath, fullPath,
		isGroup: false, isDynamic, isCatchAll: opts.catchAll === true,
		page: 'P', layout: null, loading: null, error: null, notFound: null,
		offline: null, network: null, hasMiddleware: false, children: [],
		sourceDir: '', segmentCount: seg.startsWith(':') ? 1 : 1,
	};
}

function ssrPaths(nodes: RouteNode[]): string[] {
	// The SSR table is the SECOND argument (`routes` is the tree the manifest is
	// derived from; `ssrRoutes` is the flattened list actually emitted).
	return generateManifest([], nodes, [], [], false).routes
		.filter(r => r.type === 'ssr')
		.map(r => r.path);
}

function resolveSsr(nodes: RouteNode[], pathname: string): string | null {
	for (const p of ssrPaths(nodes)) {
		if (matchPath(p, pathname)) return p;
	}
	return null;
}

// Every consumer takes the FIRST exact-length match, so the emitted ORDER is the
// precedence. This was already fixed for API entries; SSR entries came out in
// directory-scan order, so `app/docs/[slug]` scanned before `app/docs/boom` made
// the static page unreachable in production.
it('a static SSR route outranks a dynamic sibling', () => {
	expect(resolveSsr([ssrRoute('/docs/:slug', { dynamic: true }), ssrRoute('/docs/boom')], '/docs/boom')).toBe('/docs/boom');
});

it('the order does not depend on which sibling the scan reached first', () => {
	expect(ssrPaths([ssrRoute('/docs/:slug', { dynamic: true }), ssrRoute('/docs/boom')]))
		.toEqual(['/docs/boom', '/docs/:slug']);
	expect(ssrPaths([ssrRoute('/docs/boom'), ssrRoute('/docs/:slug', { dynamic: true })]))
		.toEqual(['/docs/boom', '/docs/:slug']);
});

it('a catch-all SSR route sorts below a dynamic sibling', () => {
	expect(ssrPaths([ssrRoute('/files/*rest', { catchAll: true }), ssrRoute('/files/:id', { dynamic: true })]))
		.toEqual(['/files/:id', '/files/*rest']);
});

it('deeper specificity wins within the same prefix', () => {
	expect(ssrPaths([ssrRoute('/a/:x/c'), ssrRoute('/a/b/c')])).toEqual(['/a/b/c', '/a/:x/c']);
});

it('routes of different lengths both survive the sort', () => {
	expect(ssrPaths([ssrRoute('/'), ssrRoute('/docs'), ssrRoute('/docs/:slug', { dynamic: true })]).length).toBe(3);
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);