// Headless markerless hydration probe — keyed map identity (Phase 3d).
// Renders markerless SSR, hydrates the compiled client bundle against a
// linkedom DOM, and reports SSR plainness + node identity after hydration.
import { parseHTML } from 'linkedom';
import { build, type Plugin } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileClient } from '@vesk/compiler/src/client-codegen';
import { renderPage } from '@vesk/compiler/src/server-codegen';

const RT = join(process.cwd(), 'packages/runtime/src');
const vskRuntime: Plugin = {
  name: 'vsk-runtime',
  setup(b) {
    b.onResolve({ filter: /^@vesk\/runtime/ }, (args) => {
      const rest = args.path.slice('@vesk/runtime'.length);
      const rel = rest.startsWith('/') ? rest.slice(1) : '';
      let file = rel;
      if (file.startsWith('src/')) file = file.slice(4);
      const full = join(RT, file ? file + '.ts' : 'index-client.ts');
      return { path: full };
    });
    b.onResolve({ filter: /^\.\.?\// }, (args) => ({ path: join(args.resolveDir, args.path) }));
    b.onLoad({ filter: /\.ts$/ }, async (args) => {
      const { readFileSync } = await import('node:fs');
      const { transform } = await import('esbuild');
      const src = readFileSync(args.path, 'utf8');
      const out = await transform(src, { loader: 'ts', target: 'es2022', tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: false, legacyDecorators: true } } });
      return { contents: out.code, loader: 'js' };
    });
  },
};

const inspect = process.argv.includes('--inspect');
let failures = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  const status = cond ? 'ok' : 'FAIL';
  if (!cond) failures++;
  console.log(`  ${status}: ${label}${cond && inspect ? ` ${extra}` : ''}`);
};

const SOURCE = `
component ItemRow(props: { id: number, name: string }) {
  <li data-id={props.id} class="row"><b>{props.id}</b><span>{props.name}</span></li>
}
export default component App(props: { items: { id: number, name: string }[] }) {
  <ul class="list">
    {props.items.map((item) => <ItemRow key={item.id} id={item.id} name={item.name} />)}
  </ul>
}
`;

const SHUFFLE_SOURCE = `
export default component App(props: { items: { id: number, name: string }[] }) {
  const &[items] = track(props.items);
  <div>
    <button id="shuffle" onclick={() => items = [...items].reverse()}>shuffle</button>
    <ul class="list">
      {items.map((item) => <li key={item.id} data-id={item.id} class="row"><b>{item.id}</b><span>{item.name}</span></li>)}
    </ul>
  </div>
}
`;

function stashGlobals(): Record<string, unknown> {
  const g = globalThis as any;
  const s: Record<string, unknown> = {};
  if (g.document !== undefined) s.document = g.document;
  if (g.window !== undefined) s.window = g.window;
  if (g.location !== undefined) s.location = g.location;
  return s;
}
function setGlobals(document: unknown, window: unknown) {
  const g = globalThis as any;
  g.document = document;
  g.window = window;
  g.location = { href: 'http://localhost/' };
}
function restoreGlobals(saved: Record<string, unknown>) {
  const g = globalThis as any;
  for (const [k, v] of Object.entries(saved)) g[k] = v;
  for (const k of ['document', 'window', 'location']) if (!(k in saved)) delete g[k];
}

async function runCase(name: string, items: { id: number; name: string }[], ssrItems?: { id: number; name: string }[]) {
  const ssrProps = ssrItems ?? items;
  const client = compileClient(SOURCE, 'App', { hydrate: true, forceClient: true, markerless: true });
  const ssr = await renderPage(SOURCE, 'App', { items: ssrProps }, new Map(), { hydrate: true, markerless: true });
  ok(`[${name}] SSR plain (no vsk/comment/data-vsk)`, !/<!--|vsk|data-vsk/.test(ssr.body));

  const dir = mkdtempSync(join(tmpdir(), 'vsk-key-'));
  writeFileSync(join(dir, 'app.mjs'), client);
  writeFileSync(
    join(dir, 'driver.mjs'),
    `import { hydrate, setHydrateDevMode } from '@vesk/runtime';
import App from './app.mjs';
setHydrateDevMode(false);
const c = document.getElementById('host');
hydrate(c, App, { items: ${JSON.stringify(items)} });
`
  );
  const result = await build({
    entryPoints: [join(dir, 'driver.mjs')],
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    write: false,
    logLevel: 'silent',
    plugins: [vskRuntime],
  });
  writeFileSync(join(dir, 'out-bundled.mjs'), result.outputFiles[0].text);

  const { document, window } = parseHTML(`<!DOCTYPE html><html><body><div id="host">${ssr.body}</div></body></html>`);
  const pre = document.getElementById('host')
    ? ([...document.getElementById('host').querySelectorAll('li')] as Element[])
    : [];
  (pre as Array<Element & { __probeId: number }>).forEach((li, i) => { (li as Element & { __probeId: number }).__probeId = i + 1; });
  const saved = stashGlobals();
  setGlobals(document, window);
  try {
    await import(pathToFileURL(join(dir, 'out-bundled.mjs')).href + `?t=${Date.now()}`);
  } catch (e) {
    ok(`[${name}] hydrate ran`, false, `(error) ${String((e as Error).message).slice(0, 300)}`);
    console.error((e as Error).stack);
  } finally {
    restoreGlobals(saved);
    rmSync(dir, { recursive: true, force: true });
  }

  // Post-hydration DOM checks.
  const host = document.getElementById('host');
  if (inspect) {
    const cs = document.createTreeWalker(host, 0x80, { acceptNode: () => 1 });
    let n: Node | null = null;
    while ((n = cs.nextNode())) console.log('   comment:', JSON.stringify((n as Comment).textContent));
  }
  const lis = host ? [...host.querySelectorAll('li')] : [];
  ok(`[${name}] region items present (${lis.length} li)`, lis.length === items.length, lis.map((li: Element) => li.getAttribute('data-id')).join(','));
  const adopted = (lis as Array<Element & { __probeId: number }>).filter((li) => li.__probeId !== undefined).length;
  ok(`[${name}] SSR nodes adopted (node identity preserved: ${adopted}/${lis.length})`, adopted === Math.min(ssrProps.length, lis.length));
  if (inspect) console.log('   dom:', host ? (host as any).toString() : 'n/a'.slice(0, 200));
  return document;
}

(async () => {
  const items = [
    { id: 1, name: 'A' },
    { id: 2, name: 'B' },
    { id: 3, name: 'C' },
  ];
  await runCase('matching order', items);

  // Client surplus: SSR rendered 2 items, hydration inputs have 3. The two SSR
  // nodes are adopted (identity kept), the third renders fresh at the tail.
  await runCase('client surplus', items, items.slice(0, 2));

  // Interactive reorder-after-update: the keyed region is reactive; after
  // hydration a click reverses the list. Tier-2 (positional) first paint is
  // corrected on the first reactive update — nodes are MOVED, not recreated
  // (each keeps its __probeId), and bindings re-target to the keys.
  {
    const { items: hItems, expected } = { items, expected: '3,2,1' };
    const client = compileClient(SHUFFLE_SOURCE, 'App', { hydrate: true, forceClient: true, markerless: true });
    const ssr = await renderPage(SHUFFLE_SOURCE, 'App', { items: hItems }, new Map(), { hydrate: true, markerless: true });
    ok('[reorder] SSR plain (no vsk/comment/data-vsk)', !/<!--|vsk|data-vsk/.test(ssr.body));

    const dir = mkdtempSync(join(tmpdir(), 'vsk-key-'));
    writeFileSync(join(dir, 'app.mjs'), client);
    writeFileSync(
      join(dir, 'driver.mjs'),
      `import { hydrate, setHydrateDevMode, flushSync } from '@vesk/runtime';
import App from './app.mjs';
setHydrateDevMode(false);
const c = document.getElementById('host');
hydrate(c, App, { items: ${JSON.stringify(hItems)} });
const btn = document.getElementById('shuffle');
btn.dispatchEvent(new window.Event('click', { bubbles: true }));
flushSync();
const lis = [...c.querySelectorAll('li')];
const out = lis.map((li) => ({ id: li.getAttribute('data-id'), probe: li.__probeId, name: li.querySelector('span').textContent }));
const cs = document.createTreeWalker(c, 0x80, { acceptNode: () => 1 });
let cn; const cmts = [];
while ((cn = cs.nextNode())) cmts.push(cn.textContent);
window.__result = out;
window.__cmts = cmts;
`
    );
    const result = await build({
      entryPoints: [join(dir, 'driver.mjs')],
      bundle: true,
      platform: 'neutral',
      format: 'esm',
      write: false,
      logLevel: 'silent',
      plugins: [vskRuntime],
    });
    writeFileSync(join(dir, 'out-bundled.mjs'), result.outputFiles[0].text);

    const { document, window } = parseHTML(`<!DOCTYPE html><html><body><div id="host">${ssr.body}</div></body></html>`);
    const pre = [...document.getElementById('host').querySelectorAll('li')] as Array<Element & { __probeId: number }>;
    pre.forEach((li, i) => { li.__probeId = i + 1; });
    const saved = stashGlobals();
    setGlobals(document, window);
    let result2: unknown = null;
    try {
      await import(pathToFileURL(join(dir, 'out-bundled.mjs')).href + `?t=${Date.now()}`);
      result2 = (window as any).__result;
    } catch (e) {
      ok('[reorder] hydrate+shuffle ran', false, `(error) ${String((e as Error).message).slice(0, 300)}`);
    } finally {
      restoreGlobals(saved);
      rmSync(dir, { recursive: true, force: true });
    }
    const rows = result2 as { id: string; probe: number; name: string }[] | null;
    if (inspect) console.log('   result:', JSON.stringify(rows), 'comments:', JSON.stringify((window as any).__cmts));
    ok('[reorder] DOM order corrected on reactive update (ids ' + expected + ')', rows !== null && rows.map((r) => r.id).join(',') === expected, rows?.map((r) => r.id).join(','));

    // Identity: shuffle must MOVE the three SSR nodes, so all probes survive.
    const probes = (rows || []).map((r) => r.probe).sort((a, b) => a - b).join(',');
    ok('[reorder] nodes moved, not recreated (probes 1,2,3)', probes === '1,2,3', probes);
    // Bindings by tier-2 (positional) adopt: each adopted SSR node IS its key's
    // node (rendered with that key's data at hydrate), so a moved node keeps
    // its own key's content. probe1 node → key 1 (id 1), moved to the tail.
    const node1 = (rows || []).find((r) => r.probe === 1);
    ok('[reorder] bindings stay with their keys (probe1 renders id 1)', node1?.id === '1' && node1?.name === 'A', node1 ? `${node1.id}/${node1.name}` : '');
  }

  console.log(failures === 0 ? '\nALL OK' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  console.log('PROBE ERROR');
  process.exit(2);
});