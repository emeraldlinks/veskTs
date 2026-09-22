/**
 * Client Codegen Tests
 *
 * Every test runs in BOTH modes:
 *   normal  — creates DOM via createElement / createTextNode / DocumentFragment
 *   hydrate — walks server DOM via __hydrate.nextElement / nextText / root
 *
 * Run with: node --experimental-vm-modules packages/compiler/src/client-codegen.test.js
 */
import { compileClient } from '@vesk/compiler/src/client-codegen';

let passed = 0;
let failed = 0;

function describe(name, fn) { console.log(`\n${name}`); fn(); }

function it(name, fn) {
	try { fn(); passed++; console.log(`  ✓ ${name}`); }
	catch (e) { failed++; console.log(`  ✗ ${name}`); console.log(`    ${e.message}`); }
}

function expect(value) {
	return {
		toBe(expected) { if (value !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`); },
		not: {
			toBe(expected) { if (value === expected) throw new Error(`Expected NOT ${JSON.stringify(expected)}`); },
			toContain(sub) { if (String(value).includes(sub)) throw new Error(`Expected NOT to contain ${JSON.stringify(sub)} in ${JSON.stringify(value)}`); },
		},
		toContain(sub) { if (!String(value).includes(sub)) throw new Error(`Expected to contain ${JSON.stringify(sub)} in ${JSON.stringify(value)}`); },
	};
}

/**
 * Run the same `fn(codegen)` assertion against both normal and hydrate modes.
 * `fn` receives the generated source code for each mode.
 */
function bothModes(name, source, assertionsFn, opts = {}) {
	it(`[normal] ${name}`, () => {
		const code = compileClient(source, null, { ...opts, forceClient: true });
		assertionsFn(code, 'normal');
	});
	it(`[hydrate] ${name}`, () => {
		const code = compileClient(source, null, { ...opts, hydrate: true, forceClient: true });
		assertionsFn(code, 'hydrate');
	});
}

// Strip ES module imports/exports so new Function() can evaluate
function stripModuleWrapper(code) {
	return code
		.replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]*['"];?\s*/gm, '')
		.replace(/^import .+ from ['"].+['"];?\s*/gm, '')
		.replace(/^export (default |const )/gm, '')
		.replace(/^export default \w+;\s*/gm, '');
}

describe('Client Codegen — DOM Creation', () => {

	// Elements — expression + statement
	bothModes('creates elements expression mode', `
		component App { return <div>Hello</div>; }
	`, (code, mode) => {
		if (mode === 'normal') expect(code).toContain('document.createElement');
		else expect(code).not.toContain('document.createElement'); // static: SSR already correct
	});
	bothModes('creates elements statement mode', `
		component App { <div>Hello</div> }
	`, (code, mode) => {
		if (mode === 'normal') expect(code).toContain('document.createElement');
		else expect(code).not.toContain('document.createElement');
	});

	// Text nodes — expression + statement
	bothModes('creates text nodes expression mode', `
		component App { return <div>Hello</div>; }
	`, (code, mode) => {
		if (mode === 'normal') expect(code).toContain('document.createTextNode');
		else expect(code).not.toContain('document.createTextNode');
	});
	bothModes('creates text nodes statement mode', `
		component App { <div>Hello</div> }
	`, (code, mode) => {
		if (mode === 'normal') expect(code).toContain('document.createTextNode');
		else expect(code).not.toContain('document.createTextNode');
	});

	// Static attributes — expression + statement
	bothModes('sets static attributes expression mode', `
		component App { return <div class="foo">Hi</div>; }
	`, (code, mode) => {
		if (mode === 'normal') {
			expect(code).toContain('setAttribute');
			expect(code).toContain('foo');
		} else {
			expect(code).not.toContain('setAttribute');
		}
	});

	// No empty-string placeholder for expression-valued attributes on the
	// client: `setAttribute("disabled", "")` sets the IDL disabled property
	// true in real browsers even when the prop is undefined/false. The
	// guarded effect below must own presence entirely.
	bothModes('no empty placeholder for dynamic attributes', `
		component App(props: { d?: boolean }) { return <button disabled={props.d}>x</button>; }
	`, (code) => {
		expect(code).not.toContain('setAttribute("disabled", ""');
		expect(code).toContain('__v == null || __v === false');
		expect(code).toContain('.removeAttribute("disabled")');
	});

	// Dynamic attributes must omit undefined/false instead of
	// serializing `disabled="undefined"` (which disables the element).
	bothModes('guards dynamic attribute rendering', `
		component App(props: { d?: boolean }) { return <button disabled={props.d}>x</button>; }
	`, (code) => {
		expect(code).not.toContain('setAttribute("disabled", String');
		if (code.includes('effects')) {
			expect(code).toContain('__v == null || __v === false');
			expect(code).toContain('.removeAttribute("disabled")');
		}
	});
	bothModes('sets static attributes statement mode', `
		component App { <div class="foo">Hi</div> }
	`, (code, mode) => {
		if (mode === 'normal') {
			expect(code).toContain('setAttribute');
			expect(code).toContain('foo');
		} else {
			expect(code).not.toContain('setAttribute');
		}
	});

// Fragment — statement + expression mode (via JSX <></>). Fully static
	// fragments stay as-is on hydration (claimOnly stub); the static content
	// is preserved with no re-render.
	bothModes('uses fragment expression mode', `
		component App { return <><div>A</div><div>B</div></>; }
	`, (code, mode) => {
		if (mode === 'normal') expect(code).toContain('DocumentFragment');
		else expect(code).toContain('__hydrate.claimOnly()');
	});
	bothModes('uses fragment statement mode', `
		component App { <div>A</div><div>B</div> }
	`, (code, mode) => {
		if (mode === 'normal') expect(code).toContain('DocumentFragment');
		else expect(code).toContain('__hydrate.claimOnly()');
	});
});

describe('Client Codegen — Hydrate call-site boundaries', () => {

	// SSR emits a keyed marker (`<!--vsk:c:Name-->` / `<!--vsk:t:tag-->`) + the component's own root; no
	// display:contents wrapper anywhere.
	bothModes('component call emits no wrapper element', `
		component Nav { return <header class="sticky">Hi</header>; }
		component App { return <Nav />; }
	`, (code, mode) => {
		if (mode === 'normal') expect(code).toContain('document.createElement');
		else {
			expect(code).not.toContain('display:contents');
			expect(code).not.toContain('subWalker(');
		}
	});

	// Genuinely-plain call targets (non-runtime imports, member-expression tags,
	// top-level values) never touch the walker — the call site adopts their SSR
	// root after the call and replaces it with the fresh node they returned.
	bothModes('plain call target gets the adoption guard', `
		const Icon = (props) => null;
		component App { <div><Icon /></div> }
	`, (code, mode) => {
		if (mode === 'normal') {
			expect(code).toContain('Icon({');
			expect(code).not.toContain('claimOnly');
		} else {
			expect(code).toContain('Icon({');
			expect(code).toContain('claimOnly()');
		}
	});

	// Runtime components that adopt their own SSR root (Link/NavLink/Md/Form/
	// Field/LoadingIndicator) get NO adoption guard: they return a
	// DocumentFragment when claimed, so the guard would steal the next
	// sibling's root. Their destroyed interior markers are swept instead.
	bothModes('self-claiming runtime component has no guard but sweeps detached markers', `
		import { Link } from '@vesk/runtime';
		const &[n] = track(1);
		component App { <Link href="/"><b>{n}</b></Link><p>after</p> }
	`, (code, mode) => {
		if (mode === 'normal') {
			expect(code).not.toContain('retireDetached');
			return;
		}
		expect(code).toContain('Link({');
		expect(code).not.toContain('claimOnly');
		expect(code).toContain('retireDetached()');
		// The sibling claim keeps walking the SHARED walker (no subWalker).
		expect(code).not.toContain('subWalker(');
	});

	bothModes('Md call has no guard and claims its own root', `
		import { Md } from '@vesk/runtime';
		component App { return <Md content="# Hi" />; }
	`, (code, mode) => {
		if (mode === 'normal') {
			expect(code).toContain('Md({');
			expect(code).not.toContain('retireDetached');
			return;
		}
		expect(code).toContain('Md({');
		expect(code).not.toContain('claimOnly');
		expect(code).toContain('retireDetached()');
	});

});

describe('Client Codegen — Reactivity', () => {

	// Dynamic text — expression mode
	bothModes('dynamic text expression mode', `
		component App(props: { n: number }) { return <div>{props.n}</div>; }
	`, (code) => {
		expect(code).toContain('effect(');
		expect(code).toContain('props.n');
	});
	// Dynamic text — statement mode
	bothModes('dynamic text statement mode', `
		component App(props: { n: number }) {
			<div>{props.n}</div>
		}
	`, (code) => {
		expect(code).toContain('effect(');
		expect(code).toContain('props.n');
	});

	// A5: sole dynamic text child hydrates from the SSR snapshot (expression)
	bothModes('sole dynamic text snapshot init expression mode', `
		component App(props: { n: number }) { return <div>{props.n}</div>; }
	`, (code, mode) => {
		expect(code).toContain('effect(');
		if (mode === 'hydrate') expect(code).toContain('__vsk_ssrText');
		else expect(code).not.toContain('__vsk_ssrText');
	});
	// A5: sole dynamic text child hydrates from the SSR snapshot (statement)
	bothModes('sole dynamic text snapshot init statement mode', `
		component App(props: { n: number }) {
			<div>{props.n}</div>
		}
	`, (code, mode) => {
		expect(code).toContain('effect(');
		if (mode === 'hydrate') expect(code).toContain('__vsk_ssrText');
		else expect(code).not.toContain('__vsk_ssrText');
	});
	// A5: multiple text children keep the empty initial (no blob to split)
	bothModes('multi dynamic text keeps empty initial', `
		component App(props: { a: string, b: string }) { return <div>{props.a}{props.b}</div>; }
	`, (code, mode) => {
		if (mode === 'hydrate') expect(code).not.toContain('__vsk_ssrText');
	});
	// A5: mixed static + dynamic text keeps the empty initial
	bothModes('mixed static/dynamic text keeps empty initial', `
		component App(props: { n: number }) { return <div>hi {props.n}</div>; }
	`, (code, mode) => {
		if (mode === 'hydrate') expect(code).not.toContain('__vsk_ssrText');
	});

	// Dynamic attribute — expression mode
	bothModes('dynamic attribute expression mode', `
		component App(props: { cls: string }) { return <div class={props.cls}>X</div>; }
	`, (code) => {
		expect(code).toContain('effect(');
		expect(code).toContain('setAttribute');
		expect(code).toContain('props.cls');
	});
	// Dynamic attribute — statement mode
	bothModes('dynamic attribute statement mode', `
		component App(props: { cls: string }) {
			<div class={props.cls}>X</div>
		}
	`, (code) => {
		expect(code).toContain('effect(');
		expect(code).toContain('setAttribute');
		expect(code).toContain('props.cls');
	});

	bothModes('track() declaration', `
		component App { let &[count] = track(0); return <div>{count}</div>; }
	`, (code) => {
		expect(code).toContain('track(');
		expect(code).toContain('get(count)');
	});

	bothModes('rewrites tracked variables to .get()', `
		component App { let &[count] = track(0); return <div>{count}</div>; }
	`, (code) => {
		expect(code).toContain('get(count)');
	});

	// Tracks reads inside a `derived(...)` init and makes an `if (derived)` region
	// reactive — the vesk-doc DocTabs pattern (`const &[current] = derived(() => props.tabs[index] …)`).
	bothModes('derived cell rewrites tracked reads in its fn and if-region', `
		component App(props: { tabs: string[] }) {
			const &[index] = track(0);
			const &[current] = derived(() => props.tabs[index] ?? props.tabs[0]);
			if (current) { <pre>{current}</pre> }
		}
	`, (code) => {
		expect(code).toContain('derived(() => props.tabs[get(index)] ?? props.tabs[0])');
		expect(code).toContain('if (get(current)) {');
		expect(code).toContain('let __iv = get(current);');
		expect(code).not.toContain('props.tabs[index]');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	bothModes('includes runtime import', `
		component App { return <div>Hi</div>; }
	`, (code) => {
		expect(code).toContain('@vesk/runtime');
	});
});

describe('Client Codegen — Control Flow', () => {

	// Expression mode: conditional (&&)
	bothModes('conditional (&&) expression mode', `
		component App(props: { s: boolean }) { return <div>{props.s && <span>Show</span>}</div>; }
	`, (code) => {
		expect(code).toContain('createComment');
		expect(code).toContain('effect(');
	});
	// Statement mode: if with JSX
	bothModes('conditional (if) statement mode', `
		component App(props: { s: boolean }) {
			if (props.s) { <div>Show</div> }
		}
	`, (code) => {
		expect(code).toContain('createComment');
		expect(code).toContain('effect(');
		expect(code).toContain('__cleanup');
	});

	// Expression mode: .map()
	bothModes('.map() expression mode', `
		component App(props: { items: string[] }) { return <div>{props.items.map((i) => <span>{i}</span>)}</div>; }
	`, (code) => {
		expect(code).toContain('createComment');
		expect(code).toContain('effect(');
		expect(code).toContain('for (const i of ');
	});
	// Statement mode: for-of
	bothModes('.map() statement mode (for-of)', `
		component App(props: { items: string[] }) {
			for (const item of props.items) { <div>{item}</div> }
		}
	`, (code) => {
		expect(code).toContain('createComment');
		expect(code).toContain('effect(');
		expect(code).toContain('for (const item of ');
	});

	// Expression mode: child component call
	bothModes('child component expression mode', `
		component Child(props: { n: string }) { return <span>{props.n}</span>; }
		component App { return <div><Child n="x" /></div>; }
	`, (code, mode) => {
		expect(code).toContain('__components[');
		expect(code).toContain('Child');
		if (mode === 'hydrate') expect(code).toContain('__hydrate');
	});
	// Statement mode: child component call
	bothModes('child component statement mode', `
		component Child(props: { n: string }) { return <span>{props.n}</span>; }
		component App {
			<Child n="x" />
		}
	`, (code, mode) => {
		expect(code).toContain('__components[');
		expect(code).toContain('Child');
		if (mode === 'hydrate') expect(code).toContain('__hydrate');
	});

	// Dynamic text child of a component call must scope its effect next to the
	// text node (inside the children fragment), not at the parent component level.
	bothModes('dynamic text child of component call scopes effect in fragment', `
		component Demo { let &[name] = track('Vesk'); <Link href="/">{name}</Link> }
	`, (code) => {
		const iText = code.indexOf('document.createTextNode');
		const iEffect = code.indexOf('effect(() => { $n');
		const iFragEnd = code.indexOf('return $f; })();');
		expect(iText >= 0).toBe(true);
		expect(iEffect >= 0).toBe(true);
		expect(iFragEnd >= 0).toBe(true);
		expect(iEffect < iFragEnd).toBe(true);
		expect(iEffect > iText).toBe(true);
	});

	// Non-tracked text child of a component call is a one-time snapshot created
	// inside the children fragment (no deferred effect reading a later value).
	bothModes('static text child of component call is created in fragment', `
		component Demo { const name = 'Vesk'; <Link href="/">{name}</Link> }
	`, (code) => {
		expect(code).toContain('document.createTextNode(String(name))');
		expect(code).not.toContain('effect(() => { $n');
		const iText = code.indexOf('document.createTextNode');
		const iFragEnd = code.indexOf('return $f; })();');
		expect(iText >= 0).toBe(true);
		expect(iFragEnd >= 0).toBe(true);
		expect(iText < iFragEnd).toBe(true);
	});

	// Dynamic text child of a component call inside a keyed-map block must push
	// its effect into the block's per-item effects array (in the block's scope).
	bothModes('dynamic text child of component call in loop pushes effect into item array', `
		component Demo {
			let &[suffix] = track('!');
			for (const item of items) { <Link href={item.href}>{item.label}{suffix}</Link> }
		}
	`, (code) => {
		expect(code).toContain('__e.push(effect(() => { $n');
	});

	// Non-tracked text inside a loop body is snapshotted per iteration at
	// creation time — not via a deferred effect that would read the final value.
	bothModes('static loop text renders per-iteration snapshot', `
		component Demo {
			for (const item of items) { <span>{item.label}</span> }
		}
	`, (code) => {
		expect(code).toContain('document.createTextNode(String(item.label))');
		expect(code).not.toContain('effect(() => { $n');
	});

	bothModes('while-loop text binding snapshots non-tracked value per iteration', `
		component App {
			let n = 0;
			while (n < 3) { <span>{n}</span>; n = n + 1 }
		}
	`, (code, mode) => {
		expect(code).toContain('document.createTextNode(String(n))');
		expect(code).not.toContain('effect(() => { $n');
		if (mode === 'hydrate') {
			expect(code).toContain('__hydrate.nextElement("span")');
			expect(code).toContain('__cl.push(');
		}
	});

});

describe('Client Codegen — wipe-style component children (Link/NavLink)', () => {

	// Link/NavLink replaceChildren() their SSR anchor on hydration, so fully-static
	// child subtrees must be fresh-built instead of suppressed/claimed — otherwise
	// the anchors wipe their own children (Bug: static Link children lost on load).
	bothModes('Link static children are fresh-built in hydrate mode', `
		import { Link } from '@vesk/runtime/router'
		component App { <Link href="/"><span class="a">V</span><span class="b">vesk</span></Link> }
	`, (code, mode) => {
		expect(code).toContain('document.createElement("span")');
		if (mode === 'normal') {
			expect(code).not.toContain('__hydrate.subWalker');
		}
	});

	// Alias import (import { Link as L }) must be treated as wipe-style too: the
	// discriminator is the origin import name, not the local binding.
	bothModes('alias-imported Link (import { Link as L }) keeps static children', `
		import { Link as L } from '@vesk/runtime/router'
		component App { <L href="/"><span class="a">V</span><span class="b">vesk</span></L> }
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('document.createElement("span")');
		}
	});

	// A local (append-style) component with a slot must NOT get the wipe
	// fresh-build: its claimed children re-appended in place would duplicate.
	bothModes('non-wipe child component still suppresses static children in hydrate mode', `
		component Inner { <slot /> }
		component App { <Inner><span class="a">V</span></Inner> }
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).not.toContain('document.createElement("span")');
		}
	});

});

describe('Client Codegen — layout slot scoping & claimed-sibling appends', () => {

	// A layout slot in hydrate mode must claim the page on a walker scoped to
	// the SSR slot boundaries (`<!--vsk-slot:<id>-->`), paired by exact id —
	// never on the shared cursor and never on a containment subWalker. The
	// shared cursor drifts on any single claim miss (one miss twins the
	// footer); a containment subWalker bulk-transfers sibling markers rendered
	// after the slot (the footer) into the page's walk. Boundary scoping plus
	// async slot anchoring (`__slot.track`) keeps nav/footer claims out of
	// page markers and page claims out of footer markers.
	bothModes('slot scopes children to the SSR slot boundary walker', `
		component Layout(props) {
			return <main><div>{props.children}</div></main>;
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('createLayoutSlot(__hydrate,');
			expect(code).toContain('props.children(__slot.walker)');
			expect(code).toContain('__pendingChild = __slot.track(__child)');
			expect(code).not.toContain('props.children(__hydrate)');
			expect(code).not.toContain('props.children(__hydrate.subWalker');
		} else {
			expect(code).not.toContain('props.children(__hydrate)');
			expect(code).not.toContain('createLayoutSlot');
		}
	});

	bothModes('statement-mode slot scopes children to the SSR slot boundary walker', `
		component Layout(props) {
			<main><div>{props.children}</div></main>
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('createLayoutSlot(__hydrate,');
			expect(code).toContain('props.children(__slot.walker)');
			expect(code).toContain('__pendingChild = __slot.track(__child)');
			expect(code).not.toContain('props.children(__hydrate)');
			expect(code).not.toContain('props.children(__hydrate.subWalker');
		} else {
			expect(code).not.toContain('props.children(__hydrate)');
			expect(code).not.toContain('createLayoutSlot');
		}
	});

	// Claimed static children already sit in their SSR position. appendChild
	// would move them to the end of the parent, reordering the document.
	// Hydrate mode must guard the append; normal mode must stay plain.
	bothModes('hydrate appends of claimed static children are guarded', `
		component Layout(props) {
			<main><aside class="a">x</aside><div>{props.children}</div></main>
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('parentNode !== $n');
			expect(code).toContain('appendChild');
		} else {
			expect(code).not.toContain('parentNode !== $n');
		}
	});

	// Component-call siblings rendered around a slot (a layout with a nav and a
	// footer) return already-mounted claimed roots. The layout root must not
	// move them.
	bothModes('hydrate appends of component-call siblings are guarded', `
		component Header() { return <header>h</header>; }
		component Footer() { return <footer>f</footer>; }
		component Layout(props) {
			<div class="root"><Header /><main>{props.children}</main><Footer /></div>
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('parentNode !== $n');
		} else {
			expect(code).not.toContain('parentNode !== $n');
		}
	});

	// `props.children` inside a ternary branch must insert the slot nodes —
	// not degrade to a text binding (`String(props.children)` renders the
	// literal "[object DocumentFragment]" instead of the page content).
	bothModes('ternary branch with props.children inserts slot nodes', `
		component Layout(props) {
			<div>{props.active ? props.children : <p>empty</p>}</div>
		}
	`, (code) => {
		expect(code).not.toContain('String(props.children)');
		expect(code).toContain('appendChild(props.children)');
	});

	// Fresh static/dynamic text inside a claimed element that also holds SSR
	// element children (a component-boundary wrapper) must be inserted at its
	// SSR position — before the residue — not blindly appended at the end
	// (the hero `compiler-first framework · <VersionBadge />` label reorders
	// badge-before-text without this). Verify the codegen slots the text
	// before `el.__vsk_ssrEls[0]` in hydrate mode and stays plain in normal
	// mode.
	bothModes('text before a component boundary is inserted before the SSR residue', `
		component X() { return <i>x</i>; }
		component P() {
			<span class="label">compiler-first framework · <X /></span>
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('__vsk_ssrEls');
			expect(code).toContain('insertBefore');
			expect(code).toContain('__ssr[0]');
		} else {
			expect(code).not.toContain('__vsk_ssrEls');
		}
	});

	// Interleaved text + static elements + component: each fresh text node
	// slots before the residue that follows it ('a' before ssr[0], 'c' before
	// ssr[1]; the final 'd' has no following residue so it appends).
	bothModes('interleaved text slots between SSR residues in source order', `
		component X() { return <i>x</i>; }
		component P() {
			<p>a <b>bold</b> c <X /> d</p>
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('__ssr[0]');
			expect(code).toContain('__ssr[1]');
			expect(code).toContain('appendChild');
		} else {
			expect(code).not.toContain('__vsk_ssrEls');
		}
	});

	// Dynamic text does the same positional insert — reactivity keeps writing
	// to the same (correctly positioned) node.
	bothModes('dynamic text before a component slots before the SSR residue', `
		component X() { return <i>x</i>; }
		component P() {
			let &[v] = track('hi');
			<span>{v}<X /></span>
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('insertBefore');
			expect(code).toContain('__ssr[0]');
		}
	});

	// A pure-static subtree child of a claimed (dynamic) element is retrieved
	// from `el.__vsk_ssrEls` and must NOT have its static text re-emitted —
	// isStaticIR guarantees no dynamic content, so every descendant already
	// exists in the SSR DOM. Re-creating the fresh text node would duplicate
	// the heading (the h1 "The compiler is the product." regression):
	// the fresh node appends AFTER the retained SSR text node.
	bothModes('pure static subtree child reuses SSR text without duplicating it (expr)', `
		component P() {
			let &[v] = track('hi');
			return <div><h1 class="title">The compiler is the product.</h1><p>{v}</p></div>;
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('__vsk_ssrEls[0]');
			expect(code).not.toContain('createTextNode("The compiler is the product.")');
		} else {
			expect(code).toContain('createTextNode("The compiler is the product.")');
			expect(code).not.toContain('__vsk_ssrEls');
		}
	});
	bothModes('pure static subtree child reuses SSR text without duplicating it (stmt)', `
		component P() {
			let &[v] = track('hi');
			<div><h1 class="title">The compiler is the product.</h1><p>{v}</p></div>
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('__vsk_ssrEls[0]');
			expect(code).not.toContain('createTextNode("The compiler is the product.")');
		} else {
			expect(code).toContain('createTextNode("The compiler is the product.")');
			expect(code).not.toContain('__vsk_ssrEls');
		}
	});

	// Nested pure static children (a grid with two cells) collapse to residue
	// refs only — no intermediate text re-creation inside the static subtree.
	bothModes('nested pure static subtree emits only SSR refs, no inner text (expr)', `
		component P() {
			let &[v] = track('hi');
			return <div><div class="grid"><h1>A</h1><h1>B</h1></div><p>{v}</p></div>;
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('__vsk_ssrEls[0]');
			expect(code).not.toContain('createTextNode("A")');
			expect(code).not.toContain('createTextNode("B")');
		} else {
			expect(code).toContain('createTextNode("A")');
			expect(code).toContain('createTextNode("B")');
		}
	});

});

describe('Client Codegen — Event Handlers', () => {

	// Expression mode
	bothModes('addEventListener expression mode', `
		component App { let &[count, c] = track(0); return <button onClick={() => c.set(count + 1)}>+</button>; }
	`, (code) => {
		expect(code).toContain('addEventListener');
		expect(code).toContain('click');
		expect(code).toContain('c.set');
		expect(code).toContain('get(c)');
	});
	// Statement mode
	bothModes('addEventListener statement mode', `
		component App {
			let &[count, c] = track(0);
			<button onClick={() => c.set(count + 1)}>+</button>
		}
	`, (code) => {
		expect(code).toContain('addEventListener');
		expect(code).toContain('click');
		expect(code).toContain('c.set');
		expect(code).toContain('get(c)');
	});

	// Expression mode
	bothModes('multiple event types expression mode', `
		component App {
			let &[v] = track('');
			return <input onChange={(e) => v.set(e.target.value)} onBlur={() => {}} />
		}
	`, (code) => {
		expect(code).toContain('addEventListener');
		expect(code).toContain('change');
		expect(code).toContain('blur');
	});
	// Statement mode
	bothModes('multiple event types statement mode', `
		component App {
			let &[v] = track('');
			<input onChange={(e) => v.set(e.target.value)} onBlur={() => {}} />
		}
	`, (code) => {
		expect(code).toContain('addEventListener');
		expect(code).toContain('change');
		expect(code).toContain('blur');
	});
	// Delegate dispatch must not stop at the nearest event-capable element when
	// its handler is undefined (`<Button/>` forwards an optional onClick that
	// was never passed). It walks ancestors so a real wrapper handler still fires.
	bothModes('delegated events fall through an undefined handler to an ancestor', `
		component App { return <div onClick={() => {}}><button onClick={undefined}>x</button></div>; }
	`, (code) => {
		expect(code).toContain('while (el && el.nodeType === 1)');
		expect(code).toContain('el = el.parentElement;');
		expect(code).not.toContain("closest('[data-vsk-ev]')");
	});
});

describe('Client Codegen — Refs', () => {

	bothModes('ref callback expression mode', `
		component App {
			let inputEl;
			return <input ref={el => inputEl = el} />;
		}
	`, (code) => {
		expect(code).toContain('(el => inputEl = el)($n0)');
	});

	bothModes('ref callback statement mode', `
		component App {
			let inputEl;
			<input ref={el => inputEl = el} />
		}
	`, (code) => {
		expect(code).toContain('(el => inputEl = el)($n0)');
	});

	bothModes('ref with tracked variable', `
		component App {
			let &[count, c] = track(0);
			<button ref={el => c.set(42)}>{count}</button>
		}
	`, (code) => {
		expect(code).toContain('c.set(42)');
	});

	bothModes('ref attribute not rendered as setAttribute', `
		component App { return <input ref={el => {}} />; }
	`, (code) => {
		expect(code).not.toContain('setAttribute');
	});
});

describe('Client Codegen — Statement Mode', () => {

	bothModes('bare JSX', `
		component App { <div>Hello</div> }
	`, (code, mode) => {
		if (mode === 'normal') {
			expect(code).toContain('createElement');
			expect(code).toContain('createTextNode');
		} else {
			expect(code).not.toContain('createElement');
			expect(code).not.toContain('createTextNode');
		}
	});

	bothModes('track declarations', `
		component App {
			let &[count] = track(0);
			<div>{count}</div>
		}
	`, (code) => {
		expect(code).toContain('track(');
		expect(code).toContain('get(count)');
	});

	bothModes('if with JSX', `
		component App(props: { s: boolean }) {
			if (props.s) { <div>Show</div> }
		}
	`, (code) => {
		expect(code).toContain('createComment');
		expect(code).toContain('effect(');
		expect(code).toContain('__cleanup');
	});

	bothModes('for-of loop', `
		component App(props: { items: string[] }) {
			for (const item of props.items) { <div>{item}</div> }
		}
	`, (code) => {
		expect(code).toContain('createComment');
		expect(code).toContain('effect(');
	});

	bothModes('preserves runtime statements', `
		component App(props: { x: number }) {
			const y = props.x * 2;
			<div>{y}</div>
		}
	`, (code) => {
		expect(code).toContain('const y = props.x * 2;');
	});

	bothModes('preserves runtime statement nested inside an element as code', `
		component App(props: { items: string[] }) {
			<div class="w">
				const total = props.items.length * 2;
				<p>{total}</p>
			</div>
		}
	`, (code) => {
		expect(code).toContain('const total = props.items.length * 2;');
		// must be emitted as an executable statement, not literal JSX text
		expect(code).not.toContain('createTextNode(" const total');
	});

	bothModes('nested runtime statement with comparison/complex initializers stays code', `
		component App(props: { score: number; obj: { a: number; b: number } }) {
			<div class="w">
				const flag = props.score > 5;
				const label = props.score > 5 ? 'big' : 'small';
				const { a, b } = props.obj;
				const map = { x: [1, 2], y: { z: 3 } };
				const f = (n) => n * 2;
				<p>{String(flag)} {label} {a + b} {map.x.length} {f(3)}</p>
			</div>
		}
	`, (code) => {
		expect(code).toContain('const flag = props.score > 5;');
		expect(code).toContain('const label = props.score > 5 ?');
		expect(code).toContain('const { a, b } = props.obj;');
		expect(code).toContain('const map = { x:');
		expect(code).toContain('const f = (n) => n * 2;');
		expect(code).not.toContain('createTextNode(" const flag');
	});

	bothModes('nested runtime statement ASI (no semicolon) compiles as code', `
		component App(props: { items: string[] }) {
			<div class="w">
				const total = props.items.length * 2
				<p>t={total}</p>
			</div>
		}
	`, (code) => {
		expect(code).toContain('const total = props.items.length * 2;');
	});

	bothModes('keeps prose starting with const/let/var as text on client', `
		component App {
			<div>
				<p>const value = 5 apples</p>
				<p>let x = y</p>
				<p>var args = rest</p>
			</div>
		}
	`, (code, mode) => {
		// Never emitted as executable statements (which would crash at runtime).
		expect(code).not.toContain('" const value = 5 apples;');
		if (mode === 'normal') {
			// In non-hydrate mode they are emitted as literal JSX text nodes.
			expect(code).toContain('createTextNode("const value = 5 apples")');
			expect(code).toContain('createTextNode("let x = y")');
			expect(code).toContain('createTextNode("var args = rest")');
		} else {
			// In hydrate mode static text is left in the SSR DOM, not re-created.
			expect(code).not.toContain('createTextNode("const value');
		}
	});

	bothModes('executes bare console.log child as code on client', `
		component App(props: { x: number }) {
			<div class="log">
				console.log("render start", props.x)
				<p>done</p>
			</div>
		}
	`, (code) => {
		// The bare call must be emitted as an executable statement, never a text node.
		expect(code).toContain('console.log("render start", props.x)');
		expect(code).not.toContain('createTextNode("console.log');
	});

	bothModes('keeps prose with parenthesised text as text on client', `
		component App {
			<div>
				<p>call me (maybe); ok</p>
				<p>the(cat) sat</p>
				<p>do(that)</p>
			</div>
		}
	`, (code, mode) => {
		if (mode === 'normal') {
			expect(code).toContain('createTextNode("call me (maybe); ok")');
			expect(code).toContain('createTextNode("the(cat) sat")');
			expect(code).toContain('createTextNode("do(that)")');
		}
	});

	bothModes('keeps a call followed by more prose on the same line as text on client', `
		component App(props: { x: number }) {
			<div>
				<p>doSomething(props.x) then more</p>
				<p>inline doSomething(props.x)</p>
			</div>
		}
	`, (code, mode) => {
		if (mode === 'normal') {
			expect(code).toContain('createTextNode("doSomething(props.x) then more")');
			expect(code).toContain('createTextNode("inline doSomething(props.x)")');
		}
		expect(code).not.toContain('doSomething(props.x);');
	});

	bothModes('interleaved runtime statements', `
		component App(props: { x: number }) {
			const y = props.x * 3;
			<div>{y}</div>
			const z = y + 1;
			<span>{z}</span>
		}
	`, (code) => {
		expect(code).toContain('const y = props.x * 3;');
		expect(code).toContain('const z = y + 1;');
	});

	bothModes('track set() call', `
		component App {
			let &[count] = track(0);
			count.set(42);
			<div>{count}</div>
		}
	`, (code) => {
		expect(code).toContain('count.set(42)');
		expect(code).toContain('get(count)');
	});

	bothModes('semicolon-less expression statement gets terminated', `
		component App {
			console.log('x')
			<div>hi</div>
		}
	`, (code) => {
		expect(code).toContain("console.log('x');");
	});

	bothModes('semicolon-less statements of every kind before JSX', `
		component App {
			foo()
			foo(1, 2)
			x = 5
			x++
			let &[count] = track(0)
			count++
			<div>{count}</div>
		}
	`, (code) => {
		expect(code).toContain('foo();');
		expect(code).toContain('foo(1, 2);');
		expect(code).toContain('x = 5;');
		expect(code).toContain('x++;');
		expect(code).toContain('set(count, get(count) + 1);');
	});

	bothModes('already-terminated statements are not doubled', `
		component App {
			console.log('x');
			<div>hi</div>
		}
	`, (code) => {
		expect(code).toContain("console.log('x');");
		expect(code).not.toContain("console.log('x');;");
	});

	bothModes('block-terminated statements keep their brace', `
		component App(props: { s: boolean }) {
			if (props.s) { foo() }
			<div>hi</div>
		}
	`, (code) => {
		expect(code).toContain('foo()');
	});
});

describe('Client Codegen — Islands & Zero-JS Detection', () => {

	// client keyword forces JS even for static components
	it('[normal] client keyword forces JS expression mode', () => {
		const code = compileClient('component App client { return <div>Static</div>; }', 'App');
		expect(code).not.toBe('');
		expect(code).toContain('__components');
	});
	it('[hydrate] client keyword forces JS expression mode', () => {
		const code = compileClient('component App client { return <div>Static</div>; }', 'App', { hydrate: true });
		expect(code).not.toBe('');
		expect(code).toContain('__components');
	});
	it('[normal] client keyword forces JS statement mode', () => {
		const code = compileClient('component App client { <div>Static</div> }', 'App');
		expect(code).not.toBe('');
		expect(code).toContain('__components');
	});
	it('[hydrate] client keyword forces JS statement mode', () => {
		const code = compileClient('component App client { <div>Static</div> }', 'App', { hydrate: true });
		expect(code).not.toBe('');
		expect(code).toContain('__components');
	});

	// Zero-JS: no client + static = no JS emitted
	it('[normal] zero JS expression mode', () => {
		const code = compileClient('component App { return <div>Static</div>; }', 'App');
		expect(code).toBe('');
	});
	it('[hydrate] zero JS expression mode', () => {
		const code = compileClient('component App { return <div>Static</div>; }', 'App', { hydrate: true });
		expect(code).toBe('');
	});
	it('[normal] zero JS statement mode', () => {
		const code = compileClient('component App { <div>Static</div> }', 'App');
		expect(code).toBe('');
	});
	it('[hydrate] zero JS statement mode', () => {
		const code = compileClient('component App { <div>Static</div> }', 'App', { hydrate: true });
		expect(code).toBe('');
	});

	bothModes('client keyword with dynamics still emits JS', `
		component App client { let &[c] = track(0); return <div>{c}</div>; }
	`, (code) => {
		expect(code).not.toBe('');
		expect(code).toContain('track(');
		expect(code).toContain('get(c)');
	});

	bothModes('export component client works', `
		export component App client { return <p>Hi</p> }
	`, (code) => {
		expect(code).not.toBe('');
		expect(code).toContain('export const App');
	});
});

describe('Client Codegen — Standalone layout directive', () => {

	// `export const standalone = true` is a compile-time routing directive for
	// the file router (isStandaloneLayoutFile). It must be consumed and dropped
	// from emitted JS — client chunks are IIFE-wrapped, so a bare `export` is a
	// syntax error that breaks hydration of the whole bundle.
	bothModes('const standalone directive is dropped from client output', `
		const Markup = () => null;
		export const standalone = true
		component Layout client { return <div>L</div> }
	`, (code) => {
		expect(code).not.toContain('export const standalone');
		expect(code).not.toContain('standalone = true');
		expect(code).toContain('__components["Layout"]');
	});

	bothModes('let standalone directive is dropped from client output', `
		export let standalone = true
		component Layout client { return <div>L</div> }
	`, (code) => {
		expect(code).not.toContain('export let standalone');
		expect(code).not.toContain('standalone = true');
	});

	bothModes('non-standalone const export still passes through', `
		export const keep = 42
		component Layout client { return <div>L</div> }
	`, (code, mode) => {
		expect(code).toContain('keep');
		expect(code).toContain('__components["Layout"]');
	});
});

describe('Client Codegen — Sub-Component Static Extraction', () => {

	// In hydrate mode, fully static elements emit zero DOM ops
	bothModes('static subtree emits zero DOM ops in hydrate', `
		component App { return <div><span>Static</span></div>; }
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).not.toContain('createElement');
			expect(code).not.toContain('createTextNode');
			expect(code).not.toContain('setAttribute');
		} else {
			expect(code).toContain('createElement');
			expect(code).toContain('createTextNode');
		}
	});

	// Dynamic container: element + text nodes are created
	bothModes('dynamic container creates text in hydrate', `
		component App(props: { n: number }) { return <div>{props.n}</div>; }
	`, (code, mode) => {
		expect(code).toContain('effect(');
		if (mode === 'hydrate') {
			expect(code).toContain('nextElement');
			expect(code).toContain('createTextNode');
		}
	});

	// Static child inside a dynamic container: child is skipped
	bothModes('static child inside dynamic container skipped in hydrate', `
		component App(props: { n: number }) { return <div><span>Static</span><p>{props.n}</p></div>; }
	`, (code, mode) => {
		expect(code).toContain('effect(');
		if (mode === 'hydrate') {
			expect(code).toContain('nextElement'); // div gets matched
			// The <span> should NOT produce any code (static subtree)
			// The <p> should produce nextElement
			// Only one nextElement for the dynamic container, and one for the <p>
		}
	});

	// Event handlers force the element to be dynamic
	bothModes('event handler forces hydrate matching', `
		component App { return <button onClick={() => {}}>Click</button>; }
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('nextElement');
			expect(code).toContain('addEventListener');
		} else {
			expect(code).toContain('createElement');
			expect(code).toContain('addEventListener');
		}
	});

	// Track+dynamic inside client component: only dynamic nodes get matched
	bothModes('client component with mixed content only matches dynamic nodes', `
		component App client {
			let &[count] = track(0);
			return <div class="app"><h1>Title</h1><p>{count}</p></div>;
		}
	`, (code, mode) => {
		expect(code).toContain('track(');
		expect(code).toContain('get(count)');
		if (mode === 'hydrate') {
			expect(code).toContain('nextElement'); // div or p
		}
	});
});

describe('Client Codegen — Syntax Validation', () => {

	bothModes('simple component compiles without errors', `
		component App { return <div>Hello</div>; }
	`, (code) => {
		try {
			new Function('track, effect, batch, derived', stripModuleWrapper(code));
		} catch (e) {
			throw new Error(`Syntax error: ${e.message}\n\n${code}`);
		}
	});

	bothModes('complex component compiles without errors', `
		component App(props: { items: string[], show: boolean }) {
			let &[count] = track(0);
			return (
				<div class="app">
					<h1>{props.show ? 'Visible' : 'Hidden'}</h1>
					<ul>{props.items.map((item) => <li>{item}</li>)}</ul>
					<p>{count}</p>
					<Child msg="hello" />
				</div>
			);
		}
		component Child(props: { msg: string }) { return <span>{props.msg}</span>; }
	`, (code) => {
		try {
			new Function('track, effect, batch, derived', stripModuleWrapper(code));
		} catch (e) {
			throw new Error(`Syntax error: ${e.message}\n\n${code}`);
		}
	});
});

describe('Keyed .map() reconciliation', () => {
	bothModes('keyed map uses reconcile helper', `
		component App(props: { items: { id: number, name: string }[] }) {
			return <ul>{props.items.map((item) => <li key={item.id}>{item.name}</li>)}</ul>;
		}
	`, (code) => {
		if (!code.includes('reconcile')) throw new Error('Expected reconcile import, got:\n' + code);
		if (!code.includes('item.id')) throw new Error('Expected key expression item.id in output, got:\n' + code);
	});

	bothModes('keyed map compiles without errors', `
		component App(props: { items: { id: number, name: string }[] }) {
			return <ul>{props.items.map((item) => <li key={item.id}>{item.name}</li>)}</ul>;
		}
	`, (code) => {
		try {
			new Function('track, effect, reconcile', stripModuleWrapper(code));
		} catch (e) {
			throw new Error(`Syntax error: ${e.message}\n\n${code}`);
		}
	});

	bothModes('statement mode keyed map compiles without errors', `
		component App(props: { items: { id: number, name: string }[] }) {
			let &[items] = track([]);
			<ul>{items.map((item) => <li key={item.id}>{item.name}</li>)}</ul>;
		}
	`, (code) => {
		try {
			new Function('track, effect, reconcile', stripModuleWrapper(code));
		} catch (e) {
			throw new Error(`Syntax error: ${e.message}\n\n${code}`);
		}
	});

	it('[normal] keyed map rebuilds via reconcile, not claim-by-key', () => {
		const code = compileClient(`
			component App(props: { items: { id: number, name: string }[] }) {
				return <ul>{props.items.map((item) => <li key={item.id}>{item.name}</li>)}</ul>;
			}
		`, null, { forceClient: true });
		if (!code.includes('reconcile(')) throw new Error('Expected reconcile() for normal keyed map:\n' + code.slice(0, 400));
		if (code.includes('reconcileHydrated') || code.includes('__hydrate.nextElement'))
			throw new Error('normal mode must not use claim-by-key hydration codegen:\n' + code.slice(0, 400));
	});

	it('[hydrate] keyed map claims by key instead of rebuilding', () => {
		const code = compileClient(`
			component App(props: { items: { id: number, name: string }[] }) {
				return <ul>{props.items.map((item) => <li key={item.id}>{item.name}</li>)}</ul>;
			}
		`, null, { hydrate: true, forceClient: true });
		if (!code.includes('reconcileHydrated(')) throw new Error('Expected reconcileHydrated() in hydrate mode:\n' + code.slice(0, 500));
		if (!code.includes('__root || __hydrate.nextElement("li")'))
			throw new Error("Expected claimed root `__root || __hydrate.nextElement(\"li\")` in hydrate renderItem:\n" + code.slice(0, 1200));
		if (!/\(item, __e, __r, __root\) =>/.test(code))
			throw new Error('Expected 4-arg renderItem (item, __e, __r, __root) with claimable root:\n' + code.slice(0, 1200));
		if (!code.includes('__root.nextSibling'))
			throw new Error('Expected claimed item to insert after __root.nextSibling:\n' + code.slice(0, 1200));
	});
});

describe('Effect blocks collected into per-item arrays', () => {

	// An effect block flushed into a keyed-map item's effects array must be
	// emitted as a handle-returning IIFE. A raw `{ let …; effect(…) }` block
	// in expression position parses as an object literal, so the whole
	// client chunk fails with a SyntaxError and the page never hydrates.
	// (Surfaced by nested loops inside component children, e.g. Roadmap.)
	bothModes('effectful nested map in component children of keyed item compiles', `
		const groups = [{ label: 'g' }];
		component Wrap(props) { return <div>{props.children}</div>; }
		component App {
			let &[active] = track(0);
			let &[items] = track(['a', 'b']);
			return <div>{groups.map(g => <Wrap key={g.label}><ul>{items.map(i => <li class={active === 0 ? 'a' : 'b'}>{i}</li>)}</ul></Wrap>)}</div>;
		}
	`, (code) => {
		try {
			new Function('track, effect, reconcile', stripModuleWrapper(code));
		} catch (e) {
			throw new Error(`Syntax error: ${e.message}\n\n${code}`);
		}
		expect(code).toContain('__e.push((() =>');
	});

	bothModes('statement-mode effectful nested map in component children of keyed item compiles', `
		const groups = [{ label: 'g' }];
		component Wrap(props) { <div>{props.children}</div> }
		component App {
			let &[active] = track(0);
			let &[items] = track(['a', 'b']);
			<div>{groups.map(g => <Wrap key={g.label}><ul>{items.map(i => <li class={active === 0 ? 'a' : 'b'}>{i}</li>)}</ul></Wrap>)}</div>;
		}
	`, (code) => {
		try {
			new Function('track, effect, reconcile', stripModuleWrapper(code));
		} catch (e) {
			throw new Error(`Syntax error: ${e.message}\n\n${code}`);
		}
		expect(code).toContain('__e.push((() =>');
	});
});

describe('Keyed for-of with ; key clause and #empty block', () => {
	bothModes('statement-mode keyed for-of uses reconcile and empty fallback', `
		component App(props: { todos: { id: number, text: string }[] }) {
			for (const todo of props.todos; key todo.id) {
				<li>{todo.text}</li>
			}
			#empty {
				<li>No todos yet</li>
			}
		}
	`, (code) => {
		if (!code.includes('reconcile')) throw new Error('Expected reconcile import, got:\n' + code);
		if (!code.includes('todo.id')) throw new Error('Expected key expression todo.id in output, got:\n' + code);
		if (!/__l != null && __l\.length > 0/.test(code)) throw new Error('Expected empty-state tracking, got:\n' + code);
		if (!code.includes('No todos yet')) throw new Error('Expected #empty content in output, got:\n' + code);
	});

	bothModes('statement-mode keyed for-of compiles without errors', `
		component App(props: { todos: { id: number, text: string }[] }) {
			for (const todo of props.todos; key todo.id) {
				<li>{todo.text}</li>
			}
			#empty {
				<li>No todos yet</li>
			}
		}
	`, (code) => {
		try {
			new Function('track, effect, reconcile', stripModuleWrapper(code));
		} catch (e) {
			throw new Error(`Syntax error: ${e.message}\n\n${code}`);
		}
	});

	bothModes('statement-mode for-of with ; index clause compiles', `
		component App(props: { todos: { id: number, text: string }[] }) {
			for (const todo of props.todos; key todo.id; index i) {
				<li>{i}: {todo.text}</li>
			}
		}
	`, (code) => {
		if (!code.includes('reconcile')) throw new Error('Expected reconcile import, got:\n' + code);
		try {
			new Function('track, effect, reconcile', stripModuleWrapper(code));
		} catch (e) {
			throw new Error(`Syntax error: ${e.message}\n\n${code}`);
		}
	});

	bothModes('key expression referencing the index variable binds the index', `
		component App(props: { todos: { id: number, text: string }[] }) {
			for (const todo of props.todos; key i; index i) {
				<li>{i}: {todo.text}</li>
			}
		}
	`, (code) => {
		if (!code.includes('reconcile')) throw new Error('Expected reconcile import, got:\n' + code);
		// The key function runs outside the item renderer, so the index must be
		// bound as its own parameter — `todo => i` would close over an undefined
		// `i` (ReferenceError at first render/hydrate). Parameters must be
		// parenthesized, or `todo, i => i` parses as a comma sequence expression
		// when passed in argument position to `reconcile`.
		if (!/\(\s*todo\s*,\s*i\s*\)\s*=>\s*i\b/.test(code)) {
			throw new Error('Expected parenthesized key function binding the index variable, got:\n' + code);
		}
		try {
			new Function('track, effect, reconcile', stripModuleWrapper(code));
		} catch (e) {
			throw new Error(`Syntax error: ${e.message}\n\n${code}`);
		}
	});

	bothModes('classic for-loop with key variable still compiles', `
		component App() {
			for (let key = 0; key < 5; key++) {
				<li>{key}</li>
			}
		}
	`, (code) => {
		try {
			new Function('track, effect', stripModuleWrapper(code));
		} catch (e) {
			throw new Error(`Syntax error: ${e.message}\n\n${code}`);
		}
	});
});

describe('Keyed map nested in a branch builder', () => {
	bothModes('nested keyed map registers its effect in the enclosing scope', `
		component App(props: { items: { id: number, text: string }[] }) {
			if (props.items.length === 0) {
				<p>empty</p>
			} else {
				for (const todo of props.items; key todo.id) {
					<li>{todo.text}</li>
				}
			}
		}
	`, (code) => {
		if (!/reconcile\w*\(/.test(code)) throw new Error('Expected reconcile call, got:\n' + code);
		// The reconciler updater is declared inside the branch builder, so its
		// effect must be created in that same scope (registered on the
		// enclosing effects array) — never flushed to the component top level
		// where the name is out of scope (`$nNN is not defined` at hydration).
		if (!/\.push\(\(\(\) => \{\s*let __first = true;\s*return effect\(/.test(code)) {
			throw new Error('Expected map effect registered inline on enclosing effects array, got:\n' + code);
		}
		try {
			new Function('track, effect, reconcile', stripModuleWrapper(code));
		} catch (e) {
			throw new Error(`Syntax error: ${e.message}\n\n${code}`);
		}
	});
});

describe('Client Codegen — While / Do-While / For / Switch Blocks', () => {
	bothModes('while loop emits anchor pair + render function', `
		component App() {
			let n = 0;
			while (n < 3) { <span>{n}</span>; n = n + 1 }
		}
	`, (code) => {
		expect(code).toContain("createComment('while')");
		expect(code).toContain("createComment('while-end')");
		expect(code).toContain('while (n < 3) {');
		expect(code).toContain('__cleanup(');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	bothModes('do-while loop emits do block', `
		component App() {
			let n = 0;
			do { <span>{n}</span>; n = n + 1 } while (n < 3)
		}
	`, (code) => {
		expect(code).toContain('do {');
		expect(code).toContain('} while (n < 3);');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	bothModes('for-in loop iterates keys via Object.keys', `
		component App() {
			const obj = { a: 1, b: 2 };
			for (const key in obj) { <span>{key}</span> }
		}
	`, (code) => {
		expect(code).toContain("createComment('for')");
		expect(code).toContain('Object.keys(');
		expect(code).toContain('for (const key of ');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	bothModes('classic for loop emits a real for statement', `
		component App() {
			let i = 0;
			for (i = 0; i < 3; i = i + 1) { <span>{i}</span> }
		}
	`, (code) => {
		expect(code).toContain('i = 0');
		expect(code).toContain('for (i = 0; i < 3; i = i + 1) {');
		expect(code).not.toContain('while (i < 3) {');
		expect(code).toContain('i = i + 1');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	// A for-loop with a loop-local binding (`for (let i ...)`) is static: it must
	// not emit a re-render effect that references the loop-local variable from the
	// component scope (which would throw "i is not defined").
	bothModes('for loop with local binding is static (no outer effect)', `
		component App() {
			for (let i = 0; i < 3; i++) { <span>{i}</span> }
		}
	`, (code) => {
		expect(code).toContain('for (let i = 0; i < 3; i++) {');
		expect(code).not.toContain('let __iv = !(i < 3)');
		expect(code).not.toContain('const __nv = (i < 3)');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

// Closures created inside a classic for-loop body (event handlers, effects)
		// must capture that iteration's loop variable, not the alias-exited final
		// value the old hoisted `let init; while (…) { …; update }` shape produced.
		bothModes('classic for loop closures capture the per-iteration binding', `
		component App(props: { tabs: string[] }) {
			const &[sel] = track(0);
			for (let i = 0; i < props.tabs.length; i++) {
				<button aria-pressed={i === sel} onClick={() => sel = i}>{props.tabs[i]}</button>
			}
		}
	`, (code) => {
			const header = 'for (let i = 0; i < props.tabs.length; i++) {';
			const headerIdx = code.indexOf(header);
			expect(headerIdx !== -1).toBe(true);
			// Body = everything between the header line and the `}` that closes it
			// (tracked with brace depth so nested effect/render braces are skipped).
			const bodyStart = code.indexOf('\n', headerIdx) + 1;
			let depth = 1;
			let closeIdx = -1;
			for (let pos = bodyStart; pos < code.length; pos++) {
				const ch = code[pos];
				if (ch === '{') depth++;
				if (ch === '}') depth--;
				if (depth === 0) { closeIdx = pos; break; }
			}
			expect(closeIdx > bodyStart).toBe(true);
			const body = code.slice(bodyStart, closeIdx);
			// The write must be the closure's own loop variable (`set(sel, i)`), and
			// the reactive read must compare the same per-iteration binding.
			expect(body).toContain('set(sel, i)');
			expect(body).toContain('i === get(sel)');
			// The update must live in the `for` header, not as a body statement.
			expect(body).not.toContain('i++');
			try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
		});

	// Toggling a boolean expression-valued attribute back to falsy must
	// REMOVE the attribute, mirroring the SSR serializer (`__attr` omits
	// null/false). Reproduced in vesk-doc: CommandTabs/DocTabs leave a stale
	// `aria-pressed="true"` on both tabs after switching because the previous
	// emission only SET the attribute and never removed it.
	bothModes('dynamic boolean attribute is removed when toggled back to false', `
		component App(props: { tabs: string[] }) {
			const &[sel] = track(0);
			<div>
				<button aria-pressed={sel === 0} onClick={() => sel = 1}>a</button>
				<button aria-pressed={sel === 1} onClick={() => sel = 0}>b</button>
			</div>
		}
	`, (code) => {
		expect(code).toContain('const __v = get(sel) === 0');
		expect(code).toContain('.removeAttribute("aria-pressed")');
		expect(code).toContain('.setAttribute("aria-pressed", __v === true ? \'true\' : String(__v))');
		expect(code).not.toContain('__v != null && __v !== false');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	// A for-of loop over a static collection (module const, member of a loop
	// variable, or statement-mode local) must NOT emit a top-level re-render
	// effect: that effect would reference the loop-local variable from the
	// component scope where it is undefined. Reproduced in vesk-doc: the Footer
	// iterates `for (const col of columns)` with an inner `for (const link of
	// col.links)`, and /docs iterates `for (const group of docGroups)` with a
	// statement-mode `const pages = …` — both threw `ReferenceError` at hydrate.
	bothModes('nested for-of over static member collection emits no outer effect', `
		const columns = [{ title: 'a', links: ['x', 'y'] }];
		component App() {
			for (const col of columns) {
				<div>{col.title}</div>
				for (const link of col.links) { <a>{link}</a> }
			}
		}
	`, (code) => {
		expect(code).not.toContain('__nv = col.links');
		expect(code).not.toContain('__nv = col.title');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	bothModes('for-of with statement-mode local derived array emits no outer effect', `
		const docGroups = [{ name: 'a' }];
		const docPages = [{ title: 'p', group: 'a' }];
		component App() {
			for (const group of docGroups) {
				const pages = docPages.filter((p) => p.group === group);
				if (pages.length > 0) {
					for (const p of pages) { <span>{p.title}</span> }
				}
			}
		}
	`, (code) => {
		expect(code).not.toContain('__nv = pages');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	// The if/else empty-state marker must parenthesize the negated condition so a
	// compound condition (`props.x && props.x.length > 0`) does not throw when
	// props.x is undefined.
	// The if/else region must render its branch during body execution (so SSR
	// claims happen in DOM order) and guard the mount-time effect with __first.
	// The first (mount) run must still read the condition so the effect registers
	// its dependencies — otherwise the region never re-renders on a tracked
	// change (the `__first` guard previously returned before any tracked read).
	bothModes('if/else negated condition is parenthesized', `
		component App(props: { posts?: { title: string }[] }) {
			if (props.posts && props.posts.length > 0) {
				<p>Has posts</p>
			} else {
				<p>No posts</p>
			}
		}
	`, (code, mode) => {
		expect(code).toContain('if (props.posts && props.posts.length > 0) { ');
		expect(code).toContain('} else { ');
		expect(code).toContain('let __first = true;');
		expect(code).toContain('if (__first) { __first = false; __iv = props.posts && props.posts.length > 0; return; }');
		expect(code).not.toContain('let __iv = !(props.posts && props.posts.length > 0);');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	// An `if / else-if / else-if` chain is collapsed into one region in hydrate
	// mode. Independent `if` blocks that render in the same slot were rewritten
	// to a chain by the user; the region's `branchInit` must cover EVERY branch
	// index (not just the first two) so switching the tracked condition renders
	// the matching branch — previously indices >= 2 fell to `-1` and the branch
	// content vanished from the DOM.
	// The mount-time `__first` effect guard must ALSO read the branch init on its
	// first run so the region subscribes to the tracked condition; returning
	// before any tracked read leaves the effect dependency-less and it never
	// re-renders on a subsequent change (same rule as single `if/else`).
	bothModes('if / else-if / else-if chain dispatches every branch index', `
		component App {
			let &[target] = track("ssr")
			if (target === "ssr") {
				<p>ssr</p>
			} else if (target === "web") {
				<p>web</p>
			} else if (target === "native") {
				<p>native</p>
			}
		}
	`, (code, mode) => {
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
		if (mode === 'hydrate') {
			expect(code).toContain('(get(target) === "ssr" ? 0 : (get(target) === "web" ? 1 : (get(target) === "native" ? 2 : -1)))');
			expect(code).toContain('else if (__new === 1)');
			expect(code).toContain('else if (__new === 2)');
			expect(code).not.toContain('else if (__new === 3)');
			expect(code).toContain('if (__first) { __first = false; __iv = ((get(target) === "ssr" ? 0 : (get(target) === "web" ? 1 : (get(target) === "native" ? 2 : -1))));');
		} else {
			// normal mode: nested regions — the innermost else-if still dispatches.
			expect(code).toContain('if (get(target) === "native") { ');
		}
	});

	bothModes('if / else-if with final else binds the final branch index', `
		component App {
			let &[mode] = track(0)
			if (mode === 0) {
				<p>zero</p>
			} else if (mode === 1) {
				<p>one</p>
			} else {
				<p>other</p>
			}
		}
	`, (code, mode) => {
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
		if (mode === 'hydrate') {
			// final `else` renders when no condition matches — index == chain.length
			expect(code).toContain('(get(mode) === 0 ? 0 : (get(mode) === 1 ? 1 : 2))');
			expect(code).toContain('if (__first) { __first = false; __iv = ((get(mode) === 0 ? 0 : (get(mode) === 1 ? 1 : 2)));');
		}
	});

	bothModes('fully-static else-if branches each claim SSR content in hydrate mode', `
		component App {
			let &[target] = track("ssr")
			if (target === "ssr") {
				<p id="out">SSR</p>
			} else if (target === "web") {
				<p id="out">WEB</p>
			} else if (target === "native") {
				<p id="out">NATIVE</p>
			}
		}
	`, (code, mode) => {
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
		if (mode === 'hydrate') {
			// every branch must adopt the server-rendered element (claimStatic),
			// so a switch away from the initially-rendered branch rebuilds it in place.
			expect(
				code.match(/__hydrate\.nextElement\("p"\)/g)?.length ?? 0
			).toBe(3);
			expect(code).toContain('createTextNode("WEB")');
			expect(code).toContain('createTextNode("NATIVE")');
		} else {
			// normal mode builds fresh elements — one per branch.
			expect(
				code.match(/document\.createElement\("p"\)/g)?.length ?? 0
			).toBe(3);
		}
	});

	bothModes('fully-static plain if/else branch claims SSR content in hydrate mode', `
		component App {
			let &[mode] = track(0)
			if (mode === 0) {
				<p id="out">OFF</p>
			} else {
				<span class="pill">ON</span>
				<p id="out">ON</p>
			}
		}
	`, (code, mode) => {
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
		if (mode === 'hydrate') {
			// both roots of the multi-root alternate claim their own subtree.
			expect(
				code.match(/__hydrate\.nextElement\("p"\)/g)?.length ?? 0
			).toBe(2);
			expect(code).toContain('__hydrate.nextElement("span")');
			expect(code).toContain('createTextNode("ON")');
		} else {
			expect(code).toContain('document.createElement("span")');
			expect(code).toContain('document.createElement("p")');
		}
	});

	bothModes('switch block emits case rendering', `
		component App() {
			const score = 7;
			switch (score) { case 7: <p>Seven</p>; default: <p>Other</p> }
		}
	`, (code) => {
		expect(code).toContain("createComment('switch')");
		expect(code).toContain('switch (score) {');
		expect(code).toContain('case 7:');
		expect(code).toContain('default:');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	bothModes('while condition rewrites track reads/writes', `
		component App() {
			const &[n] = track(0);
			while (n < 3) { <span>{n}</span>; n = n + 1 }
		}
	`, (code) => {
		expect(code).toContain('while (get(n) < 3) {');
		expect(code).toContain('set(n, get(n) + 1)');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	bothModes('switch discriminant rewrites track reads', `
		component App() {
			const &[score] = track(7);
			switch (score) { case 7: <p>Seven</p> }
		}
	`, (code) => {
		expect(code).toContain('switch (get(score)) {');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	bothModes('every region collects claimed nodes and places anchors in place', `
		component App() {
			if (cond) { <p>a</p> }
			while (n < 3) { <span>{n}</span>; n = n + 1 }
			for (const item of items) { <span>{item}</span> }
			switch (score) { case 1: <p>One</p> }
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('__cl.push(');
			expect(code).toContain('const __cl = [];');
			expect(code).toContain('const $root = __hydrate.root;');
			// $mount split: a hydrator returns the component's own first
			// top-level node so callers never receive (and re-insert) the
			// shared page container. Regression anchor for the verify-page
			// blank/hydration-cycle bug (commit af11554).
			expect(code).toContain('let $mount = null;');
			expect(code).toContain('if ($mount === null) $mount = document.createDocumentFragment();');
			expect(code).toContain('return __pendingChild || $mount;');
			expect(code).not.toContain('return __pendingChild || $root;');
		} else {
			expect(code).toContain('document.createDocumentFragment();');
			expect(code).toContain('return __pendingChild || $root;');
			expect(code).not.toContain('$mount');
			expect(code).not.toContain('__cl.push(');
		}
		expect(code).toContain('__place(');
		expect(code).toContain('if (__first) { __first = false; __iv =');
		expect(code).toContain('__cleanup(');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	// A `for` loop whose item body starts with a block-level node (`if`) must
	// NOT let that node sink to `$root` on fresh (non-hydrate) renders. Each
	// item renders into its own DocumentFragment (`__it`) which is inserted
	// before the refresh anchor; the block anchors must attach to the fragment.
	// Reproduced in vesk-doc: the docs route iterates `doc.blocks` with a
	// statement-mode `if (block.kind === 'h2')` chain — before the fix the page
	// content escaped into the layout slot container, above the article.
	bothModes('map item with top-level if stays inside its item fragment', `
		const blocks = [{ kind: 'h2', value: 'A' }, { kind: 'p', value: 'B' }];
		component App() {
			<article>
				for (const block of blocks) {
					if (block.kind === 'h2') { <h2>{block.value}</h2> }
					<p>{block.value}</p>
				}
			</article>
		}
	`, (code, mode) => {
		const fragIdx = code.indexOf('const __it = document.createDocumentFragment();');
		if (mode === 'normal') {
			expect(fragIdx).not.toBe(-1);
			expect(code.indexOf('__p.insertBefore(__it, __r);')).not.toBe(-1);
			const between = code.slice(fragIdx, code.indexOf('__p.insertBefore(__it, __r);'));
			expect(between).not.toContain('$root.appendChild');
		} else {
			expect(fragIdx).toBe(-1);
			expect(code).toContain('__cl.push(');
			expect(code).toContain('__place(');
		}
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	// Statement-mode block-level bodies inside `while`/`switch`/`try` containers
	// follow the same rule on fresh renders: their anchors anchor to the container
	// fragment, never to `$root`.
	bothModes('while/switch/try block-level bodies do not sink to $root', `
		const items = [1, 2];
		component App() {
			while (false) { if (x) { <i>a</i> } }
			for (const it of items) { switch (it) { case 1: <b>1</b> } }
			try { if (y) { <u>c</u> } } catch (e) { <em>err</em> }
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).not.toContain('const __it = document.createDocumentFragment();');
			expect(code).not.toContain('const __b = document.createDocumentFragment();');
			expect(code).not.toContain('const __c = document.createDocumentFragment();');
			expect(code).toContain('const __cl = [];');
			expect(code).toContain('__place(');
			return;
		}
		for (const m of ['insertBefore(__it, __r);', 'insertBefore(__b,']) {
			expect(code).toContain(m);
		}
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});
	// during body execution so their SSR content gets claimed in DOM order.
	bothModes('classic for renders during body execution', `
		component App() {
			for (let i = 0; i < 3; i++) { <span>{i}</span> }
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('__cl.push(');
			expect(code).toContain('__place(');
			expect(code).not.toContain('const __nv = (i < 3)');
		}
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	// The switch `Seven`/`Other` paragraphs are fully static (no SSR marker), so
	// they must NOT be claimed — otherwise the walker would skip forward and steal
	// a later region's marker. Anchors still get placed via __place.
	bothModes('static-only switch case content is not claimed', `
		component App() {
			switch (7) { case 7: <p>Seven</p> }
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).not.toContain('nextElement("p")');
			expect(code).toContain('__place(');
		}
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	// Hydrate-mode region fences are anchored to the walker's current SSR slot
	// (`insertBeforeNextClaim`) so a conditional region with NO SSR content mounts
	// at its source-file position instead of the shared root's end — the vesk-doc
	// "mobile menu renders at the bottom of the page after a full reload" bug
	// (DocsHeader's `if (open)` region). Fences must be anchored in BOTH
	// statement-mode bodies (bare `if`) and expression-mode bodies (`{cond ? …}`).
	// Anchoring applies ONLY when the region's fallback parent is `$root` — a
	// region nested inside a claimed element (a ternary inside a `<button>`, a
	// copy-button icon swap) must keep its fences INSIDE that element so `__place`
	// swaps the branch in place; anchoring at the walker slot would re-render the
	// branch outside the element and make the icon disappear on toggles.
	bothModes('hydrate root-level if anchors fences to the SSR slot', `
		const open = false;
		component App() {
			if (open) { <div class="mobile">menu</div> }
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			// the root-level `if` emits exactly anchor+endAnchor calls
			expect((code.match(/insertBeforeNextClaim\(/g) || []).length).toBe(2);
			expect(code).toContain('__place(');
		} else {
			expect(code).not.toContain('insertBeforeNextClaim(');
		}
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	bothModes('hydrate in-element ternary region stays in-place (no SSR-slot anchoring)', `
		const open = false;
		component App() {
			<button type="button" aria-label={open ? "Close" : "Open"}>{open ? <em>X</em> : <em>M</em>}</button>
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			// the in-button region must keep its fences inside the button
			expect(code).not.toContain('insertBeforeNextClaim(');
			expect(code).toContain('__place(');
		}
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	bothModes('hydrate root-level {cond ? … : …} region anchors fences to the SSR slot', `
		const open = false;
		component App() {
			<>
				<span class="hot">hot</span>
				{open ? <em>X</em> : <em>M</em>}
			</>
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect((code.match(/insertBeforeNextClaim\(/g) || []).length).toBe(2);
			expect(code).toContain('__place(');
		} else {
			expect(code).not.toContain('insertBeforeNextClaim(');
		}
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	// vesk-doc menu panel regression: a no-content `if` region at the ROOT of a
	// nested component's `<>` fragment (sibling of its `<header>`) must anchor to
	// its SSR slot even though the component body runs inside the parent's child
	// hydration frame. The anchor must never be gated on `childFrame` — `$root`
	// fallback already implies the region is a top-level sibling of its claims.
	bothModes('hydrate nested-component fragment if anchors fences regardless of child frame', `
		const open = false;
		component Panel() {
			<>
				<header class="top"><em>crew</em></header>
				if (open) { <div class="panel">menu</div> }
			</>
		}
		component App() {
			<Panel />
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect((code.match(/insertBeforeNextClaim\(/g) || []).length).toBe(2);
			expect(code).not.toContain('!__hydrate.childFrame');
			expect(code).toContain('__place(');
		} else {
			expect(code).not.toContain('insertBeforeNextClaim(');
		}
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});
});

describe('Client Codegen — Async Components', () => {

	it('[normal] async component body is an async function', () => {
		const code = compileClient(`
			async component Async() {
				const data = await Promise.resolve([1, 2])
				<div>{data[0]}</div>
			}
		`, null, { forceClient: true });
		expect(code).toContain('async (props) => {');
		expect(code).toContain('await Promise.resolve([1, 2])');
	});

	it('[normal] async parent calling async child awaits', () => {
		const code = compileClient(`
			async component Child() {
				const data = await Promise.resolve('hi')
				<div>{data}</div>
			}
			async component Parent() {
				<Child />
			}
		`, null, { forceClient: true });
		expect(code).toContain('async (props) => {');
		expect(code).toContain('await __components["Child"]');
	});

	it('[hydrate] async parent calling async child awaits in hydrate mode', () => {
		const code = compileClient(`
			async component Child() {
				const data = await Promise.resolve('hi')
				<div>{data}</div>
			}
			async component Parent() {
				<Child />
			}
		`, null, { hydrate: true, forceClient: true });
		expect(code).toContain('async (props, __registry, __hydrate) => {');
		expect(code).toContain('await __components["Child"]');
	});

	it('[normal] deeply nested async chain awaits at every level', () => {
		const code = compileClient(`
			async component Leaf() {
				const data = await Promise.resolve(1)
				<p>{data}</p>
			}
			async component Mid() {
				<Leaf />
			}
			async component Root() {
				<Mid />
			}
		`, null, { forceClient: true });
		const parentSrc = code.slice(code.indexOf('__components["Root"]'), code.indexOf('function __cleanup'));
		expect(parentSrc).toContain('async (props) => {');
		expect(parentSrc).toContain('await __components["Mid"]');
		const midSrc = code.slice(code.indexOf('__components["Mid"]'), code.indexOf('__components["Root"]'));
		expect(midSrc).toContain('async (props) => {');
		expect(midSrc).toContain('await __components["Leaf"]');
	});

	it('[normal] async component inside a dynamic region is awaited', () => {
		const code = compileClient(`
			async component Card() {
				const data = await Promise.resolve(1)
				<p>{data}</p>
			}
			async component App(props: { show: boolean }) {
				if (props.show) { <Card /> }
			}
		`, null, { forceClient: true });
		expect(code).toContain('await __components["Card"]');
	});

	it('sync parent calling async child is a compile error', () => {
		try {
			compileClient(`
				async component Child() {
					const data = await Promise.resolve('hi')
					<div>{data}</div>
				}
				component Parent() {
					<Child />
				}
			`, null, { forceClient: true });
			throw new Error('expected compile error');
		} catch (e) {
			expect(e.constructor.name).toBe('VeskError');
			expect(e.message).toContain('Parent');
			expect(e.message).toContain('Child');
		}
	});

	// Cross-file imported children cannot be named in the local asyncComps
	// set (that set only covers same-file declarations), so the await must be
	// driven by the *parent's* async-ness — mirroring the server side. A
	// sync child scoped in the same file is the closest single-file proxy for
	// an imported child whose async-ness is invisible to this compilation.
	it('[normal] async parent awaits every child, even one whose own file is not compiled here', () => {
		const code = compileClient(`
			component SyncChild() {
				<div>hi</div>
			}
			async component Parent() {
				const data = await Promise.resolve('hi')
				<SyncChild />
			}
		`, null, { forceClient: true });
		expect(code).toContain('async (props) => {');
		expect(code).toContain('await __components["SyncChild"]');
	});

	it('[hydrate] async parent awaits imported child in hydrate mode', () => {
		const code = compileClient(`
			component SyncChild() {
				<div>hi</div>
			}
			async component Parent() {
				const data = await Promise.resolve('hi')
				<SyncChild />
			}
		`, null, { hydrate: true, forceClient: true });
		expect(code).toContain('async (props, __registry, __hydrate) => {');
		expect(code).toContain('await __components["SyncChild"]');
	});
});

// ── JSX in dynamic expressions (esrap tsx fallback) ───────────

{
  const src = `import { Md } from '@vesk/runtime';
let &[n] = track<number>(0)
const presets = [{ md: '# a' }, { md: '# b' }];
component X {
	<button onclick={() => n = 1}
		class={n === 0 ? 'on' : 'off'}>go</button>
	if (n === 0) {
		<Md content={presets[0].md} />
	} else {
		<Md content={presets[1].md} />
	}
}`;
  try {
    const code = compileClient(src, 'X', { forceClient: true });
    passed++;
    console.log('  ✓ component call inside tracked if/else compiles (tsx print path)');
    if (!code.includes('Md(')) { failed++; console.log('    ✗ Md call missing from output'); }
    if (/Not implemented/.test(code)) { failed++; console.log('    ✗ esrap not-implemented leaked into output'); }
  } catch (e) {
    failed++;
    console.log(`  ✗ component call inside tracked if/else — ${e.message}`);
  }
}


describe('OpaqueDynamicRegion guard scoping inside list items', () => {
	const guardLine = 'let __iv = get(sel) === it.name;';

	// Statement-mode `for...of` whose item markup contains a tracked conditional
	// text expression. The conditional's reactivity guard effect must be collected
	// by the item's `__e` bucket — not leaked to the component top level where the
	// loop variable `it` is out of scope (ReferenceError on hydration).
	bothModes('keeps for-of item conditional guard in item scope (statement)', `
		component App {
			const ITEMS = [{ name: 'a' }, { name: 'b' }];
			let &[sel] = track('');
			<div>
				for (const it of ITEMS) {
					<button>{sel === it.name ? 'Done' : 'Copy'}</button>
				}
			</div>
		}
	`, (code) => {
		expect(code).toContain('for (const it of ITEMS) {');
		expect(code).toContain('__e.push((() => {');
		expect(code.split('\n').filter((l) => l.trim() === guardLine).length).toBe(1);
		expect(code.indexOf(guardLine) > code.indexOf('__e.push((() => {')).toBe(true);
	});

	// Expression mode: `{ARR.map((it) => ...)}` compiles to the same MapRegion,
	// so the identical scoping rule applies.
	bothModes('keeps map-callback conditional guard in item scope (expression)', `
		component App {
			const ITEMS = [{ name: 'a' }, { name: 'b' }];
			let &[sel] = track('');
			return <div>{ITEMS.map((it) => <button>{sel === it.name ? 'Done' : 'Copy'}</button>)}</div>;
		}
	`, (code) => {
		expect(code).toContain('__e.push((() => {');
		expect(code.split('\n').filter((l) => l.trim() === guardLine).length).toBe(1);
		expect(code.indexOf(guardLine) > code.indexOf('__e.push((() => {')).toBe(true);
	});
});


describe('Statement-mode guard-clause early return', () => {
	// `if (c) return X` with no else compiles the rest of the body as the
	// alternate branch — the return must not be swallowed (fall-through).
	bothModes('guard if/else-fold emits both branches', `
		component App(props: { ok: boolean }) {
			if (!props.ok) {
				return <div>missing</div>;
			}
			<div>found</div>
		}
	`, (code, mode) => {
		if (mode === 'normal') {
			expect(code).toContain('missing');
			expect(code).toContain('found');
		} else {
			// hydrate claims the SSR-rendered branch; assert the dispatch
			expect(code).toContain('if (!props.ok)');
		}
	});
	bothModes('lookup-pattern guard keeps post-guard statements', `
		component App(props: { slug: string }) {
			const doc = props.slug;
			if (!doc) {
				return <div>404</div>;
			}
			<div>{doc}</div>
		}
	`, (code, mode) => {
		if (mode === 'normal') expect(code).toContain('404');
		else expect(code).toContain('if (!doc)');
	});
	bothModes('bare return guard folds rest into the alternate branch', `
		component App(props: { show: boolean }) {
			if (!props.show) return
			<span>v{props.ver}</span>
		}
	`, (code) => {
		// Regression: `if (c) return` (no argument) must not swallow the return
		// and emit later roots unconditionally. The fixed output dispatches the
		// empty guard branch and the root from an if/else; the buggy output had
		// no `else` at all (roots emitted unconditionally after the `if`).
		const ifIdx = code.indexOf('if (!props.show) {');
		const elseIdx = code.indexOf('} else {');
		expect(ifIdx > -1).toBe(true);
		expect(elseIdx > ifIdx).toBe(true);
	});
});

describe('Dynamic component tags — member expressions + bound values', () => {

	// `<it.icon>` must invoke the component value, never
	// `document.createElement("it.icon")` or a dotted registry lookup.
	bothModes('member-expression tag invokes value (expression)', `
		import { Cpu } from 'lucide-vesk';
		const items = [{ icon: Cpu }];
		component App {
			return <div>{items.map((it) => <it.icon class="size-4" />)}</div>;
		}
	`, (code) => {
		expect(code).toContain('(it.icon)({');
		expect(code).not.toContain('createElement("it.icon")');
		expect(code).not.toContain('__components["it.icon"]');
		expect(code).not.toContain('__hydrators["it.icon"]');
	});
	bothModes('member-expression tag invokes value (statement)', `
		import { Cpu } from 'lucide-vesk';
		const items = [{ icon: Cpu }];
		component App {
			<div>
				for (const it of items) { <it.icon class="size-4" /> }
			</div>
		}
	`, (code) => {
		expect(code).toContain('(it.icon)({');
		expect(code).not.toContain('createElement("it.icon")');
		expect(code).not.toContain('__components["it.icon"]');
		expect(code).not.toContain('__hydrators["it.icon"]');
	});
	bothModes('namespaced member tag invokes value', `
		const NS = { Foo: (props) => null };
		component App {
			return <div><NS.Foo bar="1" /></div>;
		}
	`, (code) => {
		expect(code).toContain('(NS.Foo)({');
		expect(code).not.toContain('__components["NS.Foo"]');
		expect(code).not.toContain('__hydrators["NS.Foo"]');
	});

	// A top-level binding holding a component (`const MyIcon = Cpu`) is in
	// module scope, so the tag must call it directly — not via registry.
	bothModes('top-level bound component invokes value (expression)', `
		import { Cpu } from 'lucide-vesk';
		const MyIcon = Cpu;
		component App { return <div><MyIcon class="size-4" /></div>; }
	`, (code) => {
		expect(code).toContain('MyIcon({');
		expect(code).not.toContain('__components["MyIcon"]');
		expect(code).not.toContain('__hydrators["MyIcon"]');
	});
	bothModes('top-level bound component invokes value (statement)', `
		import { Cpu } from 'lucide-vesk';
		const MyIcon = Cpu;
		component App { <div><MyIcon class="size-4" /></div> }
	`, (code) => {
		expect(code).toContain('MyIcon({');
		expect(code).not.toContain('__components["MyIcon"]');
		expect(code).not.toContain('__hydrators["MyIcon"]');
	});

	// Guards against over-correction: file-defined components keep
	// registry resolution, including over a same-named top-level binding.
	// (Static children hydrate through a `__components` stub — the real
	// `__hydrators` map entry only exists for non-static components.)
	bothModes('same-file static component still resolves via registry', `
		component Inner { return <span>hi</span>; }
		component App { return <div><Inner /></div>; }
	`, (code) => {
		expect(code).toContain('__components["Inner"]');
	});
	bothModes('same-file interactive component still resolves via registry', `
		component Inner { return <button onClick={() => {}}>hi</button>; }
		component App { return <div><Inner /></div>; }
	`, (code) => {
		expect(code).toContain('__components["Inner"]');
	});
	bothModes('component declaration wins over same-named top-level binding', `
		const Foo = (props) => null;
		component Foo { return <span>comp</span>; }
		component App { return <div><Foo /></div>; }
	`, (code) => {
		expect(code).toContain('__components["Foo"]');
	});
});


console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
else console.log('All tests passed!');
