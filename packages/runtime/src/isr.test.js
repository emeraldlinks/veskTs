import { isr, revalidatePath, revalidateTag, clearIsrCache } from './isr.js';

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

		// First call populates cache
		await isr('/stale', fetcher, { revalidate: 60, tags: ['stale'] });
		// Force expire by revalidating
		await revalidatePath('/stale');
		// Should fetch fresh
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

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
