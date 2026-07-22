import { Window } from 'happy-dom';
import { renderPage } from '../../packages/compiler/src/server-codegen.js';
import { createHydrateWalker, hydrate } from '../../packages/runtime/src/hydrate.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { track, effect, batch } from '../../packages/runtime/src/track.js';
import { getActiveComponent, setActiveComponent } from '../../packages/runtime/src/context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..', 'app');

let passed = 0;
let failed = 0;

function test(name, fn) {
	try { fn(); passed++; console.log(`  ✓ ${name}`); }
	catch (e) { failed++; console.log(`  ✗ ${name} — ${e.message}`); }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function setupDom(html) {
	const win = new Window();
	win.document.body.innerHTML = html;
	globalThis.window = win;
	globalThis.document = win.document;
	globalThis.location = win.location;
	return win;
}

// Simulate the compiled Home component output (from client bundle)
function compiledHome(props, __registry, __hydrate) {
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
		const $root = __hydrate.root;
		const count = track(0);
		const $n0 = __hydrate.nextElement("div");
		$n0.setAttribute("class", "home-page");
		const $n3 = __hydrate.nextElement("button");
		$n3.setAttribute("class", "btn-counter px-4 py-2 bg-blue-500 text-white rounded");
		$n3.setAttribute("data-testid", "counter-btn");
		const $n4 = document.createTextNode(" Count: ");
		$n3.appendChild($n4);
		const $n5 = __hydrate.nextElement("span");
		$n5.setAttribute("data-testid", "counter-value");
		const $n6 = document.createTextNode('');
		$n5.appendChild($n6);
		$n3.appendChild($n5);
		$n3.__evh_click = () => count.set(count.get() + 1);
		$n3.setAttribute('data-vsk-ev', '');
		$n0.appendChild($n3);
		const $n7 = __hydrate.nextElement("button");
		$n7.setAttribute("class", "px-4 py-2 bg-red-500 text-white rounded ml-2");
		$n7.setAttribute("data-testid", "reset-btn");
		const $n8 = document.createTextNode(" Reset ");
		$n7.appendChild($n8);
		$n7.__evh_click = () => count.set(0);
		$n7.setAttribute('data-vsk-ev', '');
		$n0.appendChild($n7);
		if ($n0.parentNode !== $root) $root.appendChild($n0);
		effect(() => { $n6.data = String(count.get()); });
		return $root;
	} finally {
		setActiveComponent(__prev);
	}
}

console.log('\n═══ Event-After-Hydration Tests ═══\n');

// ── Test 1: SSR produces data-vsk markers ──
console.log('── Setup ──');

test('SSR Home page has data-vsk markers', () => {
	const home = renderPage(
		readFileSync(resolve(appDir, 'page.vsk'), 'utf-8'),
		'Home', {}, new Map(), { hydrate: true }
	);
	assert(home.body.includes('data-vsk="0"'), 'div should have data-vsk');
	assert(home.body.includes('data-vsk="1"'), 'counter button has data-vsk');
	assert(home.body.includes('data-vsk="2"'), 'counter span has data-vsk');
	assert(home.body.includes('data-vsk="3"'), 'reset button has data-vsk');
});

// ── Test 2: Hydration claims DOM and wires events ──
console.log('\n── Core Hydration & Events ──');

test('hydrate() claims SSR DOM and attaches event handlers', () => {
	const home = renderPage(
		readFileSync(resolve(appDir, 'page.vsk'), 'utf-8'),
		'Home', {}, new Map(), { hydrate: true }
	);
	setupDom(`<div id="root">${home.body}</div>`);
	const root = document.getElementById('root');

	// Verify SSR DOM state before hydration
	assert(root.querySelector('[data-vsk="0"]'), 'div has data-vsk before hydrate');
	assert(root.querySelector('[data-vsk="1"]'), 'counter button has data-vsk before hydrate');
	const spanBefore = root.querySelector('[data-testid="counter-value"]');
	assert(spanBefore.textContent === '0', 'SSR span shows 0');

	// Hydrate
	hydrate(root, compiledHome, {});

	// Verify data-vsk markers are gone
	assert(!root.querySelector('[data-vsk]'), 'all data-vsk markers removed after hydrate');
	assert(root.querySelector('[data-testid="counter-value"]'), 'span still exists');
	const spanAfter = root.querySelector('[data-testid="counter-value"]');
	assert(spanAfter.textContent === '0', 'span text still shows 0 after hydrate');

	// Find the clean button (now without data-vsk)
	const counterBtn = root.querySelector('[data-testid="counter-btn"]');
	assert(counterBtn, 'counter button exists after hydration');
	assert(typeof counterBtn.__evh_click === 'function', '__evh_click handler attached to button');
});

// ── Test 3: Click events fire and update reactive state ──
test('clicking counter button updates reactive span text', () => {
	const home = renderPage(
		readFileSync(resolve(appDir, 'page.vsk'), 'utf-8'),
		'Home', {}, new Map(), { hydrate: true }
	);
	setupDom(`<div id="root">${home.body}</div>`);
	const root = document.getElementById('root');

	hydrate(root, compiledHome, {});

	const counterBtn = root.querySelector('[data-testid="counter-btn"]');
	const span = root.querySelector('[data-testid="counter-value"]');

	assert(span.textContent === '0', 'starts at 0');

	// Simulate clicks via __evh_click (same mechanism as event delegation)
	counterBtn.__evh_click({});
	assert(span.textContent === '1', 'after 1 click: 1');

	counterBtn.__evh_click({});
	counterBtn.__evh_click({});
	assert(span.textContent === '3', 'after 3 more clicks: 3');
});

// ── Test 4: Reset button works ──
test('reset button sets counter back to 0', () => {
	const home = renderPage(
		readFileSync(resolve(appDir, 'page.vsk'), 'utf-8'),
		'Home', {}, new Map(), { hydrate: true }
	);
	setupDom(`<div id="root">${home.body}</div>`);
	const root = document.getElementById('root');

	hydrate(root, compiledHome, {});

	const counterBtn = root.querySelector('[data-testid="counter-btn"]');
	const resetBtn = root.querySelector('[data-testid="reset-btn"]');
	const span = root.querySelector('[data-testid="counter-value"]');

	counterBtn.__evh_click({});
	counterBtn.__evh_click({});
	assert(span.textContent === '2', 'count is 2');

	resetBtn.__evh_click({});
	assert(span.textContent === '0', 'after reset: 0');

	// Verify counter still works after reset
	counterBtn.__evh_click({});
	assert(span.textContent === '1', 'still works after reset: 1');
});

// ── Test 5: Event delegation via closest('[data-vsk-ev]') ──
test('event delegation dispatches to correct button handler', () => {
	const home = renderPage(
		readFileSync(resolve(appDir, 'page.vsk'), 'utf-8'),
		'Home', {}, new Map(), { hydrate: true }
	);
	setupDom(`<div id="root">${home.body}</div>`);
	const root = document.getElementById('root');

	hydrate(root, compiledHome, {});

	// Simulate what the event delegation setup does
	const counterBtn = root.querySelector('[data-testid="counter-btn"]');
	const resetBtn = root.querySelector('[data-testid="reset-btn"]');
	const span = root.querySelector('[data-testid="counter-value"]');

	// Simulate delegated click on counter button
	let el = counterBtn.closest('[data-vsk-ev]');
	assert(el === counterBtn, 'counter button has data-vsk-ev and is found by closest');
	el.__evh_click({});
	assert(span.textContent === '1', 'delegated click on counter button works');

	// Simulate delegated click on reset button
	el = resetBtn.closest('[data-vsk-ev]');
	assert(el === resetBtn, 'reset button has data-vsk-ev and is found by closest');
	el.__evh_click({});
	assert(span.textContent === '0', 'delegated click on reset button works');
});

// ── Test 6: Static elements (h1, p) survive hydration with correct content ──
test('static elements untouched by hydration', () => {
	const home = renderPage(
		readFileSync(resolve(appDir, 'page.vsk'), 'utf-8'),
		'Home', {}, new Map(), { hydrate: true }
	);
	setupDom(`<div id="root">${home.body}</div>`);
	const root = document.getElementById('root');

	hydrate(root, compiledHome, {});

	const h1 = root.querySelector('h1');
	assert(h1.textContent === 'Home', 'h1 preserved');
	const p = root.querySelector('p');
	assert(p.textContent.includes('Welcome'), 'p preserved');
});

// ── Test 7: Multiple sequential clicks ──
test('rapid sequential clicks all register correctly', () => {
	const home = renderPage(
		readFileSync(resolve(appDir, 'page.vsk'), 'utf-8'),
		'Home', {}, new Map(), { hydrate: true }
	);
	setupDom(`<div id="root">${home.body}</div>`);
	const root = document.getElementById('root');

	hydrate(root, compiledHome, {});

	const counterBtn = root.querySelector('[data-testid="counter-btn"]');
	const span = root.querySelector('[data-testid="counter-value"]');

	for (let i = 1; i <= 10; i++) {
		counterBtn.__evh_click({});
		assert(span.textContent === String(i), `click ${i}: value should be ${i}, got "${span.textContent}"`);
	}
});

// ── Test 8: Hydrate a second time (idempotent) ──
test('hydrating already-hydrated DOM does not break events', () => {
	const home = renderPage(
		readFileSync(resolve(appDir, 'page.vsk'), 'utf-8'),
		'Home', {}, new Map(), { hydrate: true }
	);
	setupDom(`<div id="root">${home.body}</div>`);
	const root = document.getElementById('root');

	// First hydration
	hydrate(root, compiledHome, {});
	// Second hydration (no data-vsk markers left, walker creates fresh elements)
	hydrate(root, compiledHome, {});

	const counterBtn = root.querySelector('[data-testid="counter-btn"]');
	const span = root.querySelector('[data-testid="counter-value"]');
	assert(span.textContent === '0', 'still shows 0 after double hydrate');
	counterBtn.__evh_click({});
	assert(span.textContent === '1', 'click still works after double hydrate');
});

// ── Results ──
console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
console.log('All event-after-hydration tests passed!');
