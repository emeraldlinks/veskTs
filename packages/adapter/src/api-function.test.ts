import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApiFunction } from '@vesk/adapter/src/api-function';
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

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
