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
  __vskId,
  __vskImportedNames,
  resetVskState,
  setVskHydrate,
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
