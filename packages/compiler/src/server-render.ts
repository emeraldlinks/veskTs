import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { IRRoot, ComponentIR, IRNode } from '@vesk/compiler/src/ir';
import { MapRegion } from '@vesk/compiler/src/ir';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { compileClient, isStaticIR } from '@vesk/compiler/src/client-codegen';
import type { CompileFileResult, RenderPageResult, SSGResult, FullPageOptions, DataScriptPayload, ExternalDataScript } from '@vesk/compiler/src/types';
import {
  isStatic, prettifyHtml, resetVskState,
  loadRuntimeImports, evalTopLevelCode,
  callStaticProps, callLoadFunction,
  securityHeaders, securityComment,
  safeJsonForScript, quoteAttr,
} from '@vesk/compiler/src/server-utils';
import { renderHeadHtml, mergeHeadHtml } from '@vesk/compiler/src/server-head';
import { buildComponentMap } from '@vesk/compiler/src/server-jsgen';
import { transformTopLevelForActions } from '@vesk/compiler/src/actions';
import { collectVskImportPaths } from '@vesk/compiler/src/vsk-imports';
import { inlineMdImportsFrom, guessProjectRoots } from '@vesk/compiler/src/md-inline';
import { withSsrStore, ssrSink } from '@vesk/compiler/src/ssr-store';
import { applyLocalModuleImports } from '@vesk/compiler/src/module-imports';

type ScopedFn = Function & { __veskScope?: Record<string, unknown> };

// Registry-hoisted sub components are invoked with the caller's `__vesk`,
// but each component's scope declaration destructures its DEFINING file's
// top-level bindings. When two `.vsk` files declare the same top-level name
// (e.g. both define `const stages`), the hoist-first-wins merge below would
// hand every component the wrong file's value. Attaching the defining scope
// lets every call site prefer the callee's own bindings.
function scopedVesk(fn: Function, fallback: Record<string, unknown>): Record<string, unknown> {
  return (fn as ScopedFn).__veskScope || fallback;
}


export function compileFile(source: string, options?: { sourcePath?: string }): CompileFileResult {
  return compileFileInternal(source, options?.sourcePath, new Set());
}

function compileFileInternal(source: string, sourcePath: string | undefined, seenImportFiles: Set<string>): CompileFileResult {
  if (sourcePath) {
    const dir = dirname(sourcePath);
    source = inlineMdImportsFrom(source, sourcePath, guessProjectRoots(dir));
  }
  const ast = parse(source, sourcePath ? { filename: sourcePath } : {});
  const ir = generateIR(ast, source, sourcePath);
  const componentMap = buildComponentMap(ir, true);
  const ownComponentNames = ir.components.map((c) => c.name);
  const __vesk = loadRuntimeImports(ir.imports);
  applyLocalModuleImports(__vesk, ir.imports, sourcePath);
  if (sourcePath) {
    for (const importPath of collectVskImportPaths(ir.imports, sourcePath)) {
      if (seenImportFiles.has(importPath)) continue;
      seenImportFiles.add(importPath);
      // Only truly unresolvable imports are skipped. A `.vsk` file that EXISTS
      // but fails to compile must surface its error — silently dropping it here
      // corrupts the component registry (the caller later crashes on
      // `undefined.__veskScope` with no pointer back to the real cause).
      let importedSrc: string;
      try {
        importedSrc = readFileSync(importPath, 'utf-8');
      } catch {
        continue;
      }
      const sub = compileFileInternal(importedSrc, importPath, seenImportFiles);
      for (const [name, fn] of sub.componentMap) {
        if (!componentMap.has(name)) componentMap.set(name, fn);
      }
      // Hoist the sub-`.vsk`'s scope into this file's so that
      // registry-hoisted sub components (called with this `__vesk`) can
      // destructure runtime imports, module values and top-level helpers.
      for (const key of Object.keys(sub.__vesk)) {
        if (key in __vesk) continue;
        __vesk[key] = sub.__vesk[key];
      }
    }
  }
  evalTopLevelCode(transformTopLevelForActions(ir.topLevelCode, 'server'), __vesk);
  // Sub-file components arrive pre-scoped from the recursive call below;
  // scope the remaining (own) components to this file's bindings.
  for (const name of ownComponentNames) {
    const fn = componentMap.get(name) as ScopedFn | undefined;
    if (fn && !fn.__veskScope) fn.__veskScope = __vesk;
  }
  return { ir, componentMap, __vesk };
}

export function render(
  source: string,
  componentName: string,
  props: Record<string, unknown> = {},
  registry: Map<string, Function> = new Map(),
  options: Record<string, unknown> = {}
): string | Promise<string> {
  resetVskState(!!options.hydrate, options.markerless !== false);
  const compiled = compileFile(source, { sourcePath: (options.sourcePath as string) || undefined });
  const componentMap = compiled.componentMap;
  const renderFn = componentMap.get(componentName);
  if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);
  const fullRegistry = new Map([...registry, ...componentMap]);
  const __vesk = (options.__vesk as Record<string, unknown>) || compiled.__vesk;
  const targetComp = compiled.ir.components.find((c) => c.name === componentName);
  const isAsyncComp = !!(targetComp && (targetComp.isAsync || targetComp.ssrAwait));

  (globalThis as any).__vsk_ssr = true;
  if (!(globalThis as any).__vsk_ssr_token) (globalThis as any).__vsk_ssr_token = Math.random().toString(36).slice(2);
  const renderToken = (globalThis as any).__vsk_ssr_token;
  if (isAsyncComp) {
    return withSsrStore(() => (async () => {
      let bodyHtml: string;
      try {
        bodyHtml = await renderFn(props, fullRegistry, scopedVesk(renderFn, __vesk));
      } finally {
        delete (globalThis as any).__vsk_ssr;
        await settleSsrPromises(renderToken);
        clearSsrCells(renderToken);
      }
      return bodyHtml;
    })());
  }
  let bodyHtml: unknown;
  try {
    bodyHtml = withSsrStore(() => renderFn(props, fullRegistry, scopedVesk(renderFn, __vesk)));
  } finally {
    delete (globalThis as any).__vsk_ssr;
    clearSsrCells(renderToken);
  }
  return bodyHtml as string;
}

export function renderPage(
  source: string,
  componentName: string,
  props: Record<string, unknown> = {},
  registry: Map<string, Function> = new Map(),
  options: Record<string, unknown> = {}
): RenderPageResult | Promise<RenderPageResult> {
  resetVskState(!!options.hydrate, options.markerless !== false);
  let __vesk: Record<string, unknown>, componentMap: Map<string, Function>, ir: IRRoot;
  if (options.cached) {
    const cached = options.cached as CompileFileResult;
    ir = cached.ir;
    componentMap = cached.componentMap;
    __vesk = cached.__vesk;
  } else {
    const compiled = compileFile(source, { sourcePath: (options.sourcePath as string) || undefined });
    ir = compiled.ir;
    componentMap = compiled.componentMap;
    __vesk = compiled.__vesk;
  }

  const renderFn = componentMap.get(componentName);
  if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);
  const fullRegistry = new Map([...registry, ...componentMap]);
  const targetComp = ir.components.find((c) => c.name === componentName);

  const doRender = (ssrProps: Record<string, unknown>): RenderPageResult | Promise<RenderPageResult> => {
    (globalThis as any).__vsk_ssr = true;
    // Reuse an in-flight render token: the generated adapter handler renders
    // page -> layouts -> document sequentially within one request, and all of
    // them must share a single data slot so the final renderFullPage merge can
    // serialize the whole handoff. Only create when no render began yet.
    if (!(globalThis as any).__vsk_ssr_token) (globalThis as any).__vsk_ssr_token = Math.random().toString(36).slice(2);
    const renderToken = (globalThis as any).__vsk_ssr_token;
    pruneSsrDataSlots();
    if (targetComp && (targetComp.isAsync || targetComp.ssrAwait)) {
      return withSsrStore(() => (async () => {
        let bodyHtml: string;
        try {
          bodyHtml = await renderFn(ssrProps, fullRegistry, scopedVesk(renderFn, __vesk));
        } finally {
          delete (globalThis as any).__vsk_ssr;
          // Settle before cleanup: the fetch resolution callbacks write the
          // SSR data (flat + per-token slot), and without this the promises
          // were deleted by clearSsrCells before they ever resolved — the
          // handoff came back empty and hydration claimed stale SSR nodes.
          await settleSsrPromises(renderToken);
          clearSsrCells(renderToken);
        }
        return {
          body: bodyHtml,
          head: renderHeadHtml(targetComp, ssrProps),
          props: ssrProps
        };
      })());
    }
    let bodyHtml: unknown;
    try {
      bodyHtml = withSsrStore(() => renderFn(ssrProps, fullRegistry, scopedVesk(renderFn, __vesk)));
    } finally {
      delete (globalThis as any).__vsk_ssr;
    }
    const headHtml = targetComp ? renderHeadHtml(targetComp, ssrProps) : '';
    const pending = (globalThis as any)[`__vsk_ssr_promises_${renderToken}`];
    if (pending && pending.length > 0) {
      // A sync component still started server resources (useFetch): settle them
      // before returning so the handoff serializes real data, not loading state.
      return withSsrStore(() => (async () => {
        await settleSsrPromises(renderToken);
        clearSsrCells(renderToken);
        return { body: bodyHtml as string, head: headHtml, props: ssrProps };
      })());
    }
    clearSsrCells(renderToken);
    return { body: bodyHtml as string, head: headHtml, props: ssrProps };
  };

  if (ir.loadFn) {
    const loadFn = ir.loadFn;
    return withSsrStore(() => (async () => {
      const loadResult = await callLoadFunction(loadFn, props, __vesk);
      let ssrProps = { ...props };
      if (loadResult && typeof loadResult === 'object') {
        const result = loadResult as Record<string, unknown>;
        if (result.props) ssrProps = { ...ssrProps, ...(result.props as Record<string, unknown>) };
        else ssrProps = { ...ssrProps, ...result };
      }
      return doRender(ssrProps);
    })());
  }
  return withSsrStore(() => doRender(props));
}

function clearSsrCells(token: string | undefined): void {
  if (!token) return;
  delete (globalThis as any)[`__vsk_ssr_promises_${token}`];
  delete (globalThis as any)[`__vsk_ssr_failures_${token}`];
  const cells = (globalThis as any).__vsk_ssr_cells;
  if (!cells || !(cells instanceof Map)) return;
  for (const k of cells.keys()) {
    if (typeof k === 'string' && k.startsWith(token)) cells.delete(k);
  }
}

/**
 * Await every server resource promise registered under a render token. The
 * fetch callbacks call setSsrData (flat + per-token slot) once they resolve,
 * so a render MUST settle before cleanup or its handoff serializes nothing.
 */
async function settleSsrPromises(token: string | undefined): Promise<void> {
  if (!token) return;
  const pending = (globalThis as any)[`__vsk_ssr_promises_${token}`];
  if (!pending || pending.length === 0) return;
  await Promise.allSettled(pending);
}

/**
 * Bound the per-token SSR data slots against abandonment (dev-partial
 * renderPage / render() that never runs renderFullPage). Slots are keyed by
 * Math.random tokens, so deleted-slot accounting by token can't be cleaned by
 * an owning render; cap the map instead. RenderFullPage/RenderPageStream delete
 * their own slot + token in every path, so this only guards the untracked ones.
 */
function pruneSsrDataSlots(): void {
  const g = globalThis as any;
  const keys = Object.keys(g).filter((k) => typeof k === 'string' && k.startsWith('__vsk_ssr_data_'));
  if (keys.length <= 40) return;
  keys.sort().slice(0, keys.length - 40).forEach((k) => {
    delete g[k];
  });
}

type RenderPluginLike = import('@vesk/types').VeskPlugin;

interface HeadInjectOptions {
  plugins?: RenderPluginLike[];
  headExtra?: string;
}

/**
 * Run the active plugins' `onHead` hooks (config order) against an assembled
 * `<head>` string. A hook returns the new head, or `null` to keep the input.
 */
export async function applyHeadPlugins(
  headHtml: string,
  plugins: RenderPluginLike[] | undefined | null,
  ctx?: import('@vesk/types').RenderPluginContext
): Promise<string> {
  if (!plugins || plugins.length === 0) return headHtml;
  let out = headHtml;
  for (const plugin of plugins) {
    if (typeof plugin.onHead === 'function') {
      const result = await plugin.onHead(out, ctx);
      if (typeof result === 'string') out = result;
    }
  }
  return out;
}

/**
 * Run the active plugins' `onHtml` hooks (config order) against a finalized
 * full HTML document. Only valid for non-streamed documents.
 */
export async function applyHtmlPlugins(
  html: string,
  plugins: RenderPluginLike[] | undefined | null,
  ctx?: import('@vesk/types').RenderPluginContext
): Promise<string> {
  if (!plugins || plugins.length === 0) return html;
  let out = html;
  for (const plugin of plugins) {
    if (typeof plugin.onHtml === 'function') {
      const result = await plugin.onHtml(out, ctx);
      if (typeof result === 'string') out = result;
    }
  }
  return out;
}

/**
 * Resolve head integration for a render call: live `onHead` hooks when plugin
 * objects are available (dev / build / SSG), otherwise merge the baked
 * `headExtra` (prod path — page head wins over baked extras via mergeHeadHtml).
 */
export async function applyHeadInjects(
  headHtml: string,
  options: HeadInjectOptions,
  ctx?: import('@vesk/types').RenderPluginContext
): Promise<string> {
  if (options.plugins && options.plugins.length > 0) {
    return applyHeadPlugins(headHtml, options.plugins, ctx);
  }
  if (options.headExtra) {
    return mergeHeadHtml(headHtml, options.headExtra).html;
  }
  return headHtml;
}

export async function ssg(
  source: string,
  componentName?: string,
  customProps?: Record<string, unknown>,
  options: { registry?: Map<string, Function>; cssUrl?: string; cssUrls?: string[]; sourcePath?: string; [key: string]: unknown } = {}
): Promise<SSGResult> {
  const ast = parse(source, options.sourcePath ? { filename: options.sourcePath as string } : {});
  const ir = generateIR(ast, source, options.sourcePath as string | undefined);

  if (!componentName) {
    const defaultComp = ir.components.find((c) => c.defaultExport);
    const exportedComp = ir.components.find((c) => c.exported);
    componentName = defaultComp?.name || exportedComp?.name || (ir.components.length > 0 ? ir.components[0].name : undefined);
  }
  if (!componentName) throw new Error('No component found in source for SSG');

  let props: Record<string, unknown> | undefined = customProps;
  if (props === undefined && ir.staticProps) {
    const staticResult = await callStaticProps(ir.staticProps);
    if (staticResult && typeof staticResult === 'object') {
      props = staticResult as Record<string, unknown>;
    }
  }
  if (!props) props = {};

  const needsClient = ir.components.some((c) => {
    if (c.isClient) return true;
    if (c.style) return true;
    return !isStatic(c.body);
  });

  const rendered = await renderPage(source, componentName, props, options.registry || new Map(), { hydrate: needsClient, markerless: options.markerless !== false });
  const bodyHtml = rendered.body;
  const headHtml = rendered.head;

  const clientCode = needsClient
    ? compileClient(source, null, { hydrate: true, markerless: options.markerless !== false })
    : '';

  const serializedProps = safeJsonForScript(JSON.stringify(props));
  const hasClient = clientCode.length > 0;

  const scriptBlock = hasClient
    ? `\n<script>const __vesk_props = ${serializedProps};\n<\/script>\n<script>${clientCode}</script>\n`
    : `\n<script>const __vesk_props = ${serializedProps};\n<\/script>\n`;

  const cssUrls: string[] = options.cssUrls || (options.cssUrl ? [options.cssUrl] : []);
  const cssLink = cssUrls.map(u => `\t<link rel="stylesheet" href="${u}" />\n`).join('');

  const renderCtx: import('@vesk/types').RenderPluginContext = { sourcePath: options.sourcePath as string | undefined };
  const baseHeadParts: string[] = [];
  const lowerHead = (headHtml || '').toLowerCase();
  if (!lowerHead.includes('charset')) baseHeadParts.push('\t<meta charset="utf-8" />');
  if (!lowerHead.includes('viewport')) baseHeadParts.push('\t<meta name="viewport" content="width=device-width, initial-scale=1" />');
  let finalHead = baseHeadParts.join('\n');
  if (cssLink) finalHead += (finalHead ? '\n' : '') + cssLink.trimEnd();
  if (headHtml) finalHead += (finalHead ? '\n' : '') + headHtml.split('\n').map((l) => '\t' + l).join('\n');
  finalHead = await applyHeadInjects(
    finalHead,
    { plugins: options.plugins as RenderPluginLike[] | undefined, headExtra: options.headExtra as string | undefined },
    renderCtx
  );

  const html = `<!DOCTYPE html>
<html>
<head>
${finalHead}
</head>
<body>
${bodyHtml}${scriptBlock}</body>
</html>
`;
  const finalHtml = await applyHtmlPlugins(html, options.plugins as RenderPluginLike[] | undefined, renderCtx);

  const staticLists = ir.components.some((c) => {
    return c.body.some((node) => {
      if (node instanceof MapRegion) return isStaticIR(node.bodyTemplate) && isStaticIR(node.alternateNodes);
      return false;
    });
  });

  return { html: finalHtml, body: bodyHtml, head: headHtml, props: serializedProps, clientCode, static: !hasClient, staticLists };
}

export function buildDataScripts(
  ssrProps: Record<string, unknown> | null | undefined,
  ssrData: Record<string, unknown>,
  external?: ExternalDataScript | null
): string[] {
  const meaningfulKeys =
    ssrProps !== undefined && ssrProps !== null
      ? Object.keys(ssrProps).filter((k) => k !== 'children' && k !== 'params')
      : [];
  const hasProps = meaningfulKeys.length > 0;
  const hasData = Object.keys(ssrData).length > 0;
  if (!hasProps && !hasData) return [];
  const payload: DataScriptPayload = {};
  if (hasProps) {
    const cleanProps: Record<string, unknown> = {};
    for (const k of meaningfulKeys) cleanProps[k] = (ssrProps as Record<string, unknown>)[k];
    payload.props = cleanProps;
  }
  if (hasData) payload.ssrData = ssrData;
  if (external) {
    const src = external(payload);
    if (src) return [`\t<script src="${src}"></script>`];
  }
  const scripts: string[] = [];
  if (hasProps) scripts.push(`\t<script>const __vesk_props = ${safeJsonForScript(JSON.stringify(payload.props))};</script>`);
  if (hasData) scripts.push(`\t<script>globalThis.__vsk_ssr_data = ${safeJsonForScript(JSON.stringify(ssrData))};</script>`);
  return scripts;
}

export async function renderFullPage(
  source: string,
  componentName: string,
  props: Record<string, unknown> = {},
  registry: Map<string, Function> = new Map(),
  options: FullPageOptions = {}
): Promise<string> {
  return withSsrStore(async () => {
  (globalThis as any).__vsk_ssr = true;
  // Reuse the request token when a page/layout render already started one (the
  // generated adapter handler renders page -> layouts -> document within one
  // process), otherwise start fresh. One request = one token = one data slot.
  if (!(globalThis as any).__vsk_ssr_token) (globalThis as any).__vsk_ssr_token = Math.random().toString(36).slice(2);
  const renderToken = (globalThis as any).__vsk_ssr_token;
  pruneSsrDataSlots();
  // Start this render's handoff store fresh: setSsrData mirrors into
  // globalThis.__vsk_ssr_data (see resource.ts) because the AsyncLocalStorage
  // sink snapshot can be empty when the write runs in a forked async context.
  // Resetting here also gives the /about-after-/posts no-leak behavior the
  // ALS isolation was introduced to fix.
  (globalThis as any).__vsk_ssr_data = {};
  try {
    let ssrProps = { ...props };
    let serializedProps: string | null = null;
    const cached = (options.cached as CompileFileResult | undefined) || undefined;
    const ir = cached ? cached.ir : generateIR(parse(source, options.sourcePath ? { filename: options.sourcePath as string } : {}), source, options.sourcePath as string | undefined);
    if (ir.loadFn) {
      const __vesk = options.__vesk || cached?.__vesk || loadRuntimeImports(ir.imports);
      const loadResult = await callLoadFunction(ir.loadFn, ssrProps, __vesk);
      if (loadResult && typeof loadResult === 'object') {
        const result = loadResult as Record<string, unknown>;
        if (result.props) ssrProps = { ...ssrProps, ...(result.props as Record<string, unknown>) };
        else ssrProps = { ...ssrProps, ...result };
      }
      serializedProps = JSON.stringify(ssrProps);
    }
    const rendered = await renderPage(source, componentName, ssrProps, registry, { ...options, __vesk: options.__vesk }) as RenderPageResult;

    // Defensive settle: page/layout renders already awaited their own SSR
    // promises before cleanup; this covers any resource started here (loadFn).
    await settleSsrPromises(renderToken);

    // Merge the ALS sink snapshot with the request's per-token data slot. The
    // slot is the deterministic channel for writes that happened in a forked
    // async context (native fetch) — the sink alone can miss them. The slot is
    // request-scoped (deleted below), so a late write can never leak into a
    // following request the way the flat global would.
    const slot = ((globalThis as any)[`__vsk_ssr_data_${renderToken}`] as Record<string, unknown>) || {};
    const ssrData: Record<string, unknown> = {
      ...ssrSink.snapshot(),
      ...slot,
    };
    if (process.env.VESK_SSR_TRACE) {
      console.error(`[render-trace] renderFullPage comp=${componentName} keys=${Object.keys(ssrData).join(',') || '∅'} slot=${Object.keys(slot).join(',') || '∅'} sink=${Object.keys(ssrSink.snapshot()).join(',') || '∅'}`);
    }

    let headHtml = rendered.head;
    if (options.pageHead) {
      const merged = mergeHeadHtml(options.pageHead, rendered.head);
      headHtml = merged.html;
      if (merged.conflicts.length > 0) {
        for (const c of merged.conflicts) {
          console.error(`vesk head conflict: ${c.message}`);
        }
      }
    }

    const bodyHtml = prettifyHtml(rendered.body);
    const cssUrls: string[] = options.cssUrls || (options.cssUrl ? [options.cssUrl] : []);
    const cssLink = cssUrls.map(u => `\t<link rel="stylesheet" href="${u}" />\n`).join('');
    const clientScript = options.clientScriptUrl
      ? `\t<script type="module" src="${options.clientScriptUrl}"></script>\n`
      : '';

    const dataScripts = buildDataScripts(ssrProps, ssrData, options.externalDataScript);
    const dataScriptBlock = dataScripts.length > 0 ? '\n' + dataScripts.join('\n') + '\n' : '';

    const lowerHeadFull = (headHtml || '').toLowerCase();
    const headLines: string[] = [];
    if (!lowerHeadFull.includes('charset')) headLines.push('\t<meta charset="utf-8" />');
    if (!lowerHeadFull.includes('viewport')) headLines.push('\t<meta name="viewport" content="width=device-width, initial-scale=1" />');
    if (cssLink) headLines.push(cssLink.trimEnd());
    if (headHtml) headLines.push('\t' + headHtml.split('\n').join('\n\t'));

    if (options.security) {
      const sec = options.security;
      if (sec.referrerPolicy !== false) headLines.push(`\t<meta name="referrer" content="${quoteAttr(sec.referrerPolicy || 'strict-origin-when-cross-origin')}" />`);
      if (sec.contentSecurityPolicy !== false) headLines.push(`\t<meta http-equiv="Content-Security-Policy" content="${quoteAttr(sec.contentSecurityPolicy as string || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'")}" />`);
      if (sec.autoEscape !== false) headLines.push(`\t<!-- vesk: auto-escape enabled -->`);
    }

    const finalHead = await applyHeadInjects(
      headLines.join('\n'),
      { plugins: options.plugins, headExtra: options.headExtra },
      { sourcePath: options.sourcePath, url: (options.__vesk?.url as string) || undefined }
    );

    const docHtml = `<!DOCTYPE html>
<html>
<head>
${finalHead}</head>
<body>
<div id="root">
${bodyHtml}
</div>
${dataScriptBlock}${clientScript}</body>
</html>`;
    return applyHtmlPlugins(docHtml, options.plugins, { sourcePath: options.sourcePath, url: (options.__vesk?.url as string) || undefined });
  } finally {
    delete (globalThis as any).__vsk_ssr;
    delete (globalThis as any)[`__vsk_ssr_data_${renderToken}`];
    delete (globalThis as any).__vsk_ssr_token;
    pruneSsrDataSlots();
  }
  });
}

export function renderPageStream(
  source: string,
  componentName: string,
  props: Record<string, unknown> = {},
  registry: Map<string, Function> = new Map(),
  options: FullPageOptions = {}
): AsyncGenerator<string> {
  async function* raw(): AsyncGenerator<string> {
  const cached = (options.cached as CompileFileResult | undefined) || undefined;
  const ir = cached ? cached.ir : generateIR(parse(source, options.sourcePath ? { filename: options.sourcePath as string } : {}), source, options.sourcePath as string | undefined);

  let ssrProps = { ...props };
  let serializedProps: string | null = null;
  let __vesk = options.__vesk || cached?.__vesk || null;
  if (!__vesk) {
    __vesk = loadRuntimeImports(ir.imports);
    applyLocalModuleImports(__vesk, ir.imports, (options.sourcePath as string) || undefined);
  }

  if (ir.loadFn) {
    const loadResult = await callLoadFunction(ir.loadFn, props, __vesk);
    if (loadResult && typeof loadResult === 'object') {
      const result = loadResult as Record<string, unknown>;
      if (result.props) ssrProps = { ...ssrProps, ...(result.props as Record<string, unknown>) };
      else ssrProps = { ...ssrProps, ...result };
    }
    serializedProps = JSON.stringify(ssrProps);
  }

  const componentMap = cached ? cached.componentMap : compileFile(source, { sourcePath: (options.sourcePath as string) || undefined }).componentMap;
  const fullRegistry = new Map([...registry, ...componentMap]);
  const renderFn = componentMap.get(componentName);
  if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);

  resetVskState(!!options.hydrate, options.markerless !== false);

  const targetComp = ir.components.find((c) => c.name === componentName);
  const cssUrls: string[] = options.cssUrls || (options.cssUrl ? [options.cssUrl] : []);
  const cssLink = cssUrls.map(u => `\t<link rel="stylesheet" href="${u}" />\n`).join('');

  const headParts: string[] = [];
  if (cssLink) headParts.push(cssLink.trimEnd());
  if (options.security) {
    const sec = options.security;
    if (sec.referrerPolicy !== false) headParts.push(`\t<meta name="referrer" content="${quoteAttr(sec.referrerPolicy || 'strict-origin-when-cross-origin')}" />`);
    if (sec.contentSecurityPolicy !== false) headParts.push(`\t<meta http-equiv="Content-Security-Policy" content="${quoteAttr(sec.contentSecurityPolicy as string || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'")}" />`);
    if (sec.autoEscape !== false) headParts.push('\t<!-- vesk: auto-escape enabled -->');
  }
  let streamHeadHtml: string | null = null;
  if (targetComp) {
    let headHtml = renderHeadHtml(targetComp, ssrProps);
    if (options.pageHead) {
      const merged = mergeHeadHtml(options.pageHead, headHtml);
      headHtml = merged.html;
      if (merged.conflicts.length > 0) {
        for (const c of merged.conflicts) {
          console.error(`vesk head conflict: ${c.message}`);
        }
      }
    }
    if (headHtml) {
      streamHeadHtml = headHtml;
      headParts.push('\t' + headHtml.split('\n').join('\n\t'));
    }
  }
  const lowerStreamHead = (streamHeadHtml || '').toLowerCase();
  const baseStream: string[] = [];
  if (!lowerStreamHead.includes('charset')) baseStream.push('\t<meta charset="utf-8" />');
  if (!lowerStreamHead.includes('viewport')) baseStream.push('\t<meta name="viewport" content="width=device-width, initial-scale=1" />');
  headParts.unshift(...baseStream);

  yield '<!DOCTYPE html>\n<html>\n<head>\n';
  const finalHead = await applyHeadInjects(
    headParts.join('\n'),
    { plugins: options.plugins, headExtra: options.headExtra },
    { sourcePath: options.sourcePath, url: (options.__vesk?.url as string) || undefined }
  );
  yield finalHead + '\n';
  yield '</head>\n<body>\n<div id="root">\n';

  (globalThis as any).__vsk_ssr = true;
  // Fresh handoff store per render; see renderFullPage note.
  (globalThis as any).__vsk_ssr_data = {};
  if (!(globalThis as any).__vsk_ssr_token) (globalThis as any).__vsk_ssr_token = Math.random().toString(36).slice(2);
  const renderToken = (globalThis as any).__vsk_ssr_token;
  pruneSsrDataSlots();
  let bodyHtml: string;
  try {
    bodyHtml = await Promise.resolve(renderFn(ssrProps, fullRegistry, scopedVesk(renderFn, __vesk)));
  } finally {
    delete (globalThis as any).__vsk_ssr;
    await settleSsrPromises(renderToken);
    clearSsrCells(renderToken);
  }

  yield bodyHtml;

  const slot = ((globalThis as any)[`__vsk_ssr_data_${renderToken}`] as Record<string, unknown>) || {};
  const ssrData: Record<string, unknown> = {
    ...ssrSink.snapshot(),
    ...slot,
  };
  if (process.env.VESK_SSR_TRACE) {
    console.error(`[render-trace] renderPageStream comp=${componentName} keys=${Object.keys(ssrData).join(',') || '∅'} slot=${Object.keys(slot).join(',') || '∅'} sink=${Object.keys(ssrSink.snapshot()).join(',') || '∅'}`);
  }
  delete (globalThis as any)[`__vsk_ssr_data_${renderToken}`];
  delete (globalThis as any).__vsk_ssr_token;
  pruneSsrDataSlots();

  const dataScripts = buildDataScripts(ssrProps, ssrData, options.externalDataScript);
  const dataScriptBlock = dataScripts.length > 0 ? '\n' + dataScripts.join('\n') : '';
  // Mirror renderFullPage: a full document must carry the client bundle or
  // the page can never hydrate (dev-server streams hit this path).
  const clientScript = options.clientScriptUrl
    ? `\t<script type="module" src="${options.clientScriptUrl}"></script>\n`
    : '';
  yield `\n</div>${dataScriptBlock}${clientScript}</body>\n</html>\n`;
  }

  const gen = raw();
  async function* scoped(): AsyncGenerator<string> {
    let result: IteratorResult<string, void>;
    do {
      result = (await withSsrStore(() => gen.next())) as IteratorResult<string, void>;
      if (!result.done) yield result.value;
    } while (!result.done);
  }
  return scoped();
}
