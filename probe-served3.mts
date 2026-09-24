import { renderPage } from '/root/vesk/packages/compiler/src/server-render.ts';

const src = `import { Link } from '@vesk/runtime/router';
component App(props: { name: string }) {
	const &[n] = track(0);
	return <div><p>{props.name}</p><Link href="/">home {n}</Link></div>;
}`;

const r = await renderPage(src, 'App', { name: 'W' }, new Map(), { hydrate: true });
console.log('BODY:', JSON.stringify(r.body));
console.log('has-marker:', /<!--vsk/.test(r.body));