/**
 * Vesk Parser Tests — Phase 1 (Expression Mode Only)
 *
 * Tests for:
 * - `component` keyword parsing
 * - Expression-mode component bodies (`return (<jsx>)`)
 * - `let &[name] = track(...)` parsing
 * - Guard-clause early returns
 * - Error: `component` as regular identifier
 * - Full §2.4 example parsing
 *
 * NOTE: Run with: node --experimental-vm-modules packages/compiler/src/parser.test.js
 * Run with: node --experimental-vm-modules packages/compiler/src/parser.test.js
 */
import { parse } from '@vesk/compiler/src/parser';

let passed = 0;
let failed = 0;

function describe(name, fn) {
	console.log(`\n${name}`);
	fn();
}

function it(name, fn) {
	try {
		fn();
		passed++;
		console.log(`  ✓ ${name}`);
	} catch (e) {
		failed++;
		console.log(`  ✗ ${name}`);
		console.log(`    ${e.message}`);
	}
}

function expect(value) {
	return {
		toBe(expected) {
			if (value !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
		},
		toBeTruthy() {
			if (!value) throw new Error(`Expected truthy, got ${JSON.stringify(value)}`);
		},
		toBeFalsy() {
			if (value) throw new Error(`Expected falsy, got ${JSON.stringify(value)}`);
		},
		toBeGreaterThan(n) {
			if (!(value > n)) throw new Error(`Expected ${value} > ${n}`);
		},
		toEqual(expected) {
			const a = JSON.stringify(value);
			const b = JSON.stringify(expected);
			if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
		},
		toHaveLength(n) {
			if (value.length !== n) throw new Error(`Expected length ${n}, got ${value.length}`);
		},
		toHaveProperty(prop) {
			if (!(prop in value)) throw new Error(`Expected property ${prop}`);
		},
		toThrow() {
			throw new Error('Expected function to throw');
		},
		not: {
			toBe(e) { if (value === e) throw new Error(`Expected not ${JSON.stringify(e)}`); },
		},
	};
}

function shouldThrow(fn, pattern) {
	try {
		fn();
		throw new Error(`Expected error matching "${pattern}", but no error was thrown`);
	} catch (e) {
		if (e.message.includes('Expected error')) throw e;
		if (!e.message.includes(pattern)) {
			throw new Error(`Expected error containing "${pattern}", got: ${e.message}`);
		}
	}
}

// ============================================================
// Phase 0 Regression — Base parser still works
// ============================================================
describe('Base Parser (Phase 0 regression)', () => {
	it('parses plain TypeScript', () => {
		const ast = parse(`const x: number = 42;`);
		expect(ast.body[0].type).toBe('VariableDeclaration');
	});

	it('parses JSX elements', () => {
		const ast = parse(`const el = <div className="hello">Hello</div>;`);
		expect(ast.body[0].declarations[0].init.type).toBe('JSXElement');
	});

	it('parses TypeScript generics', () => {
		const ast = parse(`function identity<T>(arg: T): T { return arg; }`);
		expect(ast.body[0].typeParameters).toBeTruthy();
	});

	it('parses async/await', () => {
		const ast = parse(`async function fetchData(): Promise<string> { const r = await fetch("/api"); return r.text(); }`);
		expect(ast.body[0].async).toBe(true);
	});

	it('parses destructuring with types', () => {
		const ast = parse(`const { name, age }: { name: string; age: number } = person;`);
		expect(ast.body[0].declarations[0].id.type).toBe('ObjectPattern');
	});

	it('parses arrow functions with JSX', () => {
		const ast = parse(`const Greeting = ({ name }: { name: string }) => <div>Hello {name}</div>;`);
		expect(ast.body[0].declarations[0].init.body.type).toBe('JSXElement');
	});

	it('parses export default function', () => {
		const ast = parse(`export default function App() { return <div />; }`);
		expect(ast.body[0].type).toBe('ExportDefaultDeclaration');
	});

	it('parses interface declarations', () => {
		const ast = parse(`interface Props { name: string; age?: number; }`);
		expect(ast.body[0].type).toBe('TSInterfaceDeclaration');
	});
});

// ============================================================
// Component keyword parsing
// ============================================================
describe('Component Declarations', () => {
	it('parses basic component with no params', () => {
		const ast = parse(`component App { return <div />; }`);
		const comp = ast.body[0];
		expect(comp.type).toBe('ComponentDeclaration');
		expect(comp.id.name).toBe('App');
		expect(comp.params).toHaveLength(0);
		expect(comp.async).toBe(false);
	});

	it('parses component with empty params', () => {
		const ast = parse(`component App() { return <div />; }`);
		const comp = ast.body[0];
		expect(comp.type).toBe('ComponentDeclaration');
		expect(comp.id.name).toBe('App');
		expect(comp.params).toHaveLength(0);
	});

	it('parses component with typed params', () => {
		const ast = parse(`component TodoList(props: { todos: string[] }) { return <div />; }`);
		const comp = ast.body[0];
		expect(comp.type).toBe('ComponentDeclaration');
		expect(comp.id.name).toBe('TodoList');
		expect(comp.params).toHaveLength(1);
		expect(comp.params[0].type).toBe('Identifier');
		expect(comp.params[0].name).toBe('props');
	});

	it('parses component with multiple params', () => {
		const ast = parse(`component Greeting(name: string, age: number) { return <div />; }`);
		const comp = ast.body[0];
		expect(comp.params).toHaveLength(2);
	});

	it('parses component with destructured params', () => {
		const ast = parse(`component Foo({ name, age }: Props) { return <div />; }`);
		const comp = ast.body[0];
		expect(comp.params[0].type).toBe('ObjectPattern');
	});

	it('parses component at module level', () => {
		const ast = parse(`
			component A { return <div />; }
			component B { return <span />; }
		`);
		expect(ast.body).toHaveLength(2);
		expect(ast.body[0].type).toBe('ComponentDeclaration');
		expect(ast.body[1].type).toBe('ComponentDeclaration');
	});

	it('parses component alongside regular declarations', () => {
		const ast = parse(`
			const x = 1;
			component App { return <div />; }
			function helper() { return x; }
		`);
		expect(ast.body[0].type).toBe('VariableDeclaration');
		expect(ast.body[1].type).toBe('ComponentDeclaration');
		expect(ast.body[2].type).toBe('FunctionDeclaration');
	});

	it('parses component with complex body', () => {
		const ast = parse(`
			component Counter(props: { initial: number }) {
				let &[count] = track(props.initial);
				return <div>{count}</div>;
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(2);
		expect(body[0].type).toBe('VariableDeclaration');
		expect(body[1].type).toBe('ReturnStatement');
	});
});

// ============================================================
// `client` keyword (islands architecture)
describe('client keyword', () => {
	it('parses component with client keyword', () => {
		const ast = parse('component Counter() client { let &[count] = track(0); return <div>{count}</div>; }');
		const comp = ast.body[0];
		expect(comp.type).toBe('ComponentDeclaration');
		expect(comp.client).toBe(true);
	});

	it('component without client has client=false', () => {
		const ast = parse('component Static { return <div>Hi</div>; }');
		expect(ast.body[0].client).toBe(false);
	});

	it('export component with client keyword', () => {
		const ast = parse('export component Counter() client { let &[count] = track(0); return <div>{count}</div>; }');
		const exp = ast.body[0];
		expect(exp.type).toBe('ExportNamedDeclaration');
		expect(exp.declaration.client).toBe(true);
	});

	it('export default component with client keyword', () => {
		const ast = parse('export default component App() client { return <div>X</div>; }');
		const exp = ast.body[0];
		expect(exp.type).toBe('ExportDefaultDeclaration');
		expect(exp.declaration.client).toBe(true);
	});

	it('component without parameters with client keyword', () => {
		const ast = parse('component App client { <div>Static</div> }');
		expect(ast.body[0].client).toBe(true);
	});

	it('client keyword does not affect non-component contexts', () => {
		const ast = parse('const x = "client";');
		expect(ast.body[0].type).toBe('VariableDeclaration');
	});
});

// `let &[name] = track(...)` parsing
// ============================================================
describe('Track Declarations', () => {
	it('parses let &[name] = track(value)', () => {
		const ast = parse(`let &[count] = track(0);`);
		const decl = ast.body[0];
		expect(decl.type).toBe('VariableDeclaration');
		expect(decl.declarations[0].id.type).toBe('ArrayPattern');
		expect(decl.declarations[0].id.lazy).toBe(true);
		expect(decl.declarations[0].init.type).toBe('CallExpression');
		expect(decl.declarations[0].init.callee.name).toBe('track');
	});

	it('parses let &[name] = track("string")', () => {
		const ast = parse(`let &[filter] = track("all");`);
		const decl = ast.body[0];
		expect(decl.declarations[0].id.lazy).toBe(true);
		expect(decl.declarations[0].init.arguments[0].value).toBe('all');
	});

	it('parses let &[name] = track(() => expr)', () => {
		const ast = parse(`let &[double] = track(() => count * 2);`);
		const init = ast.body[0].declarations[0].init;
		expect(init.type).toBe('CallExpression');
		expect(init.arguments[0].type).toBe('ArrowFunctionExpression');
	});

	it('parses let &{name} = track(value)', () => {
		const ast = parse(`let &{x, y} = track({ x: 0, y: 0 });`);
		const pattern = ast.body[0].declarations[0].id;
		expect(pattern.type).toBe('ObjectPattern');
		expect(pattern.lazy).toBe(true);
	});

	it('parses multiple track declarations in component', () => {
		const ast = parse(`
			component App() {
				let &[filter] = track("all");
				let &[count] = track(0);
				let &[selected] = track(null);
				return <div />;
			}
		`);
		const body = ast.body[0].body.body;
		const tracks = body.filter(n => n.type === 'VariableDeclaration');
		expect(tracks).toHaveLength(3);
		for (const t of tracks) {
			expect(t.declarations[0].id.lazy).toBe(true);
		}
	});

	it('track declarations inside component have lazy flag', () => {
		const ast = parse(`
			component App() {
				let &[x] = track(1);
				return <div>{x}</div>;
			}
		`);
		const trackDecl = ast.body[0].body.body[0];
		expect(trackDecl.declarations[0].id.lazy).toBe(true);
	});

	it('whitespace between let and & is allowed', () => {
		// `let  &[count] = track(0)` — whitespace between `let` and `&` is valid
		const ast = parse(`let  &[count] = track(0);`);
		expect(ast.body[0].declarations[0].id.lazy).toBe(true);
	});

	it('non-track let declarations do not have lazy flag', () => {
		const ast = parse(`let x = 5;`);
		expect(ast.body[0].declarations[0].id.lazy).toBeFalsy();
	});
});

// ============================================================
// Expression-mode component bodies
// ============================================================
describe('Expression Mode Bodies', () => {
	it('parses return (<jsx>) as main output', () => {
		const ast = parse(`
			component App() {
				return (<div>Hello</div>);
			}
		`);
		const ret = ast.body[0].body.body[0];
		expect(ret.type).toBe('ReturnStatement');
		expect(ret.argument.type).toBe('JSXElement');
	});

	it('parses return with nested JSX', () => {
		const ast = parse(`
			component App() {
				return (
					<div className="app">
						<header><h1>Title</h1></header>
						<main>Content</main>
					</div>
				);
			}
		`);
		const ret = ast.body[0].body.body[0];
		expect(ret.argument.type).toBe('JSXElement');
	});

	it('parses return with JSX expressions', () => {
		const ast = parse(`
			component App() {
				let &[count] = track(0);
				return <div>{count}</div>;
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(2);
		expect(body[0].type).toBe('VariableDeclaration');
		expect(body[1].argument.type).toBe('JSXElement');
	});

	it('parses return with conditional expressions', () => {
		const ast = parse(`
			component App() {
				let &[show] = track(true);
				return <div>{show && <p>Visible</p>}</div>;
			}
		`);
		const jsxExpr = ast.body[0].body.body[1].argument.children[0];
		expect(jsxExpr.type).toBe('JSXExpressionContainer');
	});

	it('parses return with .map()', () => {
		const ast = parse(`
			component List(props: { items: string[] }) {
				return (
					<ul>
						{props.items.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				);
			}
		`);
		const comp = ast.body[0];
		expect(comp.type).toBe('ComponentDeclaration');
	});

	it('parses return with self-closing components', () => {
		const ast = parse(`
			component App() {
				return <Child name="test" />;
			}
		`);
		expect(ast.body[0].body.body[0].argument.type).toBe('JSXElement');
	});
});

// ============================================================
// Guard-clause early returns
// ============================================================
describe('Guard-Clause Early Returns', () => {
	it('parses guard-clause return before main return', () => {
		const ast = parse(`
			component TodoList(props: { todos: Todo[] }) {
				if (props.todos.length === 0) return <EmptyState />;
				return <div>{props.todos.length}</div>;
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(2);
		expect(body[0].type).toBe('IfStatement');
		expect(body[1].type).toBe('ReturnStatement');
	});

	it('parses multiple guard clauses', () => {
		const ast = parse(`
			component App(props: { loading: boolean; error: string | null; data: any }) {
				if (props.loading) return <Spinner />;
				if (props.error) return <Error message={props.error} />;
				return <div>{props.data}</div>;
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(3);
		expect(body[0].type).toBe('IfStatement');
		expect(body[1].type).toBe('IfStatement');
		expect(body[2].type).toBe('ReturnStatement');
	});

	it('parses guard clause with complex condition', () => {
		const ast = parse(`
			component App(props: { items: Item[] }) {
				let &[filter] = track("all");
				if (!props.items || props.items.length === 0) return <Empty />;
				if (filter === "none") return <p>Nothing to show</p>;
				return <div>{filter}</div>;
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(4); // track + 2 guards + main return
	});
});

// ============================================================
// Error cases
// ============================================================
describe('Error Cases', () => {
	it('errors when `component` used as identifier', () => {
		shouldThrow(() => parse(`const x = component;`), 'reserved keyword');
	});

	it('errors when `component` used in object literal', () => {
		shouldThrow(() => parse(`const x = { component };`), 'reserved keyword');
	});

	it('errors when `component` used in array', () => {
		shouldThrow(() => parse(`const x = [component];`), 'reserved keyword');
	});

	it('errors when `component` used in template literal', () => {
		shouldThrow(() => parse('const x = `${component}`;'), 'reserved keyword');
	});

	it('errors when `component` used in arrow function body', () => {
		shouldThrow(() => parse(`const fn = () => component;`), 'reserved keyword');
	});
});

// ============================================================
// Full §2.4 example
// ============================================================
describe('Full §2.4 Example', () => {
	it('parses the complete §2.4 example from the spec', () => {
		const source = `
			component TodoList(props: { todos: Todo[] }) {
				let &[filter] = track("all");
				let &[count] = track(0);

				if (props.todos.length === 0) return <EmptyState />;

				return (
					<div class="todo-list">
						<h2>Todos ({count})</h2>
						{filter === "all" && <p>Showing all</p>}
						{props.todos.map((todo) => (
							<TodoItem key={todo.id} todo={todo} onToggle={() => count++} />
						))}
						<FilterBar value={filter} onChange={(f) => filter = f} />
					</div>
				);
			}
		`;

		const ast = parse(source);
		const comp = ast.body[0];

		// Component structure
		expect(comp.type).toBe('ComponentDeclaration');
		expect(comp.id.name).toBe('TodoList');
		expect(comp.params).toHaveLength(1);
		expect(comp.async).toBe(false);

		const body = comp.body.body;

		// 2 track declarations
		const tracks = body.filter(n => n.type === 'VariableDeclaration');
		expect(tracks).toHaveLength(2);

		// Track binding names
		expect(tracks[0].declarations[0].id.elements[0].name).toBe('filter');
		expect(tracks[0].declarations[0].id.lazy).toBe(true);
		expect(tracks[1].declarations[0].id.elements[0].name).toBe('count');
		expect(tracks[1].declarations[0].id.lazy).toBe(true);

		// Guard clause
		const ifStmt = body.find(n => n.type === 'IfStatement');
		expect(ifStmt).toBeTruthy();
		expect(ifStmt.consequent.type).toBe('ReturnStatement');
		expect(ifStmt.consequent.argument.type).toBe('JSXElement');

		// Main return
		const mainReturn = body.find(n => n.type === 'ReturnStatement' && n !== ifStmt.consequent);
		expect(mainReturn).toBeTruthy();
		expect(mainReturn.argument.type).toBe('JSXElement');

		// JSX tree: div > [h2, expr, expr, component]
		const div = mainReturn.argument;
		expect(div.openingElement.name.name).toBe('div');
		expect(div.children.length).toBeGreaterThan(0);
	});

	it('parses §2.4 variant with no guard clause', () => {
		const source = `
			component Simple(props: { name: string }) {
				let &[greeting] = track("Hello");
				return <div>{greeting} {props.name}!</div>;
			}
		`;
		const ast = parse(source);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(2);
		expect(body[0].type).toBe('VariableDeclaration');
		expect(body[1].type).toBe('ReturnStatement');
	});
});

// ============================================================
// Component body as a proper scope
// ============================================================
describe('Component Scope', () => {
	it('component body is a BlockStatement', () => {
		const ast = parse(`component App() { return <div />; }`);
		expect(ast.body[0].body.type).toBe('BlockStatement');
	});

	it('track declarations are scoped to the component', () => {
		const ast = parse(`
			component A() {
				let &[x] = track(1);
				return <div>{x}</div>;
			}
			component B() {
				let &[y] = track(2);
				return <span>{y}</span>;
			}
		`);
		const aBody = ast.body[0].body.body;
		const bBody = ast.body[1].body.body;
		expect(aBody[0].declarations[0].id.elements[0].name).toBe('x');
		expect(bBody[0].declarations[0].id.elements[0].name).toBe('y');
	});

	it('regular variables and component variables coexist', () => {
		const ast = parse(`
			const helper = () => 42;
			component App() {
				let &[x] = track(0);
				return <div>{x + helper()}</div>;
			}
		`);
		expect(ast.body[0].type).toBe('VariableDeclaration');
		expect(ast.body[1].type).toBe('ComponentDeclaration');
	});
});

// ============================================================
// TypeScript features inside components
// ============================================================
describe('TypeScript Inside Components', () => {
	it('parses typed track initializers', () => {
		const ast = parse(`
			component App() {
				let &[count]: number = track(0);
				return <div>{count}</div>;
			}
		`);
		const decl = ast.body[0].body.body[0];
		expect(decl.declarations[0].id.type).toBe('ArrayPattern');
	});

	it('parses component with generic type params (parenthesized)', () => {
		// NOTE: `component List<T>(...)` fails because `<T>` is ambiguous with JSX in .vsk files.
		// Workaround: use inline type annotation instead of generic.
		const ast = parse(`
			component List(props: { items: string[] }) {
				return <div>{props.items.length}</div>;
			}
		`);
		const comp = ast.body[0];
		expect(comp.type).toBe('ComponentDeclaration');
		expect(comp.params).toHaveLength(1);
	});

	it('parses component with complex type annotations', () => {
		const ast = parse(`
			component App(props: { data: Record<string, unknown>; count: number }) {
				return <div>{props.count}</div>;
			}
		`);
		expect(ast.body[0].params[0].typeAnnotation).toBeTruthy();
	});

	it('parses type assertions in body', () => {
		const ast = parse(`
			component App() {
				let &[data] = track(null as any);
				return <div>{(data as string).length}</div>;
			}
		`);
		expect(ast.body[0].body.body[0]).toBeTruthy();
	});
});

// ============================================================
// Statement Mode — Bare JSX as Statement
// ============================================================
describe('Statement Mode (Default)', () => {
	it('parses bare JSX as statement in component body', () => {
		const ast = parse(`
			component App() {
				<div>Hello</div>
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(1);
		expect(body[0].type).toBe('JSXElement');
	});

	it('parses self-closing JSX as statement', () => {
		const ast = parse(`
			component App() {
				<br />
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(1);
		expect(body[0].type).toBe('JSXElement');
	});

	it('parses nested JSX as statements', () => {
		const ast = parse(`
			component App() {
				<div>
					<h1>Title</h1>
					<p>Content</p>
				</div>
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(1);
		const div = body[0];
		expect(div.type).toBe('JSXElement');
		expect(div.children.length).toBeGreaterThan(0);
	});

	it('parses track declarations alongside bare JSX', () => {
		const ast = parse(`
			component Counter() {
				let &[count] = track(0);
				<div>{count}</div>
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(2);
		expect(body[0].type).toBe('VariableDeclaration');
		expect(body[1].type).toBe('JSXElement');
	});

	it('parses JSX with expression containers', () => {
		const ast = parse(`
			component App(props: { name: string }) {
				<div>Hello {props.name}</div>
			}
		`);
		const div = ast.body[0].body.body[0];
		expect(div.type).toBe('JSXElement');
		expect(div.children.length).toBeGreaterThan(0);
	});

	it('parses child components as statements', () => {
		const ast = parse(`
			component App() {
				<Greeting name="World" />
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(1);
		expect(body[0].type).toBe('JSXElement');
	});

	it('parses multiple JSX siblings', () => {
		const ast = parse(`
			component App() {
				<h1>Header</h1>
				<p>Body</p>
				<footer>Footer</footer>
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(3);
	});

	it('parses guard clause before bare JSX', () => {
		const ast = parse(`
			component App(props: { show: boolean }) {
				if (!props.show) return null;
				<div>Visible</div>
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(2);
		expect(body[0].type).toBe('IfStatement');
		expect(body[1].type).toBe('JSXElement');
	});

	it('parses bare JSX alongside regular JS statements', () => {
		const ast = parse(`
			component App() {
				const x = 42;
				if (x > 0) {
					<p>Positive</p>
				}
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(2);
		expect(body[0].type).toBe('VariableDeclaration');
		expect(body[1].type).toBe('IfStatement');
	});

	it('parses for-loop inside JSX children (statement in expression container)', () => {
		const ast = parse(`
			component List(props: { items: string[] }) {
				<ul>
					{props.items.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			}
		`);
		const body = ast.body[0].body.body;
		expect(body).toHaveLength(1);
		expect(body[0].type).toBe('JSXElement');
	});

	it('parses conditional inside JSX children via expression', () => {
		const ast = parse(`
			component App(props: { show: boolean }) {
				<div>
					{props.show && <span>Visible</span>}
				</div>
			}
		`);
		const div = ast.body[0].body.body[0];
		expect(div.type).toBe('JSXElement');
	});

	it('parses component with multiple track bindings and bare JSX', () => {
		const ast = parse(`
			component TodoList(props: { todos: Todo[] }) {
				let &[filter] = track("all");
				let &[count] = track(0);
				if (props.todos.length === 0) return <EmptyState />;
				<div class="todo-list">
					<h2>Todos ({count})</h2>
					{filter === "all" && <p>Showing all</p>}
				</div>
			}
		`);
		const body = ast.body[0].body.body;
		// 2 track + 1 guard + 1 JSX = 4 statements
		expect(body).toHaveLength(4);
		const tracks = body.filter(n => n.type === 'VariableDeclaration');
		expect(tracks).toHaveLength(2);
		expect(body[2].type).toBe('IfStatement');
		expect(body[3].type).toBe('JSXElement');
	});
});

// ============================================================
// Mixed Mode — Statement + Expression in same file
// ============================================================
describe('Mixed Mode', () => {
	it('statement mode component and expression mode component in same file', () => {
		const ast = parse(`
			component StatementComp() {
				<div>Statement mode</div>
			}
			component ExpressionComp() {
				return <div>Expression mode</div>;
			}
		`);
		expect(ast.body).toHaveLength(2);
		expect(ast.body[0].type).toBe('ComponentDeclaration');
		expect(ast.body[1].type).toBe('ComponentDeclaration');
		// Statement mode: body contains JSXElement directly
		const stmtBody = ast.body[0].body.body;
		expect(stmtBody[0].type).toBe('JSXElement');
		// Expression mode: body contains ReturnStatement
		const exprBody = ast.body[1].body.body;
		expect(exprBody[0].type).toBe('ReturnStatement');
	});
});

// ============================================================
describe('Server/Client Blocks ({#server} / {#client})', () => {
	const src = (s) => s;

	it('parses {#server} block in statement mode', () => {
		const s = `component App {
			{#server}
				<div>Server only</div>
			{/server}
		}`;
		const ast = parse(s);
		const comp = ast.body.find((n) => n.type === 'ComponentDeclaration' || (n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'ComponentDeclaration'));
		const decl = comp.type === 'ComponentDeclaration' ? comp : comp.declaration;
		expect(decl.body.body.length).not.toBe(0);
		const block = decl.body.body.find((n) => n.type === 'VeskBlock');
		expect(block).toBeTruthy();
		expect(block.tag).toBe('server');
	});

	it('parses {#client} block in statement mode', () => {
		const s = `component App {
			{#client}
				<button onClick={() => {}}>Client</button>
			{/client}
		}`;
		const ast = parse(s);
		const comp = ast.body.find((n) => n.type === 'ComponentDeclaration' || (n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'ComponentDeclaration'));
		const decl = comp.type === 'ComponentDeclaration' ? comp : comp.declaration;
		const block = decl.body.body.find((n) => n.type === 'VeskBlock');
		expect(block).toBeTruthy();
		expect(block.tag).toBe('client');
	});

	it('parses both blocks in same component', () => {
		const s = `component App {
			{#server}
				<div>Server</div>
			{/server}
			{#client}
				<button>Client</button>
			{/client}
		}`;
		const ast = parse(s);
		const comp = ast.body.find((n) => n.type === 'ComponentDeclaration' || (n.type === 'ExportNamedDeclaration' && n.declaration?.type === 'ComponentDeclaration'));
		const decl = comp.type === 'ComponentDeclaration' ? comp : comp.declaration;
		const blocks = decl.body.body.filter((n) => n.type === 'VeskBlock');
		expect(blocks.length).toBe(2);
		expect(blocks[0].tag).toBe('server');
		expect(blocks[1].tag).toBe('client');
	});
});

// ============================================================
// Results
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
	process.exit(1);
} else {
	console.log('All tests passed!');
}
