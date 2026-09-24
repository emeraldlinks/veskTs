import { renderPage } from '/root/vesk/test-app/node_modules/@vesk/compiler/dist/server-codegen.js';
import { __vskMarkerless, __vskHydrate } from '/root/vesk/test-app/node_modules/@vesk/compiler/dist/server-utils.js';

const src = `import { Link } from '@vesk/runtime/router';
component App(props: { name: string }) {
	const &[n] = track(0);
	return <div><p>{props.name}</p><Link href="/">home {n}</Link></div>;
}`;

console.log('before: markerless=', __vskMarkerless, 'hydrate=', __vskHydrate);
const r = await renderPage(src, 'App', { name: 'W' }, new Map(), { hydrate: true });
console.log('after: markerless=', __vskMarkerless, 'hydrate=', __vskHydrate);
console.log('BODY:', JSON.stringify(r.body));
console.log('has-marker:', /<!--vsk/.test(r.body));