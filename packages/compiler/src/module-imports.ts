import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { print } from 'esrap';
import ts from 'esrap/languages/ts';
import { walk } from 'zimmerframe';
import { parse } from '@vesk/compiler/src/parser';
import { stripTsTypes, hasTsSyntax, isTypeOnlyStatement } from '@vesk/compiler/src/strip-ts';
import { importModuleTarget } from '@vesk/compiler/src/tokens';
import { VeskError } from '@vesk/compiler/src/errors';

// =============================================================
// SSR module-value imports.
//
// The SSR scope (`__vesk`) is built by `buildComponentMap`/`loadRuntimeImports`
// and only ever contained two kinds of identifiers:
//   - runtime exports (from `@vesk/runtime` / `@vesk/reactivity`)
//   - top-level declarations in the `.vsk` file itself
//
// A `.vsk` component that imported a *value* from a plain `.ts`/`.js` module
// (e.g. `import { GUIDE } from '../lib/guide.ts'`) got those names into the
// client bundle but NEVER into the SSR scope — so the server component threw
// `ReferenceError: GUIDE is not defined` even though the client build was fine.
//
// This module closes that gap with a synchronous, self-contained module loader
// (no esbuild, no native `require(esm)`, works on the repo's supported Node):
//   - resolves local/relative/absolute/bare specifiers with extension probing
//   - strips TS, rewrites ESM `import`/`export` to a CJS `new Function` body
//   - evaluates with a recursive `require` so nested relative imports work
//   - caches per absolute path keyed on mtime so dev edits are picked up on
//     the next compile without a process restart
//
// Scope notes: `@vesk/*` targets stay compiler-controlled (runtime scope),
// `.vsk` targets resolve through the component registry, and `.css`/`.md`
// targets carry no runtime value — none of them are loaded here.
//
// Supported export forms: named/`default`/namespace imports, `export const`/
// `let`/`var`/`function`/`class`, `export { b as a }`, `export { x } from`,
// `export * from`, `export * as ns from`, `export default <expr>`. CJS files
// without import/export statements run verbatim. Everything unsupported falls
// back to native `require()` when available and otherwise warns + skips.
// =============================================================

const RUNTIME_PREFIXES = ['@vesk/runtime/', '@vesk/reactivity/', '@vesk/types', '@vesk/'];

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx', '.json'];

/** Marker prefix returned by `resolveSsrModule` for Node builtins. */
const BUILTIN_PREFIX = '\u0000builtin:';

/** Node builtins already loaded (never go stale; no mtime tracking). */
const BUILTIN_CACHE = new Map<string, Record<string, unknown>>();

interface CachedModule {
  mtimeMs: number;
  /** Absolute paths + mtimes resolved anywhere in this module's transitive eval tree. */
  deps: Array<{ path: string; mtimeMs: number }>;
  exports: Record<string, unknown>;
}

const MODULE_CACHE = new Map<string, CachedModule>();

/** Hard cap on cached modules — bounds long dev-session growth (LRU-ish: evicts oldest). */
const MAX_CACHE_ENTRIES = 256;

function cacheModule(p: string, val: CachedModule): void {
  MODULE_CACHE.delete(p);
  MODULE_CACHE.set(p, val);
  if (MODULE_CACHE.size > MAX_CACHE_ENTRIES) {
    MODULE_CACHE.delete(MODULE_CACHE.keys().next().value as string);
  }
}

/**
 * Active evaluation frames — an array (not a single slot) so nested module
 * evaluation keeps each ancestor's closure live. Every resolve performed by
 * `createModuleRequire` is recorded into ALL frames, so a module's invalidation
 * set is its full transitive dependency closure (editing a leaf invalidates
 * every ancestor that transitively depends on it).
 */
const depStack: Set<string>[] = [];

/** True when the import target is owned by the framework (never SSR-loaded). */
export function isCompilerOwnedTarget(target: string): boolean {
  if (target === '@vesk/runtime' || target === '@vesk/reactivity') return true;
  for (const prefix of RUNTIME_PREFIXES) {
    if (target.startsWith(prefix)) return true;
  }
  return false;
}

/** True when the target carries no value into the SSR scope. */
export function isValueLessTarget(target: string): boolean {
  return (
    target.endsWith('.vsk') ||
    target.endsWith('.css') ||
    target.endsWith('.md') ||
    target.endsWith('.markdown')
  );
}

/**
 * AST-driven extraction of the value bindings introduced by one import
 * statement (`import { a as b } from 'm'` → `[{ local: 'b', imported: 'a' }]`;
 * `import X from 'm'` → `[{ local: 'X', imported: 'default' }]`;
 * `import * as X from 'm'` → `[{ local: 'X', imported: '*' }]`). Type-only
 * specifiers are skipped. Side-effect imports return `[]`.
 */
export function importBindingPairs(imp: string): Array<{ local: string; imported: string }> {
  const pairs: Array<{ local: string; imported: string }> = [];
  let ast: ReturnType<typeof parse> | null = null;
  try {
    ast = parse(imp, { filename: 'import.mjs' });
  } catch {
    ast = null;
  }
  if (!ast) return pairs;
  const stmt = (ast.body || []).find((n) => n.type === 'ImportDeclaration');
  if (!stmt) return pairs;
  const specifiers = (stmt.specifiers || []) as unknown as Array<{
    type: string;
    importKind?: string;
    local?: { name?: string };
    imported?: { name?: string; value?: string };
  }>;
  for (const spec of specifiers) {
    if (spec.importKind === 'type') continue;
    const local = spec.local?.name;
    if (!local) continue;
    if (spec.type === 'ImportDefaultSpecifier') {
      pairs.push({ local, imported: 'default' });
    } else if (spec.type === 'ImportNamespaceSpecifier') {
      pairs.push({ local, imported: '*' });
    } else {
      const importedSpec = (spec.imported || spec.local) as { name?: string; value?: string };
      const imported = importedSpec.name ?? importedSpec.value;
      if (imported) pairs.push({ local, imported });
    }
  }
  return pairs;
}

/** Local binding names imported from non-runtime, non-`.vsk` modules. */
export function localValueImportNames(importStrs: string[]): string[] {
  const names: string[] = [];
  for (const imp of importStrs) {
    const target = importModuleTarget(imp);
    if (!target || isCompilerOwnedTarget(target) || isValueLessTarget(target)) continue;
    for (const pair of importBindingPairs(imp)) names.push(pair.local);
  }
  return names;
}

/** True when an import line should be SSR-loaded (non-runtime, non-empty, non-`.vsk`). */
export function isLocalValueImport(imp: string): boolean {
  const target = importModuleTarget(imp);
  if (!target || isCompilerOwnedTarget(target) || isValueLessTarget(target)) return false;
  return importBindingPairs(imp).length > 0;
}

/**
 * Loads every local value import and merges its exports into `__vesk` so SSR
 * component bodies can reference them. Pure side-effect imports (`import './x'`)
 * are also resolved and executed so their module-level setup runs client AND
 * server. Resolution is relative to `sourcePath` (the importing `.vsk` file).
 *
 * Best-effort: unresolvable/unloadable modules warn and are skipped, matching
 * how unresolvable `.vsk` imports are handled. Unsupported ESM constructs
 * (import.meta/top-level await) THROW a specific error — loading them would
 * silently yield `undefined` at render.
 */
export function applyLocalModuleImports(
  __vesk: Record<string, unknown>,
  importStrs: string[],
  sourcePath: string | undefined
): void {
  if (!sourcePath) return;
  const fromDir = dirname(sourcePath);
  for (const imp of importStrs) {
    const target = importModuleTarget(imp);
    if (!target || isCompilerOwnedTarget(target) || isValueLessTarget(target)) continue;
    const resolved = resolveSsrModule(target, fromDir);
    if (!resolved) {
      console.warn(`[vesk] SSR: cannot resolve "${target}" imported by ${sourcePath} — the imported name will be undefined during server render.`);
      continue;
    }
    // Load always (a side-effect import runs the module's top-level code);
    // merge values only when the import actually binds names.
    const mod = loadSsrModule(resolved);
    if (!mod || typeof mod !== 'object') continue;
    for (const pair of importBindingPairs(imp)) {
      if (pair.imported === '*') {
        __vesk[pair.local] = mod;
      } else if (pair.imported in mod) {
        __vesk[pair.local] = (mod as Record<string, unknown>)[pair.imported];
      }
    }
  }
}

/** Best-effort: run the module through the native loader when possible. */
function nativeRequireFallback(absPath: string): Record<string, unknown> | null {
  try {
    // resolution is by absolute path so a bare/relative `require()` inside the
    // module is Node-handled (via createRequire ancestry).
    const req = createRequire(absPath) as unknown as (id: string) => unknown;
    const loaded = req(absPath);
    if (loaded && typeof loaded === 'object') return loaded as Record<string, unknown>;
    if (loaded !== null && loaded !== undefined) return { default: loaded };
    return null;
  } catch {
    return null;
  }
}

/**
 * Loads (and caches) a module's export object. Cache entries track both the
 * module's own mtime and the mtimes of everything it transitively resolved,
 * so a change to any dependency invalidates every module that pulls it in.
 * Builtin markers load through Node and are cached separately (never stale).
 */
export function loadSsrModule(absPath: string): Record<string, unknown> | null {
  if (isBuiltinPath(absPath)) {
    return loadBuiltin(absPath.slice(BUILTIN_PREFIX.length));
  }

  let mtimeMs = 0;
  try {
    mtimeMs = statSync(absPath).mtimeMs;
  } catch {
    return null;
  }
  // A module that is still evaluating links back to live partial exports —
  // the CJS analogue of ESM circular-import tolerance (no infinite recursion).
  const inFlight = EVALUATING.get(absPath);
  if (inFlight !== undefined) return inFlight;
  const cachedVal = MODULE_CACHE.get(absPath);
  if (cachedVal && cachedVal.mtimeMs === mtimeMs && depsFresh(cachedVal)) return cachedVal.exports;

  // Capture the transitive closure of this evaluation into the live frames.
  const frame = new Set<string>();
  depStack.push(frame);

  try {
    let exportsObj: Record<string, unknown> | null = null;
    if (absPath.endsWith('.json')) {
      try {
        exportsObj = JSON.parse(readFileSync(absPath, 'utf-8')) as Record<string, unknown>;
        if (exportsObj && typeof exportsObj === 'object' && !('default' in exportsObj)) {
          exportsObj.default = exportsObj;
        }
      } catch {
        exportsObj = null;
      }
    } else {
      // Pure re-export barrels (`export { x as y } from`, `export * from`,
      // `export * as ns from`) return a lazy Proxy: only the submodule backing
      // a name the consumer actually touches gets evaluated. Without this, a
      // several-thousand-export barrel (e.g. lucide's icon index) pays its full
      // transitive closure on every cold load (tens of seconds dev, too slow to
      // ship in prod).
      const src = readSsrSource(absPath);
      // Report here, before any fallback can run. `nativeRequireFallback` and
      // the raw-source substitution both "succeed" in the sense that they
      // return something, which is how an unparseable module used to keep
      // going and fail somewhere else entirely.
      if (src?.parseError) throw src.parseError;
      const body = (src?.ast?.body || []) as Array<{ type: string } & Record<string, unknown>>;
      if (src && isPureReexportBarrel(body)) {
        exportsObj = createLazyBarrelExports(buildBarrelSpec(body), dirname(absPath));
      } else {
        exportsObj = {};
        EVALUATING.set(absPath, exportsObj);
        const ran = evaluateModuleFile(absPath, exportsObj, src);
        // Runtime evaluation failure (already warned) — give Node's own loader
        // a chance before giving up.
        if (!ran) exportsObj = null;
      }
    }

    if (exportsObj === null) {
      exportsObj = nativeRequireFallback(absPath);
    }
    if (exportsObj === null) return null;

    cacheModule(absPath, { mtimeMs, deps: captureClosure(frame), exports: exportsObj });
    return exportsObj;
  } finally {
    depStack.pop();
    EVALUATING.delete(absPath);
  }
}

/** Snapshots the current stat of every file in a module's closure. */
function captureClosure(frame: Set<string>): Array<{ path: string; mtimeMs: number }> {
  const deps: Array<{ path: string; mtimeMs: number }> = [];
  for (const dep of frame) {
    try {
      deps.push({ path: dep, mtimeMs: statSync(dep).mtimeMs });
    } catch {
      // Missing now, but the parent re-check will hit the missing file and
      // treat it as changed — record it so stale entries get dropped.
      deps.push({ path: dep, mtimeMs: -1 });
    }
  }
  return deps;
}

/** True when every file in the module's dependency closure still matches. */
function depsFresh(cachedVal: CachedModule): boolean {
  for (const dep of cachedVal.deps) {
    try {
      if (statSync(dep.path).mtimeMs !== dep.mtimeMs) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Raw file contents, keyed by path and validated by mtime.
 *
 * `readSsrSource` is on the hot path of every `.vsk` compile: a page's module
 * bundle pulls in its `.ts`/`.js` imports, and a docs-style app where 26 pages
 * all import one content module read and re-parsed that module 26 times. The
 * parsed AST is deliberately NOT shared (callers mutate it — `stripTsTypes`,
 * `stripped.body = ...`) and is still produced per call; only the immutable
 * text is reused, and only while the file's mtime is unchanged, so an edit in
 * a watch session is picked up immediately.
 */
const rawSourceCache = new Map<string, { mtimeMs: number; raw: string }>();

/**
 * Bounded, insertion-ordered eviction.
 *
 * The cap has to clear the OLDEST entries, not the whole map: an app that
 * imports an icon barrel walks 1,600+ modules, and a 512-entry cap with
 * `clear()` on overflow thrashed itself into a 0% hit rate (11,235 reads of
 * 1,620 distinct files on vesk-doc). Draining the front keeps the hot modules
 * resident and bounds memory.
 */
const BUILD_CACHE_MAX = 8192;
const BUILD_CACHE_EVICT = 2048;

function evict<T>(cache: Map<string, T>): void {
  if (cache.size <= BUILD_CACHE_MAX) return;
  let dropped = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    if (++dropped >= BUILD_CACHE_EVICT) break;
  }
}

function readSourceCached(absPath: string): string | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(absPath).mtimeMs;
  } catch {
    return null;
  }
  const hit = rawSourceCache.get(absPath);
  if (hit && hit.mtimeMs === mtimeMs) return hit.raw;
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
  rawSourceCache.set(absPath, { mtimeMs, raw });
  evict(rawSourceCache);
  return raw;
}

export interface SsrSource {
  raw: string;
  ast: ReturnType<typeof parse> | null;
  /** Set when `raw` could not be parsed; see `moduleParseFailed`. */
  parseError?: VeskError;
}

export function readSsrSource(absPath: string): SsrSource | null {
  const cachedRaw = readSourceCached(absPath);
  if (cachedRaw === null) {
    // Keep the original warning: a missing module is a build-time signal, not
    // a cache miss to swallow.
    console.warn(`[vesk] SSR: failed to read ${absPath}`);
    return null;
  }
  const raw = cachedRaw;
  try {
    return { raw, ast: parse(raw, { filename: absPath }) };
  } catch (e) {
    // A parse failure is a BUILD FAILURE, not a fallback. It used to return
    // `ast: null` silently, and the caller then substituted the raw source — so
    // the file's TypeScript syntax reached `new Function` and surfaced as a
    // bare `Unexpected token ':'` in whichever module imported it, with no
    // file, no line, and (because the module's exports came back undefined) a
    // trail of unrelated `X is not iterable` failures behind it.
    const err = e as VeskError;
    let parseError: VeskError;
    if (err instanceof VeskError) {
      // `parse()` already produced a located diagnostic for this file. Keep its
      // message, frame and position — they are strictly better than a wrapper's
      // — and add the code so the failure is identifiable in build logs.
      parseError = err;
      if (err.code === undefined) err.code = 'V0901';
    } else {
      parseError = VeskError.moduleParseFailed({ file: absPath, reason: (e as Error)?.message });
    }
    return { raw, ast: null, parseError };
  }
}

/** True when every statement in a module body is a re-export (or a type-only /
 *  directive statement). Such "pure barrels" carry no computation of their own,
 *  so they can be served lazily instead of paying their full transitive closure. */
function isPureReexportBarrel(body: Array<{ type: string } & Record<string, unknown>>): boolean {
  for (const stmt of body) {
    if (stmt.type === 'EmptyStatement') continue;
    if (stmt.type === 'ExpressionStatement') {
      // A leading directive such as 'use strict' — no runtime effect here.
      const expr = stmt.expression as { type?: string; value?: unknown } | null | undefined;
      if (expr && expr.type === 'Literal' && typeof expr.value === 'string' && expr.value.length > 0) continue;
      return false;
    }
    if (stmt.type === 'ExportAllDeclaration') {
      if (stmt.exportKind === 'type') continue;
      continue;
    }
    if (stmt.type === 'ExportNamedDeclaration') {
      if (stmt.exportKind === 'type') continue;
      if (stmt.source) continue; // `export { x } from 'm'` re-export
      return false; // local declaration or local re-export — real code
    }
    if (stmt.type === 'ImportDeclaration' && stmt.importKind === 'type') continue;
    return false;
  }
  return true;
}

interface BarrelSpec {
  /** name -> submodule source + name to pull. */
  direct: Map<string, { source: string; imported: string }>;
  /** `export * as ns from 'x'` — ns name -> source. */
  namespaces: Map<string, string>;
  /** `export * from 'x'` sources. */
  stars: string[];
}

function buildBarrelSpec(body: Array<{ type: string } & Record<string, unknown>>): BarrelSpec {
  const spec: BarrelSpec = { direct: new Map(), namespaces: new Map(), stars: [] };
  for (const stmt of body) {
    if (stmt.type === 'ExportNamedDeclaration') {
      if (stmt.exportKind === 'type' || !stmt.source) continue;
      // The module source is a string literal — read its value directly instead
      // of reprinting the node (esrap print per statement is the dominant cost
      // in multi-thousand-export barrels).
      const source = quotedSourceValue(stmt.source);
      const specifiers = (stmt.specifiers as Array<Record<string, unknown>>) || [];
      for (const ex of specifiers) {
        if (ex.exportKind === 'type') continue;
        const imported = exportKeyName(ex.local as { type: string; name?: string });
        const exported = exportKeyName(ex.exported as { type: string; name?: string; value?: unknown });
        if (!exported || !imported) continue;
        if (source !== null) spec.direct.set(exported, { source, imported });
      }
    } else if (stmt.type === 'ExportAllDeclaration') {
      if (stmt.exportKind === 'type') continue;
      const source = quotedSourceValue(stmt.source);
      if (stmt.exported) {
        const nsName = exportKeyName(stmt.exported as { type: string; name?: string; value?: unknown });
        if (source !== null && nsName) spec.namespaces.set(nsName, source);
      } else if (source !== null) {
        spec.stars.push(source);
      }
    }
  }
  return spec;
}

/**
 * Raw string value of an `... from <literal>` source node. Returns the unquoted
 * specifier, or `null` when the node isn't a plain string literal (callers fall
 * back — and caching the string is safer than reprinting per statement).
 */
/**
 * Raw string value of an `... from <literal>` source node. String literals are
 * read directly (esrap printing per statement is the dominant cost in
 * multi-thousand-export barrels); any other node falls back to a reprinted,
 * quote-stripped value so no export is ever dropped.
 */
function quotedSourceValue(node: unknown): string | null {
  const n = node as { type?: string; value?: unknown } | null | undefined;
  if (n && (n.type === 'Literal' || n.type === 'StringLiteral') && typeof n.value === 'string') {
    return n.value;
  }
  const printed = printNode(node);
  return printed ? stripOuterQuotes(printed) : null;
}

/**
 * A lazy exports object for a pure re-export barrel. Names resolve on access;
 * the submodule backing them is loaded (and cached) only then. Barrels load
 * with an empty dependency closure, so editing one re-exported module
 * invalidates that module alone — never the whole barrel (a several-thousand
 * file stat walk otherwise).
 */
function createLazyBarrelExports(spec: BarrelSpec, dir: string): Record<string, unknown> {
  // Resolved submodule TARGETS are cached, but their values are pulled through
  // `loadSsrModule` on every access — that call is mtime-keyed per module, so
  // editing a re-exported file invalidates exactly that module (and is cheap:
  // one stat), while the barrel itself stays cached with no dependency walk.
  const targets = new Map<string, string>();
  const starKeys = new Set<string>();
  let starsEnumerated = false;

  const loadSource = (source: string): Record<string, unknown> | null => {
    let target = targets.get(source);
    if (!target) {
      // Compiler-owned sources resolve through their package `exports` map, not
      // the project's tsconfig `paths` (see `createModuleRequire`).
      target = (isCompilerOwnedTarget(source)
        ? resolveCompilerOwnedModule(source)
        : resolveSsrModule(source, dir)) ?? '';
      if (!target) return null;
      targets.set(source, target);
    }
    const mod = loadSsrModule(target);
    return mod && typeof mod === 'object' ? mod : null;
  };

  const hasPresent = (prop: string): boolean => {
    if (spec.direct.has(prop) || spec.namespaces.has(prop)) return true;
    if (starsEnumerated && starKeys.has(prop)) return true;
    if (prop === 'default') return false; // `export *` never re-exports default
    for (const source of spec.stars) {
      const mod = loadSource(source);
      if (mod && Object.prototype.hasOwnProperty.call(mod, prop)) return true;
    }
    return false;
  };

  const getNamed = (prop: string): unknown => {
    const direct = spec.direct.get(prop);
    if (direct) {
      const mod = loadSource(direct.source);
      if (!mod) return undefined;
      return (mod as Record<string, unknown>)[direct.imported];
    }
    const nsSource = spec.namespaces.get(prop);
    if (nsSource) {
      return loadSource(nsSource) ?? undefined;
    }
    if (prop === 'default') return undefined;
    for (const source of spec.stars) {
      const mod = loadSource(source);
      if (mod && Object.prototype.hasOwnProperty.call(mod, prop)) {
        return (mod as Record<string, unknown>)[prop];
      }
    }
    return undefined;
  };

  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      return getNamed(prop as string);
    },
    has(_target, prop) {
      if (typeof prop === 'symbol') return false;
      return hasPresent(prop as string);
    },
    ownKeys() {
      if (!starsEnumerated) {
        for (const source of spec.stars) {
          const mod = loadSource(source);
          if (!mod) continue;
          for (const k of Reflect.ownKeys(mod)) {
            if (typeof k === 'string' && k !== 'default') starKeys.add(k);
          }
        }
        starsEnumerated = true;
      }
      return [...new Set([...spec.direct.keys(), ...spec.namespaces.keys(), ...starKeys])];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (!hasPresent(prop as string)) return undefined;
      // Accessor descriptor so iteration doesn't force-load every submodule;
      // values are pulled via the getter only when a consumer reads them.
      return {
        enumerable: true,
        configurable: true,
        get: () => getNamed(prop as string),
      };
    },
  });
}

/**
 * Runs one module file. Returns `true` when the body executed, `false` when a
 * runtime failure was already warned about. Unsupported ESM constructs throw —
 * the only honest outcome is a loud, specific error, never silently undefined.
 * `src` carries a read+parse already done by the caller (either a barrel probe
 * or a plain load) so big files aren't read/parsed twice.
 */
function evaluateModuleFile(
  absPath: string,
  exportsObj: Record<string, unknown>,
  src?: SsrSource | null
): boolean {
  let raw: string;
  if (src) {
    raw = src.raw;
  } else {
    try {
      raw = readFileSync(absPath, 'utf-8');
    } catch (err) {
      console.warn(`[vesk] SSR: failed to read ${absPath}: ${(err as Error)?.message ?? String(err)}`);
      return false;
    }
  }

  let ast: ReturnType<typeof parse> | null;
  if (src) {
    ast = src.ast;
    // Report the parse failure at the file that caused it rather than letting
    // the raw source reach `new Function` and fail as a SyntaxError nobody can
    // trace back.
    if (!ast && src.parseError) throw src.parseError;
  } else {
    try {
      ast = parse(raw, { filename: absPath });
    } catch {
      ast = null;
    }
  }

  if (!ast) {
    // Not parseable as ESM — run verbatim as CJS.
    try {
      const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', raw);
      fn(createModuleRequire(dirname(absPath)), { exports: exportsObj }, exportsObj, dirname(absPath), absPath);
    } catch (err) {
      console.warn(`[vesk] SSR: failed to load ${absPath}: ${(err as Error)?.message ?? String(err)}`);
      return false;
    }
    return true;
  }

  const unsupported = findUnsupportedEsm(ast.body as Array<{ type: string }>);
  if (unsupported) {
    throw new Error(
      `${absPath} uses ${unsupported} — not representable in the SSR module loader. ` +
        `Split it out of the module or avoid ${unsupported} in .vsk-imported code.`
    );
  }

  let stripped = ast;
  if (hasTsSyntax(ast)) stripped = stripTsTypes(ast);
  stripped.body = (stripped.body || []).filter((n: unknown) => {
    if (!n) return false;
    return !isTypeOnlyStatement(n);
  });

  const body = esmToCjs(stripped.body as Array<{ type: string }>);
  // ESM modules are always strict; mirror per-spec `this === undefined`.
  try {
    const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', "'use strict';\n" + body);
    fn(createModuleRequire(dirname(absPath)), { exports: exportsObj }, exportsObj, dirname(absPath), absPath);
  } catch (err) {
    console.warn(`[vesk] SSR: failed to load ${absPath}: ${(err as Error)?.message ?? String(err)}`);
    return false;
  }
  return true;
}

const EVALUATING = new Map<string, Record<string, unknown>>();

/**
 * Detects ESM constructs the CJS rewrite cannot express, returning a
 * human-readable name (`import.meta`, `top-level await`) or `null`.
 * Nested usage inside function/class bodies is legal ESM and fine here.
 */
function findUnsupportedEsm(body: Array<{ type: string } & Record<string, unknown>>): string | null {
  for (const stmt of body) {
    const hit = scanUnsupportedNode(stmt);
    if (hit) return hit;
  }
  return null;
}

function scanUnsupportedNode(node: unknown, inFunction = false): string | null {
  if (!node || typeof node !== 'object') return null;
  const n = node as Record<string, unknown>;
  const t = n.type as string | undefined;
  if (t === 'MetaProperty' || (t === 'MetaProperty' && (n.meta as { name?: string })?.name === 'import')) {
    return 'import.meta';
  }
  if (!inFunction && t === 'AwaitExpression') return 'top-level await';
  if (
    t === 'FunctionDeclaration' || t === 'FunctionExpression' ||
    t === 'ArrowFunctionExpression' || t === 'ClassDeclaration' || t === 'ClassExpression'
  ) {
    return null;
  }
  for (const key of Object.keys(n)) {
    const val = n[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object') {
          const sub = scanUnsupportedNode(item, inFunction);
          if (sub) return sub;
        }
      }
    } else if (val && typeof val === 'object') {
      const sub = scanUnsupportedNode(val, inFunction);
      if (sub) return sub;
    }
  }
  return null;
}

/** Recursive `require` used inside evaluated modules, rooted at their dir. */
/**
 * Resolve a compiler-owned (`@vesk/*`) specifier WITHOUT consulting tsconfig
 * `paths`. The package's own `exports` map is the authority for its own
 * subpaths — and it points at built JavaScript.
 */
function resolveCompilerOwnedModule(specifier: string): string | null {
  const viaExports = resolveViaPackageExports(specifier, process.cwd());
  if (viaExports) return viaExports;
  const viaModuleField = resolveViaPackageModuleField(specifier, process.cwd());
  if (viaModuleField) return viaModuleField;
  const native = nativeResolve(specifier, process.cwd());
  if (native && !isBuiltinPath(native)) return native;
  return null;
}

function createModuleRequire(fromDir: string): (specifier: string) => unknown {
  return (specifier: string): unknown => {
    // `@vesk/*` is compiler-owned, and it is BUILT JavaScript by the time it
    // ships (`@vesk/runtime` → `dist/index-client.js`). It must not go through
    // this loader at all, which parses with the `.vsk` grammar.
    //
    // Both halves of that were wrong, and together they took down any module
    // that imported BOTH a `@vesk/*` package and a relative module:
    //
    //  1. Resolution used the project's tsconfig `paths`, which map
    //     `@vesk/runtime/*` to `packages/runtime/src/*`, while the package's own
    //     `exports` map sends the same specifier to `dist/*.js`. The alias won,
    //     so the loader was handed raw TypeScript.
    //  2. The built runtime entry is itself a re-export barrel, so it became a
    //     lazy Proxy. Reading any name resolved a source file and parsed it
    //     with the `.vsk` grammar — which rejects `component` as a reserved
    //     word, so even `dist/ripple-runtime.js` failed.
    //
    // The resulting throw escaped the proxy read and propagated out of the
    // IMPORTING module's evaluation, so every one of its exports came back
    // `undefined` and any `track(...)` cell in it threw
    // `Cannot read properties of undefined (reading 'get')`.
    //
    // Native `require` is the right loader here: these packages ship plain JS
    // with a real `exports` map, exactly what Node is for. The bare-only and
    // relative-only cases each happened to recover via `nativeRequireFallback`,
    // which is why each looked fine in isolation and only the combination broke.
    if (isCompilerOwnedTarget(specifier)) {
      const resolved = resolveCompilerOwnedModule(specifier);
      if (resolved) {
        const native = nativeRequireFallback(resolved);
        if (native) return native;
      }
      throw new Error(`Cannot load module '${specifier}'`);
    }
    const resolved = resolveSsrModule(specifier, fromDir);
    if (!resolved) throw new Error(`Cannot find module '${specifier}'`);
    // Builtins are handled natively; files join every live evaluation frame so
    // the transitive closure stays fresh.
    for (const frame of depStack) frame.add(resolved);
    const loaded = loadSsrModule(resolved);
    if (loaded === null) throw new Error(`Cannot load module '${specifier}'`);
    return loaded;
  };
}

// ---------------------------------------------------------------------------
// tsconfig `paths` aliases.
//
// App code may import through tsconfig aliases (`@/lib/guide`, `@app/x`). The
// framework resolves them against the nearest `tsconfig.json` (walking up from
// the importing file) using `compilerOptions.baseUrl` + `compilerOptions.paths`
// with a single trailing `*` wildcard. Parsed configs are cached by tsconfig
// path and invalidated on mtime.
// ---------------------------------------------------------------------------

interface TsconfigAliases {
  exact: Map<string, string[]>;
  wildcard: Array<{ prefix: string; suffix: string; targets: string[] }>;
}

const EMPTY_ALIASES: TsconfigAliases = { exact: new Map(), wildcard: [] };
const ALIAS_CACHE = new Map<string, { mtimeMs: number; aliases: TsconfigAliases }>();

/** Strips `//` + block comments and trailing commas so a tsconfig.json parses. */
function parseJsonc(raw: string): unknown {
  let out = '';
  let inString = false;
  let quote = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, '$1'));
}

/** Nearest `tsconfig.json` at or above `fromDir`, or null. */
export function findTsconfigPath(fromDir: string): string | null {
  let dir = fromDir;
  for (let depth = 0; depth < 64; depth++) {
    const st = statOrNull(join(dir, 'tsconfig.json'));
    if (st && st.isFile()) return join(dir, 'tsconfig.json');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function buildAliases(tsconfig: string): TsconfigAliases {
  let raw: string;
  try {
    raw = readFileSync(tsconfig, 'utf-8');
  } catch {
    return EMPTY_ALIASES;
  }
  let parsed: { compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | null = null;
  try {
    parsed = parseJsonc(raw) as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | null;
  } catch {
    return EMPTY_ALIASES;
  }
  const co = parsed?.compilerOptions;
  if (!co || typeof co.paths !== 'object' || co.paths === null) return EMPTY_ALIASES;
  const configDir = dirname(tsconfig);
  const baseUrl =
    typeof co.baseUrl === 'string' && co.baseUrl.length > 0 ? resolve(configDir, co.baseUrl) : configDir;
  const exact = new Map<string, string[]>();
  const wildcard: TsconfigAliases['wildcard'] = [];
  for (const [key, value] of Object.entries(co.paths as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const targets = value.filter((t): t is string => typeof t === 'string').map((t) => resolve(baseUrl, t));
    if (targets.length === 0) continue;
    const star = key.indexOf('*');
    if (star === -1) exact.set(key, targets);
    else wildcard.push({ prefix: key.slice(0, star), suffix: key.slice(star + 1), targets });
  }
  // Longest prefix first so a specific alias (`@app/`) beats a broad one (`@/`).
  wildcard.sort((a, b) => b.prefix.length - a.prefix.length);
  return { exact, wildcard };
}

function loadAliases(fromDir: string): TsconfigAliases {
  const tsconfig = findTsconfigPath(fromDir);
  if (!tsconfig) return EMPTY_ALIASES;
  const st = statOrNull(tsconfig);
  if (!st) return EMPTY_ALIASES;
  const cached = ALIAS_CACHE.get(tsconfig);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.aliases;
  const aliases = buildAliases(tsconfig);
  if (ALIAS_CACHE.size >= 64) ALIAS_CACHE.clear();
  ALIAS_CACHE.set(tsconfig, { mtimeMs: st.mtimeMs, aliases });
  return aliases;
}

/**
 * Resolves a tsconfig-alias specifier (`@/x`, `@app/x`) to an existing file via
 * the nearest tsconfig's `baseUrl` + `paths`, or null when the specifier is not
 * aliased or no target exists (caller then falls through to normal resolution).
 */
export function resolveAliasModule(spec: string, fromDir: string): string | null {
  const aliases = loadAliases(fromDir);
  if (aliases.exact.size === 0 && aliases.wildcard.length === 0) return null;
  const candidates: string[] = [];
  const exact = aliases.exact.get(spec);
  if (exact) candidates.push(...exact);
  for (const w of aliases.wildcard) {
    if (spec.startsWith(w.prefix) && spec.endsWith(w.suffix) && spec.length >= w.prefix.length + w.suffix.length) {
      const middle = spec.slice(w.prefix.length, spec.length - w.suffix.length);
      candidates.push(...w.targets.map((t) => t.replace('*', middle)));
    }
  }
  for (const candidate of candidates) {
    const found = probeFile(candidate);
    if (found) return found;
  }
  return null;
}

/**
 * Resolves a relative import specifier to an absolute file path for a bundler
 * (esbuild/rollup) to consume. An explicit extension is preserved — `./x.ts`
 * stays `./x.ts` and must never become `./x.ts.ts`. An extensionless specifier
 * is probed against `EXTENSIONS` (then `.vsk`, so component imports resolve),
 * and falls back to `.ts` so the bundler reports the missing file by name.
 * tsconfig `paths` aliases (`@/x`, `@app/x`) resolve against the app tsconfig;
 * other bare/absolute specifiers are returned unchanged. This is the single
 * source of truth for every relative-import rewrite (SSR loader and client
 * chunk bundler).
 */
export function resolveImportPath(spec: string, fromDir: string): string {
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const base = resolve(fromDir, spec);
    if (extname(base)) return base;
    for (const suffix of EXTENSIONS) {
      if (existsSync(base + suffix)) return base + suffix;
    }
    if (existsSync(`${base}.vsk`)) return `${base}.vsk`;
    return `${base}.ts`;
  }
  if (!isAbsolute(spec)) {
    const aliased = resolveAliasModule(spec, fromDir);
    if (aliased) return aliased;
  }
  return spec;
}

/**
 * Resolves a specifier to an absolute file path (or a `BUILTIN_PREFIX` marker
 * for Node builtins). Relative/absolute localities use extension probing;
 * tsconfig `paths` aliases (`@/x`, `@app/x`) resolve against the app tsconfig;
 * other bare specifiers (`npm-package`, `pkg/subpath`, `node:fs`, `fs`) prefer
 * Node's own resolver — which understands `exports` maps, conditions, scoped
 * packages and builtins — and fall back to a `node_modules` walk-up.
 *
 * Every resolved file path is normalized through `realpathSync` so two
 * specifiers pointing at the same physical file (e.g. pnpm/yarn symlinked
 * `node_modules`) share one cache entry and one module instance.
 */
export function resolveSsrModule(specifier: string, fromDir: string): string | null {
  let resolved: string | null = null;
  if (specifier === '.' || specifier === '..') {
    // Literal `.`/`..` are relative — anchor them to the importing file's
    // directory like every other relative specifier (a bare resolve()
    // against process.cwd() silently resolved the wrong directory).
    resolved = probeFile(resolve(fromDir, specifier));
  } else if (isAbsolute(specifier)) {
    resolved = probeFile(resolve(specifier));
  } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
    resolved = probeFile(resolve(fromDir, specifier));
  } else {
    // tsconfig `paths` alias (`@/x`, `@app/x`) — resolved before Node's
    // resolver so app-local aliases win over any same-named package.
    const aliased = resolveAliasModule(specifier, fromDir);
    if (aliased) return toRealPath(aliased);
    // Bare specifier. A package's `exports` map is consulted BEFORE Node's own
    // resolver: `createRequire.resolve` applies the CJS conditions, so it picks
    // a `.cjs` build for a package that also ships ESM — and fails outright on
    // an `import`-only package. Vesk emits ESM, so the `import` condition is
    // the correct one. Node's resolver stays as the fallback (builtins, exotic
    // conditions), and the node_modules walk after that.
    const viaExports = resolveViaPackageExports(specifier, fromDir);
    if (viaExports) return viaExports;
    // Same reasoning for the legacy fields: a package declaring both `module`
    // and `main` wants the ESM build (Vesk emits ESM), while `createRequire`
    // would take `main` and hand us the CJS one.
    const viaModuleField = resolveViaPackageModuleField(specifier, fromDir);
    if (viaModuleField) return viaModuleField;
    // Bare specifier — prefer the native resolver (exports map, conditions,
    // builtins, symlinks), then fall back to a node_modules walk-up.
    const native = nativeResolve(specifier, fromDir);
    if (native) return native; // realpath'd inside nativeResolve / builtin marker
    let dir = fromDir;
    for (let depth = 0; depth < 64; depth++) {
      const base = join(dir, 'node_modules', specifier);
      const found = probeFile(base);
      if (found) {
        resolved = found;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return resolved ? toRealPath(resolved) : null;
}

/** Normalizes a resolved file path through `realpathSync` (no-op on failure). */
function toRealPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Native resolution of a bare specifier. `createRequire.resolve` returns an
 * absolute file path for packages; for builtins it returns the bare specifier
 * itself (`'node:fs'` / `'fs'`), which `resolveSsrModule` marks as a builtin.
 */
function nativeResolve(specifier: string, fromDir: string): string | null {
  try {
    const req = createRequire(join(fromDir, '__vesk_resolve__.js'));
    const resolved = req.resolve(specifier);
    if (isAbsolute(resolved)) return toRealPath(resolved);
    return builtinMarker(resolved);
  } catch {
    return null;
  }
}

function builtinMarker(name: string): string {
  return BUILTIN_PREFIX + name;
}

function isBuiltinPath(p: string): boolean {
  return p.startsWith(BUILTIN_PREFIX);
}

/** Loads a Node builtin module (never cached in `MODULE_CACHE`, never stale). */
function loadBuiltin(name: string): Record<string, unknown> | null {
  const id = name.startsWith('node:') ? name : `node:${name}`;
  const cachedVal = BUILTIN_CACHE.get(id);
  if (cachedVal) return cachedVal;
  try {
    const req = createRequire(join('/', '__vesk_builtin__.js'));
    const loaded = req(id);
    let mod: Record<string, unknown> | null = null;
    if (loaded && typeof loaded === 'object') mod = loaded as Record<string, unknown>;
    else if (loaded !== null && loaded !== undefined) mod = { default: loaded };
    if (mod) BUILTIN_CACHE.set(id, mod);
    return mod;
  } catch {
    return null;
  }
}

function statOrNull(p: string): { isFile: () => boolean; isDirectory: () => boolean; mtimeMs: number } | null {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

/**
 * Resolve a subpath through a package's `exports` map.
 *
 * This is what makes a Vesk app work inside an existing pnpm/npm/yarn
 * workspace. A modern workspace package declares `exports` and often NO `main`
 * (or points `main` at a CJS build while the app imports ESM), and subpath
 * imports (`@acme/ui/button`) resolve through the map rather than through the
 * directory layout. Without this, such a package simply does not resolve, and
 * the app has to vendor it.
 *
 * Conditions are tried in import order: `import`, `module`, `node`, `default`.
 * A pattern (`./dist/*.js`) is matched with the single `*` capture.
 */
export function resolveExports(exportsField: unknown, subpath: string): string | null {
  const conditions = ['import', 'module', 'node', 'default'];
  const target = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return null;
    for (const cond of conditions) {
      if (cond in (value as Record<string, unknown>)) {
        const got = target((value as Record<string, unknown>)[cond]);
        if (got) return got;
      }
    }
    return null;
  };

  if (typeof exportsField === 'string') return subpath === '.' ? exportsField : null;
  if (!exportsField || typeof exportsField !== 'object') return null;
  const map = exportsField as Record<string, unknown>;

  if (subpath in map) {
    const direct = target(map[subpath]);
    if (direct) return direct;
    return null;
  }
  // Longest-prefix match for `./*` patterns, as Node does.
  let best: { key: string; star: string } | null = null;
  for (const key of Object.keys(map)) {
    const star = key.indexOf('*');
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    if (subpath.length < prefix.length + suffix.length) continue;
    if (best === null || prefix.length > best.key.length) {
      best = { key: prefix, star: subpath.slice(prefix.length, subpath.length - suffix.length) };
    }
  }
  if (!best) return null;
  const pattern = target(map[Object.keys(map).find((k) => k.startsWith(best.key + '*') && k.endsWith(best.key.slice(0, -1)) + '*') as string] ?? map[`${best.key}*`]);
  if (pattern === null) return null;
  return pattern.split('*').join(best.star);
}

/**
 * Resolve a bare specifier through a package's `module` field (the ESM entry
 * in a package that also has a CJS `main`).
 */
export function resolveViaPackageModuleField(specifier: string, fromDir: string): string | null {
  const firstSlash = specifier.indexOf('/');
  const splitAt = specifier.startsWith('@') ? specifier.indexOf('/', firstSlash + 1) : firstSlash;
  const pkgName = splitAt > 0 ? specifier.slice(0, splitAt) : specifier;
  if (splitAt > 0) return null; // a subpath import needs the exports map
  let dir = fromDir;
  for (let depth = 0; depth < 64; depth++) {
    const pkgPath = join(dir, 'node_modules', pkgName, 'package.json');
    if (statOrNull(pkgPath) !== null) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { module?: unknown };
        if (typeof pkg.module === 'string' && pkg.module.length > 0) {
          const found = probeFile(resolve(join(dir, 'node_modules', pkgName), pkg.module));
          if (found) return toRealPath(found);
        }
      } catch {
        // malformed package.json — fall through
      }
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve a bare specifier through its package's `exports` map, walking
 * node_modules upwards. Returns null when the package has no map, does not
 * export the subpath, or cannot be read.
 */
export function resolveViaPackageExports(specifier: string, fromDir: string): string | null {
  // A scoped name (`@acme/ui`) has its slash INSIDE the package name — taking
  // the first slash as the subpath separator turns it into package `@acme` +
  // subpath `./ui`, which no `exports` map matches, and the lookup silently
  // falls through to Node's resolver.
  const firstSlash = specifier.indexOf('/');
  const splitAt = specifier.startsWith('@') ? specifier.indexOf('/', firstSlash + 1) : firstSlash;
  const pkgName = splitAt > 0 ? specifier.slice(0, splitAt) : specifier;
  const subpath = splitAt > 0 ? '.' + specifier.slice(splitAt) : '.';
  let dir = fromDir;
  for (let depth = 0; depth < 64; depth++) {
    const pkgDir = join(dir, 'node_modules', pkgName);
    const pkgPath = join(pkgDir, 'package.json');
    if (statOrNull(pkgPath) !== null) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { exports?: unknown };
        if (pkg.exports !== undefined) {
          const target = resolveExports(pkg.exports, subpath);
          if (target) {
            const found = probeFile(resolve(pkgDir, target));
            if (found) return toRealPath(found);
          }
        }
      } catch {
        // malformed package.json — fall through to the resolvers below
      }
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function probeFile(base: string): string | null {
  const st = statOrNull(base);
  if (st && st.isFile()) return base;
  if (st && st.isDirectory()) {
    const pkgPath = join(base, 'package.json');
    const pkgSt = statOrNull(pkgPath);
    if (pkgSt && pkgSt.isFile()) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { main?: unknown; module?: unknown; exports?: unknown };
        // `exports` first: it is what the package author intends and what a
        // workspace package usually ships. `main`/`module` are the legacy
        // fallbacks.
        if (pkg.exports !== undefined) {
          const viaExports = resolveExports(pkg.exports, '.');
          if (viaExports) {
            const found = probeFile(resolve(base, viaExports));
            if (found) return found;
          }
        }
        for (const field of ['module', 'main'] as const) {
          const value = pkg[field];
          if (typeof value === 'string' && value.length > 0) {
            const found = probeFile(resolve(base, value));
            if (found) return found;
          }
        }
      } catch {
        // ignore malformed package.json
      }
    }
    return probeFile(join(base, 'index'));
  }
  const ext = extname(base);
  if (ext.length === 0 || '/\\'.includes(base[base.length - 1] as string)) {
    for (const suffix of EXTENSIONS) {
      const candidate = base + suffix;
      const cst = statOrNull(candidate);
      if (cst && cst.isFile()) return candidate;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// ESM -> CJS rewriting (AST-driven; never regex).
// ---------------------------------------------------------------------------

function astName(node: { type: string; name?: string; value?: unknown } | null | undefined): string {
  if (!node) return 'undefined';
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name;
  return printNode(node);
}

function printNode(node: unknown): string {
  try {
    return print(node as never, ts()).code.trim();
  } catch {
    return '';
  }
}

function memberAccess(obj: string, prop: { type: string; name?: string; value?: unknown }): string {
  if (prop.type === 'Identifier' && typeof prop.name === 'string') return `${obj}.${prop.name}`;
  if ((prop.type === 'Literal' || prop.type === 'StringLiteral') && typeof prop.value === 'string') {
    return `${obj}[${JSON.stringify(prop.value)}]`;
  }
  return `${obj}[${astName(prop)}]`;
}

/**
 * Unquoted string value of an export key node (Identifier name, string literal
 * value, or the printed node with its surrounding quotes stripped).
 */
function exportKeyName(node: { type: string; name?: string; value?: unknown } | null | undefined): string {
  if (!node) return '';
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name;
  if ((node.type === 'Literal' || node.type === 'StringLiteral') && typeof node.value === 'string') return node.value;
  const printed = printNode(node);
  return stripOuterQuotes(printed);
}

function stripOuterQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'" || first === '`') && first === last) return s.slice(1, -1);
  }
  return s;
}

/**
 * Emits a live-binding getter for an export, so consumers observe mutations
 * the way real ESM live bindings do (a snapshot `exports.x = x` goes stale).
 */
function exportGetter(lines: string[], key: string, valueExpr: string): void {
  lines.push(`Object.defineProperty(exports, ${JSON.stringify(key)}, { get: () => ${valueExpr}, enumerable: true });`);
}

let exportCounter = 0;

/** Rewrites an ESM program body (imports/exports removed) into CJS statements. */
export function esmToCjs(body: Array<{ type: string } & Record<string, unknown>>): string {
  const lines: string[] = [];
  for (const stmt of body) {
    switch (stmt.type) {
      case 'ImportDeclaration': {
        const source = printNode(stmt.source);
        const specifiers = (stmt.specifiers as Array<Record<string, unknown>>) || [];
        if (specifiers.length === 0) {
          lines.push(`require(${source});`);
          continue;
        }
        for (const spec of specifiers) {
          if (spec.type === 'ImportNamespaceSpecifier') {
            lines.push(`const ${astName(spec.local as { type: string; name?: string })} = require(${source});`);
          } else if (spec.type === 'ImportDefaultSpecifier') {
            lines.push(`const ${astName(spec.local as { type: string; name?: string })} = require(${source}).default;`);
          } else {
            // ImportSpecifier
            const local = astName(spec.local as { type: string; name?: string });
            const imported = spec.imported as { type: string; name?: string } | null;
            if (imported && spec.importKind === 'type') continue;
            lines.push(`const ${local} = ${memberAccess(`require(${source})`, imported || (spec.local as { type: string; name?: string }))};`);
          }
        }
        break;
      }
      case 'ExportNamedDeclaration': {
        if (stmt.exportKind === 'type') continue;
        const declaration = stmt.declaration as Record<string, unknown> | null;
        const source = stmt.source ? printNode(stmt.source) : null;
        if (declaration) {
          const printed = printNode(declaration);
          if (printed) {
            lines.push(printed);
            if (declaration.type === 'VariableDeclaration') {
              const declarators = (declaration.declarations as Array<{ id?: { type: string; name?: string } }>) || [];
              for (const d of declarators) {
                if (d.id && d.id.type === 'Identifier') exportGetter(lines, exportKeyName(d.id), d.id.name ?? '');
              }
            } else if ((declaration as { id?: { type: string; name?: string } }).id) {
              const name = (declaration as { id: { type: string; name?: string } }).id;
              exportGetter(lines, exportKeyName(name), name.name ?? '');
            }
          }
        } else if (source) {
          const modVar = `__veskExport${exportCounter++}`;
          lines.push(`const ${modVar} = require(${source});`);
          const specifiers = (stmt.specifiers as Array<Record<string, unknown>>) || [];
          for (const spec of specifiers) {
            if (spec.exportKind === 'type') continue;
            const local = spec.local as { type: string; name?: string };
            const exported = spec.exported as { type: string; name?: string };
            exportGetter(lines, exportKeyName(exported), memberAccess(modVar, local));
          }
        } else {
          const specifiers = (stmt.specifiers as Array<Record<string, unknown>>) || [];
          for (const spec of specifiers) {
            if (spec.exportKind === 'type') continue;
            const local = spec.local as { type: string; name?: string };
            const exported = spec.exported as { type: string; name?: string };
            exportGetter(lines, exportKeyName(exported), astName(local));
          }
        }
        break;
      }
      case 'ExportDefaultDeclaration': {
        const declaration = stmt.declaration as Record<string, unknown>;
        if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
          if (declaration.id) {
            const name = (declaration.id as { name: string }).name;
            lines.push(printNode(declaration));
            lines.push(`exports.default = ${name};`);
          } else {
            const expr = { ...declaration, type: declaration.type === 'FunctionDeclaration' ? 'FunctionExpression' : 'ClassExpression' };
            lines.push(`exports.default = ${printNode(expr)};`);
          }
        } else {
          lines.push(`exports.default = ${printNode(declaration)};`);
        }
        break;
      }
      case 'ExportAllDeclaration': {
        const source = printNode(stmt.source);
        const modVar = `__veskExport${exportCounter++}`;
        lines.push(`const ${modVar} = require(${source});`);
        if (stmt.exported) {
          lines.push(`exports[${JSON.stringify(exportKeyName(stmt.exported as { type: string; name?: string; value?: unknown }))}] = ${modVar};`);
        } else {
          lines.push(`for (const __veskKey in ${modVar}) { if (__veskKey !== 'default' && __veskKey !== '__esModule' && !(__veskKey in exports)) exports[__veskKey] = ${modVar}[__veskKey]; }`);
        }
        break;
      }
      default:
        lines.push(printNode(stmt));
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// AOT: build-time bundling of the modules a `.vsk` file imports.
//
// Produces a self-contained, JSON-safe description of a module and its whole
// relative-import closure. The runtime side (`precompile-runtime.ts`) re-runs
// each module's transformed CJS body behind a require shim that routes
// relative specifiers to sibling bundled modules, so closures (a module
// exporting an arrow that captures module-scope data) survive the trip —
// they can never be captured by `Function.prototype.toString()`.
// ---------------------------------------------------------------------------

export interface BundledModuleData {
  /** Synthetic loader key (e.g. `__veskMod0`), referenced by deps/bindings. */
  key: string;
  /** ESM->CJS rewritten body (or raw CJS / JSON `module.exports` body). */
  code: string;
  /** Directory the module lived in at build time (require fallback anchor). */
  dir: string;
  /** Relative specifier (as written) -> sibling module key. */
  deps: Record<string, string>;
}

export interface ModuleBindingData {
  /** Local binding name used inside the `.vsk` file. */
  local: string;
  /** Module key this binding resolves to. */
  key: string;
  /** `default` | `*` | named export. */
  kind: string;
}

function isRelativeSpec(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../');
}

function stringLiteralValue(node: unknown): string | null {
  const n = node as { type?: string; value?: unknown } | null | undefined;
  if (n && (n.type === 'Literal' || n.type === 'StringLiteral') && typeof n.value === 'string') {
    return n.value;
  }
  return null;
}

/**
 * Extracts the module specifiers a module body reaches for through import/
 * export sources, `require(...)` calls and `import(...)` expressions.
 * Type-only import/export statements contribute nothing here.
 */
function collectModuleSpecifiers(ast: any): Set<string> {
  const specs = new Set<string>();
  walk(ast, null, {
    ImportDeclaration(node: Record<string, unknown>) {
      if (node.importKind === 'type') return;
      const v = stringLiteralValue(node.source);
      if (v) specs.add(v);
    },
    ExportNamedDeclaration(node: Record<string, unknown>) {
      if ((node.exportKind === 'type') || !node.source) return;
      const v = stringLiteralValue(node.source);
      if (v) specs.add(v);
    },
    ExportAllDeclaration(node: Record<string, unknown>) {
      if (node.exportKind === 'type') return;
      const v = stringLiteralValue(node.source);
      if (v) specs.add(v);
    },
    CallExpression(node: Record<string, unknown>) {
      const callee = node.callee as { type?: string; name?: string } | null | undefined;
      if (!callee || callee.type !== 'Identifier' || callee.name !== 'require') return;
      const args = (node.arguments || []) as unknown[];
      const v = stringLiteralValue(args[0]);
      if (v) specs.add(v);
    },
    ImportExpression(node: Record<string, unknown>) {
      const v = stringLiteralValue(node.source);
      if (v) specs.add(v);
    },
  });
  return specs;
}

export type ModuleCollector = {
  keysByAbs: Map<string, string>;
  modules: BundledModuleData[];
};

/**
 * Bundles one module file (plus its relative closure) into `collector`.
 * Returns the synthetic key loaded modules use to reference it.
 */
export function collectModuleBundled(absPath: string, collector: ModuleCollector): string {
  const existing = collector.keysByAbs.get(absPath);
  if (existing) return existing;
  const key = `__veskMod${collector.keysByAbs.size}`;
  collector.keysByAbs.set(absPath, key);
  const dir = dirname(absPath);

  if (absPath.endsWith('.json')) {
    let raw = '';
    try {
      raw = readFileSync(absPath, 'utf-8');
    } catch (err) {
      raw = '{}';
    }
    collector.modules.push({ key, code: `module.exports = ${raw};`, dir, deps: {} });
    return key;
  }

  // The transpiled code and the relative specifiers of a module do not depend
  // on which collector is asking, only on the file — and every `.vsk` compile
  // builds its own collector, so a docs-style app whose 26 pages all import one
  // content module read, parsed, stripped and re-transpiled that module 26
  // times (51s of a 95s build). Cache the result against the file's mtime and
  // skip the read AND the parse on a hit: callers mutate the AST they get
  // (`stripTsTypes`, `stripped.body = ...`), so the AST itself stays private to
  // the call that created it.
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(absPath).mtimeMs;
  } catch { /* unreadable: fall through to the uncached path */ }
  const cached = mtimeMs >= 0 ? bundledCodeCache.get(absPath) : undefined;
  let code: string;
  let specifiers: string[];
  if (cached && cached.mtimeMs === mtimeMs) {
    code = cached.code;
    specifiers = cached.specifiers;
  } else {
    const src = readSsrSource(absPath);
    if (!src || !src.ast) {
      // A module we could not parse is a hard failure. Substituting the raw
      // source (the historical behavior) pushes every type annotation in this
      // file into `new Function` and blames some unrelated module later.
      if (src?.parseError) throw src.parseError;
      const raw = src ? src.raw : '// unreadable during build\nmodule.exports = {};';
      collector.modules.push({ key, code: raw, dir, deps: {} });
      return key;
    }
    let stripped = src.ast;
    if (hasTsSyntax(src.ast)) stripped = stripTsTypes(src.ast);
    stripped.body = (stripped.body || []).filter((n: unknown) => (n ? !isTypeOnlyStatement(n) : false));
    specifiers = [...collectModuleSpecifiers(src.ast)];
    code = esmToCjs(stripped.body as Array<{ type: string }>);
    bundledCodeCache.set(absPath, { mtimeMs, code, specifiers });
    evict(bundledCodeCache);
  }

  const deps: Record<string, string> = {};
  for (const spec of specifiers) {
    if (!isRelativeSpec(spec)) continue;
    const depPath = resolveSsrModule(spec, dir);
    if (!depPath) continue;
    deps[spec] = collectModuleBundled(depPath, collector);
  }

  collector.modules.push({ key, code, dir, deps });
  return key;
}

const bundledCodeCache = new Map<string, { mtimeMs: number; code: string; specifiers: string[] }>();

/**
 * Builds the module bundle + local-binding list for a set of import lines
 * (a `.vsk` file's `imports`). Framework-owned, `.vsk`, `.css` and markdown
 * targets are skipped exactly as `applyLocalModuleImports` skips them, so the
 * hydrate-time scope matches today's runtime module loader.
 */
export function collectModuleBundle(
  importStrs: string[],
  fromDir: string | undefined,
  collector: ModuleCollector
): ModuleBindingData[] {
  const bindings: ModuleBindingData[] = [];
  if (!fromDir) return bindings;
  for (const imp of importStrs) {
    const target = importModuleTarget(imp);
    if (!target || isCompilerOwnedTarget(target) || isValueLessTarget(target)) continue;
    const resolved = resolveSsrModule(target, fromDir);
    if (!resolved) {
      // Keep render behavior identical to the runtime loader (warn + skip).
      continue;
    }
    const key = collectModuleBundled(resolved, collector);
    for (const pair of importBindingPairs(imp)) {
      bindings.push({ local: pair.local, key, kind: pair.imported });
    }
  }
  return bindings;
}