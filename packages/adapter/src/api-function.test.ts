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

const graphRoot = mkdtempSync(join(tmpdir(), 'vesk-api-graph-'));
const graphApiDir = join(graphRoot, 'app', 'api', 'orders');
const graphLibDir = join(graphRoot, 'app', 'lib');
mkdirSync(graphApiDir, { recursive: true });
mkdirSync(graphLibDir, { recursive: true });
writeFileSync(join(graphRoot, 'tsconfig.json'), JSON.stringify({
	compilerOptions: { baseUrl: '.', paths: { '@/*': ['app/lib/*'] } },
}));
writeFileSync(join(graphApiDir, 'route.ts'), [
	"import { value } from '@/db';",
	"import { suffix } from '../../lib/suffix';",
	'export const GET = () => new Response(value + suffix);',
].join('\n'));
writeFileSync(join(graphLibDir, 'db.ts'), "import { suffix } from './suffix';\nexport const value = 'db:' + suffix;\n");
writeFileSync(join(graphLibDir, 'suffix.ts'), 'export const suffix = "ok";\n');

const graphNode: ApiRouteNode = {
	path: 'orders',
	fullPath: '/api/orders',
	isDynamic: false,
	isCatchAll: false,
	filePath: join(graphApiDir, 'route.ts'),
	children: [],
};

it('generated API functions inline a portable prepared module graph', () => {
	const out = join(graphRoot, 'out');
	const { funcCode } = generateApiFunction(graphNode, graphApiDir, out);
	if (funcCode.includes("from '@/db'")) throw new Error('alias import was not prepared');
	if (funcCode.includes("from '../../lib/suffix'")) throw new Error('extensionless import was not prepared');
	if (funcCode.includes(graphRoot)) throw new Error('generated code leaks absolute build paths');
	if (!funcCode.includes('.mjs')) throw new Error('generated code has no prepared module imports');
	const modulesDir = join(out, 'server', 'api', '_modules');
	if (!existsSync(modulesDir)) throw new Error('prepared modules directory was not emitted');
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

await itAsync('build succeeds with extensionless nested imports in an API route graph', async () => {
	await runGateBuild();
	if (!existsSync(join(gateOut, 'config.json'))) {
		throw new Error('successful build did not produce config.json');
	}
});

writeFileSync(join(gateApp, 'api', 'broken', 'route.ts'), 'import { missing } from "../../../models/does-not-exist";\nexport const GET = () => new Response(missing);\n');
rmSync(gateOut, { recursive: true, force: true });

await itAsync('build still fails before the manifest when a server import cannot be resolved', async () => {
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

rmSync(root, { recursive: true, force: true });
rmSync(graphRoot, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
