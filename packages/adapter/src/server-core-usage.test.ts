import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function it(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function source(file: string): string {
  return readFileSync(resolve(import.meta.dirname, file), 'utf8');
}

const prod = source('prod-server.ts');
const dev = source('dev-server.ts');
const cliDev = source('../../cli/src/dev-server.ts');
const platform = source('platform-handler.ts');

it('prod server imports shared transport helpers', () => {
  assert(prod.includes("from '@vesk/adapter/src/server-core'"), 'expected a server-core import');
  assert(!prod.includes('function deliverResponse('), 'local deliverResponse must be removed');
  assert(!prod.includes('function errorStatus('), 'local errorStatus must be removed');
  assert(!prod.includes('function matchPath('), 'local matchPath must be removed');
});

it('adapter dev server imports shared transport helpers', () => {
  assert(dev.includes("from '@vesk/adapter/src/server-core'"), 'expected a server-core import');
  assert(!dev.includes('function deliverResponse('), 'local deliverResponse must be removed');
  assert(!dev.includes('function errorStatus('), 'local errorStatus must be removed');
  assert(!dev.includes('function matchPath('), 'local matchPath must be removed');
});

it('CLI dev server imports shared transport helpers', () => {
  assert(cliDev.includes("from '@vesk/adapter/src/server-core'"), 'expected a server-core import');
  assert(!cliDev.includes('function toNodeHeaders('), 'local toNodeHeaders must be removed');
  assert(!cliDev.includes('const errorStatusCode = ('), 'local errorStatusCode must be removed');
  assert(!cliDev.includes('class DevBodyTooLargeError'), 'local body-limit error must be removed');
});

it('CLI dev server uses canonical MIME, body, and header helpers', () => {
  assert(cliDev.includes("from '@vesk/adapter/src/platform-output'"), 'expected mimeFor import');
  assert(!cliDev.includes('const MIME: Record<string, string>'), 'local MIME table must be removed');
  assert(!cliDev.includes('for await (const chunk of req)'), 'local body reads must be removed');
  assert(!cliDev.includes('req.headers as Record<string, string>'), 'local header normalization must be removed');
});

it('adapter dev server uses canonical MIME helper', () => {
  assert(dev.includes("from '@vesk/adapter/src/platform-output'"), 'expected mimeFor import');
  assert(!dev.includes('const MIME: Record<string, string>'), 'local MIME table must be removed');
});

it('prod server uses canonical client IP helper', () => {
  assert(prod.includes('getClientIp('), 'expected shared client IP helper');
  assert(!prod.includes("req.headers['x-forwarded-for']"), 'local proxy parsing must be removed');
  assert(!prod.includes('req.headers as Record<string, string>'), 'local header normalization must be removed');
});

it('platform handler generates route matching from the shared implementation', () => {
  assert(platform.includes("from './route-match'"), 'expected a route-match import');
  assert(platform.includes("from './ssr-data'"), 'expected an ssr-data import');
  assert(platform.includes('matchPath.toString()'), 'expected generated source to reuse matchPath');
  assert(platform.includes('buildSsrDataScript.toString()'), 'expected generated source to reuse SSR serialization');
  assert(!platform.includes('function __matchPath('), 'inline matchPath must be removed');
  assert(!platform.includes('function __escapeScript('), 'inline script escaping must be removed');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
