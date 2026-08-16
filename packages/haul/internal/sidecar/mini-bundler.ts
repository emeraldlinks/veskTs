// mini-bundler.ts — esbuild-free ESM bundler for the project's own modules.
//
// Replaces the esbuild Go API used by haul for two narrow, well-understood
// tasks over self-contained project code (no arbitrary node_modules bundling):
//
//   1. bundleClientRuntimeIife  — the tree-shaken client runtime (IIFE +
//      explicit re-export), mirroring buildTreeShakenRuntime in
//      packages/adapter/src/client-bundle.ts.
//   2. bundleServerRuntime      — server/runtime.js (ESM; node builtins and
//      non-project bare specifiers stay external), mirroring
//      BundleServerRuntime in packages/haul/internal/bundle/serverbundle.go.
//
// Every module is rewritten into a factory that receives __export(name, get)
// (live getters keep `export let` bindings live) and __load(id) (the module
// registry). The registry caches the exports object before executing the
// factory, so cyclic imports resolve safely. References to internally-imported
// bindings are rewritten into lazy `__load(id).<imported>` member accesses
// (scope-aware, so shadowed names stay local) — dereferencing at call time
// mirrors ESM live bindings across cycles. Modules run once, in dependency
// order, mirroring ESM execution semantics.

import { parse } from 'acorn';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface BundleDirs {
  runtimeDir: string;
  compilerDir?: string;
}

export class MiniBundleError extends Error {}

interface ExternalImport {
  spec: string;
  named: Array<{ imported: string; local: string }>;
  namespaces: string[];
  defaults: string[];
  sideEffect: boolean;
}

interface TransformedModule {
  body: string;
  internalDeps: string[];
  externalImports: ExternalImport[];
  externalReexports: string[];
  exportNames: string[];
}

// resolveSpec maps an ESM specifier to an absolute file path, or null when the
// specifier must stay external (bare packages + node builtins).
function resolveSpec(spec: string, fromFile: string, dirs: BundleDirs): string | null {
  if (spec.startsWith('/')) return existsSync(spec) ? spec : null;
  if (spec.startsWith('./') || spec.startsWith('../')) {
    return resolveFileCandidates(join(dirname(fromFile), spec));
  }
  if (spec.startsWith('@vesk/runtime/src/')) {
    return join(dirs.runtimeDir, spec.slice('@vesk/runtime/src/'.length) + '.js');
  }
  if (spec === '@vesk/runtime' || spec === '@vesk/runtime/client') {
    return join(dirs.runtimeDir, 'index-client.js');
  }
  if (spec === '@vesk/runtime/server') {
    return join(dirs.runtimeDir, 'index-server.js');
  }
  if (dirs.compilerDir && spec === '@vesk/compiler') {
    return join(dirs.compilerDir, 'index.js');
  }
  if (dirs.compilerDir && spec.startsWith('@vesk/compiler/src/')) {
    return join(dirs.compilerDir, spec.slice('@vesk/compiler/src/'.length) + '.js');
  }
  return null;
}

function resolveFileCandidates(base: string): string | null {
  for (const c of [base, base + '.js', base + '.mjs', join(base, 'index.js'), join(base, 'index.mjs')]) {
    if (existsSync(c)) return c;
  }
  return null;
}

function literalName(n: any): string {
  return n.name !== undefined ? n.name : String(n.value);
}

interface ImportBinding {
  id: string;
  imported: string | null;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

// bindingNames extracts every identifier bound by a declaration pattern.
function bindingNames(id: any): string[] {
  const out: string[] = [];
  (function w(n: any) {
    if (!n) return;
    switch (n.type) {
      case 'Identifier':
        out.push(n.name);
        break;
      case 'ObjectPattern':
        for (const p of n.properties || []) w(p.type === 'RestElement' ? p.argument : p.value);
        break;
      case 'ArrayPattern':
        for (const el of n.elements || []) w(el);
        break;
      case 'AssignmentPattern':
        w(n.left);
        break;
      case 'RestElement':
        w(n.argument);
        break;
    }
  })(id);
  return out;
}

// directDeclNames collects let/const/class/function bindings declared by a
// statement list (block- or module-scoped names).
function directDeclNames(stmts: any[]): string[] {
  const out: string[] = [];
  for (const s of stmts) {
    switch (s.type) {
      case 'FunctionDeclaration':
      case 'ClassDeclaration':
        if (s.id) out.push(s.id.name);
        break;
      case 'VariableDeclaration':
        for (const d of s.declarations) out.push(...bindingNames(d.id));
        break;
    }
  }
  return out;
}

// collectVarsIn gathers `var` declarations across a subtree (function scope),
// skipping nested function scopes.
function collectVarsIn(node: any): string[] {
  const out: string[] = [];
  (function scan(n: any) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      for (const c of n) scan(c);
      return;
    }
    switch (n.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ClassDeclaration':
      case 'ClassExpression':
        return;
      case 'VariableDeclaration':
        if (n.kind === 'var') for (const d of n.declarations) out.push(...bindingNames(d.id));
        break;
    }
    for (const k in n) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      scan(n[k]);
    }
  })(node);
  return out;
}

function importRefText(name: string, importMap: Map<string, ImportBinding>): string {
  const b = importMap.get(name)!;
  const call = `__load(${JSON.stringify(b.id)})`;
  if (b.imported === null) return call;
  if (b.imported === 'default') return `${call}.default`;
  return `${call}.${b.imported}`;
}

function pushScope(names: Iterable<string>, scopes: Set<string>[]): void {
  scopes.push(new Set(names));
}

function inScope(name: string, scopes: Set<string>[]): boolean {
  for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) return true;
  return false;
}

// Scope-aware reference rewriting. Every reference to an internally-imported
// binding is replaced with a lazy `__load(id).<imported>` member access so that
// circular imports resolve against live getters at call time (mirroring ESM
// live bindings). Names shadowed by a local declaration are left untouched.
function collectImportEdits(
  stmts: any[],
  importMap: Map<string, ImportBinding>,
  edits: Edit[],
  source: string,
): void {
  const scopes: Set<string>[] = [];
  scopes.push(new Set(directDeclNames(stmts)));

  const record = (node: any, text: string) => {
    if (node.type === 'Identifier') {
      edits.push({ start: node.start, end: node.end, text });
    }
  };

  // hasImportRef reports whether an expression references an internal import
  // (directly or through member/callee chains).
  const hasImportRef = (node: any): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (node.type === 'Identifier') return importMap.has(node.name) && !inScope(node.name, scopes);
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
      return hasImportRef(node.object) || (node.computed ? hasImportRef(node.property) : false);
    }
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression' || node.type === 'NewExpression') {
      if (hasImportRef(node.callee)) return true;
      for (const a of node.arguments || []) if (hasImportRef(a)) return true;
      return false;
    }
    if (node.type === 'ChainExpression') return hasImportRef(node.expression);
    if (node.type === 'TaggedTemplateExpression') return hasImportRef(node.tag);
    if (node.type === 'ThisExpression' || node.type === 'Literal' || node.type === 'Super') return false;
    for (const k in node) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      if (hasImportRef(node[k])) return true;
    }
    return false;
  };

  // printRewrite reproduces an expression with internal-import references
  // rewritten, used for `new` callees where a bare member rewrite would change
  // precedence (`new __load(x).Ctor()` binds `new` to the __load call).
  const printRewrite = (node: any): string => {
    if (!node || typeof node !== 'object') return '';
    switch (node.type) {
      case 'Identifier':
        if (importMap.has(node.name) && !inScope(node.name, scopes)) return importRefText(node.name, importMap);
        return source.slice(node.start, node.end);
      case 'Literal':
      case 'TemplateLiteral':
        return source.slice(node.start, node.end);
      case 'ThisExpression':
        return 'this';
      case 'Super':
        return 'super';
      case 'MemberExpression':
      case 'OptionalMemberExpression':
        return `${printRewrite(node.object)}${node.computed ? `[${printRewrite(node.property)}]` : `.${node.property.name}`}`;
      case 'CallExpression':
      case 'OptionalCallExpression':
        return `${printRewrite(node.callee)}(${(node.arguments || []).map((a: any) => printRewrite(a)).join(', ')})`;
      case 'NewExpression':
        return `new (${printRewrite(node.callee)})(${(node.arguments || []).map((a: any) => printRewrite(a)).join(', ')})`;
      case 'ChainExpression':
        return printRewrite(node.expression);
      default:
        return source.slice(node.start, node.end);
    }
  };

  const enterFunction = (fn: any) => {
    const names = new Set<string>();
    for (const p of fn.params || []) for (const n of bindingNames(p)) names.add(n);
    for (const v of collectVarsIn(fn.body)) names.add(v);
    for (const d of directDeclNames(fn.body.type === 'BlockStatement' ? fn.body.body : [fn.body])) names.add(d);
    pushScope(names, scopes);
    for (const p of fn.params || []) walkPattern(p);
    if (fn.body.type === 'BlockStatement') {
      pushScope(directDeclNames(fn.body.body), scopes);
      for (const s of fn.body.body) walkStmt(s);
      scopes.pop();
    } else {
      walkExpr(fn.body);
    }
    scopes.pop();
  };

  const walkExpr = (node: any) => {
    if (!node || typeof node !== 'object') return;
    switch (node.type) {
      case 'Identifier':
        if (importMap.has(node.name) && !inScope(node.name, scopes)) {
          record(node, importRefText(node.name, importMap));
        }
        return;
      case 'Literal':
      case 'ThisExpression':
      case 'Super':
      case 'MetaProperty':
        return;
      case 'ObjectExpression': {
        for (const p of node.properties || []) {
          if (p.type === 'SpreadElement') {
            walkExpr(p.argument);
            continue;
          }
          if (p.shorthand && p.value.type === 'Identifier' && importMap.has(p.value.name) && !inScope(p.value.name, scopes)) {
            edits.push({
              start: p.start,
              end: p.end,
              text: `${p.value.name}: ${importRefText(p.value.name, importMap)}`,
            });
            continue;
          }
          if (p.computed) walkExpr(p.key);
          walkExpr(p.value);
        }
        return;
      }
      case 'ArrayExpression':
        for (const el of node.elements || []) walkExpr(el);
        return;
      case 'MemberExpression':
        walkExpr(node.object);
        if (node.computed) walkExpr(node.property);
        return;
      case 'OptionalMemberExpression':
        walkExpr(node.object);
        if (node.computed) walkExpr(node.property);
        return;
      case 'CallExpression':
      case 'OptionalCallExpression':
        walkExpr(node.callee ?? node.tag ?? node.left);
        for (const a of node.arguments || node.expressions || []) walkExpr(a);
        return;
      case 'NewExpression':
        if (hasImportRef(node.callee)) {
          edits.push({ start: node.callee.start, end: node.callee.end, text: `(${printRewrite(node.callee)})` });
        } else {
          walkExpr(node.callee);
        }
        for (const a of node.arguments || []) walkExpr(a);
        return;
      case 'ChainExpression':
        walkExpr(node.expression);
        return;
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'FunctionDeclaration':
        enterFunction(node);
        return;
      case 'ClassExpression':
        walkExpr(node.superClass);
        for (const m of node.body?.body || []) {
          if (m.type === 'MethodDefinition' && m.value) enterFunction(m.value);
        }
        return;
      case 'AssignmentExpression':
        if (node.left.type === 'ObjectPattern' || node.left.type === 'ArrayPattern') walkPattern(node.left);
        else if (node.left.type === 'Identifier' && importMap.has(node.left.name)) {
          // assigning to an import is a runtime error in real ESM; leave it as-is
        } else walkExpr(node.left);
        walkExpr(node.right);
        return;
      case 'UpdateExpression':
      case 'UnaryExpression':
      case 'AwaitExpression':
        walkExpr(node.argument);
        return;
      case 'BinaryExpression':
      case 'LogicalExpression':
        walkExpr(node.left);
        walkExpr(node.right);
        return;
      case 'ConditionalExpression':
        walkExpr(node.test);
        walkExpr(node.consequent);
        walkExpr(node.alternate);
        return;
      case 'SequenceExpression':
        for (const e of node.expressions) walkExpr(e);
        return;
      case 'TemplateLiteral':
        for (const e of node.expressions) walkExpr(e);
        return;
      case 'TaggedTemplateExpression':
        walkExpr(node.tag);
        for (const e of node.quasi.expressions) walkExpr(e);
        return;
      case 'YieldExpression':
        walkExpr(node.argument);
        return;
      case 'SpreadElement':
        walkExpr(node.argument);
        return;
      case 'ImportExpression':
        walkExpr(node.source);
        return;
      case 'Property': {
        if (node.shorthand && node.value.type === 'Identifier' && importMap.has(node.value.name) && !inScope(node.value.name, scopes)) {
          edits.push({
            start: node.start,
            end: node.end,
            text: `${node.value.name}: ${importRefText(node.value.name, importMap)}`,
          });
          return;
        }
        if (node.computed) walkExpr(node.key);
        walkExpr(node.value);
        return;
      }
      case 'ArrayPattern':
      case 'ObjectPattern':
      case 'AssignmentPattern':
      case 'RestElement':
        walkPattern(node);
        return;
      default: {
        for (const k in node) {
          if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
          const c = node[k];
          if (Array.isArray(c)) {
            for (const x of c) walkExpr(x);
          } else if (c && typeof c === 'object' && c.type) {
            walkExpr(c);
          }
        }
      }
    }
  };

  // walkPattern descends binding patterns, walking default-value expressions
  // only (bound identifiers are never references).
  const walkPattern = (node: any) => {
    if (!node) return;
    switch (node.type) {
      case 'Identifier':
        return;
      case 'ObjectPattern':
        for (const p of node.properties || []) {
          if (p.type === 'RestElement') walkPattern(p.argument);
          else {
            if (p.computed) walkExpr(p.key);
            walkPattern(p.value);
          }
        }
        return;
      case 'ArrayPattern':
        for (const el of node.elements || []) walkPattern(el);
        return;
      case 'AssignmentPattern':
        walkPattern(node.left);
        walkExpr(node.right);
        return;
      case 'RestElement':
        walkPattern(node.argument);
        return;
    }
  };

  const walkStmt = (node: any) => {
    if (!node || typeof node !== 'object') return;
    switch (node.type) {
      case 'FunctionDeclaration':
        enterFunction(node);
        return;
      case 'ClassDeclaration':
        walkExpr({ type: 'ClassExpression', ...node });
        return;
      case 'VariableDeclaration':
        for (const d of node.declarations) {
          if (d.init) walkExpr(d.init);
          else walkPattern(d.id);
        }
        return;
      case 'ImportDeclaration':
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration':
      case 'ExportAllDeclaration':
        return;
      case 'ExpressionStatement':
        walkExpr(node.expression);
        return;
      case 'ReturnStatement':
      case 'ThrowStatement':
        walkExpr(node.argument);
        return;
      case 'IfStatement':
        walkExpr(node.test);
        walkBranch(node.consequent);
        if (node.alternate) walkBranch(node.alternate);
        return;
      case 'BlockStatement':
        pushScope(directDeclNames(node.body), scopes);
        for (const s of node.body) walkStmt(s);
        scopes.pop();
        return;
      case 'ForStatement':
        if (node.init && node.init.type === 'VariableDeclaration') {
          pushScope(([] as string[]).concat(...node.init.declarations.map((d: any) => bindingNames(d.id))), scopes);
          for (const d of node.init.declarations) if (d.init) walkExpr(d.init);
        } else if (node.init) {
          walkExpr(node.init);
        }
        walkExpr(node.test);
        walkExpr(node.update);
        walkBranch(node.body);
        if (node.init && node.init.type === 'VariableDeclaration') scopes.pop();
        return;
      case 'ForInStatement':
      case 'ForOfStatement':
        if (node.left.type === 'VariableDeclaration') {
          pushScope(([] as string[]).concat(...node.left.declarations.map((d: any) => bindingNames(d.id))), scopes);
          for (const d of node.left.declarations) if (d.init) walkExpr(d.init);
        } else {
          walkExpr(node.left);
        }
        walkExpr(node.right);
        walkBranch(node.body);
        if (node.left.type === 'VariableDeclaration') scopes.pop();
        return;
      case 'WhileStatement':
      case 'DoWhileStatement':
        walkExpr(node.test);
        walkBranch(node.body);
        return;
      case 'SwitchStatement': {
        walkExpr(node.discriminant);
        const names: string[] = [];
        for (const c of node.cases) names.push(...directDeclNames(c.consequent));
        pushScope(names, scopes);
        for (const c of node.cases) {
          walkExpr(c.test);
          for (const s of c.consequent) walkStmt(s);
        }
        scopes.pop();
        return;
      }
      case 'TryStatement':
        pushScope(directDeclNames(node.block.body), scopes);
        for (const s of node.block.body) walkStmt(s);
        scopes.pop();
        if (node.handler) {
          pushScope(([] as string[]).concat(node.handler.param ? bindingNames(node.handler.param) : []), scopes);
          pushScope(directDeclNames(node.handler.body.body), scopes);
          for (const s of node.handler.body.body) walkStmt(s);
          scopes.pop();
          scopes.pop();
        }
        if (node.finalizer) {
          pushScope(directDeclNames(node.finalizer.body), scopes);
          for (const s of node.finalizer.body) walkStmt(s);
          scopes.pop();
        }
        return;
      case 'LabeledStatement':
        walkBranch(node.body);
        return;
      case 'EmptyStatement':
      case 'DebuggerStatement':
      case 'BreakStatement':
      case 'ContinueStatement':
        return;
      default: {
        for (const k in node) {
          if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
          const c = node[k];
          if (Array.isArray(c)) {
            for (const x of c) walkStmt(x);
          } else if (c && typeof c === 'object' && c.type) {
            walkStmt(c);
          }
        }
      }
    }
  };

  // walkBranch handles a statement that may be a single statement or a block.
  const walkBranch = (node: any) => {
    if (node.type === 'BlockStatement') {
      pushScope(directDeclNames(node.body), scopes);
      for (const s of node.body) walkStmt(s);
      scopes.pop();
    } else {
      walkStmt(node);
    }
  };

  for (const s of stmts) walkStmt(s);
  scopes.pop();
}

// splice applies statement-removal ranges and identifier rewrites to the
// original source text. removedRanges must be sorted ascending and
// non-overlapping; edits must be sorted ascending and disjoint from removed
// ranges and from each other.
function splice(source: string, removedRanges: number[][], edits: Edit[]): string {
  removedRanges.sort((a, b) => a[0] - b[0]);
  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  let r = 0;
  let e = 0;
  while (pos < source.length) {
    while (r < removedRanges.length && removedRanges[r][1] <= pos) r++;
    if (r < removedRanges.length && removedRanges[r][0] <= pos) {
      pos = removedRanges[r][1];
      continue;
    }
    if (e < edits.length && edits[e].start === pos) {
      out += edits[e].text;
      pos = edits[e].end;
      e++;
      continue;
    }
    const nextCut = Math.min(
      r < removedRanges.length ? removedRanges[r][0] : source.length,
      e < edits.length ? edits[e].start : source.length,
    );
    out += source.slice(pos, nextCut);
    pos = nextCut;
  }
  return out;
}

function transformModule(filePath: string, source: string, dirs: BundleDirs): TransformedModule {
  let ast: any;
  try {
    ast = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
  } catch (e) {
    throw new MiniBundleError(`vesk: mini-bundle failed to parse ${filePath}: ${(e as Error).message}`);
  }
  if (ast.type !== 'Program' || !Array.isArray(ast.body)) {
    throw new MiniBundleError(`vesk: mini-bundle unexpected AST for ${filePath}`);
  }

  const importMap = new Map<string, ImportBinding>();
  const internalDeps: string[] = [];
  const externalImports: ExternalImport[] = [];
  const externalReexports: string[] = [];
  const exportNames: string[] = [];
  const exportPieces: string[] = [];
  const keptStmts: any[] = [];
  const removedRanges: number[][] = [];

  const addDep = (id: string) => {
    if (!internalDeps.includes(id)) internalDeps.push(id);
  };

  for (const stmt of ast.body) {
    switch (stmt.type) {
      case 'ImportDeclaration': {
        const spec = String(stmt.source.value);
        const id = resolveSpec(spec, filePath, dirs);
        if (id === null) {
          const ext: ExternalImport = { spec, named: [], namespaces: [], defaults: [], sideEffect: false };
          for (const s of stmt.specifiers || []) {
            if (s.type === 'ImportSpecifier') ext.named.push({ imported: literalName(s.imported), local: s.local.name });
            else if (s.type === 'ImportNamespaceSpecifier') ext.namespaces.push(s.local.name);
            else if (s.type === 'ImportDefaultSpecifier') ext.defaults.push(s.local.name);
          }
          if (ext.named.length === 0 && ext.namespaces.length === 0 && ext.defaults.length === 0) ext.sideEffect = true;
          externalImports.push(ext);
        } else {
          addDep(id);
          for (const s of stmt.specifiers || []) {
            if (s.type === 'ImportSpecifier') importMap.set(s.local.name, { id, imported: literalName(s.imported) });
            else if (s.type === 'ImportNamespaceSpecifier') importMap.set(s.local.name, { id, imported: null });
            else if (s.type === 'ImportDefaultSpecifier') importMap.set(s.local.name, { id, imported: 'default' });
          }
        }
        removedRanges.push([stmt.start, stmt.end]);
        break;
      }
      case 'ExportNamedDeclaration': {
        if (stmt.declaration) {
          const decl = stmt.declaration;
          if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
            keptStmts.push(decl);
            if (decl.id) {
              const n = decl.id.name;
              exportPieces.push(`__export(${JSON.stringify(n)}, () => ${n});`);
              exportNames.push(n);
            }
          } else if (decl.type === 'VariableDeclaration') {
            keptStmts.push(decl);
            for (const d of decl.declarations || []) {
              if (d.id && d.id.type === 'Identifier') {
                const n = d.id.name;
                exportPieces.push(`__export(${JSON.stringify(n)}, () => ${n});`);
                exportNames.push(n);
              }
            }
          }
          removedRanges.push([stmt.start, decl.start], [decl.end, stmt.end]);
        } else if (stmt.source) {
          const spec = String(stmt.source.value);
          const id = resolveSpec(spec, filePath, dirs);
          if (id === null) {
            for (const s of stmt.specifiers || []) {
              const local = literalName(s.local);
              const exported = literalName(s.exported);
              externalReexports.push(
                local === exported
                  ? `export { ${local} } from ${JSON.stringify(spec)};`
                  : `export { ${local} as ${exported} } from ${JSON.stringify(spec)};`,
              );
            }
          } else {
            addDep(id);
            for (const s of stmt.specifiers || []) {
              const local = literalName(s.local);
              const exported = literalName(s.exported);
              exportPieces.push(`__export(${JSON.stringify(exported)}, () => __load(${JSON.stringify(id)}).${local});`);
              exportNames.push(exported);
            }
          }
          removedRanges.push([stmt.start, stmt.end]);
        } else {
          for (const s of stmt.specifiers || []) {
            const local = literalName(s.local);
            const exported = literalName(s.exported);
            const imp = importMap.get(local);
            exportPieces.push(
              imp ? `__export(${JSON.stringify(exported)}, () => ${importRefText(local, importMap)});` : `__export(${JSON.stringify(exported)}, () => ${local});`,
            );
            exportNames.push(exported);
          }
          removedRanges.push([stmt.start, stmt.end]);
        }
        break;
      }
      case 'ExportDefaultDeclaration': {
        const decl = stmt.declaration;
        if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
          keptStmts.push(decl);
          exportPieces.push(`__export('default', () => ${decl.id.name});`);
        } else {
          exportPieces.push(`const __default = (${source.slice(decl.start, decl.end)});`);
          exportPieces.push(`__export('default', () => __default);`);
        }
        exportNames.push('default');
        removedRanges.push([stmt.start, stmt.end]);
        break;
      }
      case 'ExportAllDeclaration': {
        const spec = String(stmt.source.value);
        const id = resolveSpec(spec, filePath, dirs);
        if (id === null) {
          externalReexports.push(`export * from ${JSON.stringify(spec)};`);
        } else {
          addDep(id);
          exportPieces.push(`const __star = __load(${JSON.stringify(id)});`);
          exportPieces.push(`for (const __k of Object.keys(__star)) if (__k !== 'default') __export(__k, () => __star[__k]);`);
        }
        removedRanges.push([stmt.start, stmt.end]);
        break;
      }
      default:
        keptStmts.push(stmt);
    }
  }

  const edits: Edit[] = [];
  collectImportEdits(keptStmts, importMap, edits, source);
  const body = splice(source, removedRanges, edits);
  exportPieces.unshift(body);
  return {
    body: exportPieces.join('\n'),
    internalDeps,
    externalImports,
    externalReexports,
    exportNames,
  };
}

interface Graph {
  modules: Map<string, TransformedModule>;
  order: string[];
  externals: Map<string, ExternalImport>;
  externalReexports: string[];
}

function collectGraph(entryIds: string[], dirs: BundleDirs): Graph {
  const modules = new Map<string, TransformedModule>();
  const order: string[] = [];
  const externals = new Map<string, ExternalImport>();
  const externalReexports: string[] = [];
  const visited = new Set<string>();

  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const mod = transformModule(id, readFileSync(id, 'utf-8'), dirs);
    modules.set(id, mod);
    for (const dep of mod.internalDeps) visit(dep);
    for (const ext of mod.externalImports) {
      const existing = externals.get(ext.spec);
      if (existing) {
        for (const n of ext.named) if (!existing.named.some((e) => e.local === n.local)) existing.named.push(n);
        for (const n of ext.namespaces) if (!existing.namespaces.includes(n)) existing.namespaces.push(n);
        for (const n of ext.defaults) if (!existing.defaults.includes(n)) existing.defaults.push(n);
        existing.sideEffect = existing.sideEffect || ext.sideEffect;
      } else {
        externals.set(ext.spec, ext);
      }
    }
    externalReexports.push(...mod.externalReexports);
    order.push(id);
  };

  for (const id of entryIds) visit(id);
  return { modules, order, externals, externalReexports };
}

function emitExternals(externals: Map<string, ExternalImport>): string {
  const out: string[] = [];
  for (const ext of externals.values()) {
    if (ext.sideEffect) out.push(`import ${JSON.stringify(ext.spec)};`);
    for (const local of ext.namespaces) out.push(`import * as ${local} from ${JSON.stringify(ext.spec)};`);
    for (const local of ext.defaults) out.push(`import ${local} from ${JSON.stringify(ext.spec)};`);
    if (ext.named.length > 0) {
      const parts = ext.named.map((n) => (n.imported === n.local ? n.local : `${n.imported} as ${n.local}`));
      out.push(`import { ${parts.join(', ')} } from ${JSON.stringify(ext.spec)};`);
    }
  }
  return out.join('\n');
}

const LOADER = `function __load(id) {
  if (__cache[id]) return __cache[id];
  const __exports = {};
  __cache[id] = __exports;
  const __factory = __registry[id];
  if (!__factory) throw new Error('vesk: mini-bundle missing module ' + id);
  const __export = (name, get) => {
    Object.defineProperty(__exports, name, { get, enumerable: true, configurable: true });
  };
  __factory(__export);
  return __exports;
}`;

function emitRegistry(modules: Map<string, TransformedModule>, indent: number): string {
  const pad = ' '.repeat(indent);
  const lines: string[] = [`${pad}const __registry = {`];
  for (const [id, mod] of modules) {
    lines.push(`${pad}  ${JSON.stringify(id)}: function(__export) {`);
    lines.push(mod.body.replace(/^/gm, `${pad}    `));
    lines.push(`${pad}  },`);
  }
  lines.push(`${pad}};`);
  return lines.join('\n');
}

function indentLines(text: string, n: number): string {
  const pad = ' '.repeat(n);
  return text.replace(/^/gm, pad);
}

function emitPreloads(order: string[], indent: number): string {
  const pad = ' '.repeat(indent);
  return order.map((id) => `${pad}__load(${JSON.stringify(id)});`).join('\n');
}

// Used-name → { spec, local } map from the runtime's index-client.js re-export hub.
export function hubExportMap(runtimeDir: string): Map<string, { spec: string; local: string }> {
  const hubPath = join(runtimeDir, 'index-client.js');
  if (!existsSync(hubPath)) {
    throw new MiniBundleError(`vesk: runtime hub not found at ${hubPath}`);
  }
  const ast = parse(readFileSync(hubPath, 'utf-8'), { sourceType: 'module', ecmaVersion: 2022 });
  const map = new Map<string, { spec: string; local: string }>();
  for (const stmt of ast.body) {
    if (stmt.type !== 'ExportNamedDeclaration' || !stmt.source) continue;
    const spec = String(stmt.source.value);
    for (const s of stmt.specifiers || []) {
      map.set(literalName(s.exported), { spec, local: literalName(s.local) });
    }
  }
  return map;
}

// Tree-shaken client runtime as one closed IIFE + explicit re-export line,
// preserving the contract asserted by the adapter's tree-shake test:
//   const __veskRuntime = (() => { ... })();
//   const { track, get, set, effect } = __veskRuntime;
//   export { track, get, set, effect };
export function bundleClientRuntimeIife(runtimeDir: string, usedNames: string[]): string {
  const hubPath = join(runtimeDir, 'index-client.js');
  const hub = hubExportMap(runtimeDir);
  const unique = [...new Set(usedNames)];
  const missing = unique.filter((n) => !hub.has(n));
  if (missing.length > 0) {
    throw new MiniBundleError(`runtime names not exported by @vesk/runtime: ${missing.join(', ')}`);
  }
  const dirs: BundleDirs = { runtimeDir };
  const entryIds: string[] = [];
  const usedGetters: string[] = [];
  for (const n of unique) {
    const { spec, local } = hub.get(n)!;
    const id = resolveSpec(spec, hubPath, dirs);
    if (id === null) throw new MiniBundleError(`vesk: client runtime name ${n} resolves to an external module`);
    if (!entryIds.includes(id)) entryIds.push(id);
    usedGetters.push(`  Object.defineProperty(__used, ${JSON.stringify(n)}, { get: () => __load(${JSON.stringify(id)}).${local}, enumerable: true, configurable: true });`);
  }
  const graph = collectGraph(entryIds, dirs);
  if (graph.externals.size > 0) {
    throw new MiniBundleError(
      `vesk: client runtime cannot keep external imports: ${[...graph.externals.keys()].join(', ')}`,
    );
  }

  const lines: string[] = [];
  lines.push('const __veskRuntime = (() => {');
  lines.push('  const __cache = {};');
  lines.push(emitRegistry(graph.modules, 2));
  lines.push(indentLines(LOADER, 2));
  lines.push(emitPreloads(graph.order, 2));
  lines.push('  const __used = {};');
  lines.push(...usedGetters);
  lines.push('  return __used;');
  lines.push('})();');
  lines.push(`const { ${unique.join(', ')} } = __veskRuntime;`);
  lines.push(`export { ${unique.join(', ')} };`);
  return lines.join('\n');
}

// server/runtime.js as ESM. External specifiers (node builtins, acorn/esrap/…)
// stay as bare top-level imports; the project's own modules are inlined.
// entryPath must already exist on disk (Go writes it before calling).
export function bundleServerRuntime(runtimeDir: string, compilerDir: string, entryPath: string): string {
  const dirs: BundleDirs = { runtimeDir, compilerDir };
  const entryId = resolveSpec(entryPath, entryPath, dirs) ?? entryPath;
  const graph = collectGraph([entryId], dirs);
  const entry = graph.modules.get(entryId);
  const entryExports = entry ? entry.exportNames : [];

  const lines: string[] = [];
  const ext = emitExternals(graph.externals);
  if (ext) lines.push(ext);
  lines.push('const __cache = {};');
  lines.push(emitRegistry(graph.modules, 0));
  lines.push(LOADER);
  lines.push(emitPreloads(graph.order, 0));
  if (entryExports.length > 0) {
    const destructured = entryExports.map((n) => (n === 'default' ? 'default: __entryDefault' : n));
    const reexported = entryExports.map((n) => (n === 'default' ? '__entryDefault as default' : n));
    lines.push(`const __entry = __load(${JSON.stringify(entryId)});`);
    lines.push(`const { ${destructured.join(', ')} } = __entry;`);
    lines.push(`export { ${reexported.join(', ')} };`);
  }
  lines.push(...graph.externalReexports);
  return lines.join('\n');
}
