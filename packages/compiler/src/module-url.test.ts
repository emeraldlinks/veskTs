import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileImportUrl } from '@vesk/compiler/src/module-url';

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
		toContain(expected: string) {
			if (typeof actual !== 'string' || !actual.includes(expected)) throw new Error(`expected ${JSON.stringify(actual)} to contain ${expected}`);
		},
	};
}

console.log('File import URL\n');

test('POSIX absolute paths become file URLs', () => {
	expect(fileImportUrl('/tmp/myshop/app/api/posts/route.js')).toBe('file:///tmp/myshop/app/api/posts/route.js');
});

test('Windows drive paths become file URLs even when running on POSIX', () => {
	const expected = 'file:///C:/Users/KERRY/Documents/myshopp/app/api/posts/route.js';
	expect(fileImportUrl('C:\\Users\\KERRY\\Documents\\myshopp\\app\\api\\posts\\route.js')).toBe(expected);
	expect(fileImportUrl('C:/Users/KERRY/Documents/myshopp/app/api/posts/route.js')).toBe(expected);
});

test('spaces and URL-significant characters in path segments are encoded', () => {
	expect(fileImportUrl('C:\\Users\\My Docs\\app\\route#1.js')).toBe('file:///C:/Users/My%20Docs/app/route%231.js');
	expect(fileImportUrl('/tmp/My Docs/route#1.js')).toBe('file:///tmp/My%20Docs/route%231.js');
});

test('cache busting adds a t query without changing the file path', () => {
	expect(fileImportUrl('/tmp/route.js', 123)).toBe('file:///tmp/route.js?t=123');
	expect(fileImportUrl('C:\\tmp\\route.js', 0)).toBe('file:///C:/tmp/route.js?t=0');
});

test('the generated URL is accepted by the native ESM loader', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'vesk-module-url-'));
	const file = join(dir, 'route.js');
	writeFileSync(file, 'export const marker = 42;\n');
	try {
		const mod = await import(fileImportUrl(file, Date.now())) as { marker: number };
		expect(mod.marker).toBe(42);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

await Promise.all(pending);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
