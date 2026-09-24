import { renderPage } from '/root/vesk/packages/compiler/src/server-render.ts';

const src = `import { Link } from '@vesk/runtime/router';
component App(props: { name: string }) {
	return <div><p>{props.name}</p><Link href="/">home</Link><Link href="/a">a</Link></div>;
}`;

const marker = await renderPage(src, 'App', { name: 'W' }, new Map(), { hydrate: true, markerless: false });
console.log('MARKER MODE BODY:', JSON.stringify(marker.body));
const clean = await renderPage(src, 'App', { name: 'W' }, new Map(), { hydrate: true });
console.log('MARKERLESS BODY:', JSON.stringify(clean.body));