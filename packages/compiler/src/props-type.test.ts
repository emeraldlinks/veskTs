import { parse } from '@vesk/compiler/src/parser';
import { generateIR, getPropsType } from '@vesk/compiler/src/ir-generator';
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
    toContain(s: string) { if (!String(actual).includes(s)) throw new Error(`expected to contain ${JSON.stringify(s)}, got ${JSON.stringify(actual)}`); },
    toBeTruthy() { if (!actual) throw new Error(`expected truthy, got ${JSON.stringify(actual)}`); },
  };
}

function irFor(src: string) {
  const ast = parse(src);
  const ir = generateIR(ast, src);
  return ir.components[0];
}

// Single param with type
test('getPropsType single param with type', () => {
  const src = `component Card(props: { title: string }) { <div>{props.title}</div> }`;
  const ast = parse(src);
  const comp = (ast.body[0] as any);
  const t = getPropsType(comp.params, src);
  expect(t).toBe('{ title: string }');
  const ir = irFor(src);
  expect(ir.propsType).toBe('{ title: string }');
});

test('getPropsType single param without type -> null', () => {
  const src = `component App(props) { <div>{props.x}</div> }`;
  const ast = parse(src);
  const comp = (ast.body[0] as any);
  const t = getPropsType(comp.params, src);
  expect(t).toBe(null);
  const ir = irFor(src);
  expect(ir.propsType).toBe(null);
});

test('getPropsType destructured with annotation', () => {
  const src = `component Foo({ name, age }: { name: string; age: number }) { <p>{name}</p> }`;
  const ast = parse(src);
  const comp = (ast.body[0] as any);
  const t = getPropsType(comp.params, src);
  expect(t).toBe('{ name: string; age: number }');
});

test('getPropsType multiple params synthesized', () => {
  const src = `component Greeting(name: string, age: number) { <p>{name}</p> }`;
  const ast = parse(src);
  const comp = (ast.body[0] as any);
  const t = getPropsType(comp.params, src);
  expect(t).toContain('"name"');
  expect(t).toContain('string');
  expect(t).toContain('"age"');
  expect(t).toContain('number');
  const ir = irFor(src);
  expect(ir.propsType).toContain('"name"');
});

test('getPropsType optional param (AssignmentPattern)', () => {
  const src = `component Btn(label: string, disabled = false) { <button>{label}</button> }`;
  // This is actually two params, second has default -> optional
  const ast = parse(src);
  const comp = (ast.body[0] as any);
  const t = getPropsType(comp.params, src);
  // Should contain optional marker ?
  expect(t).toContain('disabled');
});

test('getPropsType empty -> null', () => {
  const src = `component App() { <div>hi</div> }`;
  const ast = parse(src);
  const comp = (ast.body[0] as any);
  const t = getPropsType(comp.params, src);
  expect(t).toBe(null);
});

test('ComponentIR propsType propagates to vsk-tsx dts', () => {
  const src = `export component Card(props: { title: string }) { <div>{props.title}</div> }`;
  const dts = generateVskDts(src);
  expect(dts).toContain('export type CardProps = { title: string };');
  expect(dts).toContain('CardProps & { children?: Component }');
  const ir = irFor(src);
  expect(ir.propsType).toBe('{ title: string }');
});

test('statement vs expression mode both expose propsType', () => {
  const expr = `component App(props: { x: number }) { return <p>{props.x}</p>; }`;
  const stmt = `component App(props: { x: number }) { <p>{props.x}</p> }`;
  const irExpr = irFor(expr);
  const irStmt = irFor(stmt);
  expect(irExpr.propsType).toBe('{ x: number }');
  expect(irStmt.propsType).toBe('{ x: number }');
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed+failed} total`);
if (failed>0) process.exit(1);
