import type { IRRoot, ComponentIR, IRNode } from './ir.js';
import { MapRegion } from './ir.js';
import { parse } from './parser.js';
import { generateIR } from './ir-generator.js';
import { compileClient, isStaticIR } from './client-codegen.js';
import type { CompileFileResult, RenderPageResult, SSGResult, FullPageOptions } from './types.js';
import {
  isStatic, prettifyHtml, resetVskState,
  loadRuntimeImports, evalTopLevelCode,
  callStaticProps, callLoadFunction,
  securityHeaders, securityComment,
} from './server-utils.js';
import { renderHeadHtml, mergeHeadHtml } from './server-head.js';
import { buildComponentMap } from './server-jsgen.js';

export function compileFile(source: string): CompileFileResult {
  const ast = parse(source);
  const ir = generateIR(ast, source);
  const componentMap = buildComponentMap(ir, true);
  const __vesk = loadRuntimeImports(ir.imports);
  evalTopLevelCode(ir.topLevelCode, __vesk);
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
  const ast = parse(source);
  const ir = generateIR(ast, source);
  const componentMap = buildComponentMap(ir, true);
  const renderFn = componentMap.get(componentName);
  if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);
  const fullRegistry = new Map([...registry, ...componentMap]);
  const __vesk = (options.__vesk as Record<string, unknown>) || loadRuntimeImports(ir.imports);
  evalTopLevelCode(ir.topLevelCode, __vesk);
  const result = renderFn(props, fullRegistry, __vesk);
  const targetComp = ir.components.find((c) => c.name === componentName);
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
    const compiled = compileFile(source);
    ir = compiled.ir;
    componentMap = compiled.componentMap;
    __vesk = compiled.__vesk;
  }

  (globalThis as any).__vsk_ssr = true;
  const renderFn = componentMap.get(componentName);
  if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);
  const fullRegistry = new Map([...registry, ...componentMap]);
  let bodyHtml: unknown;
  try {
    bodyHtml = renderFn(props, fullRegistry, __vesk);
  } finally {
    delete (globalThis as any).__vsk_ssr;
  }

  const targetComp = ir.components.find((c) => c.name === componentName);
  if (targetComp?.isAsync) {
    return (async () => ({
      body: await (bodyHtml as Promise<string>),
      head: renderHeadHtml(targetComp, props),
      props
    }))();
  }
  const headHtml = targetComp ? renderHeadHtml(targetComp, props) : '';
  return { body: bodyHtml as string, head: headHtml, props };
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
      if (node instanceof MapRegion) return isStaticIR(node.bodyTemplate);
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
    if (ssrDataKeys.length > 0) dataScripts.push(`<script>const __vesk_ssr_data = ${JSON.stringify(ssrData)};</script>`);
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

  const { componentMap } = compileFile(source);
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
  let bodyHtml: string;
  try {
    bodyHtml = await Promise.resolve(renderFn(ssrProps, fullRegistry, __vesk));
  } finally {
    delete (globalThis as any).__vsk_ssr;
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
  if (ssrDataKeys.length > 0) dataScripts.push(`<script>const __vesk_ssr_data = ${JSON.stringify(ssrData)};</script>`);
  const dataScriptBlock = dataScripts.length > 0 ? '\n' + dataScripts.join('\n') : '';

  const clientScript = options.clientScriptUrl
    ? `\n<script type="module" src="${options.clientScriptUrl}"></script>\n`
    : '';
  yield `\n</div>${dataScriptBlock}${clientScript}</body>\n</html>\n`;
}
