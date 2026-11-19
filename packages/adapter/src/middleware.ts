import { readFileSync } from 'node:fs';
import type { MiddlewareChainItem, MiddlewareExtractResult } from '@vesk/adapter/src/types';
import { extractMiddlewareParts } from '@vesk/compiler/src/router';

function extractMiddlewareBody(src: string): MiddlewareExtractResult | null {
  const parts = extractMiddlewareParts(src);
  if (!parts) return null;
  return { params: parts.params, body: parts.body, imports: parts.imports };
}

/**
 * Runtime half of every generated middleware chain. Kept in one place so the
 * standalone `server/middleware.js` executor and the inline executor embedded in
 * SSR/API functions cannot drift apart.
 *
 * `chainVar` / `executorName` / `exportExecutor` differ between the two call
 * sites; everything else is identical.
 */
function generateExecutorRuntime(chainVar: string, executorName: string, exportExecutor: boolean): string {
  return `
const __mwVeskResponse = (typeof VeskResponse !== "undefined" && VeskResponse) ? VeskResponse : (globalThis.VeskResponse || null);

function __mwMakeResponse(body, init) {
  try { if (__mwVeskResponse) return new __mwVeskResponse(body, init); } catch {}
  return new Response(body, init);
}

function __mwCloneResponse(res) {
  if (!res || !(res instanceof Response)) return res;
  const init = { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) };
  let out;
  try { out = __mwVeskResponse ? new __mwVeskResponse(res.body, init) : new Response(res.body, init); } catch { out = new Response(res.body, init); }
  try {
    if (Array.isArray(res._cookieHeaders)) {
      if (Array.isArray(out._cookieHeaders)) out._cookieHeaders.push(...res._cookieHeaders);
      else out._cookieHeaders = [...res._cookieHeaders];
    }
    if (res._secHeaders && typeof res._secHeaders === "object") out._secHeaders = { ...(out._secHeaders && typeof out._secHeaders === "object" ? out._secHeaders : {}), ...res._secHeaders };
    if (res._finalStatus != null && out._finalStatus == null) out._finalStatus = res._finalStatus;
  } catch {}
  if (typeof out.build === "function") try { out.build(); } catch {}
  return out;
}

function __mwBindResult(data, schema) {
  if (schema && typeof schema.safeParse === "function") {
    try {
      const r = schema.safeParse(data);
      if (r && typeof r === "object" && "success" in r) return r.success ? { data: r.data } : { error: r.error };
    } catch (e) { return { error: e }; }
  }
  return { data };
}

const __PREVIOUS_ROUTE_HEADER = "x-vesk-previous-route";
const __RETURN_TO_HEADER = "x-return-to";
const __REFERRER_HEADER = "referer";

function __mwReadHeader(headers, name) {
  if (!headers) return null;
  try {
    if (typeof headers.get === "function") {
      const value = headers.get(name);
      return value == null || value === "" ? null : String(value);
    }
  } catch {}
  const value = headers[name];
  if (value == null) return null;
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function __mwRelevantHeaders(headers) {
  const out = new Map();
  for (const name of [__PREVIOUS_ROUTE_HEADER, __RETURN_TO_HEADER, __REFERRER_HEADER]) {
    const value = __mwReadHeader(headers, name);
    if (value != null) out.set(name, value);
  }
  return out;
}

function __mwPreviousOrigin(url) {
  const raw = String((url && url.href) || url || "http://vesk.local");
  try { return new URL(raw, "http://vesk.local").origin; } catch { return "http://vesk.local"; }
}

function __mwSameRouteOrigin(value, base) {
  if (value.protocol !== base.protocol) return false;
  const host = (name) => {
    const lower = String(name).toLowerCase();
    return lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower === "[::1]" ? "loopback" : lower;
  };
  const port = (url) => url.port || (url.protocol === "https:" ? "443" : "80");
  const valueHost = host(value.hostname);
  if (valueHost !== host(base.hostname)) return false;
  const valuePort = port(value);
  const basePort = port(base);
  if (valuePort === basePort) return true;
  return valueHost === "loopback" && (valuePort === "80" || basePort === "80");
}

function __mwSanitizePreviousRoute(value, origin) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const backslash = String.fromCharCode(92);
  if (!raw || raw[0] === backslash) return null;
  if (raw.startsWith("//") || raw.startsWith("/" + backslash)) return null;
  const isPath = raw.charCodeAt(0) === 47;
  if (!isPath && raw.indexOf(":") === -1) return null;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code === 127) return null;
  }
  try {
    const base = new URL(origin);
    const parsed = new URL(raw, base);
    if (!__mwSameRouteOrigin(parsed, base)) return null;
    if (parsed.pathname.startsWith("//") || parsed.pathname.startsWith("/" + backslash)) return null;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return null; }
}

function __mwResolvePreviousRoute(headers, url, origin) {
  const relevant = __mwRelevantHeaders(headers);
  const query = { next: null, returnTo: null };
  try {
    const parsed = new URL(String((url && url.href) || url || "http://vesk.local"), origin);
    query.next = parsed.searchParams.get("next");
    query.returnTo = parsed.searchParams.get("returnTo");
  } catch {}
  const candidates = [
    [__PREVIOUS_ROUTE_HEADER, relevant.get(__PREVIOUS_ROUTE_HEADER)],
    [__RETURN_TO_HEADER, relevant.get(__RETURN_TO_HEADER)],
    ["query", query.next || query.returnTo],
    [__REFERRER_HEADER, relevant.get(__REFERRER_HEADER)],
  ];
  for (const [source, value] of candidates) {
    const route = __mwSanitizePreviousRoute(value, origin);
    if (route) return { route, source, headers: relevant };
  }
  return { route: null, source: null, headers: relevant };
}

function __mwAttachCtx(ctx) {
  let __mwCookieValues = null;
  if (!(ctx.headers instanceof Map)) {
    const __hSource = ctx.headers || (ctx.request && ctx.request.headers);
    const __hMap = new Map();
    if (__hSource) {
      try {
        if (typeof __hSource.forEach === "function" && typeof __hSource.get === "function") {
          __hSource.forEach((value, name) => __hMap.set(String(name).toLowerCase(), String(value)));
        } else if (typeof __hSource.entries === "function") {
          for (const [name, value] of __hSource.entries()) __hMap.set(String(name).toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
        } else {
          for (const name of Object.keys(__hSource)) {
            const value = __hSource[name];
            if (value !== undefined && value !== null) __hMap.set(name.toLowerCase(), Array.isArray(value) ? value.join(", ") : String(value));
          }
        }
      } catch {}
    }
    ctx.headers = __hMap;
  }
  if (!Array.isArray(ctx.errors)) ctx.errors = [];
  if (typeof ctx.error !== "function") ctx.error = (err) => { ctx.errors.push({ error: err }); return err; };
  if (!ctx.__pendingHeaders) ctx.__pendingHeaders = {};
  if (ctx.cookies && typeof ctx.cookies.get !== "function") {
    try {
      __mwCookieValues = Object.assign({}, ctx.cookies);
      Object.defineProperty(ctx.cookies, "get", { value: (name) => {
        const value = ctx.cookies[name];
        return typeof value === "function" && Object.prototype.hasOwnProperty.call(__mwCookieValues, name) ? __mwCookieValues[name] : value;
      }, enumerable: false, configurable: true });
    } catch {}
  }
  if (typeof ctx.cookie !== "function") ctx.cookie = (name) => {
    if (ctx.cookies && typeof ctx.cookies.get === "function") return ctx.cookies.get(name);
    const value = ctx.cookies ? ctx.cookies[name] : undefined;
    return __mwCookieValues && typeof value === "function" && Object.prototype.hasOwnProperty.call(__mwCookieValues, name) ? __mwCookieValues[name] : value;
  };
  if (typeof ctx.getHeader !== "function") ctx.getHeader = (name) => (ctx.request && ctx.request.headers ? ctx.request.headers.get(String(name)) : null);
  if (typeof ctx.header !== "function") ctx.header = (name, value) => {
    const key = String(name).toLowerCase();
    if (value == null) delete ctx.__pendingHeaders[key];
    else ctx.__pendingHeaders[key] = String(value);
  };
  const __mwPreviousOriginValue = __mwPreviousOrigin(ctx.url);
  const __mwPreviousUrlValue = ctx.url;
  let __mwPreviousRouteOverride = null;
  const __mwPreviousInfo = () => __mwResolvePreviousRoute(ctx.headers, __mwPreviousUrlValue, __mwPreviousOriginValue);
  try {
    Object.defineProperty(ctx, "previousRoute", {
      configurable: true,
      enumerable: true,
      get: () => __mwPreviousRouteOverride !== null ? __mwPreviousRouteOverride : __mwPreviousInfo().route,
      set: (value) => {
        const safe = __mwSanitizePreviousRoute(value, __mwPreviousOriginValue);
        __mwPreviousRouteOverride = safe;
        ctx.header(__PREVIOUS_ROUTE_HEADER, safe);
      },
    });
    Object.defineProperty(ctx, "previousRouteInfo", {
      configurable: true,
      enumerable: true,
      get: () => {
        const info = __mwPreviousInfo();
        if (__mwPreviousRouteOverride === null) return info;
        return { route: __mwPreviousRouteOverride, source: __PREVIOUS_ROUTE_HEADER, headers: info.headers };
      },
    });
    Object.defineProperty(ctx, "previousRouteHeaders", {
      configurable: true,
      enumerable: true,
      get: () => __mwPreviousInfo().headers,
    });
  } catch {}
  if (typeof ctx.status !== "function") ctx.status = (code) => __mwCloneResponse(__mwMakeResponse(null, { status: code }));
  if (typeof ctx.json !== "function") ctx.json = (body, init) => {
    const headers = Object.assign({ "Content-Type": "application/json" }, (init && init.headers) || {});
    try {
      if (__mwVeskResponse && typeof __mwVeskResponse.json === "function") {
        return __mwCloneResponse(__mwVeskResponse.json(body, Object.assign({}, init, { headers })));
      }
    } catch {}
    return __mwCloneResponse(new Response(JSON.stringify(body), Object.assign({}, init, { headers })));
  };
  if (typeof ctx.text !== "function") ctx.text = (body, init) => __mwCloneResponse(__mwMakeResponse(body, init));
  if (typeof ctx.html !== "function") ctx.html = (body, init) => {
    const headers = Object.assign({ "Content-Type": "text/html; charset=utf-8" }, (init && init.headers) || {});
    return __mwCloneResponse(__mwMakeResponse(body, Object.assign({}, init, { headers })));
  };
  if (typeof ctx.redirect !== "function") ctx.redirect = (url, status) => __mwCloneResponse(__mwMakeResponse(null, { status: status || 302, headers: { Location: url } }));
  if (typeof ctx.shouldBindQuery !== "function") ctx.shouldBindQuery = (schema) => {
    try {
      const data = ctx.url ? Object.fromEntries(ctx.url.searchParams.entries()) : {};
      return __mwBindResult(data, schema);
    } catch (e) { return { error: e }; }
  };
  if (typeof ctx.bindQuery !== "function") ctx.bindQuery = (schema) => {
    const r = ctx.shouldBindQuery(schema);
    if (r && r.error) throw r.error;
    return r.data;
  };
  if (typeof ctx.shouldBindJSON !== "function") ctx.shouldBindJSON = async (schema) => {
    try {
      const req = ctx.request;
      const clone = req && typeof req.clone === "function" ? req.clone() : req;
      const data = clone ? await clone.json() : {};
      return __mwBindResult(data, schema);
    } catch (e) { return { error: e }; }
  };
  if (typeof ctx.bindJSON !== "function") ctx.bindJSON = async (schema) => {
    const r = await ctx.shouldBindJSON(schema);
    if (r && r.error) throw r.error;
    return r.data;
  };
  return ctx;
}

function __mwApplyPending(ctx, res) {
  if (!res || !(res instanceof Response)) return res;
  const pending = ctx && ctx.__pendingHeaders;
  if (!pending) return res;
  const keys = Object.keys(pending);
  if (!keys.length) return res;
  const out = __mwCloneResponse(res);
  try { for (const k of keys) out.headers.set(k, pending[k]); } catch {}
  return out;
}

${exportExecutor ? 'export ' : ''}async function ${executorName}(ctx, onLast) {
  __mwAttachCtx(ctx);
  let rewriteUrl = null;
  let __aborted = false;
  let __abortResponse = null;
  let __lastRan = false;
  if (typeof ctx.abort !== "function") ctx.abort = () => { __aborted = true; };
  if (typeof ctx.isAborted !== "function") ctx.isAborted = () => __aborted;
  if (typeof ctx.abortWithStatus !== "function") ctx.abortWithStatus = (status) => { __aborted = true; __abortResponse = __mwCloneResponse(__mwMakeResponse(null, { status })); return __abortResponse; };
  if (typeof ctx.abortWithStatusJSON !== "function") ctx.abortWithStatusJSON = (status, body) => { __aborted = true; __abortResponse = __mwCloneResponse(__mwMakeResponse(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })); return __abortResponse; };
  async function run(index) {
    if (__aborted) return __abortResponse;
    if (index >= ${chainVar}.length) {
      if (typeof onLast === "function") { __lastRan = true; return __mwCloneResponse(await onLast(rewriteUrl, ctx)); }
      return null;
    }
    const fn = ${chainVar}[index];
    let nextCalled = false;
    let nextResult = null;
    async function next(rewrite) {
      if (__aborted) return __abortResponse;
      if (nextCalled) return null;
      nextCalled = true;
      if (rewrite) {
        rewriteUrl = rewrite;
        try { ctx.url = new URL(rewrite, (ctx.url && ctx.url.href) || "http://localhost"); } catch {}
      }
      nextResult = await run(index + 1);
      return nextResult;
    }
    try {
      const result = await fn(ctx, next);
      if (__aborted) return __mwApplyPending(ctx, __abortResponse || __mwCloneResponse(nextResult) || __mwCloneResponse(result));
      if (result instanceof Response) return __mwApplyPending(ctx, __mwCloneResponse(result));
      if (nextResult instanceof Response) return __mwApplyPending(ctx, __mwCloneResponse(nextResult));
      if (!nextCalled) return __mwApplyPending(ctx, await run(index + 1));
      return __mwApplyPending(ctx, null);
    } catch (e) {
      try { ctx.errors.push({ error: e }); } catch {}
      if (e && typeof e === "object" && e.name === "Redirect") {
        return __mwApplyPending(ctx, __mwCloneResponse(new Response(null, {
          status: Number(e.status) || 302,
          headers: { Location: String(e.url || "") },
        })));
      }
      // undici's Response.redirect() rejects relative URLs with a TypeError.
      // Normalize it into a redirect instead of surfacing a 500.
      if (e instanceof TypeError && /Failed to parse URL from/.test(String(e.message))) {
        const msg = String(e.message);
        const prefix = "Failed to parse URL from ";
        const start = msg.indexOf(prefix);
        const target = start === -1 ? "" : msg.slice(start + prefix.length).trim().split(" ")[0];
        return __mwApplyPending(ctx, __mwCloneResponse(new Response(null, { status: 302, headers: { Location: target } })));
      }
      // Any other TypeError from middleware must not crash the server. On
      // serverless platforms an uncaught throw surfaces as
      // FUNCTION_INVOCATION_FAILED; return a 500 instead.
      if (e instanceof TypeError) {
        return __mwApplyPending(ctx, __mwCloneResponse(new Response(null, { status: 500 })));
      }
      throw e;
    }
  }
  let response = null;
  try {
    response = await run(0);
  } catch (e) {
    try { ctx.errors.push({ error: e }); } catch {}
    response = __mwCloneResponse(new Response(null, { status: 500 }));
  }
  return { response: __mwApplyPending(ctx, __mwCloneResponse(response)), rewriteUrl, lastRan: __lastRan };
}
`;
}

export function compileMiddleware(mwChain: MiddlewareChainItem[], _appDir: string): string | null {
  if (mwChain.length === 0) return null;

  const parts: string[] = [];
  const imports: string[] = [];
  for (let i = 0; i < mwChain.length; i++) {
    const { sourcePath } = mwChain[i];
    const src = readFileSync(sourcePath, 'utf-8');
    const extracted = extractMiddlewareBody(src);
    if (!extracted) continue;
    for (const line of extracted.imports) {
      if (line.includes('VeskResponse') && line.includes('runtime')) continue;
      if (!imports.includes(line)) imports.push(line);
    }
    parts.push(`async function mw_${i}(${extracted.params}) {\n${extracted.body}\n}`);
  }

  if (parts.length === 0) return null;

  const chainVar = 'chain';
  const code = [
    '// Auto-generated middleware chain — do not edit',
    '',
    "import { VeskResponse } from './runtime.js';",
    ...imports,
    ...(imports.length ? [''] : []),
    parts.join('\n\n'),
    '',
    `const ${chainVar} = [${parts.map((_, i) => `mw_${i}`).join(', ')}];`,
    '',
    generateExecutorRuntime(chainVar, 'execute', true),
  ].join('\n');

  return code;
}

export function compileMiddlewareCode(
  mwSourceTexts: string[],
  options: { dedupeVeskResponse?: boolean } = {},
): string | null {
  if (!mwSourceTexts || mwSourceTexts.length === 0) return null;

  const parts: string[] = [];
  const imports: string[] = [];
  for (let i = 0; i < mwSourceTexts.length; i++) {
    const extracted = extractMiddlewareBody(mwSourceTexts[i]);
    if (!extracted) continue;
    for (const line of extracted.imports) {
      if (options.dedupeVeskResponse && line.includes('VeskResponse') && line.includes('runtime')) continue;
      if (!imports.includes(line)) imports.push(line);
    }
    parts.push(`async function mw_${i}(${extracted.params}) {\n${extracted.body}\n}`);
  }

  if (parts.length === 0) return null;

  const chainVar = '__mwChain';
  const code = [
    '// ── Middleware chain (inline) ──',
    '',
    ...imports,
    ...(imports.length ? [''] : []),
    parts.join('\n\n'),
    '',
    `const ${chainVar} = [${parts.map((_, i) => `mw_${i}`).join(', ')}];`,
    '',
    generateExecutorRuntime(chainVar, '__executeMw', false),
  ].join('\n');

  return code;
}
