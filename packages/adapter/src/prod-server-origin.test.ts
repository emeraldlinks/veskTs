import type { IncomingMessage } from 'node:http';
import { resolveRequestUrl } from '@vesk/adapter/src/prod-server';

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void) {
	try {
		fn();
		passed++;
		console.log(`  ✓ ${name}`);
	} catch (e: unknown) {
		failed++;
		console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
	}
}

function request(url: string, headers: Record<string, string>): IncomingMessage {
	return { url, headers, socket: {} } as unknown as IncomingMessage;
}

function expectEqual(actual: string, expected: string): void {
	if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

it('uses the Host header as the request origin', () => {
	const url = resolveRequestUrl(
		request('/api/auth/callback/google?code=x', { host: 'academy.example' }),
		3001,
		false,
	);
	expectEqual(url.href, 'http://academy.example/api/auth/callback/google?code=x');
	expectEqual(url.origin, 'http://academy.example');
});

it('honors forwarded host and proto when the proxy is trusted', () => {
	const url = resolveRequestUrl(
		request('/public/login', {
			host: 'internal:3001',
			'x-forwarded-host': 'academy.example',
			'x-forwarded-proto': 'https',
		}),
		3001,
		true,
	);
	expectEqual(url.origin, 'https://academy.example');
});

it('ignores forwarded headers when the proxy is not trusted', () => {
	const url = resolveRequestUrl(
		request('/public/login', {
			host: 'internal:3001',
			'x-forwarded-host': 'academy.example',
			'x-forwarded-proto': 'https',
		}),
		3001,
		false,
	);
	expectEqual(url.origin, 'http://internal:3001');
});

it('falls back to localhost when no Host header is present', () => {
	const url = resolveRequestUrl(request('/healthz', {}), 4321, false);
	expectEqual(url.origin, 'http://localhost:4321');
});

it('falls back to localhost when the Host header is malformed', () => {
	const url = resolveRequestUrl(request('/healthz', { host: 'bad host:not-a-port' }), 4321, false);
	expectEqual(url.origin, 'http://localhost:4321');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
