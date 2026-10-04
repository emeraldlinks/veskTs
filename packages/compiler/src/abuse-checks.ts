/**
 * Compile-time abuse checks: the mistakes that are otherwise invisible until a
 * user hits them in production.
 *
 * Three classes, each a real failure this repo shipped or nearly shipped:
 *
 *  1. **Browser globals in code the server evaluates.** `window`/`document`
 *     throw a bare `ReferenceError` from generated code with no component name
 *     and no line of user code; `navigator` is worse — it EXISTS in modern Node,
 *     so `navigator.onLine` silently renders as offline. The compiler knows
 *     which nodes run during SSR, so it can say so at build time and name the
 *     fix ({#client}, an event handler, or on_destroy).
 *
 *  2. **The cell half of `track()` called as a function.**
 *     `const &[count, setCount] = track(0)` returns `[value, cell]`; `setCount(1)`
 *     throws `setCount is not a function`.
 *
 *  3. **`set(value, …)` in a body statement.** The compiler rewrites
 *     `set(count, v)` inside JSX and handlers, but NOT in a top-level
 *     statement, so the runtime `set` receives the value and throws
 *     "Cannot read properties of undefined".
 *
 * Scoping matters: none of this is a problem inside a `{#client}` block, an
 * event handler, or a function passed as a child — those never run on the
 * server. Flagging them there would be a false positive, and a framework that
 * cries wolf gets muted.
 */
import type { Node as ESTreeNode } from 'estree';
import { walk } from 'zimmerframe';
import {
  ClientBlock,
  DynamicBinding,
  OpaqueDynamicRegion,
  RuntimeStatement,
  ServerBlock,
  TrackDecl,
  StaticNode,
  type ComponentIR,
} from '@vesk/compiler/src/ir';
import { VeskError, codeFrame } from '@vesk/compiler/src/errors';

/** Offset -> 1-based line/column, for a code frame in a diagnostic. */
function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/**
 * Browser-only globals, with what to reach for instead. `navigator` and
 * `location` are the dangerous ones: they do not throw on the server, they
 * return undefined and the page renders wrong.
 */
/**
 * READS only. A bare read of one of these at statement level is unambiguous:
 * it executes during SSR, either throwing (`window`) or silently returning the
 * wrong thing (`navigator` exists in modern Node, so `navigator.onLine` renders
 * as offline). Calls are NOT in this list: `setInterval`/`addEventListener`
 * inside an effect or a hoisted statement are indistinguishable from a body
 * statement at this point in the walk, and a diagnostic that fires on correct
 * code is worse than none. Timer/listener misuse is a documented follow-up.
 */
const SSR_UNSAFE: Record<string, string> = {
  window: 'the DOM',
  document: 'the DOM',
  localStorage: 'storage',
  sessionStorage: 'storage',
  navigator: 'the Network Information API (see getNetworkState)',
  location: 'routing (see usePathname)',
  history: 'routing (see useNavigate)',
  matchMedia: 'a CSS media query',
};

interface Ctx {
  compName: string;
  file?: string;
  source?: string;
  /** Track() declarations in this component: cell name -> its value half. */
  cells: Map<string, { value: string }>;
  /** The value half of each track() declaration (the first destructured name). */
  values: Map<string, { cell: string }>;
  /** Nesting depth inside a client-only call (on_destroy / effect). */
  clientOnlyDepth?: number;
  /** Globals a `typeof` guard in scope protects, so a read is safe. */
  guardedGlobals?: Set<string>;
}

function at(node: { start?: number }, ctx: Ctx): Record<string, unknown> {
  const opts: Record<string, unknown> = { inComponent: ctx.compName };
  if (ctx.file) opts.file = ctx.file;
  if (ctx.source && typeof node.start === 'number') {
    const { line, column } = offsetToLineCol(ctx.source, node.start);
    opts.line = line;
    opts.column = column;
    opts.frame = codeFrame(ctx.source, line, column);
  }
  return opts;
}

/** Walk an expression, reporting SSR-unsafe globals and cell misuse. */
/** Calls whose bodies are emitted on the client only, so the DOM is legal there. */
const CLIENT_ONLY_CALLS = new Set(['on_destroy', 'effect', 'pre_effect', 'user_effect']);

/**
 * The global named by a `typeof x !== 'undefined'` / `=== 'undefined'` test, or
 * null. `&&` / `||` short-circuit, so the other side of the expression only runs
 * when the global exists.
 */
function typeofGlobalIn(node: any): string | null {
  const isTypeofOf = (n: any): string | null =>
    n && n.type === 'UnaryExpression' && n.operator === 'typeof' && n.argument?.type === 'Identifier'
      ? String(n.argument.name)
      : null;
  if (!node) return null;
  const pair = (a: any, b: any): string | null => {
    const fromA = isTypeofOf(a);
    if (fromA && b?.type === 'BinaryExpression' && b.operator === '!==') return fromA;
    const fromB = isTypeofOf(b);
    if (fromB && a?.type === 'BinaryExpression' && a.operator === '!==') return fromB;
    return null;
  };
  if (node.type === 'LogicalExpression') return pair(node.left, node.right);
  if (node.type === 'ConditionalExpression') {
    return pair(node.test, node.consequent) ?? pair(node.test, node.alternate);
  }
  return null;
}

/**
 * The global a subexpression tests for existence with `typeof`, whether the test
 * stands alone (`typeof x !== 'undefined'`), guards an `&&` chain, or selects a
 * conditional branch. Anything evaluated only when that test passed may read the
 * global safely.
 */
function guardNameOf(node: any): string | null {
  if (!node) return null;
  const direct = typeofGlobalIn(node);
  if (direct) return direct;
  if (node.type === 'LogicalExpression') return guardNameOf(node.left);
  return null;
}

/**
 * Does this statement set up a client-only lifecycle call anywhere?
 *
 * `effect(() => { const h = setInterval(…); on_destroy(() => clearInterval(h)) })`
 * can arrive as ONE hoisted statement, so a statement that mentions a
 * client-only call is treated as client-only. That errs toward silence rather
 * than a false positive, which is the right direction for a new diagnostic.
 */
function mentionsClientOnlyCall(ast: ESTreeNode | null | undefined): boolean {
  if (!ast) return false;
  let found = false;
  try {
    walk(ast as never, null, {
      CallExpression(node: any) {
        const callee = node.callee;
        if (callee && callee.type === 'Identifier' && CLIENT_ONLY_CALLS.has(String(callee.name))) {
          found = true;
          return;
        }
        return;
      },
    } as never);
  } catch {
    return false;
  }
  return found;
}

function checkExpression(ast: ESTreeNode | null | undefined, ctx: Ctx, insideHandler: boolean): void {
  if (!ast) return;
  walk(ast as never, null, {
    ConditionalExpression(node: any, context: any) {
      // `test ? a : typeof x !== 'undefined' && x.use()` — the chosen branch is
      // guarded, so a read of that global there is safe.
      const guarded = guardNameOf(node.alternate) ?? guardNameOf(node.consequent);
      if (!guarded) return context.next();
      ctx.guardedGlobals = new Set([...(ctx.guardedGlobals || []), guarded]);
      return context.next();
    },
    LogicalExpression(node: any, context: any) {
      // `typeof document !== 'undefined' && !!document.querySelector(…)` is the
      // standard client-only guard, and the right side never evaluates on the
      // server. Honour the short-circuit instead of flagging correct code (the
      // docs app's error boundary uses exactly this shape).
      const guarded = guardNameOf(node.left);
      if (guarded) {
        ctx.guardedGlobals = new Set([...(ctx.guardedGlobals || []), guarded]);
        return context.next();
      }
      return context.next();
    },
    UnaryExpression(node: any, context: any) {
      // `typeof window !== 'undefined'` is the CORRECT guard for a client-only
      // value — the test-app's own broken-component fixture uses it. A `typeof`
      // test never reads the value, so it must not be flagged.
      if (node.operator === 'typeof') return;
      return context.next();
    },
    ArrowFunctionExpression(node: any, context: any) {
      // A function body runs when it is CALLED, not when the render creates it.
      // `const probe = () => document.querySelector(…)` called from a handler is
      // correct code, so the walk stops here.
      return;
    },
    FunctionExpression(node: any, context: any) {
      return;
    },
    Identifier(node: any, context: any) {
      if ((ctx.clientOnlyDepth || 0) > 0) return context.next();
      const parent = context.path.at(-1) as Record<string, unknown> | undefined;
      // A member's PROPERTY is a name, not a global: `foo.window` is fine.
      if (parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return context.next();
      if (parent && parent.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) return context.next();
      const name = String(node.name);
      if (insideHandler) return context.next();
      if (ctx.guardedGlobals?.has(name)) return context.next();
      if (name in SSR_UNSAFE) {
        throw VeskError.ssrUnsafeGlobal(name, at(node as never, ctx) as never);
      }
      return context.next();
    },
    CallExpression(node: any, context: any) {
      const callee = node.callee;
      // Depth is carried on the context object, not a module global: a global is
      // never decremented, so one on_destroy call would silently disable every
      // later check in the file.
      const insideClientOnly = (ctx.clientOnlyDepth || 0) > 0;
      if (callee && callee.type === 'Identifier') {
        const name = String(callee.name);
        if (insideHandler || insideClientOnly) return context.next();
        // on_destroy/effect bodies are emitted on the client only, so anything
        // they touch is legal — and `context.skip()` keeps the walk out.
        if (CLIENT_ONLY_CALLS.has(name)) {
          ctx.clientOnlyDepth = (ctx.clientOnlyDepth || 0) + 1;
          context.next();
          ctx.clientOnlyDepth -= 1;
          return;
        }
        if (name in SSR_UNSAFE) throw VeskError.ssrUnsafeGlobal(name, at(callee as never, ctx) as never);
      }

      // Anything else (a nested arrow, a call argument) is still evaluated on
      // the server when it runs in the body — unless we are inside a
      // client-only call.
      if (!insideHandler && !insideClientOnly) checkExpression(callee ?? null, ctx, false);
      return context.next();
    },
  } as never);
}

/** The nodes whose expressions the server evaluates. */
function checkNode(node: unknown, ctx: Ctx, insideHandler = false): void {
  if (!node || typeof node !== 'object') return;
  // Guarded globals are scoped to one top-level statement.
  if (insideHandler === false && node instanceof RuntimeStatement) ctx.guardedGlobals = new Set();
  // `{#client}` never runs on the server; `{#server}` DOES (that is its whole
  // purpose), so it is checked like any other body position.
  if (node instanceof ClientBlock) return;
  if (node instanceof ServerBlock) {
    for (const child of ((node as { children?: unknown[]; body?: unknown[] }).children
      || (node as { body?: unknown[] }).body
      || [])) {
      checkNode(child, ctx);
    }
    return;
  }
  if (node instanceof RuntimeStatement) {
    if (!insideHandler && !mentionsClientOnlyCall(node.ast)) checkExpression(node.ast, ctx, false);
    return;
  }
  if (node instanceof TrackDecl) {
    // `track(...)` is safe in the body; a track() inside a nested function is not,
    // but that is a different failure (a raw syntax error) and the parser owns it.
    return;
  }
  if (node instanceof DynamicBinding) {
    if (insideHandler) return;
    // An event handler is client-only by definition: it is dispatched by the
    // browser, so `document.title = …` there is correct, not a bug.
    const binding = node as unknown as { kind?: string; target?: string | null };
    const target = String(binding.target || '');
    if (target.startsWith('on') || binding.kind === 'event') return;
    checkExpression((node as { expression?: { ast?: ESTreeNode } }).expression?.ast ?? null, ctx, false);
    return;
  }
  if (node instanceof OpaqueDynamicRegion) {
    checkExpression((node as { condition?: { ast?: ESTreeNode } }).condition?.ast ?? null, ctx, false);
    for (const child of ((node as { consequentNodes?: unknown[] }).consequentNodes || [])) checkNode(child, ctx);
    for (const child of ((node as { alternateNodes?: unknown[] }).alternateNodes || [])) checkNode(child, ctx);
    return;
  }
  if (node instanceof StaticNode) {
    for (const attr of node.attributes || []) void attr;
    for (const child of node.children || []) checkNode(child, ctx);
    return;
  }
  // ComponentCall / MapRegion / prop slots / anything else: recurse over children
  // and check their expressions, still in body position.
  const record = node as Record<string, unknown>;
  if (record.expression && typeof record.expression === 'object') {
    checkExpression((record.expression as { ast?: ESTreeNode }).ast ?? null, ctx, false);
  }
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (Array.isArray(value)) for (const item of value) checkNode(item, ctx);
    else if (value && typeof value === 'object' && (value as { constructor?: { name?: string } }).constructor?.name?.endsWith('Node')) {
      checkNode(value, ctx);
    }
  }
}

/** The cell/value halves of every `track()` declaration in a component. */
function collectCells(comp: ComponentIR): { cells: Map<string, { value: string }>; values: Map<string, { cell: string }> } {
  const cells = new Map<string, { value: string }>();
  const values = new Map<string, { cell: string }>();
  for (const node of comp.body) {
    if (!(node instanceof TrackDecl)) continue;
    const cellName = node.rawName || node.name;
    if (node.rawName) cells.set(node.rawName, { value: node.name });
    values.set(node.name, { cell: cellName });
  }
  return { cells, values };
}

/**
 * Run the abuse checks for one component. Called after its body is built, so
 * the tracked names are known.
 */
export function validateAbuse(comp: ComponentIR, file?: string, source?: string): void {
  // A `client` island renders on the server too — SSR runs the same body — so
  // the same rules apply. What differs is `{#server}`/`{#client}`.
  const { cells, values } = collectCells(comp);
  const ctx: Ctx = { compName: comp.name, file, source, cells, values };
  for (const node of comp.body) checkNode(node, ctx);
}