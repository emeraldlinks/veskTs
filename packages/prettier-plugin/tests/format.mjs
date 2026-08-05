import { format } from 'prettier';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(testsDir, '..', '..', '..');
const pluginPath = resolve(testsDir, '..', 'src', 'index.js');
const { parse: compilerParse } = await import(resolve(root, 'packages/compiler/dist/index.js'));

const opts = {
  parser: 'vesk',
  plugins: [pluginPath],
  semi: false,
  singleQuote: false,
  trailingComma: 'es5',
  tabWidth: 2,
  printWidth: 100,
};

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
  }
}

// ── Golden output tests ─────────────────────────────────────────

await check('formats reactive bindings and JSX', async () => {
  const src = `component Home (){\nconst &[count] = track(10)\n<p>{count}</p>\n}`;
  const out = await format(src, opts);
  const expected = `component Home {\n  const &[count] = track(10)\n  <p>{count}</p>\n}\n`;
  if (out !== expected) throw new Error(`\nexpected:\n${expected}\ngot:\n${out}`);
});

await check('preserves for-of ; key clause', async () => {
  const src = `component List() {\n  for (const todo of todos; key todo.id) {\n    <li>{todo.text}</li>\n  }\n}\n`;
  const out = await format(src, opts);
  if (!out.includes('for (const todo of todos; key todo.id) {')) {
    throw new Error(`key clause lost:\n${out}`);
  }
  compilerParse(out, {});
});

await check('preserves empty block statement', async () => {
  const src = `component L() {\n  empty {\n    <li>none</li>\n  }\n}\n`;
  const out = await format(src, opts);
  if (!out.includes('empty {')) throw new Error(`empty block lost:\n${out}`);
  compilerParse(out, {});
});

await check('keeps <style> content verbatim', async () => {
  const src = `component S() {\n  <style> .a { color: red } </style>\n  <p>hi</p>\n}\n`;
  const out = await format(src, opts);
  if (!out.includes('.a { color: red }')) throw new Error(`style content altered:\n${out}`);
  compilerParse(out, {});
});

await check('preserves leading and trailing comments', async () => {
  const src = `// top\ncomponent A(props) {\n  // c1\n  const x = 1 // c2\n  return <p>{x}</p>\n}\n`;
  const out = await format(src, opts);
  if (!out.includes('// top')) throw new Error(`top comment lost:\n${out}`);
  if (!out.includes('// c1')) throw new Error(`stmt comment lost:\n${out}`);
  if (!out.includes('// c2')) throw new Error(`trailing comment lost:\n${out}`);
  compilerParse(out, {});
});

await check('keeps component client modifier', async () => {
  const src = `component Throw(props) client {\n  throw new Error(props.msg)\n}\n`;
  const out = await format(src, opts);
  if (!out.includes('component Throw(props) client {')) {
    throw new Error(`client modifier lost:\n${out}`);
  }
  compilerParse(out, {});
});

await check('formats generic component type parameters', async () => {
  const src = `component Store<T>(items: T[]) {\n  <p>{items[0]}</p>\n}\n`;
  const out = await format(src, opts);
  if (!out.includes('component Store<T>(')) throw new Error(`type params lost:\n${out}`);
  compilerParse(out, {});
});

await check('formats arrow functions returning JSX', async () => {
  const src = `component M() {\n  <ul>{items.map((u) => <li>{u.name}</li>)}</ul>\n}\n`;
  const out = await format(src, opts);
  compilerParse(out, {});
});

await check('formats interfaces', async () => {
  const src = `interface Typee {\n  name?: string\n}\ncomponent T() {\n  <p>hi</p>\n}\n`;
  const out = await format(src, opts);
  compilerParse(out, {});
});

// ── Idempotency + round-trip over the test app ───────────────────

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e.startsWith('.') || e === 'node_modules') continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (e.endsWith('.vsk')) out.push(full);
  }
  return out;
}

const appDir = resolve(root, 'test-app');
for (const file of walk(appDir)) {
  const src = readFileSync(file, 'utf-8');
  await check(`idempotent + round-trip: ${file.replace(appDir, '')}`, async () => {
    const out = await format(src, opts);
    const out2 = await format(out, opts);
    if (out !== out2) {
      const a = out.split('\n');
      const b = out2.split('\n');
      let d = '';
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
          d += `L${i + 1} ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}\n`;
          if (i > 25) break;
        }
      }
      throw new Error(`not idempotent\n${d}`);
    }
    compilerParse(out, {});
  });
}

console.log(`\nprettier-plugin tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  for (const f of failures) console.log('  - ' + f);
}
process.exit(failed ? 1 : 0);
