import {
	escapeHtml, raw, csrfToken, verifyCsrfToken, csrfGuard, csrfHmac,
	signCookie, unsignCookie, setSignedCookie, readSignedCookie,
	securityHeaders, corsHeaders, corsPreflight,
	createRateLimiter, getClientIp, getClientProtocol, applyTrustProxy,
	redactLog, setRedactLogging, securityComment,
	prettifyHtml, extractTopLevelNames, extractRuntimeNames, evalTopLevelCode,
	safeJsonForScript, quoteAttr, randomToken, assertSameOrigin, DEFAULT_MAX_BODY_BYTES,
} from '@vesk/compiler/src/server-utils';

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
		toBeGreaterThan(expected) { if (actual <= expected) throw new Error(`Expected ${actual} > ${expected}`); },
		toBeUndefined() { if (actual !== undefined) throw new Error(`Expected undefined, got ${JSON.stringify(actual)}`); },
		toContain(expected) { if (!String(actual).includes(expected)) throw new Error(`Expected "${actual}" to contain "${expected}"`); },
		notToContain(expected) { if (String(actual).includes(expected)) throw new Error(`Expected "${actual}" not to contain "${expected}"`); },
		not: {
			toContain(expected) { if (String(actual).includes(expected)) throw new Error(`Expected "${actual}" not to contain "${expected}"`); },
		},
		toBeInstanceOf(cls) { if (!(actual instanceof cls)) throw new Error(`Expected instance of ${cls.name}`); },
	};
}

// ── HTML escaping ────────────────────────────────────────────────

describe('escapeHtml', () => {

	it('escapes & < > " \'', () => {
		expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
	});

	it('passes through safe strings', () => {
		expect(escapeHtml('hello world')).toBe('hello world');
	});

	it('escapes mixed content', () => {
		expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
	});
});

// ── CSRF ─────────────────────────────────────────────────────────

describe('CSRF', () => {

	it('csrfToken produces a signed token', () => {
		const token = csrfToken('session123', 'test.com');
		expect(token).toContain(':');
		const parts = token.split(':');
		expect(parts[0]).toBe('session123');
		expect(parts[1].length).toBeGreaterThan(0);
	});

	it('verifyCsrfToken validates a valid token', () => {
		const token = csrfToken('session123', 'test.com');
		expect(verifyCsrfToken(token, 'test.com')).toBe(true);
	});

	it('verifyCsrfToken rejects tampered token', () => {
		const token = csrfToken('session123', 'test.com');
		const tampered = token.slice(0, -1) + (token.endsWith('x') ? 'y' : 'x');
		expect(verifyCsrfToken(tampered, 'test.com')).toBe(false);
	});

	it('verifyCsrfToken rejects empty/malformed tokens', () => {
		expect(verifyCsrfToken('', 'test.com')).toBe(false);
		expect(verifyCsrfToken(null, 'test.com')).toBe(false);
		expect(verifyCsrfToken('invalid', 'test.com')).toBe(false);
	});

	it('verifyCsrfToken rejects token from different host', () => {
		const token = csrfToken('session123', 'host-a.com');
		expect(verifyCsrfToken(token, 'host-b.com')).toBe(false);
	});

	it('csrfGuard passes GET requests', () => {
		const req = { method: 'GET', headers: {} };
		csrfGuard(req); // should not throw
	});

	it('csrfGuard passes HEAD requests', () => {
		const req = { method: 'HEAD', headers: {} };
		csrfGuard(req); // should not throw
	});

	it('csrfGuard passes OPTIONS requests', () => {
		const req = { method: 'OPTIONS', headers: {} };
		csrfGuard(req); // should not throw
	});

	it('csrfGuard throws on POST without token', () => {
		const req = { method: 'POST', headers: {} };
		let threw = false;
		try { csrfGuard(req); } catch { threw = true; }
		expect(threw).toBe(true);
	});

	it('csrfGuard passes POST with valid header token', () => {
		const token = csrfToken('session123', 'test.com');
		const req = { method: 'POST', headers: { 'x-csrf-token': token, host: 'test.com' } };
		csrfGuard(req, 'test.com'); // should not throw
	});

	it('csrfGuard throws on PUT without token', () => {
		const req = { method: 'PUT', headers: {} };
		let threw = false;
		try { csrfGuard(req); } catch { threw = true; }
		expect(threw).toBe(true);
	});

	it('csrfGuard throws on DELETE without token', () => {
		const req = { method: 'DELETE', headers: {} };
		let threw = false;
		try { csrfGuard(req); } catch { threw = true; }
		expect(threw).toBe(true);
	});
});

// ── Signed cookies ──────────────────────────────────────────────

describe('signCookie / unsignCookie', () => {

	it('signCookie produces a signed value with dot separator', async () => {
		const signed = await signCookie('session', 'abc123', 'example.com');
		expect(signed).toContain('.');
		expect(signed.startsWith('abc123.')).toBe(true);
	});

	it('unsignCookie returns original value on valid signature', async () => {
		const signed = await signCookie('user', 'joe', 'test.com');
		const unsigned = await unsignCookie('user', signed, 'test.com');
		expect(unsigned).toBe('joe');
	});

	it('unsignCookie returns null on tampered value', async () => {
		const signed = await signCookie('user', 'joe', 'test.com');
		const tampered = signed.replace('joe', 'evil');
		const unsigned = await unsignCookie('user', tampered, 'test.com');
		expect(unsigned).toBeNull();
	});

	it('unsignCookie returns null on garbage input', async () => {
		expect(await unsignCookie('user', 'garbage', 'test.com')).toBeNull();
		expect(await unsignCookie('user', '', 'test.com')).toBeNull();
		expect(await unsignCookie('user', null, 'test.com')).toBeNull();
	});

	it('different hosts produce different signatures', async () => {
		const a = await signCookie('x', 'v', 'host-a');
		const b = await signCookie('x', 'v', 'host-b');
		expect(a).not.toBe(b);
	});
});

describe('setSignedCookie / readSignedCookie', () => {

	it('setSignedCookie produces Set-Cookie header string', async () => {
		const header = await setSignedCookie('session', 'abc123', {}, 'test.com');
		expect(header).toContain('session=');
		expect(header).toContain('HttpOnly');
		expect(header).toContain('Secure');
		expect(header).toContain('SameSite=');
		expect(header).toContain('Path=/');
	});

	it('setSignedCookie respects custom options', async () => {
		const header = await setSignedCookie('theme', 'dark', {
			httpOnly: false, secure: false, sameSite: 'Strict', path: '/app', maxAge: 3600, domain: 'ex.com',
		}, 'test.com');
		expect(header).not.toContain('HttpOnly');
		expect(header).not.toContain('Secure');
		expect(header).toContain('SameSite=Strict');
		expect(header).toContain('Path=/app');
		expect(header).toContain('Max-Age=3600');
		expect(header).toContain('Domain=ex.com');
	});

	it('readSignedCookie reads and verifies from cookie string', async () => {
		const signed = await signCookie('session', 'secret', 'host');
		const cookieStr = `session=${signed}; other=val`;
		const result = await readSignedCookie('session', cookieStr, 'host');
		expect(result).toBe('secret');
	});

	it('readSignedCookie returns null for missing cookie', async () => {
		const result = await readSignedCookie('missing', 'a=1', 'host');
		expect(result).toBeNull();
	});

	it('readSignedCookie returns null for tampered cookie', async () => {
		const result = await readSignedCookie('session', 'session=tampered.sig', 'host');
		expect(result).toBeNull();
	});

	it('readSignedCookie returns null for empty string', async () => {
		expect(await readSignedCookie('x', '', 'host')).toBeNull();
		expect(await readSignedCookie('x', null, 'host')).toBeNull();
	});
});

// ── Security Headers (CSP) ──────────────────────────────────────

describe('securityHeaders', () => {

	it('returns default security headers', () => {
		const h = securityHeaders();
		expect(h['X-Frame-Options']).toBe('DENY');
		expect(h['X-Content-Type-Options']).toBe('nosniff');
		expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
		expect(h['Strict-Transport-Security']).toContain('max-age=31536000');
		expect(h['Content-Security-Policy']).toContain("default-src 'self'");
	});

	it('includes CSP by default', () => {
		const h = securityHeaders();
		expect(h['Content-Security-Policy']).toContain("script-src 'self'");
		expect(h['Content-Security-Policy']).toContain("style-src 'self' 'unsafe-inline'");
		expect(h['Content-Security-Policy']).toContain("object-src 'none'");
		expect(h['Content-Security-Policy']).toContain("form-action 'self'");
	});

	it('CSP false disables CSP header', () => {
		const h = securityHeaders({ security: { contentSecurityPolicy: false } });
		expect(h['Content-Security-Policy']).toBeUndefined();
	});

	it('custom CSP policy is used', () => {
		const custom = "default-src 'none'; script-src 'self'";
		const h = securityHeaders({ security: { contentSecurityPolicy: custom } });
		expect(h['Content-Security-Policy']).toBe(custom);
	});

	it('HSTS false disables HSTS', () => {
		const h = securityHeaders({ security: { hsts: false } });
		expect(h['Strict-Transport-Security']).toBeUndefined();
	});

	it('custom HSTS value', () => {
		const h = securityHeaders({ security: { hsts: 'max-age=63072000' } });
		expect(h['Strict-Transport-Security']).toBe('max-age=63072000');
	});

	it('custom xFrameOptions', () => {
		const h = securityHeaders({ security: { xFrameOptions: 'SAMEORIGIN' } });
		expect(h['X-Frame-Options']).toBe('SAMEORIGIN');
	});

	it('custom referrerPolicy', () => {
		const h = securityHeaders({ security: { referrerPolicy: 'no-referrer' } });
		expect(h['Referrer-Policy']).toBe('no-referrer');
	});
});

// ── Rate Limiting ───────────────────────────────────────────────

describe('createRateLimiter', () => {

	it('allows requests under the limit', () => {
		const limiter = createRateLimiter({ windowMs: 60000, max: 10 });
		for (let i = 0; i < 10; i++) {
			expect(limiter.check('test-ip')).toBe(true);
		}
	});

	it('blocks requests over the limit', () => {
		const limiter = createRateLimiter({ windowMs: 60000, max: 3 });
		expect(limiter.check('block-ip')).toBe(true);
		expect(limiter.check('block-ip')).toBe(true);
		expect(limiter.check('block-ip')).toBe(true);
		expect(limiter.check('block-ip')).toBe(false);
		expect(limiter.check('block-ip')).toBe(false);
	});

	it('different keys have independent counters', () => {
		const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
		expect(limiter.check('ip-a')).toBe(true);
		expect(limiter.check('ip-a')).toBe(true);
		expect(limiter.check('ip-a')).toBe(false);
		expect(limiter.check('ip-b')).toBe(true);
		expect(limiter.check('ip-b')).toBe(true);
		expect(limiter.check('ip-b')).toBe(false);
	});

	it('reset clears counter for a key', () => {
		const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
		expect(limiter.check('reset-ip')).toBe(true);
		expect(limiter.check('reset-ip')).toBe(false);
		limiter.reset('reset-ip');
		expect(limiter.check('reset-ip')).toBe(true);
	});

	it('remaining returns correct count', () => {
		const limiter = createRateLimiter({ windowMs: 60000, max: 5 });
		expect(limiter.remaining('rem-ip')).toBe(5);
		limiter.check('rem-ip');
		expect(limiter.remaining('rem-ip')).toBe(4);
		limiter.check('rem-ip');
		limiter.check('rem-ip');
		expect(limiter.remaining('rem-ip')).toBe(2);
	});

	it('getConfig returns windowMs and max', () => {
		const limiter = createRateLimiter({ windowMs: 10000, max: 50 });
		const cfg = limiter.getConfig();
		expect(cfg.windowMs).toBe(10000);
		expect(cfg.max).toBe(50);
	});

	it('middleware returns true when under limit', () => {
		const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
		const req = { headers: { 'x-forwarded-for': '10.0.0.1' } };
		expect(limiter.middleware(req)).toBe(true);
	});

	it('middleware returns false when over limit', () => {
		const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
		const req = { headers: { 'x-forwarded-for': '10.0.0.2' } };
		expect(limiter.middleware(req)).toBe(true);
		expect(limiter.middleware(req)).toBe(false);
	});

	it('handles missing or null key gracefully', () => {
		const limiter = createRateLimiter({ windowMs: 60000, max: 1 });
		expect(limiter.check(null)).toBe(true);
		expect(limiter.check(undefined)).toBe(true);
	});
});

// ── trustProxy ──────────────────────────────────────────────────

describe('trustProxy', () => {

	it('getClientIp returns x-forwarded-for when trustProxy is true', () => {
		const req = { headers: { 'x-forwarded-for': '203.0.113.42, 10.0.0.1' } };
		expect(getClientIp(req, true)).toBe('203.0.113.42');
	});

	it('getClientIp returns x-real-ip when forwarded not available', () => {
		const req = { headers: { 'x-real-ip': '198.51.100.7' } };
		expect(getClientIp(req, true)).toBe('198.51.100.7');
	});

	it('getClientIp ignores x-forwarded-for when trustProxy is false (no spoofing)', () => {
		const req = { headers: { 'x-forwarded-for': '203.0.113.42' } };
		const ip = getClientIp(req, false);
		expect(ip).toBe('unknown');
	});

	it('getClientIp honors cf-connecting-ip only with trustProxy', () => {
		const req = { headers: { 'cf-connecting-ip': '198.51.100.9' } };
		expect(getClientIp(req, true)).toBe('198.51.100.9');
		expect(getClientIp(req, false)).toBe('unknown');
	});

	it('getClientProtocol ignores x-forwarded-proto without trustProxy', () => {
		const req = { headers: { 'x-forwarded-proto': 'https' } };
		expect(getClientProtocol(req, false)).toBe('http');
	});

	it('getClientProtocol returns https from x-forwarded-proto', () => {
		const req = { headers: { 'x-forwarded-proto': 'https' } };
		expect(getClientProtocol(req, true)).toBe('https');
	});

	it('getClientProtocol returns http by default', () => {
		const req = { headers: {} };
		expect(getClientProtocol(req, true)).toBe('http');
	});

	it('getClientProtocol returns first value from comma-separated', () => {
		const req = { headers: { 'x-forwarded-proto': 'https, http' } };
		expect(getClientProtocol(req, true)).toBe('https');
	});

	it('applyTrustProxy enriches context with ip, protocol, host', () => {
		const ctx = { headers: { 'x-forwarded-for': '10.0.0.5', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'cdn.example.com' }, host: 'localhost' };
		applyTrustProxy(ctx, true);
		expect(ctx.ip).toBe('10.0.0.5');
		expect(ctx.protocol).toBe('https');
		expect(ctx.host).toBe('cdn.example.com');
	});

	it('applyTrustProxy does nothing when trustProxy is false', () => {
		const ctx = { headers: { 'x-forwarded-for': '10.0.0.5' } };
		applyTrustProxy(ctx, false);
		expect(ctx.ip).toBeUndefined();
	});

	it('applyTrustProxy does nothing for null ctx', () => {
		applyTrustProxy(null, true);
		applyTrustProxy(undefined, true);
	});
});

// ── CORS ────────────────────────────────────────────────────────

describe('corsHeaders', () => {

	it('returns empty for same-origin requests', () => {
		const h = corsHeaders({ cors: { origin: ['https://app.com'] } }, 'https://app.com', 'app.com');
		expect(h).toEqual({});
	});

	it('returns CORS headers for allowed cross-origin', () => {
		const h = corsHeaders({ cors: { origin: ['https://other.com'] } }, 'https://other.com', 'app.com');
		expect(h['Access-Control-Allow-Origin']).toBe('https://other.com');
		expect(h['Access-Control-Allow-Methods']).toBe('GET,POST,PUT,DELETE,PATCH,OPTIONS');
	});

	it('returns empty for disallowed origin', () => {
		const h = corsHeaders({ cors: { origin: ['https://allowed.com'] } }, 'https://evil.com', 'app.com');
		expect(h).toEqual({});
	});

	it('handles wildcard origin', () => {
		const h = corsHeaders({ cors: { origin: ['*'] } }, 'https://anything.com', 'app.com');
		expect(h['Access-Control-Allow-Origin']).toBe('*');
	});

	it('returns empty when no origin header', () => {
		const h = corsHeaders({ cors: { origin: ['*'] } }, '', 'app.com');
		expect(h).toEqual({});
	});

	it('returns empty when CORS not configured', () => {
		const h = corsHeaders({}, 'https://other.com', 'app.com');
		expect(h).toEqual({});
	});

	it('uses custom methods and headers', () => {
		const h = corsHeaders({ cors: { origin: ['https://x.com'], methods: 'GET', headers: 'X-Custom' } }, 'https://x.com', 'y.com');
		expect(h['Access-Control-Allow-Methods']).toBe('GET');
		expect(h['Access-Control-Allow-Headers']).toBe('X-Custom');
	});
});

// ── Log Redaction ────────────────────────────────────────────────

describe('redactLog', () => {

	it('redacts API keys in strings', () => {
		const key = 'sk_live_' + 'abcdefghijklmnopqrstuvwxyz123456';
		const result = redactLog('api_key=' + key);
		expect(result).not.toContain('sk_live_abcdef');
		expect(result).toContain('sk_live_***');
	});

	it('redacts Bearer tokens', () => {
		const result = redactLog('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0');
		expect(result).not.toContain('eyJ');
		expect(result).toContain('Bearer ***');
	});

	it('redacts password-like values', () => {
		const result = redactLog('password=supersecret123!');
		expect(result).not.toContain('supersecret');
		expect(result).toContain('password=');
	});

	it('redacts private keys', () => {
		const result = redactLog('-----BEGIN RSA PRIVATE KEY-----\nABCDEF1234\n-----END RSA PRIVATE KEY-----');
		expect(result).toContain('-----BEGIN RSA PRIVATE KEY-----***-----END RSA PRIVATE KEY-----');
	});

	it('passes through safe strings unchanged', () => {
		const safe = 'Hello world, this is safe to log.';
		expect(redactLog(safe)).toBe(safe);
	});

	it('handles null/undefined gracefully', () => {
		expect(redactLog(null)).toBeNull();
		expect(redactLog(undefined)).toBeUndefined();
	});

	it('redacts GitHub tokens', () => {
		const ghtok = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz1234567890';
		const result = redactLog(ghtok);
		expect(result).toContain('ghp_***');
	});

	it('redacts Slack tokens', () => {
		const token = 'xoxb-' + '1234567890-abcdefghijklmnopqrstuvwxyz';
		const result = redactLog(token);
		expect(result).toContain('xox-***');
	});

	it('redacts Authorization Basic header', () => {
		const result = redactLog('Authorization: Basic dXNlcjpwYXNzd29yZA==');
		expect(result).toContain('Basic ***');
	});
});

// ── Config / DefineConfig ──────────────────────────────────────

describe('securityComment', () => {

	it('includes auto-escape and csrf by default', () => {
		const comment = securityComment({ security: {} });
		expect(comment).toContain('auto-escape');
		expect(comment).toContain('csrf');
	});

	it('includes hsts and x-frame-options by default', () => {
		const comment = securityComment({ security: {} });
		expect(comment).toContain('hsts');
		expect(comment).toContain('x-frame-options');
	});

	it('includes csp when enabled', () => {
		const comment = securityComment({ security: { contentSecurityPolicy: "default-src 'self'" } });
		expect(comment).toContain('csp');
	});

	it('includes trust-proxy when enabled', () => {
		const comment = securityComment({ security: { trustProxy: true } });
		expect(comment).toContain('trust-proxy');
	});

	it('excludes disabled features', () => {
		const comment = securityComment({ security: { csrf: false, autoEscape: false } });
		expect(comment).not.toContain('csrf');
		expect(comment).not.toContain('auto-escape');
	});
});

// ── prettifyHtml ─────────────────────────────────────────────────

describe('prettifyHtml', () => {

	it('indents nested elements and text', () => {
		const out = prettifyHtml('<div><span>a</span></div>');
		expect(out).toBe('<div>\n\t<span>\n\t\ta\n\t</span>\n</div>');
	});

	it('does not break on > inside quoted attributes', () => {
		const out = prettifyHtml('<img alt="a > b" src="x.png" />');
		expect(out).toContain('alt="a > b"');
		expect(out).toContain('<img');
	});

	it('does not treat > inside unquoted data as a tag boundary', () => {
		const out = prettifyHtml('<div data-x="1>0">text</div>');
		expect(out).toContain('data-x="1>0"');
	});

	it('does not merge text and tag across > < like the old replace did', () => {
		const out = prettifyHtml('<p>a > <b</p>');
		expect(out).toContain('a >');
		expect(out).toContain('<p>');
		expect(out).toContain('</p>');
	});

	it('handles comments and raw text elements', () => {
		const out = prettifyHtml('<!-- c --><style>.a > .b { }</style>');
		expect(out).toContain('<!-- c -->');
		expect(out).toContain('.a > .b');
	});
});

// ── Top-level code extraction / evaluation ───────────────────────

describe('extractTopLevelNames', () => {

	it('extracts const, let and var names', () => {
		expect(extractTopLevelNames(['const x = 1', 'let y = 2', 'var z = 3'])).toEqual(['x', 'y', 'z']);
	});

	it('extracts exported declarations', () => {
		expect(extractTopLevelNames(['export const x = 1'])).toEqual(['x']);
	});

	it('extracts function names', () => {
		expect(extractTopLevelNames(['export async function load() {}'])).toEqual(['load']);
	});

	it('does not split destructured names like the old regex did', () => {
		expect(extractTopLevelNames(['const { a, b } = props'])).toEqual([]);
	});
});

describe('extractRuntimeNames', () => {

	it('extracts named imports from @vesk/runtime', () => {
		expect(extractRuntimeNames(["import { get, set, track as t } from '@vesk/runtime';"]))
			.toEqual(['get', 'set', 't']);
	});

	it('extracts default imports', () => {
		expect(extractRuntimeNames(["import Vesk from '@vesk/runtime';"])).toEqual(['Vesk']);
	});

	it('skips imports of other modules', () => {
		expect(extractRuntimeNames(["import { x } from 'other-pkg';"])).toEqual([]);
	});
});

describe('evalTopLevelCode', () => {

	it('evaluates const declarations', () => {
		const scope = {};
		evalTopLevelCode(['const answer = 40 + 2;'], scope);
		expect(scope.answer).toBe(42);
	});

	it('evaluates const initializers with nested parens and ternaries', () => {
		const scope = {};
		evalTopLevelCode(['const label = (true ? "yes" : "no") + "!";'], scope);
		expect(scope.label).toBe('yes!');
	});

	it('evaluates async function declarations', () => {
		const scope = {};
		evalTopLevelCode(['export async function load() { return 7; }'], scope);
		expect(typeof scope.load).toBe('function');
	});

	it('evaluates functions with params', () => {
		const scope = {};
		evalTopLevelCode(['function add(a, b) { return a + b; }'], scope);
		expect(scope.add(2, 3)).toBe(5);
	});

	it('skips code it cannot evaluate', () => {
		const scope = {};
		evalTopLevelCode(['const broken = (;'], scope);
		expect(scope.broken).toBeUndefined();
	});
});

// ── Script-safe serialization (XSS regression) ───────────────────

describe('safeJsonForScript', () => {

	it('escapes </script> breakouts', () => {
		const json = JSON.stringify({ bio: '</script><script>alert(1)</script>' });
		const safe = safeJsonForScript(json);
		expect(safe.includes('</script>')).toBe(false);
		expect(safe.includes('\\u003c')).toBe(true);
		expect(JSON.parse(safe)).toEqual({ bio: '</script><script>alert(1)</script>' });
	});

	it('escapes U+2028/U+2029 line separators', () => {
		const ls = String.fromCharCode(0x2028);
		const ps = String.fromCharCode(0x2029);
		const json = JSON.stringify({ note: 'a' + ls + 'b' + ps + 'c' });
		const safe = safeJsonForScript(json);
		expect(safe.includes(ls)).toBe(false);
		expect(safe.includes(ps)).toBe(false);
		expect(JSON.parse(safe).note).toBe('a' + ls + 'b' + ps + 'c');
	});

	it('escapes every < while leaving other JSON syntax intact', () => {
		const json = '{"tag":"<b>","rest":"a>b & c"}';
		expect(safeJsonForScript(json)).toBe('{"tag":"\\u003cb>","rest":"a>b & c"}');
	});
});

function isHexOf(s, len) {
	if (s.length !== len) return false;
	for (const c of s) { if (!'0123456789abcdef'.includes(c)) return false; }
	return true;
}

describe('quoteAttr / randomToken / DEFAULT_MAX_BODY_BYTES', () => {
	it('quoteAttr escapes double quotes only', () => {
		expect(quoteAttr('a"b c')).toBe('a&quot;b c');
	});

	it('randomToken is hex, long and unique', () => {
		const a = randomToken(16);
		const b = randomToken(16);
		expect(a.length).toBe(32);
		expect(isHexOf(a, 32)).toBe(true);
		expect(a === b).toBe(false);
	});

	it('DEFAULT_MAX_BODY_BYTES is 1 MiB', () => {
		expect(DEFAULT_MAX_BODY_BYTES).toBe(1024 * 1024);
	});
});

// ── CSRF crypto strength ─────────────────────────────────────────

function throwsWithStatus(fn, wantStatus) {
	try { fn(); return false; }
	catch (e) { return wantStatus === undefined ? true : e.status === wantStatus; }
}

describe('csrfHmac (HMAC-SHA256)', () => {

	it('produces a full-length deterministic digest', () => {
		const a = csrfHmac('session123', 'secret');
		const b = csrfHmac('session123', 'secret');
		expect(a).toBe(b);
		expect(a.length).toBe(64);
		expect(isHexOf(a, 64)).toBe(true);
	});

	it('differs per value and per secret', () => {
		expect(csrfHmac('a', 's') === csrfHmac('b', 's')).toBe(false);
		expect(csrfHmac('a', 's') === csrfHmac('a', 't')).toBe(false);
	});

	it('matches the RFC 4231 HMAC-SHA256 test vector', () => {
		// HMAC-SHA256(key='key', msg='The quick brown fox jumps over the lazy dog')
		expect(csrfHmac('The quick brown fox jumps over the lazy dog', 'key'))
			.toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
	});

	it('tokens have value:hex-signature shape', () => {
		const token = csrfToken('sess', 'h');
		const colon = token.indexOf(':');
		const value = token.slice(0, colon);
		const sig = token.slice(colon + 1);
		expect(value).toBe('sess');
		expect(sig.length).toBe(64);
		expect(isHexOf(sig, 64)).toBe(true);
		expect(verifyCsrfToken(token, 'h')).toBe(true);
	});
});

// ── Same-origin CSRF defense ─────────────────────────────────────

describe('assertSameOrigin', () => {

	const post = (headers) => ({ method: 'POST', headers });

	it('allows safe methods regardless of headers', () => {
		expect(throwsWithStatus(() => assertSameOrigin({ method: 'GET', headers: { origin: 'https://evil.com' } }))).toBe(false);
		expect(throwsWithStatus(() => assertSameOrigin({ method: 'HEAD', headers: { origin: 'https://evil.com' } }))).toBe(false);
		expect(throwsWithStatus(() => assertSameOrigin({ method: 'OPTIONS', headers: { origin: 'https://evil.com' } }))).toBe(false);
	});

	it('allows POST without Origin/Referer (non-browser client)', () => {
		expect(throwsWithStatus(() => assertSameOrigin(post({ host: 'app.com' })))).toBe(false);
	});

	it('allows same-origin POST via Origin header', () => {
		expect(throwsWithStatus(() => assertSameOrigin(post({ host: 'app.com', origin: 'https://app.com' })))).toBe(false);
		expect(throwsWithStatus(() => assertSameOrigin(post({ host: 'localhost:3000', origin: 'http://localhost:3000' })))).toBe(false);
	});

	it('allows same-origin POST via Referer when Origin missing', () => {
		expect(throwsWithStatus(() => assertSameOrigin(post({ host: 'app.com', referer: 'https://app.com/page?x=1' })))).toBe(false);
	});

	it('blocks cross-site POST with mismatched Origin (403)', () => {
		expect(throwsWithStatus(() => assertSameOrigin(post({ host: 'app.com', origin: 'https://evil.com' })), 403)).toBe(true);
	});

	it('blocks cross-site POST with mismatched Referer', () => {
		expect(throwsWithStatus(() => assertSameOrigin(post({ host: 'app.com', referer: 'https://evil.com/csrf' })))).toBe(true);
	});

	it('tolerates one-sided port presence but never a different hostname', () => {
		expect(throwsWithStatus(() => assertSameOrigin(post({ host: 'app.com', origin: 'http://app.com:8080' })))).toBe(false);
		expect(throwsWithStatus(() => assertSameOrigin(post({ host: 'app.com:8080', origin: 'https://app.com' })))).toBe(false);
		expect(throwsWithStatus(() => assertSameOrigin(post({ host: 'app.com:8080', origin: 'https://app.com:9090' })))).toBe(true);
		expect(throwsWithStatus(() => assertSameOrigin(post({ host: 'app.com', origin: 'https://eviller.com' })))).toBe(true);
	});

	it('accepts Headers-like objects (web Request style)', () => {
		const ok = new Headers({ host: 'app.com', origin: 'https://app.com' });
		const bad = new Headers({ host: 'app.com', origin: 'https://evil.com' });
		expect(throwsWithStatus(() => assertSameOrigin({ method: 'POST', headers: ok }))).toBe(false);
		expect(throwsWithStatus(() => assertSameOrigin({ method: 'POST', headers: bad }))).toBe(true);
	});
});

// ── CORS credentials opt-in ──────────────────────────────────────

describe('corsHeaders credentials default', () => {

	it('does not send Allow-Credentials by default', () => {
		const h = corsHeaders({ cors: { origin: ['https://other.com'] } }, 'https://other.com', 'app.com');
		expect(h['Access-Control-Allow-Credentials']).toBeUndefined();
	});

	it('sends Allow-Credentials only when explicitly enabled', () => {
		const h = corsHeaders({ cors: { origin: ['https://other.com'], credentials: true } }, 'https://other.com', 'app.com');
		expect(h['Access-Control-Allow-Credentials']).toBe('true');
	});

	it('never combines credentials with wildcard origin', () => {
		const h = corsHeaders({ cors: { origin: ['*'], credentials: true } }, 'https://x.com', 'app.com');
		expect(h['Access-Control-Allow-Credentials']).toBeUndefined();
	});
});

// ── Rate limiter trustProxy ──────────────────────────────────────

describe('createRateLimiter trustProxy', () => {

	it('ignores spoofed x-forwarded-for by default (all clients share key "unknown")', () => {
		const rl = createRateLimiter({ windowMs: 1000, max: 2, cleanupIntervalMs: 10000 });
		const spoofed = { headers: { 'x-forwarded-for': '1.2.3.4' } };
		expect(rl.middleware(spoofed)).toBe(true);
		expect(rl.middleware(spoofed)).toBe(true);
		expect(rl.middleware(spoofed)).toBe(false); // limited — header ignored
	});

	it('honors proxy headers only with trustProxy', () => {
		const rl = createRateLimiter({ windowMs: 1000, max: 2, cleanupIntervalMs: 10000, trustProxy: true });
		const a = { headers: { 'x-forwarded-for': '1.1.1.1' } };
		const b = { headers: { 'x-forwarded-for': '2.2.2.2' } };
		expect(rl.middleware(a)).toBe(true);
		expect(rl.middleware(a)).toBe(true);
		expect(rl.middleware(a)).toBe(false);
		expect(rl.middleware(b)).toBe(true); // separate bucket
	});
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
