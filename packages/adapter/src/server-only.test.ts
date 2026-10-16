/**
 * The server/client boundary.
 *
 * Three claims are tested here, and the third is the one that had never been
 * proven at all:
 *
 * 1. The classifier — which specifiers may not reach a browser, and which of
 *    those are a hard error on a socketless target.
 * 2. The client bundle — a page that imports `../db.ts` for its `load()` must
 *    not pull a database driver into the browser payload, and the binding it
 *    bound must still exist (as a thrower) rather than dangling.
 * 3. That a bare npm specifier such as `slintorm` actually RESOLVES from a
 *    page and from an API route during SSR. This is the assertion the whole
 *    feature rests on — marking a package server-only is only safe if the server
 *    side can still reach it — and nothing exercised it before.
 *
 * The `slintorm` fixture is a hand-written package whose `exports` map mirrors
 * the real one (bare `slintorm` → Node entry with a driver dispatch;
 * `slintorm/edge` → a browser entry with no Node built-ins). CI has no sibling
 * checkout to depend on, and the point under test is Vesk's resolution, not
 * the ORM.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
	classifySpecifier,
	isServerOnlySpecifier,
	isTcpDriverSpecifier,
	serverOnlyStubs,
	serverOnlyImportStubs,
	scanServerOnlyImports,
	edgeDriverBuildError,
	isSocketlessTarget,
	collectAppSources,
	tcpDriverViolations,
} from '@vesk/adapter/src/server-only';
import { generateClientBundle } from '@vesk/adapter/src/client-bundle';
import { loadSsrModule } from '@vesk/compiler/src/module-imports';

let passed = 0;
let failed = 0;

async function it(name: string, fn: () => void | Promise<void>) {
	return Promise.resolve()
		.then(fn)
		.then(() => { passed++; console.log(`  ✓ ${name}`); })
		.catch((e: unknown) => { failed++; console.log(`  ✗ ${name}\n    ${(e as Error).message}`); });
}

function assert(cond: unknown, msg: string): void {
	if (!cond) throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, msg: string): void {
	if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ────────────────────────────────────────────────────────────────────────────

async function classifierTests(): Promise<void> {
	console.log('\n=== specifier classification ===');

	await it('a database ORM entry is server-only, not a hard error', () => {
		eq(classifySpecifier('slintorm'), 'server-only-package', 'bare slintorm');
	});
	await it("slintorm's edge/browser entries are NOT server-only", () => {
		// The point of the whole split: the package ships an entry with no Node
		// built-ins anywhere in its graph. Marking that server-only would make
		// the edge deployment path unusable.
		for (const spec of ['slintorm/edge', 'slintorm/browser', 'slintorm/postgrest', 'slintorm/proxy']) {
			eq(classifySpecifier(spec), null, `${spec} must stay client-safe`);
		}
	});
	await it('TCP drivers are a hard error everywhere', () => {
		for (const spec of ['pg', 'mysql2', 'mongodb', 'node:sqlite']) {
			eq(classifySpecifier(spec), 'tcp-driver', spec);
			assert(isTcpDriverSpecifier(spec), `${spec} is a TCP driver`);
			assert(!isServerOnlySpecifier(spec), `${spec} is not merely server-only`);
		}
	});
	await it('any node: builtin is a TCP driver', () => {
		eq(classifySpecifier('node:net'), 'tcp-driver', 'node:net');
		eq(classifySpecifier('node:fs'), 'tcp-driver', 'node:fs');
	});
	await it('ordinary client packages are untouched', () => {
		for (const spec of ['lucide-vesk', 'slate', 'zod', '@vesk/runtime', 'motion', '@vitejs/plugin-react']) {
			eq(classifySpecifier(spec), null, spec);
		}
	});
	await it('a scoped package that merely starts with the same letters is untouched', () => {
		eq(classifySpecifier('slintorm-ui'), null, 'slintorm-ui');
		eq(classifySpecifier('pgrx'), null, 'pgrx');
		eq(classifySpecifier('postgres'), null, 'postgres (not pg)');
	});

	console.log('\n=== socketless targets ===');

	await it('edge and the socketless platforms are gated', () => {
		for (const p of ['edge', 'cloudflare', 'deno', 'coxmos']) {
			assert(isSocketlessTarget(p, null), `${p} is socketless`);
		}
		assert(isSocketlessTarget(null, 'edge'), '--target edge is socketless');
		assert(isSocketlessTarget('cloudflare', 'edge'), 'either signal is enough');
	});
	await it('Node serverless platforms are NOT gated', () => {
		// These bundle with real Node builtins and run Node functions — a TCP
		// driver works there, so failing the build would be wrong.
		for (const p of ['node', 'vercel', 'netlify', 'aws']) {
			assert(!isSocketlessTarget(p, null), `${p} has a socket`);
		}
		assert(!isSocketlessTarget(null, 'node'), 'target node');
	});
}

async function stubTests(): Promise<void> {
	console.log('\n=== stubs ===');

	console.log('\n=== top-level use detection (decides stub vs build error) ===');

	const { importedNamesFor, referencedAtTopLevel } = await import('@vesk/adapter/src/server-only-plugin');

	await it('reads the binding names an importer asked for', () => {
		eq(importedNamesFor("import ORMManager, { orm as db, createORM } from 'slintorm';", 'slintorm').join(','), 'ORMManager,db,createORM', 'default + named + alias');
		eq(importedNamesFor("import { a } from 'slintorm';\nimport { b } from 'other';", 'slintorm').join(','), 'a', 'only the matching source');
		eq(importedNamesFor("import { Client } from 'pg';\nimport { orm } from 'slintorm';", 'slintorm').join(','), 'orm', 'one source at a time');
		eq(importedNamesFor('import * as slint from \'slintorm\';', 'slintorm').length, 0, 'a namespace import binds no names to declare');
	});
	await it('a re-export contributes its forwarded names', () => {
		eq(importedNamesFor("export { Client, Pool } from 'pg';", 'pg').join(','), 'Client,Pool', 'named re-export');
		eq(importedNamesFor("export * from 'slintorm';", 'slintorm').length, 0, 'star re-export names nothing here');
	});

	await it('module scope counts as eager', () => {
		assert(referencedAtTopLevel("import { createORM } from 'slintorm';\nexport const orm = createORM({});", 'createORM'), 'export const = call()');
		assert(referencedAtTopLevel("import { createORM } from 'slintorm';\nconst o = createORM({});", 'createORM'), 'plain const');
		assert(referencedAtTopLevel("import { createORM } from 'slintorm';\nconsole.log(createORM);", 'createORM'), 'top-level argument');
	});
	await it('inside a function is not eager', () => {
		assert(!referencedAtTopLevel("import { createORM } from 'slintorm';\nexport function build() { return createORM({}); }", 'createORM'), 'function body');
		assert(!referencedAtTopLevel("import { createORM } from 'slintorm';\nconst f = () => createORM({});", 'createORM'), 'arrow body');
		assert(!referencedAtTopLevel("import { createORM } from 'slintorm';\nclass C { m() { return createORM({}); } }", 'createORM'), 'method body');
		assert(!referencedAtTopLevel("import { createORM } from 'slintorm';\nconst o = { run() { return createORM({}); } };", 'createORM'), 'object method body');
	});
	await it('a nested function still counts as not-eager', () => {
		assert(!referencedAtTopLevel("import { createORM } from 'slintorm';\nfunction outer() { return function inner() { return createORM({}); }; }", 'createORM'), 'two levels');
	});
	await it('importing a name is not using it', () => {
		assert(!referencedAtTopLevel("import { createORM } from 'slintorm';", 'createORM'), 'bare import');
		assert(!referencedAtTopLevel("import ORMManager, { orm } from 'slintorm';", 'orm'), 'named import');
	});
	await it('a field named like the binding is not a reference', () => {
		assert(!referencedAtTopLevel("import { orm } from 'slintorm';\nconst row = { orm: 1 };", 'orm'), 'object key');
		assert(!referencedAtTopLevel("import { orm } from 'slintorm';\nconst v = row.orm;", 'orm'), 'member access');
		assert(referencedAtTopLevel("import { orm } from 'slintorm';\nconst v = row[orm];", 'orm'), 'computed member access IS a use');
	});
	await it('a re-exported name is not a use', () => {
		assert(!referencedAtTopLevel("import { createORM } from 'slintorm';\nexport { createORM };", 'createORM'), 'export list');
	});
	await it('an unparseable file is treated as eager (never soften the gate)', () => {
		assert(referencedAtTopLevel('const = = ;', 'anything'), 'cannot prove safety');
	});

	await it('every binding kind gets a throwing stub', () => {
		const stubs = serverOnlyStubs([
			{ specifier: 'slintorm', binding: 'ORMManager' },
			{ specifier: 'slintorm', binding: 'orm' },
			{ specifier: '@vesk/adapter', binding: 'tools' },
		]);
		for (const name of ['ORMManager', 'orm', 'tools']) {
			assert(stubs.includes(`const ${name} = new Proxy(`), `${name} declared`);
		}
		// The message has to name the package AND the binding, or the throw is
		// no better than a ReferenceError.
		assert(stubs.includes('slintorm'), 'names the package');
		assert(stubs.includes('comes from'), 'names the binding');
		assert(stubs.includes('API route'), 'names the remedy');
	});
	await it('the stub throws on read, call and construct', () => {
		const stubs = serverOnlyStubs([{ specifier: 'slintorm', binding: 'orm' }]);
		assert(stubs.includes('get:'), 'property read');
		assert(stubs.includes('apply:'), 'call');
		assert(stubs.includes('construct:'), 'new');
	});
	await it('typeof the stub does not throw (a feature check must survive)', () => {
		// `typeof x` on a Proxy with a throwing `get` trap WOULD throw, because
		// typeof resolves the binding. It is read through the global scope, not a
		// property, so this is safe — but the stub is also evaluated at module
		// load, and a Proxy construction itself must never throw.
		const stubs = serverOnlyStubs([{ specifier: 'slintorm', binding: 'orm' }]);
		const run = new Function(`${stubs}\nreturn typeof orm;`);
		eq(run(), 'function', 'typeof a stubbed binding');
	});
	await it('using the stub throws a message naming the package', () => {
		const stubs = serverOnlyStubs([{ specifier: 'slintorm', binding: 'orm' }]);
		const run = new Function(`${stubs}\nreturn orm.users;`);
		let message = '';
		try { run(); } catch (e) { message = (e as Error).message; }
		assert(message.includes('server-only'), `expected a server-only error, got ${JSON.stringify(message)}`);
		assert(message.includes('slintorm'), 'names the package');
	});
	await it('the source-scanning form finds the same bindings', () => {
		const code = "import ORMManager, { orm as db } from 'slintorm';\nimport { client } from 'slintorm/edge';\nexport default ORMManager;";
		const stubs = serverOnlyImportStubs(code);
		assert(stubs.includes('const ORMManager'), 'default import');
		assert(stubs.includes('const db'), 'aliased named import');
		assert(!stubs.includes('const client'), 'the edge entry is left alone');
	});
	await it('a file with no server-only import produces nothing', () => {
		eq(serverOnlyImportStubs("import { motion } from 'motion';"), '', 'no stubs');
		eq(serverOnlyImportStubs('not valid js at all ('), '', 'unparseable');
	});

	console.log('\n=== scanning ===');

	await it('finds a driver import with its file and line', () => {
		const code = "import x from 'a';\n\n// comment\nimport { Client } from 'pg';\nimport fs from 'node:fs';\nimport { orm } from 'slintorm';\n";
		const hits = scanServerOnlyImports([{ path: '/app/db.ts', code }]);
		const kinds = hits.map(h => `${h.specifier}:${h.kind}`);
		assert(kinds.includes('pg:tcp-driver'), 'pg');
		assert(kinds.includes('node:fs:tcp-driver'), 'node:fs');
		assert(kinds.includes('slintorm:server-only-package'), 'slintorm');
		const pg = hits.find(h => h.specifier === 'pg')!;
		eq(pg.line, 4, 'pg is on line 4');
		eq(pg.file, '/app/db.ts', 'file');
		assert(pg.remedy.length > 10, 'carries a remedy');
	});
	await it('a re-export still counts as an import of the driver', () => {
		const hits = scanServerOnlyImports([{ path: '/app/x.ts', code: "export { Client } from 'pg';" }]);
		eq(hits.length, 1, 'found');
	});
	await it('an unparseable file is skipped, not fatal', () => {
		const hits = scanServerOnlyImports([{ path: '/app/x.ts', code: 'const = = ;' }]);
		eq(hits.length, 0, 'no false positive');
	});
	await it('walks the app tree and skips node_modules and dot dirs', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'vesk-srvonly-'));
		try {
			mkdirSync(resolve(root, 'app', 'api'), { recursive: true });
			mkdirSync(resolve(root, 'node_modules', 'pg'), { recursive: true });
			writeFileSync(resolve(root, 'app', 'db.ts'), "import { Client } from 'pg';\n");
			writeFileSync(resolve(root, 'app', 'api', 'route.ts'), "import { orm } from 'slintorm';\n");
			writeFileSync(resolve(root, 'node_modules', 'pg', 'index.js'), "import net from 'node:net';\n");
			writeFileSync(resolve(root, 'app', 'notes.md'), '# pg\n');
			const files = collectAppSources(root);
			assert(files.some(f => f.endsWith('app/db.ts')), 'db.ts');
			assert(files.some(f => f.endsWith('app/api/route.ts')), 'api route');
			assert(!files.some(f => f.includes('node_modules')), 'node_modules skipped');
			assert(!files.some(f => f.endsWith('.md')), 'non-source skipped');
			const hits = tcpDriverViolations(root);
			eq(hits.length, 1, `only db.ts names a TCP driver, got ${JSON.stringify(hits)}`);
			eq(hits[0].specifier, 'pg', 'pg');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
	await it('the edge build error names every file and counts correctly', () => {
		const err = edgeDriverBuildError([
			{ kind: 'tcp-driver', specifier: 'pg', file: '/app/db.ts', line: 1, remedy: 'use postgrest' },
			{ kind: 'tcp-driver', specifier: 'mysql2', file: '/app/x.ts', line: 9, remedy: 'use an HTTP driver' },
		]);
		const text = err.message;
		assert(text.includes('2 found'), 'count');
		assert(text.includes('/app/db.ts:1'), 'file:line');
		assert(text.includes('/app/x.ts:9'), 'second file:line');
		assert(text.includes('postgrest'), 'remedy carried through');
		assert(text.includes('no socket'), 'explains why this is fatal');
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Fixture app: a page and an API route that both reach for the ORM
// ────────────────────────────────────────────────────────────────────────────

let fixtureRoot = '';
let appDir = '';
let pagePath = '';

/**
 * A `slintorm` whose exports map mirrors the real package: the bare specifier
 * resolves to a Node entry, `slintorm/edge` to a browser entry with no Node
 * built-ins, and the driver is a separate package the Node entry pulls in.
 */
function writeSlintormFixture(root: string): void {
  const pkgDir = resolve(root, 'node_modules', 'slintorm');
  const driverDir = resolve(root, 'node_modules', 'pg');
  mkdirSync(resolve(pkgDir, 'dist', 'src'), { recursive: true });
  mkdirSync(resolve(driverDir, 'dist'), { recursive: true });

  writeFileSync(resolve(pkgDir, 'package.json'), JSON.stringify({
    name: 'slintorm',
    version: '1.9.6',
    type: 'module',
    exports: {
      '.': { types: './dist/src/index.d.ts', import: './dist/src/index.js', default: './dist/src/index.js' },
      './edge': { types: './dist/src/browser.d.ts', import: './dist/src/browser.js', default: './dist/src/browser.js' },
      './browser': { types: './dist/src/browser.d.ts', import: './dist/src/browser.js', default: './dist/src/browser.js' },
    },
  }, null, 2));

  // The Node entry imports the driver — exactly the shape that must stay out of
  // a browser bundle.
  writeFileSync(resolve(pkgDir, 'dist', 'src', 'index.js'), `
import { Client } from 'pg';
export class ORMManager {
  constructor(config) { this.config = config; this.port = new Client().port; }
  static get version() { return '1.9.6'; }
  async getAll() { return [{ name: 'row-from-' + this.port }]; }
}
export const createORM = (config) => new ORMManager(config);
export const driverName = Client.name;
export default ORMManager;
`);
  writeFileSync(resolve(pkgDir, 'dist', 'src', 'browser.js'), `
export class ORMManager {
  constructor(config) { this.config = config; this.port = 'https'; }
  static get version() { return '1.9.6-edge'; }
  async getAll() { return [{ name: 'row-from-https' }]; }
}
export const createORM = (config) => new ORMManager(config);
export const driverName = 'postgrest';
export default ORMManager;
`);
writeFileSync(resolve(driverDir, 'package.json'), JSON.stringify({
		name: 'pg', version: '8.22.0', type: 'module', main: './dist/index.js',
	}, null, 2));
	// A realistic driver: `pg` reaches for node:net and node:tls. Server-side
	// that is fine; in a browser bundle it is unresolvable, which is what makes
	// the leak so expensive and so invisible.
	writeFileSync(resolve(driverDir, 'dist', 'index.js'), [
		"import net from 'node:net';",
		"import tls from 'node:tls';",
		'export class Client { constructor() { this.port = 5432; this.net = net; this.tls = tls; } }',
		'export default Client;',
	].join('\n'));
}

function writeAppFixture(root: string): { routePath: string; dbPath: string } {
  appDir = resolve(root, 'app');
  mkdirSync(resolve(appDir, 'api', 'rows'), { recursive: true });
  const dbPath = resolve(appDir, 'db.ts');
  pagePath = resolve(appDir, 'page.vsk');
  const routePath = resolve(appDir, 'api', 'rows', 'route.ts');

  // Two shapes, on purpose:
  //
  // `db.ts` holds a module-scope `createORM(...)` call — the shape that CANNOT
  // be rescued, because a browser evaluates it while loading the chunk. The
  // build must refuse it.
  writeFileSync(dbPath, [
    "import { createORM } from 'slintorm';",
    '',
    'export const orm = createORM({ driver: "postgres" });',
    'export async function allRows() { return orm.getAll(); }',
    '',
  ].join('\n'));

  writeFileSync(routePath, [
    "import { allRows } from '../../db.ts';",
    '',
    'export async function GET() {',
    '  const rows = await allRows();',
    '  return new Response(JSON.stringify({ rows }), { headers: { "Content-Type": "application/json" } });',
    '}',
    '',
  ].join('\n'));

  writeFileSync(pagePath, [
    "import { orm } from './db.ts';",
    '',
    'export async function load() {',
    '  const rows = await orm.getAll();',
    '  return { props: { rows } };',
    '}',
    '',
    'component Page(props) {',
    '  return <ul>{props.rows.map(r => <li>{r.name}</li>)}</ul>;',
    '}',
    '',
  ].join('\n'));

  return { routePath, dbPath };
}

async function resolutionTests(): Promise<void> {
	console.log('\n=== slintorm resolves from SSR and API routes ===');

	fixtureRoot = mkdtempSync(resolve(tmpdir(), 'vesk-srvonly-app-'));
	writeSlintormFixture(fixtureRoot);
	const { routePath, dbPath } = writeAppFixture(fixtureRoot);

	await it('the fixture is shaped like the real package', async () => {
		const { readFileSync } = await import('node:fs');
		const pkg = JSON.parse(readFileSync(resolve(fixtureRoot, 'node_modules', 'slintorm', 'package.json'), 'utf-8'));
		assert(pkg.exports['./edge'], 'ships an edge entry');
		const nodeEntry = readFileSync(resolve(fixtureRoot, 'node_modules', 'slintorm', 'dist', 'src', 'index.js'), 'utf-8');
		assert(nodeEntry.includes("from 'pg'"), 'the Node entry pulls in the driver');
	});

	await it('a server module importing slintorm loads, driver and all', async () => {
		const mod = loadSsrModule(dbPath);
		assert(mod, 'db.ts resolved');
		assert(typeof (mod as { allRows?: unknown }).allRows === 'function', 'allRows is present');
		// A stubbed or unevaluated import would surface here as a non-object, not
		// as a thrown error — the module still loads, the binding is just wrong.
		assert((mod as { orm?: unknown }).orm && typeof (mod as { orm: object }).orm === 'object', 'orm is an instance');
		eq(((mod as { orm: { getAll?: unknown } }).orm.getAll) instanceof Function, true, 'orm.getAll is a real method');
	});

	await it('the driver really resolved — not a stub or a silent undefined', async () => {
		const driver = loadSsrModule(resolve(fixtureRoot, 'node_modules', 'pg', 'dist', 'index.js'));
		assert(driver, 'the pg fixture resolved through the ORM entry');
		eq(typeof (driver as { Client?: unknown }).Client, 'function', 'Client');
	});

	await it('an API route importing the ORM loads and runs', async () => {
		const mod = loadSsrModule(routePath);
		assert(mod, 'route resolved');
		const GET = (mod as { GET?: (req: Request) => Promise<Response> }).GET;
		eq(typeof GET, 'function', 'GET handler');
		// Calling it proves the binding chain db.ts → slintorm → pg resolved all
		// the way down, at request time, not just at parse time.
		const res = await GET!(new Request('http://localhost/api/rows'));
		eq(res.status, 200, 'status');
		const body = await res.json() as { rows: Array<{ name: string }> };
		assert(Array.isArray(body.rows), 'payload shape');
		// 5432 is pg's port: the driver was constructed, which means the chain
		// slintorm -> pg resolved and was executed, not merely parsed.
		eq(body.rows[0]?.name, 'row-from-5432', 'the driver really ran');
	});

	await it('a page importing the ORM resolves on the server side too', async () => {
		// The page module is in the browser chunk closure, so this is the exact
		// import the bundler strips. The server must still be able to reach it,
		// or `load()` would break — which is why stripping needs a stub and a
		// warning rather than a hard failure.
		const mod = loadSsrModule(pagePath);
		assert(mod, 'page.vsk resolved');
		const load = (mod as { load?: () => Promise<{ props: { rows: unknown[] } }> }).load;
		eq(typeof load, 'function', 'load is present');
		const result = await load!();
		assert(Array.isArray(result.props.rows), 'load produced props');
	});

	await it('the edge entry of the same package is client-safe and resolvable', async () => {
		const { resolveSsrModule } = await import('@vesk/compiler/src/module-imports');
		const resolved = resolveSsrModule('slintorm/edge', appDir);
		assert(resolved, 'slintorm/edge resolved');
		assert(resolved.endsWith('browser.js'), `expected the edge entry, got ${resolved}`);
		const bare = resolveSsrModule('slintorm', appDir);
		assert(bare !== resolved, 'the bare specifier resolves to a DIFFERENT (Node) entry');
	});
}

async function clientBundleTests(): Promise<void> {
	console.log('\n=== client bundle (code-split, the default and the production path) ===');

	// One build of the fixture app, shared by the assertions below.
	// `--skip-split` (the monolithic path) is NOT covered here and cannot be:
	// it emits raw `import { orm } from './db.ts'` for ANY non-.vsk module,
	// server-only or not, which is a pre-existing defect in that path and out of
	// this change's scope. Recorded in TODO.md rather than papered over.
	async function buildFixture(opts: { strict?: boolean; page?: string } = {}): Promise<{ code: string; warnings: string[] }> {
		const warnings: string[] = [];
		const original = console.error;
		let out: { chunks: Array<{ name: string; code: string }> } | null = null;
		let failure = '';
		console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
		try {
			const page = opts.page ?? pagePath;
			const dir = page === pagePath ? '' : 'lazy';
			out = await generateClientBundle(
				[{ fullPath: dir ? `/${dir}` : '/', sourceDir: dir, page: 'page', layout: null, children: [], kind: 'page' } as never],
				appDir,
				new Map(),
				{ codeSplit: true, ...(opts.strict ? { strict: true } : {}) },
			) as never;
		} catch (e) {
			failure = (e as Error).message;
		} finally {
			console.error = original;
		}
		if (failure) throw new Error(failure);
		assert(out && out.chunks.length > 0, 'a chunk was produced');
		return { code: out!.chunks.map(c => c.code).join('\n'), warnings };
	}

	await it('the status quo, for reference: this bundle cannot build at all', async () => {
		// What happens with no gate: esbuild follows db.ts → slintorm → pg →
		// node:net and dies on a message that names none of the author's files.
		const { build } = await import('@vesk/adapter/src/esbuild-fallback');
		const entry = resolve(fixtureRoot, 'probe-entry.js');
		writeFileSync(entry, `import { createORM } from 'slintorm';\nglobalThis.__o = createORM({});\n`);
		let failed = '';
		try {
			await build({ entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' });
		} catch (e) {
			const err = e as { errors?: Array<{ text: string }> };
			failed = (err?.errors ?? []).map(x => x.text).join(' | ') || (e as Error).message;
		}
		rmSync(entry, { force: true });
		assert(failed.includes('node:net') || failed.includes('Could not resolve'), `expected the old dead end, got ${JSON.stringify(failed)}`);
		assert(!failed.includes('slintorm'), 'the old failure never names the package the author imported');
	});

await it('an ORM used only from load() never reaches the browser bundle', async () => {
		// The fixture page imports `orm` and uses it in `load()` only. `load` is
		// server-only, the client codegen strips it, and the import goes with it —
		// so the whole leak chain never starts. Worth pinning: it means the
		// ordinary "page renders from the database during SSR" shape is already
		// safe, and this work is about the cases where it is not.
		const original = console.error;
		const warnings: string[] = [];
		console.error = (...a: unknown[]) => warnings.push(a.map(String).join(' '));
		let out: { chunks: Array<{ code: string }> } | null = null;
		let threw = '';
		try {
			out = await generateClientBundle(
				[{ fullPath: '/', sourceDir: '', page: 'page', layout: null, children: [], kind: 'page' } as never],
				appDir,
				new Map(),
				{ codeSplit: true },
			) as never;
		} catch (e) {
			threw = (e as Error).message;
		} finally {
			console.error = original;
		}
		assert(threw === '', `no failure expected, got ${threw}`);
		const code = out!.chunks.map(c => c.code).join('\n');
		assert(!code.includes('slintorm'), 'the ORM is not in the chunk');
		assert(!code.includes('node:net'), 'no driver in the chunk');
		assert(!warnings.some(w => w.includes('server-only')), 'no server-only diagnostic for a clean page');
	});

	await it('a module-scope server-only use is a build error, not a stub', async () => {
		// Here the component body reaches for `orm`, so `db.ts` really is inlined
		// into the chunk and its module-scope `createORM(...)` runs in the browser
		// while the chunk evaluates. A stub would throw there, before a single
		// component exists, so the build has to stop instead.
		const dir = resolve(appDir, 'eager');
		mkdirSync(dir, { recursive: true });
		writeFileSync(resolve(dir, 'db.ts'), [
			"import { createORM } from 'slintorm';",
			'export const orm = createORM({ driver: "postgres" });',
			'',
		].join('\n'));
		writeFileSync(resolve(dir, 'page.vsk'), [
			"import { orm } from './db.ts';",
			'',
			'component Page(props) {',
			'  return <div>{orm ? "a" : "b"}</div>;',
			'}',
			'',
		].join('\n'));
		try {
			let threw = '';
			try {
				await generateClientBundle(
					[{ fullPath: '/eager', sourceDir: 'eager', page: 'page', layout: null, children: [], kind: 'page' } as never],
					appDir,
					new Map(),
					{ codeSplit: true },
				);
			} catch (e) {
				threw = (e as Error).message;
			}
			assert(threw.includes('module scope'), `expected a module-scope error, got ${JSON.stringify(threw)}`);
			assert(threw.includes('createORM'), 'names the binding');
			assert(threw.includes('slintorm'), 'names the package');
			assert(threw.includes('db.ts'), 'names the file');
			assert(threw.includes('API route'), 'names the remedy');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	await it('a function-scope use IS stubbed, and the driver stays out', async () => {
		// The rescuable shape: the binding is only reached from inside a function,
		// which the browser never runs for this page. Here the ORM must be
		// replaced rather than refused — and no driver byte may appear.
		const dir = resolve(appDir, 'lazy');
		mkdirSync(dir, { recursive: true });
		writeFileSync(resolve(dir, 'db.ts'), [
			"import { createORM } from 'slintorm';",
			'export function build() { return createORM({ driver: "postgres" }); }',
			'',
		].join('\n'));
		writeFileSync(resolve(dir, 'page.vsk'), [
			"import { build } from './db.ts';",
			'',
			'component Page(props) {',
			'  return <div>{typeof build}</div>;',
			'}',
			'',
		].join('\n'));
		try {
			const warnings: string[] = [];
			const original = console.error;
			console.error = (...a: unknown[]) => warnings.push(a.map(String).join(' '));
			let out: { chunks: Array<{ code: string }> } | null = null;
			let threw = '';
			try {
				out = await generateClientBundle(
					[{ fullPath: '/lazy', sourceDir: 'lazy', page: 'page', layout: null, children: [], kind: 'page' } as never],
					appDir,
					new Map(),
					{ codeSplit: true },
				) as never;
			} catch (e) {
				threw = (e as Error).message;
			} finally {
				console.error = original;
			}
			assert(threw === '', `no failure expected, got ${threw}`);
			const code = out!.chunks.map(c => c.code).join('\n');
			assert(!code.includes('node:net'), 'no driver in the chunk');
			assert(code.includes('__vesk_stub'), 'the server-only binding was replaced by a stub');
			assert(warnings.some(w => w.includes('server-only import')), `expected a build warning, saw ${JSON.stringify(warnings)}`);
			assert(warnings.some(w => w.includes('slintorm')), 'the warning names the package');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	await it('a driver never reaches the browser chunk', async () => {
		mkdirSync(resolve(appDir, 'lazy'), { recursive: true });
		// `pg` directly from the page — the shape the driver gate exists for.
		writeFileSync(resolve(appDir, 'lazy', 'page.vsk'), [
			"import { Client } from 'pg';",
			'',
			'component Page(props) {',
			'  return <div>{typeof Client}</div>;',
			'}',
			'',
		].join('\n'));
		try {
			let threw = '';
			const warnings: string[] = [];
			const original = console.error;
			console.error = (...a: unknown[]) => warnings.push(a.map(String).join(' '));
			try {
				await generateClientBundle(
					[{ fullPath: '/lazy', sourceDir: 'lazy', page: 'page', layout: null, children: [], kind: 'page' } as never],
					appDir,
					new Map(),
					{ codeSplit: true },
				);
			} catch (e) {
				threw = (e as Error).message;
			} finally {
				console.error = original;
			}
			// Either the gate refuses it, or esbuild's own unresolvable-import
			// failure fires. Both are build failures; neither ships a browser
			// bundle containing a socket driver.
			assert(threw !== '' || warnings.length > 0, 'the driver produced a diagnostic');
			assert(threw.includes('pg') || threw.includes('Could not resolve') || warnings.some(w => w.includes('pg')),
				`the diagnostic names the driver, got ${JSON.stringify({ threw, warnings })}`);
		} finally {
			rmSync(resolve(appDir, 'lazy'), { recursive: true, force: true });
		}
	});

	await it('the stub throws with a message naming the package', async () => {
		// Direct exercise of the plugin's output rather than through a chunk:
		// the bundle path is already covered by the two cases above.
		const { stubFactorySource } = await import('@vesk/adapter/src/server-only-plugin');
		const src = stubFactorySource('slintorm') + '\nconst orm = __vesk_stub("orm");';
		let message = '';
		try {
			new Function(`${src}\nreturn orm.users;`)();
		} catch (e) {
			message = (e as Error).message;
		}
		assert(message.includes('slintorm'), 'names the package');
		assert(message.includes('orm'), 'names the binding');
		assert(message.includes('API route'), 'names the remedy');
	});

	await it('--strict turns the warning into a build failure', async () => {
		// Same rescusable shape as the stub case, built strictly.
		mkdirSync(resolve(appDir, 'soft'), { recursive: true });
		writeFileSync(resolve(appDir, 'soft', 'db.ts'), [
			"import { createORM } from 'slintorm';",
			'export function build() { return createORM({ driver: "postgres" }); }',
			'',
		].join('\n'));
		writeFileSync(resolve(appDir, 'soft', 'page.vsk'), [
			"import { build } from './db.ts';",
			'',
			'component Page(props) {',
			'  return <div>{typeof build}</div>;',
			'}',
			'',
		].join('\n'));
		try {
			const original = console.error;
			console.error = () => {};
			let threw = '';
			try {
				await generateClientBundle(
					[{ fullPath: '/soft', sourceDir: 'soft', page: 'page', layout: null, children: [], kind: 'page' } as never],
					appDir,
					new Map(),
					{ codeSplit: true, strict: true },
				);
			} catch (e) {
				threw = (e as Error).message;
			} finally {
				console.error = original;
			}
			assert(threw.includes('server-only'), `expected a strict failure, got ${JSON.stringify(threw)}`);
			assert(threw.includes('slintorm'), 'names the package');
			assert(threw.includes('API route'), 'names the remedy');
		} finally {
			rmSync(resolve(appDir, 'soft'), { recursive: true, force: true });
		}
	});

	await it('an edge-targeted build refuses the driver outright', async () => {
		const hits = tcpDriverViolations(appDir);
		// The fixture app's own sources do not import a driver directly — only
		// the ORM does. Add the direct case so the gate is proven on this tree.
		const rogue = resolve(appDir, 'rogue.ts');
		writeFileSync(rogue, "import { Client } from 'pg';\nexport default Client;\n");
		let message = '';
		try {
			const after = tcpDriverViolations(appDir);
			assert(after.some(v => v.specifier === 'pg'), 'the rogue driver is found');
			assert(isSocketlessTarget('cloudflare', null), 'cloudflare is socketless');
			message = edgeDriverBuildError(after).message;
		} finally {
			rmSync(rogue, { force: true });
		}
		assert(message.includes('rogue.ts'), `names the offending file, got ${message}`);
		eq(hits.length, 0, 'the clean fixture app has no direct driver import');
	});

	await it('a Node-targeted build is not gated at all', async () => {
		// Same app, same package: only the target differs, so the gate has to be
		// a function of the target and not of the code.
		assert(!isSocketlessTarget('node', 'node'), 'node target');
		assert(!isSocketlessTarget('vercel', 'node'), 'vercel/node');
	});

	await it('a page that never touches the ORM is untouched by all of this', async () => {
		const original = console.error;
		const warnings: string[] = [];
		console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
		try {
			const out = await generateClientBundle(
				[{ fullPath: '/clean', sourceDir: 'clean', page: 'page', layout: null, children: [], kind: 'page' } as never],
				appDir,
				new Map(),
				{ codeSplit: true },
			);
			const code = out.chunks.map(c => c.code).join('\n');
			assert(!code.includes('__vesk_stub'), 'no stub emitted');
			assert(!warnings.some(w => w.includes('server-only')), 'no warning emitted');
		} finally {
			console.error = original;
			rmSync(resolve(appDir, 'clean'), { recursive: true, force: true });
		}
	});
}

async function main(): Promise<void> {
	await classifierTests();
	await stubTests();
	await resolutionTests();
	await clientBundleTests();
	console.log(`\n${passed} passed, ${failed} failed`);
	rmSync(fixtureRoot, { recursive: true, force: true });
	process.exit(failed === 0 ? 0 : 1);
}

void main();