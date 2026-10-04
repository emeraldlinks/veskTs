/**
 * lucide-vesk bundle contract — `packages/lucide-vesk` + the adapter's chunk
 * bundler.
 *
 * Two things are pinned here, both measured through the REAL `generateClientBundle`
 * path rather than an isolated esbuild invocation, because the failure mode this
 * guards is precisely that a barrel import does not tree-shake in the pipeline:
 *
 *  1. A barrel import of N icons ships N icons. This was 1,594 of 4,782 before
 *     `@__PURE__` landed on `createLucideIcon(...)`, because a bundler must
 *     assume a bare call has side effects. The annotation is what makes the
 *     barrel usable at all.
 *  2. The icon still renders correctly — the size win is only allowed to exist
 *     because nothing about the output changed.
 *
 * The third test is the one that would catch a regression nobody would notice
 * by eye: the name transforms used to run at module scope on every icon even
 * though the generator already passes kebab-case.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateClientBundle } from '@vesk/adapter/src/client-bundle';
import { renderPage } from '@vesk/compiler/src/server-render';
import { scanRoutes } from '@vesk/compiler/src/router';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(e as Error).message}`);
  }
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

/** Writes a one-route app and returns its generated client chunk. */
async function buildChunk(pageSource: string, _componentName?: string): Promise<string> {
  // The fixture MUST live inside the project: `lucide-vesk` is a workspace
  // package resolved by walking up to the repo's node_modules, and a fixture in
  // the OS temp dir has no node_modules above it — which is a fixture bug, not a
  // tree-shaking one.
  const root = join(process.cwd(), 'tmp');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'vesk-lucide-'));
  try {
    const appDir = join(dir, 'app');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'page.vsk'), pageSource);
    const tree = scanRoutes(appDir);
    assert(tree.length > 0, 'scanRoutes found no routes in the fixture');
    const bundle = await generateClientBundle(tree, appDir, new Map(), { codeSplit: true });
    const chunk = bundle.chunks.find((c) => c.code.includes('lucide-vesk'));
    // A single-route app may land its code in the monolithic main bundle rather
    // than a split chunk; either is a valid place for the measurement.
    const code = chunk ? chunk.code : bundle.main;
    assert(code.includes('lucide-vesk'), 'expected an icon-bearing bundle');
    return code;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Icon modules esbuild actually pulled into a chunk, by its banner comment. */
function iconModulesIn(chunk: string): string[] {
  const out: string[] = [];
  for (const line of chunk.split('\n')) {
    const m = /^\s*\/\/ packages\/lucide-vesk\/dist\/icons\/([A-Za-z0-9]+)\.js\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

async function main() {
  console.log('\n=== lucide-vesk: barrel tree-shaking ===');

  // ── 1. Only the imported icons ship ─────────────────────��─────────────────
  await (async () => {
    const chunk = await buildChunk(
      `import { Terminal, Search } from 'lucide-vesk';\ncomponent Home {\n\t<div><Terminal size={14} /><Search size={14} /></div>\n}\nexport default Home;\n`,

    );
    const mods = iconModulesIn(chunk);
    assert(mods.length === 2, `expected exactly 2 icon modules, got ${mods.length}: ${mods.slice(0, 8).join(', ')}`);
    assert(mods.includes('Terminal') && mods.includes('Search'), `expected Terminal + Search, got ${mods.join(', ')}`);

    const total = readdirSync(join(process.cwd(), 'packages/lucide-vesk/dist/icons')).length;
    assert(total > 1000, `fixture looks wrong: only ${total} icons in the package`);
    assert(mods.length < total / 100, `a barrel import shipped ${mods.length}/${total} icons — tree-shaking regressed`);
    console.log(`    (2 of ${total} icons, ${chunk.length} bytes)`);
  })();

  // ── 2. The per-file license banner is gone ─────────────────────────────────
  test('legalComments: none strips the per-icon license banners', async () => {
    const chunk = await buildChunk(
      `import { Terminal } from 'lucide-vesk';\ncomponent Home {\n\t<div><Terminal size={14} /></div>\n}\nexport default Home;\n`,

    );
    assert(!chunk.includes('@license'), 'chunk still carries @license banners');
    assert(chunk.includes('lucide-vesk'), 'chunk lost its lucide dependency entirely (suspicious)');
  });

  // ── 3. Name transforms are not shipped to compute build-time constants ──────
  test('toKebabCase/toPascalCase are not bundled', async () => {
    const chunk = await buildChunk(
      `import { Terminal } from 'lucide-vesk';\ncomponent Home {\n\t<div><Terminal size={14} /></div>\n}\nexport default Home;\n`,

    );
    // The generator already passes kebab-case, so re-deriving it (and the
    // Pascal case used only for a DevTools label nothing reads) shipped two
    // character loops for constants that were known when the file was written.
    assert(!chunk.includes('function toKebabCase'), 'toKebabCase is still bundled');
    assert(!chunk.includes('function toPascalCase'), 'toPascalCase is still bundled');
    assert(!chunk.includes('function toCamelCase'), 'toCamelCase is still bundled');
  });

  // ── 4. …and the icon still renders exactly as before ───────────────────────
  test('the icon still renders correct markup after the size work', () => {
    const src = `import { Terminal, Search, ArrowLeft } from 'lucide-vesk';
component V {
\t<div>
\t\t<Terminal size={14} />
\t\t<Search class="shrink-0 text-slate-400" />
\t\t<ArrowLeft className="a" class="b" />
\t\t<Terminal size={14} strokeWidth={3} absoluteStrokeWidth={true} />
\t\t<Terminal size={20} title="Terminal app" />
\t</div>
}`;
    const r = renderPage(src, 'V', {}, new Map(), {
      hydrate: false,
      sourcePath: join(process.cwd(), 'lucide-probe.vsk'),
    }) as { body: string };
    const svgs = r.body.match(/<svg[^>]*>/g) || [];
    assert(svgs.length === 5, `expected 5 svgs, got ${svgs.length}`);
    // The kebab class is what proves the name is right end-to-end.
    assert(svgs[0]!.includes('class="lucide lucide-terminal"'), `bad class: ${svgs[0]}`);
    assert(svgs[0]!.includes('width="14"'), `size not applied: ${svgs[0]}`);
    assert(svgs[1]!.includes('lucide-search shrink-0 text-slate-400'), `class merge broken: ${svgs[1]}`);
    assert(svgs[2]!.includes('lucide-arrow-left a b'), `className+class merge broken: ${svgs[2]}`);
    // absoluteStrokeWidth: 3 * 24 / 14
    assert(svgs[3]!.includes('stroke-width="5.142857142857143"'), `absoluteStrokeWidth broken: ${svgs[3]}`);
    // A title suppresses aria-hidden (the a11y rule).
    assert(!svgs[4]!.includes('aria-hidden'), 'title should suppress aria-hidden');
    assert(r.body.includes('<title>Terminal app</title>'), 'title element missing');
  });

  console.log(`\nlucide-tree-shake: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void readFileSync;
void main();