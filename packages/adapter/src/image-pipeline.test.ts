/**
 * Image pipeline: no capability probe unless the app actually uses `<Image>`.
 *
 * The sharp probe spawns a child Node that imports sharp's native binary. On a
 * CPU that cannot run it, the child dies with SIGILL — and the kernel writes a
 * core dump on the way out, so the "no" answer is the expensive one: measured at
 * 25-100 s per build on a loaded 2-core box. It used to run at module scope, so
 * EVERY `vesk build` paid it — including builds of apps with no images at all,
 * which is most of them.
 *
 * Run with: npx tsx packages/adapter/src/image-pipeline.test.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { optimizeImages } from '@vesk/adapter/src/image-pipeline';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Serialized: the assertions await the pipeline, and a detached async test
// would interleave with the next one (and print its failures out of order).
let chain: Promise<void> = Promise.resolve();

function it(name: string, fn: () => unknown): void {
  chain = chain.then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${(e as Error).message}`);
      failures.push({ name, message: (e as Error).message });
    }
  });
}

/** Run `fn` with console output captured; returns the combined log. */
async function capture<T>(fn: () => Promise<T>): Promise<{ value: T; log: string }> {
  const errors: string[] = [];
  const warns: string[] = [];
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ')); };
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')); };
  try {
    const value = await fn();
    return { value, log: [...errors, ...warns].join('\n') };
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
}

function makeApp(pageBody: string): { appDir: string; outDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'vesk-images-'));
  const appDir = join(root, 'app');
  mkdirSync(join(appDir, 'about'), { recursive: true });
  writeFileSync(join(appDir, 'page.vsk'), `component Home {\n\t${pageBody}\n}\n`);
  const outDir = join(root, '.vesk');
  mkdirSync(join(outDir, 'static'), { recursive: true });
  return { appDir, outDir };
}

console.log('\n=== Image pipeline probe gating ===');

it('an app with no <Image> never reaches the sharp probe', async () => {
  const { appDir, outDir } = makeApp('<h1>plain</h1>');
  const { value, log } = await capture(() => optimizeImages(appDir, outDir));
  assert(value.length === 0, `expected no image results, got ${value.length}`);
  assert(/no <Image> refs found/.test(log), `expected the no-refs line, got: ${log}`);
  assert(
    !/sharp/.test(log),
    `the sharp probe ran for an app with no images — that is the build-time regression:\n${log}`,
  );
});

it('an app with <Image> refs does reach the pipeline', async () => {
  const { appDir, outDir } = makeApp('<Image src="/missing.jpg" alt="x" />');
  const { log } = await capture(() => optimizeImages(appDir, outDir));
  // The ref is unresolvable in this fixture, which is the point: the pipeline
  // reported it instead of staying silent, i.e. it was entered. It also proves
  // the leading-slash src is resolved against the APP (a `path.resolve` that
  // kept the slash would look at the filesystem root and still say "not found",
  // so this alone does not distinguish them — the next test does).
  assert(
    /not found/.test(log),
    `a referenced image was never looked up, so the pipeline was skipped:\n${log}`,
  );
});

it('a site-root-relative <Image> resolves to the file and is processed', async () => {
  // Backend-independent on purpose: CI runs sharp, this box cannot, and the two
  // disagree on what they emit (copy-only writes `hero-640w` for every width;
  // sharp reads the source's real width and skips the ones it would have to
  // enlarge). What must hold on BOTH is the regression itself: with the
  // leading-slash bug, `resolve(appDir, '/hero.png')` asked the filesystem root
  // for a file, the reference came back "not found", and nothing was processed.
  const root = mkdtempSync(join(tmpdir(), 'vesk-images-ok-'));
  const appDir = join(root, 'app');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'page.vsk'), 'component Home {\n\t<Image src="/hero.png" alt="h" />\n}\n');
  // A real 1x1 PNG (a fixture file would have to be a binary in the repo, and a
  // hand-rolled encoder here would only add ways for this to be wrong).
  writeFileSync(join(appDir, 'hero.png'), ONE_BY_ONE_PNG);
  const outDir = join(root, '.vesk');
  mkdirSync(join(outDir, 'static'), { recursive: true });
  const { value, log } = await capture(() => optimizeImages(appDir, outDir));
  assert(value.length === 1, `expected one processed image, got ${value.length} (log: ${log})`);
  assert(!/not found/.test(log), `the site-root-relative reference was reported missing:\n${log}`);
  assert(
    JSON.stringify(value[0].widths) === JSON.stringify([640, 768, 1024, 1280, 1536]),
    `unexpected width set: ${JSON.stringify(value[0].widths)}`,
  );
  assert(existsSync(join(outDir, 'static', 'images')), 'no images directory was written');
});

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);


// Reported from the chain rather than a top-level await: this package
// transpiles to CJS, where a top-level await prints the summary before the
// async cases have run — a suite that reports 0 passed and exits 0.
void chain.then(() => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
    process.exit(1);
  }
  console.log('All image-pipeline tests passed!');
});
