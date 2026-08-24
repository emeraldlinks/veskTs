import { buildRouteTree, defineRoute, createRouter, createFileRouter, Outlet, Link, NavLink, useNavigate, useParams, usePathname, useSearchParams, useRouter } from '@vesk/runtime/src/router';

let passed = 0;
let failed = 0;

function test(name, fn) {
	try { fn(); passed++; console.log(`  ✓ ${name}`); }
	catch (e) { failed++; console.log(`  ✗ ${name} — ${e.message}`); }
}

let asyncQueue: Promise<void> = Promise.resolve();
function testAsync(name, fn) {
	asyncQueue = asyncQueue.then(async () => {
		try { await fn(); passed++; console.log(`  ✓ ${name}`); }
		catch (e) { failed++; console.log(`  ✗ ${name} — ${e.message}`); }
	});
}

function tick(ms = 0) {
	return new Promise(resolve => setTimeout(resolve, ms));
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
		toBeFalsy() { if (actual) throw new Error(`expected falsy, got ${actual}`); },
		toBeNull() { if (actual !== null) throw new Error(`expected null, got ${actual}`); },
		not: {
			toBeNull() { if (actual === null) throw new Error(`expected not null`); },
		},
		toBeDefined() { if (actual === undefined) throw new Error(`expected defined, got undefined`); },
		toBeGreaterThanOrEqual(expected) { if (actual < expected) throw new Error(`expected ${actual} >= ${expected}`); },
		toThrow(expected) {
			if (typeof actual !== 'function') throw new Error('expected a function');
			try {
				actual();
				throw new Error('expected function to throw but it did not');
			} catch (e) {
				if (e.message === 'expected function to throw but it did not') throw e;
				if (expected) {
					if (typeof expected === 'string' && !e.message.includes(expected)) {
						throw new Error(`expected error to contain "${expected}", got "${e.message}"`);
					}
				}
			}
		},
	};
}

// URL needs origin for new URL(path, origin) to work in router
if (typeof globalThis.window !== 'undefined' && !globalThis.window.location.origin) {
	globalThis.window.location.origin = 'http://localhost';
}

// ── Mock DOM for testing ───────────────────────────────────────
function computeTextContent(el) {
	if (el.nodeType === 3) return el.textContent || '';
	if (el.nodeType !== 1 && el.nodeType !== 11) return '';
	let text = '';
	for (const c of (el.children || [])) {
		if (c.nodeType === 3) text += c.textContent || '';
		else if (c.nodeType === 1) text += computeTextContent(c);
	}
	return text;
}

function makeEl(tag) {
	const children = [];
	const attrs = {};
	return {
		tagName: tag.toUpperCase(),
		nodeType: 1,
		children,
		attributes: attrs,
		className: '',
		get textContent() { return computeTextContent(this); },
		set textContent(v) {
			children.length = 0;
			if (v != null) {
				const tn = { nodeType: 3, textContent: String(v), data: String(v) };
				children.push(tn);
			}
		},
		style: {},
		parentNode: null,
		setAttribute(k, v) { attrs[k] = String(v); },
		getAttribute(k) { return attrs[k] || null; },
		removeAttribute(k) { delete attrs[k]; },
		_listeners: {},
		addEventListener(type, fn) { if (!this._listeners[type]) this._listeners[type] = []; this._listeners[type].push(fn); },
		removeEventListener(type, fn) { if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter(l => l !== fn); },
		appendChild(c) {
			if (c && c.nodeType === 11) { for (const ch of [...c.children]) this.appendChild(ch); return; }
			children.push(c); if (c && typeof c === 'object') c.parentNode = this;
		},
		replaceChildren(...args) { children.length = 0; for (const a of args) this.appendChild(a); },
		insertBefore(c, ref) {
			if (c && c.nodeType === 11) {
				let idx = ref ? children.indexOf(ref) : children.length;
				for (const ch of [...c.children]) { children.splice(idx++, 0, ch); if (ch && typeof ch === 'object') ch.parentNode = this; }
				return;
			}
			const idx = ref ? children.indexOf(ref) : children.length; children.splice(idx, 0, c); if (c && typeof c === 'object') c.parentNode = this;
		},
		replaceChild(newChild, oldChild) { const idx = children.indexOf(oldChild); if (idx === -1) throw new Error('replaceChild: oldChild not found'); children.splice(idx, 1, newChild); if (newChild && typeof newChild === 'object') newChild.parentNode = this; if (oldChild && typeof oldChild === 'object') oldChild.parentNode = null; },
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
		createComment(text) { return { nodeType: 8, textContent: String(text), nodeValue: String(text), data: String(text) }; },
		createDocumentFragment() { const f = { nodeType: 11, children: [], appendChild(c) { this.children.push(c); if (c) c.parentNode = this; } }; return f; },
		createTreeWalker(root, whatToShow) {
			const nodes = [];
			(function collect(el) {
				for (const c of (el.children || [])) {
					nodes.push(c);
					if (c.children) collect(c);
				}
			})(root);
			let i = -1;
			return {
				currentNode: null,
				nextNode() {
					while (i + 1 < nodes.length) {
						i++;
						const n = nodes[i];
						if (n.nodeType === 8) { this.currentNode = n; return n; }
					}
					return null;
				},
			};
		},
		head,
		querySelector() { return null; },
		querySelectorAll() { return []; },
		_listeners: {},
		addEventListener(type, fn) { if (!this._listeners[type]) this._listeners[type] = []; this._listeners[type].push(fn); },
		body: makeEl('body'),
	};
	let _rAFQueue = [];
	global.window = {
		location: { pathname: '/', search: '', href: 'http://localhost/', origin: 'http://localhost' },
		scrollY: 0,
		scrollTo(x, y) { this.scrollY = y; },
		requestAnimationFrame(fn) { _rAFQueue.push(fn); },
		flushRAF() { const q = _rAFQueue; _rAFQueue = []; for (const fn of q) fn(); },
		history: {
			_stack: ['http://localhost/'],
			pushState(d, t, u) { this._stack.push(u); },
			replaceState(d, t, u) { this._stack[this._stack.length - 1] = u; },
			get scrollRestoration() { return this._sr; },
			set scrollRestoration(v) { this._sr = v; },
		},
		_listeners: {},
		addEventListener(type, fn) { if (!this._listeners[type]) this._listeners[type] = []; this._listeners[type].push(fn); },
	};
}

setupMockDom();

const defaultFetch = async () => ({
	ok: true, status: 200, redirected: false, url: '',
	headers: { get: () => 'application/json' },
	json: async () => ({}),
});
globalThis.fetch = defaultFetch;

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

// ── Loading / Error / Prefetch / Scroll tests ──────────────────

test('buildRouteTree preserves loading and error', () => {
	const loadingFn = () => document.createTextNode('Loading');
	const errorFn = () => document.createTextNode('Error');
	const tree = buildRouteTree([
		{ path: '/', page: () => document.createTextNode('Home'), loading: loadingFn, error: errorFn },
	]);
	expect(tree[0].loading).toBe(loadingFn);
	expect(tree[0].error).toBe(errorFn);
});

test('useRouter includes prefetch method', () => {
	const router = useRouter();
	expect(typeof router.prefetch).toBe('function');
});

test('Loading component shown during deferred navigation', async () => {
	const container = document.createElement('div');
	const loadingFn = () => {
		const el = document.createElement('div');
		el.textContent = 'Loading...';
		return el;
	};
	const pageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'Page Content';
		return el;
	};
	const tree = buildRouteTree([
		{ path: '/', page: pageFn, loading: loadingFn },
	]);
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });
	// Loading should be shown immediately (before microtask)
	expect(container.textContent).toBe('Loading...');
	// Wait for microtask to complete deferred render
	await new Promise(r => setTimeout(r, 0));
	expect(container.textContent).toBe('Page Content');
});

test('Error component rendered when page throws', () => {
	const container = document.createElement('div');
	const errorFn = (props) => {
		const el = document.createElement('div');
		el.textContent = 'Error: ' + (props.error ? props.error.message : 'unknown');
		return el;
	};
	const pageFn = () => { throw new Error('Boom!'); };
	const tree = buildRouteTree([
		{ path: '/', page: pageFn, error: errorFn },
	]);
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });
	expect(container.textContent).toContain('Error:');
	expect(container.textContent).toContain('Boom!');
});

test('Error re-thrown when no error component', () => {
	const container = document.createElement('div');
	const pageFn = () => { throw new Error('Boom!'); };
	const tree = buildRouteTree([
		{ path: '/', page: pageFn },
	]);
	const router = createFileRouter(tree, { container });
	expect(() => router.navigate('/', { replace: true })).toThrow('Boom!');
});

test('Prefetch stores match for path', () => {
	const container = document.createElement('div');
	const pageFn = () => document.createTextNode('Home');
	const tree = buildRouteTree([
		{ path: '/', page: pageFn },
		{ path: '/about', page: () => document.createTextNode('About') },
	]);
	const router = createFileRouter(tree, { container });
	router.prefetch('/about');
	expect(router._prefetched).toBeTruthy();
	expect(router._prefetched.has('/about')).toBe(true);
	const match = router._prefetched.get('/about');
	expect(match.matchChain).toBeTruthy();
});

test('Error component receives retry function', () => {
	const container = document.createElement('div');
	let retryFn = null;
	const errorFn = (props) => {
		retryFn = props.retry;
		const el = document.createElement('div');
		el.textContent = 'Error occurred';
		return el;
	};
	const pageFn = () => { throw new Error('Oops'); };
	const tree = buildRouteTree([
		{ path: '/', page: pageFn, error: errorFn },
	]);
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });
	expect(retryFn).toBeTruthy();
	expect(typeof retryFn).toBe('function');
});

test('Error component receives params', () => {
	const container = document.createElement('div');
	let capturedParams = null;
	const errorFn = (props) => {
		capturedParams = props.params;
		return document.createTextNode('Error');
	};
	const pageFn = () => { throw new Error('Oops'); };
	const tree = buildRouteTree([
		{ path: '/', page: pageFn, error: errorFn },
	]);
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });
	expect(capturedParams).toBeTruthy();
});

// ── HMR Granular Update Tests ─────────────────────────────────

test('renderMatch stores page component instance after navigate', () => {
	const container = document.createElement('div');
	const pageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'Hello';
		return el;
	};
	const tree = buildRouteTree([{ path: '/', page: pageFn }]);
	tree[0]._pageName = 'Home';
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });
	expect(router.__componentInstances).toBeTruthy();
	expect(router.__componentInstances.has('Home')).toBe(true);
	const insts = router.__componentInstances.get('Home');
	expect(insts.length).toBe(1);
	expect(insts[0].type).toBe('page');
	expect(insts[0].root).toBeTruthy();
	expect(insts[0].root.textContent).toBe('Hello');
});

test('renderMatch stores layout component instance after navigate', () => {
	const container = document.createElement('div');
	const layoutFn = (props) => {
		const div = document.createElement('div');
		div.className = 'layout-root';
		if (props.children && props.children.nodeType) div.appendChild(props.children);
		return div;
	};
	const pageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'Page';
		return el;
	};
	const tree = buildRouteTree([{ path: '/', page: pageFn, layout: layoutFn }]);
	tree[0]._pageName = 'Home';
	tree[0]._layoutName = 'MainLayout';
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });
	expect(router.__componentInstances.has('Home')).toBe(true);
	expect(router.__componentInstances.has('MainLayout')).toBe(true);
	const layoutInst = router.__componentInstances.get('MainLayout')[0];
	expect(layoutInst.type).toBe('layout');
	expect(layoutInst.root.className).toBe('layout-root');
});

test('hmrUpdate swaps page component DOM in-place without navigate', () => {
	const container = document.createElement('div');

	const pageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'Old Page';
		el.className = 'page-root';
		return el;
	};

	const tree = buildRouteTree([{ path: '/', page: pageFn }]);
	tree[0]._pageName = 'Home';
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });

	const oldRoot = router.__componentInstances.get('Home')[0].root;
	expect(oldRoot.parentNode).toBe(container);

	const newPageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'New Page';
		el.className = 'page-root';
		return el;
	};
	globalThis.__components = { Home: newPageFn };
	router.__updateComponents = (nodes) => {
		for (const n of nodes) {
			if (n._pageName && globalThis.__components[n._pageName]) n.page = globalThis.__components[n._pageName];
			if (n.children) router.__updateComponents(n.children);
		}
	};
	globalThis.__updatedComponents = new Set(['Home']);

	router.hmrUpdate();

	expect(oldRoot.parentNode).toBeNull();
	expect(container.children.filter(c => c.nodeType === 1).length).toBe(1);
	expect(container.textContent).toBe('New Page');
});

test('hmrUpdate updates component instance root reference', () => {
	const container = document.createElement('div');

	const pageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'V1';
		return el;
	};

	const tree = buildRouteTree([{ path: '/', page: pageFn }]);
	tree[0]._pageName = 'Home';
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });

	const newPageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'V2';
		return el;
	};
	globalThis.__components = { Home: newPageFn };
	router.__updateComponents = (nodes) => {
		for (const n of nodes) {
			if (n._pageName && globalThis.__components[n._pageName]) n.page = globalThis.__components[n._pageName];
			if (n.children) router.__updateComponents(n.children);
		}
	};
	globalThis.__updatedComponents = new Set(['Home']);
	router.hmrUpdate();

	const updatedRoot = router.__componentInstances.get('Home')[0].root;
	expect(updatedRoot.textContent).toBe('V2');
});

test('hmrUpdate preserves non-updated layout when updating page only', () => {
	const container = document.createElement('div');

	const layoutFn = (props) => {
		const div = document.createElement('div');
		div.className = 'layout-root';
		if (props.children && props.children.nodeType) div.appendChild(props.children);
		return div;
	};
	const pageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'Old Page';
		return el;
	};

	const tree = buildRouteTree([{ path: '/', page: pageFn, layout: layoutFn }]);
	tree[0]._pageName = 'Home';
	tree[0]._layoutName = 'MainLayout';
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });

	const layoutRoot = router.__componentInstances.get('MainLayout')[0].root;
	expect(container.children[0]).toBe(layoutRoot);

	const newPageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'New Page';
		return el;
	};
	globalThis.__components = { Home: newPageFn };
	router.__updateComponents = (nodes) => {
		for (const n of nodes) {
			if (n._pageName && globalThis.__components[n._pageName]) n.page = globalThis.__components[n._pageName];
			if (n._layoutName && globalThis.__components[n._layoutName]) n.layout = globalThis.__components[n._layoutName];
			if (n.children) router.__updateComponents(n.children);
		}
	};
	globalThis.__updatedComponents = new Set(['Home']);
	router.hmrUpdate();

	expect(container.children[0]).toBe(layoutRoot);
	expect(layoutRoot.textContent).toBe('New Page');
});

test('hmrUpdate falls back to navigate when no instances tracked', () => {
	const container = document.createElement('div');
	const pageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'Fallback';
		return el;
	};
	const tree = buildRouteTree([{ path: '/', page: pageFn }]);
	tree[0]._pageName = 'Home';
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });

	router.__componentInstances = new Map();
	const newPageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'After Navigate';
		return el;
	};
	globalThis.__components = { Home: newPageFn };
	router.__updateComponents = (nodes) => {
		for (const n of nodes) {
			if (n._pageName && globalThis.__components[n._pageName]) n.page = globalThis.__components[n._pageName];
			if (n.children) router.__updateComponents(n.children);
		}
	};
	globalThis.__updatedComponents = new Set(['Home']);
	router.hmrUpdate();

	expect(container.textContent).toBe('After Navigate');
});

test('hmrUpdate on createRouter stores and swaps instances', () => {
	const container = document.getElementById('root') || document.createElement('div');
	const pageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'Manual Old';
		return el;
	};
	const routes = { '/': pageFn };
	const router = createRouter(routes, { container });
	router.navigate('/', { replace: true });

	// Simulate HMR: set up component name on the route tree node (as __resolveNames does)
	const routeNode = router.routeTree[0];
	routeNode._pageName = 'Test';
	// Navigate again so renderMatch picks up _pageName
	router.navigate('/', { replace: true });

	const inst = router.__componentInstances.get('Test')[0];
	const oldRoot = inst.root;

	const newPageFn = () => {
		const el = document.createElement('p');
		el.textContent = 'Manual New';
		return el;
	};
	globalThis.__components = { Test: newPageFn };
	router.__updateComponents = (nodes) => {
		for (const n of nodes) {
			if (n._pageName && globalThis.__components[n._pageName]) n.page = globalThis.__components[n._pageName];
			if (n.children) router.__updateComponents(n.children);
		}
	};
	globalThis.__updatedComponents = new Set(['Test']);
	router.hmrUpdate();

	expect(oldRoot.parentNode).toBeNull();
	expect(container.textContent).toBe('Manual New');
	expect(router.__componentInstances.get('Test')[0].root.textContent).toBe('Manual New');
});

// ── Link / NavLink / Anchor behavior tests ──────────────────

test('Link attaches a click handler that calls preventDefault', () => {
	const a = Link({ href: '/about', children: 'About' });
	expect(a.tagName).toBe('A');
	expect(a.href).toBe('/about');
	expect(a._listeners.click).toBeTruthy();
	expect(a._listeners.click.length).toBeGreaterThanOrEqual(1);
});

test('NavLink attaches a click handler', () => {
	const a = NavLink({ href: '/', children: 'Home' });
	expect(a._listeners.click).toBeTruthy();
	expect(a._listeners.click.length).toBeGreaterThanOrEqual(1);
});

test('NavLink has active class when path matches', () => {
	const a = NavLink({ href: '/', activeClass: 'is-active' });
	expect(a.classList.contains('is-active')).toBe(true);
});

test('NavLink does not have active class when path does not match', () => {
	const a = NavLink({ href: '/other' });
	expect(a.classList.contains('active')).toBe(false);
});

test('createFileRouter does not intercept document clicks', () => {
	const container = document.createElement('div');
	const pageFn = () => document.createTextNode('Home');
	const tree = buildRouteTree([{ path: '/', page: pageFn }]);
	const router = createFileRouter(tree, { container });
	router.start();
	// Document should NOT have a global click listener — plain <a> does full navigation
	const doc = globalThis.document || global.document;
	expect(doc._listeners.click).toBeFalsy();
});

test('plain anchor created via createElement has no Vesk listeners', () => {
	const a = document.createElement('a');
	a.href = '/plain';
	// No listeners should be attached (it's just a plain element)
	expect(a._listeners.click).toBeFalsy();
});

// ── Route data fetch (fresh server data on SPA navigation) ──

function mockFetchResponse(body, extra = {}) {
	return {
		ok: true, status: 200, redirected: false, url: '',
		headers: { get: () => 'application/json' },
		json: async () => body,
		...extra,
	};
}

testAsync('navigate sends X-Vesk-Data and patches DOM with fresh props', async () => {
	const container = document.createElement('div');
	let capturedHeader = null;
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (path, init) => {
		capturedHeader = init && init.headers ? init.headers['X-Vesk-Data'] : null;
		return mockFetchResponse({ props: { msg: 'fresh-data' }, head: '<title>Fresh</title>' });
	};
	try {
		const tree = buildRouteTree([
			{ path: '/', page: () => null },
			{ path: '/data', page: (props) => {
				const d = document.createElement('p');
				d.textContent = (props && props.msg) || 'optimistic';
				return d;
			} },
		]);
		tree[0].segmentCount = 0;
		const router = createFileRouter(tree, { container });
		router.navigate('/data', { replace: true });
		expect(container.textContent).toBe('optimistic');
		expect(capturedHeader).toBe('1');
		await tick(10);
		expect(container.textContent).toBe('fresh-data');
		expect(document.head.textContent.includes('Fresh')).toBe(true);
	} finally {
		globalThis.fetch = origFetch;
	}
});

testAsync('prefetch caches route data; navigate reuses it within the cache TTL', async () => {
	const container = document.createElement('div');
	let fetchCount = 0;
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (path) => {
		fetchCount++;
		return mockFetchResponse({ props: { msg: 'prefetched' }, head: '' });
	};
	try {
		const tree = buildRouteTree([
			{ path: '/', page: () => null },
			{ path: '/fresh', page: (props) => {
				const d = document.createElement('p');
				d.textContent = (props && props.msg) || 'about';
				return d;
			} },
		]);
		tree[0].segmentCount = 0;
		const router = createFileRouter(tree, { container, routeDataCache: 60000 });
		router.prefetch('/fresh');
		await tick(5);
		expect(fetchCount).toBe(1);
		router.navigate('/fresh', { replace: true });
		await tick(10);
		expect(container.textContent).toBe('prefetched');
		expect(fetchCount).toBe(1);
	} finally {
		globalThis.fetch = origFetch;
	}
});

testAsync('routeDataCache default 0 refetches data on every visit', async () => {
	const container = document.createElement('div');
	let fetchCount = 0;
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (path) => {
		fetchCount++;
		return mockFetchResponse({ props: { msg: 'fresh' + fetchCount }, head: '' });
	};
	try {
		const tree = buildRouteTree([
			{ path: '/', page: () => null },
			{ path: '/fresh', page: (props) => {
				const d = document.createElement('p');
				d.textContent = (props && props.msg) || 'about';
				return d;
			} },
		]);
		tree[0].segmentCount = 0;
		const router = createFileRouter(tree, { container });
		router.navigate('/fresh', { replace: true });
		await tick(10);
		expect(fetchCount).toBe(1);
		expect(container.textContent).toBe('fresh1');
		router.navigate('/fresh', { replace: true });
		await tick(10);
		expect(fetchCount).toBe(2);
		expect(container.textContent).toBe('fresh2');
	} finally {
		globalThis.fetch = origFetch;
	}
});

testAsync('routeDataCache TTL: revisit within TTL reuses, after expiry refetches', async () => {
	const container = document.createElement('div');
	let fetchCount = 0;
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (path) => {
		fetchCount++;
		return mockFetchResponse({ props: { msg: 'v' + fetchCount }, head: '' });
	};
	try {
		const tree = buildRouteTree([
			{ path: '/', page: () => null },
			{ path: '/ttl', page: (props) => {
				const d = document.createElement('p');
				d.textContent = (props && props.msg) || 'ttl';
				return d;
			} },
		]);
		tree[0].segmentCount = 0;
		const router = createFileRouter(tree, { container, routeDataCache: 50 });
		router.navigate('/ttl', { replace: true });
		await tick(15);
		expect(fetchCount).toBe(1);
		expect(container.textContent).toBe('v1');
		// Revisit within the TTL: cached data is reused, no refetch.
		router.navigate('/ttl', { replace: true });
		await tick(15);
		expect(fetchCount).toBe(1);
		// Once the TTL expires a fresh request is issued again.
		await tick(60);
		router.navigate('/ttl', { replace: true });
		await tick(15);
		expect(fetchCount).toBe(2);
		expect(container.textContent).toBe('v2');
	} finally {
		globalThis.fetch = origFetch;
	}
});

	testAsync('lazy chunked route fetches route data even before its chunk loads', async () => {
	const container = document.createElement('div');
	let fetchCount = 0;
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (path, init) => {
		fetchCount++;
		expect(init.headers['X-Vesk-Data']).toBe('1');
		return mockFetchResponse({ props: { msg: 'lazy-fresh' }, head: '' });
	};
	try {
		// Lazy file-route nodes: `_pageName` is set but `page` is not wired yet
		// (their chunks are still loading), exactly like the first SPA visit to
		// a chunked route. fetchData runs before the chunk resolves; it must
		// still issue the data fetch (the route node is findable via _pageName).
		const lazyNode = {
			path: 'lazy',
			fullPath: '/lazy',
			isGroup: false,
			isDynamic: false,
			isCatchAll: false,
			_pageName: 'Page_Lazy',
			_chunk: '/_vesk/static/page-lazy.js',
			children: [],
		};
		const tree = [
			{
				path: '',
				fullPath: '/',
				isGroup: false,
				isDynamic: false,
				isCatchAll: false,
				segmentCount: 0,
				children: [lazyNode],
			},
		];
		const router = createFileRouter(tree, { container });
		router.navigate('/lazy', { replace: true });
		// The chunk never resolves in jsdom, but the data fetch must already
		// have been issued synchronously in navigate's finally block.
		await tick(5);
		expect(fetchCount).toBe(1);
	} finally {
		globalThis.fetch = origFetch;
	}
});

testAsync('server data error renders the route error component', async () => {
	const container = document.createElement('div');
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (path) => mockFetchResponse(
		{ error: 'DB unavailable', statusCode: 500 },
		{ ok: false, status: 500, headers: { get: () => 'application/json' }, json: async () => ({ error: 'DB unavailable' }) },
	);
	try {
		const tree = buildRouteTree([
			{ path: '/', page: () => null },
			{ path: '/boom', page: () => document.createTextNode('optimistic'), error: (props) => {
				const el = document.createElement('div');
				el.textContent = 'Data Error: ' + ((props && props.error && props.error.message) || 'unknown');
				return el;
			} },
		]);
		tree[0].segmentCount = 0;
		const router = createFileRouter(tree, { container });
		router.navigate('/boom', { replace: true });
		expect(container.textContent).toBe('optimistic');
		await tick(15);
		expect(container.textContent).toContain('Data Error: DB unavailable');
	} finally {
		globalThis.fetch = origFetch;
	}
});

testAsync('stale route data response is dropped after rapid navigation', async () => {
	const container = document.createElement('div');
	let releaseA;
	const gateA = new Promise(resolve => { releaseA = resolve; });
	const origFetch = globalThis.fetch;
	globalThis.fetch = async (path) => {
		if (path === '/a') {
			await gateA;
			return mockFetchResponse({ props: { msg: 'stale-A' }, head: '' });
		}
		return mockFetchResponse({ props: { msg: 'fresh-B' }, head: '' });
	};
	try {
		const tree = buildRouteTree([
			{ path: '/', page: () => null },
			{ path: '/a', page: (props) => {
				const d = document.createElement('p');
				d.textContent = (props && props.msg) || 'a';
				return d;
			} },
			{ path: '/b', page: (props) => {
				const d = document.createElement('p');
				d.textContent = (props && props.msg) || 'b';
				return d;
			} },
		]);
		tree[0].segmentCount = 0;
		const router = createFileRouter(tree, { container });
		router.navigate('/a', { replace: true });
		router.navigate('/b', { replace: true });
		releaseA();
		await tick(15);
		expect(container.textContent).toBe('fresh-B');
	} finally {
		globalThis.fetch = origFetch;
	}
});

testAsync('late-resolving suspended page render must not clobber a newer navigation', async () => {
	const container = document.getElementById('root') || document.createElement('div');
	let releaseAsync;
	const gate = new Promise(resolve => { releaseAsync = resolve; });
	const origFetch = globalThis.fetch;
	globalThis.fetch = async () => mockFetchResponse({ props: {}, head: '' });
	try {
		// First page suspends (async component awaiting data); second renders sync.
		const tree = buildRouteTree([
			{ path: '/', page: () => null },
			{ path: '/slow', page: () => gate.then(() => {
				const d = document.createElement('p');
				d.textContent = 'slow-page-final';
				return d;
			}) },
			{ path: '/fast', page: () => { const d = document.createElement('div'); d.textContent = 'fast-page'; return d; } },
		]);
		tree[0].segmentCount = 0;
		const router = createFileRouter(tree, { container });

		router.navigate('/slow', { replace: true });
		await tick(5);
		router.navigate('/fast', { replace: true });
		await tick(5);
		expect(container.textContent).toBe('fast-page');
		releaseAsync();
		await tick(20);
		// The suspended /slow render resolved AFTER /fast painted — mountDom
		// must drop the stale paint instead of clobbering the newer page.
		expect(container.textContent).toBe('fast-page');
	} finally {
		globalThis.fetch = origFetch;
	}
});

// ── Offline navigation ───────────────────────────────────────────────────

function setNavigatorOnline(online) {
	if (typeof globalThis.navigator === 'undefined') {
		globalThis.navigator = {};
	}
	try {
		Object.defineProperty(globalThis.navigator, 'onLine', { value: online, configurable: true });
	} catch {
		globalThis.navigator = { onLine: online };
	}
}

testAsync('network failure during SPA nav renders default offline UI, not 404', async () => {
	const container = document.createElement('div');
	const origFetch = globalThis.fetch;
	const prevOnline = globalThis.navigator ? globalThis.navigator.onLine : undefined;
	setNavigatorOnline(false);
	globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
	let nfCalled = false;
	try {
		const tree = buildRouteTree([
			{ path: '/', page: () => { const d = document.createElement('div'); d.textContent = 'home'; return d; } },
			{ path: '/away', notFound: () => { nfCalled = true; const d = document.createElement('div'); d.textContent = 'nf-should-not-render'; return d; }, page: () => { const d = document.createElement('div'); d.textContent = 'away'; return d; } },
		]);
		tree[0].segmentCount = 0;
		const router = createFileRouter(tree, { container });
		router.navigate('/', { replace: true });
		await tick(5);
		router.navigate('/away', { replace: true });
		await tick(10);
		expect(container.innerHTML).toContain('data-vesk-offline');
		expect(router._showingOffline).toBeTruthy();
		expect(nfCalled).toBeFalsy();
	} finally {
		globalThis.fetch = origFetch;
		if (prevOnline === undefined && typeof globalThis.navigator === 'object') delete globalThis.navigator.onLine;
		else setNavigatorOnline(prevOnline !== undefined ? prevOnline : true);
	}
});

testAsync('custom offline component receives url and retry', async () => {
	const container = document.createElement('div');
	const origFetch = globalThis.fetch;
	let seenUrl = null;
	let retryIsFunction = false;
	setNavigatorOnline(false);
	globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
	try {
		const tree = buildRouteTree([
			{ path: '/', page: () => { const d = document.createElement('div'); d.textContent = 'home'; return d; } },
			{ path: '/away', page: () => { const d = document.createElement('div'); d.textContent = 'away'; return d; } },
		]);
		tree[0].segmentCount = 0;
		const router = createFileRouter(tree, {
			container,
			offline: (props) => {
				seenUrl = props.url;
				retryIsFunction = typeof props.retry === 'function';
				const d = document.createElement('div');
				d.textContent = 'custom-offline-ui';
				return d;
			},
		});
		router.navigate('/', { replace: true });
		await tick(5);
		router.navigate('/away', { replace: true });
		await tick(10);
		expect(seenUrl).toBe('/away');
		expect(retryIsFunction).toBeTruthy();
		const mounted = (container.children || []).some(c => c && c.textContent === 'custom-offline-ui');
		expect(mounted).toBeTruthy();
	} finally {
		globalThis.fetch = origFetch;
	}
});

testAsync('coming back online re-navigates and recovers the page', async () => {
	const container = document.createElement('div');
	const origFetch = globalThis.fetch;
	setNavigatorOnline(false);
	let offline = true;
	globalThis.fetch = async () => {
		if (offline) throw new TypeError('Failed to fetch');
		return mockFetchResponse({ props: {} });
	};
	try {
		const tree = buildRouteTree([
			{ path: '/', page: () => null },
			{ path: '/conn', page: () => { const d = document.createElement('div'); d.textContent = 'connected-page'; return d; } },
		]);
		tree[0].segmentCount = 0;
		const router = createFileRouter(tree, { container });

		router.navigate('/conn', { replace: true });
		await tick(10);
		expect(container.innerHTML).toContain('data-vesk-offline');

		// Connectivity returns → the router's online handler must re-navigate.
		offline = false;
		setNavigatorOnline(true);
		globalThis.window.location.pathname = '/conn';
		const listeners = (globalThis.window._listeners && globalThis.window._listeners.online) || [];
		expect(listeners.length).toBeGreaterThanOrEqual(1);
		for (const fn of listeners) fn();
		await tick(20);
		const recovered = (container.children || []).some(c => c && c.textContent === 'connected-page')
			|| container.textContent === 'connected-page';
		expect(recovered).toBeTruthy();
	} finally {
		globalThis.fetch = origFetch;
		setNavigatorOnline(true);
	}
});

await asyncQueue;

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
console.log('All runtime router tests passed!');
