import { readFileSync, existsSync, writeFileSync, unlinkSync, statSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { build } from './esbuild-fallback.js';
import { stripCodeTypes } from '@vesk/compiler/src/strip-ts';
import { parse, parseGeneratedJs } from '@vesk/compiler/src/parser';
import { compileClient, compileClientBoth, nameAllocFor, vskComponentNames } from '@vesk/compiler/src/client-codegen';
import { VskComponentOwners } from '@vesk/compiler/src/vsk-collision';
import { resolveComponentName } from '@vesk/compiler/src/server-codegen';
import { collectVskImportPaths, vskImportLines } from '@vesk/compiler/src/vsk-imports';
import { inlineMdContentAttrs, guessProjectRoots } from '@vesk/compiler/src/md-inline';
import { resolveImportPath, findTsconfigPath } from '@vesk/compiler/src/module-imports';
import type { RouteNode, ClientBundleOptions, ClientBundleResult, ChunkEntry, MonolithicBundleParts, ClientBundleChunkSpec, ClientBundleFileEntry } from '@vesk/adapter/src/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fileUnchanged(filePath: string, cached: { mtimeMs: number; size: number }): boolean {
  try {
    const st = statSync(filePath);
    return st.mtimeMs === cached.mtimeMs && st.size === cached.size;
  } catch {
    return false;
  }
}

function buildRouterOpts(options?: ClientBundleOptions): string {
  const ttl = options?.routeDataCache;
  if (typeof ttl === 'number' && ttl > 0) {
    return `, { routeDataCache: ${ttl} }`;
  }
  return '';
}

function findRuntimeSrc(appDir: string): string {
  const monorepoRoot = resolve(__dirname, '..', '..', '..');
  const candidates = [
    resolve(monorepoRoot, 'packages', 'runtime', 'dist'),
    resolve(appDir, '..', 'node_modules', '@vesk/runtime'),
    resolve(appDir, 'node_modules', '@vesk/runtime'),
  ];
  for (const base of candidates) {
    for (const dir of [base, join(base, 'dist')]) {
      if (existsSync(join(dir, 'index-client.js'))) return dir;
    }
  }
  throw new Error('@vesk/runtime/dist not found — run "npm run build" first');
}

/**
 * Pure name-collection used by `generateClientBundle`'s tree-shake request.
 *
 * Parses the (already compiled) client module with the compiler's AST pass and
 * keeps only genuine top-level `import { … } from '@vesk/runtime…'` declarations.
 * Import-shaped text inside template literals, strings, or comments — e.g. a
 * doc code sample stored as `const md = \`import { VeskResponse } from
 * '@vesk/runtime/server'\`` — never becomes an ImportDeclaration node, so those
 * server-only names cannot poison the client runtime request. This is
 * deliberately AST-only (no text scanning): text heuristics are what let
 * server-only names leak into the client tree-shake request in the first
 * place. If the compiled module ever fails to parse, we collect nothing rather
 * than guess.
 */
export function extractRuntimeImportNames(code: string): string[] {
  const names: string[] = [];
  // Shares the parse with the strip passes (same generated string, read-only
  // AST) — see parseForStrip.
  const ast = parseForStrip(code) as { body?: Array<unknown> } | null;
  if (!ast) return names;
  const body = ast.body ?? [];
  for (const raw of body) {
    const node = raw as {
      type?: string;
      importKind?: string;
      source?: { value?: unknown };
      specifiers?: Array<{
        type?: string;
        imported?: { name?: string } | null;
        local?: { name?: string } | null;
      }>;
    };
    if (node.type !== 'ImportDeclaration') continue;
    const src = node.source?.value;
    if (typeof src !== 'string' || !(src === '@vesk/runtime' || src.startsWith('@vesk/runtime/'))) continue;
    if (node.importKind === 'type') continue;
    for (const spec of node.specifiers ?? []) {
      const name = spec.type === 'ImportSpecifier' ? spec.imported?.name : spec.local?.name;
      if (name) names.push(name);
    }
  }
  return names;
}

/**
 * Minimal structural view of a compiled client module's top-level statements.
 * Everything here is read from the compiler's AST — no text scanning — so
 * import-shaped doc samples inside template literals are never treated as real
 * statements (see `removeCompiledNodes`).
 */
interface CompiledNode {
  type?: string;
  importKind?: string;
  source?: { value?: unknown };
  id?: { name?: string };
  declarations?: Array<{ id?: { name?: string }; init?: { type?: string; object?: { type?: string; name?: string } } }>;
  declaration?: {
    type?: string;
    object?: { type?: string; name?: string };
    declarations?: Array<{ init?: { type?: string; object?: { type?: string; name?: string } } }>;
  };
  start?: number;
  end?: number;
}

function isRuntimeImport(node: CompiledNode): boolean {
  if (node.type !== 'ImportDeclaration') return false;
  const src = node.source?.value;
  return src === '@vesk/runtime' || (typeof src === 'string' && src.startsWith('@vesk/runtime/'));
}

function isVskImport(node: CompiledNode): boolean {
  if (node.type !== 'ImportDeclaration') return false;
  const src = node.source?.value;
  return typeof src === 'string' && src.endsWith('.vsk');
}

function isAnyImport(node: CompiledNode): boolean {
  return node.type === 'ImportDeclaration';
}

/**
 * Generated client-preamble nodes the bundle must not re-emit: the local
 * `const __components = {}` registry plus the `__cleanup` / `__place` helpers —
 * the chunk IIFEs already define their own `__components`, so a second
 * declaration in the same scope would be a syntax error.
 */
function isRuntimePreamble(node: CompiledNode): boolean {
  if (node.type === 'FunctionDeclaration' && (node.id?.name === '__cleanup' || node.id?.name === '__place')) {
    return true;
  }
  if (node.type === 'VariableDeclaration') {
    return node.declarations?.[0]?.id?.name === '__components';
  }
  return false;
}

/**
 * `export default __components[<name>];` / `export const <name> = __components[<name>];`
 * aliases emitted by codegen. The bundle registers components on `__components`
 * directly, so these module-level re-exports must go.
 */
function isComponentExport(node: CompiledNode): boolean {
  if (node.type === 'ExportDefaultDeclaration') {
    const d = node.declaration;
    return !!d && d.type === 'MemberExpression' && d.object?.type === 'Identifier' && d.object.name === '__components';
  }
  if (node.type === 'ExportNamedDeclaration') {
    const init = node.declaration?.type === 'VariableDeclaration' ? node.declaration.declarations?.[0]?.init : undefined;
    return !!init && init.type === 'MemberExpression' && init.object?.type === 'Identifier' && init.object.name === '__components';
  }
  return false;
}

/**
 * Top-level statements an HMR eval snippet must never carry: imports,
 * re-exports and the registry preamble (`const __components = …`,
 * `const __hydrators = …`) plus the `__cleanup` / `__place` helpers. The
 * eval runs against a live chunk scope where those already exist.
 */
export function isSnippetDrop(node: CompiledNode): boolean {
  if (isAnyImport(node) || isComponentExport(node) || isRuntimePreamble(node)) return true;
  return node.type === 'VariableDeclaration'
    && (node.declarations?.[0]?.id?.name === '__components'
      || node.declarations?.[0]?.id?.name === '__hydrators');
}

/**
 * Extracts matched top-level statements from a compiled client module using
 * the parser's exact `start`/`end` offsets — the complement of
 * `removeCompiledNodes`. AST-only, like everything else in this file.
 */
function extractCompiledNodes(code: string, isTarget: (node: CompiledNode) => boolean): string {
  let ast: unknown;
  try {
    ast = parse(code);
  } catch {
    return '';
  }
  const parts: string[] = [];
  for (const raw of (ast as { body?: Array<unknown> }).body ?? []) {
    const node = raw as CompiledNode;
    if (isTarget(node) && typeof node.start === 'number' && typeof node.end === 'number') {
      let cut = node.end;
      if (code[cut] === ';') cut++;
      parts.push(code.slice(node.start, cut));
    }
  }
  return parts.join('\n');
}

function isModuleLevel(node: CompiledNode): boolean {
  // import/export statements must stay at module top level (hoisted imports
  // of the same module are harmless duplicates); everything else is scoped.
  return node.type === 'ImportDeclaration'
    || node.type === 'ExportNamedDeclaration'
    || node.type === 'ExportDefaultDeclaration';
}

/**
 * When a chunk's esbuild bundle fails to resolve bare specifiers, the
 * historical fallback strips every import, leaving dangling free identifiers
 * that surface as a baffling `ReferenceError: X is not defined` at render
 * time. Native-only `@vesk/*` library imports can NEVER resolve in the
 * browser dev preview — make that a first-class, readable failure by emitting
 * a throwing proxy for every binding those imports declare: the binding reads
 * as a function, so `typeof` stays truthful, and the throw carries the
 * library, the binding, and the remedy. Other bare specifiers (e.g. `motion`,
 * dev-preview-provided) are left dangling — genuinely missing packages still
 * fail as ReferenceErrors, which is honest. AST-only; never a text scan.
 */
export function nativeLibraryImportStubs(code: string): string {
  let ast: unknown;
  try {
    ast = parse(code);
  } catch {
    return '';
  }
  const body = (ast as { body?: Array<CompiledNode> }).body ?? [];
  const bindings: Array<[string, string]> = [];
  for (const node of body) {
    if (node?.type !== 'ImportDeclaration') continue;
    const src = node.source?.value;
    if (typeof src !== 'string' || !src.startsWith('@vesk/') || src.startsWith('@vesk/runtime')) continue;
    for (const spec of (node as { specifiers?: Array<{ local?: { name?: string } }> }).specifiers ?? []) {
      if (typeof spec?.local?.name === 'string') bindings.push([spec.local.name, src]);
    }
  }
  if (bindings.length === 0) return '';
  const lines = bindings.map(([local, spec]) => {
    const message =
      `web preview: native library "${spec}" has no browser equivalent on the web ` +
      `(dev-only) — binding "${local}" cannot be provided in vesk dev --web. Build for Android to use it.`;
    const thrower = `throw Object.assign(new Error(${JSON.stringify(message)}), { __veskPreviewMissing: ${JSON.stringify(spec)} })`;
    return (
      `const ${local} = new Proxy(function () {}, { ` +
      `get: function () { ${thrower}; }, ` +
      `apply: function () { ${thrower}; }, ` +
      `construct: function () { ${thrower}; } });`
    );
  });
  return lines.join('\n') + '\n\n';
}

/**
 * Demotes surviving value exports to plain declarations (`export const x`
 * becomes `const x`) and drops bare re-export lists (`export { x }`,
 * `export default …`). Code-split chunks execute as classic scripts inside
 * an IIFE, so any `export` statement is a SyntaxError — and the chunk-local
 * binding is all cross-file references need (components resolve through the
 * `__components` / `__hydrators` registries). Offset-based on the parser AST.
 */
export function demoteExports(code: string): string {
  let ast: unknown;
  try {
    ast = parse(code);
  } catch {
    return code;
  }
  const body = (ast as { body?: Array<unknown> }).body ?? [];
  type Edit = { start: number; end: number; text: string };
  const edits: Edit[] = [];
  for (const raw of body) {
    const node = raw as CompiledNode & { declaration?: CompiledNode & { start?: number; end?: number } };
    if (typeof node.start !== 'number' || typeof node.end !== 'number') continue;
    if (node.type === 'ExportNamedDeclaration' && node.declaration
      && typeof node.declaration.start === 'number' && typeof node.declaration.end === 'number') {
      edits.push({ start: node.start, end: node.end, text: code.slice(node.declaration.start, node.declaration.end) });
    } else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration') {
      let cut = node.end;
      if (code[cut] === ';') cut++;
      edits.push({ start: node.start, end: cut, text: '' });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) code = code.slice(0, e.start) + e.text + code.slice(e.end);
  return code;
}

/**
 * Parse-free stand-in for the per-chunk `import` scan: a chunk carries live
 * `import` statements iff its deduped head rendered non-empty, or its import
 * merge aborted (in which case some file bodies retain their raw imports for
 * esbuild to bundle). Equivalent to parsing the assembled chunk code, without
 * the ~50-100KB acorn parse per chunk on every dev rebuild.
 */
function chunkHasImports(headLen: number, mergeAborted: boolean): boolean {
  return headLen > 0 || mergeAborted;
}

interface ChunkSpecifier {
  kind: 'default' | 'namespace' | 'named';
  local?: string;
  imported?: string;
}

/**
 * Accumulates every import a code-split chunk needs and rebuilds it as a
 * single deduped import block.
 *
 * A chunk is the concatenation of several independently compiled files, and
 * each file's component AND hydrator both keep their imports verbatim. So the
 * same named binding frequently appears multiple times in one chunk — once per
 * (file, comp|hyd) pair, plus once per extra file. acorn's `parse()` rejects
 * that with `Identifier has already been declared`, so a naive `import` scan
 * used to silently pass and esbuild — which rejects the same duplicates —
 * never ran; the chunk shipped with raw `import` statements inside its
 * classic-script IIFE and hydration died with `SyntaxError: Cannot use import
 * statement outside a module`.
 *
 * Processing each file's contribution in isolation avoids the duplicate
 * bindings entirely (a single compiled file parses cleanly), folds the imports
 * into a per-source map keyed by local binding, strips them from the file
 * body, and later emits one merged import block at the top of the chunk.
 */
class ChunkImports {
  private bySource = new Map<string, {
    default?: ChunkSpecifier;
    namespace?: ChunkSpecifier;
    named: Map<string, ChunkSpecifier>;
  }>();
  private aborted = false;
  private abortReason: string | null = null;

  private fail(reason: string, code: string): string {
    if (!this.aborted) {
      this.aborted = true;
      this.abortReason = reason;
    }
    return code;
  }

  /** Folds one file's imports into the merged set and returns the code with its imports stripped. */
  add(code: string, filePath: string, specSink?: ClientBundleChunkSpec[]): string {
    if (!code || this.aborted) return code;
    let ast: unknown;
    try {
      ast = parse(code);
    } catch {
      // A single compiled file is always valid ESM; if it somehow is not,
      // stop merging so the assembler falls back to the historical path.
      return this.fail(`unparseable contribution from ${filePath}`, code);
    }
    const body = (ast as { body?: Array<unknown> }).body ?? [];
    const ranges: Array<[number, number]> = [];
    for (const raw of body) {
      const node = raw as CompiledNode & { specifiers?: Array<unknown>; source?: { value?: unknown } };
      if (node.type !== 'ImportDeclaration' || typeof node.start !== 'number' || typeof node.end !== 'number') continue;
      const src = node.source?.value;
      if (typeof src !== 'string') continue;
      const resolved = resolveImportPath(src, dirname(filePath));
      for (const spec of node.specifiers ?? []) {
        const s = spec as { type?: string; local?: { name?: string }; imported?: { name?: string } };
        const local = s.local?.name;
        if (typeof local !== 'string') return this.fail(`nameless specifier from '${resolved}' in ${filePath}`, code);
        if (s.type === 'ImportDefaultSpecifier') {
          if (!this.foldSpec(resolved, 'default', local, undefined, filePath, code)) return code;
          specSink?.push({ source: resolved, kind: 'default', local });
        } else if (s.type === 'ImportNamespaceSpecifier') {
          if (!this.foldSpec(resolved, 'namespace', local, undefined, filePath, code)) return code;
          specSink?.push({ source: resolved, kind: 'namespace', local });
        } else if (s.type === 'ImportSpecifier') {
          const imported = s.imported?.name;
          if (typeof imported !== 'string') return this.fail(`nameless named-import from '${resolved}' in ${filePath}`, code);
          if (!this.foldSpec(resolved, 'named', local, imported, filePath, code)) return code;
          specSink?.push({ source: resolved, kind: 'named', local, imported });
        }
      }
      let cut = node.end;
      if (code[cut] === ';') cut++;
      ranges.push([node.start, cut]);
    }
    if (ranges.length === 0) return code;
    return removeRanges(code, ranges);
  }

  /**
   * Shared single-spec fold used by both the fresh compile path and the
   * parse-free warm replay. Returns false (and aborts the merge) on a
   * conflicting binding — same shape as the pre-refactor inline logic.
   */
  foldSpec(source: string, kind: 'default' | 'namespace' | 'named', local: string, imported: string | undefined, filePath: string, code: string): boolean {
    let group = this.bySource.get(source);
    if (!group) {
      group = { named: new Map() };
      this.bySource.set(source, group);
    }
    if (kind === 'default') {
      if (group.default && group.default.local !== local) { this.fail(`conflicting default imports from '${source}' in ${filePath}`, code); return false; }
      group.default = { kind: 'default', local };
    } else if (kind === 'namespace') {
      if (group.namespace && group.namespace.local !== local) { this.fail(`conflicting namespace imports from '${source}' in ${filePath}`, code); return false; }
      group.namespace = { kind: 'namespace', local };
    } else {
      if (typeof imported !== 'string') { this.fail(`nameless named-import from '${source}' in ${filePath}`, code); return false; }
      const existing = group.named.get(imported);
      if (existing && existing.local !== local) { this.fail(`'${imported}' from '${source}' bound to both '${existing.local}' and '${local}' in ${filePath}`, code); return false; }
      group.named.set(imported, { kind: 'named', local, imported });
    }
    return true;
  }

  /** True when every file parsed and merged cleanly (no conflict, no parse abort). */
  get ok(): boolean {
    return !this.aborted;
  }

  /** Why the merge aborted (null when `ok`). Surfaced by the assembler. */
  get reason(): string | null {
    return this.abortReason;
  }

  /** Renders the deduped import block (empty string when there are no imports). */
  render(): string {
    if (this.aborted || this.bySource.size === 0) return '';
    const lines: string[] = [];
    const sources = [...this.bySource.keys()].sort();
    for (const src of sources) {
      const g = this.bySource.get(src)!;
      const parts: string[] = [];
      if (g.default) parts.push(`import ${g.default.local} from ${JSON.stringify(src)}`);
      if (g.namespace) parts.push(`import * as ${g.namespace.local} from ${JSON.stringify(src)}`);
      const named = [...g.named.values()].sort((a, b) => (a.imported! < b.imported! ? -1 : 1));
      if (named.length > 0) {
        const specs = named.map((sp) => (sp.imported === sp.local ? sp.local! : `${sp.imported} as ${sp.local}`)).join(', ');
        parts.push(`import { ${specs} } from ${JSON.stringify(src)}`);
      }
      lines.push(parts.join('\n'));
    }
    return lines.join('\n');
  }
}

/** Removes a set of offset ranges from a source string, high-to-low. */
function removeRanges(code: string, ranges: Array<[number, number]>): string {
  const sorted = [...ranges].sort((a, b) => b[0] - a[0]);
  let out = code;
  for (const [start, end] of sorted) {
    out = out.slice(0, start) + out.slice(end);
  }
  return out.trim();
}

/**
 * Historical cache replay: re-parse a cached entry's import-carrying codes
 * and re-fold them into the chunk accumulator. Used only on rare fold aborts
 * and old-style cache entries — the parse-free fast path is the norm.
 */
function fallbackReplay(cached: ClientBundleFileEntry, filePath: string, imports: ChunkImports): string {
  const comp = cached.compCode ? imports.add(cached.compCode, filePath).replace(/^\n+/, '').replace(/\n+$/, '') : '';
  const hyd = cached.hydCode ? imports.add(cached.hydCode, filePath).replace(/__components/g, '__hydrators').replace(/^\n+/, '').replace(/\n+$/, '') : '';
  return [comp, hyd].filter(Boolean).join('\n');
}

/**
 * Scopes one file's contribution to the shared chunk: module-level
 * import/export statements pass through untouched, all other top-level
 * statements (component registrations, top-level `const` helpers, …) are
 * wrapped in a block. Without this, same-named top-level bindings from
 * different `.vsk` files (e.g. two files declaring `const stages`) collide
 * in the concatenated chunk scope and the whole chunk fails to parse —
 * killing hydration for the entire page. Cross-file references always go
 * through the `__components` / `__hydrators` registries (never bare
 * identifiers), so hiding file locals in a block is safe; assignments like
 * `__components["X"] = …` still reach the outer binding.
 */
function scopeFileContribution(code: string): string {
  const head = extractCompiledNodes(code, isModuleLevel);
  const rest = removeCompiledNodes(code, isModuleLevel);
  if (!rest.trim()) return head;
  const scoped = (head ? head + '\n' : '') + '{\n' + rest + '\n}';
  // Never trade a potential duplicate-binding error for a certain syntax
  // error: if the scoped form does not parse, keep the original.
  try {
    parse(scoped);
    return scoped;
  } catch {
    return code;
  }
}

/**
 * Single-parse composition of `demoteExports(removeCompiledNodes(code,
 * isSnippetDrop))`: drop matches and demote surviving exports in ONE acorn
 * pass over the original offsets. The two operations never overlap (dropped
 * statements are imports/preamble/component-re-exports; demoted ones are
 * other export declarations), so composing their edits yields byte-identical
 * output — at roughly half the parse cost of the two-pass chain the HMR
 * hot path used to run on every edit.
 */
export function stripAndDemoteInOnePass(code: string): string {
  const ast = parseForStrip(code);
  if (!ast) return code;
  const body = ast.body ?? [];
  type Edit = { start: number; end: number; text?: string };
  const edits: Edit[] = [];
  for (const raw of body) {
    const node = raw as CompiledNode & { declaration?: CompiledNode & { start?: number; end?: number } };
    if (typeof node.start !== 'number' || typeof node.end !== 'number') continue;
    const isExport = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration';
    if (isSnippetDrop(node)) {
      let cut = node.end;
      if (code[cut] === ';') cut++;
      if (code.startsWith('\r\n', cut)) cut += 2;
      else if (code[cut] === '\n' || code[cut] === '\r') cut++;
      edits.push({ start: node.start, end: cut });
    } else if (isExport && node.type === 'ExportNamedDeclaration' && node.declaration
      && typeof node.declaration.start === 'number' && typeof node.declaration.end === 'number') {
      edits.push({ start: node.start, end: node.end, text: code.slice(node.declaration.start, node.declaration.end) });
    } else if (isExport) {
      let cut = node.end;
      if (code[cut] === ';') cut++;
      edits.push({ start: node.start, end: cut });
    }
  }
  if (edits.length === 0) return code;
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) {
    code = code.slice(0, e.start) + (e.text ?? '') + code.slice(e.end);
  }
  return code;
}

/**
 * Builds the eval-safe HMR update snippet for one compiled file: drops
 * imports, re-exports and the registry preamble (`const __components = …`,
 * `const __hydrators = …`), demotes remaining value exports, and wraps the
 * rest in a block. Component registrations (`__components["X"] = …`) still
 * reach the live registries and stay visible to nothing else, file
 * top-level bindings (`const navItems`, helpers, …) stay visible to the
 * component closures that reference them, and repeated evals of the same
 * file can no longer redeclare its top-level consts. Without the file
 * scope, an updated component renders against missing bindings and the
 * swap fails with a ReferenceError that surfaces nowhere the tests assert
 * (no reload, stale DOM, zero page errors).
 *
 * Single-parse strip+demote (see `stripAndDemoteInOnePass`) — this sits on
 * the dev-server's per-edit hot path, where the old two-pass chain cost a
 * second full acorn parse on every file save.
 */
export function buildHmrEvalSnippet(code: string): string {
  const body = stripAndDemoteInOnePass(code).trim();
  if (!body) return '';
  const scoped = `{\n${body}\n}`;
  // Never trade a potential duplicate-binding error for a certain syntax
  // error: if the scoped form does not parse, keep the unscoped body. The body
  // is generated JS, so plain acorn is the right tool (parseGeneratedJs) and
  // it must not go through the cache: this string is unique per call.
  return parseGeneratedJs(scoped) !== null ? scoped : body;
}

/**
 * Removes matched top-level statements from a compiled client module using the
 * parser's exact `start`/`end` offsets — never a text scan, so a doc sample
 * stored inside a template literal can never be mistaken for a real statement.
 * If the module cannot be parsed it is returned untouched (the compiler's own
 * output is always valid ESM, so that branch is unreachable in practice).
 */
/**
 * Parsed-AST cache for the strip passes over GENERATED code.
 *
 * Every compiled file goes through several `removeCompiledNodes` passes with
 * different predicates (`isVskImport`, `isRuntimeImport`, `isComponentExport`,
 * ...) and each one used to re-parse the same string with the full `.vsk`
 * pipeline. On a CPU profile of a 28-route build, parsing was ~70% of the
 * whole build and the generated-code strips were the bulk of it. The ASTs are
 * only read here (node.start/end plus the caller's predicate), so one parse can
 * serve every pass over the same string.
 *
 * Bounded: cleared wholesale past the cap, because a watch session keeps
 * calling this with new strings forever.
 */
const stripAstCache = new Map<string, { body?: unknown[] } | null>();
const STRIP_AST_CACHE_MAX = 512;

function parseForStrip(code: string): { body?: unknown[] } | null {
  const hit = stripAstCache.get(code);
  if (hit !== undefined) return hit;
  // Plain acorn for generated JS (see parseGeneratedJs); the `.vsk` pipeline
  // only for the rare module it cannot read.
  let ast = parseGeneratedJs(code) as { body?: unknown[] } | null;
  if (!ast) {
    try {
      ast = parse(code) as { body?: unknown[] };
    } catch {
      ast = null;
    }
  }
  if (stripAstCache.size >= STRIP_AST_CACHE_MAX) stripAstCache.clear();
  stripAstCache.set(code, ast);
  return ast;
}

export function removeCompiledNodes(code: string, isTarget: (node: CompiledNode) => boolean): string {
  const ast = parseForStrip(code);
  if (!ast) return code;
  const ranges: Array<[number, number]> = [];
  for (const raw of ast.body ?? []) {
    const node = raw as CompiledNode;
    if (isTarget(node) && typeof node.start === 'number' && typeof node.end === 'number') {
      ranges.push([node.start, node.end]);
    }
  }
  if (ranges.length === 0) return code;
  ranges.sort((a, b) => b[0] - a[0]);
  for (const [start, end] of ranges) {
    let cut = end;
    if (code[cut] === ';') cut++;
    if (code.startsWith('\r\n', cut)) cut += 2;
    else if (code[cut] === '\n' || code[cut] === '\r') cut++;
    code = code.slice(0, start) + code.slice(cut);
  }
  return code;
}

export async function generateClientBundle(
  routeTree: RouteNode[],
  appDir: string,
  componentMap?: Map<string, string>,
  options?: ClientBundleOptions,
): Promise<ClientBundleResult> {
  const runtimeDir = findRuntimeSrc(appDir);

  let seen = new Set<string>();
  const __stats = { chunks: 0, compiled: 0, distinct: new Set<string>(), parseMs: 0 };
  const chunks: ChunkEntry[] = [];
  const runtimeImportNames = new Set<string>();
  const cache = options?.cache;
  const only = options?.only && options.only.length > 0 ? new Set(options.only) : null;
  const returnEdited = !!options?.returnEditedSources && !!only;
  const editedSources = returnEdited ? new Map<string, string>() : undefined;
  const editedNames = returnEdited ? new Map<string, string | null>() : undefined;
  let cachedFileHits = 0;
  let compiledFiles = 0;
  let mainFromCache = false;

  function mustReuseWithoutStat(filePath: string): boolean {
    return !!only && !only.has(filePath);
  }

  /**
   * Collects the runtime names a module genuinely imports from `@vesk/runtime*`
   * (see `extractRuntimeImportNames`). Deliberately AST-only — import-shaped
   * text inside template literals (e.g. a doc sample `const md = \`import {
   * VeskResponse } from '@vesk/runtime/server'\``) must NOT force a client
   * tree-shake request for a server-only name.
   */
  function collectRuntimeImports(code: string): void {
    for (const name of extractRuntimeImportNames(code)) runtimeImportNames.add(name);
  }

  function stripRuntimeImport(code: string): string {
    return removeCompiledNodes(code, (node) => isRuntimeImport(node) || isRuntimePreamble(node));
  }

  function stripVskImports(code: string): string {
    return removeCompiledNodes(code, isVskImport);
  }

  function resolveVskImports(filePath: string, compile: (path: string, resolvedName: string | null) => void): string[] {
    const src = readFileSync(filePath, 'utf-8');
    const resolved: string[] = [];
    for (const importPath of collectVskImportPaths(vskImportLines(src), filePath)) {
      try {
        readFileSync(importPath);
      } catch {
        continue;
      }
      // resolvedName is intentionally null: compileFile derives the same
      // name from its own IR pass, and the alias branch is unreachable
      // when resolvedName matches — this avoids a second full parse of
      // every imported file.
      resolved.push(importPath);
      compile(importPath, null);
    }
    return resolved;
  }

  function stripExports(code: string): string {
    return removeCompiledNodes(code, isComponentExport);
  }

  function compileFile(filePath: string, resolvedName: string | null, output: string[], imports: ChunkImports): void {
    if (seen.has(filePath)) return;
    seen.add(filePath);

    // Cache-hit fast path: replay the entry's recorded contribution with no
    // file reads or parses. Deps recurse through the same path so each hit
    // costs one stat call (zero with `only`).
    const cachedEntry = cache?.files.get(filePath);
    // If one of this file's .md dependencies was the edited target, its
    // inlined content is stale by definition — force a recompile.
    let dependsOnEdited = false;
    if (cachedEntry && only && !only.has(filePath)) {
      for (const p of only) {
        if (cachedEntry.imports.includes(p)) { dependsOnEdited = true; break; }
      }
    }
    const cacheUsable = !!cachedEntry && !dependsOnEdited &&
      (mustReuseWithoutStat(filePath) || fileUnchanged(filePath, cachedEntry));
    const cached = cacheUsable ? cachedEntry : undefined;
    if (cached && cacheUsable) {
      cachedFileHits++;
      for (const dep of cached.imports) compileFile(dep, cache?.files.get(dep)?.actualName ?? '', output, imports);
      // Comp and hyd contributions of one file share its top-level bindings
      // (e.g. `const links` used by both the component and its hydrator),
      // so they must be scoped together in a single block. Cached codes keep
      // their imports; each side is folded separately because comp+hyd of one
      // file carry the same import twice (joint parse would abort the merge).
      // Mirror the fresh path exactly: strip, rename the hydrator registry,
      // trim — otherwise warm output drifts from cold output.
      let cachedFileCode = '';
      if (cached.compBody !== undefined) {
        // Parse-free warm replay: the body/scoped strings and the folded
        // import specifiers were computed once at fresh-compile time, so this
        // hit costs zero parses (the hot path paid ~5 acorn parses per cached
        // file per chunk before — ~4k parses per edit on the test app).
        let aborted = false;
        for (const s of cached.importSpecs ?? []) {
          if (!imports.foldSpec(s.source, s.kind, s.local, s.imported, filePath, cached.compCode)) { aborted = true; break; }
        }
        if (aborted) {
          // Rare fold conflict — fall back to the historical parse path so
          // the merge-abort semantics (and `ok` reporting) stay identical.
          cachedFileCode = fallbackReplay(cached, filePath, imports);
        } else if (cached.scoped) {
          output.push(cached.scoped);
        }
      } else {
        // Old-style entry (e.g. populated before the parse-free fields were
        // introduced): historical replay.
        cachedFileCode = fallbackReplay(cached, filePath, imports);
      }
      if (cachedFileCode.trim()) output.push(scopeFileContribution(cachedFileCode));
      for (const n of cached.runtimeNames) runtimeImportNames.add(n);
      if (cached.actualName && resolvedName !== null && cached.actualName !== resolvedName) {
        output.push(`Object.defineProperty(__components, ${JSON.stringify(resolvedName)}, { get: () => __components[${JSON.stringify(cached.actualName)}], configurable: true });`);
        output.push(`Object.defineProperty(__hydrators, ${JSON.stringify(resolvedName)}, { get: () => __hydrators[${JSON.stringify(cached.actualName)}], configurable: true });`);
      }
      return;
    }

    compiledFiles++;
    __stats.compiled++; __stats.distinct.add(filePath);
    let src = readFileSync(filePath, 'utf-8');
    if (/content=["'][^"']*\.md["']/i.test(src)) {
      src = inlineMdContentAttrs(src, dirname(filePath), guessProjectRoots(appDir));
    }
    const namesBefore = cache ? new Set(runtimeImportNames) : null;

    const importedPaths = resolveVskImports(filePath, (p, n) => compileFile(p, n, output, imports));

    // One parse/IR pass feeds both client modes AND the component-name
    // lookup — the dev hot path pays the acorn+TS parse once per edit
    // instead of three times.
    const __p0 = performance.now();
    const { comp: rawComp, hyd: rawHyd, name: actualName, aliases, reexportPaths, componentNames } = compileClientBoth(src, null, filePath);
    __stats.parseMs += performance.now() - __p0;
    for (const cn of componentNames || []) componentOwners.claim(cn, filePath);
    // Cache keeps the import-carrying codes so a warm build can re-fold them
    // into its own fresh accumulator; the emitted codes are import-stripped.
    // The bodies/specs/scoped artifacts are cached too so warm replay never
    // re-parses (see the `compBody !== undefined` fast path above).
    const compWithImports = rawComp ? stripExports(stripVskImports(stripRuntimeImport(rawComp))) : '';
    const hydWithImports = rawHyd ? stripExports(stripVskImports(stripRuntimeImport(rawHyd))) : '';
    const compSpecs: ClientBundleChunkSpec[] = [];
    const hydSpecs: ClientBundleChunkSpec[] = [];
    const compCode = compWithImports ? imports.add(compWithImports, filePath, compSpecs).replace(/^\n+/, '').replace(/\n+$/, '') : '';
    const hydCode = hydWithImports ? imports.add(hydWithImports, filePath, hydSpecs).replace(/__components/g, '__hydrators').replace(/^\n+/, '').replace(/\n+$/, '') : '';
    if (rawComp) collectRuntimeImports(rawComp);
    if (rawHyd) collectRuntimeImports(rawHyd);

    if (returnEdited && only!.has(filePath)) {
      // Eval-safe snippet for HMR fnSources (see buildHmrEvalSnippet):
      // full file scope so component closures keep their top-level
      // bindings, without imports/exports or the registry preamble, and
      // block-wrapped so repeated evals cannot redeclare them.
      editedSources!.set(filePath, rawComp ? buildHmrEvalSnippet(rawComp) : '');
      editedNames!.set(filePath, actualName);
    }

    // Comp and hyd contributions of one file share its top-level bindings,
    // so they are scoped together in a single block (see replay path above).
    const fileCode = [compCode, hydCode].filter(Boolean).join('\n');
    const scopedContribution = fileCode.trim() ? scopeFileContribution(fileCode) : '';
    if (scopedContribution) output.push(scopedContribution);
    if (actualName && resolvedName !== null && actualName !== resolvedName) {
      output.push(`Object.defineProperty(__components, ${JSON.stringify(resolvedName)}, { get: () => __components[${JSON.stringify(actualName)}], configurable: true });`);
      output.push(`Object.defineProperty(__hydrators, ${JSON.stringify(resolvedName)}, { get: () => __hydrators[${JSON.stringify(actualName)}], configurable: true });`);
    }
    // `.vsk` export/import aliases (`export { A as B }`, `import { A as B }`):
    // nothing is emitted for them, so register lazy getters that resolve to
    // the canonical name. Lazy because the target may be contributed later.
    for (const alias of aliases || []) {
      output.push(`Object.defineProperty(__components, ${JSON.stringify(alias.exported)}, { get: () => __components[${JSON.stringify(alias.local)}], configurable: true });`);
      output.push(`Object.defineProperty(__hydrators, ${JSON.stringify(alias.exported)}, { get: () => __hydrators[${JSON.stringify(alias.local)}], configurable: true });`);
    }
    // `export * from './x.vsk'` / `export { A } from './x.vsk'`: the target is
    // not reachable through an import statement, so compile it here.
    for (const reexportPath of reexportPaths || []) compileFile(reexportPath, null, output, imports);

    if (cache && namesBefore) {
      const st = statSync(filePath);
      cache.files.set(filePath, {
        mtimeMs: st.mtimeMs,
        size: st.size,
        compCode: compWithImports,
        hydCode: hydWithImports,
        actualName,
        runtimeNames: [...runtimeImportNames].filter((n) => !namesBefore.has(n)),
        imports: importedPaths,
        compBody: compCode,
        hydBody: hydCode,
        scoped: scopedContribution,
        importSpecs: [...compSpecs, ...hydSpecs],
      });
    }
  }

  function buildChunkName(node: RouteNode): string {
    const dir = relative(appDir, node.sourceDir || '');
    const parts = dir.split(sep).filter(Boolean);
    const slug = parts.length > 0 ? parts.join('-') : 'index';
    return slug.replace(/[\[\]]/g, '_');
  }

  const codeSplit = !!(options?.codeSplit);
  const transformPlugins = options?.plugins || [];

  // Every `.vsk` component in the bundle shares ONE registry keyed by declared
  // name, so two files declaring `component X` silently resolve to whichever
  // compiled last. Warn once per build — see vsk-collision.ts for why this is
  // a warning and not an error.
  const componentOwners = new VskComponentOwners();

  /** Run every active plugin's `onTransformJS` over an emitted bundle/chunk source. */
  async function applyTransformPlugins(code: string, filePath: string): Promise<string> {
    if (transformPlugins.length === 0) return code;
    let out = code;
    for (const plugin of transformPlugins) {
      if (typeof plugin.onTransformJS === 'function') {
        const result = await plugin.onTransformJS(out, filePath);
        if (typeof result === 'string') out = result;
      }
    }
    return out;
  }

  if (codeSplit) {
    const chunkEntries: Array<{ name: string; code: string; node: RouteNode; imports: boolean }> = [];

    function walkSplit(nodes: RouteNode[], _chain: RouteNode[]): void {
      for (const node of nodes) {
        // Each chunk must be self-contained: reset the compile dedupe so a
        // shared .vsk component (e.g. a site-wide Footer imported by the root
        // layout) is emitted into every chunk that references it. With a
        // single global `seen`, the first chunk to import a component owns it
        // and later chunks reference `__components["X"]` without registering
        // it — which breaks standalone layouts, whose match chain drops the
        // index chunk at runtime.
        seen = new Set<string>();
        const chunkCode: string[] = [];
        const chunkImports = new ChunkImports();
        const pagePath = resolve(appDir, node.sourceDir, 'page.vsk');
        if (node.page && existsSync(pagePath)) {
          compileFile(pagePath, node.page, chunkCode, chunkImports);
        }
        const layoutPath = resolve(appDir, node.sourceDir, 'layout.vsk');
        if (node.layout && existsSync(layoutPath)) {
          compileFile(layoutPath, node.layout, chunkCode, chunkImports);
        }
        const errorPath = resolve(appDir, node.sourceDir, 'error.vsk');
        if (node.error && existsSync(errorPath)) {
          compileFile(errorPath, node.error, chunkCode, chunkImports);
        }
        const notFoundPath = resolve(appDir, node.sourceDir, 'not-found.vsk');
        if (node.notFound && existsSync(notFoundPath)) {
          compileFile(notFoundPath, node.notFound, chunkCode, chunkImports);
        }
        const offlinePath = resolve(appDir, node.sourceDir, 'offline.vsk');
        if (node.offline && existsSync(offlinePath)) {
          compileFile(offlinePath, node.offline, chunkCode, chunkImports);
        }
        const networkPath = resolve(appDir, node.sourceDir, 'network.vsk');
        if (node.network && existsSync(networkPath)) {
          compileFile(networkPath, node.network, chunkCode, chunkImports);
        }
        const loadingPath = resolve(appDir, node.sourceDir, 'loading.vsk');
        if (node.loading && existsSync(loadingPath)) {
          compileFile(loadingPath, node.loading, chunkCode, chunkImports);
        }
        if (chunkCode.length > 0) {
          const chunkName = `page-${buildChunkName(node)}.js`;
          // Prepend this chunk's deduped imports (one statement per source, no
          // duplicate bindings) so the classic script exposes the bare
          // identifiers its file bodies reference, and esbuild can parse and
          // inline them.
          if (!chunkImports.ok) console.error('[vesk] chunk import merge aborted for', chunkName + ':', chunkImports.reason);
          const head = chunkImports.render();
          const code = (head ? head + '\n\n' : '') + chunkCode.join('\n\n');
          chunkEntries.push({ name: chunkName, code, node, imports: chunkHasImports(head.length, !chunkImports.ok) });
        }
        walkSplit(node.children || [], [..._chain, node]);
      }
    }
    walkSplit(routeTree, []);

    const sharedCode: string[] = [];
    const sharedImports = new ChunkImports();
    const compMap = componentMap || new Map();
    seen = new Set<string>();
    for (const [compName, compPath] of compMap) {
      compileFile(compPath, compName, sharedCode, sharedImports);
    }
    if (sharedCode.length > 0) {
      if (!sharedImports.ok) console.error('[vesk] chunk import merge aborted for shared.js:', sharedImports.reason);
      const head = sharedImports.render();
      const code = (head ? head + '\n\n' : '') + sharedCode.join('\n\n');
      chunkEntries.push({ name: 'shared.js', code, node: null as unknown as RouteNode, imports: chunkHasImports(head.length, !sharedImports.ok) });
    }

    const chunkIIFE = (body: string): string =>
      `(()=>{\nconst __components = globalThis.__components || (globalThis.__components = {});\nconst __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});\n${body}\n})();\n`;

    for (const entry of chunkEntries) {
      if (!entry.code.trim()) continue;
      let finalCode: string;
      if (entry.imports) {
        // Bundle the chunk through esbuild so every remaining import (npm
        // packages like lucide-vesk and rewritten relative `.ts` value
        // modules) is inlined into the IIFE — a classic script cannot carry
        // a live `import`, and a stripped binding referenced by a component
        // would otherwise throw `X is not defined` at hydration. Imports were
        // already deduped per file by `ChunkImports`, so esbuild can parse the
        // bundle entry.
        const tmpBase = mkdtempSync(join(resolve(appDir, '..'), 'tmp-vesk-chunk-'));
        const tmpFile = join(tmpBase, 'entry.js');
        const toBundle = `const __components = globalThis.__components || (globalThis.__components = {});\nconst __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});\n${entry.code}\n`;
        writeFileSync(tmpFile, toBundle);
        try {
          // Pass the app tsconfig so esbuild resolves tsconfig `paths` aliases
          // (`@/x`, `@app/x`) inside transitively bundled modules too.
          const appTsconfig = findTsconfigPath(appDir);
          const result = await build({
            entryPoints: [tmpFile],
            bundle: true,
            format: 'iife',
            platform: 'browser',
            write: false,
            logLevel: 'silent',
            loader: { '.js': 'tsx' },
            ...(appTsconfig ? { tsconfig: appTsconfig } : {}),
          });
          finalCode = result.outputFiles[0].text;
        } catch (e) {
          const err = e as { errors?: Array<{ text: string }>; message?: string };
          console.error('[vesk] chunk bundle failed', entry.name, err?.errors?.map((x) => x.text).join(' | ') || err?.message || String(e));
          // Fall back to the historical behavior: strip every import so the
          // classic script at least parses. Bindings imported from native-only
          // `@vesk/*` libraries get throwing stubs (a readable degradation
          // instead of a baffling `X is not defined`); every other stripped
          // name stays dangling, which is the pre-existing failure mode.
          const stripped = demoteExports(removeCompiledNodes(entry.code, isAnyImport));
          finalCode = chunkIIFE(nativeLibraryImportStubs(entry.code) + stripped);
        } finally {
          try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
        }
      } else {
        // No-import chunk: wrap the compiled source in the registry IIFE. The
        // compiler still emits module-level `export const pageProps` / re-export
        // lists, and a classic script cannot carry an `export` — demote value
        // exports to bindings and drop bare re-export lists (components resolve
        // via the __components / __hydrators registries, matching the mono path).
        finalCode = chunkIIFE(demoteExports(entry.code));
      }
      chunks.push({ name: entry.name, code: finalCode });
    }

    function annotate(nodes: RouteNode[]): void {
      for (const node of nodes) {
        const chunkName = `page-${buildChunkName(node)}.js`;
        const hasEntry = chunkEntries.some(e => e.name === chunkName && e.code.trim());
        if (hasEntry) node.chunk = `/_vesk/static/${chunkName}`;
        annotate(node.children || []);
      }
    }
    annotate(routeTree);

    const mainKey = JSON.stringify(routeTree) + '|' + [...runtimeImportNames].sort().join(',') + `|${!!options?.hmr}|${!!options?.importRuntime}|${options?.routeDataCache ?? ''}`;
    let main: string;
    if (cache?.mainBundle && cache.mainBundle.key === mainKey) {
      mainFromCache = true;
      main = cache.mainBundle.code;
    } else {
      main = await buildMainBundle(routeTree, runtimeDir, true, {}, !!options?.hmr, !!options?.importRuntime, runtimeImportNames, options?.routeDataCache);
      if (cache) cache.mainBundle = { key: mainKey, code: main };
    }
    const transformedChunks: ChunkEntry[] = [];
    for (const chunk of chunks) {
      transformedChunks.push({ ...chunk, code: await applyTransformPlugins(chunk.code, chunk.name) });
    }
    componentOwners.report('client bundle');
    if (process.env.VESK_BUILD_PROFILE) console.error(`  [client] chunks=${chunks.length} compiled=${__stats.compiled} distinct=${__stats.distinct.size} parseMs=${__stats.parseMs.toFixed(0)}`);
    return { main: await applyTransformPlugins(main, 'client.js'), chunks: transformedChunks, cachedFileHits, compiledFiles, mainFromCache, editedSources, editedNames };
  } else {
    let componentLines: string[] = [];
    let hydratorLines: string[] = [];
    let aliasLines: string[] = [];
    let hydratorAliasLines: string[] = [];

    function compileFileMono(filePath: string, resolvedName: string): void {
      if (seen.has(filePath)) return;
      seen.add(filePath);
      const src = readFileSync(filePath, 'utf-8');

      resolveVskImports(filePath, (p, n) => compileFileMono(p, n || ''));

      for (const cn of vskComponentNames(src, filePath)) componentOwners.claim(cn, filePath);

      // Share one name allocator so the comp and hyd contributions (which are
      // joined into a single scoped block below) never reuse `$n` names.
      const monoAlloc = nameAllocFor(filePath);
      const compCode = compileClient(src, null, { forceClient: true, sourcePath: filePath, nameAllocator: monoAlloc });
      const hydCode = compileClient(src, null, { hydrate: true, forceClient: true, includeTopLevel: false, sourcePath: filePath, nameAllocator: monoAlloc });
      if (compCode) collectRuntimeImports(compCode);
      if (hydCode) collectRuntimeImports(hydCode);
      // Comp and hyd share the file's top-level bindings — scope together.
      const strippedComp = compCode ? stripExports(stripVskImports(stripRuntimeImport(compCode))).replace(/^\n+/, '').replace(/\n+$/, '') : '';
      const strippedHyd = hydCode ? stripExports(stripVskImports(stripRuntimeImport(hydCode))).replace(/__components/g, '__hydrators').replace(/^\n+/, '').replace(/\n+$/, '') : '';
      const fileCode = [strippedComp, strippedHyd].filter(Boolean).join('\n');
      if (fileCode.trim()) componentLines.push(scopeFileContribution(fileCode));

      const actualName = resolveComponentName(src);
      if (actualName && actualName !== resolvedName) {
        aliasLines.push(`Object.defineProperty(__components, ${JSON.stringify(resolvedName)}, { get: () => __components[${JSON.stringify(actualName)}], configurable: true });`);
        hydratorAliasLines.push(`Object.defineProperty(__hydrators, ${JSON.stringify(resolvedName)}, { get: () => __hydrators[${JSON.stringify(actualName)}], configurable: true });`);
      }
    }

    function walkMono(nodes: RouteNode[]): void {
      for (const node of nodes) {
        const pagePath = resolve(appDir, node.sourceDir, 'page.vsk');
        if (node.page && existsSync(pagePath)) compileFileMono(pagePath, node.page);
        const layoutPath = resolve(appDir, node.sourceDir, 'layout.vsk');
        if (node.layout && existsSync(layoutPath)) compileFileMono(layoutPath, node.layout);
        const errorPath = resolve(appDir, node.sourceDir, 'error.vsk');
        if (node.error && existsSync(errorPath)) compileFileMono(errorPath, node.error);
        const notFoundPath = resolve(appDir, node.sourceDir, 'not-found.vsk');
        if (node.notFound && existsSync(notFoundPath)) compileFileMono(notFoundPath, node.notFound);
        const offlinePath = resolve(appDir, node.sourceDir, 'offline.vsk');
        if (node.offline && existsSync(offlinePath)) compileFileMono(offlinePath, node.offline);
        const networkPath = resolve(appDir, node.sourceDir, 'network.vsk');
        if (node.network && existsSync(networkPath)) compileFileMono(networkPath, node.network);
        const loadingPath = resolve(appDir, node.sourceDir, 'loading.vsk');
        if (node.loading && existsSync(loadingPath)) compileFileMono(loadingPath, node.loading);
        walkMono(node.children || []);
      }
    }
    walkMono(routeTree);

    const compMap = componentMap || new Map();
    for (const [compName, compPath] of compMap) {
      compileFileMono(compPath, compName);
    }

    const main = await buildMainBundle(routeTree, runtimeDir, false, {
      componentLines, hydratorLines, aliasLines, hydratorAliasLines,
    }, !!options?.hmr, !!options?.importRuntime, runtimeImportNames, options?.routeDataCache);
    // Mono (non-codeSplit) builds are the production path — no incremental cache.
    componentOwners.report('client bundle');
    return { main: await applyTransformPlugins(main, 'client.js'), chunks: [] };
  }
}

function stripTypes(code: string): string {
  return stripCodeTypes(code);
}

export function buildRuntimeCode(runtimeDir: string): string {
  const runtimeFiles = [
    'ripple-constants.js', 'ripple-utils.js', 'ripple-runtime.js', 'ripple-blocks.js',
    'context.js', 'hydrate.js', 'resource.js',
    'reconcile.js', 'bindings.js', 'router-match.js', 'router-components.js', 'router.js',
    'portal.js',
    'seo.js', 'image.js', 'experiment.js', 'form.js', 'action.js',
  ];
  let code = '';
  for (const f of runtimeFiles) {
    const p = join(runtimeDir, f);
    if (existsSync(p)) {
      let src = readFileSync(p, 'utf-8');
      src = stripTypes(src);
      src = src.replace(/^import\s+[\s\S]*?from\s+['"](?:\.\/.*?|@vesk\/runtime\/src\/.*?)['"];?\n?/gm, '');
      src = src.replace(/^import\s+['"](?:\.\/.*?|@vesk\/runtime\/src\/.*?)['"];?\n?/gm, '');
      src = src.replace(/^export\s*\{\s*[\s\S]*?\}\s*from\s+['"][^'"]+['"];?\n?/gm, '');
      src = src.replace(/^export\s*\{\s*[\s\S]*?\};?\n?/gm, '');
      src = src.replace(/^export\s+/gm, '');
      code += `// --- ${f} ---\n${src}\n`;
    }
  }
  const indexSrc = readFileSync(join(runtimeDir, 'index-client.js'), 'utf-8');
  const exportNames: string[] = stripTypes(indexSrc).match(/export\s*\{\s*([^}]+)\s*\}\s*from/g)
    ?.flatMap(m => m.replace(/export\s*\{\s*|\s*\}\s*from/g, '').split(',').map(s => s.trim())) || [];

  code += '// --- exports ---\n';
  for (const name of [...new Set(exportNames)]) {
    if (name) code += `export { ${name} };\n`;
  }
  return code;
}

/**
 * Names the client runtime actually exports, so the tree-shaken bundle only
 * emits the modules reachable from the used set.
 */
export function runtimeExportNames(runtimeDir: string): Set<string> {
  const indexSrc = readFileSync(join(runtimeDir, 'index-client.js'), 'utf-8');
  const names = new Set<string>();
  for (const m of indexSrc.matchAll(/export\s*\{([^}]+)\}\s*from/g)) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim().split(/\s+as\s+/).pop()!.trim();
      if (n) names.add(n);
    }
  }
  return names;
}

let runtimeEntryId = 0;

/**
 * Fixed entry filename for the runtime tree-shake. A stable entry path keeps
 * esbuild's banner comment constant, so the output is deterministic across
 * builds (a per-call unique filename would embed a new path into the bundle
 * every time).
 */
const RUNTIME_ENTRY = '.runtime-tree-entry.mjs';

/**
 * esbuild resolves entry points and absolute import specifiers with forward
 * slashes; a native Windows path (`C:\...`) is not resolvable.
 */
function esbuildPath(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

/**
 * The tree-shake entry is written outside the project tree on purpose. It used
 * to be written into `node_modules/@vesk/runtime/dist`, which (a) tripped the
 * dev watcher on every build — an endless rebuild loop on Windows, where
 * `fs.watch` reports backslash paths that slipped past the `node_modules/`
 * skip check — and (b) raced concurrent builds, so one build could delete the
 * entry while another was still resolving it (`Could not resolve …`). The
 * entry now lives in a temp dir and imports the runtime by absolute path.
 */
function runtimeTreeShakeEntry(): string {
  return join(tmpdir(), 'vesk-runtime-tree-shake', RUNTIME_ENTRY);
}

/** Serializes tree-shake builds so concurrent callers never share the entry file. */
let treeShakeQueue: Promise<unknown> = Promise.resolve();

/**
 * Builds a single self-contained runtime module for the given used names.
 *
 * The runtime's real module graph is bundled by esbuild into one IIFE whose
 * scope is fully closed, so its internal identifiers can never collide with
 * page code. Only the exact names the app uses are re-exported as module-scope
 * const bindings. This replaces the old regex-based file concatenation, which
 * leaked runtime module-scope names into the page scope.
 */
export function buildTreeShakenRuntime(runtimeDir: string, usedNames: string[]): Promise<string> {
  const run = treeShakeQueue.then(() => buildTreeShakenRuntimeNow(runtimeDir, usedNames));
  treeShakeQueue = run.catch(() => undefined);
  return run;
}

async function buildTreeShakenRuntimeNow(runtimeDir: string, usedNames: string[]): Promise<string> {
  const unique = [...new Set(usedNames)];
  const available = runtimeExportNames(runtimeDir);
  const missing = unique.filter((n) => !available.has(n));
  if (missing.length > 0) {
    console.error(`vesk: runtime names not exported — ${missing.join(', ')}; falling back to full runtime`);
    return buildRuntimeCode(runtimeDir);
  }
  const entry = runtimeTreeShakeEntry();
  const indexClient = esbuildPath(join(runtimeDir, 'index-client.js'));
  try {
    try { mkdirSync(dirname(entry), { recursive: true }); } catch { /* exists */ }
    try { rmSync(entry); } catch { /* not present yet */ }
    writeFileSync(entry, `export { ${unique.join(', ')} } from ${JSON.stringify(indexClient)};\n`);
    const result = await build({
      entryPoints: [esbuildPath(entry)],
      bundle: true,
      format: 'iife',
      globalName: '__veskRuntime',
      platform: 'browser',
      target: ['es2022'],
      treeShaking: true,
      // Do not let esbuild rename identifiers here. This bundle is one large
      // IIFE built from many runtime modules, and the renaming pass of some
      // esbuild versions (observed on 0.25.12) emits a free reference to an
      // undefined minified name (ReferenceError: m is not defined) that kills
      // client hydration for the whole app. Whitespace-only output keeps the
      // runtime deterministic at a modest size cost; tree-shaking still prunes
      // unreachable modules, so names coming out of the IIFE are untouched.
      minify: false,
      write: false,
      logLevel: 'silent',
    });
    const bundle = result.outputFiles[0].text;
    return `${bundle}\nconst { ${unique.join(', ')} } = __veskRuntime;\nexport { ${unique.join(', ')} };\n`;
  } catch (e) {
    console.error('vesk: runtime tree-shake failed, falling back to full runtime:', (e as Error).message);
    return buildRuntimeCode(runtimeDir);
  } finally {
    try { unlinkSync(entry); } catch { /* ignore */ }
  }
}

/**
 * Appends the HMR eval hook to the dev client bundle.
 *
 * The gadget is gated by a per-server-session nonce: the dev server generates
 * `globalThis.__vesk_hmr_nonce` at boot and broadcasts it inside every
 * `update` message. The browser evaluates component sources only when the
 * message nonce matches, so a cross-site WebSocket (or any other injection
 * vector) cannot drive arbitrary eval without also reading the nonce from a
 * same-origin page — which the WS origin check already blocks.
 */
function appendHmrGlobals(code: string): string {
  return code +
    "globalThis.__vesk_hmr_eval = (code, n) => {\n" +
    "  if (!n || n !== globalThis.__vesk_hmr_nonce) throw new Error('vesk hmr: invalid nonce');\n" +
    "  return eval(code);\n" +
    "};\n";
}

async function buildMainBundle(
  routeTree: RouteNode[],
  runtimeDir: string,
  codeSplit: boolean,
  mono?: Partial<MonolithicBundleParts>,
  hmr?: boolean,
  importRuntime?: boolean,
  runtimeImportNames?: Set<string>,
  routeDataCache?: number,
): Promise<string> {
  const baseRuntimeImports = ['createFileRouter', 'get', 'set', 'effect', 'track', 'destroy_block', 'getActiveComponent', 'setActiveComponent', 'NavLink', 'Link', 'reactiveProps', 'matchRoute', 'ensureChunk', 'toDomNode', 'rerenderNode'];
  const allRuntimeImports = runtimeImportNames && runtimeImportNames.size > 0
    ? [...new Set([...baseRuntimeImports, ...runtimeImportNames])]
    : baseRuntimeImports;

  const runtimeGlobals = [
    'reconcile', 'createHydrateWalker', 'needsHydration', 'hydrate',
    'hydrateViewport', 'hydrateIdle', 'hydrateOnInteraction', 'collectVskMarkers',
    'matchRoute', 'ensureChunk',
  ];
  const usedRuntimeNames = [...new Set([...baseRuntimeImports, ...allRuntimeImports, ...runtimeGlobals])];
  const runtimeCode = importRuntime ? '' : await buildTreeShakenRuntime(runtimeDir, usedRuntimeNames);

  const preamble = importRuntime
    ? `import { ${allRuntimeImports.join(', ')} } from '/_vesk/runtime.js';\n\n`
    : runtimeCode + '\n';

  const cleanupFn = 'function __cleanup(start, end) {\n\tlet n = start.nextSibling;\n\twhile (n && n !== end) {\n\t\tconst next = n.nextSibling;\n\t\tn.remove();\n\t\tn = next;\n\t}\n}\n';

  const placeFn = 'function __place(start, end, nodes, fallback) {\n' +
    '\tif (start.parentNode !== null) {\n' +
    '\t\tconst p = start.parentNode;\n' +
    '\t\tfor (let i = 0; i < nodes.length; i++) p.insertBefore(nodes[i], end);\n' +
    '\t\treturn;\n' +
    '\t}\n' +
    '\tif (nodes.length > 0 && nodes[0].parentNode) {\n' +
    '\t\tconst p = nodes[0].parentNode;\n' +
    '\t\tp.insertBefore(start, nodes[0]);\n' +
    '\t\tp.insertBefore(end, nodes[nodes.length - 1].nextSibling);\n' +
    '\t\t// Client-surplus nodes (SSR rendered fewer items than the client data)\n' +
    '\t\t// are freshly claimed and still detached — move them into the region in\n' +
    '\t\t// client order before `end`, instead of stranding them off-parent.\n' +
    '\t\tfor (let i = 0; i < nodes.length; i++) {\n' +
    '\t\t\tif (nodes[i].parentNode === null) p.insertBefore(nodes[i], end);\n' +
    '\t\t}\n' +
    '\t\treturn;\n' +
    '\t}\n' +
    '\tfallback.appendChild(start);\n' +
    '\tfallback.appendChild(end);\n' +
    '\tfor (let i = 0; i < nodes.length; i++) fallback.insertBefore(nodes[i], end);\n' +
    '}\n';

  const updateComponentsFn = 'function __updateComponents(nodes) {\n' +
    '  for (const n of nodes) {\n' +
    "    if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName];\n" +
    "    if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName];\n" +
    "    if (n._errorName && __components[n._errorName]) n.error = __components[n._errorName];\n" +
    "    if (n._notFoundName && __components[n._notFoundName]) n.notFound = __components[n._notFoundName];\n" +
    "    if (n._offlineName && __components[n._offlineName]) n.offline = __components[n._offlineName];\n" +
    "    if (n._networkName && __components[n._networkName]) n.network = __components[n._networkName];\n" +
    '    if (n.children) __updateComponents(n.children);\n' +
    '  }\n' +
    '}\n';

  const routeTreeJson = JSON.stringify(routeTree);

  if (codeSplit) {
    const resolveNamesFn = 'function __resolveNames(nodes) {\n' +
      '  for (const n of nodes) {\n' +
      "    if (n.chunk) n._chunk = n.chunk;\n" +
      "    if (n.chunkError) n._chunkError = n.chunkError;\n" +
      "    if (typeof n.page === 'string') n._pageName = n.page;\n" +
      "    if (typeof n.layout === 'string') n._layoutName = n.layout;\n" +
      "    if (typeof n.error === 'string') n._errorName = n.error;\n" +
      "    if (typeof n.notFound === 'string') n._notFoundName = n.notFound;\n" +
      "    if (typeof n.offline === 'string') n._offlineName = n.offline;\n" +
      "    if (typeof n.network === 'string') n._networkName = n.network;\n" +
      '    if (n.children) __resolveNames(n.children);\n' +
      '  }\n' +
      '}\n';

    const pendCode =
      'const __pendChunks = [];\n' +
      "const __currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';\n" +
      "if (typeof matchRoute === 'function') {\n" +
      '  const __currentMatch = matchRoute(__routeTree, __currentPath);\n' +
      '  if (__currentMatch) {\n' +
      '    for (const n of __currentMatch.matchChain) {\n' +
      "      if (n._chunk && !__pendChunks.includes(n._chunk)) __pendChunks.push(n._chunk);\n" +
      '    }\n' +
      '  }\n' +
      '}\n';

    const routerOpts = buildRouterOpts({ routeDataCache });

    const startRouterCode =
      'const __startRouter = function() {\n' +
      '  __updateComponents(__routeTree);\n' +
      `  const __router = createFileRouter(__routeTree${routerOpts});\n` +
      '  __router.__hydrators = __hydrators;\n' +
      '  __router.__updateComponents = __updateComponents;\n' +
      '  globalThis.__vesk_router = __router;\n' +
      "  if (typeof document !== 'undefined') __router.start();\n" +
      '};\n' +
      "if (__pendChunks.length > 0 && typeof ensureChunk === 'function') {\n" +
      "  Promise.all(__pendChunks.map(u => ensureChunk(u).catch(() => undefined))).then(__startRouter);\n" +
      '} else {\n' +
      '  __startRouter();\n' +
      '}\n';

    // Chunks execute as classic scripts, so the bootstrap's chunk loader
    // and route matcher must exist on globalThis before any chunk loads.
    // Runtime names are only emitted when a chunk's compiled code imports
    // them — otherwise an app without (say) keyed maps would reference an
    // unimported `reconcile` and kill the whole module.
    const globalNames = [
      'reactiveProps', 'getActiveComponent', 'setActiveComponent', 'track',
      'set', 'get', 'effect', 'destroy_block', 'reconcile', 'NavLink', 'Link',
      'createHydrateWalker', 'needsHydration', 'hydrate', 'hydrateViewport',
      'hydrateIdle', 'hydrateOnInteraction', 'collectVskMarkers',
      'matchRoute', 'ensureChunk',
    ];
    const importedSet = new Set(allRuntimeImports);
    const runtimeGlobals =
      globalNames
        .filter(n => importedSet.has(n))
        .map(n => `globalThis.${n} = ${n};\n`)
        .join('') +
      'globalThis.__runtime_comps = __runtime_comps;\n' +
      'globalThis.__cleanup = __cleanup;\n' +
      'globalThis.__place = __place;\n\n';

    const extraGlobals = [...(runtimeImportNames || [])]
      .filter(n => n && n !== 'default')
      .map(n => `globalThis.${n} = ${n};\n`)
      .join('');

    const code = preamble +
      'const __components = globalThis.__components || (globalThis.__components = {});\n' +
      'const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});\n' +
      'const __runtime_comps = __components;\n\n' +
      runtimeGlobals + extraGlobals +
      cleanupFn +
      placeFn +
      'globalThis.__components = __components;\n' +
      resolveNamesFn +
      updateComponentsFn +
      'const __routeTree = ' + routeTreeJson + ';\n' +
      '__resolveNames(__routeTree);\n' +
      pendCode +
      startRouterCode;
    return hmr ? appendHmrGlobals(code) : code;
  }

  const componentLines = mono?.componentLines || [];
  const hydratorLines = mono?.hydratorLines || [];
  const aliasLines = mono?.aliasLines || [];
  const hydratorAliasLines = mono?.hydratorAliasLines || [];

  const aliasCode = aliasLines.length > 0 ? aliasLines.join('\n') + '\n' : '';
  const hydratorAliasCode = hydratorAliasLines.length > 0 ? hydratorAliasLines.join('\n') + '\n' : '';

  const routerOpts = buildRouterOpts({ routeDataCache });

  const code = preamble +
    'const __components = {};\n' +
    'const __hydrators = {};\n' +
    'const __runtime_comps = __components;\n\n' +
    componentLines.join('\n\n') + '\n' +
    aliasCode +
    hydratorLines.join('\n\n') + '\n' +
    hydratorAliasCode +
    cleanupFn +
    placeFn +
    'globalThis.__components = __components;\n' +
    'globalThis.__runtime_comps = __runtime_comps;\n' +
    'globalThis.__cleanup = __cleanup;\n' +
    'globalThis.__place = __place;\n' +
    allRuntimeImports.map(n => `globalThis.${n} = ${n};\n`).join('') +
    'function __resolveNames(nodes) {\n' +
    '  for (const n of nodes) {\n' +
    "    if (typeof n.page === 'string') {\n" +
    '      n._pageName = n.page;\n' +
    '      n.page = __components[n.page];\n' +
    '    }\n' +
    "    if (typeof n.layout === 'string') {\n" +
    '      n._layoutName = n.layout;\n' +
    '      n.layout = __components[n.layout];\n' +
    '    }\n' +
    "    if (typeof n.error === 'string') n.error = __components[n.error];\n" +
    "    if (typeof n.notFound === 'string') n.notFound = __components[n.notFound];\n" +
    "    if (typeof n.offline === 'string') n.offline = __components[n.offline];\n" +
    "    if (typeof n.network === 'string') n.network = __components[n.network];\n" +
    '    if (n.children) __resolveNames(n.children);\n' +
    '  }\n' +
    '}\n' +
    updateComponentsFn +
    'const __routeTree = ' + routeTreeJson + ';\n' +
    '__resolveNames(__routeTree);\n' +
    `const __router = createFileRouter(__routeTree${routerOpts});\n` +
    'globalThis.__vesk_router = __router;\n' +
    '__router.__hydrators = __hydrators;\n' +
    '__router.__updateComponents = __updateComponents;\n' +
    "if (typeof document !== 'undefined') __router.start();\n";
  return hmr ? appendHmrGlobals(code) : code;
}
