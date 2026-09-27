import { primitive, leaf, isPrimitive, isLeaf, isVeskComponent, toDomNode, rerenderNode } from '@vesk/runtime/src/primitive';
import { Show } from '@vesk/runtime/src/headless';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
	try { fn(); passed++; console.log(`  ✓ ${name}`); }
	catch (e) { failed++; console.log(`  ✗ ${name} — ${(e as Error).message}`); }
}
/** Effect-driven behaviour needs a flush, so those cases are async. */
const pending: Promise<void>[] = [];
function atest(name: string, fn: () => Promise<void>) {
	pending.push(
		fn().then(
			() => { passed++; console.log(`  ✓ ${name}`); },
			(e) => { failed++; console.log(`  ✗ ${name} — ${(e as Error).message}`); }
		)
	);
}
/** Let a scheduled microtask flush land before asserting the DOM. */
const tickMicro = () => Promise.resolve();
function expect(actual: any) {
	return {
		toBe(expected: any) { if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); },
		toEqual(expected: any) { const a = JSON.stringify(actual), b = JSON.stringify(expected); if (a !== b) throw new Error(`expected ${b}, got ${a}`); },
		toThrow() {
			let threw = false;
			try { (actual as () => void)(); } catch { threw = true; }
			if (!threw) throw new Error('expected function to throw, but it did not');
		},
	};
}

// ── The problem primitive() exists to solve ────────────────────────────────
// A hand-written presentational component throws when called with no
// arguments, because `props` is undefined.

test('hand-written component throws on a zero-arg call (the baseline bug)', () => {
	function Badge(props: any) { return `<span>${props.children}</span>`; }
	expect(Badge).toThrow();
});

test('a hand-written component also throws on a nullish props call', () => {
	function Badge(props: any) { return `<span>${props.label}</span>`; }
	// `null` and `undefined` both throw on member access.
	let nullThrew = false;
	try { Badge(null); } catch { nullThrew = true; }
	let undefThrew = false;
	try { Badge(undefined); } catch { undefThrew = true; }
	if (!nullThrew) throw new Error('expected null props to throw');
	if (!undefThrew) throw new Error('expected undefined props to throw');
});

test('framework components like Show have the same zero-arg exposure', () => {
	expect(Show as any).toThrow();
});

// ── primitive(): the fix ──────────────────────────────────────────────────

test('primitive is callable with zero arguments', () => {
	const Badge = primitive((props: any) => `<span>${props.children}</span>`);
	expect(Badge()).toBe('<span>undefined</span>');
});

test('primitive substitutes props for null and undefined', () => {
	const Badge = primitive((props: any) => String(props.label));
	expect(Badge(null)).toBe('undefined');
	expect(Badge(undefined)).toBe('undefined');
});

test('primitive still receives real props unchanged', () => {
	const Badge = primitive((props: any) => `<span>${props.label}</span>`);
	expect(Badge({ label: 'new' })).toBe('<span>new</span>');
});

test('primitive does not clone, merge or strip a real props object', () => {
	// On the client `props.children` can be a live reactive container; it must
	// arrive by reference, so primitive must not rebuild the object.
	const children = { fragment: true };
	const seen: any[] = [];
	const Comp = primitive((props: any) => { seen.push(props); return null; });
	const props = { children, label: 'x' };
	Comp(props);
	if (seen[0] !== props) throw new Error('expected the original props object by reference');
	if (seen[0].children !== children) throw new Error('expected props.children by reference');
});

test('primitive substitutes a frozen empty object when props are absent', () => {
	const seen: any[] = [];
	const Comp = primitive((props: any) => { seen.push(props); return null; });
	Comp();
	if (!Object.isFrozen(seen[0])) throw new Error('expected the stand-in props to be frozen');
	expect(Object.keys(seen[0])).toEqual([]);
});

test('a mutation attempt on the stand-in cannot leak into the next call', () => {
	// The stand-in is a shared frozen singleton: zero allocation per zero-arg
	// call, and a primitive that writes to `props` by mistake fails loudly in
	// strict mode rather than poisoning every later zero-arg call.
	const seen: any[] = [];
	const Comp = primitive((props: any) => {
		seen.push(props);
		try { (props as any).leaked = true; } catch { /* frozen — strict mode throws */ }
		return null;
	});
	Comp();
	Comp();
	if (seen[0] !== seen[1]) throw new Error('expected the shared frozen stand-in');
	if ('leaked' in seen[0]) throw new Error('expected the frozen stand-in to reject writes');
	expect(seen[1].leaked).toBe(undefined);
});

test('primitive forwards the registry and scope arguments untouched', () => {
	const registry = new Map();
	const scope = { marker: true };
	let gotReg: unknown;
	let gotScope: unknown;
	const Comp = primitive((_props: any, reg: any, sc: any) => { gotReg = reg; gotScope = sc; return null; });
	Comp({ a: 1 }, registry as any, scope);
	if (gotReg !== registry) throw new Error('expected the registry to be forwarded by reference');
	if (gotScope !== scope) throw new Error('expected the scope to be forwarded by reference');
});

test('primitive forwards an async return value', async () => {
	const Comp = primitive(async (props: any) => `<b>${props.label}</b>`);
	const out = await Comp();
	if (out !== '<b>undefined</b>') throw new Error(`expected the awaited markup, got ${out}`);
});

test('primitive returns a distinct function, not the original', () => {
	const fn = (props: any) => props.label;
	const Comp = primitive(fn);
	if ((Comp as unknown) === fn) throw new Error('expected a wrapper, not the original function');
});

// ── leaf(): the behavioural counterpart ────────────────────────────────────

test('leaf returns the same function so __veskScope stays writable', () => {
	// server-render.ts assigns `fn.__veskScope = __vesk` to compiled components;
	// a wrapper would break that, so leaf() must not copy.
	const Tabs = (props: any, reg: any, scope: any) => `${props.label}`;
	const Tagged = leaf(Tabs);
	if ((Tagged as unknown) !== Tabs) throw new Error('expected leaf() to return the same function');
	(Tagged as any).__veskScope = { a: 1 };
	if ((Tabs as any).__veskScope.a !== 1) throw new Error('expected __veskScope to be assignable on the original');
});

test('leaf keeps the required-props contract (no zero-arg tolerance)', () => {
	// Stateful widgets implement the ABI directly; leaf() only tags. This is the
	// documented difference from primitive().
	const Tabs = leaf((props: any) => props.label);
	expect(Tabs as any).toThrow();
});

test('leaf forwards props, registry and scope', () => {
	const registry = new Map();
	const scope = { s: 1 };
	let got: unknown[] = [];
	const Tabs = leaf((props: any, reg: any, sc: any) => { got = [props, reg, sc]; return null; });
	const props = { label: 'a' };
	Tabs(props, registry as any, scope);
	if (got[0] !== props) throw new Error('expected props by reference');
	if (got[1] !== registry) throw new Error('expected registry by reference');
	if (got[2] !== scope) throw new Error('expected scope by reference');
});

test('leaf can wrap an async component', async () => {
	const Page = leaf(async (props: any, reg: any, sc: any) => `${props.label}`);
	const out = await Page({ label: 'x' }, new Map(), undefined);
	if (out !== 'x') throw new Error(`expected the awaited markup, got ${out}`);
});

// ── Introspection ─────────────────────────────────────────────────────────

test('isPrimitive is true only for primitive()-built functions', () => {
	expect(isPrimitive(primitive((p: any) => p.label))).toBe(true);
	expect(isPrimitive(leaf((p: any) => p.label))).toBe(false);
	expect(isPrimitive((p: any) => p.label)).toBe(false);
	expect(isPrimitive(undefined)).toBe(false);
	expect(isPrimitive(null)).toBe(false);
	expect(isPrimitive({})).toBe(false);
	expect(isPrimitive('primitive')).toBe(false);
});

test('isLeaf is true only for leaf()-tagged functions', () => {
	expect(isLeaf(leaf((p: any) => p.label))).toBe(true);
	expect(isLeaf(primitive((p: any) => p.label))).toBe(false);
	expect(isLeaf((p: any) => p.label)).toBe(false);
	expect(isLeaf(undefined)).toBe(false);
	expect(isLeaf(null)).toBe(false);
});

test('isVeskComponent is true for every registry-shaped entry', () => {
	expect(isVeskComponent(primitive((p: any) => p.label))).toBe(true);
	expect(isVeskComponent(leaf((p: any) => p.label))).toBe(true);
	expect(isVeskComponent(() => null)).toBe(true);
	expect(isVeskComponent({})).toBe(false);
	expect(isVeskComponent(null)).toBe(false);
	expect(isVeskComponent('Badge')).toBe(false);
});

test('a primitive does not accidentally read as a leaf', () => {
	// Guards the reverse-tag direction: stamping one must not imply the other.
	const Comp = primitive((p: any) => p.label);
	expect(isLeaf(Comp)).toBe(false);
	expect((Comp as any).__veskLeaf).toBe(undefined);
});

test('primitives compose — a primitive can call another zero-arg primitive', () => {
	const Inner = primitive((props: any) => `<i>${props.tone}</i>`);
	const Outer = primitive((props: any) => `<b>${Inner(props)}</b>`);
	expect(Outer()).toBe('<b><i>undefined</i></b>');
	expect(Outer({ tone: 'up' })).toBe('<b><i>up</i></b>');
});

test('a primitive returning a VNode-like value passes it through untouched', () => {
	// The client reconciler consumes whatever a component returns; primitive must
	// not coerce or stringify it.
	const node = { nodeType: 1, tagName: 'SPAN' };
	const Comp = primitive(() => node);
	if (Comp() !== node) throw new Error('expected the returned node by reference');
});

// ── Registry round-trip: the actual call shape the compiler emits ───────────

test('a primitive survives a registry round-trip with a zero-arg call', () => {
	const registry = new Map();
	const Badge = primitive((props: any) => `<span>${props.label ?? 'none'}</span>`);
	registry.set('Badge', Badge as any);
	const resolved: any = registry.get('Badge');
	if (isPrimitive(resolved)) { expect(resolved()).toBe('<span>none</span>'); }
	else { throw new Error('expected a primitive to survive the registry'); }
});

test('a leaf survives a registry round-trip with the full ABI call', () => {
	const registry = new Map();
	const Tabs = leaf((props: any, reg: any, scope: any) => `<div>${props.label}</div>`);
	registry.set('Tabs', Tabs as any);
	const resolved: any = registry.get('Tabs');
	expect(resolved({ label: 'x' }, registry, undefined)).toBe('<div>x</div>');
});

// ── toDomNode ────────────────────────────────────────────────────────────────
// A primitive/leaf written as a template string returns a string on BOTH sides.
// The server concatenates it; the client must not hand a string to
// appendChild/replaceChild. These use a real DOM (linkedom) so the parsing
// branch is genuinely exercised.
{
	const { parseHTML } = await import('linkedom');
	const { document: dom } = parseHTML('<!doctype html><html><body></body></html>');
	(globalThis as any).document = dom;

	test('a Node passes through untouched', () => {
		const el = dom.createElement('span');
		expect(toDomNode(el)).toBe(el);
	});

	test('a single-root string becomes that element', () => {
		const node = toDomNode('<div class="prim-counter">7</div>') as any;
		expect(node.nodeType === 1).toBe(true);
		expect(node.tagName).toBe('DIV');
		expect(node.getAttribute('class')).toBe('prim-counter');
	});

	test('a single-root string is detached, so callers see it as unmounted', () => {
		// The compiler's hydrate guard is `value.parentNode == null`: a node
		// left parented to the template's content fragment reads as already
		// mounted, so it would never be inserted and the claimed SSR node
		// would be retired instead.
		const node = toDomNode('<span class="prim-badge">x</span>') as any;
		expect(node.parentNode).toBe(null);
		expect(node.isConnected).toBe(false);
	});

	test('a multi-root string returns a fragment holding the roots', () => {
		const frag = toDomNode('<b>a</b><i>b</i>') as any;
		expect(frag.nodeType === 11).toBe(true);
		expect(frag.childNodes.length).toBe(2);
		// The fragment is the splice container, so its children keep it as
		// parent until the caller moves them.
		expect(frag.firstChild.parentNode).toBe(frag);
	});

	test('an empty string becomes an empty fragment', () => {
		const frag = toDomNode('') as any;
		expect(frag.nodeType === 11).toBe(true);
		expect(frag.childNodes.length).toBe(0);
	});

	test('nullish and boolean returns are passed through for caller checks', () => {
		expect(toDomNode(null)).toBe(null);
		expect(toDomNode(undefined)).toBe(undefined);
		expect(toDomNode(false)).toBe(false);
	});

	test('numbers are left alone (not silently stringified)', () => {
		expect(toDomNode(42)).toBe(42);
	});

	delete (globalThis as any).document;
	test('with no document (server) a string passes through unchanged', () => {
		expect(toDomNode('<div>x</div>')).toBe('<div>x</div>');
	});
}

// ── rerenderNode: string components re-render on tracked deps ───────────────
// A `primitive()`/`leaf()` is called once and its markup converted once, so a
// tracked read inside it subscribes nothing. The call site hands the deps to
// rerenderNode, which re-reads them in an effect and swaps the DOM in place.
// The props go through `reactiveProps` exactly as generated code passes them,
// so a tracked prop reads as its value on both the first and later renders.
{
	const { parseHTML } = await import('linkedom');
	const { document: dom } = parseHTML('<!doctype html><html><body></body></html>');
	(globalThis as any).document = dom;
	const { track, set, flush_sync } = await import('@vesk/runtime/src/ripple-runtime');
	const { root, destroy_block } = await import('@vesk/runtime/src/ripple-blocks');
	const { reactiveProps } = await import('@vesk/runtime/src/hydrate');

	/** Mount `node` in a fresh container, exactly like a component call site. */
	function mount(node: any) {
		const host = dom.createElement('div');
		host.appendChild(node);
		dom.body.appendChild(host);
		return host;
	}
	const sleep = () => new Promise((r) => setTimeout(r, 10));
	const text = (host: any) => (host.textContent || '').trim();
	const kids = (host: any) => host.children.length;

	atest('re-renders the node in place when a dep changes', async () => {
		const bump = track(0);
		const Counter = primitive((props: any) => `<span class="c">${props.bump ?? 0}</span>`);
		const node = toDomNode(Counter(reactiveProps({ bump })));
		const host = mount(node);
		const block = root(() => { rerenderNode(node, [bump], () => Counter(reactiveProps({ bump }))); });
		flush_sync();
		expect(text(host)).toBe('0');
		set(bump, 1);
		flush_sync();
		await sleep();
		expect(text(host)).toBe('1');
		// Replaced, never appended: one child, and the old node is gone.
		expect(kids(host)).toBe(1);
		expect(node.parentNode === null).toBe(true);
		destroy_block(block as any);
	});

	atest('does not re-invoke the component at mount time', async () => {
		const bump = track(0);
		let calls = 0;
		const Counter = primitive((props: any) => { calls++; return `<i>${props.bump}</i>`; });
		const node = toDomNode(Counter(reactiveProps({ bump })));
		mount(node);
		const block = root(() => { rerenderNode(node, [bump], () => Counter(reactiveProps({ bump }))); });
		flush_sync();
		await sleep();
		// The registering effect only subscribes; it must not rebuild.
		expect(calls).toBe(1);
		destroy_block(block as any);
	});

	atest('a write landing before the first flush still re-renders', async () => {
		const bump = track(0);
		const Counter = primitive((props: any) => `<i>${props.bump}</i>`);
		const node = toDomNode(Counter(reactiveProps({ bump })));
		const host = mount(node);
		const block = root(() => { rerenderNode(node, [bump], () => Counter(reactiveProps({ bump }))); });
		set(bump, 7);
		flush_sync();
		await sleep();
		expect(text(host)).toBe('7');
		destroy_block(block as any);
	});

	// A bare `root` fires an effect at most once, so this covers one swap of a
	// drained fragment. Repeats over a live owner are covered by the browser
	// hydration suite (a `root` in a unit test is torn down between ticks).
	atest('a drained fragment still re-renders from the snapshot roots', async () => {
		const bump = track(0);
		const Pair = (p: any) => (p.bump === 1 ? `<i>${p.bump}</i>` : `<i>${p.bump}</i><b>!</b>`);
		const node = toDomNode(Pair(reactiveProps({ bump })));
		// The generated code snapshots the roots at the call site, BEFORE the
		// mount point drains the fragment — that snapshot is the only handle
		// that survives, and it is what lets the root count shrink.
		const roots = Array.from((node as any).childNodes);
		const host = mount(node);
		const tags = () => Array.from(host.children).map((c: any) => c.tagName);
		const block = root(() => { rerenderNode(roots, [bump], () => Pair(reactiveProps({ bump }))); });
		flush_sync();
		expect(tags()).toEqual(['I', 'B']);
		set(bump, 1);
		flush_sync();
		await sleep();
		// Two roots became one, in place, with no wrapper invented.
		expect(tags()).toEqual(['I']);
		expect(text(host)).toBe('1');
		expect(kids(host)).toBe(1);
		destroy_block(block as any);
	});

	atest('a multi-root re-render splices in without inventing a wrapper', async () => {
		const bump = track(0);
		const Pair = primitive((props: any) => `<i>a${props.bump}</i><b>b${props.bump}</b>`);
		const node = toDomNode(Pair(reactiveProps({ bump })));
		const host = mount(node);
		const block = root(() => { rerenderNode(node, [bump], () => Pair(reactiveProps({ bump }))); });
		flush_sync();
		set(bump, 2);
		flush_sync();
		await sleep();
		expect(kids(host)).toBe(2);
		expect(host.children[0].tagName).toBe('I');
		expect(host.children[1].tagName).toBe('B');
		destroy_block(block as any);
	});

	atest('a detached node is never grafted back', async () => {
		const bump = track(0);
		let calls = 0;
		const Counter = primitive((props: any) => { calls++; return `<i>${props.bump}</i>`; });
		const node = toDomNode(Counter(reactiveProps({ bump })));
		const host = mount(node);
		const block = root(() => { rerenderNode(node, [bump], () => Counter(reactiveProps({ bump }))); });
		host.removeChild(node);
		set(bump, 3);
		flush_sync();
		await sleep();
		expect(calls).toBe(1);
		expect(dom.body.contains(node)).toBe(false);
		destroy_block(block as any);
	});

	atest('no deps registers no effect', async () => {
		let calls = 0;
		const Counter = primitive((props: any) => { calls++; return `<i>${props.n ?? 0}</i>`; });
		const node = toDomNode(Counter(reactiveProps({ n: 1 })));
		mount(node);
		const block = root(() => { rerenderNode(node, [], () => Counter(reactiveProps({ n: 2 }))); });
		flush_sync();
		await sleep();
		expect(calls).toBe(1);
		destroy_block(block as any);
	});

	test('a non-node value is returned untouched', () => {
		expect(rerenderNode('markup' as any, [1] as any, () => 'other')).toBe('markup');
	});

	delete (globalThis as any).document;
	test('on the server it is a pass-through (no document)', () => {
		expect(rerenderNode('markup' as any, [1] as any, () => 'other')).toBe('markup');
	});
}

Promise.all(pending).then(() => {
	console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
	if (failed > 0) process.exit(1);
});
