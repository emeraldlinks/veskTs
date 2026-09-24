import { Link } from '/root/vesk/packages/runtime/src/router-components.ts';

const saved = (globalThis as any).document;
(globalThis as any).document = undefined;
(globalThis as any).__vsk_ssr_markerless = true;
console.log('global after set:', (globalThis as any).__vsk_ssr_markerless, typeof (globalThis as any).document);
const out = Link({ href: '/docs/x', class: 'nav', children: '<span>go</span>' });
console.log('OUT:', JSON.stringify(out));
(globalThis as any).document = saved;