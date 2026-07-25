/**
 * Server Codegen Tests — Phase 2
 *
 * Run with: node --experimental-vm-modules packages/compiler/src/server-codegen.test.js
 */
import { render, renderPage } from './server-codegen.js';
import { compileClient } from './client-codegen.js';
import { parse } from './parser.js';
import { generateIR } from './ir-generator.js';
import {
	StaticNode, TextNode, DynamicBinding, OpaqueDynamicRegion,
	MapRegion, WhileLoop, SwitchBlock, TryCatch, ForLoop,
	RuntimeStatement, TrackDecl, ComponentCall, Expression,
} from './ir.js';

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
		`, 'App', { kind: 'a' })).toBe('<div>A</div><div>B</div><div>Other</div>');
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
		`, 'App', { kind: 'b' })).toBe('<div>B</div><div>Other</div>');
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
	it('renders labeled statement with JSX', () => {
		expect(render(`
			component App(props: { flag: boolean }) {
				myLabel: {
					<div>Labeled</div>
				}
			}
		`, 'App', { flag: true })).toBe('<div>Labeled</div>');
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

	it('static subtree omits data-vsk in hydrate mode', () => {
		const html = render(`component App { return <div><span>Static</span></div>; }`, 'App', {}, new Map(), { hydrate: true });
		// <div> contains a fully static <span> → no data-vsk on either
		expect(html).not.toContain('data-vsk');
	});

	it('dynamic element gets data-vsk', () => {
		const html = render(`component App(props: { n: number }) { return <div>{props.n}</div>; }`, 'App', { n: 42 }, new Map(), { hydrate: true });
		expect(html).toContain('data-vsk="');
	});

	it('static child inside dynamic container lacks data-vsk', () => {
		const html = render(`component App(props: { n: number }) { return <div class="outer"><span>Static</span><p>{props.n}</p></div>; }`, 'App', { n: 7 }, new Map(), { hydrate: true });
		expect(html).toContain('data-vsk="0"');
		expect(html).toContain('data-vsk="1"');
		// The <span> should NOT have data-vsk (fully static subtree)
		// The <p> with DynamicBinding should have data-vsk
		expect(html).toContain('<span>Static</span>');
		expect(html).toContain('<p data-vsk="1">7</p>');
	});

	it('non-hydrate mode never has data-vsk markers', () => {
		const html = render(`component App(props: { n: number }) { return <div>{props.n}</div>; }`, 'App', { n: 1 }, new Map(), { hydrate: false });
		expect(html).not.toContain('data-vsk');
	});

	it('deeply nested static subtree gets no markers', () => {
		const html = render(`component App(props: { n: number }) { return <div><article><section><p>Deep</p></section></article><span>{props.n}</span></div>; }`, 'App', { n: 3 }, new Map(), { hydrate: true });
		// Only the dynamic <span> and its dynamic ancestors get markers
		expect(html).toContain('<span data-vsk="1">3</span>');
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

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
else console.log('All tests passed!');
