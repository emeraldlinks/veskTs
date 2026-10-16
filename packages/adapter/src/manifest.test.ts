/**
 * Manifest route-table tests.
 *
 * Every consumer of the manifest (prod-server, adapter dev-server, platform
 * handler) scans `routes` in order and takes the FIRST match, so both the
 * ORDER and the segment syntax written here are load-bearing routing behaviour.
 */
import { generateManifest } from '@vesk/adapter/src/manifest';

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

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);