import { parseHTML } from 'linkedom';
import { reconcileHydrated } from '/root/vesk/packages/runtime/src/reconcile';
import { createHydrateWalker } from '/root/vesk/packages/runtime/src/hydrate';

type Item = { id: number; name: string };
const items: Item[] = [
  { id: 1, name: 'N1' },
  { id: 2, name: 'N2' },
  { id: 3, name: 'N3' },
];
const ssrLis = items.map((it) => `<li data-id="${it.id}" class="row"><b>${it.id}</b><span>${it.name}</span></li>`).join('');

const { document, window } = parseHTML(`<!DOCTYPE html><html><body><div id="host"><ul id="ul">${ssrLis}</ul></div></body></html>`);
const g = globalThis as any;
const saved: Record<string, unknown> = {};
for (const k of ['document', 'window', 'location']) if (g[k] !== undefined) saved[k] = g[k];
g.document = document; g.window = window; g.location = { href: 'http://localhost/' };

const host = document.getElementById('host');
const w: any = createHydrateWalker(host);
const ul = w.nextElement('ul');
const region = w.subWalker(ul);
const mapC = document.createComment('map');
const endC = document.createComment('map-end');
const PROBES = new Map<number, Element>();
const lis0 = [...ul.querySelectorAll('li')];
lis0.forEach((li, i) => PROBES.set(Number(li.getAttribute('data-id')), li));

const createItem = (item: Item, _i: number, effs: unknown[], __root: Element | null) => {
  let root = __root || region.nextElement('li');
  const sub = region.subWalker(root);
  const b = sub.nextElement('b');
  const span = sub.nextElement('span');
  const setT = (el: Element, v: string) => {
    const tn = document.createTextNode(String(v));
    if (el.firstChild) el.replaceChild(tn, el.firstChild); else el.appendChild(tn);
  };
  setT(b, String(item.id));
  setT(span, item.name);
  if (root.parentNode == null) ul.appendChild(root);
  void effs;
};

const reconciler = reconcileHydrated(mapC, endC, items, (it) => String(it.id), createItem, region, ul);

const dump = (label: string) => {
  const lis = [...ul.querySelectorAll('li')];
  console.log(`  [${label}] lis=`, JSON.stringify(lis.map((li: Element) => ({ id: li.getAttribute('data-id'), name: li.querySelector('span')?.textContent, probe: li.getAttribute('data-id') }))));
  console.log(`  [${label}] markup=`, (ul as any).toString().slice(0, 400));
};

dump('initial');
reconciler([...items]);
dump('after no-op reconcile');

// Reorder: reconcile with reversed list — nodes must be MOVED, not rebuilt.
for (const k of [...PROBES.keys()]) {
  const el = PROBES.get(k)!;
  (el as any).__probeId = k;
}
reconciler([items[2], items[1], items[0]]);
dump('after reorder [3,2,1]');
const post = [...ul.querySelectorAll('li')];
const probes = (post as Array<Element & { __probeId: number }>).map((li) => li.__probeId).join(',');
console.log(`  [reorder] probes survived (moved, not rebuilt): ${probes}`);

// Shrink from 3 to 1.
// Grow back from 2 to 3.
reconciler([items[1], items[2]]);
dump('after shrink [2,3]');

for (const k of ['document', 'window', 'location']) if (!(k in saved)) delete g[k];
for (const [k, v] of Object.entries(saved)) g[k] = v;
process.exit(0);
