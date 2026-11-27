import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
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
const authApi = join(app, 'api', 'auth');
const output = join(root, 'prepared');
for (const dir of [api, authApi, join(app, 'db'), join(root, 'lib'), join(root, 'services')]) {
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
writeFileSync(join(root, 'services', 'auth.service.ts'), 'export const authLabel = "auth-ok";\n');
writeFileSync(join(authApi, 'route.ts'), [
	"import { authLabel } from '../../../services/auth.service';",
	'export const config = { csrf: false };',
	'export async function GET() { return new Response(authLabel); }',
].join('\n'));

console.log('API module preparation\n');

test('rewrites the whole local graph to portable prepared modules', async () => {
	const prepared = await prepareApiRouteGraph(join(api, 'route.ts'), output, output);
	expect(prepared.code).not.toContain("from '../../db/connection'");
	expect(prepared.code).not.toContain("from '@/util'");
	expect(prepared.code).not.toContain("import type");
	expect(prepared.code.includes("from 'node:fs'") || prepared.code.includes('from "node:fs"')).toBe(true);
	expect(prepared.dependencies.length).toBeGreaterThan(5);
	for (const path of prepared.dependencies) {
		if (!readFileSync(path, 'utf-8')) throw new Error(`empty prepared module ${path}`);
	}
});

test('prepared entry loads natively with nested extensionless and alias imports resolved', async () => {
	const prepared = await prepareApiRouteGraph(join(api, 'route.ts'), output, output);
	const mod = await import(fileImportUrl(prepared.modulePath, prepared.cacheKey)) as {
		GET: () => Promise<Response>;
	};
	const res = await mod.GET();
	expect(await res.text()).toBe('db-ok:alias:reexport:ab:lazy:function');
});

test('cache key follows nested source changes', async () => {
	const before = (await prepareApiRouteGraph(join(api, 'route.ts'), output, output)).cacheKey;
	writeFileSync(join(app, 'db', 'secret.ts'), 'export const suffix = "next";\n');
	const after = (await prepareApiRouteGraph(join(api, 'route.ts'), output, output)).cacheKey;
	expect(before).not.toBe(after);
	writeFileSync(join(app, 'db', 'secret.ts'), 'export const suffix = "ok";\n');
});

test('rewrites dotted-basename local imports (auth.service.ts) so Node can load them', async () => {
	const prepared = await prepareApiRouteGraph(join(authApi, 'route.ts'), output, output);
	expect(prepared.code).not.toContain("from '../../../services/auth.service'");
	const mod = await import(fileImportUrl(prepared.modulePath, prepared.cacheKey)) as {
		GET: () => Promise<Response>;
	};
	expect(await (await mod.GET()).text()).toBe('auth-ok');
});

test('cycles terminate and both modules are emitted', async () => {
	const prepared = await prepareApiRouteGraph(join(api, 'route.ts'), output, output);
	const names = prepared.dependencies.map((path) => basename(path));
	expect(names.length).toBeGreaterThan(5);
	expect(prepared.dependencies.length === new Set(prepared.dependencies).size).toBe(true);
});


test('handles real-app TS syntax in route deps (implements, param props, enum, abstract)', async () => {
	const dir = join(app, 'api', 'ts-shapes');
	mkdirSync(join(dir, 'svc'), { recursive: true });
	writeFileSync(join(dir, 'svc', 'base.ts'), [
		'export interface Repo { save(v: string): string }',
		'export abstract class BaseRepo implements Repo { abstract save(v: string): string; protected tag: string = "base"; }',
		'export enum Kind { A = "a", B = "b" }',
	].join('\n'));
	writeFileSync(join(dir, 'svc', 'impl.ts'), [
		'import { BaseRepo, Kind } from "./base";',
		'export class ImplRepo extends BaseRepo { constructor(private readonly prefix: string = "p") { super(); } save(v: string): string { return this.prefix + ":" + Kind.A + ":" + v; } }',
	].join('\n'));
	writeFileSync(join(dir, 'route.ts'), [
		'import { ImplRepo } from "./svc/impl";',
		'export async function GET() { return new Response(new ImplRepo().save("ok")); }',
	].join('\n'));
	const prepared = await prepareApiRouteGraph(join(dir, 'route.ts'), output, output);
	const mod = await import(fileImportUrl(prepared.modulePath, prepared.cacheKey)) as { GET: () => Promise<Response> };
	expect(await (await mod.GET()).text()).toBe('p:a:ok');
});

test('keeps parameter-property and catch-annotation route graphs loadable (login shape)', async () => {
	const dir = join(app, 'api', 'auth-login');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(root, 'services', 'auth-error.service.ts'), [
		'export class AuthError extends Error {',
		'  constructor(message: string, public status: number) {',
		'    super(message);',
		"    this.name = 'AuthError';",
		'  }',
		'}',
		'export async function loginUser(input: { email: string; password: string }) {',
		"  if (input.email !== 'admin@example.com') throw new AuthError('Invalid email or password.', 401);",
		"  return { user: { email: input.email }, session: { token: 'session-token' } };",
		'}',
	].join('\n'));
	writeFileSync(join(dir, 'route.ts'), [
		"import { AuthError, loginUser } from '../../../services/auth-error.service';",
		'export async function POST(req: { json<T>(): Promise<T> }) {',
		'  try {',
		'    const body = await req.json<{ email: string; password: string }>();',
		'    const result = await loginUser(body);',
		"    return new Response(JSON.stringify({ ok: true, email: result.user.email, token: result.session.token }));",
		'  } catch (error: any) {',
		'    if (error instanceof AuthError) {',
		"      return new Response(JSON.stringify({ ok: false, status: error.status, error: error.message }), { status: error.status });",
		'    }',
		"    return new Response(JSON.stringify({ ok: false, error: 'Login failed.' }), { status: 500 });",
		'  }',
		'}',
	].join('\n'));
	const prepared = await prepareApiRouteGraph(join(dir, 'route.ts'), output, output);
	const preparedSources = readdirSync(output)
		.filter((name) => name.endsWith('.mjs'))
		.map((name) => readFileSync(join(output, name), 'utf-8'));
	expect(preparedSources.some((code) => code.includes('this.status = status'))).toBe(true);
	for (const code of [...preparedSources, prepared.code]) {
		expect(code).not.toContain('public status');
		expect(code).not.toContain('catch (error: any)');
	}
	const mod = await import(fileImportUrl(prepared.modulePath, prepared.cacheKey)) as {
		POST: (req: { json: () => Promise<unknown> }) => Promise<Response>;
	};
	const denied = await mod.POST({ json: async () => ({ email: 'nobody@example.com', password: 'x' }) });
	expect(denied.status).toBe(401);
	expect(await denied.text()).toBe('{"ok":false,"status":401,"error":"Invalid email or password."}');
	const allowed = await mod.POST({ json: async () => ({ email: 'admin@example.com', password: 'x' }) });
	expect(await allowed.text()).toBe('{"ok":true,"email":"admin@example.com","token":"session-token"}');
});

await Promise.all(pending);
rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
