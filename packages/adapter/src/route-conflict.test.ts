/**
 * Build gate: two route files claiming one URL.
 *
 * The failure this prevents is silent by construction — SSR routes from a
 * path->file map (last write wins) while the client router walks the manifest
 * tree (first match wins), so a group page and a root page both claiming `/`
 * ship a document for one of them and hydrate the other. Both respond 200; the
 * only symptom is a page whose claims land on the layout's elements.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '@vesk/adapter/src/index';

let passed = 0, failed = 0;
function assert(c: boolean, msg: string) { if (c) { passed++; console.log(`  ✓ ${msg}`); } else { failed++; console.log(`  ✗ ${msg}`); } }

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vesk-conflict-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

async function main() {
  console.log('\n=== build: conflicting route paths are refused ===');

  // Captured console.error so the diagnostic can be asserted, not scraped from
  // a terminal nobody reads in CI.
  const errors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };

  try {
    {
      const app = fixture({
        'app/layout.vsk': 'component RootLayout { <div>{props.children}</div> }',
        'app/page.vsk': 'component HomePage { <h1>ROOT</h1> }',
        'app/(public)/page.vsk': 'component GroupHome { <h1>GROUP</h1> }',
      });
      let threw = false;
      try {
        await build(join(app, 'app'), { outDir: join(app, '.vesk') });
      } catch (e) {
        threw = true;
        assert(String((e as Error).message).includes('conflicting route'), 'build throws naming the conflict');
      }
      assert(threw, 'build refuses a URL claimed by two pages');
      assert(errors.some((l) => l.includes('conflicting routes')), 'build prints the conflicting-routes diagnostic');
      assert(errors.some((l) => l.includes('app/page.vsk') && l.includes('app/(public)/page.vsk')), 'the diagnostic names BOTH files');
      rmSync(app, { recursive: true, force: true });
    }

    {
      // The gate must not fire on a legitimate app: a layout-only group shares
      // its children's path by design, and dynamic/catch-all segments differ.
      errors.length = 0;
      const app = fixture({
        'app/layout.vsk': 'component RootLayout { <div>{props.children}</div> }',
        'app/(public)/page.vsk': 'component page { <h1>HOME</h1> }',
        'app/(public)/layout.vsk': 'component PublicLayout { <section>{props.children}</section> }',
        'app/(public)/about/page.vsk': 'component AboutPage { <h1>About</h1> }',
        'app/(public)/docs/[slug]/page.vsk': 'component DocPage { <h1>Doc</h1> }',
        'app/(public)/docs/[...rest]/page.vsk': 'component RestPage { <h1>Rest</h1> }',
      });
      let threw = false;
      try {
        await build(join(app, 'app'), { outDir: join(app, '.vesk') });
      } catch (e) {
        threw = true;
        realError(String((e as Error).message));
      }
      assert(!threw, 'a normal app with a group layout builds');
      assert(!errors.some((l) => l.includes('conflicting routes')), 'no false-positive conflict report');
      rmSync(app, { recursive: true, force: true });
    }
  } finally {
    console.error = realError;
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
  console.log('All build-conflict tests passed!');
}

main().catch((e) => { console.error(e); process.exit(1); });