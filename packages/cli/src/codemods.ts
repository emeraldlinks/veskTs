/**
 * Codemods: mechanical, AST-based migrations for `.vsk` and config files.
 *
 * Breaking changes in a framework are only fair if the framework can fix your
 * code for you. Everything here is AST work through the compiler's own parser
 * — no regex over source text (the one rule this repo does not bend), and no
 * reformatting: a codemod edits offsets in place, so untouched lines keep their
 * original bytes and the diff shows only the migration.
 *
 * A codemod declares the version range it upgrades FROM and TO, so `vesk
 * migrate` can pick exactly the set that applies to the version in the
 * project's lockfile, and re-running it is a no-op.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Program } from 'estree';
import { parse } from '@vesk/compiler/src/parser';
import { walk } from 'zimmerframe';

export interface CodemodFileContext {
  /** Absolute path of the file being migrated. */
  filePath: string;
  /** Project-relative path, for messages. */
  displayPath: string;
  /** Project root, so a codemod can read the project's own node_modules. */
  projectDir?: string;
}

export interface CodemodResult {
  /** `null` when nothing changed. */
  code: string | null;
  /** Human-readable list of what changed, for the report. */
  notes: string[];
}

export interface Codemod {
  /** Stable id, also the flag name: `vesk migrate --<id>`. */
  id: string;
  /** Inclusive lower bound of the range this codemod upgrades FROM. */
  from: string;
  /** The version this codemod produces; also the project version above which it
   *  no longer applies (a project already at `to` needs no rewrite). */
  to: string;
  /** One line for `--list` and the migration guide. */
  describe: string;
  /** Which files to run against. */
  appliesTo: (filePath: string) => boolean;
  /** Transform the source. Must not throw on unrelated input. */
  run: (source: string, ctx: CodemodFileContext) => CodemodResult;
}

/** Parse, or report why we cannot. Codemods skip a file they cannot read. */
function safeParse(source: string, filePath: string): Program | null {
  try {
    return parse(source, { filename: filePath.endsWith('.vsk') ? filePath : 'migrate.ts' });
  } catch {
    return null;
  }
}

/** Apply text edits to the source by offset, last-first so offsets stay valid. */
function applyEdits(source: string, edits: Array<{ start: number; end: number; text: string }>): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function isVskFile(filePath: string): boolean {
  return filePath.endsWith('.vsk');
}

function isConfigFile(filePath: string): boolean {
  return /(^|[/\\])(vesk\.config\.(ts|js|mjs)|package\.json)$/.test(filePath);
}

/**
 * `track-destructuring` — `const [c, setC] = track(0)` -> `const &[c, setC] = …`.
 *
 * A real correctness migration, not cosmetics. The array form PARSES: it lands
 * in the IR as a plain `RuntimeStatement`, so no `TrackDecl` is created, the
 * destructured names are not cells, and `<b>{c}</b>` is compiled as a
 * one-time read. The page renders, the button calls `setC`, and nothing ever
 * updates — the worst failure shape, because nothing errors. The documented
 * form is `const &[c, setC] = track(0)` (AGENTS.md), which does create the
 * TrackDecl.
 */
const trackDestructuring: Codemod = {
  id: 'track-destructuring',
  from: '0.0.0',
  to: '0.2.48',
  describe: 'const [a, b] = track(x) -> const &[a, b] = track(x) (the array form is NOT reactive)',
  appliesTo: isVskFile,
  run(source, ctx) {
    const ast = safeParse(source, ctx.filePath);
    if (!ast) return { code: null, notes: [] };
    const notes: string[] = [];
    const edits: Array<{ start: number; end: number; text: string }> = [];

    walk(ast, null, {
      VariableDeclaration(node: any) {
        for (const decl of node.declarations || []) {
          // Only the array form; an identifier (`const c = track(0)`) is a
          // different, valid thing.
          if (decl.id?.type !== 'ArrayPattern') continue;
          const init = decl.init;
          if (init?.type !== 'CallExpression') continue;
          const callee = init.callee?.name;
          if (callee !== 'track' && callee !== 'derived' && callee !== 'computed') continue;
          // `const`/`let` -> `const &` / `let &`: the `&` goes after the keyword.
          // Already the documented form (`const &[a] = track(0)`)? The parser
          // reports an ArrayPattern either way, so the `&` has to be looked for
          // in the source between the keyword and the pattern — otherwise
          // re-running migrate would produce `const &&[a]`.
          const keywordEnd = source.lastIndexOf(node.kind, decl.id.start);
          if (keywordEnd === -1) continue;
          if (source.slice(keywordEnd + node.kind.length, decl.id.start).includes('&')) continue;
          // Insert at the pattern, not after the keyword: the original spacing
          // is then untouched and the result is the documented `const &[a]`.
          edits.push({ start: decl.id.start, end: decl.id.start, text: '&' });
          notes.push(`${ctx.displayPath}: ${node.kind} [..] = ${callee}(...) -> ${node.kind} &[..] (was not reactive)`);
        }
      },
    } as any);

    if (edits.length === 0) return { code: null, notes };
    return { code: applyEdits(source, edits), notes };
  },
};

/**
 * The names `@vesk/types` actually exports, read from the INSTALLED package
 * (falling back to this repo's copy when running inside it). A codemod that
 * rewrote an import to a package that does not export the name would break the
 * build — the one thing a migration must never do.
 */
function typesPackageExports(projectDir: string | undefined): Set<string> | null {
  const candidates = [
    projectDir ? join(projectDir, 'node_modules', '@vesk', 'types', 'dist', 'index.d.ts') : null,
    new URL('../../types/dist/index.d.ts', import.meta.url).pathname,
  ].filter((p): p is string => typeof p === 'string' && existsSync(p));
  for (const path of candidates) {
    try {
      const src = readFileSync(path, 'utf-8');
      const names = new Set<string>();
      // Declaration-level exports only: `export interface|class|type|enum|const
      // function X`, plus a re-export list. A `declare module` block would be a
      // false positive, which is why the pattern is anchored at line start.
      for (const line of src.split('\n')) {
        const m = /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|class|type|enum|const|function|let|var|namespace)\s+([A-Za-z_$][\w$]*)/.exec(line);
        if (m) names.add(m[1]);
        const list = /^export\s+type\s*\{([^}]*)\}/.exec(line);
        if (list) for (const part of list[1].split(',')) {
          const name = part.trim().split(/\s+as\s+/).pop()?.replace(/^type\s+/, '').trim();
          if (name) names.add(name);
        }
      }
      if (names.size > 0) return names;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * `import-type-source` — app-facing types must come from `@vesk/types`.
 *
 * The repo has been moving app-facing types there (AGENTS.md), with back-compat
 * re-exports left behind in `@vesk/compiler` and `@vesk/runtime`. The rewrite is
 * gated on the name actually being exported by the installed `@vesk/types`, so
 * the migration can never produce an import that does not resolve; anything it
 * cannot prove is reported instead of guessed.
 */
const importTypeSource: Codemod = {
  id: 'import-type-source',
  from: '0.0.0',
  to: '0.2.48',
  describe: 'point app-facing type imports at @vesk/types (skipped when the name is not exported there)',
  appliesTo: (filePath) => isVskFile(filePath) || /\.(ts|tsx)$/.test(filePath),
  run(source, ctx) {
    const ast = safeParse(source, ctx.filePath);
    if (!ast) return { code: null, notes: [] };
    const notes: string[] = [];
    const edits: Array<{ start: number; end: number; text: string }> = [];

    walk(ast, null, {
      ImportDeclaration(node: any) {
        const src = node.source?.value;
        if (src !== '@vesk/compiler' && src !== '@vesk/runtime' && src !== '@vesk/runtime/server') return;
        const clause = node.importKind === 'type' || (node.specifiers || []).every((s: any) => s.importKind === 'type');
        if (!clause) {
          notes.push(`${ctx.displayPath}: value import from "${src}" left alone (only type imports are rewritten)`);
          return;
        }
        const names = (node.specifiers || [])
          .map((sp: any) => sp.imported?.name ?? sp.local?.name)
          .filter((n: unknown): n is string => typeof n === 'string');
        const exported = typesPackageExports(ctx.projectDir);
        if (exported) {
          const unknown = names.filter((n: string) => !exported.has(n));
          if (unknown.length > 0) {
            notes.push(`${ctx.displayPath}: ${unknown.join(', ')} not exported by @vesk/types — import left for a human`);
            return;
          }
        }
        if (names.length === 0) {
          notes.push(`${ctx.displayPath}: namespace import from "${src}" left alone (cannot verify its members)`);
          return;
        }
        edits.push({ start: node.source.start, end: node.source.end, text: "'@vesk/types'" });
        notes.push(`${ctx.displayPath}: ${src} -> @vesk/types (type import: ${names.join(', ')})`);
      },
    } as any);

    if (edits.length === 0) return { code: null, notes };
    return { code: applyEdits(source, edits), notes };
  },
};

export const CODEMODS: Codemod[] = [trackDestructuring, importTypeSource];

/** Compare `a` vs `b` on the numeric core only (prerelease labels ignored). */
function coreOf(version: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

export function compareCore(a: string, b: string): number {
  const [a1, a2, a3] = coreOf(a);
  const [b1, b2, b3] = coreOf(b);
  for (const [x, y] of [[a1, b1], [a2, b2], [a3, b3]] as Array<[number, number]>) {
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * The codemods a project at `from` (moving to `to`) needs.
 *
 * A codemod applies when the project is OLDER than the codemod's target — the
 * whole point is to fix a project that predates the fix — and the project is at
 * or after the range the codemod was written for (a codemod must not rewrite
 * code written for a language version it does not understand). `to` only
 * *restricts* the set: `--to 0.2.40` does not run a codemod introduced in 0.2.48.
 */
export function applicableCodemods(from: string, to?: string, only?: string[]): Codemod[] {
  return CODEMODS.filter((c) => {
    if (only && only.length > 0) return only.includes(c.id);
    // `to` is a restriction only when the caller meant one (an explicit
    // `--to`). Left undefined, every codemod the project is behind gets to run.
    if (to !== undefined && compareCore(to, c.to) < 0) return false;
    return compareCore(c.to, from) > 0 && compareCore(from, c.from) >= 0;
  });
}
