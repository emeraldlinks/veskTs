import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { CompileFileResult } from '@vesk/compiler/src/types';
import {
  Expression,
  IRRoot,
  ComponentIR,
  StaticNode,
  TextNode,
  DynamicBinding,
  OpaqueDynamicRegion,
  MapRegion,
  ComponentRef,
  ComponentCall,
  SlotNode,
  WhileLoop,
  SwitchCase,
  SwitchBlock,
  TryCatch,
  TrackDecl,
  RuntimeStatement,
  ForLoop,
  ServerBlock,
  ClientBlock,
  HeadBlock,
} from '@vesk/compiler/src/ir';
import { loadRuntimeImports, evalTopLevelCode } from '@vesk/compiler/src/server-utils';
import type { BundledModuleData, ModuleBindingData } from '@vesk/compiler/src/module-imports';

type ScopedFn = Function & { __veskScope?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// AOT precompile plan shapes.
//
// A plan is the JSON-safe, fully precompiled description of ONE `.vsk` file:
// its compiled-component functional sources, its top-level `defineAction`-
// transformed statements, the module bundle behind its value imports, and
// (for the file a server function renders) its full IR. `.vsk` imports are
// carried as nested `subFiles` plans; hydrate mirrors today's recursive
// `compileFileInternal` merge exactly, keeping per-file scopes intact.
// ---------------------------------------------------------------------------

export interface PrecompiledComponentEntry {
  name: string;
  /** Compiled component body source (`buildComponentMap`-style function code). */
  source: string;
  isAsync: boolean;
}

export type PrecompileBundledModule = BundledModuleData;

export type PrecompileBinding = ModuleBindingData;

export interface PrecompileSubFilePlan {
  importPath: string;
  plan: PrecompileFilePlan;
}

export interface PrecompileFilePlan {
  /** Class-tagged JSON of this file's IRRoot. `null` on non-rendered sub files. */
  ir: unknown | null;
  /** The file's own import lines (for `loadRuntimeImports`). */
  runtimeImports: string[];
  /** This file's own compiled components. */
  components: PrecompiledComponentEntry[];
  /** The module bundle backing this file's local value imports. */
  modules: PrecompileBundledModule[];
  /** local name -> bundled module export. */
  bindings: PrecompileBinding[];
  /** Top-level statements, already `defineAction`-transformed for `server`. */
  topLevelCode: string[];
  /** The file's `.vsk` imports, precompiled recursively. */
  subFiles: PrecompileSubFilePlan[];
}

// ---------------------------------------------------------------------------
// IR serialization.
// ---------------------------------------------------------------------------

const IR_CLASSES: Array<[string, unknown]> = [
  ['Expression', Expression.prototype],
  ['IRRoot', IRRoot.prototype],
  ['ComponentIR', ComponentIR.prototype],
  ['StaticNode', StaticNode.prototype],
  ['TextNode', TextNode.prototype],
  ['DynamicBinding', DynamicBinding.prototype],
  ['OpaqueDynamicRegion', OpaqueDynamicRegion.prototype],
  ['MapRegion', MapRegion.prototype],
  ['ComponentRef', ComponentRef.prototype],
  ['ComponentCall', ComponentCall.prototype],
  ['SlotNode', SlotNode.prototype],
  ['WhileLoop', WhileLoop.prototype],
  ['SwitchCase', SwitchCase.prototype],
  ['SwitchBlock', SwitchBlock.prototype],
  ['TryCatch', TryCatch.prototype],
  ['TrackDecl', TrackDecl.prototype],
  ['RuntimeStatement', RuntimeStatement.prototype],
  ['ForLoop', ForLoop.prototype],
  ['ServerBlock', ServerBlock.prototype],
  ['ClientBlock', ClientBlock.prototype],
  ['HeadBlock', HeadBlock.prototype],
];

const CLASS_PROTOS = new Map(IR_CLASSES) as Map<string, unknown>;
const CLASS_BY_CTOR = new Map<unknown, string>();
for (const [name, proto] of IR_CLASSES) {
  const ctor = (proto as { constructor?: unknown }).constructor;
  if (ctor) CLASS_BY_CTOR.set(ctor, name);
}

/**
 * Recursively JSON-serializes an IR root. IR class instances are tagged with
 * their class name so `irFromJSON` can revive them with their prototypes;
 * `Set` values (IRRoot.importedNames) are tagged too. ESTree node subtrees
 * (Expression.ast / RuntimeStatement.ast) are plain objects and serialize
 * generically — `start`/`end` and `loc` arrays are plain JSON.
 */
export function irToJSON(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) out.push(irToJSON(item));
    return out;
  }
  if (value instanceof Set) {
    return { __vskIrType: 'set', items: irToJSON([...value]) };
  }
  const clsName = CLASS_BY_CTOR.get(value.constructor);
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    data[key] = irToJSON((value as Record<string, unknown>)[key]);
  }
  if (clsName) return { __vskIrType: 'class', name: clsName, data };
  return data;
}

export function irFromJSON(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) out.push(irFromJSON(item));
    return out;
  }
  const asRecord = value as Record<string, unknown>;
  if (typeof asRecord.__vskIrType === 'string') {
    if (asRecord.__vskIrType === 'set') {
      const items = irFromJSON(asRecord.items) as unknown[];
      return new Set(items);
    }
    if (asRecord.__vskIrType === 'class') {
      const proto = CLASS_PROTOS.get(asRecord.name as string);
      const revived = proto ? Object.create(proto) : {};
      const data = irFromJSON(asRecord.data) as Record<string, unknown>;
      for (const key of Object.keys(data)) revived[key] = data[key];
      return revived;
    }
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(asRecord)) {
    out[key] = irFromJSON(asRecord[key]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hydration.
// ---------------------------------------------------------------------------

function hydrateModuleScope(scope: Record<string, unknown>, plan: PrecompileFilePlan): void {
  if (!plan.modules || plan.modules.length === 0) return;
  const byKey = new Map<string, PrecompileBundledModule>();
  for (const m of plan.modules) byKey.set(m.key, m);

  const exportsByKey = new Map<string, Record<string, unknown>>();

  const evaluateModule = (key: string): Record<string, unknown> | null => {
    const existing = exportsByKey.get(key);
    if (existing) return existing;
    const mod = byKey.get(key);
    if (!mod) return null;
    const exportsObj: Record<string, unknown> = {};
    exportsByKey.set(key, exportsObj);
    const moduleObj = { exports: exportsObj };
    const requireShim = (spec: string): unknown => {
      const depKey = mod.deps[spec];
      if (depKey) return evaluateModule(depKey) || {};
      // Bare specifier, builtin, or node_modules dependency — hand it to the
      // real loader (node_modules ships with the serverless deployment).
      try {
        const local = createRequire(join(mod.dir, '__vesk__.js'));
        return local(spec);
      } catch (err) {
        throw new Error(`Cannot resolve '${spec}' required by ${mod.key} during SSR hydrate: ${(err as Error)?.message}`);
      }
    };
    try {
      const body = mod.code ? `'use strict';\n${mod.code}` : "'use strict';";
      const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', body);
      fn(requireShim, moduleObj, moduleObj.exports, mod.dir, join(mod.dir, '__vesk__.js'));
    } catch (err) {
      exportsByKey.delete(key);
      console.warn(
        `[vesk] SSR: failed to evaluate bundled module ${mod.key} (${mod.dir}): ` +
          `${(err as Error)?.message ?? String(err)}`
      );
      return null;
    }
    const finalized =
      moduleObj.exports && moduleObj.exports !== exportsObj
        ? (moduleObj.exports as Record<string, unknown>)
        : exportsObj;
    exportsByKey.set(key, finalized);
    return finalized;
  };

  // Evaluate every bundled module so side-effect imports (`import './x'`)
  // run even when no binding references them. Cycles resolve through the
  // pre-seeded partial exports objects. Dependencies pull themselves in via
  // the require shim, so order across the array does not matter.
  for (const m of plan.modules) {
    if (!exportsByKey.has(m.key)) evaluateModule(m.key);
  }

  for (const binding of plan.bindings) {
    const mod = exportsByKey.get(binding.key);
    if (!mod) continue;
    if (binding.kind === '*') {
      scope[binding.local] = mod;
    } else if (binding.kind === 'default') {
      scope[binding.local] = binding.kind in mod ? mod[binding.kind] : mod;
    } else if (binding.kind in mod) {
      scope[binding.local] = mod[binding.kind];
    }
  }
}

function hydrateFile(plan: PrecompileFilePlan, seen: Set<string>): CompileFileResult {
  const ir = plan.ir ? (irFromJSON(plan.ir) as IRRoot) : new IRRoot([], [], new Set(), null, null, []);
  const __vesk = loadRuntimeImports(plan.runtimeImports || []);
  hydrateModuleScope(__vesk, plan);
  evalTopLevelCode(plan.topLevelCode || [], __vesk);

  const componentMap = new Map<string, Function>();
  for (const entry of plan.components || []) {
    let fn: Function;
    if (entry.isAsync) {
      fn = new Function('props', '__registry', '__vesk', `return (async () => {\n${entry.source}\n})()`);
    } else {
      fn = new Function('props', '__registry', '__vesk', entry.source);
    }
    (fn as ScopedFn).__veskScope = __vesk;
    componentMap.set(entry.name, fn);
  }

  for (const sub of plan.subFiles || []) {
    if (seen.has(sub.importPath)) continue;
    seen.add(sub.importPath);
    const subResult = hydrateFile(sub.plan, seen);
    for (const [name, fn] of subResult.componentMap) {
      if (!componentMap.has(name)) componentMap.set(name, fn);
    }
    for (const key of Object.keys(subResult.__vesk)) {
      if (key in __vesk) continue;
      __vesk[key] = subResult.__vesk[key];
    }
  }

  return { ir, componentMap, __vesk };
}

/**
 * Rebuilds a `CompileFileResult` (ir + componentMap + __vesk) from a
 * `precompile.ts` plan at SSR function load time. No source, no disk, no
 * syntax analysis — the plan is fully compiled at build time.
 */
export function hydratePrecompile(plan: PrecompileFilePlan): CompileFileResult {
  return hydrateFile(plan, new Set());
}