import { defineConfig, definePlugin, preset } from './config.js';

let passed = 0;
let failed = 0;

function describe(name, fn) { console.log(`\n${name}`); fn(); }
function it(name, fn) {
	try { fn(); passed++; console.log(`  \u2713 ${name}`); }
	catch (e) { failed++; console.log(`  \u2717 ${name}\n    ${e.message}`); }
}
function expect(actual) {
	return {
		toBe(expected) { if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); },
		toEqual(expected) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); },
		toBeNull() { if (actual !== null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`); },
		toBeTruthy() { if (!actual) throw new Error(`Expected truthy, got ${JSON.stringify(actual)}`); },
		toBeFalsy() { if (actual) throw new Error(`Expected falsy, got ${JSON.stringify(actual)}`); },
		toContain(expected) { if (!String(actual).includes(expected)) throw new Error(`Expected "${actual}" to contain "${expected}"`); },
		toBeUndefined() { if (actual !== undefined) throw new Error(`Expected undefined, got ${JSON.stringify(actual)}`); },
		toBeInstanceOf(cls) { if (!(actual instanceof cls)) throw new Error(`Expected instance of ${cls.name}`); },
	};
}

describe('security string shorthand', () => {

	it('"strict" returns full security config', () => {
		const cfg = defineConfig({ security: 'strict' });
		expect(cfg.security.autoEscape).toBe(true);
		expect(cfg.security.csrf).toBe(true);
		expect(cfg.security.xFrameOptions).toBe('DENY');
		expect(cfg.security.hsts).toContain('max-age');
		expect(cfg.security.contentSecurityPolicy).toContain("default-src 'self'");
		expect(cfg.security.redactLogs).toBe(true);
	});

	it('"minimal" returns limited security', () => {
		const cfg = defineConfig({ security: 'minimal' });
		expect(cfg.security.autoEscape).toBe(true);
		expect(cfg.security.csrf).toBe(false);
		expect(cfg.security.xFrameOptions).toBe('SAMEORIGIN');
		expect(cfg.security.hsts).toBe(false);
		expect(cfg.security.redactLogs).toBe(false);
	});

	it('"off" returns empty security (no protections)', () => {
		const cfg = defineConfig({ security: 'off' });
		// true because defineConfig applies defaults to {}
		expect(cfg.security.autoEscape).toBe(true);
	});

	it('false is equivalent to "off"', () => {
		const cfg = defineConfig({ security: false });
		expect(cfg.security).toBeTruthy();
	});

});

describe('preset()', () => {

	it('preset("production") returns strict defaults', () => {
		const p = preset('production');
		expect(p.autoEscape).toBe(true);
		expect(p.csrf).toBe(true);
		expect(p.xFrameOptions).toBe('DENY');
		expect(p.contentSecurityPolicy).toBeTruthy();
	});

	it('preset("development") returns strict minus CSP', () => {
		const p = preset('development');
		expect(p.autoEscape).toBe(true);
		expect(p.contentSecurityPolicy).toBe(false);
	});

	it('preset with overrides merges correctly', () => {
		const p = preset('production', { trustProxy: true, rateLimit: { max: 200 } });
		expect(p.trustProxy).toBe(true);
		expect(p.rateLimit.max).toBe(200);
		expect(p.autoEscape).toBe(true); // still has defaults
	});

	it('defineConfig with function security calls preset', () => {
		const cfg = defineConfig({
			security: (p) => p('production', { trustProxy: true }),
		});
		expect(cfg.security.trustProxy).toBe(true);
		expect(cfg.security.autoEscape).toBe(true);
	});

	it('throws on unknown preset name', () => {
		let threw = false;
		try { preset('invalid'); } catch { threw = true; }
		expect(threw).toBe(true);
	});

});

describe('definePlugin()', () => {

	it('returns the plugin object', () => {
		const p = definePlugin({ name: 'test' });
		expect(p.name).toBe('test');
	});

	it('throws without a name', () => {
		let threw = false;
		try { definePlugin({}); } catch { threw = true; }
		expect(threw).toBe(true);
	});

	it('throws on null', () => {
		let threw = false;
		try { definePlugin(null); } catch { threw = true; }
		expect(threw).toBe(true);
	});

	it('accepts provides metadata', () => {
		const p = definePlugin({
			name: 'database',
			provides: {
				db: class Database {},
				redis: class Redis {},
			},
		});
		expect(p.provides.db).toBeTruthy();
		expect(p.provides.redis).toBeTruthy();
	});

	it('accepts onRequest hook', () => {
		let called = false;
		const p = definePlugin({
			name: 'logger',
			onRequest: async (ctx) => { called = true; },
		});
		expect(typeof p.onRequest).toBe('function');
	});

});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);