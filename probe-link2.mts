import { Link, NavLink } from '@vesk/runtime/src/router';

const saved = globalThis.document;
delete globalThis.document;
(globalThis as any).__vsk_ssr_markerless = true;
console.log('flag:', (globalThis as any).__vsk_ssr_markerless, 'doc:', typeof document);
console.log('Link OUT:', JSON.stringify(Link({ href: '/docs/x', class: 'nav', children: '<span>go</span>' })));
console.log('NavLink OUT:', JSON.stringify(NavLink({ href: '/b' }, undefined, undefined)));
globalThis.document = saved;