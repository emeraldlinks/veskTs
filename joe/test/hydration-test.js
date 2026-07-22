import { Window } from 'happy-dom';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const appDir = resolve(__dirname, '..', 'app');
const veskDir = resolve(__dirname, '..', '.vesk');

let passed = 0;
let failed = 0;

function test(name, fn) {
	try { fn(); passed++; console.log(`  ✓ ${name}`); }
	catch (e) { failed++; console.log(`  ✗ ${name} — ${e.message}`); }
}

async function atest(name, fn) {
	try { await fn(); passed++; console.log(`  ✓ ${name}`); }
	catch (e) { failed++; console.log(`  ✗ ${name} — ${e.message}`); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

import { renderPage, renderFullPage } from '../../packages/compiler/src/server-codegen.js';

function ssr(componentPath, componentName, props = {}) {
	const src = readFileSync(resolve(appDir, componentPath), 'utf-8');
	return renderPage(src, componentName, props, new Map(), { hydrate: true });
}

function ssrFull(layoutPath, layoutName, props = {}) {
	const src = readFileSync(resolve(appDir, layoutPath), 'utf-8');
	return renderFullPage(src, layoutName, props, new Map(), { hydrate: true });
}

let clientCode = '';
try {
	clientCode = readFileSync(resolve(veskDir, 'static', 'client.js'), 'utf-8');
} catch {}

function setupDom(html) {
	const win = new Window();
	win.document.body.innerHTML = html;
	win.location.href = 'http://localhost/';
	win.location.pathname = '/';
	win.location.search = '';
	win.history.pushState = (_d, _t, url) => {
		const u = new URL(url, win.location.href);
		win.location.pathname = u.pathname;
		win.location.href = u.href;
	};
	win.history.replaceState = (_d, _t, url) => {
		const u = new URL(url, win.location.href);
		win.location.pathname = u.pathname;
		win.location.href = u.href;
	};
	globalThis.window = win;
	globalThis.document = win.document;
	globalThis.location = win.location;
	globalThis.history = win.history;
	globalThis.URL = URL;
	globalThis.alert = () => {};
	return win;
}

async function main() {
console.log('\n═══ Vesk Hydration & Routing Tests ═══\n');

// ═══════════════════════════════════════════════════════════════
// 1. SSR Hydration Markers
// ═══════════════════════════════════════════════════════════════
console.log('── SSR Hydration Markers ──');

test('Home page SSR has data-vsk on dynamic elements', () => {
	const home = ssr('page.vsk', 'Home');
	assert(home.body.includes('data-vsk="0"'));
	assert(home.body.includes('data-vsk="1"'));
	assert(home.body.includes('data-vsk="2"'));
	assert(home.body.includes('data-vsk="3"'));
});

test('static elements do not get data-vsk markers', () => {
	const home = ssr('page.vsk', 'Home');
	assert(!home.body.match(/<h1[^>]*data-vsk/), 'static h1 should not have data-vsk');
	assert(!home.body.match(/<p[^>]*data-vsk/), 'static p should not have data-vsk');
});

test('layout nav gets data-vsk (NavLink components are dynamic)', () => {
	const layoutSrc = readFileSync(resolve(appDir, 'layout.vsk'), 'utf-8');
	const layout = renderPage(layoutSrc, 'RootLayout', { children: '<p>test</p>' }, new Map(), { hydrate: true });
	assert(layout.body.includes('data-vsk="0"'), 'nav should have data-vsk');
	assert(layout.body.includes('data-vsk="1"'), 'main should have data-vsk');
});

test('About page has data-vsk on button', () => {
	const about = ssr('about/page.vsk', 'About');
	assert(about.body.includes('data-vsk'), 'button should have data-vsk');
});

test('full page with layout has mix of static and claimed content', () => {
	const home = ssr('page.vsk', 'Home');
	const full = ssrFull('layout.vsk', 'RootLayout', { children: home.body });
	const markers = full.match(/data-vsk/g);
	assert(markers && markers.length >= 4, 'should have data-vsk from layout + page');
});

// ═══════════════════════════════════════════════════════════════
// 2. Client Bundle Structure
// ═══════════════════════════════════════════════════════════════
console.log('\n── Client Bundle Structure ──');

test('bundle has hydrate primitives', () => {
	assert(clientCode.includes('__hydrate.nextElement'));
	assert(clientCode.includes('createHydrateWalker'));
});

test('bundle creates SPA router', () => {
	assert(clientCode.includes('createFileRouter'));
	assert(clientCode.includes('__routeTree'));
});

test('bundle has hydrateInitial for SSR hydration', () => {
	assert(clientCode.includes('hydrateInitial'));
});

test('compiled RootLayout uses nextElement and subWalker', () => {
	const idx = clientCode.indexOf('__components["RootLayout"]');
	const code = idx >= 0 ? clientCode.slice(idx, idx + 800) : '';
	assert(code.includes('__hydrate.nextElement'), 'should use nextElement');
	assert(code.includes('subWalker'), 'should use subWalker for children');
});

test('compiled Home uses nextElement for interactive elements', () => {
	const idx = clientCode.indexOf('__components["Home"]');
	const code = idx >= 0 ? clientCode.slice(idx, idx + 1200) : '';
	assert(code.includes('__hydrate.nextElement("div"'), 'should claim div');
	assert(code.includes('__hydrate.nextElement("button"'), 'should claim buttons');
	assert(code.includes('__hydrate.nextElement("span"'), 'should claim span');
});

// ═══════════════════════════════════════════════════════════════
// 3. Hydration DOM Claiming
// ═══════════════════════════════════════════════════════════════
console.log('\n── Hydration DOM Claiming ──');

await atest('createHydrateWalker claims elements in document order', async () => {
	const { createHydrateWalker } = await import('../../packages/runtime/src/hydrate.js');
	const home = ssr('page.vsk', 'Home');
	setupDom(`<div id="root">${home.body}</div>`);
	const root = document.getElementById('root');
	const els = Array.from(root.querySelectorAll('[data-vsk]'));
	assert(els.length === 4, '4 data-vsk elements before hydration');
	const walker = createHydrateWalker(root, els);
	const div = walker.nextElement('div');
	assert(div.getAttribute('class') === 'home-page');
	assert(!div.hasAttribute('data-vsk'), 'data-vsk removed');
	const btn1 = walker.nextElement('button');
	assert(btn1.getAttribute('data-testid') === 'counter-btn');
	const span = walker.nextElement('span');
	assert(span.getAttribute('data-testid') === 'counter-value');
	const btn2 = walker.nextElement('button');
	assert(btn2.getAttribute('data-testid') === 'reset-btn');
	assert(walker.done());
});

await atest('subWalker scopes to parent element', async () => {
	const { createHydrateWalker } = await import('../../packages/runtime/src/hydrate.js');
	const home = ssr('page.vsk', 'Home');
	const full = ssrFull('layout.vsk', 'RootLayout', { children: home.body });
	const m = full.match(/<body>([\s\S]*?)<\/body>/);
	setupDom(m ? m[1] : '');
	const root = document.getElementById('root');
	const allEls = Array.from(root.querySelectorAll('[data-vsk]'));
	const walker = createHydrateWalker(root, allEls);
	const nav = walker.nextElement('nav');
	assert(nav.tagName === 'NAV');
	const main = walker.nextElement('main');
	assert(main.tagName === 'MAIN');
	const sw = walker.subWalker(main);
	const pageDiv = sw.nextElement('div');
	assert(pageDiv.getAttribute('class') === 'home-page');
	assert(pageDiv.parentNode === main, 'page div inside main');
	sw.nextElement('button');
	sw.nextElement('span');
	sw.nextElement('button');
	assert(sw.done());
	assert(walker.done());
});

await atest('static elements survive hydration untouched', async () => {
	const { createHydrateWalker } = await import('../../packages/runtime/src/hydrate.js');
	const home = ssr('page.vsk', 'Home');
	setupDom(`<div id="root">${home.body}</div>`);
	const root = document.getElementById('root');
	const h1 = root.querySelector('h1');
	assert(h1.textContent === 'Home', 'h1 text survives');
	const p = root.querySelector('p');
	assert(p.textContent.includes('Welcome'), 'p text survives');
	const els = Array.from(root.querySelectorAll('[data-vsk]'));
	const walker = createHydrateWalker(root, els);
	while (!walker.done()) walker.nextElement('div');
	assert(h1.textContent === 'Home', 'h1 text intact after hydration');
	assert(p.textContent.includes('Welcome'), 'p text intact after hydration');
});

// ═══════════════════════════════════════════════════════════════
// 4. SPA Routing
// ═══════════════════════════════════════════════════════════════
console.log('\n── SPA Routing ──');

await atest('router navigates between routes', async () => {
	const { buildRouteTree, createFileRouter } = await import('../../packages/runtime/src/router.js');
	const container = document.createElement('div');
	const tree = buildRouteTree([
		{ path: '/', page: () => { const d = document.createElement('div'); d.textContent = 'Home Page'; return d; } },
		{ path: '/about', page: () => { const d = document.createElement('div'); d.textContent = 'About Page'; return d; } },
	]);
	const router = createFileRouter(tree, { container });
	router.navigate('/', { replace: true });
	assert(container.textContent.includes('Home Page'));
	router.navigate('/about', { replace: true });
	assert(container.textContent.includes('About Page'));
});

await atest('router handles dynamic routes with params', async () => {
	const { buildRouteTree, createFileRouter, useParams } = await import('../../packages/runtime/src/router.js');
	const container = document.createElement('div');
	const tree = buildRouteTree([
		{ path: '/', page: () => document.createElement('div') },
		{ path: '/blog', page: () => document.createElement('div'), children: [
			{ path: '/:slug', page: () => {
				const p = useParams();
				const d = document.createElement('div');
				d.textContent = 'Post: ' + (p.slug || '');
				return d;
			}},
		]},
	]);
	const router = createFileRouter(tree, { container });
	router.navigate('/blog/hello-world', { replace: true });
	assert(container.textContent.includes('hello-world'));
	router.navigate('/blog/another-post', { replace: true });
	assert(container.textContent.includes('another-post'));
});

await atest('router updates URL on navigate', async () => {
	const { buildRouteTree, createFileRouter } = await import('../../packages/runtime/src/router.js');
	setupDom('<div id="root"></div>');
	const root = document.getElementById('root');
	const tree = buildRouteTree([
		{ path: '/', page: () => document.createElement('div') },
		{ path: '/about', page: () => document.createElement('div') },
	]);
	const router = createFileRouter(tree, { container: root });
	router.navigate('/about');
	assert(location.pathname === '/about', 'URL should update to /about');
});

await atest('router navigates to nested routes', async () => {
	const { buildRouteTree, createFileRouter } = await import('../../packages/runtime/src/router.js');
	const container = document.createElement('div');
	const tree = buildRouteTree([
		{ path: '/', page: () => { const d = document.createElement('div'); d.textContent = 'Home'; return d; } },
		{ path: '/blog', page: () => { const d = document.createElement('div'); d.textContent = 'Blog List'; return d; }, children: [
			{ path: '/:slug', page: () => { const d = document.createElement('div'); d.textContent = 'Blog Post'; return d; } },
		]},
	]);
	const router = createFileRouter(tree, { container });
	router.navigate('/blog', { replace: true });
	assert(container.textContent.includes('Blog List'));
	router.navigate('/blog/my-post', { replace: true });
	assert(container.textContent.includes('Blog Post'));
});

// ═══════════════════════════════════════════════════════════════
// 5. Nested Layouts
// ═══════════════════════════════════════════════════════════════
console.log('\n── Nested Layouts ──');

test('about page nested layout renders correctly in SSR', () => {
	const aboutPage = ssr('about/page.vsk', 'About');
	const aboutLayoutSrc = readFileSync(resolve(appDir, 'about', 'layout.vsk'), 'utf-8');
	const aboutLayout = renderPage(aboutLayoutSrc, 'AboutLayout', { children: aboutPage.body }, new Map(), { hydrate: true });
	assert(aboutLayout.body.includes('about-layout'), 'about layout wrapper');
	assert(aboutLayout.body.includes('about-page'), 'page content inside');
	assert(aboutLayout.body.includes('About Section'), 'layout heading');
	const full = ssrFull('layout.vsk', 'RootLayout', { children: aboutLayout.body });
	assert(full.includes('nav-root'), 'root nav');
	assert(full.includes('about-layout'), 'nested layout');
	assert(full.includes('about-btn'), 'page button');
});

test('blog listing page renders with blog layout', () => {
	const blogPage = ssr('blog/page.vsk', 'BlogList');
	const blogLayoutSrc = readFileSync(resolve(appDir, 'blog', 'layout.vsk'), 'utf-8');
	const blogLayout = renderPage(blogLayoutSrc, 'BlogLayout', { children: blogPage.body }, new Map(), { hydrate: true });
	assert(blogLayout.body.includes('blog-layout'), 'blog layout wrapper');
	assert(blogLayout.body.includes('blog-list'), 'blog list content');
	const full = ssrFull('layout.vsk', 'RootLayout', { children: blogLayout.body });
	assert(full.includes('nav-root'), 'root nav');
	assert(full.includes('blog-layout'), 'nested layout');
	assert(full.includes('Blog Posts'), 'page content');
});

test('dynamic blog post page renders with slug', () => {
	const postPage = ssr('blog/[slug]/page.vsk', 'BlogPost', { params: { slug: 'test-post' } });
	assert(postPage.body.includes('Post: test-post'), 'should show slug');
	assert(postPage.body.includes('back-link'), 'should have back link');
});

// ═══════════════════════════════════════════════════════════════
// 6. Styling
// ═══════════════════════════════════════════════════════════════
console.log('\n── Styling ──');

test('Tailwind-like classes present in SSR', () => {
	const home = ssr('page.vsk', 'Home');
	assert(home.body.includes('class="'), 'has class attributes');
	assert(home.body.includes('bg-blue-500'), 'has tailwind-like class');
	assert(home.body.includes('text-white'), 'has text color class');
	assert(home.body.includes('rounded'), 'has border radius class');
});

test('layout has nav with flex classes', () => {
	const layoutSrc = readFileSync(resolve(appDir, 'layout.vsk'), 'utf-8');
	const layout = renderPage(layoutSrc, 'RootLayout', { children: '<p>test</p>' }, new Map(), { hydrate: true });
	assert(layout.body.includes('flex'), 'flex class on nav');
	assert(layout.body.includes('gap-4'), 'gap class on nav');
});

test('about layout has green border styling', () => {
	const aboutLayoutSrc = readFileSync(resolve(appDir, 'about', 'layout.vsk'), 'utf-8');
	const layout = renderPage(aboutLayoutSrc, 'AboutLayout', { children: '<p>test</p>' }, new Map(), { hydrate: true });
	assert(layout.body.includes('border-green-300'), 'green border');
	assert(layout.body.includes('text-green-700'), 'green text');
});

// ═══════════════════════════════════════════════════════════════
// 7. Middleware
// ═══════════════════════════════════════════════════════════════
console.log('\n── Middleware ──');

test('middleware.ts exists with proper signature', () => {
	const mwPath = resolve(appDir, 'middleware.ts');
	assert(existsSync(mwPath), 'middleware file exists');
	const src = readFileSync(mwPath, 'utf-8');
	assert(src.includes('async function middleware'), 'has async middleware');
	assert(src.includes('ctx, next'), 'has ctx, next params');
	assert(src.includes('next('), 'calls next()');
});

// ═══════════════════════════════════════════════════════════════
// 8. Full Page SSR
// ═══════════════════════════════════════════════════════════════
console.log('\n── Full Page SSR ──');

test('full home page has complete HTML structure', () => {
	const home = ssr('page.vsk', 'Home');
	const full = ssrFull('layout.vsk', 'RootLayout', { children: home.body });
	assert(full.startsWith('<!DOCTYPE html>'), 'has doctype');
	assert(full.includes('<html>'), 'has html tag');
	assert(full.includes('<head>'), 'has head');
	assert(full.includes('<meta charset'), 'has charset');
	const bodyContent = full.match(/<body>([\s\S]*)<\/body>/);
	assert(bodyContent, 'has body content');
	assert(bodyContent[1].includes('nav'), 'body has nav');
	assert(bodyContent[1].includes('counter-btn'), 'body has counter');
});

test('client bundle starts router on load', () => {
	assert(clientCode.includes('createFileRouter(__routeTree)'));
	assert(clientCode.includes('__router.start()'));
});

// ═══════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════
console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
console.log('All hydration and routing tests passed!');
}

main().catch(e => {
	console.error('Test runner error:', e);
	process.exit(1);
});
