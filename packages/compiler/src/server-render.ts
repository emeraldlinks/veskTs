import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { IRRoot, ComponentIR, IRNode } from '@vesk/compiler/src/ir';
import { MapRegion } from '@vesk/compiler/src/ir';
import { parse } from '@vesk/compiler/src/parser';
import { generateIR } from '@vesk/compiler/src/ir-generator';
import { compileClient, isStaticIR } from '@vesk/compiler/src/client-codegen';
import type { CompileFileResult, RenderPageResult, SSGResult, FullPageOptions } from '@vesk/compiler/src/types';
import {
  isStatic, prettifyHtml, resetVskState,
  loadRuntimeImports, evalTopLevelCode,
  callStaticProps, callLoadFunction,
  securityHeaders, securityComment,
} from '@vesk/compiler/src/server-utils';
import { renderHeadHtml, mergeHeadHtml } from '@vesk/compiler/src/server-head';
import { buildComponentMap } from '@vesk/compiler/src/server-jsgen';
import { transformTopLevelForActions } from '@vesk/compiler/src/actions';
import { collectVskImportPaths } from '@vesk/compiler/src/vsk-imports';


export function compileFile(source: string, options?: { sourcePath?: string }): CompileFileResult {
  return compileFileInternal(source, options?.sourcePath, new Set());
}

function compileFileInternal(source: string, sourcePath: string | undefined, seenImportFiles: Set<string>): CompileFileResult {
  const ast = parse(source);
  const ir = generateIR(ast, source);
  const componentMap = buildComponentMap(ir, true);
  if (sourcePath) {
    for (const importPath of collectVskImportPaths(ir.imports, sourcePath)) {
      if (seenImportFiles.has(importPath)) continue;
      seenImportFiles.add(importPath);
      try {
        const importedSrc = readFileSync(importPath, 'utf-8');
        const sub = compileFileInternal(importedSrc, importPath, seenImportFiles);
        for (const [name, fn] of sub.componentMap) {
          if (!componentMap.has(name)) componentMap.set(name, fn);
        }
      } catch {
        // skip unresolvable imports
      }
    }
  }
  const __vesk = loadRuntimeImports(ir.imports);
  evalTopLevelCode(transformTopLevelForActions(ir.topLevelCode, 'server'), __vesk);
  return { ir, componentMap, __vesk };
}

export function render(
  source: string,
  componentName: string,
  props: Record<string, unknown> = {},
  registry: Map<string, Function> = new Map(),
  options: Record<string, unknown> = {}
): string | Promise<string> {
  resetVskState(!!options.hydrate);
  const compiled = compileFile(source, { sourcePath: (options.sourcePath as string) || undefined });
  const componentMap = compiled.componentMap;
  const renderFn = componentMap.get(componentName);
  if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);
  const fullRegistry = new Map([...registry, ...componentMap]);
  const __vesk = (options.__vesk as Record<string, unknown>) || compiled.__vesk;
  const result = renderFn(props, fullRegistry, __vesk);
  const targetComp = compiled.ir.components.find((c) => c.name === componentName);
  if (targetComp?.isAsync) {
    return (result as Promise<string>).then ? result as Promise<string> : Promise.resolve(result as string);
  }
  return result as string;
}

export function renderPage(
  source: string,
  componentName: string,
  props: Record<string, unknown> = {},
  registry: Map<string, Function> = new Map(),
  options: Record<string, unknown> = {}
): RenderPageResult | Promise<RenderPageResult> {
  resetVskState(!!options.hydrate);
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
    (globalThis as any).__vsk_ssr_token = Math.random().toString(36).slice(2);
    const renderToken = (globalThis as any).__vsk_ssr_token;
    if (targetComp && (targetComp.isAsync || targetComp.ssrAwait)) {
      return (async () => {
        let bodyHtml: string;
        try {
          bodyHtml = await renderFn(ssrProps, fullRegistry, __vesk);
        } finally {
          delete (globalThis as any).__vsk_ssr;
          clearSsrCells(renderToken);
        }
        return {
          body: bodyHtml,
          head: renderHeadHtml(targetComp, ssrProps),
          props: ssrProps
        };
      })();
    }
    let bodyHtml: unknown;
    try {
      bodyHtml = renderFn(ssrProps, fullRegistry, __vesk);
    } finally {
      delete (globalThis as any).__vsk_ssr;
      clearSsrCells(renderToken);
    }
    const headHtml = targetComp ? renderHeadHtml(targetComp, ssrProps) : '';
    return { body: bodyHtml as string, head: headHtml, props: ssrProps };
  };

  if (ir.loadFn) {
    const loadFn = ir.loadFn;
    return (async () => {
      const loadResult = await callLoadFunction(loadFn, props, __vesk);
      let ssrProps = { ...props };
      if (loadResult && typeof loadResult === 'object') {
        const result = loadResult as Record<string, unknown>;
        if (result.props) ssrProps = { ...ssrProps, ...(result.props as Record<string, unknown>) };
        else ssrProps = { ...ssrProps, ...result };
      }
      return doRender(ssrProps);
    })();
  }
  return doRender(props);
}

function clearSsrCells(token: string | undefined): void {
  if (!token) return;
  delete (globalThis as any)[`__vsk_ssr_promises_${token}`];
  const cells = (globalThis as any).__vsk_ssr_cells;
  if (!cells || !(cells instanceof Map)) return;
  for (const k of cells.keys()) {
    if (typeof k === 'string' && k.startsWith(token)) cells.delete(k);
  }
}

export async function ssg(
  source: string,
  componentName?: string,
  customProps?: Record<string, unknown>,
  options: { registry?: Map<string, Function>; cssUrl?: string; cssUrls?: string[]; [key: string]: unknown } = {}
): Promise<SSGResult> {
  const ast = parse(source);
  const ir = generateIR(ast, source);

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

  const rendered = await renderPage(source, componentName, props, options.registry || new Map(), { hydrate: needsClient });
  const bodyHtml = rendered.body;
  const headHtml = rendered.head;

  const clientCode = needsClient
    ? compileClient(source, null, { hydrate: true })
    : '';

  const serializedProps = JSON.stringify(props);
  const hasClient = clientCode.length > 0;

  const scriptBlock = hasClient
    ? `\n<script>const __vesk_props = ${serializedProps};\n<\/script>\n<script>${clientCode}</script>\n`
    : `\n<script>const __vesk_props = ${serializedProps};\n<\/script>\n`;

  const cssUrls: string[] = options.cssUrls || (options.cssUrl ? [options.cssUrl] : []);
  const cssLink = cssUrls.map(u => `\t<link rel="stylesheet" href="${u}" />\n`).join('');
  const html = `<!DOCTYPE html>
<html>
<head>
\t<meta charset="utf-8" />
\t<meta name="viewport" content="width=device-width, initial-scale=1" />
${cssLink}${headHtml ? '\t' + headHtml.split('\n').join('\n\t') + '\n' : ''}</head>
<body>
${bodyHtml}${scriptBlock}</body>
</html>
`;

  const staticLists = ir.components.some((c) => {
    return c.body.some((node) => {
      if (node instanceof MapRegion) return isStaticIR(node.bodyTemplate) && isStaticIR(node.alternateNodes);
      return false;
    });
  });

  return { html, body: bodyHtml, head: headHtml, props: serializedProps, clientCode, static: !hasClient, staticLists };
}

export async function renderFullPage(
  source: string,
  componentName: string,
  props: Record<string, unknown> = {},
  registry: Map<string, Function> = new Map(),
  options: FullPageOptions = {}
): Promise<string> {
  (globalThis as any).__vsk_ssr = true;
  try {
    let ssrProps = { ...props };
    let serializedProps: string | null = null;
    const ast = parse(source);
    const ir = generateIR(ast, source);
    if (ir.loadFn) {
      const __vesk = options.__vesk || loadRuntimeImports(ir.imports);
      const loadResult = await callLoadFunction(ir.loadFn, ssrProps, __vesk);
      if (loadResult && typeof loadResult === 'object') {
        const result = loadResult as Record<string, unknown>;
        if (result.props) ssrProps = { ...ssrProps, ...(result.props as Record<string, unknown>) };
        else ssrProps = { ...ssrProps, ...result };
      }
      serializedProps = JSON.stringify(ssrProps);
    }
    const rendered = await renderPage(source, componentName, ssrProps, registry, { ...options, __vesk: options.__vesk }) as RenderPageResult;

    const ssrData: Record<string, unknown> = (globalThis as any).__vsk_ssr_data || {};
    if ((globalThis as any).__vsk_ssr_promises?.length > 0) {
      await Promise.allSettled((globalThis as any).__vsk_ssr_promises);
      const collectedData: Record<string, unknown> = (globalThis as any).__vsk_ssr_data || {};
      Object.assign(ssrData, collectedData);
    }
    delete (globalThis as any).__vsk_ssr_promises;

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

    const dataScripts: string[] = [];
    if (serializedProps) dataScripts.push(`<script>const __vesk_props = ${serializedProps};</script>`);
    const ssrDataKeys = Object.keys(ssrData);
    if (ssrDataKeys.length > 0) dataScripts.push(`<script>globalThis.__vsk_ssr_data = ${JSON.stringify(ssrData)};</script>`);
    const dataScriptBlock = dataScripts.length > 0 ? '\n' + dataScripts.join('\n') + '\n' : '';

    const headLines = ['\t<meta charset="utf-8" />', '\t<meta name="viewport" content="width=device-width, initial-scale=1" />'];
    if (cssLink) headLines.push(cssLink.trimEnd());
    if (headHtml) headLines.push('\t' + headHtml.split('\n').join('\n\t'));

    if (options.security) {
      const sec = options.security;
      if (sec.referrerPolicy !== false) headLines.push(`\t<meta name="referrer" content="${sec.referrerPolicy || 'strict-origin-when-cross-origin'}" />`);
      if (sec.contentSecurityPolicy !== false) headLines.push(`\t<meta http-equiv="Content-Security-Policy" content="${(sec.contentSecurityPolicy as string || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />`);
      if (sec.autoEscape !== false) headLines.push(`\t<!-- vesk: auto-escape enabled -->`);
    }

    return `<!DOCTYPE html>
<html>
<head>
${headLines.join('\n')}</head>
<body>
<div id="root">
${bodyHtml}
</div>
${dataScriptBlock}${clientScript}</body>
</html>`;
  } finally {
    delete (globalThis as any).__vsk_ssr;
  }
}

export async function* renderPageStream(
  source: string,
  componentName: string,
  props: Record<string, unknown> = {},
  registry: Map<string, Function> = new Map(),
  options: FullPageOptions = {}
): AsyncGenerator<string> {
  const ast = parse(source);
  const ir = generateIR(ast, source);

  let ssrProps = { ...props };
  let serializedProps: string | null = null;
  let __vesk = loadRuntimeImports(ir.imports);

  if (ir.loadFn) {
    const loadResult = await callLoadFunction(ir.loadFn, props, __vesk);
    if (loadResult && typeof loadResult === 'object') {
      const result = loadResult as Record<string, unknown>;
      if (result.props) ssrProps = { ...ssrProps, ...(result.props as Record<string, unknown>) };
      else ssrProps = { ...ssrProps, ...result };
    }
    serializedProps = JSON.stringify(ssrProps);
  }

  const { componentMap } = compileFile(source, { sourcePath: (options.sourcePath as string) || undefined });
  const fullRegistry = new Map([...registry, ...componentMap]);
  const renderFn = componentMap.get(componentName);
  if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);

  resetVskState(!!options.hydrate);

  const targetComp = ir.components.find((c) => c.name === componentName);
  const cssUrls: string[] = options.cssUrls || (options.cssUrl ? [options.cssUrl] : []);
  const cssLink = cssUrls.map(u => `\t<link rel="stylesheet" href="${u}" />\n`).join('');

  yield '<!DOCTYPE html>\n<html>\n<head>\n\t<meta charset="utf-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1" />\n';
  if (cssLink) yield cssLink;
  if (options.security) {
    const sec = options.security;
    if (sec.referrerPolicy !== false) yield `\t<meta name="referrer" content="${sec.referrerPolicy || 'strict-origin-when-cross-origin'}" />\n`;
    if (sec.contentSecurityPolicy !== false) yield `\t<meta http-equiv="Content-Security-Policy" content="${(sec.contentSecurityPolicy as string || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, '&quot;')}" />\n`;
    if (sec.autoEscape !== false) yield `\t<!-- vesk: auto-escape enabled -->\n`;
  }
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
    if (headHtml) yield '\t' + headHtml.split('\n').join('\n\t') + '\n';
  }
  yield '</head>\n<body>\n<div id="root">\n';

  (globalThis as any).__vsk_ssr = true;
  (globalThis as any).__vsk_ssr_token = Math.random().toString(36).slice(2);
  const renderToken = (globalThis as any).__vsk_ssr_token;
  let bodyHtml: string;
  try {
    bodyHtml = await Promise.resolve(renderFn(ssrProps, fullRegistry, __vesk));
  } finally {
    delete (globalThis as any).__vsk_ssr;
    clearSsrCells(renderToken);
  }

  yield bodyHtml;

  const ssrData: Record<string, unknown> = (globalThis as any).__vsk_ssr_data || {};
  if ((globalThis as any).__vsk_ssr_promises?.length > 0) {
    await Promise.allSettled((globalThis as any).__vsk_ssr_promises);
    const collectedData: Record<string, unknown> = (globalThis as any).__vsk_ssr_data || {};
    Object.assign(ssrData, collectedData);
  }
  delete (globalThis as any).__vsk_ssr_promises;

  const dataScripts: string[] = [];
  if (serializedProps) dataScripts.push(`<script>const __vesk_props = ${serializedProps};</script>`);
  const ssrDataKeys = Object.keys(ssrData);
  if (ssrDataKeys.length > 0) dataScripts.push(`<script>globalThis.__vsk_ssr_data = ${JSON.stringify(ssrData)};</script>`);
  const dataScriptBlock = dataScripts.length > 0 ? '\n' + dataScripts.join('\n') : '';
  yield `\n</div>${dataScriptBlock}</body>\n</html>\n`;
}
