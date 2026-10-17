/**
 * What may not cross the server/client line, and what may not be deployed to a
 * socketless runtime.
 *
 * Vesk splits a `.vsk` file into two graphs without being told which side a
 * given import belongs to: a page is *also* a client component, so the module
 * a page imports for its `load()` ends up in the browser chunk closure. When
 * that module reaches for a database driver, the browser bundler dutifully
 * inlines the driver's Node implementation — `node:net`, `node:tls`,
 * `node:stream` — and the client bundle grows by hundreds of kilobytes of code
 * that cannot run and is never called.
 *
 * So the separation has to be enforced by the build rather than inferred from
 * usage. Two distinct rules, because the failure modes are different:
 *
 * - **Server-only packages** (`slintorm`, `@vesk/adapter`) may legitimately be
 *   imported by a page that only touches them during SSR. The import is removed
 *   from the browser chunk and every binding it declared becomes a throwing
 *   stub, so a build stays possible but a real client-side use fails loudly and
 *   names itself. `--strict` turns the warning into a build failure.
 * - **TCP-only drivers** (`pg`, `mysql2`, `mongodb`, `node:sqlite`) cannot run
 *   anywhere a socket cannot be opened — not in a browser, and not on any edge
 *   runtime. In an edge-targeted build that is not a degradation, it is a
 *   guaranteed crash at the first query, so it is a hard build error with no
 *   opt-out: the alternative is discovering it in a deployment log.
 *
 * AST-only throughout. No text scanning — see the module rules.
 *
 * ## Shape
 *
 * ```ts
 * // classification
 * classifySpecifier(spec): 'server-only-package' | 'tcp-driver' | null
 * isServerOnlySpecifier(spec): boolean
 * isTcpDriverSpecifier(spec): boolean
 *
 * // enforcement
 * serverOnlyStubs(notes: Array<{ specifier, binding }>): string        // from a recorded list
 * serverOnlyImportStubs(code, classify?): string                      // scanned from source
 * scanServerOnlyImports(files: Array<{ path, code }>): ServerOnlyViolation[]
 * tcpDriverViolations(appDir): ServerOnlyViolation[]                  // whole app tree
 * edgeDriverBuildError(violations): Error                             // the socketless message
 *
 * // target
 * isSocketlessTarget(platform, target): boolean
 * collectAppSources(dir, out?): string[]
 * ```
 *
 * Adding to the table: extend `SERVER_ONLY_EXACT` / `TCP_DRIVERS`, and — if the
 * package is legitimately usable on the client through a subpath — leave that
 * subpath unmatched, as `slintorm/edge` is. See
 * `packages/adapter/AGENTS.md` for the three outcomes the plugin must
 * distinguish.
 */

import { parse } from '@vesk/compiler/src/parser';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Packages that are server-side by construction.
 *
 * `slintorm` is here for a specific reason, and it is not a slur on the ORM:
 * `slintorm` ships an edge-safe entry (`slintorm/edge` and `slintorm/browser`,
 * which resolve to a bundle with no Node built-ins anywhere in its graph), and
 * that entry is deliberately NOT matched. Only the bare `slintorm` specifier is
 * server-only, because only that one pulls in the driver dispatch and the
 * `node:fs` schema generator.
 */
const SERVER_ONLY_EXACT = new Set([
  'slintorm',
  '@vesk/adapter',
]);

/**
 * Drivers that need a real socket. Anything here is a hard error in an
 * edge-targeted build.
 *
 * `node:sqlite` is a Node built-in that appears only as an import specifier, so
 * it is listed here alongside the packages for uniformity; it cannot appear in
 * a browser chunk because the bundler already fails on it.
 */
const TCP_DRIVERS = new Set([
  'pg',
  'mysql2',
  'mongodb',
  'node:sqlite',
  'node:net',
  'node:tls',
]);

export type ServerOnlyKind = 'server-only-package' | 'tcp-driver';

/**
 * Classify a bare import specifier. Returns null for anything that is fine on
 * the client — including a subpath of a listed package that is itself a
 * browser entry.
 */
export function classifySpecifier(spec: string): ServerOnlyKind | null {
  if (typeof spec !== 'string' || spec.length === 0) return null;
  if (TCP_DRIVERS.has(spec)) return 'tcp-driver';
  if (spec.startsWith('node:')) return 'tcp-driver';
  if (SERVER_ONLY_EXACT.has(spec)) return 'server-only-package';
  return null;
}

export function isServerOnlySpecifier(spec: string): boolean {
  return classifySpecifier(spec) === 'server-only-package';
}

export function isTcpDriverSpecifier(spec: string): boolean {
  return classifySpecifier(spec) === 'tcp-driver';
}

/**
 * Throwing stand-ins for the bindings a server-only import declared.
 *
 * A stub, not a removal: the binding is referenced by code that survives into
 * the chunk, so dropping it would produce `X is not defined` at hydration — a
 * ReferenceError pointing nowhere near the import that caused it. A Proxy that
 * throws on any use keeps `typeof` truthful (so a feature check does not blow
 * up during module evaluation) while failing at the exact call site with a
 * message that names the package, the binding and the fix.
 */
export function serverOnlyStubs(notes: Array<{ specifier: string; binding: string }>): string {
  if (notes.length === 0) return '';
  const lines = notes.map(({ binding, specifier }) => {
    const message =
      `"${binding}" comes from "${specifier}", which is server-only. It reached the client bundle ` +
      'because a component (or a module one imports) imported it — component code runs in the ' +
      'browser, where this module cannot work. Move the server-only work into an API route ' +
      '(app/api/**/route.ts) or a server action and call it over HTTP, or import the ' +
      'edge/browser-safe entry if the package ships one.';
    const thrower = `throw Object.assign(new Error(${JSON.stringify(message)}), { __veskServerOnly: ${JSON.stringify(specifier)} })`;
    return (
      `const ${binding} = new Proxy(function () {}, { ` +
      `get: function () { ${thrower}; }, ` +
      `apply: function () { ${thrower}; }, ` +
      `construct: function () { ${thrower}; } });`
    );
  });
  return lines.join('\n') + '\n\n';
}

/**
 * Same stubs, discovered by scanning source rather than from a recorded list —
 * used by the edge gate, which sees `.vsk` sources before anything is compiled.
 */
export function serverOnlyImportStubs(code: string, classify: (spec: string) => ServerOnlyKind | null = classifySpecifier): string {
  let ast: { body?: Array<{ type?: string; source?: { value?: unknown }; specifiers?: Array<{ local?: { name?: string } }> }> };
  try {
    ast = parse(code) as typeof ast;
  } catch {
    return '';
  }
  const notes: Array<{ specifier: string; binding: string }> = [];
  for (const node of ast.body ?? []) {
    // Only ImportDeclaration here, unlike the scanner above: a re-export binds
    // no local name, so there is nothing to replace — the scan still reports it.
    if (node?.type !== 'ImportDeclaration') continue;
    const src = node.source?.value;
    if (typeof src !== 'string' || classify(src) !== 'server-only-package') continue;
    for (const spec of node.specifiers ?? []) {
      const local = spec?.local?.name;
      if (typeof local === 'string') notes.push({ specifier: src, binding: local });
    }
  }
  return serverOnlyStubs(notes);
}

export interface ServerOnlyViolation {
  kind: ServerOnlyKind;
  specifier: string;
  /** Absolute path of the file the import was written in. */
  file: string;
  /** 1-based line number when it could be determined. */
  line: number | null;
  /** What to do about it. */
  remedy: string;
}

const REMEDY: Record<ServerOnlyKind, string> = {
  'server-only-package':
    'import it from an API route (app/api/**/route.ts) or a server action instead of a component, ' +
    'or use the package\'s browser/edge entry point if it ships one.',
  'tcp-driver':
    'this driver opens a TCP socket, which no edge runtime provides. Use the driver\'s HTTP/HTTPS ' +
    'transport (for SlintORM: `driver: "postgrest"`), or build for a Node target.',
};

/**
 * Every server-only / TCP-only import written across a set of files.
 *
 * Walks the whole set rather than a module graph, because the file that names
 * the driver is rarely the file that matters: `app/db.ts` importing `slintorm`
 * is the normal shape, and it is the *component* that transitively pulls it in.
 * Callers pair this with their own reachability information.
 */
export function scanServerOnlyImports(
  files: Array<{ path: string; code: string }>,
): ServerOnlyViolation[] {
  const out: ServerOnlyViolation[] = [];
  for (const file of files) {
    let ast: { body?: Array<{ type?: string; start?: number; source?: { value?: unknown } }> };
    try {
      ast = parse(file.code) as typeof ast;
    } catch {
      continue;
    }
    for (const node of ast.body ?? []) {
      // Re-exports count. `export { Client } from 'pg'` is how a barrel file
      // forwards a driver, and it is exactly the shape that slips past a scan
      // looking only at imports.
      if (node?.type !== 'ImportDeclaration'
        && node?.type !== 'ExportNamedDeclaration'
        && node?.type !== 'ExportAllDeclaration') continue;
      const spec = node.source?.value;
      if (typeof spec !== 'string') continue;
      const kind = classifySpecifier(spec);
      if (!kind) continue;
      out.push({
        kind,
        specifier: spec,
        file: file.path,
        line: lineOf(file.code, node.start),
        remedy: REMEDY[kind],
      });
    }
  }
  return out;
}

/** 1-based line of a character offset. */
function lineOf(code: string, offset: number | undefined): number | null {
  if (typeof offset !== 'number' || offset < 0 || offset > code.length) return null;
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (code.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * The build-time error for an edge-targeted build that imports a TCP driver.
 *
 * No opt-out by design: there is no configuration of an edge target under which
 * a TCP driver works, so the only question is whether the author finds out here
 * or from a production log.
 */
export function edgeDriverBuildError(violations: ServerOnlyViolation[]): Error {
  const detail = violations
    .map(v => `  ${v.file}${v.line ? `:${v.line}` : ''} — import "${v.specifier}"\n    ${v.remedy}`)
    .join('\n');
  return new Error(
    `[vesk] edge-targeted build cannot include a TCP-only driver (${violations.length} found).\n` +
    `${detail}\n\n` +
    'This was a build error rather than a runtime one because an edge runtime has no socket: ' +
    'the deployed function would fail on its first query.',
  );
}

/**
 * Platforms whose deployed functions have no socket.
 *
 * Derived from `platform-deploy.ts`'s `nodeBuiltins: false` shells — those are
 * exactly the ones bundled with empty-Node-builtin stubs, which is the same
 * reason they cannot open a TCP connection. `vercel`/`netlify`/`aws` run Node
 * functions and are deliberately absent.
 */
const SOCKETLESS_PLATFORMS = new Set(['edge', 'cloudflare', 'deno', 'coxmos']);

export function isSocketlessTarget(platform: string | null | undefined, target: string | null | undefined): boolean {
  if (target === 'edge') return true;
  return typeof platform === 'string' && SOCKETLESS_PLATFORMS.has(platform);
}

const SOURCE_EXTENSIONS = ['.vsk', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const SKIPPED_DIRS = new Set(['node_modules', '.vesk', '.git', 'dist', '.next', '.output', 'coverage']);

/** Every app source file under `dir`, recursively. */
export function collectAppSources(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRS.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let st: { isDirectory(): boolean; isFile(): boolean };
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) collectAppSources(full, out);
    else if (st.isFile()) {
      const dot = entry.lastIndexOf('.');
      if (dot === -1) continue;
      if (SOURCE_EXTENSIONS.includes(entry.slice(dot).toLowerCase())) out.push(full);
    }
  }
  return out;
}

/**
 * TCP-driver imports anywhere under the app directory.
 *
 * Scans the whole tree rather than the client chunk closure: the driver is named
 * in `app/db.ts`, which is correct, and what is wrong is that anything under it
 * is reachable from a socketless runtime. Either way the build has to stop, and
 * it has to stop before minutes of bundling have been spent.
 */
export function tcpDriverViolations(appDir: string): ServerOnlyViolation[] {
  const files: Array<{ path: string; code: string }> = [];
  for (const path of collectAppSources(appDir)) {
    try {
      files.push({ path, code: readFileSync(path, 'utf-8') });
    } catch {
      /* unreadable file — not a build blocker */
    }
  }
  return scanServerOnlyImports(files).filter(v => v.kind === 'tcp-driver');
}