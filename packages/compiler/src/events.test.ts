import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { collectEventsFile, isEventsFile, loadEvents, runEventHandlers } from '@vesk/compiler/src/events';

let passed = 0;
let failed = 0;
const pending: Promise<void>[] = [];

function test(name: string, fn: () => void | Promise<void>) {
	const p = Promise.resolve()
		.then(fn)
		.then(() => { passed++; console.log(`  ✓ ${name}`); })
		.catch((e) => { failed++; console.log(`  ✗ ${name} — ${e.message}`); });
	pending.push(p);
	return p;
}

function expect(actual: unknown) {
	return {
		toBe(expected: unknown) {
			if (actual !== expected) throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		},
		toBeTruthy() { if (!actual) throw new Error(`expected truthy, got ${String(actual)}`); },
		toBeNull() { if (actual !== null && actual !== undefined) throw new Error(`expected null, got ${JSON.stringify(actual)}`); },
	};
}

function createFixture(files: Record<string, string>) {
	const tmp = mkdtempSync('/tmp/vesk-events-test-');
	for (const [path, content] of Object.entries(files)) {
		const fullPath = join(tmp, path);
		mkdirSync(join(fullPath, '..'), { recursive: true });
		writeFileSync(fullPath, content || '');
	}
	return tmp;
}

function cleanup(tmp: string) {
	try { rmSync(tmp, { recursive: true }); } catch {}
}

console.log('Events file location\n');

test('collectEventsFile returns null when no events file exists', () => {
	const tmp = createFixture({ 'app/page.vsk': '' });
	expect(collectEventsFile(join(tmp, 'app'))).toBeNull();
	cleanup(tmp);
});

test('collectEventsFile finds _events.ts and prefers it over _events.js', () => {
	const tmp = createFixture({
		'app/_events.ts': 'export function onStart() {}',
		'app/_events.js': 'export function onStart() {}',
	});
	const found = collectEventsFile(join(tmp, 'app'));
	expect(found?.endsWith('_events.ts')).toBe(true);
	cleanup(tmp);
});

test('collectEventsFile finds _events.js when there is no TS file', () => {
	const tmp = createFixture({ 'app/_events.js': 'export function onStop() {}' });
	const found = collectEventsFile(join(tmp, 'app'));
	expect(found?.endsWith('_events.js')).toBe(true);
	cleanup(tmp);
});

test('isEventsFile recognizes events files but not middleware/routes', () => {
	expect(isEventsFile('/tmp/app/_events.ts')).toBe(true);
	expect(isEventsFile('/tmp/app/_events.js')).toBe(true);
	expect(isEventsFile('/tmp/app/middleware.ts')).toBe(false);
	expect(isEventsFile('/tmp/app/api/route.ts')).toBe(false);
	expect(isEventsFile('/tmp/app/page.vsk')).toBe(false);
});

console.log('\nEvents loading\n');

test('loadEvents extracts onStart/onRequest/onStop handlers', async () => {
	const tmp = createFixture({
		'app/_events.ts': [
			'export async function onStart(ctx) { await ctx.set(\'booted\', true); }',
			'export async function onRequest() {}',
			'export function onStop() {}',
		].join('\n'),
	});
	const handlers = await loadEvents(join(tmp, 'app/_events.ts'));
	expect(typeof handlers.onStart).toBe('function');
	expect(typeof handlers.onRequest).toBe('function');
	expect(typeof handlers.onStop).toBe('function');
	cleanup(tmp);
});

test('loadEvents returns {} for a file without handlers', async () => {
	const tmp = createFixture({ 'app/_events.ts': 'export const foo = 1;' });
	const handlers = await loadEvents(join(tmp, 'app/_events.ts'));
	expect(handlers.onStart).toBe(undefined);
	expect(handlers.onRequest).toBe(undefined);
	expect(handlers.onStop).toBe(undefined);
	cleanup(tmp);
});

test('loadEvents tolerates a missing file', async () => {
	const tmp = createFixture({});
	const handlers = await loadEvents(join(tmp, 'app/_events.ts'));
	expect(handlers.onStart).toBe(undefined);
	cleanup(tmp);
});

test('loadEvents reloads edited events without serving a stale module', async () => {
	const tmp = createFixture({
		'app/_events.ts': 'export async function onStart(ctx) { ctx.set(\'v\', 1); }',
	});
	const p = join(tmp, 'app/_events.ts');
	const first = await loadEvents(p);
	const ctxA: Record<string, unknown> = { locals: {}, set(k: string, v: unknown) { this.locals[k] = v; }, get(k: string) { return this.locals[k]; } };
	await runEventHandlers(first, 'onStart', ctxA);
	expect((ctxA.locals as Record<string, unknown>).v).toBe(1);

	writeFileSync(p, 'export async function onStart(ctx) { ctx.set(\'v\', 2); }');
	const second = await loadEvents(p);
	const ctxB: Record<string, unknown> = { locals: {}, set(k: string, v: unknown) { this.locals[k] = v; }, get(k: string) { return this.locals[k]; } };
	await runEventHandlers(second, 'onStart', ctxB);
	expect((ctxB.locals as Record<string, unknown>).v).toBe(2);
	cleanup(tmp);
});

console.log('\nEvents execution\n');

test('runEventHandlers calls the named handler with the context', async () => {
	const seen: string[] = [];
	const handlers = {
		onStart: async () => { seen.push('start'); },
		onRequest: async () => { seen.push('request'); },
		onStop: async () => { seen.push('stop'); },
	};
	await runEventHandlers(handlers, 'onStart', {});
	await runEventHandlers(handlers, 'onRequest', {});
	await runEventHandlers(handlers, 'onStop', {});
	expect(seen.join(',')).toBe('start,request,stop');
});

test('runEventHandlers is a no-op when the handler is absent', async () => {
	const handlers = {};
	await runEventHandlers(handlers, 'onStart', {});
	await runEventHandlers(handlers, 'onRequest', {});
	await runEventHandlers(handlers, 'onStop', {});
	expect(true).toBe(true);
});

test('runEventHandlers passes the context through to the handler', async () => {
	let ctxPassed: Record<string, unknown> | null = null;
	const handlers = { onRequest: async (ctx: Record<string, unknown>) => { ctxPassed = ctx; } };
	const ctx = { locals: {} };
	await runEventHandlers(handlers, 'onRequest', ctx);
	expect(ctxPassed === ctx).toBe(true);
});

await Promise.all(pending);

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
console.log('All events tests passed!');