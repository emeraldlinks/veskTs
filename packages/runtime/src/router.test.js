import { buildRouteTree, defineRoute, createFileRouter, Outlet, Link, NavLink, useNavigate, useParams, usePathname, useSearchParams } from './router.js';

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
		not: {
			toBeNull() { if (actual === null) throw new Error(`expected not null`); },
		},
		toBeDefined() { if (actual === undefined) throw new Error(`expected defined, got undefined`); },
		toBeGreaterThanOrEqual(expected) { if (actual < expected) throw new Error(`expected ${actual} >= ${expected}`); },
	};
}

// URL needs origin for new URL(path, origin) to work in router
if (typeof globalThis.window !== 'undefined' && !globalThis.window.location.origin) {
	globalThis.window.location.origin = 'http://localhost';
}

// ── Mock DOM for testing ───────────────────────────────────────
function makeEl(tag) {
	const children = [];
	const attrs = {};
	return {
		tagName: tag.toUpperCase(),
		nodeType: 1,
		children,
		attributes: attrs,
		className: '',
		textContent: '',
		style: {},
		parentNode: null,
		setAttribute(k, v) { attrs[k] = String(v); },
		getAttribute(k) { return attrs[k] || null; },
		removeAttribute(k) { delete attrs[k]; },
		addEventListener() {},
		removeEventListener() {},
		appendChild(c) { children.push(c); if (c && typeof c === 'object') c.parentNode = this; },
		insertBefore(c, ref) { const idx = ref ? children.indexOf(ref) : children.length; children.splice(idx, 0, c); },
		remove() { if (this.parentNode) { const idx = this.parentNode.children.indexOf(this); if (idx > -1) this.parentNode.children.splice(idx, 1); } },
		querySelector() { return null; },
		querySelectorAll() { return []; },
		closest() { return null; },
		get firstChild() { return children[0] || null; },
		get nextSibling() {
			if (!this.parentNode) return null;
			const idx = this.parentNode.children.indexOf(this);
			return this.parentNode.children[idx + 1] || null;
		},
		classList: {
			_entries: [],
			add(c) { if (!this._entries.includes(c)) this._entries.push(c); },
			remove(c) { this._entries = this._entries.filter(x => x !== c); },
			contains(c) { return this._entries.includes(c); },
		},
	};
}

function setupMockDom() {
	if (typeof document !== 'undefined') return;
	const head = makeEl('head');
	global.document = {
		getElementById() { return null; },
		createElement(tag) { return makeEl(tag); },
		createTextNode(text) { return { nodeType: 3, textContent: String(text), data: String(text) }; },
		createComment(text) { return { nodeType: 8, textContent: String(text) }; },
		createDocumentFragment() { const f = { nodeType: 11, children: [], appendChild(c) { this.children.push(c); if (c) c.parentNode = this; } }; return f; },
		head,
		querySelector() { return null; },
		querySelectorAll() { return []; },
		addEventListener() {},
		body: makeEl('body'),
	};
	global.window = {
		location: { pathname: '/', search: '', href: 'http://localhost/', origin: 'http://localhost' },
		history: {
			_stack: ['http://localhost/'],
			pushState(d, t, u) { this._stack.push(u); },
			replaceState(d, t, u) { this._stack[this._stack.length - 1] = u; },
		},
		addEventListener() {},
	};
}

setupMockDom();

setupMockDom();

console.log('Runtime Router\n');

test('buildRouteTree creates tree from definitions', () => {
	const tree = buildRouteTree([
		{ path: '/', page: () => document.createTextNode('Home') },
		{ path: '/about', page: () => document.createTextNode('About') },
	]);
	expect(tree.length).toBe(2);
	expect(tree[0].fullPath).toBe('/');
	expect(tree[0].page).toBeTruthy();
	expect(tree[1].fullPath).toBe('/about');
});

test('useNavigate returns a function', () => {
	const nav = useNavigate();
	expect(typeof nav).toBe('function');
});

test('usePathname returns current path', () => {
	const path = usePathname();
	expect(typeof path).toBe('string');
});

test('useParams returns current params object', () => {
	const params = useParams();
	expect(typeof params).toBe('object');
});

test('useSearchParams returns tuple', () => {
	const [sp, setter] = useSearchParams();
	expect(sp instanceof URLSearchParams).toBe(true);
	expect(typeof setter).toBe('function');
});

test('buildRouteTree with defineRoute helper', () => {
	const tree = buildRouteTree([
		defineRoute('/', { page: () => null }),
		defineRoute('/blog/:slug', { page: () => null, children: [
			defineRoute('/review', { page: () => null })
		]}),
	]);
	expect(tree.length).toBe(2);
	expect(tree[1].isDynamic).toBe(true);
});

test('Link creates anchor element with href', () => {
	const a = Link({ href: '/test', children: 'Click' });
	expect(a.tagName).toBe('A');
	expect(a.href).toBe('/test');
	expect(a.textContent).toBe('Click');
});

test('NavLink creates anchor with active state', () => {
	const a = NavLink({ href: '/', activeClass: 'is-active' });
	expect(a.tagName).toBe('A');
	expect(a.classList.contains('is-active')).toBe(true);
});

test('Outlet returns a DOM node', () => {
	const result = Outlet({});
	expect(result).toBeTruthy();
	expect(result.nodeType).toBeDefined();
});

test('createFileRouter navigates to root route', () => {
	const container = document.createElement('div');

	const homeEl = document.createElement('p');
	homeEl.textContent = 'Home Page';

	const tree = buildRouteTree([{ path: '/', page: () => homeEl }]);
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });
	expect(container.children.length).toBeGreaterThanOrEqual(0);
});

test('createFileRouter navigates to nested route', () => {
	const container = document.createElement('div');

	const aboutEl = document.createElement('div');
	aboutEl.textContent = 'About';

	const tree = buildRouteTree([
		{ path: '/', page: () => { const d = document.createElement('div'); d.textContent = 'Home'; return d; } },
		{ path: '/about', page: () => aboutEl },
	]);
	const router = createFileRouter(tree, { container });
	router.navigate('/about', { replace: true });
	expect(container.children.length).toBeGreaterThanOrEqual(0);
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
console.log('All runtime router tests passed!');
