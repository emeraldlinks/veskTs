import { parseHTML } from 'linkedom';
import { compileClient } from '/root/vesk/packages/compiler/src/client-codegen';
import { renderPage } from '/root/vesk/packages/compiler/src/server-codegen';
// runtime is pulled via the esbuild plugin below (source), same as the probe
import { build, type Plugin } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RT = join(process.cwd(), 'packages/runtime/src');
const plugin: Plugin = {
  name: 'rt', setup(b) {
    b.onResolve({ filter: /^@vesk\/runtime/ }, (args) => {
      const rest = args.path.replace('@vesk/runtime', '');
      const rel = rest.startsWith('/') ? rest.slice(1) : '';
      let file = rel;
      if (file.startsWith('src/')) file = file.slice(4);
      return { path: join(RT, file ? file + '.ts' : 'index-client.ts') };
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

const SOURCE = `export default component App(props: { items: { id: number, name: string }[] }) {
  <ul class="list">
    {props.items.map((item) => <li key={item.id} data-id={item.id} class="row"><b>{item.id}</b><span>{item.name}</span></li>)}
  </ul>
}`;

async function scenario(label: string, ssrCount: number, hydCount: number) {
  const ssrItems = Array.from({ length: ssrCount }, (_, i) => ({ id: i + 1, name: 'SSR' + (i + 1) }));
  const hydItems = Array.from({ length: hydCount }, (_, i) => ({ id: i + 1, name: 'CLI' + (i + 1) }));
  const client = compileClient(SOURCE, 'App', { hydrate: true, forceClient: true, markerless: true });
  const ssr = await renderPage(SOURCE, 'App', { items: ssrItems }, new Map(), { hydrate: true, markerless: true });
  const dir = mkdtempSync(join(tmpdir(), 'repro-'));
  writeFileSync(join(dir, 'app.mjs'), client);
  writeFileSync(join(dir, 'driver.mjs'),
    `import { hydrate, setHydrateDevMode } from '@vesk/runtime';
import App from './app.mjs';
setHydrateDevMode(false);
const c = document.getElementById('host');
hydrate(c, App, { items: ${JSON.stringify(hydItems)} });
const lis = [...c.querySelectorAll('li')];
window.__out = {
  lis: lis.map((li) => ({ id: li.getAttribute('data-id'), name: li.querySelector('span').textContent, probe: li.__probeId })),
  comments: (() => { const cs = document.createTreeWalker(c, 0x80, { acceptNode: () => 1 }); let n; const a = []; while ((n = cs.nextNode())) a.push(n.textContent); return a; })(),
};`
  );
  const res = await build({ entryPoints: [join(dir, 'driver.mjs')], bundle: true, platform: 'neutral', format: 'esm', write: false, logLevel: 'silent', plugins: [plugin] });
  writeFileSync(join(dir, 'out-bundled.mjs'), res.outputFiles[0].text);
  const { document, window } = parseHTML(`<!DOCTYPE html><html><body><div id="host">${ssr.body}</div></body></html>`);
  const pre = [...document.getElementById('host').querySelectorAll('li')] as Array<Element & { __probeId: number }>;
  pre.forEach((li, i) => { li.__probeId = i + 1; });
  const g = globalThis as any;
  const saved: Record<string, unknown> = {};
  for (const k of ['document', 'window', 'location']) { if (g[k] !== undefined) saved[k] = g[k]; }
  g.document = document; g.window = window; g.location = { href: 'http://localhost/' };
  try { await import(pathToFileURL(join(dir, 'out-bundled.mjs')).href + `?t=${Date.now()}`); }
  catch (e) { console.log(`  [${label}] THREW`, String((e as Error).message).slice(0, 200)); restore(saved); rmSync(dir, { recursive: true, force: true }); return; }
  restore(saved);
  rmSync(dir, { recursive: true, force: true });
  const r = (window as any).__out;
  console.log(`  [${label}] lis=`, JSON.stringify(r.lis));
  console.log(`  [${label}] comments=`, JSON.stringify(r.comments));
}
function restore(saved: Record<string, unknown>) {
  const g = globalThis as any;
  for (const [k, v] of Object.entries(saved)) g[k] = v;
  for (const k of ['document', 'window', 'location']) if (!(k in saved)) delete g[k];
}

(async () => {
  await scenario('surplus (ssr2/hyd3)', 2, 3);
  await scenario('matching (ssr3/hyd3)', 3, 3);
  await scenario('shrink (ssr3/hyd1)', 3, 1);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(2); });
