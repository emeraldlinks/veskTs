export {
  setRuntimeModule,
  prettifyHtml,
  isStatic,
  escapeHtml,
  quoteAttr,
  safeJsonForScript,
  randomToken,
  DEFAULT_MAX_BODY_BYTES,
  raw,
  exprJS,
  tryEvalExpr,
  childrenToHTML,
  extractTopLevelNames,
  extractRuntimeNames,
  buildParamInit,
  resolveComponentName,
  loadRuntimeImports,
  evalTopLevelCode,
  callStaticProps,
  callLoadFunction,
  __vskHydrate,
  __vskMarkerless,
  __vskId,
  __vskImportedNames,
  resetVskState,
  setVskHydrate,
  setVskMarkerless,
  setVskImportedNames,
  securityHeaders,
  corsHeaders,
  corsPreflight,
  csrfToken,
  verifyCsrfToken,
  csrfGuard,
  csrfHmac,
  assertSameOrigin,
  signCookie,
  unsignCookie,
  setSignedCookie,
  readSignedCookie,
  securityComment,
  redactLog,
  setRedactLogging,
  createRateLimiter,
  getClientIp,
  getClientProtocol,
  applyTrustProxy,
} from '@vesk/compiler/src/server-utils';

export {
  renderHeadHtml,
  mergeHeadHtml,
} from '@vesk/compiler/src/server-head';

export {
  irNodeToJS,
  generateFunctionBody,
  buildComponentMap,
  buildComponentEntries,
} from '@vesk/compiler/src/server-jsgen';

export {
  irToJSON,
  irFromJSON,
  hydratePrecompile,
} from '@vesk/compiler/src/precompile-runtime';

export {
  precompileFile,
} from '@vesk/compiler/src/precompile';

export {
  compileFile,
  render,
  renderPage,
  ssg,
  renderFullPage,
  renderPageStream,
  buildDataScripts,
  applyHeadPlugins,
  applyHeadInjects,
  applyHtmlPlugins,
} from '@vesk/compiler/src/server-render';

// Re-exported so bundlers reach the request-scope store through THIS module
// rather than a second specifier for the same file. A bundle that resolved
// `@vesk/compiler/src/ssr-store` on its own (as the server-runtime entry used
// to) could end up with two copies of the module — two AsyncLocalStorages and
// two liveness maps — and the scope one copy opens is invisible to the other.
export {
  withSsrStore,
  withSsrStoreOf,
  createSsrStore,
  adoptSsrStore,
  currentSsrToken,
  resetSsrToken,
  keepSsrSlot,
  dropSsrSlot,
  isSsrSlotLive,
  ssrSink,
} from '@vesk/compiler/src/ssr-store';
