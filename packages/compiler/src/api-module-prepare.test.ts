import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { prepareApiRouteGraph } from '@vesk/compiler/src/api-module-prepare';
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
		toBeGreaterThan(expected: number) {
			if (typeof actual !== 'number' || actual <= expected) throw new Error(`expected ${JSON.stringify(actual)} > ${expected}`);
		},
		not: {
			toContain(expected: string) {
				if (typeof actual === 'string' && actual.includes(expected)) throw new Error(`expected ${JSON.stringify(actual)} not to contain ${expected}`);
			},
			toBe(expected: unknown) {
				if (actual === expected) throw new Error(`expected ${JSON.stringify(actual)} not to equal ${JSON.stringify(expected)}`);
			},
		},
	};
}

const root = mkdtempSync(join(tmpdir(), 'vesk-api-prepare-'));
const app = join(root, 'app');
const api = join(app, 'api', 'health');
const output = join(root, 'prepared');
for (const dir of [api, join(app, 'db'), join(root, 'lib')]) {
	mkdirSync(dir, { recursive: true });
}

writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
	compilerOptions: { baseUrl: '.', paths: { '@/*': ['lib/*'] } },
}));
writeFileSync(join(app, 'api', 'health', 'route.ts'), [
	"import { label } from '../../db/connection';",
	"import { helper } from '@/util';",
	"import { token } from './reexport';",
	"import { cyc } from './cycle-a';",
	"import type { Unused } from './types';",
	"import { readFileSync } from 'node:fs';",
	'export const config = { csrf: false };',
	'export async function GET(): Promise<Response> {',
	'  const lazy = await import("./lazy");',
	'  return new Response(`${label}:${helper}:${token}:${cyc}:${lazy.marker}:${typeof readFileSync}`);',
	'}',
].join('\n'));
writeFileSync(join(app, 'db', 'connection.ts'), [
	'import { suffix } from "./secret";',
	'export const label: string = "db-" + suffix;',
].join('\n'));
writeFileSync(join(app, 'db', 'secret.ts'), 'export const suffix = "ok";\n');
writeFileSync(join(root, 'lib', 'util.ts'), 'export const helper = "alias";\n');
writeFileSync(join(api, 'reexport.ts'), 'export const token = "reexport";\n');
writeFileSync(join(api, 'lazy.ts'), 'export const marker = "lazy";\n');
writeFileSync(join(api, 'types.ts'), 'export interface Unused { value: number }\n');
writeFileSync(join(api, 'cycle-a.ts'), 'import { b } from "./cycle-b";\nexport const cyc = "a" + b;\n');
writeFileSync(join(api, 'cycle-b.ts'), 'import { cyc as a } from "./cycle-a";\nexport const b = "b";\nexport const seeA = () => a;\n');

console.log('API module preparation\n');

test('rewrites the whole local graph to portable prepared modules', () => {
	const prepared = prepareApiRouteGraph(join(api, 'route.ts'), output, output);
	expect(prepared.code).not.toContain("from '../../db/connection'");
	expect(prepared.code).not.toContain("from '@/util'");
	expect(prepared.code).not.toContain("import type");
	expect(prepared.code).toContain("from 'node:fs'");
	expect(prepared.dependencies.length).toBeGreaterThan(5);
	for (const path of prepared.dependencies) {
		if (!readFileSync(path, 'utf-8')) throw new Error(`empty prepared module ${path}`);
	}
});

test('prepared entry loads natively with nested extensionless and alias imports resolved', async () => {
	const prepared = prepareApiRouteGraph(join(api, 'route.ts'), output, output);
	const mod = await import(fileImportUrl(prepared.modulePath, prepared.cacheKey)) as {
		GET: () => Promise<Response>;
	};
	const res = await mod.GET();
	expect(await res.text()).toBe('db-ok:alias:reexport:ab:lazy:function');
});

test('cache key follows nested source changes', () => {
	const before = prepareApiRouteGraph(join(api, 'route.ts'), output, output).cacheKey;
	writeFileSync(join(app, 'db', 'secret.ts'), 'export const suffix = "next";\n');
	const after = prepareApiRouteGraph(join(api, 'route.ts'), output, output).cacheKey;
	expect(before).not.toBe(after);
	writeFileSync(join(app, 'db', 'secret.ts'), 'export const suffix = "ok";\n');
});

test('cycles terminate and both modules are emitted', () => {
	const prepared = prepareApiRouteGraph(join(api, 'route.ts'), output, output);
	const names = prepared.dependencies.map((path) => basename(path));
	expect(names.length).toBeGreaterThan(5);
	expect(prepared.dependencies.length === new Set(prepared.dependencies).size).toBe(true);
});

await Promise.all(pending);
rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
