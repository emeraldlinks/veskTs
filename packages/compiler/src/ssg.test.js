import { ssg } from './server-codegen.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
	try {
		await fn();
		passed++;
		console.log(`  ✓ ${name}`);
	} catch (e) {
		failed++;
		console.log(`  ✗ ${name} — ${e.message}`);
	}
}

function extractDataScript(html) {
	const start = html.indexOf('__vesk_props = ');
	if (start === -1) return null;
	const valStart = start + '__vesk_props = '.length;
	// Find the closing ; of the script tag
	const end = html.indexOf(';', valStart);
	if (end === -1) return null;
	const raw = html.slice(valStart, end);
	try { return JSON.parse(raw); } catch { return null; }
}

function hasHydrationMarkers(html) {
	return /<!--vsk-->/.test(html);
}

function hasClientCode(html) {
	return html.includes('__components') || html.includes('__hydrate');
}

(async () => {
	// Basic SSG — no getStaticProps
	await test('basic SSG', async () => {
		const src = `export component App {
			return <div>Hello SSG</div>
		}`;
		const result = await ssg(src);
		const { html, props, clientCode } = result;
		if (typeof html !== 'string' || typeof props !== 'string' || typeof clientCode !== 'string') throw new Error('ssg() missing return fields');
		if (!html.includes('Hello SSG')) throw new Error('SSG HTML missing rendered content');
		if (!html.includes('__vesk_props')) throw new Error('SSG HTML missing data script');
		const data = extractDataScript(html);
		if (JSON.stringify(data) !== '{}') throw new Error('SSG data script wrong: ' + JSON.stringify(data));
		// Zero-JS page: no hydration markers needed (page is fully static)
	});

	// Zero-JS: static page emits no client script
	await test('static page ships zero JS', async () => {
		const src = `export component StaticPage {
			return <div>No JS needed</div>
		}`;
		const result = await ssg(src);
		const { html, clientCode } = result;
		if (clientCode !== '') throw new Error('Static page should have empty clientCode, got: ' + JSON.stringify(clientCode));
		if (html.includes('<script>__components')) throw new Error('Static page should not have client script tag');
		if (!html.includes('No JS needed')) throw new Error('Static page HTML missing content');
	});

	// SSG with custom props
	await test('SSG with custom props', async () => {
		const src = `export component Greeting(props: { name: string }) {
			return <div>Hello {props.name}</div>
		}`;
		const result = await ssg(src, null, { name: 'World' });
		const { html, props } = result;
		if (!html.includes('Hello World')) throw new Error('SSG custom props not rendered');
		const data = extractDataScript(html);
		if (data.name !== 'World') throw new Error('SSG custom props in data wrong: ' + JSON.stringify(data));
		if (props !== JSON.stringify({ name: 'World' })) throw new Error('SSG props string wrong: ' + props);
	});

	// SSG with getStaticProps (sync)
	await test('SSG with sync getStaticProps', async () => {
		const src = `export function getStaticProps() {
			return { props: { items: [1, 2, 3] } };
		}
		export component List(props: { items: number[] }) {
			return <ul>{props.items.map(i => <li>{i}</li>)}</ul>
		}`;
		const result = await ssg(src);
		const { html, props } = result;
		if (!html.includes('>1<') || !html.includes('>3<')) throw new Error('SSG getStaticProps not rendered');
		const data = extractDataScript(html);
		if (!Array.isArray(data.items) || data.items.length !== 3) throw new Error('SSG getStaticProps data wrong: ' + JSON.stringify(data));
		if (props !== JSON.stringify({ items: [1, 2, 3] })) throw new Error('SSG getStaticProps props string wrong: ' + props);
	});

	// SSG with getStaticProps (async)
	await test('SSG with async getStaticProps', async () => {
		const src = `export async function getStaticProps() {
			return { props: { message: 'async' } };
		}
		export component AsyncPage(props: { message: string }) {
			return <p>{props.message}</p>
		}`;
		const result = await ssg(src);
		const { html, props } = result;
		if (!html.includes('async')) throw new Error('SSG async getStaticProps not rendered');
		const data = extractDataScript(html);
		if (data.message !== 'async') throw new Error('SSG async getStaticProps data wrong: ' + JSON.stringify(data));
	});

	// SSG auto-detects default export
	await test('SSG auto-detects default export', async () => {
		const src = `export default component Main {
			return <h1>Default</h1>
		}`;
		const result = await ssg(src);
		const { html } = result;
		if (!html.includes('Default')) throw new Error('SSG auto-detect default export failed');
	});

	// SSG auto-detects first exported component
	await test('SSG auto-detects first exported', async () => {
		const src = `export component A { return <p>A</p> }
		export component B { return <p>B</p> }`;
		const result = await ssg(src);
		const { html } = result;
		if (!html.includes('A')) throw new Error('SSG auto-detect first exported failed');
	});

	// SSG error on no component
	await test('SSG throws on no component', async () => {
		try {
			await ssg(`export function getStaticProps() { return { props: {} } }`);
			throw new Error('Expected SSG to throw with no component');
		} catch {
			// expected
		}
	});

	console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
	if (failed > 0) process.exit(1);
	console.log('All SSG tests passed!');
})();
