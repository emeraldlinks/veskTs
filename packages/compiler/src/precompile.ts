import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { setVskHydrate } from '@vesk/compiler/src/server-utils';
import { buildComponentEntries } from '@vesk/compiler/src/server-jsgen';
import { transformTopLevelForActions } from '@vesk/compiler/src/actions';
import { collectVskImportPaths, collectVskReexportPaths } from '@vesk/compiler/src/vsk-imports';
import { inlineMdImportsFrom, guessProjectRoots } from '@vesk/compiler/src/md-inline';
import {
  collectModuleBundle,
  type ModuleCollector,
} from '@vesk/compiler/src/module-imports';
import type {
  PrecompileFilePlan,
  PrecompileSubFilePlan,
  PrecompiledComponentEntry,
} from '@vesk/compiler/src/precompile-runtime';
import { irToJSON } from '@vesk/compiler/src/precompile-runtime';

/**
 * Precompiles one `.vsk` file into a `PrecompileFilePlan` at BUILD time.
 *
 * This is the AOT counterpart of `compileFileInternal`: it fully compiles the
 * file — component function sources, top-level statements (`defineAction`
 * ids baked in), module bundle (closures preserved by bundling, not source
 * paths), full IR — so a serverless function can rebuild the exact
 * `CompileFileResult` at load time with `hydratePrecompile`, with no disk
 * access and no `.vsk` source embedded in the deployment.
 */
export function precompileFile(source: string, sourcePath?: string): PrecompileFilePlan {
  if (sourcePath === undefined) return precompileFileInternal(source, sourcePath, new Set());
  const hit = precompileCache.get(sourcePath);
  // Compare the source, not just the path: the dev server rebuilds in-process
  // and a stale plan would silently ship yesterday's component.
  if (hit !== undefined && hit.source === source) return hit.plan;
  const plan = precompileFileInternal(source, sourcePath, new Set());
  // Bound it: plans are sizeable on a large app, and a watch session can
  // outlive many builds.
  if (precompileCache.size >= 512) precompileCache.clear();
  precompileCache.set(sourcePath, { source, plan });
  return plan;
}

/**
 * Compiled plans, keyed by absolute path.
 *
 * Every generated SSR function precompiles its own page, its layout chain, its
 * error boundary and every shared component it pulls in, so a build compiled
 * the same `layout.vsk` once per route and each shared `components/*.vsk` once
 * per route that used it — 25x the root layout and 28x a shared counter on the
 * 28-route test-app, i.e. work growing as routes x shared files. The plan is a
 * pure function of (source, path) and callers only JSON.stringify it into the
 * generated function, so one compile per file per build is enough.
 */
const precompileCache = new Map<string, { source: string; plan: PrecompileFilePlan }>();

/** Drop the plan cache (tests, and any caller that compiles outside a build). */
export function clearPrecompileCache(): void {
  precompileCache.clear();
}

function precompileFileInternal(
  source: string,
  sourcePath: string | undefined,
  seenImportFiles: Set<string>
): PrecompileFilePlan {
  if (sourcePath) {
    const dir = dirname(sourcePath);
    source = inlineMdImportsFrom(source, sourcePath, guessProjectRoots(dir));
  }
  const ast = parse(source, sourcePath ? { filename: sourcePath } : {});
  const ir = generateIR(ast, source, sourcePath);

  // `buildComponentEntries` consults `__vskHydrate` while generating the
  // server component bodies; today's request-time `compileFile` ran under
  // `setVskHydrate(true)`, so the build-time compile must match.
  setVskHydrate(true);
  let components: PrecompiledComponentEntry[] = [];
  try {
    components = buildComponentEntries(ir).map((e) => ({
      name: e.name,
      source: e.source,
      isAsync: e.isAsync,
    }));
  } finally {
    setVskHydrate(false);
  }

  const topLevelCode = transformTopLevelForActions(ir.topLevelCode, 'server');
  const runtimeImports = ir.imports.slice();

  const collector: ModuleCollector = { keysByAbs: new Map(), modules: [] };
  const bindings =
    sourcePath !== undefined ? collectModuleBundle(ir.imports, dirname(sourcePath), collector) : [];

  const subFiles: PrecompileSubFilePlan[] = [];
  if (sourcePath !== undefined) {
    const vskPaths = [
      ...collectVskImportPaths(ir.imports, sourcePath),
      ...collectVskReexportPaths(ir.reexportSources, sourcePath),
    ];
    for (const importPath of vskPaths) {
      if (seenImportFiles.has(importPath)) continue;
      seenImportFiles.add(importPath);
      try {
        const importedSrc = readFileSync(importPath, 'utf-8');
        const subPlan = precompileFileInternal(importedSrc, importPath, seenImportFiles);
        subFiles.push({ importPath, plan: subPlan });
      } catch {
        // skip unresolvable imports — identical to compileFileInternal
      }
    }
  }

  return {
    ir: irToJSON(ir),
    runtimeImports,
    components,
    modules: collector.modules,
    bindings,
    topLevelCode,
    subFiles,
  };
}