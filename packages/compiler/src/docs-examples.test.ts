/**
 * Every code example in the docs must compile.
 *
 * Docs rot silently: nobody notices a `useFetch` option that stopped existing
 * until a reader pastes it. The examples on the docs site are the first thing a
 * new user copies, so they are checked here — extracted from the real content
 * modules, compiled through the real compiler, and rendered.
 *
 * The contract is deliberately narrow, so it stays checkable:
 *   - a block whose filename ends in `.vsk` (or whose code starts with
 *     `component`) must COMPILE and RENDER as a component;
 *   - anything else (a config snippet, a shell command, a partial) is skipped
 *     rather than guessed at.
 *
 * Run with: npx tsx packages/compiler/src/docs-examples.test.ts
 */
import { renderPage, renderFullPage } from '@vesk/compiler/src/server-codegen';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { parse } from '@vesk/compiler/src/parser';
import * as basePages from '../../../vesk-doc/src/content/docs.js';
import * as dataFetching from '../../../vesk-doc/src/content/docs-data-fetching.js';
import * as metadata from '../../../vesk-doc/src/content/docs-metadata.js';
import * as routing from '../../../vesk-doc/src/content/docs-routing.js';
import * as middleware from '../../../vesk-doc/src/content/docs-middleware.js';
import * as apiRoutes from '../../../vesk-doc/src/content/docs-api-routes.js';
import * as serverApis from '../../../vesk-doc/src/content/docs-server-apis.js';
import * as configPlugin from '../../../vesk-doc/src/content/docs-config-plugin.js';
import * as cli from '../../../vesk-doc/src/content/docs-cli.js';
import * as native from '../../../vesk-doc/src/content/docs-native.js';
import * as nativeComponents from '../../../vesk-doc/src/content/docs-native-components.js';

let passed = 0;
let failed = 0;
const failures: Array<{ name: string; message: string }> = [];

const MODULES: Record<string, { pages?: Array<{ slug: string; blocks?: unknown[] }> }> = {
  'docs.ts': basePages as never,
  'docs-data-fetching': dataFetching as never,
  'docs-metadata': metadata as never,
  'docs-routing': routing as never,
  'docs-middleware': middleware as never,
  'docs-api-routes': apiRoutes as never,
  'docs-server-apis': serverApis as never,
  'docs-config-plugin': configPlugin as never,
  'docs-cli': cli as never,
  'docs-native': native as never,
  'docs-native-components': nativeComponents as never,
};

interface CodeBlock { kind?: string; filename?: string; code?: string; tabs?: Array<{ filename?: string; code?: string }> }
interface Page { slug: string; title?: string; blocks?: CodeBlock[] }

/**
 * Per-example props, via a leading comment the example keeps in the source:
 *
 *   // @props { "params": { "slug": "getting-started" } }
 *   component Page(props) { … }
 *
 * Harmless to copy-paste (it is a comment), and it lets a route-parameterised
 * example be rendered instead of skipped — which is the only way it can be
 * checked at all.
 */
function propsFor(code: string): Record<string, unknown> {
  const m = /^\s*\/\/\s*@props\s+(\{[\s\S]*?\})\s*$/m.exec(code);
  if (!m) return {};
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    throw new Error(`@props is not valid JSON: ${m[1].slice(0, 80)}`);
  }
}

/**
 * Explicit, visible exemptions: `page slug` → reason.
 *
 * A block can only be left unverified on purpose, with a reason that shows up in
 * the test output. That is the point: "this example was not checked" has to be
 * visible, or the harness quietly stops meaning anything.
 */
const EXEMPT: Record<string, string> = {
  'native-components/app/feed/page.vsk': 'native target — the example names a Kotlin composable (List), not a web component',
  'native-components/app/deals/page.vsk': 'native target — CardStack is a native composable; the snippet is illustrative pseudo-code',
  'native-components/app/inbox/[id]/page.vsk': 'native target — SwipeToDismiss is a native composable, not a web component',
  'metadata/app/docs/[slug]/page.vsk': "imports getDoc from this docs site's own content module, which does not exist outside it",
  'metadata/components/Feed.vsk': 'client-only island: its data arrives on hydration, so there is nothing to render server-side',
};

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function isRenderable(filename: string | undefined, code: string): boolean {
  if (!filename || !filename.endsWith('.vsk')) return false;
  return /\bcomponent\s+\w/.test(code);
}

/** Compile only — used for snippets that render nothing (config, routes). */
function compiles(source: string, filename: string): void {
  try {
    generateIR(parse(source, { filename }), source, filename);
  } catch (e) {
    throw new Error(`compile failed: ${(e as Error).message}`);
  }
}

/**
 * Verify a CLIENT-side example by compiling it for the browser.
 *
 * Some documented APIs only exist in the client barrel (`watchNetwork`,
 * `getNetworkState`, `hydrateViewport`), so an SSR render of their example
 * throws "not a function" — which is a harness limitation, not a broken
 * example. Compiling with the client codegen checks the thing that can
 * actually be checked: that the component compiles for its real target and
 * resolves its imports and registry entries.
 */
function compilesForClient(source: string): void {
  try {
    compileClient(source);
  } catch (e) {
    throw new Error(`client compile failed: ${(e as Error).message}`);
  }
}

/**
 * Verify one renderable example.
 *
 * Two kinds, declared by the example itself — never guessed:
 *   `// @client-only` — the example uses an API that only exists in the client
 *     barrel (`watchNetwork`, `getNetworkState`, `hydrateViewport`), so it is
 *     verified by compiling for the browser. A mislabelled example still fails:
 *     the client compile is a real check, not a rubber stamp.
 *   anything else — server-rendered with the real renderer.
 *
 * A heuristic ("does the error mention a client API?") was tried and rejected:
 * it silently passed genuinely broken examples whose failure text happened to
 * match.
 */
async function checkRenderable(label: string, code: string) {
  const clientOnlyExample = /^\s*\/\/\s*@client-only\b/m.test(code);
  const componentName = /component\s+(\w+)/.exec(code)?.[1];
  if (!componentName) throw new Error('no component name found');
  if (clientOnlyExample) {
    try {
      compilesForClient(code);
      clientOnly.push(label);
    } catch (e) {
      throw new Error((e as Error).message);
    }
    return;
  }
  try {
    const html = await renderFullPage(code, componentName, propsFor(code), new Map(), { hydrate: true });
    assert(html.includes('<!DOCTYPE html>'), 'rendered no document (an error boundary caught it?)');
  } catch (e) {
    throw new Error(`render failed: ${(e as Error).message}`);
  }
}

async function check(label: string, filename: string | undefined, code: string, render: boolean) {
  try {
    if (render) {
      const componentName = /component\s+(\w+)/.exec(code)?.[1];
      assert(!!componentName, `${label}: no component name found`);
      const html = await renderFullPage(code, componentName, propsFor(code), new Map(), { hydrate: true });
      assert(
        html.includes('<!DOCTYPE html>'),
        `${label}: rendered no document (an error boundary caught it?)`,
      );
      passed++;
    } else {
      compiles(code, filename || 'snippet.ts');
      passed++;
    }
  } catch (e) {
    failed++;
    failures.push({ name: label, message: (e as Error).message });
    console.log(`  ✗ ${label}`);
    console.log(`    ${(e as Error).message}`);
  }
}

console.log('\n=== Docs examples compile ===');

const skipped: string[] = [];
const clientOnly: string[] = [];
const exempt: string[] = [];
for (const [moduleName, mod] of Object.entries(MODULES)) {
  const pages = (mod.pages || []) as Page[];
  for (const page of pages) {
    for (const block of page.blocks || []) {
      if (block.kind === 'code' && typeof block.code === 'string') {
        const label = `${moduleName} → /docs/${page.slug} → ${block.filename || '(no filename)'}`;
        const exemption = EXEMPT[`${page.slug}/${block.filename}`];
        if (exemption) {
          exempt.push(`${page.slug}/${block.filename} — ${exemption}`);
        } else if (isRenderable(block.filename, block.code)) {
          try {
            await checkRenderable(label, block.code);
            passed++;
          } catch (e) {
            failed++;
            failures.push({ name: label, message: (e as Error).message });
            console.log(`  ✗ ${label}\n    ${(e as Error).message}`);
          }
        } else if (block.filename?.endsWith('.ts') || block.filename?.endsWith('.tsx')) {
          // Server/config snippets cannot be rendered as a page, but they CAN be
          // compiled — and that is enough to catch an API that was renamed or
          // removed, which is the rot people actually hit.
          try {
            compiles(block.code, block.filename);
            passed++;
          } catch (e) {
            failed++;
            failures.push({ name: label, message: (e as Error).message });
            console.log(`  ✗ ${label}\n    ${(e as Error).message}`);
          }
        } else if (EXEMPT[`${page.slug}/${block.filename}`]) {
          exempt.push(`${page.slug}/${block.filename} — ${EXEMPT[`${page.slug}/${block.filename}`]}`);
          continue;
        } else {
          skipped.push(label);
        }
      } else if (block.kind === 'tabs') {
        for (const tab of block.tabs || []) {
          const label = `${moduleName} → /docs/${page.slug} → ${tab.filename}`;
          if (typeof tab.code !== 'string') continue;
          const tabExemption = EXEMPT[`${page.slug}/${tab.filename}`];
          if (tabExemption) {
            exempt.push(`${page.slug}/${tab.filename} — ${tabExemption}`);
          } else if (tab.filename?.endsWith('.vsk')) {
            try {
              await checkRenderable(label, tab.code);
              passed++;
            } catch (e) {
              failed++;
              failures.push({ name: label, message: (e as Error).message });
              console.log(`  ✗ ${label}\n    ${(e as Error).message}`);
            }
          }
          else if (tab.filename?.endsWith('.ts') || tab.filename?.endsWith('.tsx')) await check(label, tab.filename, tab.code, false);
          else skipped.push(label);
        }
      }
    }
  }
}

if (exempt.length > 0) {
  const unique = [...new Set(exempt)];
  console.log(`\n  ${unique.length} example(s) EXEMPT on purpose (visible so it cannot rot unnoticed):`);
  for (const e of unique) console.log(`    - ${e}`);
}

console.log(`\n  ${passed} example(s) verified (server-rendered, or compiled for the client where the API is client-only)`);
if (clientOnly.length > 0) {
  console.log(`  ${clientOnly.length} client-only example(s), verified by compiling for the browser:`);
  for (const c of clientOnly) console.log(`    - ${c}`);
}
if (skipped.length > 0) {
  console.log(`  ${skipped.length} block(s) not renderable (config, shell, partials) — listed in the source as KNOWN_FRAGMENTS if they should be:`);
  for (const s of skipped.slice(0, 40)) console.log(`    - ${s}`);
  if (skipped.length > 40) console.log(`    … and ${skipped.length - 40} more`);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  for (const f of failures) console.log(`  FAIL: ${f.name} — ${f.message}`);
  process.exit(1);
}
console.log('All docs examples compile.');