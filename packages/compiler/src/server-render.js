import { MapRegion } from "./ir.js";
import { parse } from "./parser.js";
import { generateIR } from "./ir-generator.js";
import { compileClient, isStaticIR } from "./client-codegen.js";
import {
  isStatic,
  prettifyHtml,
  resetVskState,
  loadRuntimeImports,
  evalTopLevelCode,
  callStaticProps,
  callLoadFunction
} from "./server-utils.js";
import { renderHeadHtml, mergeHeadHtml } from "./server-head.js";
import { buildComponentMap } from "./server-jsgen.js";
function compileFile(source) {
  const ast = parse(source);
  const ir = generateIR(ast, source);
  const componentMap = buildComponentMap(ir, true);
  const __vesk = loadRuntimeImports(ir.imports);
  evalTopLevelCode(ir.topLevelCode, __vesk);
  return { ir, componentMap, __vesk };
}
function render(source, componentName, props = {}, registry = /* @__PURE__ */ new Map(), options = {}) {
  resetVskState(!!options.hydrate);
  const ast = parse(source);
  const ir = generateIR(ast, source);
  const componentMap = buildComponentMap(ir, true);
  const renderFn = componentMap.get(componentName);
  if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);
  const fullRegistry = new Map([...registry, ...componentMap]);
  const __vesk = options.__vesk || loadRuntimeImports(ir.imports);
  evalTopLevelCode(ir.topLevelCode, __vesk);
  const result = renderFn(props, fullRegistry, __vesk);
  const targetComp = ir.components.find((c) => c.name === componentName);
  if (targetComp?.isAsync) {
    return result.then ? result : Promise.resolve(result);
  }
  return result;
}
function renderPage(source, componentName, props = {}, registry = /* @__PURE__ */ new Map(), options = {}) {
  resetVskState(!!options.hydrate);
  let __vesk, componentMap, ir;
  if (options.cached) {
    const cached = options.cached;
    ir = cached.ir;
    componentMap = cached.componentMap;
    __vesk = cached.__vesk;
  } else {
    const compiled = compileFile(source);
    ir = compiled.ir;
    componentMap = compiled.componentMap;
    __vesk = compiled.__vesk;
  }
  globalThis.__vsk_ssr = true;
  const renderFn = componentMap.get(componentName);
  if (!renderFn) throw new Error(`Component "${componentName}" not found in source`);
  const fullRegistry = new Map([...registry, ...componentMap]);
  let bodyHtml;
  try {
    bodyHtml = renderFn(props, fullRegistry, __vesk);
  } finally {
    delete globalThis.__vsk_ssr;
  }
  const targetComp = ir.components.find((c) => c.name === componentName);
  if (targetComp?.isAsync) {
    return (async () => ({
      body: await bodyHtml,
      head: renderHeadHtml(targetComp, props),
      props
    }))();
  }
  const headHtml = targetComp ? renderHeadHtml(targetComp, props) : "";
  return { body: bodyHtml, head: headHtml, props };
}
async function ssg(source, componentName, customProps, options = {}) {
  const ast = parse(source);
  const ir = generateIR(ast, source);
  if (!componentName) {
    const defaultComp = ir.components.find((c) => c.defaultExport);
    const exportedComp = ir.components.find((c) => c.exported);
    componentName = defaultComp?.name || exportedComp?.name || (ir.components.length > 0 ? ir.components[0].name : void 0);
  }
  if (!componentName) throw new Error("No component found in source for SSG");
  let props = customProps;
  if (props === void 0 && ir.staticProps) {
    const staticResult = await callStaticProps(ir.staticProps);
    if (staticResult && typeof staticResult === "object") {
      props = staticResult;
    }
  }
  if (!props) props = {};
  const needsClient = ir.components.some((c) => {
    if (c.isClient) return true;
    if (c.style) return true;
    return !isStatic(c.body);
  });
  const rendered = await renderPage(source, componentName, props, options.registry || /* @__PURE__ */ new Map(), { hydrate: needsClient });
  const bodyHtml = rendered.body;
  const headHtml = rendered.head;
  const clientCode = needsClient ? compileClient(source, null, { hydrate: true }) : "";
  const serializedProps = JSON.stringify(props);
  const hasClient = clientCode.length > 0;
  const scriptBlock = hasClient ? `
<script>const __vesk_props = ${serializedProps};
<\/script>
<script>${clientCode}<\/script>
` : `
<script>const __vesk_props = ${serializedProps};
<\/script>
`;
  const cssUrls = options.cssUrls || (options.cssUrl ? [options.cssUrl] : []);
  const cssLink = cssUrls.map((u) => `	<link rel="stylesheet" href="${u}" />
`).join("");
  const html = `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
${cssLink}${headHtml ? "	" + headHtml.split("\n").join("\n	") + "\n" : ""}</head>
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
async function renderFullPage(source, componentName, props = {}, registry = /* @__PURE__ */ new Map(), options = {}) {
  globalThis.__vsk_ssr = true;
  try {
    let ssrProps = { ...props };
    let serializedProps = null;
    const ast = parse(source);
    const ir = generateIR(ast, source);
    if (ir.loadFn) {
      const __vesk = options.__vesk || loadRuntimeImports(ir.imports);
      const loadResult = await callLoadFunction(ir.loadFn, ssrProps, __vesk);
      if (loadResult && typeof loadResult === "object") {
        const result = loadResult;
        if (result.props) ssrProps = { ...ssrProps, ...result.props };
        else ssrProps = { ...ssrProps, ...result };
      }
      serializedProps = JSON.stringify(ssrProps);
    }
    const rendered = await renderPage(source, componentName, ssrProps, registry, { ...options, __vesk: options.__vesk });
    const ssrData = globalThis.__vsk_ssr_data || {};
    if (globalThis.__vsk_ssr_promises?.length > 0) {
      await Promise.allSettled(globalThis.__vsk_ssr_promises);
      const collectedData = globalThis.__vsk_ssr_data || {};
      Object.assign(ssrData, collectedData);
    }
    delete globalThis.__vsk_ssr_promises;
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
    const cssUrls = options.cssUrls || (options.cssUrl ? [options.cssUrl] : []);
    const cssLink = cssUrls.map((u) => `	<link rel="stylesheet" href="${u}" />
`).join("");
    const clientScript = options.clientScriptUrl ? `	<script type="module" src="${options.clientScriptUrl}"><\/script>
` : "";
    const dataScripts = [];
    if (serializedProps) dataScripts.push(`<script>const __vesk_props = ${serializedProps};<\/script>`);
    const ssrDataKeys = Object.keys(ssrData);
    if (ssrDataKeys.length > 0) dataScripts.push(`<script>const __vesk_ssr_data = ${JSON.stringify(ssrData)};<\/script>`);
    const dataScriptBlock = dataScripts.length > 0 ? "\n" + dataScripts.join("\n") + "\n" : "";
    const headLines = ['	<meta charset="utf-8" />', '	<meta name="viewport" content="width=device-width, initial-scale=1" />'];
    if (cssLink) headLines.push(cssLink.trimEnd());
    if (headHtml) headLines.push("	" + headHtml.split("\n").join("\n	"));
    if (options.security) {
      const sec = options.security;
      if (sec.xFrameOptions !== false) headLines.push(`	<meta http-equiv="X-Frame-Options" content="${sec.xFrameOptions || "DENY"}" />`);
      if (sec.referrerPolicy !== false) headLines.push(`	<meta name="referrer" content="${sec.referrerPolicy || "strict-origin-when-cross-origin"}" />`);
      if (sec.contentSecurityPolicy !== false) headLines.push(`	<meta http-equiv="Content-Security-Policy" content="${(sec.contentSecurityPolicy || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, "&quot;")}" />`);
      if (sec.autoEscape !== false) headLines.push(`	<!-- vesk: auto-escape enabled -->`);
    }
    return `<!DOCTYPE html>
<html>
<head>
${headLines.join("\n")}</head>
<body>
<div id="root">
${bodyHtml}
</div>
${dataScriptBlock}${clientScript}</body>
</html>`;
  } finally {
    delete globalThis.__vsk_ssr;
  }
}
async function* renderPageStream(source, componentName, props = {}, registry = /* @__PURE__ */ new Map(), options = {}) {
  const ast = parse(source);
  const ir = generateIR(ast, source);
  let ssrProps = { ...props };
  let serializedProps = null;
  let __vesk = loadRuntimeImports(ir.imports);
  if (ir.loadFn) {
    const loadResult = await callLoadFunction(ir.loadFn, props, __vesk);
    if (loadResult && typeof loadResult === "object") {
      const result = loadResult;
      if (result.props) ssrProps = { ...ssrProps, ...result.props };
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
  const cssUrls = options.cssUrls || (options.cssUrl ? [options.cssUrl] : []);
  const cssLink = cssUrls.map((u) => `	<link rel="stylesheet" href="${u}" />
`).join("");
  yield '<!DOCTYPE html>\n<html>\n<head>\n	<meta charset="utf-8" />\n	<meta name="viewport" content="width=device-width, initial-scale=1" />\n';
  if (cssLink) yield cssLink;
  if (options.security) {
    const sec = options.security;
    if (sec.xFrameOptions !== false) yield `	<meta http-equiv="X-Frame-Options" content="${sec.xFrameOptions || "DENY"}" />
`;
    if (sec.referrerPolicy !== false) yield `	<meta name="referrer" content="${sec.referrerPolicy || "strict-origin-when-cross-origin"}" />
`;
    if (sec.contentSecurityPolicy !== false) yield `	<meta http-equiv="Content-Security-Policy" content="${(sec.contentSecurityPolicy || "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'").replace(/"/g, "&quot;")}" />
`;
    if (sec.autoEscape !== false) yield `	<!-- vesk: auto-escape enabled -->
`;
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
    if (headHtml) yield "	" + headHtml.split("\n").join("\n	") + "\n";
  }
  yield '</head>\n<body>\n<div id="root">\n';
  globalThis.__vsk_ssr = true;
  let bodyHtml;
  try {
    bodyHtml = await Promise.resolve(renderFn(ssrProps, fullRegistry, __vesk));
  } finally {
    delete globalThis.__vsk_ssr;
  }
  yield bodyHtml;
  const ssrData = globalThis.__vsk_ssr_data || {};
  if (globalThis.__vsk_ssr_promises?.length > 0) {
    await Promise.allSettled(globalThis.__vsk_ssr_promises);
    const collectedData = globalThis.__vsk_ssr_data || {};
    Object.assign(ssrData, collectedData);
  }
  delete globalThis.__vsk_ssr_promises;
  const dataScripts = [];
  if (serializedProps) dataScripts.push(`<script>const __vesk_props = ${serializedProps};<\/script>`);
  const ssrDataKeys = Object.keys(ssrData);
  if (ssrDataKeys.length > 0) dataScripts.push(`<script>const __vesk_ssr_data = ${JSON.stringify(ssrData)};<\/script>`);
  const dataScriptBlock = dataScripts.length > 0 ? "\n" + dataScripts.join("\n") : "";
  const clientScript = options.clientScriptUrl ? `
<script type="module" src="${options.clientScriptUrl}"><\/script>
` : "";
  yield `
</div>${dataScriptBlock}${clientScript}</body>
</html>
`;
}
export {
  compileFile,
  render,
  renderFullPage,
  renderPage,
  renderPageStream,
  ssg
};
