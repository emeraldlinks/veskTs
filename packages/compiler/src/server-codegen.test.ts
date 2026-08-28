/**
 * Server Codegen Tests — Phase 2
 *
 * Run with: node --experimental-vm-modules packages/compiler/src/server-codegen.test.js
 */
import { render, renderPage, irNodeToJS, compileFile, renderFullPage, renderPageStream, setVskHydrate } from '@vesk/compiler/src/server-codegen';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import {
	StaticNode, TextNode, DynamicBinding, OpaqueDynamicRegion,
	MapRegion, WhileLoop, SwitchBlock, TryCatch, ForLoop,
	RuntimeStatement, TrackDecl, ComponentCall, Expression,
} from '@vesk/compiler/src/ir';

let passed = 0;
let failed = 0;
let asyncChain: Promise<void> = Promise.resolve();

function describe(name, fn) { console.log(`\n${name}`); fn(); }
function it(name, fn) {
	if (fn.constructor.name === 'AsyncFunction') {
		asyncChain = asyncChain.then(async () => {
			try {
				await fn();
				passed++;
				console.log(`  ✓ ${name}`);
			} catch (e) {
				failed++;
				console.log(`  ✗ ${name}`);
				console.log(`    ${e.message}`);
			}
		});
		return;
	}
	try { fn(); passed++; console.log(`  ✓ ${name}`); }
	catch (e) { failed++; console.log(`  ✗ ${name}`); console.log(`    ${e.message}`); }
}

function expect(value) {
	return {
		toBe(expected) { if (value !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`); },
		toContain(sub) { if (!String(value).includes(sub)) throw new Error(`Expected to contain ${JSON.stringify(sub)} in ${JSON.stringify(value)}`); },
		toBeTruthy() { if (!value) throw new Error(`Expected truthy, got ${JSON.stringify(value)}`); },
		toHaveLength(n) { if (value.length !== n) throw new Error(`Expected length ${n}, got ${value.length}`); },
		toBeInstanceOf(cls) { if (!(value instanceof cls)) throw new Error(`Expected instance of ${cls.name}`); },
		get not() {
			return {
				toBe(expected) { if (value === expected) throw new Error(`Expected NOT ${JSON.stringify(expected)}`); },
				toContain(sub) { if (String(value).includes(sub)) throw new Error(`Expected NOT to contain ${JSON.stringify(sub)}`); },
			};
		},
	};
}

// ============================================================
// Static HTML Rendering
// ============================================================
describe('Static HTML Rendering', () => {
	it('renders a simple div', () => {
		expect(render('component App { return <div>Hello</div>; }', 'App')).toBe('<div>Hello</div>');
	});
	it('renders nested elements', () => {
		expect(render('component App { return <div><span>Hi</span></div>; }', 'App')).toBe('<div><span>Hi</span></div>');
	});
	it('renders attributes', () => {
		expect(render('component App { return <div class="c" id="i">X</div>; }', 'App')).toBe('<div class="c" id="i">X</div>');
	});
	it('renders dynamic attributes exactly once', () => {
		expect(render('component App(props: { c: string }) { return <div class={props.c}>x</div>; }', 'App', { c: 'red' })).toBe('<div class="red">x</div>');
	});
	it('renders template-literal dynamic attributes once', () => {
		expect(render('component App(props: { c: string }) { return <div class={`bg-${props.c}`}>x</div>; }', 'App', { c: 'red' })).toBe('<div class="bg-red">x</div>');
	});
	it('mixes static and dynamic attributes without duplication', () => {
		expect(render('component App(props: { id: string }) { return <div class="a" id={props.id}>x</div>; }', 'App', { id: 'i1' })).toBe('<div class="a" id="i1">x</div>');
	});
	it('renders dynamic attributes once in statement mode', () => {
		const html = render(`
			component App(props: { c: string }) {
				<div class={props.c} data-n="1">x</div>
			}
		`, 'App', { c: 'blue' });
		expect(html).toContain('class="blue"');
		expect(html).toContain('data-n="1"');
		expect(html.match(/class=/g) || []).toHaveLength(1);
		expect(html.match(/data-n=/g) || []).toHaveLength(1);
	});
	it('renders self-closing HTML tags', () => {
		expect(render('component App { return <br />; }', 'App')).toBe('<br />');
	});
	it('renders boolean attributes', () => {
		expect(render('component App { return <input disabled />; }', 'App')).toBe('<input disabled />');
	});
	it('renders deeply nested structure', () => {
		const html = render(`
			component App {
				return (<div><header><nav><a href="/">Home</a></nav></header></div>);
			}
		`, 'App');
		expect(html).toContain('<header>');
		expect(html).toContain('<nav>');
	});
});

// ============================================================
// Dynamic Expression Rendering
// ============================================================
describe('Dynamic Expression Rendering', () => {
	it('renders text interpolation', () => {
		expect(render(
			'component App(props: { name: string }) { return <div>Hello, {props.name}!</div>; }',
			'App', { name: 'World' }
		)).toBe('<div>Hello, World!</div>');
	});
	it('renders number interpolation', () => {
		expect(render(
			'component App(props: { count: number }) { return <div>{props.count}</div>; }',
			'App', { count: 42 }
		)).toBe('<div>42</div>');
	});
	it('renders null as empty', () => {
		expect(render(
			'component App(props: { v: any }) { return <div>{props.v}</div>; }',
			'App', { v: null }
		)).toBe('<div></div>');
	});
	it('escapes HTML in dynamic content', () => {
		const html = render(
			'component App(props: { text: string }) { return <div>{props.text}</div>; }',
			'App', { text: '<script>alert("xss")</script>' }
		);
		expect(html).toContain('&lt;script&gt;');
		expect(html).not.toContain('<script>');
	});
	it('renders property access', () => {
		expect(render(
			'component App(props: { u: { n: string } }) { return <div>{props.u.n}</div>; }',
			'App', { u: { n: 'Alice' } }
		)).toBe('<div>Alice</div>');
	});
	it('renders arithmetic', () => {
		expect(render(
			'component App(props: { x: number }) { return <div>{props.x * 2}</div>; }',
			'App', { x: 5 }
		)).toBe('<div>10</div>');
	});
});

// ============================================================
// Conditional Rendering
// ============================================================
describe('Conditional Rendering', () => {
	it('renders && true', () => {
		expect(render(
			'component App(props: { s: boolean }) { return <div>{props.s && <span>Y</span>}</div>; }',
			'App', { s: true }
		)).toBe('<div><span>Y</span></div>');
	});
	it('renders && false', () => {
		expect(render(
			'component App(props: { s: boolean }) { return <div>{props.s && <span>Y</span>}</div>; }',
			'App', { s: false }
		)).toBe('<div></div>');
	});
	it('renders ternary true', () => {
		expect(render(
			'component App(props: { a: boolean }) { return <div>{props.a ? <span>On</span> : <span>Off</span>}</div>; }',
			'App', { a: true }
		)).toBe('<div><span>On</span></div>');
	});
	it('renders ternary false', () => {
		expect(render(
			'component App(props: { a: boolean }) { return <div>{props.a ? <span>On</span> : <span>Off</span>}</div>; }',
			'App', { a: false }
		)).toBe('<div><span>Off</span></div>');
	});
	it('renders guard clause (fired)', () => {
		expect(render(`
			component App(props: { loading: boolean; data: string }) {
				if (props.loading) return <div>Loading...</div>;
				return <div>{props.data}</div>;
			}
		`, 'App', { loading: true, data: '' })).toBe('<div>Loading...</div>');
	});
	it('renders guard clause (not fired)', () => {
		expect(render(`
			component App(props: { loading: boolean; data: string }) {
				if (props.loading) return <div>Loading...</div>;
				return <div>{props.data}</div>;
			}
		`, 'App', { loading: false, data: 'Hello' })).toBe('<div>Hello</div>');
	});
	it('renders multiple guard clauses', () => {
		expect(render(`
			component App(props: { l: boolean; e: string | null; d: string }) {
				if (props.l) return <div>L</div>;
				if (props.e) return <div>E:{props.e}</div>;
				return <div>{props.d}</div>;
			}
		`, 'App', { l: false, e: 'err', d: '' })).toBe('<div>E:err</div>');
	});
	it('renders guard then main return', () => {
		expect(render(`
			component App(props: { l: boolean; e: string | null; d: string }) {
				if (props.l) return <div>L</div>;
				if (props.e) return <div>E:{props.e}</div>;
				return <div>{props.d}</div>;
			}
		`, 'App', { l: false, e: null, d: 'OK' })).toBe('<div>OK</div>');
	});
});

// ============================================================
// List Rendering (.map)
// ============================================================
describe('List Rendering (.map)', () => {
	it('renders a mapped list', () => {
		expect(render(`
			component App(props: { items: string[] }) {
				return (<ul>{props.items.map((item) => (<li>{item}</li>))}</ul>);
			}
		`, 'App', { items: ['A', 'B', 'C'] })).toBe('<ul><li>A</li><li>B</li><li>C</li></ul>');
	});
	it('renders empty list', () => {
		expect(render(`
			component App(props: { items: string[] }) {
				return (<ul>{props.items.map((item) => (<li>{item}</li>))}</ul>);
			}
		`, 'App', { items: [] })).toBe('<ul></ul>');
	});
	it('renders list with complex items', () => {
		const html = render(`
			component App(props: { users: { name: string; age: number }[] }) {
				return (<div>{props.users.map((u) => (<div key={u.name}><span>{u.name}</span><span>{u.age}</span></div>))}</div>);
			}
		`, 'App', { users: [{ name: 'A', age: 30 }, { name: 'B', age: 25 }] });
		expect(html).toContain('<span>A</span>');
		expect(html).toContain('<span>30</span>');
		expect(html).toContain('<span>B</span>');
	});
});

// ============================================================
// Child Component Rendering
// ============================================================
describe('Child Component Rendering', () => {
	it('renders a child component', () => {
		expect(render(`
			component Greet(props: { name: string }) { return <span>Hi {props.name}</span>; }
			component App { return <div><Greet name="World" /></div>; }
		`, 'App')).toBe('<div><span>Hi World</span></div>');
	});
	it('renders multiple child components', () => {
		expect(render(`
			component Li(props: { t: string }) { return <li>{props.t}</li>; }
			component App { return <ul><Li t="A" /><Li t="B" /><Li t="C" /></ul>; }
		`, 'App')).toBe('<ul><li>A</li><li>B</li><li>C</li></ul>');
	});
	it('renders nested child components', () => {
		expect(render(`
			component Inner(props: { v: string }) { return <span>{props.v}</span>; }
			component Outer(props: { l: string }) { return <div><Inner v={props.l} /></div>; }
			component App { return <Outer l="test" />; }
		`, 'App')).toBe('<div><span>test</span></div>');
	});
	it('renders child with expression prop', () => {
		expect(render(`
			component D(props: { text: string }) { return <p>{props.text}</p>; }
			component App(props: { msg: string }) { return <D text={props.msg} />; }
		`, 'App', { msg: 'Hi!' })).toBe('<p>Hi!</p>');
	});
});

// ============================================================
// Full §2.4 Example (server variant)
// ============================================================
describe('Full §2.4 Example', () => {
	it('renders with data', () => {
		const html = render(`
			component TodoList(props: { todos: string[] }) {
				if (props.todos.length === 0) return <div class="empty">No todos</div>;
				return (
					<div class="todo-list">
						<h2>Todos</h2>
						{props.todos.map((todo) => (<div class="todo-item">{todo}</div>))}
					</div>
				);
			}
		`, 'TodoList', { todos: ['Milk', 'Dog'] });
		expect(html).toContain('class="todo-list"');
		expect(html).toContain('<h2>Todos</h2>');
		expect(html).toContain('<div class="todo-item">Milk</div>');
		expect(html).toContain('<div class="todo-item">Dog</div>');
	});
	it('renders guard clause for empty', () => {
		expect(render(`
			component TodoList(props: { todos: string[] }) {
				if (props.todos.length === 0) return <div class="empty">No todos</div>;
				return <div class="todo-list">Has todos</div>;
			}
		`, 'TodoList', { todos: [] })).toBe('<div class="empty">No todos</div>');
	});
});

// ============================================================
// Statement Mode Server Rendering
// ============================================================
describe('Statement Mode Server Rendering', () => {
	it('renders bare JSX as statement', () => {
		expect(render(`
			component App {
				<div>Hello</div>
			}
		`, 'App')).toBe('<div>Hello</div>');
	});
	it('renders self-closing JSX as statement', () => {
		expect(render(`
			component App {
				<br />
			}
		`, 'App')).toBe('<br />');
	});
	it('renders multiple sibling elements', () => {
		expect(render(`
			component App {
				<h1>Title</h1>
				<p>Body</p>
			}
		`, 'App')).toBe('<h1>Title</h1><p>Body</p>');
	});
	it('renders expression container at body level', () => {
		expect(render(`
			component App(props: { msg: string }) {
				<p>{props.msg}</p>
			}
		`, 'App', { msg: 'Hi' })).toBe('<p>Hi</p>');
	});
	it('renders nested elements in statement mode', () => {
		expect(render(`
			component App {
				<div><span>Nested</span></div>
			}
		`, 'App')).toBe('<div><span>Nested</span></div>');
	});
	it('renders attributes in statement mode', () => {
		expect(render(`
			component App {
				<div class="c" id="i">X</div>
			}
		`, 'App')).toBe('<div class="c" id="i">X</div>');
	});
	it('renders track declarations alongside bare JSX', () => {
		expect(render(`
			component App {
				let &[Header] = track(Header);
				<div>Body</div>
			}
		`, 'App')).toBe('<div>Body</div>');
	});
	it('renders child components in statement mode', () => {
		expect(render(`
			component Inner(props: { v: string }) { return <span>{props.v}</span>; }
			component App {
				<Inner v="test" />
			}
		`, 'App')).toBe('<span>test</span>');
	});
	it('renders if at body level (true)', () => {
		expect(render(`
			component App(props: { s: boolean }) {
				if (props.s) { <div>Show</div> }
			}
		`, 'App', { s: true })).toBe('<div>Show</div>');
	});
	it('renders if at body level (false)', () => {
		expect(render(`
			component App(props: { s: boolean }) {
				if (props.s) { <div>Show</div> }
			}
		`, 'App', { s: false })).toBe('');
	});
	it('renders if/else at body level', () => {
		expect(render(`
			component App(props: { s: boolean }) {
				if (props.s) { <div>On</div> } else { <div>Off</div> }
			}
		`, 'App', { s: true })).toBe('<div>On</div>');
		expect(render(`
			component App(props: { s: boolean }) {
				if (props.s) { <div>On</div> } else { <div>Off</div> }
			}
		`, 'App', { s: false })).toBe('<div>Off</div>');
	});
  	it('renders for-of at body level', () => {
 		const html = render(`
 			component App(props: { items: string[] }) {
 				for (const item of props.items) { <div>{item}</div> }
 			}
 		`, 'App', { items: ['A', 'B', 'C'] });
 		expect(html).toBe('<div>A</div><div>B</div><div>C</div>');
 	});
 	it('for-of emits a const-declared loop variable', () => {
 		const src = `
 			component App(props: { items: string[] }) {
 				for (const item in props.items) { <div>{item}</div> }
 			}
 		`;
 		const ir = generateIR(parse(src), src);
 		function findLoop(nodes: any[]): ForLoop | null {
 			for (const n of nodes) {
 				if (n instanceof ForLoop) return n;
 				for (const key of ['body', 'bodyTemplate', 'children', 'alternateNodes']) {
 					if (Array.isArray((n as any)[key])) {
 						const r = findLoop((n as any)[key]);
 						if (r) return r;
 					}
 				}
 			}
 			return null;
 		}
 		const loop = findLoop(ir.components[0].body);
 		expect(loop).toBeTruthy();
 		const code = irNodeToJS(loop as any, new Map());
 		expect(code).toContain('for (const item of ');
 		expect(code).not.toContain('for (item of ');
 	});
	it('renders keyed for-of with #empty state (items present)', () => {
		const html = render(`
			component App(props: { todos: { id: number, text: string }[] }) {
				for (const todo of props.todos; key todo.id) {
					<li>{todo.text}</li>
				}
				#empty {
					<li>No todos yet</li>
				}
			}
		`, 'App', { todos: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }] });
		expect(html).toBe('<li>A</li><li>B</li>');
	});
	it('renders keyed for-of with #empty state (empty list)', () => {
		const html = render(`
			component App(props: { todos: { id: number, text: string }[] }) {
				for (const todo of props.todos; key todo.id) {
					<li>{todo.text}</li>
				}
				#empty {
					<li>No todos yet</li>
				}
			}
		`, 'App', { todos: [] });
		expect(html).toBe('<li>No todos yet</li>');
	});
	it('renders for-of with ; index clause', () => {
		const html = render(`
			component App(props: { items: string[] }) {
				for (const item of props.items; index i) {
					<div>{i}:{item}</div>
				}
			}
		`, 'App', { items: ['A', 'B'] });
		expect(html).toBe('<div>0:A</div><div>1:B</div>');
	});
	it('renders text-mode for-of with #empty state', () => {
		const html = render(`
			component App(props: { todos: { id: number, text: string }[] }) {
				<ul>
					for (const todo of props.todos; key todo.id) {
						<li>{todo.text}</li>
					}
					#empty {
						<li>No todos yet</li>
					}
				</ul>
			}
		`, 'App', { todos: [] });
		expect(html).toBe('<ul><li>No todos yet</li></ul>');
	});
	it('renders tracked items in text-mode for-of', () => {
		const html = render(`
			component App() {
				let &[todos] = track([{ id: 1, text: 'A' }, { id: 2, text: 'B' }]);
				<ul>
					for (const todo of todos; key todo.id) {
						<li>{todo.text}</li>
					}
					empty {
						<li>No todos yet</li>
					}
				</ul>
			}
		`, 'App', {});
		expect(html).toBe('<ul><li>A</li><li>B</li></ul>');
	});
	it('renders keyed for-of with items', () => {
		const html = render(`
			component App(props: { todos: { id: number, text: string }[] }) {
				for (const todo of props.todos; key todo.id) {
					<li>{todo.text}</li>
				}
			}
		`, 'App', { todos: [{ id: 1, text: 'A' }, { id: 2, text: 'B' }] });
		expect(html).toBe('<li>A</li><li>B</li>');
	});
	it('renders empty block for empty list', () => {
		const html = render(`
			component App(props: { todos: { id: number, text: string }[] }) {
				for (const todo of props.todos; key todo.id) {
					<li>{todo.text}</li>
				}
				empty {
					<li>No todos yet</li>
				}
			}
		`, 'App', { todos: [] });
		expect(html).toBe('<li>No todos yet</li>');
	});
	it('renders empty block for null list', () => {
		const html = render(`
			component App(props: { todos: { id: number, text: string }[] }) {
				for (const todo of props.todos; key todo.id) {
					<li>{todo.text}</li>
				}
				empty {
					<li>No todos yet</li>
				}
			}
		`, 'App', { todos: null });
		expect(html).toBe('<li>No todos yet</li>');
	});
	it('renders items when list is populated despite empty block', () => {
		const html = render(`
			component App(props: { todos: { id: number, text: string }[] }) {
				for (const todo of props.todos; key todo.id) {
					<li>{todo.text}</li>
				}
				empty {
					<li>No todos yet</li>
				}
			}
		`, 'App', { todos: [{ id: 1, text: 'A' }] });
		expect(html).toBe('<li>A</li>');
	});
	it('renders empty block with index clause', () => {
		const html = render(`
			component App(props: { todos: string[] }) {
				for (const todo of props.todos; index i) {
					<li>{i}: {todo}</li>
				}
				empty {
					<li>None</li>
				}
			}
		`, 'App', { todos: [] });
		expect(html).toBe('<li>None</li>');
	});
	it('renders empty block for empty #empty syntax', () => {
		const html = render(`
			component App(props: { todos: string[] }) {
				for (const todo of props.todos) {
					<li>{todo}</li>
				}
				#empty {
					<li>Nothing here</li>
				}
			}
		`, 'App', { todos: [] });
		expect(html).toBe('<li>Nothing here</li>');
	});
	it('renders nested empty block inside if', () => {
		const html = render(`
			component App(props: { show: boolean, todos: string[] }) {
				if (props.show) {
					for (const todo of props.todos) {
						<div>{todo}</div>
					}
					empty {
						<p>No todos</p>
					}
				}
			}
		`, 'App', { show: true, todos: [] });
		expect(html).toBe('<p>No todos</p>');
	});
	it('renders return escape in statement mode', () => {
		expect(render(`
			component App {
				return <div>Escape</div>;
			}
		`, 'App')).toBe('<div>Escape</div>');
	});
	it('renders while at body level', () => {
		let count = 0;
		const fn = () => {
			const result = ++count;
			return { items: [1, 2, 3], index: () => result };
		};
		// We'll test with a simple while that iterates over an array via index
		expect(render(`
			component App(props: { items: number[], n: number }) {
				let i = 0;
				while (i < props.n) {
					<div>{props.items[i]}</div>
					i = i + 1;
				}
			}
		`, 'App', { items: ['A', 'B', 'C'], n: 2 })).toBe('<div>A</div><div>B</div>');
	});
	it('renders do-while at body level', () => {
		expect(render(`
			component App(props: { items: number[], n: number }) {
				let i = 0;
				do {
					<div>{props.items[i]}</div>
					i = i + 1;
				} while (i < props.n);
			}
		`, 'App', { items: ['X', 'Y', 'Z'], n: 2 })).toBe('<div>X</div><div>Y</div>');
	});
	it('renders switch at body level', () => {
		expect(render(`
			component App(props: { kind: string }) {
				switch (props.kind) {
					case 'a':
						<div>A</div>
					case 'b':
						<div>B</div>
					default:
						<div>Other</div>
				}
			}
		`, 'App', { kind: 'a' })).toBe('<div>A</div>');
		expect(render(`
			component App(props: { kind: string }) {
				switch (props.kind) {
					case 'a':
						<div>A</div>
					case 'b':
						<div>B</div>
					default:
						<div>Other</div>
				}
			}
		`, 'App', { kind: 'b' })).toBe('<div>B</div>');
		expect(render(`
			component App(props: { kind: string }) {
				switch (props.kind) {
					case 'a':
						<div>A</div>
					case 'b':
						<div>B</div>
					default:
						<div>Other</div>
				}
			}
		`, 'App', { kind: 'z' })).toBe('<div>Other</div>');
	});
	it('renders try/catch at body level', () => {
		expect(render(`
			component App {
				try {
					<div>OK</div>
				} catch {
					<div>Error</div>
				}
			}
		`, 'App')).toBe('<div>OK</div>');
	});
	it('renders for loop at body level', () => {
		expect(render(`
			component App(props: { items: string[] }) {
				for (let i = 0; i < props.items.length; i = i + 1) {
					<div>{props.items[i]}</div>
				}
			}
		`, 'App', { items: ['A', 'B'] })).toBe('<div>A</div><div>B</div>');
	});
	it('renders for-in loop at body level', () => {
		expect(render(`
			component App(props: { obj: Record<string, string> }) {
				for (const key in props.obj) {
					<div>{key}</div>
				}
			}
		`, 'App', { obj: { x: 'a', y: 'b' } })).toBe('<div>x</div><div>y</div>');
	});
	it('preserves non-JSX runtime statements', () => {
		expect(render(`
			component App(props: { x: number }) {
				const y = props.x * 2;
				<div>{y}</div>
			}
		`, 'App', { x: 5 })).toBe('<div>10</div>');
	});
	it('renders runtime statement nested inside an element (semicolon)', () => {
		expect(render(`
			component App(props: { items: string[] }) {
				<div class="w">
					const total = props.items.length * 2;
					<p>{total}</p>
				</div>
			}
		`, 'App', { items: ['a', 'b', 'c'] })).toBe('<div class="w"><p>6</p></div>');
	});
	it('renders runtime statement nested inside an element (ASI, no semicolon)', () => {
		expect(render(`
			component App(props: { items: string[] }) {
				<div class="w">
					const total = props.items.length * 2
					<p>t={total}</p>
				</div>
			}
		`, 'App', { items: ['a', 'b', 'c'] })).toBe('<div class="w"><p>t=6</p></div>');
	});
	it('does not hoist const keyword from literal JSX text', () => {
		expect(render(`
			component App {
				<p>const is a keyword, let go</p>
			}
		`, 'App')).toBe('<p>const is a keyword, let go</p>');
	});
	it('nested runtime statement with comparison operators', () => {
		expect(render(`
			component App(props: { score: number }) {
				<div class="w">
					const flag = props.score > 5;
					<p>{String(flag)}</p>
				</div>
			}
		`, 'App', { score: 7 })).toBe('<div class="w"><p>true</p></div>');
		expect(render(`
			component App(props: { score: number }) {
				<div class="w">
					const flag = props.score < 5;
					<p>{String(flag)}</p>
				</div>
			}
		`, 'App', { score: 7 })).toBe('<div class="w"><p>false</p></div>');
	});
	it('nested runtime statement with object, array, and destructure initializers', () => {
		expect(render(`
			component App(props: { obj: Record<string, number> }) {
				<div class="w">
					const cfg = { a: 1, b: 2 };
					<p>{cfg.a + cfg.b}</p>
				</div>
			}
		`, 'App', { obj: { a: 1, b: 2 } })).toBe('<div class="w"><p>3</p></div>');
		expect(render(`
			component App(props: { obj: { a: number; b: number } }) {
				<div class="w">
					const { a, b } = props.obj;
					<p>{a + b}</p>
				</div>
			}
		`, 'App', { obj: { a: 1, b: 2 } })).toBe('<div class="w"><p>3</p></div>');
		expect(render(`
			component App {
				<div class="w">
					const [x, y] = [1, 2];
					<p>{x + y}</p>
				</div>
			}
		`, 'App')).toBe('<div class="w"><p>3</p></div>');
	});
	it('nested runtime statement with arrow/ternary/template initializers', () => {
		expect(render(`
			component App(props: { score: number }) {
				<div class="w">
					const label = props.score > 5 ? 'big' : 'small';
					<p>{label}</p>
				</div>
			}
		`, 'App', { score: 7 })).toBe('<div class="w"><p>big</p></div>');
		expect(render(`
			component App(props: { score: number }) {
				<div class="w">
					const label = \`score;\${props.score}\`;
					<p>{label}</p>
				</div>
			}
		`, 'App', { score: 7 })).toBe('<div class="w"><p>score;7</p></div>');
		expect(render(`
			component App {
				<div class="w">
					const f = (x) => x * 2;
					<p>{f(3)}</p>
				</div>
			}
		`, 'App')).toBe('<div class="w"><p>6</p></div>');
		expect(render(`
			component App {
				<div class="w">
					const f = (x) => { const y = x + 1; return y; };
					<p>{f(1)}</p>
				</div>
			}
		`, 'App')).toBe('<div class="w"><p>2</p></div>');
	});
	it('nested runtime statement with string containing semicolon', () => {
		expect(render(`
			component App {
				<div class="w">
					const s = "a;b;c";
					<p>{s}</p>
				</div>
			}
		`, 'App')).toBe('<div class="w"><p>a;b;c</p></div>');
	});
	it('nested runtime statement spanning multiple lines (parsed parens)', () => {
		expect(render(`
			component App(props: { items: string[]; obj: Record<string, number> }) {
				<div class="w">
					const sum = props.items.length
						+ props.obj.a;
					<p>{sum}</p>
				</div>
			}
		`, 'App', { items: ['a', 'b', 'c'], obj: { a: 1 } })).toBe('<div class="w"><p>4</p></div>');
		expect(render(`
			component App(props: { items: string[] }) {
				<div class="w">
					const v = (props.items.length + 1) * 2;
					<p>{v}</p>
				</div>
			}
		`, 'App', { items: ['a', 'b', 'c'] })).toBe('<div class="w"><p>8</p></div>');
	});
	it('nested var and let declarations', () => {
		expect(render(`
			component App(props: { items: string[] }) {
				<div class="w">
					var total = props.items.length * 2;
					<p>{total}</p>
				</div>
			}
		`, 'App', { items: ['a', 'b', 'c'] })).toBe('<div class="w"><p>6</p></div>');
		expect(render(`
			component App(props: { items: string[] }) {
				<div class="w">
					let total = props.items.length
					<p>len={total}</p>
				</div>
			}
		`, 'App', { items: ['a', 'b', 'c'] })).toBe('<div class="w"><p>len=3</p></div>');
		expect(render(`
			component App(props: { items: string[] }) {
				<div class="w">
					const total = props.items.length
					<p>len={total}</p>
				</div>
			}
		`, 'App', { items: ['a', 'b', 'c'] })).toBe('<div class="w"><p>len=3</p></div>');
	});
	it('keeps prose starting with const/let/var as JSX text, not code', () => {
		expect(render(`
			component App {
				<p>const value = 5 apples</p>
			}
		`, 'App')).toBe('<p>const value = 5 apples</p>');
		expect(render(`
			component App {
				<p>let x = y</p>
			}
		`, 'App')).toBe('<p>let x = y</p>');
		expect(render(`
			component App {
				<p>var args = rest</p>
			}
		`, 'App')).toBe('<p>var args = rest</p>');
		expect(render(`
			component App {
				<p>let me help you</p>
			}
		`, 'App')).toBe('<p>let me help you</p>');
		expect(render(`
			component App {
				<p>say const x = 1 to me</p>
			}
		`, 'App')).toBe('<p>say const x = 1 to me</p>');
	});
	it('nested const inside an if consequent element', () => {
		expect(render(`
			component App(props: { score: number }) {
				<div>
					if (props.score > 5) {
						const big = props.score * 2;
						<p>{big}</p>
					} else {
						<p>low</p>
					}
				</div>
			}
		`, 'App', { score: 7 })).toBe('<div><p>14</p></div>');
	});
	it('renders labeled statement with JSX', () => {
		expect(render(`
			component App(props: { flag: boolean }) {
				myLabel: {
					<div>Labeled</div>
				}
			}
		`, 'App', { flag: true })).toBe('<div>Labeled</div>');
	});
	it('renders semicolon-less expression statements before JSX', () => {
		expect(render(`
			component App(props: { x: number }) {
				console.log('side effect')
				const y = props.x * 2
				<div>{y}</div>
			}
		`, 'App', { x: 5 })).toBe('<div>10</div>');
	});
	it('renders semicolon-less statements after JSX', () => {
		expect(render(`
			component App {
				<div>hi</div>
				console.log('done')
			}
		`, 'App')).toBe('<div>hi</div>');
 	});
 });

// ============================================================
// Async Components & Async Discipline
// ============================================================
describe('Async Components', () => {
	it('renders an async component with await', async () => {
		expect(await render(`
			async component Async() {
				const data = await Promise.resolve('hi')
				<div>{data}</div>
			}
		`, 'Async')).toBe('<div>hi</div>');
	});

	it('async parent renders an async child', async () => {
		expect(await render(`
			async component Child() {
				const data = await Promise.resolve('hello')
				<div>{data}</div>
			}
			async component Parent() {
				<Child />
			}
		`, 'Parent')).toBe('<div>hello</div>');
	});

	it('deeply nested chain requires explicit async at every level', async () => {
		expect(await render(`
			async component Leaf() {
				const data = await Promise.resolve(42)
				<p>{data}</p>
			}
			async component Mid() {
				<Leaf />
			}
			async component Root() {
				<Mid />
			}
		`, 'Root')).toBe('<p>42</p>');
	});

	it('awaits async children inside conditionals on SSR', async () => {
		expect(await render(`
			async component Card() {
				const data = await Promise.resolve('card')
				<p>{data}</p>
			}
			async component App(props: { show: boolean }) {
				if (props.show) {
					<Card />
				}
			}
		`, 'App', { show: true })).toBe('<p>card</p>');
	});
});

describe('Async Discipline', () => {
	const mustError = (source: string, componentName: string, parentName: string, childName: string): any => {
		try {
			render(source, componentName);
			throw new Error(`Expected compile error for "${componentName}" -> "${childName}"`);
		} catch (e: any) {
			expect(e.constructor.name).toBe('VeskError');
			expect(e.message).toContain(parentName);
			expect(e.message).toContain(childName);
			expect(e.message).toContain('async');
			return e;
		}
	};

	it('sync parent calling async child is a compile error (statement mode)', () => {
		const e = mustError(`
			async component Child() {
				const data = await Promise.resolve('hi')
				<div>{data}</div>
			}
			component Parent() {
				<Child />
			}
		`, 'Parent', 'Parent', 'Child');
		expect(e.line).toBe(7);
		expect(e.column).toBe(5);
	});

	it('sync parent calling async child is a compile error (expression mode)', () => {
		mustError(`
			async component Child() {
				const data = await Promise.resolve('hi')
				return <div>{data}</div>
			}
			component Parent() {
				return <Child />
			}
		`, 'Parent', 'Parent', 'Child');
	});

	it('a sync link anywhere in the chain is a compile error', () => {
		mustError(`
			async component Leaf() {
				const data = await Promise.resolve(42)
				return <p>{data}</p>
			}
			component Mid() {
				return <Leaf />
			}
			async component Root() {
				return <Mid />
			}
		`, 'Root', 'Mid', 'Leaf');
	});

	it('async children inside a conditional still require an async parent', () => {
		mustError(`
			async component Card() {
				const data = await Promise.resolve('card')
				return <p>{data}</p>
			}
			component App(props: { show: boolean }) {
				if (props.show) {
					<Card />
				}
			}
		`, 'App', 'App', 'Card');
	});

	it('useFetch child from sync parent is a compile error', () => {
		mustError(`
			component Fetcher() {
				const data = useFetch('/api/x')
				<p>{data.loading ? '…' : 'ok'}</p>
			}
			component Parent() {
				<Fetcher />
			}
		`, 'Parent', 'Parent', 'Fetcher');
	});

	it('useFetch parent may render a useFetch child without declared async', async () => {
		const savedFetch = globalThis.fetch;
		globalThis.fetch = () => Promise.resolve({
			ok: true,
			json: () => Promise.resolve('yay'),
		}) as any;
		try {
			const html = await render(`
				component Fetcher() {
					const data = useFetch('/api/x')
					<p>{data.data}</p>
				}
				component Parent() {
					const own = useFetch('/api/y')
					<Fetcher />
				}
			`, 'Parent');
			expect(html).toBe('<p>yay</p>');
		} finally {
			globalThis.fetch = savedFetch;
		}
	});

	it('SSR data stays isolated per page — no useFetch means no data script', async () => {
		const savedFetch = globalThis.fetch;
		globalThis.fetch = (url: unknown) => Promise.resolve({
			ok: true,
			json: () => Promise.resolve('payload-for-' + url),
		}) as any;
		try {
			const withFetch = await renderFullPage(`
				component Data() {
					const d = useFetch('/api/a')
					<p>{d.data ?? 'loading'}</p>
				}
			`, 'Data', {}, new Map(), { hydrate: true });
			expect(withFetch).toContain('__vsk_ssr_data');
			expect(withFetch).toContain('/api/a');

			const withoutFetch = await renderFullPage(`
				component Plain() {
					<p>no data here</p>
				}
			`, 'Plain', {}, new Map(), { hydrate: true });
			expect(withoutFetch).not.toContain('__vsk_ssr_data');
			expect(withoutFetch).not.toContain('/api/a');
		} finally {
			globalThis.fetch = savedFetch;
		}
	});

	it('concurrent SSR renders never mix useFetch data (AsyncLocalStorage)', async () => {
		const savedFetch = globalThis.fetch;
		globalThis.fetch = (url: unknown) => new Promise((res) =>
			setTimeout(() => res({ ok: true, json: () => Promise.resolve('v-' + url) } as any), 15)
		);
		try {
			const mk = (url: string, comp: string) => renderFullPage(`
				component ${comp}() {
					const d = useFetch('${url}')
					<p>{d.data ?? 'loading'}</p>
				}
			`, comp, {}, new Map(), { hydrate: true });
			const [h1, h2] = await Promise.all([mk('/api/one', 'One'), mk('/api/two', 'Two')]);
			expect(h1).toContain('/api/one');
			expect(h1).not.toContain('/api/two');
			expect(h2).toContain('/api/two');
			expect(h2).not.toContain('/api/one');
		} finally {
			globalThis.fetch = savedFetch;
		}
	});

	it('layout rendering a slot does not need async', async () => {
		const html = await render(`
			async component Page() {
				const data = await Promise.resolve('page')
				<h1>{data}</h1>
			}
			component Layout(props: { children: unknown }) {
				<main>{props.children}</main>
			}
		`, 'Layout', { children: 'slot' });
		expect(html).toBe('<main>slot</main>');
	});
});

// ============================================================
// Error Cases
// ============================================================
describe('Error Cases', () => {
	it('throws for unknown component', () => {
		try { render('component App { return <div />; }', 'X'); throw new Error('no throw'); }
		catch (e) { expect(e.message).toContain('not found'); }
	});
});

// ============================================================
// IR Generation (unit tests)
// ============================================================
describe('IR Generation', () => {
	const src = (s) => s;
	it('generates IR for a static component', () => {
		const s = 'component App { return <div>Hello</div>; }';
		const ir = generateIR(parse(s), s);
		expect(ir.components).toHaveLength(1);
		expect(ir.components[0].name).toBe('App');
		expect(ir.components[0].body[0]).toBeInstanceOf(StaticNode);
	});
	it('generates IR with dynamic bindings', () => {
		const s = 'component App(props: { name: string }) { return <div>{props.name}</div>; }';
		const ir = generateIR(parse(s), s);
		expect(ir.components[0].body[0]).toBeInstanceOf(StaticNode);
		expect(ir.components[0].body[0].children[0]).toBeInstanceOf(DynamicBinding);
	});
	it('generates IR with track declarations preserved', () => {
		const s = 'component App() { let &[x] = track(0); return <div>{x}</div>; }';
		const ir = generateIR(parse(s), s);
		expect(ir.components[0].body).toHaveLength(2);
		expect(ir.components[0].body[0]).toBeInstanceOf(TrackDecl);
		expect(ir.components[0].body[1]).toBeInstanceOf(StaticNode);
	});
	it('generates IR for guard clauses', () => {
		const s = 'component App(props: { show: boolean }) { if (props.show) return <span>Y</span>; return <span>N</span>; }';
		const ir = generateIR(parse(s), s);
		expect(ir.components[0].body).toHaveLength(1);
		expect(ir.components[0].body[0]).toBeInstanceOf(OpaqueDynamicRegion);
	});
	it('generates IR for .map()', () => {
		const s = 'component App(props: { items: string[] }) { return <div>{props.items.map((i) => <span>{i}</span>)}</div>; }';
		const ir = generateIR(parse(s), s);
		expect(ir.components[0].body[0]).toBeInstanceOf(StaticNode);
		expect(ir.components[0].body[0].children[0]).toBeInstanceOf(MapRegion);
	});
	it('generates IR for child components', () => {
		const s = 'component C(props: { n: string }) { return <span>{props.n}</span>; } component App { return <div><C n="x" /></div>; }';
		const ir = generateIR(parse(s), s);
		expect(ir.components).toHaveLength(2);
		expect(ir.components[1].body[0]).toBeInstanceOf(StaticNode);
		expect(ir.components[1].body[0].children[0]).toBeInstanceOf(ComponentCall);
	});
});

// ============================================================
describe('Sub-Component Static Extraction', () => {

	it('static subtree omits <!--vsk--> in hydrate mode', () => {
		const html = render(`component App { return <div><span>Static</span></div>; }`, 'App', {}, new Map(), { hydrate: true });
		// <div> contains a fully static <span> → no <!--vsk--> on either
		expect(html).not.toContain('<!--vsk-->');
	});

	it('dynamic element gets <!--vsk-->', () => {
		const html = render(`component App(props: { n: number }) { return <div>{props.n}</div>; }`, 'App', { n: 42 }, new Map(), { hydrate: true });
		expect(html).toContain('<!--vsk-->');
	});

	it('static child inside dynamic container lacks <!--vsk--> markers', () => {
		const html = render(`component App(props: { n: number }) { return <div class="outer"><span>Static</span><p>{props.n}</p></div>; }`, 'App', { n: 7 }, new Map(), { hydrate: true });
		expect(html.match(/<!--vsk-->/g)).toHaveLength(2);
		// The <span> should NOT have <!--vsk--> (fully static subtree)
		// The <p> with DynamicBinding should have <!--vsk-->
		expect(html).toContain('<span>Static</span>');
		expect(html).toContain('<!--vsk--><p>7</p>');
	});

	it('non-hydrate mode never has <!--vsk--> markers', () => {
		const html = render(`component App(props: { n: number }) { return <div>{props.n}</div>; }`, 'App', { n: 1 }, new Map(), { hydrate: false });
		expect(html).not.toContain('<!--vsk-->');
	});

	it('deeply nested static subtree gets no markers', () => {
		const html = render(`component App(props: { n: number }) { return <div><article><section><p>Deep</p></section></article><span>{props.n}</span></div>; }`, 'App', { n: 3 }, new Map(), { hydrate: true });
		// Only the dynamic <span> and its dynamic ancestors get markers
		expect(html).toContain('<!--vsk--><span>3</span>');
		// The static <article>/<section>/<p> chain has NO markers
		expect(html).toContain('<article><section><p>Deep</p></section></article>');
	});

});

// ============================================================
describe('Server/Client Blocks', () => {
	it('ServerBlock renders children in server output', () => {
		const html = render(`component App {
			{#server}
				<p>ServerOnly</p>
			{/server}
		}`, 'App');
		expect(html).toContain('<p>ServerOnly</p>');
	});
	it('ClientBlock is stripped from server output', () => {
		const html = render(`component App client {
			{#client}
				<button>ClientBtn</button>
			{/client}
			<p>Always</p>
		}`, 'App');
		expect(html).not.toContain('ClientBtn');
		expect(html).toContain('Always');
	});
	it('ServerBlock renders in server, ClientBlock in client island', () => {
		const html = render(`component App {
			{#server}<span>S</span>{/server}
			<span>B</span>
		}`, 'App');
		expect(html).toContain('<span>S</span>');
		expect(html).toContain('<span>B</span>');
		expect(html).toContain('<span>B</span>');
	});
});

describe('SEO — Head Block', () => {
	it('HeadBlock rendered into <title>', () => {
		const ast = parse(`component App {
			<Head>
				<title>My Title</title>
			</Head>
			<p>Body</p>
		}`);
		const ir = generateIR(ast, `component App {
			<Head>
				<title>My Title</title>
			</Head>
			<p>Body</p>
		}`);
		const comp = ir.components[0];
		const headNode = comp.body.find((n) => n.constructor.name === 'HeadBlock');
		expect(headNode).toBeTruthy();
	});
	it('renderPage returns head content separately', () => {
		const result = renderPage(`component App {
			<Head>
				<title>Page Title</title>
				<meta name="desc" content="A page" />
			</Head>
			<p>Body</p>
		}`, 'App');
		expect(result.body).toContain('<p>Body</p>');
		expect(result.head).toContain('Page Title');
		expect(result.head).toContain('<meta');
	});
});

describe('Root Event Delegation', () => {
	it('server renders without event handler attributes', () => {
		const html = render(`component App {
			let &[c] = track(0);
			<button onClick={() => c.set(1)}>Click</button>
		}`, 'App');
		expect(html).not.toContain('onClick');
		expect(html).toContain('<button>');
		expect(html).toContain('Click');
	});
	it('client codegen emits delegation setup', () => {
		const code = compileClient(`component App {
			let &[c] = track(0);
			<button onClick={() => c.set(1)}>Click</button>
		}`, 'App', { forceClient: true, hydrate: true });
		expect(code).toContain('__vesk_dlg_click');
		expect(code).toContain('data-vsk-ev');
		expect(code).toContain('__evh_click');
	});
});

describe('Compile-Cache (cached) Rendering + Hydrate Markers', () => {
	const pageSrc = `component App(props: { name: string }) {
		<div>Hello, {props.name}!</div>
	}`;

	function hydratePrecompile(source) {
		setVskHydrate(true);
		try {
			return compileFile(source);
		} finally {
			setVskHydrate(false);
		}
	}

	function plainPrecompile(source) {
		setVskHydrate(false);
		try {
			return compileFile(source);
		} finally {
			setVskHydrate(false);
		}
	}

	it('renderPage with hydrate-precompiled cached emits markers', async () => {
		const cached = hydratePrecompile(pageSrc);
		const result = await renderPage(pageSrc, 'App', { name: 'W' }, new Map(), { hydrate: true, cached });
		setVskHydrate(false);
		expect(result.body).toBe('<!--vsk--><div>Hello, W!</div>');
	});
	it('renderPage with non-hydrate-precompiled cached omits markers (regression guard)', async () => {
		const cached = plainPrecompile(pageSrc);
		const result = await renderPage(pageSrc, 'App', { name: 'W' }, new Map(), { hydrate: true, cached });
		setVskHydrate(false);
		expect(result.body).toBe('<div>Hello, W!</div>');
	});
	it('cached hydrate render matches fresh compile render', async () => {
		const cached = hydratePrecompile(pageSrc);
		const viaCache = await renderPage(pageSrc, 'App', { name: 'W' }, new Map(), { hydrate: true, cached });
		setVskHydrate(false);
		const viaFresh = await renderPage(pageSrc, 'App', { name: 'W' }, new Map(), { hydrate: true });
		setVskHydrate(false);
		expect(viaCache.body).toBe(viaFresh.body);
	});
	it('renderFullPage with hydrate-precompiled cached emits markers', async () => {
		const cached = hydratePrecompile(pageSrc);
		const html = await renderFullPage(pageSrc, 'App', { name: 'W' }, new Map(), { hydrate: true, cached });
		setVskHydrate(false);
		expect(html).toContain('<!--vsk-->');
		expect(html).toContain('Hello, W!');
	});
	it('renderPageStream with hydrate-precompiled cached emits markers', async () => {
		const cached = hydratePrecompile(pageSrc);
		const stream = renderPageStream(pageSrc, 'App', { name: 'W' }, new Map(), { hydrate: true, cached });
		let out = '';
		for await (const chunk of stream) out += chunk;
		setVskHydrate(false);
		expect(out).toContain('<!--vsk-->');
		expect(out).toContain('<div>Hello, W!</div>');
	});
});

console.log(`\n${'='.repeat(50)}`);
asyncChain.then(() => {
	console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
	if (failed > 0) process.exit(1);
	else console.log('All tests passed!');
});
