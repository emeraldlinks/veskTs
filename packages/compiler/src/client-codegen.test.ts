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

	// Fragment — statement + expression mode (via JSX <></>)
	bothModes('uses fragment expression mode', `
		component App { return <><div>A</div><div>B</div></>; }
	`, (code, mode) => {
		if (mode === 'normal') expect(code).toContain('DocumentFragment');
		else expect(code).toContain('__hydrate.root');
	});
	bothModes('uses fragment statement mode', `
		component App { <div>A</div><div>B</div> }
	`, (code, mode) => {
		if (mode === 'normal') expect(code).toContain('DocumentFragment');
		else expect(code).toContain('__hydrate.root');
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
		component Demo { const name = 'Vesk'; <Link href="/">{name}</Link> }
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

	// Dynamic text child of a component call inside a keyed-map block must push
	// its effect into the block's per-item effects array (in the block's scope).
	bothModes('dynamic text child of component call in loop pushes effect into item array', `
		component Demo {
			for (const item of items) { <Link href={item.href}>{item.label}</Link> }
		}
	`, (code) => {
		expect(code).toContain('__e.push(effect(() => { $n');
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

	bothModes('classic for loop emits init + while + update', `
		component App() {
			let i = 0;
			for (i = 0; i < 3; i = i + 1) { <span>{i}</span> }
		}
	`, (code) => {
		expect(code).toContain('i = 0');
		expect(code).toContain('while (i < 3) {');
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
		expect(code).toContain('while (i < 3) {');
		expect(code).not.toContain('let __iv = !(i < 3)');
		expect(code).not.toContain('const __nv = (i < 3)');
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
	});

	// The if/else empty-state marker must parenthesize the negated condition so a
	// compound condition (`props.x && props.x.length > 0`) does not throw when
	// props.x is undefined.
	bothModes('if/else negated condition is parenthesized', `
		component App(props: { posts?: { title: string }[] }) {
			if (props.posts && props.posts.length > 0) {
				<p>Has posts</p>
			} else {
				<p>No posts</p>
			}
		}
	`, (code, mode) => {
		if (mode === 'hydrate') {
			expect(code).toContain('let __iv = !(props.posts && props.posts.length > 0);');
		}
		try { new Function('track, effect', stripModuleWrapper(code)); } catch (e) { throw new Error(`Syntax error: ${e.message}\n\n${code}`); }
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
});

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
else console.log('All tests passed!');
