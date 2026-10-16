/**
 * Per-request security overrides.
 *
 * Regression: `VeskRequest.setCsp()`, `.setSecurityHeader()`, `.setCsrf()` and
 * `.setRateLimit()` accumulated onto a field that nothing ever read — the
 * servers had no channel to receive them — so every one of those methods was a
 * silent no-op in dev AND prod, while reading exactly like a working API.
 */
import { VeskRequest, VeskResponse, applyRequestSecurity } from '@vesk/runtime/src/request';
import {
	runWithSecurityOverrides,
	getSecurityOverrides,
	setSecurityOverride,
} from '@vesk/runtime/src/security-overrides';

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
	try { fn(); passed++; console.log(`  ✓ ${name}`); }
	catch (e: unknown) { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); }
}
function expect(actual: unknown) {
	return {
		toBe(expected: unknown) {
			if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		},
		toEqual(expected: unknown) {
			const a = JSON.stringify(actual), b = JSON.stringify(expected);
			if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
		},
		toContain(expected: unknown) {
			if (!String(actual).includes(String(expected))) throw new Error(`Expected "${actual}" to contain "${expected}"`);
		},
		not: {
			toBe(expected: unknown) {
				if (actual === expected) throw new Error(`Expected NOT ${JSON.stringify(expected)}`);
			},
			toContain(expected: unknown) {
				if (String(actual).includes(String(expected))) throw new Error(`Expected "${actual}" NOT to contain "${expected}"`);
			},
		},
	};
}

function makeReq(): VeskRequest {
	return new VeskRequest(new Request('http://localhost/x'), { locals: {} } as never);
}

console.log('\nsecurity override channel');

it('setCsp publishes an override the server can read', () => {
	runWithSecurityOverrides(() => {
		const req = makeReq();
		req.setCsp("default-src 'none'");
		expect(getSecurityOverrides()).toEqual({ contentSecurityPolicy: "default-src 'none'" });
	});
});

it('setSecurityHeader publishes custom headers', () => {
	runWithSecurityOverrides(() => {
		const req = makeReq();
		req.setSecurityHeader('X-Frame-Options', 'DENY');
		const o = getSecurityOverrides() as { customHeaders: Record<string, string> };
		expect(o.customHeaders).toEqual({ 'X-Frame-Options': 'DENY' });
	});
});

it('accumulates multiple headers', () => {
	runWithSecurityOverrides(() => {
		const req = makeReq();
		req.setSecurityHeader('X-A', '1');
		req.setSecurityHeader('X-B', '2');
		const o = getSecurityOverrides() as { customHeaders: Record<string, string> };
		expect(Object.keys(o.customHeaders)).toEqual(['X-A', 'X-B']);
	});
});

it('setCsrf and setRateLimit publish too', () => {
	runWithSecurityOverrides(() => {
		const req = makeReq();
		req.setCsrf(false);
		req.setRateLimit({ windowMs: 1000, max: 5 });
		const o = getSecurityOverrides() as Record<string, unknown>;
		expect(o.csrf).toBe(false);
		expect(o.rateLimit).toEqual({ windowMs: 1000, max: 5 });
	});
});

it('applyRequestSecurity applies the CSP to the response', () => {
	runWithSecurityOverrides(() => {
		const req = makeReq();
		const res = VeskResponse.json({ ok: true });
		req.setCsp("script-src 'self'");
		applyRequestSecurity(req, res as never);
		res.build();
		expect(res.headers.get('Content-Security-Policy')).toBe("script-src 'self'");
	});
});

it('applyRequestSecurity applies custom headers', () => {
	runWithSecurityOverrides(() => {
		const req = makeReq();
		const res = VeskResponse.json({ ok: true });
		req.setSecurityHeader('X-Frame-Options', 'DENY');
		applyRequestSecurity(req, res as never);
		res.build();
		expect(res.headers.get('X-Frame-Options')).toBe('DENY');
	});
});

it('registers the globalThis bridge the adapter servers read', () => {
	// prod-server.ts / dev-server.ts cannot import the runtime (it is injected
	// into generated code as a string), so the channel is bridged on globalThis.
	const bridge = (globalThis as Record<string, unknown>).__vesk_security as
		{ run?: unknown; get?: unknown; set?: unknown } | undefined;
	expect(bridge).not.toBe(undefined as unknown);
	expect(typeof bridge?.run).toBe('function');
	expect(typeof bridge?.get).toBe('function');
	expect(typeof bridge?.set).toBe('function');
});

it('keeps concurrent scopes isolated', async () => {
	// A shared module-level slot would let a slow request bleed its CSP into an
	// unrelated one. This is the whole reason for the AsyncLocalStorage.
	const bridge = (globalThis as Record<string, unknown>).__vesk_security as
		{ run: (fn: () => void) => void; get: () => Record<string, unknown> | null };
	const seen: Array<Record<string, unknown> | null> = [];
	const slow = bridge.run(() => {
		setSecurityOverride('contentSecurityPolicy', 'slow');
		return new Promise<void>((r) => setTimeout(r, 30)).then(() => {
			seen.push(bridge.get());
		});
	});
	const fast = bridge.run(() => {
		setSecurityOverride('contentSecurityPolicy', 'fast');
		seen.push(bridge.get());
	});
	await Promise.all([slow, fast]);
	expect(seen.filter(Boolean).map(o => o!.contentSecurityPolicy)).toEqual(['fast', 'slow']);
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);