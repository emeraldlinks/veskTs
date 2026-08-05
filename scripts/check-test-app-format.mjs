import { format } from 'prettier';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP = '/workspaces/veskTs/test-app';

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e.startsWith('.') || e === 'node_modules') continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (e.endsWith('.vsk')) out.push(full);
  }
  return out;
}

const opts = {
  parser: 'vesk',
  plugins: ['/workspaces/veskTs/packages/prettier-plugin/src/index.js'],
  semi: false,
  singleQuote: false,
  trailingComma: 'es5',
  tabWidth: 2,
  printWidth: 100,
};

const files = walk(APP);
let pass = 0;
let fail = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf-8');
  try {
    const out = await format(src, opts);
    const out2 = await format(out, opts);
    if (out !== out2) {
      console.log(`FAIL (not idempotent): ${file}`);
      fail++;
      continue;
    }
    pass++;
  } catch (e) {
    console.log(`FAIL (throws): ${file}\n  ${e.message}`);
    fail++;
  }
}

console.log(`\nidempotency: ${pass} passed, ${fail} failed (${files.length} files)`);
process.exit(fail ? 1 : 0);
