import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApiFunction } from '@vesk/adapter/src/api-function';
import { compileMiddlewareCode } from '@vesk/adapter/src/middleware';
import { build } from '@vesk/adapter/src/index';
import type { ApiRouteNode } from '@vesk/adapter/src/types';

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

async function itAsync(name: string, fn: () => Promise<void>) {
	try {
		await fn();
		passed++;
		console.log(`  ✓ ${name}`);
	} catch (e: unknown) {
		failed++;
		console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
	}
}

function expectIncludes(haystack: string, needle: string): void {
	if (!haystack.includes(needle)) {
		throw new Error(`Expected generated code to include ${JSON.stringify(needle)}`);
	}
}

const root = mkdtempSync(join(tmpdir(), 'vesk-api-function-'));
const routeDir = join(root, 'api', 'auth', '[...path]');
mkdirSync(routeDir, { recursive: true });
const routeFile = join(routeDir, 'route.ts');
writeFileSync(routeFile, 'export const GET = () => new Response("ok");\n');

const catchAll: ApiRouteNode = {
	path: ':path',
	fullPath: '/auth/:path',
	isDynamic: true,
	isCatchAll: true,
	filePath: routeFile,
	children: [],
};

it('a catch-all API param captures the whole remaining tail', () => {
	const { funcCode } = generateApiFunction(catchAll, join(root, 'api'), join(root, 'out'));
	expectIncludes(funcCode, `"path": urlParts.slice(1).join('/')`);
});

const catchAllMounted: ApiRouteNode = {
	...catchAll,
	fullPath: '/api/auth/:path',
};

it('a catch-all under the /api mount still captures the tail after the mount prefix', () => {
	const { funcCode } = generateApiFunction(catchAllMounted, join(root, 'api'), join(root, 'out'));
	expectIncludes(funcCode, `"path": urlParts.slice(1).join('/')`);
});

const dynamic: ApiRouteNode = {
	path: ':id',
	fullPath: '/auth/:id',
	isDynamic: true,
	isCatchAll: false,
	filePath: routeFile,
	children: [],
};

it('a single dynamic API param still captures one segment', () => {
	const { funcCode } = generateApiFunction(dynamic, join(root, 'api'), join(root, 'out'));
	expectIncludes(funcCode, '"id": urlParts[1]');
});

it('inlined middleware does not redeclare VeskResponse in an API function', () => {
	const middlewareCode = compileMiddlewareCode([
		[
			"import { VeskResponse } from '@vesk/runtime/server';",
			'export async function middleware(ctx, next) { return VeskResponse.redirect("/next", 302); }',
		].join('\n'),
	], { dedupeVeskResponse: true });
	const { funcCode } = generateApiFunction(catchAll, join(root, 'api'), join(root, 'out'), { middlewareCode });
	if (funcCode.includes("from '@vesk/runtime/server'")) {
		throw new Error('middleware VeskResponse import was not deduped');
	}
	const aliases = funcCode.match(/import \{ VeskResponse as __veskVeskResponse \}/g) || [];
	if (aliases.length !== 1) {
		throw new Error(`expected exactly one runtime VeskResponse alias, got ${aliases.length}`);
	}
});

const gateRoot = join(root, 'gate');
const gateApp = join(gateRoot, 'app');
const gateOut = join(gateRoot, '.vesk');
mkdirSync(join(gateApp, 'api', 'broken'), { recursive: true });
mkdirSync(join(gateRoot, 'models'), { recursive: true });
mkdirSync(join(gateRoot, 'public'), { recursive: true });
writeFileSync(join(gateApp, 'page.vsk'), 'component Page() {\n\treturn <div>ok</div>;\n}\n');
writeFileSync(join(gateApp, 'api', 'broken', 'route.ts'), 'import { register } from "../../../models/register.ts";\nexport const GET = () => new Response(register());\n');
writeFileSync(join(gateRoot, 'models', 'payment.ts'), 'export const Payment = 1;\n');
writeFileSync(join(gateRoot, 'models', 'register.ts'), 'import { Payment } from "./payment";\nexport function register() { return String(Payment); }\n');

async function runGateBuild(): Promise<void> {
	await build(gateApp, { outDir: gateOut, publicDir: join(gateRoot, 'public') });
}

await itAsync('build fails before the manifest when a server import is not runtime-loadable', async () => {
	let message = '';
	try {
		await runGateBuild();
	} catch (e: unknown) {
		message = (e as Error).message;
	}
	if (!message.includes('not loadable at runtime') && !message.includes('V0902')) {
		throw new Error(`expected a V0902 build failure, got ${JSON.stringify(message).slice(0, 300)}`);
	}
	if (existsSync(join(gateOut, 'config.json'))) {
		throw new Error('failed build still produced config.json');
	}
});

writeFileSync(join(gateRoot, 'models', 'register.ts'), 'export function register() { return "1"; }\n');
rmSync(gateOut, { recursive: true, force: true });

await itAsync('build succeeds when server imports are runtime-loadable', async () => {
	await runGateBuild();
	if (!existsSync(join(gateOut, 'config.json'))) {
		throw new Error('successful build did not produce config.json');
	}
});

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
