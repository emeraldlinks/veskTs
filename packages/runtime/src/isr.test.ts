import { isr, revalidatePath, revalidateTag, clearIsrCache, pageIsr, componentIsr, revalidateComponent } from '@vesk/runtime/src/isr';

let passed = 0;
let failed = 0;

function describe(name, fn) {
	console.log(`\n${name}`);
	fn();
}

function it(name, fn) {
	try {
		fn();
		passed++;
		console.log(`  ✓ ${name}`);
	} catch (e) {
		failed++;
		console.log(`  ✗ ${name}`);
		console.log(`    ${e.message}`);
	}
}

function expect(actual) {
	return {
		toBe(expected) {
			if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		},
		toEqual(expected) {
			const a = JSON.stringify(actual);
			const e = JSON.stringify(expected);
			if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
		},
	};
}

describe('ISR Cache', () => {
	beforeEach(() => clearIsrCache());

	function beforeEach(fn) { fn(); }

	it('fetches fresh data on first call', async () => {
		let callCount = 0;
		const result = await isr('/test', async () => { callCount++; return { value: callCount }; }, { revalidate: 60 });
		expect(result.data.value).toBe(1);
		expect(callCount).toBe(1);
	});

	it('returns cached data on subsequent calls', async () => {
		let callCount = 0;
		await isr('/test', async () => { callCount++; return { value: callCount }; }, { revalidate: 60 });
		const result = await isr('/test', async () => { callCount++; return { value: callCount }; }, { revalidate: 60 });
		expect(result.data.value).toBe(1);
		expect(callCount).toBe(1);
	});

	it('skips cache when revalidate is 0', async () => {
		let callCount = 0;
		await isr('/test2', async () => { callCount++; return { value: callCount }; }, { revalidate: 0 });
		await isr('/test2', async () => { callCount++; return { value: callCount }; }, { revalidate: 0 });
		expect(callCount).toBe(2);
	});

	it('revalidatePath clears specific path', async () => {
		let callCount = 0;
		await isr('/alpha', async () => { callCount++; return { value: callCount }; }, { revalidate: 60 });
		await isr('/beta', async () => { callCount++; return { value: callCount }; }, { revalidate: 60 });
		expect(callCount).toBe(2);

		await revalidatePath('/alpha');
		const r1 = await isr('/alpha', async () => { callCount++; return { value: callCount }; }, { revalidate: 60 });
		expect(r1.data.value).toBe(3);

		const r2 = await isr('/beta', async () => { callCount++; return { value: callCount }; }, { revalidate: 60 });
		expect(r2.data.value).toBe(2);
	});

	it('revalidateTag clears by tag', async () => {
		let callCount = 0;
		const fetcher = async () => { callCount++; return { value: callCount }; };

		await isr('/a', fetcher, { revalidate: 60, tags: ['x'] });
		await isr('/b', fetcher, { revalidate: 60, tags: ['x'] });
		await isr('/c', fetcher, { revalidate: 60, tags: ['y'] });
		expect(callCount).toBe(3);

		await revalidateTag('x');
		const ra = await isr('/a', fetcher, { revalidate: 60, tags: ['x'] });
		const rb = await isr('/b', fetcher, { revalidate: 60, tags: ['x'] });
		const rc = await isr('/c', fetcher, { revalidate: 60, tags: ['y'] });

		expect(ra.data.value).toBe(4);
		expect(rb.data.value).toBe(5);
		expect(rc.data.value).toBe(3); // still cached
	});

	it('stale-while-revalidate serves stale during revalidation', async () => {
		let callCount = 0;
		const fetcher = async () => { callCount++; return { value: callCount }; };

		await isr('/stale', fetcher, { revalidate: 60, tags: ['stale'] });
		await revalidatePath('/stale');
		const r = await isr('/stale', fetcher, { revalidate: 60, tags: ['stale'] });
		expect(r.data.value).toBe(2);
	});

	it('clearIsrCache clears everything', async () => {
		await isr('/clear-test', async () => ({ x: 1 }), { revalidate: 60 });
		clearIsrCache();
		let callCount = 0;
		const r = await isr('/clear-test', async () => { callCount++; return { x: callCount }; }, { revalidate: 60 });
		expect(r.data.x).toBe(1);
		expect(callCount).toBe(1);
	});
});

describe('pageIsr', () => {
	beforeEach(() => clearIsrCache());

	function beforeEach(fn) { fn(); }

	it('caches HTML responses', async () => {
		let callCount = 0;
		const r = await pageIsr('/page', async () => { callCount++; return { html: '<h1>Hello</h1>', headers: { 'content-type': 'text/html' } }; }, { revalidate: 60 });
		expect(r.html).toBe('<h1>Hello</h1>');
		expect(callCount).toBe(1);
	});

	it('serves cached HTML on subsequent calls', async () => {
		let callCount = 0;
		const render = async () => { callCount++; return { html: `<h1>Count ${callCount}</h1>`, headers: {} }; };
		await pageIsr('/cached-page', render, { revalidate: 60 });
		const r = await pageIsr('/cached-page', render, { revalidate: 60 });
		expect(r.html).toBe('<h1>Count 1</h1>');
		expect(callCount).toBe(1);
	});

	it('returns stale marker when stale', async () => {
		let callCount = 0;
		const render = async () => { callCount++; return { html: `${callCount}`, headers: {} }; };
		await pageIsr('/stale-page', render, { revalidate: 60 });
		await revalidatePath('/stale-page');
		const r = await pageIsr('/stale-page', render, { revalidate: 60 });
		expect(r.stale).toBe(true);
	});
});

describe('componentIsr', () => {
  it('caches component HTML by key', async () => {
    let callCount = 0;
    const r = await componentIsr('header', async () => { callCount++; return '<header>Site</header>'; }, { revalidate: 60 });
    expect(r).toBe('<header>Site</header>');
    expect(callCount).toBe(1);
  });

  it('serves cached component HTML', async () => {
    let callCount = 0;
    const render = async () => { callCount++; return `<div>comp ${callCount}</div>`; };
    await componentIsr('comp-cached', render, { revalidate: 60 });
    const r = await componentIsr('comp-cached', render, { revalidate: 60 });
    expect(r).toBe('<div>comp 1</div>');
    expect(callCount).toBe(1);
  });

  it('revalidates component via revalidateComponent', async () => {
    let callCount = 0;
    const render = async () => { callCount++; return `count ${callCount}`; };
    await componentIsr('comp-reval', render, { revalidate: 60 });
    const r1 = await componentIsr('comp-reval', render, { revalidate: 60 });
    expect(r1).toBe('count 1');
    expect(callCount).toBe(1);
    await revalidateComponent('comp-reval');
    const r2 = await componentIsr('comp-reval', render, { revalidate: 60 });
    expect(r2).toBe('count 2');
    expect(callCount).toBe(2);
  });

  it('component and page ISR have separate caches', async () => {
    let compCount = 0;
    let pageCount = 0;
    await componentIsr('shared-key', async () => { compCount++; return 'component'; }, { revalidate: 60 });
    await pageIsr('/shared-key', async () => { pageCount++; return { html: 'page', headers: {} }; }, { revalidate: 60 });
    const cr = await componentIsr('shared-key', async () => { compCount++; return 'component'; }, { revalidate: 60 });
    const pr = await pageIsr('/shared-key', async () => { pageCount++; return { html: 'page', headers: {} }; }, { revalidate: 60 });
    expect(compCount).toBe(1);
    expect(pageCount).toBe(1);
    expect(cr).toBe('component');
    expect(pr.html).toBe('page');
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
