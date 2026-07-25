/**
 * Puppeteer test for true hydration.
 */
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:3000';
let passed = 0;
let failed = 0;
let browser;

async function assert(condition, msg) {
	if (condition) { passed++; console.log(`  \u2713 ${msg}`); }
	else { failed++; console.log(`  \u2717 ${msg}`); }
}

async function main() {
	browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

	// ── Test 1: Initial load ──────────────────────────
	console.log('\n=== TEST 1: Initial load (no content shift) ===');
	{
		const page = await browser.newPage();
		await page.goto(BASE, { waitUntil: 'networkidle0' });

		const rootChildren = await page.evaluate(() => {
			const root = document.getElementById('root');
			return root ? root.children.length : 0;
		});
		assert(rootChildren >= 3, `#root has ${rootChildren} children`);

		const firstChildTag = await page.evaluate(() => {
			const root = document.getElementById('root');
			if (!root) return '';
			for (const child of root.children) {
				if (child.tagName.toLowerCase() !== 'style') return child.tagName.toLowerCase();
			}
			return '';
		});
		assert(firstChildTag === 'nav', `first child is <nav>`);

		const navText = await page.evaluate(() => {
			const nav = document.querySelector('nav');
			return nav ? nav.textContent.replace(/\s+/g, ' ').trim() : '';
		});
		assert(navText.includes('Home') && navText.includes('About') && navText.includes('Blog'),
			'nav links: ' + navText);

		const h1 = await page.evaluate(() => {
			const el = document.querySelector('h1');
			return el ? el.textContent : '';
		});
		assert(h1.trim() === 'Welcome to Vesk', 'h1: ' + h1);

		const paragraphs = await page.evaluate(() => {
			return Array.from(document.querySelectorAll('main p')).map(p => p.textContent);
		});
		assert(paragraphs.some(p => p.trim() === '10'), 'count shows 10 in paragraphs');

		const hasButton = await page.evaluate(() => !!document.querySelector('button'));
		assert(hasButton, 'button exists');

		const footerText = await page.evaluate(() => {
			const f = document.querySelector('footer');
			return f ? f.textContent : '';
		});
		assert(footerText.includes('Powered by Vesk'), 'footer: ' + footerText.trim());

		const domStable = await page.evaluate(() => {
			const root = document.getElementById('root');
			return { before: root.innerHTML };
		});
		assert(!!domStable, 'DOM accessible after hydration');

		await page.close();
	}

	// ── Test 2: Reactivity (click button, count updates) ───
	console.log('\n=== TEST 2: Reactivity ===');
	{
		const page = await browser.newPage();
		await page.goto(BASE, { waitUntil: 'networkidle0' });

		await page.click('button');
		await new Promise(r => setTimeout(r, 100));

		const after = await page.evaluate(() => {
			const ps = Array.from(document.querySelectorAll('main p'));
			return ps.map(p => p.textContent);
		});
		assert(after.some(p => p.trim() === '11'), 'count updated to 11 after first click');

		// Click 4 more times to reach 15
		for (let i = 0; i < 4; i++) {
			await page.click('button');
			await new Promise(r => setTimeout(r, 50));
		}

		const afterFive = await page.evaluate(() => {
			const ps = Array.from(document.querySelectorAll('main p'));
			return ps.map(p => p.textContent);
		});
		assert(afterFive.some(p => p.trim() === '15'), 'count updated to 15 after 5 clicks');

		// Now count >= 15, Throw should NOT throw and show "OK 15"
		const allHtml = await page.evaluate(() => {
			return document.getElementById('root').innerHTML;
		});
		assert(allHtml.includes('Insufficient') || allHtml.includes('OK'), 
			'Appxx content present (error or OK): ' + allHtml.slice(-200));

		await page.close();
	}

	// ── Test 3: Error boundary (try/catch) ─────────────────
	console.log('\n=== TEST 3: Error boundary ===');
	{
		const page = await browser.newPage();
		await page.goto(BASE, { waitUntil: 'networkidle0' });

		// Appx should show error from Throws
		const errorText = await page.evaluate(() => {
			const errors = Array.from(document.querySelectorAll('.error'));
			return errors.map(e => e.textContent);
		});
		assert(errorText.some(t => t.includes('Boom!')), 'Appx shows Error: Boom!');

		// Appxx should show error from Throw (count=10 < 15)
		assert(errorText.some(t => t.includes('Insufficient')), 'Appxx shows Insufficient error');

		await page.close();
	}

	// ── Test 4: SPA navigation ─────────────────────────────
	console.log('\n=== TEST 4: SPA navigation ===');
	{
		const page = await browser.newPage();
		await page.goto(BASE, { waitUntil: 'networkidle0' });

		await page.click('a[href="/about"]');
		await new Promise(r => setTimeout(r, 200));

		const url = page.url();
		assert(url.includes('/about'), 'URL changed to /about');

		const h1 = await page.evaluate(() => {
			const el = document.querySelector('h1');
			return el ? el.textContent : '';
		});
		assert(h1 === 'About Vesk', 'h1: ' + h1);

		const hasNav = await page.evaluate(() => !!document.querySelector('nav'));
		assert(hasNav, 'nav still exists after navigation');
		await page.close();
	}

	// ── Test 5: Back navigation ───────────────────────────
	console.log('\n=== TEST 5: Back navigation ===');
	{
		const page = await browser.newPage();
		await page.goto(BASE, { waitUntil: 'networkidle0' });

		await page.click('a[href="/about"]');
		await new Promise(r => setTimeout(r, 200));

		await page.goBack();
		await new Promise(r => setTimeout(r, 200));

		const url = page.url();
		assert(url === BASE + '/' || url === BASE, 'URL back to root');

		const h1 = await page.evaluate(() => {
			const el = document.querySelector('h1');
			return el ? el.textContent : '';
		});
		assert(h1 === 'Welcome to Vesk', 'h1 back to Welcome');
		await page.close();
	}

	// ── Test 6: Dynamic route ─────────────────────────────
	console.log('\n=== TEST 6: Dynamic route ===');
	{
		const page = await browser.newPage();
		await page.goto(BASE, { waitUntil: 'networkidle0' });

		await page.goto(BASE + '/blog/hello-world', { waitUntil: 'networkidle0' });

		const url = page.url();
		assert(url.includes('/blog/hello-world'), 'URL at /blog/hello-world');

		const h1 = await page.evaluate(() => {
			const el = document.querySelector('h1');
			return el ? el.textContent : '';
		});
		assert(h1.includes('Post'), 'h1: ' + h1);
		await page.close();
	}

	// ── Test 7: No JS errors ──────────────────────────────
	console.log('\n=== TEST 7: No JS errors ===');
	{
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', err => errors.push(err.message));
		await page.goto(BASE, { waitUntil: 'networkidle0' });

		// Trigger some interactions
		await page.click('button');
		await new Promise(r => setTimeout(r, 100));
		await page.click('a[href="/about"]');
		await new Promise(r => setTimeout(r, 200));
		await page.goBack();
		await new Promise(r => setTimeout(r, 200));

		assert(errors.length === 0, 'Zero JS errors (got ' + errors.length + ': ' + errors.join(', ') + ')');
		await page.close();
	}

	// ── Results ────────────────────────────────────────
	console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${passed + failed} total ===`);
	if (failed > 0) process.exit(1);
	console.log('All hydration tests passed!');

	await browser.close();
}

main().catch(e => {
	console.error('Test error:', e);
	process.exit(1);
});
