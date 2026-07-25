/**
 * Standalone test for true hydration walker.
 *
 * Simulates the SSR DOM structure and tests that:
 * 1. Layout claims nav, main, footer from #root
 * 2. NavLink claims <a> elements from nav's children
 * 3. Page claims elements from main's children
 * 4. Reactive elements (count, button) get effects/handlers
 * 5. Zero DOM mutations for static elements
 * 6. Zero content shift (DOM is identical before/after hydration)
 */
import { createWalker } from './walker.js';
import { Window } from 'happy-dom';

const window = new Window();
globalThis.document = window.document;
globalThis.Node = window.Node;

// ── Test Setup ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, msg) {
	if (condition) {
		passed++;
		console.log(`  ✓ ${msg}`);
	} else {
		failed++;
		console.log(`  ✗ ${msg}`);
	}
}

function assertEq(a, b, msg) {
	if (a === b) {
		passed++;
		console.log(`  ✓ ${msg}`);
	} else {
		failed++;
		console.log(`  ✗ ${msg} — expected "${b}", got "${a}"`);
	}
}

// ── Build simulated SSR DOM ─────────────────────────────────

function buildSSRDom() {
	// This mirrors the exact SSR output from the test-app
	const root = document.createElement('div');
	root.id = 'root';

	const nav = document.createElement('nav');
	nav.setAttribute('data-vsk', '0');
	nav.setAttribute('class', 'flex gap-6 px-8 py-4 border-b border-gray-200 bg-white');

	// SSR has whitespace text nodes between elements
	const navWs1 = document.createTextNode('\n\t');
	nav.appendChild(navWs1);

	const links = [
		{ href: '/', text: 'Home' },
		{ href: '/about', text: 'About' },
		{ href: '/blog', text: 'Blog' },
	];

	for (const link of links) {
		const a = document.createElement('a');
		a.setAttribute('href', link.href);
		a.setAttribute('class', 'text-gray-500 hover:text-black font-medium no-underline');
		const ws1 = document.createTextNode('\n\t\t');
		const textNode = document.createTextNode(link.text);
		const ws2 = document.createTextNode('\n\t');
		a.appendChild(ws1);
		a.appendChild(textNode);
		a.appendChild(ws2);
		nav.appendChild(a);
		nav.appendChild(document.createTextNode('\n\t'));
	}
	root.appendChild(nav);
	root.appendChild(document.createTextNode('\n'));

	const main = document.createElement('main');
	main.setAttribute('data-vsk', '1');
	main.setAttribute('class', 'max-w-3xl mx-auto my-8 px-4');

	const h1 = document.createElement('h1');
	h1.setAttribute('class', 'text-4xl font-bold mb-2');
	h1.textContent = 'Welcome to Vesk';
	main.appendChild(h1);

	const p1 = document.createElement('p');
	p1.setAttribute('class', 'text-gray-500 mb-4');
	p1.textContent = 'A compiler-first reactive UI framework for the post-VDOM web.';
	main.appendChild(p1);

	// Reactive count paragraph
	const pCount = document.createElement('p');
	pCount.setAttribute('data-vsk', '0');
	const countText = document.createTextNode('10');
	pCount.appendChild(countText);
	main.appendChild(pCount);

	const p3 = document.createElement('p');
	p3.textContent = 'Hurray 3 won';
	main.appendChild(p3);

	// Reactive button
	const button = document.createElement('button');
	button.setAttribute('data-vsk', '1');
	const btnText = document.createTextNode('+');
	button.appendChild(btnText);
	main.appendChild(button);

	root.appendChild(main);
	root.appendChild(document.createTextNode('\n'));

	const footer = document.createElement('footer');
	footer.setAttribute('class', 'text-center py-8 text-gray-400 text-sm');
	const fp = document.createElement('p');
	fp.textContent = 'Powered by Vesk';
	footer.appendChild(fp);
	root.appendChild(footer);

	return root;
}

// ── Test: Walker claims elements by tag ─────────────────────

console.log('\n=== Test 1: Walker claims elements by tag ===');
{
	const root = buildSSRDom();
	const w = createWalker(root);

	const nav = w.claimElement('nav');
	assertEq(nav.tagName.toLowerCase(), 'nav', 'claims nav from root');
	assertEq(nav.getAttribute('data-vsk'), '0', 'nav retains data-vsk attribute');
	assert(nav.className.includes('flex'), 'nav retains class');

	const main = w.claimElement('main');
	assertEq(main.tagName.toLowerCase(), 'main', 'claims main from root');

	const footer = w.claimElement('footer');
	assertEq(footer.tagName.toLowerCase(), 'footer', 'claims footer from root');
}

// ── Test: Sub-scope walks children ──────────────────────────

console.log('\n=== Test 2: Sub-scope walks children ===');
{
	const root = buildSSRDom();
	const w = createWalker(root);
	const nav = w.claimElement('nav');
	const navScope = w.subScope(nav);

	const a1 = navScope.claimElement('a');
	assertEq(a1.tagName.toLowerCase(), 'a', 'claims first <a> from nav');
	assertEq(a1.getAttribute('href'), '/', 'first link is Home');

	const a2 = navScope.claimElement('a');
	assertEq(a2.getAttribute('href'), '/about', 'second link is About');

	const a3 = navScope.claimElement('a');
	assertEq(a3.getAttribute('href'), '/blog', 'third link is Blog');
}

// ── Test: Page claims from main ─────────────────────────────

console.log('\n=== Test 3: Page claims elements from main ===');
{
	const root = buildSSRDom();
	const w = createWalker(root);
	w.claimElement('nav'); // skip nav
	const main = w.claimElement('main');
	const mainScope = w.subScope(main);

	const h1 = mainScope.claimElement('h1');
	assertEq(h1.textContent, 'Welcome to Vesk', 'claims h1 with text');

	const p1 = mainScope.claimElement('p');
	assert(p1.textContent.includes('compiler-first'), 'claims description p');

	const pCount = mainScope.claimElement('p');
	assertEq(pCount.getAttribute('data-vsk'), '0', 'claims reactive count p');
	assertEq(pCount.textContent, '10', 'count p has value 10');

	const p3 = mainScope.claimElement('p');
	assertEq(p3.textContent, 'Hurray 3 won', 'claims conditional p');

	const button = mainScope.claimElement('button');
	assertEq(button.getAttribute('data-vsk'), '1', 'claims reactive button');
	assertEq(button.textContent, '+', 'button has + text');
}

// ── Test: Zero DOM mutations ────────────────────────────────

console.log('\n=== Test 4: Zero DOM mutations ===');
{
	const root = buildSSRDom();
	const nav = root.children[0];
	const main = root.children[1];
	const footer = root.children[2];

	// Capture references BEFORE hydration
	const navRef = nav;
	const mainRef = main;
	const footerRef = footer;
	const a1Ref = nav.children[1]; // first <a> (skip whitespace text node at 0)
	const countRef = main.querySelector('[data-vsk="0"]');
	const buttonRef = main.querySelector('[data-vsk="1"]');

	// Hydrate
	const w = createWalker(root);
	const claimedNav = w.claimElement('nav');
	const navScope = w.subScope(claimedNav);
	navScope.claimElement('a'); // Home
	navScope.claimElement('a'); // About
	navScope.claimElement('a'); // Blog
	const claimedMain = w.claimElement('main');

	// Verify SAME objects (identity check = zero DOM mutations)
	assert(claimedNav === navRef, 'nav is same object (no recreation)');
	assert(claimedMain === mainRef, 'main is same object (no recreation)');
	assert(claimedNav.children[1] === a1Ref, 'first <a> is same object (no recreation)');
}

// ── Test: Reactive element gets effect ──────────────────────

console.log('\n=== Test 5: Reactive elements get effects ===');
{
	const root = buildSSRDom();
	const w = createWalker(root);
	w.claimElement('nav');
	const main = w.claimElement('main');
	const mainScope = w.subScope(main);

	// Claim elements up to the reactive count
	mainScope.claimElement('h1');
	mainScope.claimElement('p');
	const countP = mainScope.claimElement('p');
	const countText = countP.childNodes[0];

	// Simulate: effect sets countText.data = "11"
	countText.data = '11';
	assertEq(countP.textContent, '11', 'reactive count updated in place');
	assertEq(countP.getAttribute('data-vsk'), '0', 'data-vsk preserved');

	// Verify the actual DOM node is the same
	assert(countText.nodeType === 3, 'text node is still a text node');
}

// ── Test: Content shift check ───────────────────────────────

console.log('\n=== Test 6: Content shift = ZERO ===');
{
	const root = buildSSRDom();

	// Snapshot DOM before hydration
	const beforeHTML = root.innerHTML;

	// Hydrate (claim elements, no DOM mutations)
	const w = createWalker(root);
	w.claimElement('nav');
	const navScope = w.subScope(root.children[0]);
	navScope.claimElement('a');
	navScope.claimElement('a');
	navScope.claimElement('a');
	const main = w.claimElement('main');
	const mainScope = w.subScope(main);
	mainScope.claimElement('h1');
	mainScope.claimElement('p');
	mainScope.claimElement('p');
	mainScope.claimElement('p');
	mainScope.claimElement('button');
	w.claimElement('footer');

	// Snapshot DOM after hydration
	const afterHTML = root.innerHTML;

	assertEq(beforeHTML, afterHTML, 'innerHTML identical before/after hydration');
}

// ── Test: Full simulation matching test-app ─────────────────

console.log('\n=== Test 7: Full simulation ===');
{
	const root = buildSSRDom();

	// Simulate Layout component
	const w = createWalker(root);
	const nav = w.claimElement('nav');
	const navScope = w.subScope(nav);

	// Simulate 3 NavLink calls — each claims an <a>
	const a1 = navScope.claimElement('a');
	assertEq(a1.getAttribute('href'), '/', 'NavLink 1 claims /');
	a1.addEventListener('click', () => {}); // attach handler

	const a2 = navScope.claimElement('a');
	assertEq(a2.getAttribute('href'), '/about', 'NavLink 2 claims /about');

	const a3 = navScope.claimElement('a');
	assertEq(a3.getAttribute('href'), '/blog', 'NavLink 3 claims /blog');

	// Layout claims main
	const main = w.claimElement('main');
	const mainScope = w.subScope(main);

	// Page claims its elements
	const h1 = mainScope.claimElement('h1');
	assertEq(h1.textContent, 'Welcome to Vesk', 'Page claims h1');

	const pDesc = mainScope.claimElement('p');
	assert(pDesc.textContent.includes('compiler-first'), 'Page claims description');

	const pCount = mainScope.claimElement('p');
	const countText = pCount.childNodes[0]; // existing "10" text node
	assertEq(countText.data, '10', 'count text node claimed');

	const pCond = mainScope.claimElement('p');
	assertEq(pCond.textContent, 'Hurray 3 won', 'conditional p claimed');

	const button = mainScope.claimElement('button');
	button.addEventListener('click', () => { countText.data = '11'; });
	assertEq(button.textContent, '+', 'button claimed');

	// Simulate click
	button.click();
	assertEq(countText.data, '11', 'count updated after click');

	// Layout claims footer
	const footer = w.claimElement('footer');
	assertEq(footer.textContent, 'Powered by Vesk', 'footer claimed');

	// Final content shift check
	const htmlAfter = root.innerHTML;
	assert(htmlAfter.includes('Home'), 'Home link still in DOM');
	assert(htmlAfter.includes('11'), 'count is 11 after click');
	assert(htmlAfter.includes('Powered by Vesk'), 'footer still in DOM');
}

// ── Results ─────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
console.log('All hydration walker tests passed!');
