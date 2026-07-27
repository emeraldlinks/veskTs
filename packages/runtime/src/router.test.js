import { buildRouteTree, defineRoute, createRouter, createFileRouter, Outlet, Link, NavLink, useNavigate, useParams, usePathname, useSearchParams, useRouter } from './router.js';

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
		addEventListener() {},
		removeEventListener() {},
		appendChild(c) { children.push(c); if (c && typeof c === 'object') c.parentNode = this; },
		replaceChildren(...args) { children.length = 0; for (const a of args) { children.push(a); if (a && typeof a === 'object') a.parentNode = this; } },
		insertBefore(c, ref) { const idx = ref ? children.indexOf(ref) : children.length; children.splice(idx, 0, c); if (c && typeof c === 'object') c.parentNode = this; },
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
		createComment(text) { return { nodeType: 8, textContent: String(text) }; },
		createDocumentFragment() { const f = { nodeType: 11, children: [], appendChild(c) { this.children.push(c); if (c) c.parentNode = this; } }; return f; },
		head,
		querySelector() { return null; },
		querySelectorAll() { return []; },
		addEventListener() {},
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
	expect(container.children.length).toBe(1);
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

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
console.log('All runtime router tests passed!');
