/**
 * Render-plugin hooks: onHead / onHtml live-hook integration and the
 * build-time-baked headExtra path across renderFullPage / renderPageStream /
 * ssg. Covers both expression-mode and statement-mode component bodies.
 *
 * Run: npx tsx packages/compiler/src/render-plugins.test.ts
 */

import {
  renderFullPage,
  renderPageStream,
  ssg,
  applyHeadPlugins,
  applyHtmlPlugins,
} from '@vesk/compiler/src/server-codegen';
import type { VeskPlugin } from '@vesk/types';

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void | Promise<void>) {
  (async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${(e as Error).message}`);
    }
  })().then(() => {
    if (passed + failed === PLAN) {
      console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
      process.exit(failed > 0 ? 1 : 0);
    }
  });
}

let PLAN = 0;
function plan(n: number) {
  PLAN = n;
}

const pageExpr = `import Head from '@vesk/runtime'; import type { Component } from '@vesk/types';

const greet = () => 'Hello';
component App(props: { name?: string }) {
  <Head><title>Page Title</title></Head>
  return (
    <article>
      <p>{greet()} {props.name as string}</p>
    </article>
  );
}`;

const pageStmt = `import Head from '@vesk/runtime';

const items = ['a', 'b'];
component App(props: { name?: string }) {
  <Head><title>Stmt Title</title></Head>
  <article>
    if (items.length > 0) {
      <p>{props.name as string}</p>
    }
  </article>
}`;

function headInjector(tag: string): VeskPlugin {
  return {
    name: 'test-head',
    async onHead(head) {
      return head.includes('font-awesome') ? head : head + '\n\t' + tag;
    },
  };
}

const pluginOnHtml: VeskPlugin = {
  name: 'test-html',
  async onHead(head) {
    return head + '\n\t<meta name="html-hook-sees-head" content="yes" />';
  },
  async onHtml(html) {
    return html.replace('<body>', '<body data-plugin="1">');
  },
};

const PLUGIN_MANIFEST = '<link rel="manifest" href="/manifest.webmanifest" />';
const PLUGIN_THEME = '<meta name="theme-color" content="#4f46e5" />';
const PLUGIN_SCRIPT = '<script src="/pwa-init.js" defer></script>';

const pwaLike: VeskPlugin = {
  name: 'pwa-like',
  async onHead(head) {
    const out: string[] = [];
    const lines = head.split('\n');
    if (!lines.some((l) => l.includes('rel="manifest"'))) out.push('\t' + PLUGIN_MANIFEST);
    if (!lines.some((l) => l.includes('name="theme-color"'))) out.push('\t' + PLUGIN_THEME);
    if (!lines.some((l) => l.includes('pwa-init.js'))) out.push('\t' + PLUGIN_SCRIPT);
    if (out.length === 0) return head;
    return head + '\n' + out.join('\n');
  },
};

async function runStream(src: string, comp: string, opts: Record<string, unknown>): Promise<string> {
  let out = '';
  const stream = renderPageStream(src, comp, {}, new Map(), opts);
  for await (const chunk of stream) out += chunk;
  return out;
}

plan(16);

it('applyHeadPlugins chains hooks in config order and honors null-keep', async () => {
  const calls: string[] = [];
  const plugins = [
    { name: 'a', async onHead(h: string) { calls.push('a'); return h + '\n\t<meta name="a" content="1" />'; } },
    { name: 'b', async onHead() { calls.push('b'); return null; } },
    { name: 'c', async onHead(h: string) { calls.push('c'); return h + '\n\t<meta name="c" content="3" />'; } },
  ] as VeskPlugin[];
  const out = await applyHeadPlugins('<title>A</title>', plugins, { url: '/x' });
  if (!out.includes('name="a"')) throw new Error('first hook not applied');
  if (!out.includes('name="c"')) throw new Error('third hook not applied');
  if (calls.join(',') !== 'a,b,c') throw new Error(`config order broken: ${calls.join(',')}`);
  if (out.includes('b"')) throw new Error('null-keep should not append');
});

it('applyHeadPlugins/applyHtmlPlugins return input unchanged without plugins', async () => {
  const h = await applyHeadPlugins('<title>T</title>', undefined, {});
  const x = await applyHtmlPlugins('<!DOCTYPE html><html><body>y</body></html>', null, {});
  if (h !== '<title>T</title>') throw new Error('head changed without plugins');
  if (x !== '<!DOCTYPE html><html><body>y</body></html>') throw new Error('html changed without plugins');
});

it('renderFullPage (expression mode): onHead + onHtml hooks run', async () => {
  const html = await renderFullPage(pageExpr, 'App', { name: 'W' }, new Map(), {
    hydrate: true,
    plugins: [pwaLike, pluginOnHtml],
  });
  if (!html.includes('<title>Page Title</title>')) throw new Error('page head missing');
  if (!html.includes(PLUGIN_MANIFEST)) throw new Error('manifest not injected');
  if (!html.includes(PLUGIN_THEME)) throw new Error('theme-color not injected');
  if (!html.includes('src="/pwa-init.js"')) throw new Error('init script not injected');
  if (!html.includes('data-plugin="1"')) throw new Error('onHtml did not rewrite body');
  if (!html.includes('name="html-hook-sees-head"')) throw new Error('onHtml did not receive plugin-extended head');
});

it('renderFullPage (statement mode): onHead + onHtml hooks run', async () => {
  const html = await renderFullPage(pageStmt, 'App', { name: 'W' }, new Map(), {
    hydrate: true,
    plugins: [pwaLike, pluginOnHtml],
  });
  if (!html.includes('<title>Stmt Title</title>')) throw new Error('statement-mode head missing');
  if (!html.includes(PLUGIN_MANIFEST)) throw new Error('manifest not injected in statement mode');
  if (!html.includes('data-plugin="1"')) throw new Error('onHtml not run in statement mode');
});

it('renderFullPage (statement mode / if): hooks run with guard-clause body', async () => {
  const src = `component App(props: { flag?: boolean }) {
  if (!props.flag) {
    return <p>none</p>;
  }
  <main><p>shown</p></main>
}`;
  const html = await renderFullPage(src, 'App', { flag: true }, new Map(), {
    hydrate: true,
    plugins: [headInjector('<meta name="late-hook" content="1" />')],
  });
  if (!html.includes('shown')) throw new Error('statement body not rendered');
  if (html.includes('<p>none</p>')) throw new Error('guard clause returned wrong branch');
  if (!html.includes('<meta name="late-hook"')) throw new Error('head hook not applied');
});

it('renderFullPage dedups headExtra against page-provided tags', async () => {
  const extra = PLUGIN_MANIFEST + '\n' + '<meta name="description" content="layout-desc" />';
  const html = await renderFullPage(pageExpr, 'App', { name: 'W' }, new Map(), {
    hydrate: true,
    headExtra: extra,
  });
  const manifestCount = (html.match(/rel="manifest"/g) || []).length;
  if (manifestCount !== 1) throw new Error(`manifest should appear once (got ${manifestCount})`);
  if (!html.includes('layout-desc')) throw new Error('headExtra unique tag missing');
});

it('renderFullPage: page head wins over headExtra title/meta', async () => {
  const extra = '<title>Extra Title</title>\n<meta name="description" content="extra-desc" />';
  const pageWithDesc = `component App { <Head><title>Page Title</title><meta name="description" content="page-desc" /></Head> <p>x</p> }`;
  const html = await renderFullPage(pageWithDesc, 'App', {}, new Map(), { hydrate: true, headExtra: extra });
  if (!html.includes('<title>Page Title</title>')) throw new Error('page title lost to headExtra');
  if (html.includes('Extra Title')) throw new Error('headExtra title leaked over page title');
  if (!html.includes('page-desc')) throw new Error('page description lost');
  if (html.includes('extra-desc')) throw new Error('headExtra description leaked over page description');
});

it('renderFullPage falls back to headExtra when no live plugins', async () => {
  const html = await renderFullPage(pageExpr, 'App', { name: 'W' }, new Map(), {
    hydrate: true,
    headExtra: PLUGIN_THEME,
  });
  if (!html.includes('name="theme-color" content="#4f46e5"')) throw new Error('headExtra not merged');
});

it('renderPageStream (expression): onHead applied, onHtml NOT called', async () => {
  let htmlCalls = 0;
  const plugins = [
    pwaLike,
    { name: 'no-html', async onHtml() { htmlCalls++; return null; } },
  ] as VeskPlugin[];
  const out = await runStream(pageExpr, 'App', { hydrate: true, plugins });
  if (!out.includes('<title>Page Title</title>')) throw new Error('page head missing in stream');
  if (!out.includes(PLUGIN_MANIFEST)) throw new Error('manifest not injected into stream head');
  if (!out.includes('src="/pwa-init.js"')) throw new Error('init script not injected into stream head');
  if (htmlCalls !== 0) throw new Error(`onHtml must not run on streamed docs (got ${htmlCalls})`);
});

it('renderPageStream (statement): head hooks run', async () => {
  const out = await runStream(pageStmt, 'App', { hydrate: true, plugins: [pwaLike] });
  if (!out.includes('<title>Stmt Title</title>')) throw new Error('statement-mode head missing in stream');
  if (!out.includes(PLUGIN_MANIFEST)) throw new Error('manifest not injected into statement-mode stream');
});

it('renderPageStream applies headExtra without live plugins', async () => {
  const out = await runStream(pageExpr, 'App', { hydrate: true, headExtra: PLUGIN_MANIFEST });
  if (!out.includes(PLUGIN_MANIFEST)) throw new Error('headExtra not merged into stream head');
});

it('ssg (expression): live plugins applied to head + html', async () => {
  const result = await ssg(pageExpr, 'App', { name: 'W' }, { plugins: [pwaLike, pluginOnHtml] });
  if (!result.html.includes(PLUGIN_MANIFEST)) throw new Error('manifest not injected in ssg');
  if (!result.html.includes('data-plugin="1"')) throw new Error('onHtml not run in ssg');
  if (!result.html.includes('<title>Page Title</title>')) throw new Error('page head missing in ssg');
});

it('ssg (statement): live plugins applied', async () => {
  const result = await ssg(pageStmt, 'App', { name: 'W' }, { plugins: [pwaLike] });
  if (!result.html.includes(PLUGIN_MANIFEST)) throw new Error('manifest not injected in ssg statement mode');
  if (!result.html.includes('<title>Stmt Title</title>')) throw new Error('statement-mode head missing in ssg');
});

it('ssg applies headExtra without live plugins', async () => {
  const result = await ssg(pageExpr, 'App', { name: 'W' }, { headExtra: PLUGIN_THEME });
  if (!result.html.includes('name="theme-color" content="#4f46e5"')) throw new Error('headExtra not merged in ssg');
});

it('onHead hooks are chained: later hook sees earlier hook output', async () => {
  const plugins = [
    { name: 'first', async onHead(h: string) { return h + '\n\t<meta name="one" content="1" />'; } },
    { name: 'second', async onHead(h: string) {
      if (!h.includes('name="one"')) throw new Error('second hook did not see first hook output');
      return h + '\n\t<meta name="two" content="2" />';
    } },
  ] as VeskPlugin[];
  const html = await renderFullPage(pageExpr, 'App', { name: 'W' }, new Map(), { hydrate: true, plugins });
  if (!html.includes('name="one"') || !html.includes('name="two"')) throw new Error('chained hooks incomplete');
});

it('null from onHead keeps prior head; onHtml return null keeps doc', async () => {
  const plugins = [
    { name: 'head-null', async onHead() { return null; } },
    { name: 'html-null', async onHtml() { return null; } },
  ] as VeskPlugin[];
  const html = await renderFullPage(pageExpr, 'App', { name: 'W' }, new Map(), { hydrate: true, plugins });
  if (!html.includes('<title>Page Title</title>')) throw new Error('head dropped by null hook');
  if ((html.match(/<body>/g) || []).length !== 1) throw new Error('html mangled by null hook');
});

setTimeout(() => {
  // Safety net: the async runner resolves everything without hanging forever.
}, 12000).unref();