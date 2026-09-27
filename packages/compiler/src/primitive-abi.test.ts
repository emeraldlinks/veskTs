/**
 * Primitive vs leaf — the component ABI contract, compiler side.
 *
 * These tests pin down two claims about the Vesk component ABI that the
 * `primitive()` factory depends on:
 *
 *  1. The compiler ALWAYS passes an object literal for props at every call
 *     site (`{}` when a tag has no attributes) — so a component never receives
 *     nullish props from the framework, in either body mode, on either the
 *     server or the client.
 *  2. `primitive` / `leaf` auto-import, so `.vsk` sources can use them without
 *     an explicit `import`.
 *
 * Run: npx tsx packages/compiler/src/primitive-abi.test.ts
 */
import { render } from '@vesk/compiler/src/server-render';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { compileFile } from '@vesk/compiler/src/server-codegen';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { generateVskDts } from '@vesk/compiler/src/vsk-tsx';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
	try { fn(); passed++; console.log(`  ✓ ${name}`); }
	catch (e) { failed++; console.log(`  ✗ ${name} — ${(e as Error).message}`); }
}
function expect(actual: any) {
	return {
		toBe(expected: any) { if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); },
		toEqual(expected: any) { const a = JSON.stringify(actual), b = JSON.stringify(expected); if (a !== b) throw new Error(`expected ${b}, got ${a}`); },
		toContain(s: string) { if (!String(actual).includes(s)) throw new Error(`expected to contain ${JSON.stringify(s)}, got ${JSON.stringify(actual)}`); },
		toBeTruthy() { if (!actual) throw new Error(`expected truthy, got ${JSON.stringify(actual)}`); },
	};
}
function assert(cond: any, msg: string) { if (!cond) throw new Error(msg); }

function irFor(src: string) {
	return generateIR(parse(src), src);
}
function runtimeImportsOf(src: string): string[] {
	return irFor(src).imports.filter(i => i.includes('@vesk/runtime'));
}
function renderSync(src: string, name = 'App', props: Record<string, unknown> = {}): string {
	const out = render(src, name, props);
	assert(typeof out === 'string', `expected a sync render, got ${typeof out}`);
	return out as string;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. The compiler never omits props (the premise primitive() corrects)
// ────────────────────────────────────────────────────────────────────────────

test('server codegen emits an object literal for an attribute-less tag', () => {
	const compiled = compileFile('component Badge(props) { return <span>{props.children}</span> }\ncomponent App { return <Badge />; }');
	const fn = compiled.componentMap.get('App');
	assert(!!fn, 'expected App in the component map');
	const code = String(fn);
	assert(/\(\{\s*\}\s*,\s*__registry/.test(code), `expected a call with an empty object literal:\n${code.slice(0, 800)}`);
});

test('client codegen emits an object literal for an attribute-less tag', () => {
	const client = compileClient('component Badge(props) { return <span>{props.children}</span> }\ncomponent App { return <Badge />; }', 'App', { hydrate: true });
	assert(/\(\{\s*\}\s*,/.test(client), `expected a client call with an empty object literal:\n${client.slice(0, 800)}`);
});

test('a component with NO params still receives an object, not undefined', () => {
	// buildParamInit returns '' for a zero-param component, but the CALL site
	// still passes `{}` — so the ABI is uniform even for zero-param components.
	const html = renderSync('component Chip() { return <i>chip</i> }\ncomponent App { return <div><Chip /></div> }');
	expect(html).toBe('<div><i>chip</i></div>');
});

test('a bare <Badge/> with no attributes does not crash a props-reading component', () => {
	const html = renderSync('component Badge(props) { return <span>[{String(props.children)}]</span> }\ncomponent App { return <div><Badge /></div> }');
	expect(html).toBe('<div><span>[undefined]</span></div>');
});

test('statement mode also passes an object to an attribute-less child', () => {
	const html = renderSync('component Badge(props) { return <span>[{String(props.children)}]</span> }\ncomponent App { <div><Badge /></div> }');
	expect(html).toBe('<div><span>[undefined]</span></div>');
});

// ────────────────────────────────────────────────────────────────────────────
// 2. Auto-import of primitive / leaf (both body modes)
// ────────────────────────────────────────────────────────────────────────────

test('[expr] auto-imports primitive when used in script', () => {
	const src = `component App {
    const Badge = primitive((props) => "<span>" + props.label + "</span>");
    return <div><Badge label="x" /></div>;
  }`;
	const imports = runtimeImportsOf(src);
	assert(imports.some(i => i.includes('primitive')), `primitive import missing: ${JSON.stringify(imports)}`);
});

test('[stmt] auto-imports primitive when used in script', () => {
	const src = `component App {
    const Badge = primitive((props) => "<span>" + props.label + "</span>");
    <div><Badge label="x" /></div>
  }`;
	const imports = runtimeImportsOf(src);
	assert(imports.some(i => i.includes('primitive')), `primitive import missing: ${JSON.stringify(imports)}`);
});

test('[expr] auto-imports leaf when used in script', () => {
	const src = `component App {
    const Tabs = leaf((props) => "<div>" + props.id + "</div>");
    return <div><Tabs id="a" /></div>;
  }`;
	const imports = runtimeImportsOf(src);
	assert(imports.some(i => i.includes('leaf')), `leaf import missing: ${JSON.stringify(imports)}`);
});

test('[stmt] auto-imports leaf when used in script', () => {
	const src = `component App {
    const Tabs = leaf((props) => "<div>" + props.id + "</div>");
    <div><Tabs id="a" /></div>
  }`;
	const imports = runtimeImportsOf(src);
	assert(imports.some(i => i.includes('leaf')), `leaf import missing: ${JSON.stringify(imports)}`);
});

test('auto-imports both primitive and leaf when both are used', () => {
	const src = `component App {
    const Badge = primitive((props) => "<span>" + props.label + "</span>");
    const Card = leaf((props) => "<div>" + props.label + "</div>");
    return <div><Badge label="a" /><Card label="b" /></div>;
  }`;
	const imports = runtimeImportsOf(src);
	assert(imports.some(i => i.includes('primitive')), `primitive import missing: ${JSON.stringify(imports)}`);
	assert(imports.some(i => i.includes('leaf')), `leaf import missing: ${JSON.stringify(imports)}`);
});

test('auto-import defers to a locally-imported primitive (no duplicate binding)', () => {
	const src = `import { primitive } from './my-primitive.ts';
  component App {
    const Badge = primitive((props) => "<span>x</span>");
    return <div><Badge /></div>;
  }`;
	const runtimeImports = runtimeImportsOf(src);
	assert(runtimeImports.length === 0, `no runtime import expected (primitive is shadowed), got: ${JSON.stringify(runtimeImports)}`);
	assert(
		irFor(src).imports.some(i => i.includes('./my-primitive.ts') && i.includes('primitive')),
		`local primitive import missing: ${JSON.stringify(irFor(src).imports)}`
	);
});

test('no runtime import when neither primitive nor leaf is used', () => {
	const src = `component App {
    const x = 42;
    return <div>{x}</div>;
  }`;
	const imports = runtimeImportsOf(src);
	assert(imports.length === 0, `unexpected auto-imports: ${JSON.stringify(imports)}`);
});

// ────────────────────────────────────────────────────────────────────────────
// 3. A primitive really is safe to call as a bare function
// ────────────────────────────────────────────────────────────────────────────

// Direct zero-arg calls are probed through a global rather than a JSX
// container: a `{Badge()}` expression container escapes the returned markup,
// which would test the escaper instead of the zero-arg contract.
const PROBE = '__primitiveProbe';

test('a hand-written component is NOT zero-arg safe (the bug primitive fixes)', () => {
	// Establishes the baseline the factory is worth its salt for.
	const src = `const Raw = (props) => { globalThis.${PROBE} = props; return props.label; };
  component App { Raw(); return <div>ok</div>; }`;
	try {
		renderSync(src);
	} catch {
		return; // threw as expected
	}
	throw new Error('expected a hand-written component to throw when called with no args');
});

test('the same shape wrapped in primitive() is zero-arg safe', () => {
	const src = `import { primitive } from '@vesk/runtime';
  const Badge = primitive((props) => { globalThis.${PROBE} = props; return null; });
  component App { Badge(); return <div>ok</div>; }`;
	delete (globalThis as any)[PROBE];
	expect(renderSync(src)).toBe('<div>ok</div>');
	const seen = (globalThis as any)[PROBE];
	assert(seen && typeof seen === 'object', `expected props to be substituted, got ${JSON.stringify(seen)}`);
	expect(Object.isFrozen(seen)).toBe(true);
	expect(Object.keys(seen)).toEqual([]);
});

test('primitive() leaves a real props object untouched on a direct call', () => {
	const src = `import { primitive } from '@vesk/runtime';
  const Badge = primitive((props) => { globalThis.${PROBE} = props; return null; });
  component App { Badge({ label: "x" }); return <div>ok</div>; }`;
	delete (globalThis as any)[PROBE];
	renderSync(src);
	const seen = (globalThis as any)[PROBE];
	expect(Object.isFrozen(seen)).toBe(false);
	expect(seen.label).toBe('x');
});

test('a primitive renders correctly with attributes passed', () => {
	const src = `import { primitive } from '@vesk/runtime';
  const Badge = primitive((props) => "<span>" + (props.label ?? "none") + "</span>");
  component App { return <div><Badge label="new" /></div>; }`;
	expect(renderSync(src)).toBe('<div><span>new</span></div>');
});

test('a leaf renders correctly through the same call shape', () => {
	const src = `import { leaf } from '@vesk/runtime';
  const Card = leaf((props) => "<div>" + (props.label ?? "none") + "</div>");
  component App { return <section><Card label="a" /></section>; }`;
	expect(renderSync(src)).toBe('<section><div>a</div></section>');
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Interaction with props conventions and tsc-in-.vsk
// ────────────────────────────────────────────────────────────────────────────

test('a renamed props parameter and primitive coexist', () => {
	const src = `import { primitive } from '@vesk/runtime';
  const Badge = primitive((p) => "<b>" + p.label + "</b>");
  component App(p) { return <div><Badge label={p.label} /></div>; }`;
	expect(renderSync(src, 'App', { label: 'x' })).toBe('<div><b>x</b></div>');
});

test('a destructured props parameter and primitive coexist', () => {
	const src = `import { primitive } from '@vesk/runtime';
  const Badge = primitive((p) => "<b>" + p.label + "</b>");
  component App({ label }) { return <div><Badge label={label} /></div>; }`;
	expect(renderSync(src, 'App', { label: 'x' })).toBe('<div><b>x</b></div>');
});

test('a primitive receives props.children from a nested body', () => {
	const src = `import { primitive } from '@vesk/runtime';
  const Wrap = primitive((props) => "<div>" + props.children + "</div>");
  component App { return <Wrap><span>kid</span></Wrap>; }`;
	expect(renderSync(src)).toBe('<div><span>kid</span></div>');
});

test('generateVskDts accepts a source that uses primitive and leaf', () => {
	const src = `import { primitive, leaf } from '@vesk/runtime';
  const Badge = primitive((props: { label?: string }) => "<span>" + (props.label ?? "") + "</span>");
  const Card = leaf((props: { label: string }, reg, scope) => "<div>" + props.label + "</div>");
  component App { return <div><Badge label="x" /><Card label="y" /></div>; }`;
	const dts = generateVskDts(src);
	expect(dts).toContain('AppProps');
	expect(dts).toContain('export declare function App');
	// The runtime import must survive into the .d.ts so the component typechecks.
	expect(dts).toContain("import { primitive, leaf } from '@vesk/runtime'");
});

test('statement-mode App body with primitive survives codegen', () => {
	const src = `import { primitive } from '@vesk/runtime';
  const Badge = primitive((props) => "<span>" + (props.label ?? "none") + "</span>");
  component App {
    const label = "hi"
    <div><Badge label={label} /></div>
  }`;
	expect(renderSync(src)).toBe('<div><span>hi</span></div>');
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) process.exit(1);
