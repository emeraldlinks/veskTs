/**
 * Vesk CLI / .vsk File Tests
 *
 * Tests that .vsk files compile correctly end-to-end:
 * parse → IR → client codegen with exports.
 *
 * Run with: node --experimental-vm-modules packages/compiler/src/cli.test.js
 */
import { readFileSync } from 'fs';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { parse } from '@vesk/compiler/src/parser';
import { ssg } from '@vesk/compiler/src/server-codegen';

let passed = 0;
let failed = 0;

function describe(name, fn) {
	try {
		fn();
	} catch (e) {
		console.log(`\n  DESCRIBE ERROR: ${name}`);
		console.log(`  ${e.message}`);
		failed++;
	}
}

const pendingAsyncIts = [];
function it(name, fn) {
	try {
		const result = fn();
		// Async tests must actually be awaited: an un-awaited async `it`
		// passes vacuously (its assertions run after Results print as
		// unobserved rejections). Collect and settle before reporting.
		if (result && typeof result.then === 'function') {
			pendingAsyncIts.push(
				result.then(
					() => { console.log(`  ✓ ${name}`); passed++; },
					(e) => { console.log(`  ✗ ${name}`); console.log(`    ${e.message}`); failed++; },
				),
			);
			return;
		}
		console.log(`  ✓ ${name}`);
		passed++;
	} catch (e) {
		console.log(`  ✗ ${name}`);
		console.log(`    ${e.message}`);
		failed++;
	}
}

function expect(actual) {
	return {
		toBe(expected) {
			if (actual !== expected) {
				throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
			}
		},
		toContain(expected) {
			if (!actual.includes(expected)) {
				throw new Error(`expected to contain ${JSON.stringify(expected)}, but got:\n${actual}`);
			}
		},
		not: {
			toContain(expected) {
				if (actual.includes(expected)) {
					throw new Error(`expected NOT to contain ${JSON.stringify(expected)}, but it did`);
				}
			}
		}
	};
}

function compileVsk(fixtureName, options) {
	const source = readFileSync(new URL(`../fixtures/${fixtureName}.vsk`, import.meta.url), 'utf-8');
	return compileClient(source, null, options);
}

function parseVsk(fixtureName) {
	const source = readFileSync(new URL(`../fixtures/${fixtureName}.vsk`, import.meta.url), 'utf-8');
	return parse(source);
}

describe('SSG (Static Site Generation)', () => {

	it('generates full HTML page with hydration', async () => {
		const src = `export component Page {
			return <div>SSG Page</div>
		}`;
		const result = await ssg(src);
		expect(result.html).toContain('<!DOCTYPE html>');
		expect(result.html).toContain('SSG Page');
		expect(result.html).toContain('<script>');
		expect(result.body).toContain('SSG Page');
		// Fully static: zero markers of either form (keyed-marker world).
		expect(!result.html.includes('<!--vsk-->')).toBe(true);
		expect(!result.html.includes('<!--vsk:')).toBe(true);
	});

	it('dynamic SSG page stays markerless (plain HTML)', async () => {
		const src = `import { track } from '@vesk/runtime';
		export component Page {
			const &[n] = track(1);
			return <div>{n}</div>
		}`;
		const result = await ssg(src);
		expect(result.body).toContain('<div>1</div>');
		expect(!result.body.includes('<!--vsk')).toBe(true);
	});

	it('getStaticProps sync provides props to render', async () => {
		const src = `export function getStaticProps() {
			return { props: { title: 'SSG Title' } };
		}
		export component Page(props: { title: string }) {
			return <h1>{props.title}</h1>
		}`;
		const result = await ssg(src);
		expect(result.html).toContain('SSG Title');
		const data = JSON.parse(result.props);
		expect(data.title).toBe('SSG Title');
	});

	it('getStaticProps async provides props to render', async () => {
		const src = `export async function getStaticProps() {
			return { props: { n: 42 } };
		}
		export component Page(props: { n: number }) {
			return <p>{props.n}</p>
		}`;
		const result = await ssg(src);
		expect(result.html).toContain('42');
		const data = JSON.parse(result.props);
		expect(data.n).toBe(42);
	});

	// NOTE: the `node ../../bin/vesk <file> --ssg` file-mode CLI these tests once
	// invoked no longer exists (no bin/ in this package; SSG ships via
	// `vesk build` + the adapter prerender path), and the old `join(url)`
	// invocation never even formed a valid path — the async `it` harness never
	// awaited them, so they passed vacuously. Removed; the `ssg()` API surface
	// is covered above and in ssg.test.ts.
});

describe('.vsk file compilation', () => {

	it('basic component', () => {
		const ast = parseVsk('basic');
		expect(ast.body[0].type).toBe('ComponentDeclaration');
		expect(ast.body[0].id.name).toBe('Greeting');
		const code = compileVsk('basic', { forceClient: true });
		expect(code).toContain('Greeting');
		expect(code).toContain('createElement');
	});

	it('with import', () => {
		const ast = parseVsk('with-import');
		expect(ast.body[0].type).toBe('ImportDeclaration');
		expect(ast.body[1].type).toBe('ComponentDeclaration');
		const code = compileVsk('with-import');
		expect(code).toContain(`import { fn } from './utils.js'`);
	});

	it('with props', () => {
		const ast = parseVsk('with-props');
		const comp = ast.body[0];
		expect(comp.type).toBe('ComponentDeclaration');
		expect(comp.params.length).toBe(1);
		const code = compileVsk('with-props');
		expect(code).toContain('Card');
	});

	it('with style', () => {
		const code = compileVsk('with-style', { forceClient: true });
		expect(code).toContain('vesk-StyledBox');
		expect(code).toContain('color: red');
	});

	it('export named component', () => {
		const ast = parseVsk('export-named');
		const node = ast.body[0];
		expect(node.type).toBe('ExportNamedDeclaration');
		expect(node.declaration.type).toBe('ComponentDeclaration');
		expect(node.declaration.id.name).toBe('App');
		const code = compileVsk('export-named', { forceClient: true });
		expect(code).toContain('export const App = ');
	});

	it('export default component', () => {
		const ast = parseVsk('export-default');
		const node = ast.body[0];
		expect(node.type).toBe('ExportDefaultDeclaration');
		expect(node.declaration.type).toBe('ComponentDeclaration');
		const code = compileVsk('export-default', { forceClient: true });
		expect(code).toContain('export default __components["App"]');
	});

	it('reactive track declaration', () => {
		const ast = parseVsk('reactive');
		const body = ast.body[0].body.body;
		expect(body[0].declarations[0].id.lazy).toBe(true);
		const code = compileVsk('reactive');
		expect(code).toContain('track');
	});

	it('expression mode with export', () => {
		const ast = parseVsk('expr-export');
		const node = ast.body[0];
		expect(node.type).toBe('ExportNamedDeclaration');
		expect(node.declaration.type).toBe('ComponentDeclaration');
		expect(node.declaration.body.body[0].type).toBe('ReturnStatement');
		const code = compileVsk('expr-export');
		expect(code).toContain('export const App = ');
		expect(code).toContain('createTextNode');
	});

	it('deep nested imports via registry', () => {
		const code = compileVsk('simple');
		expect(code).toContain(`import { Button } from './Button.vsk'`);
		expect(code).toContain(`__components["Button"]({ "label": "Click me" })`);
		expect(code).toContain('export const App = ');
	});
});

await Promise.all(pendingAsyncIts);
console.log(`\n==================================================`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${failed === 0 ? 'All tests passed!' : 'Some tests failed!'}`);
process.exit(failed > 0 ? 1 : 0);
