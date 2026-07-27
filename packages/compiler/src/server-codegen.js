/**
 * Server-side code generation and SSR rendering for Vesk.
 * This barrel re-exports all public API from the server-codegen modules.
 *
 * @module server-codegen
 */

export {
	setRuntimeModule,
	prettifyHtml,
	isStatic,
	escapeHtml,
	raw,
	exprJS,
	tryEvalExpr,
	childrenToHTML,
	extractTopLevelNames,
	extractRuntimeNames,
	buildParamInit,
	loadRuntimeImports,
	evalTopLevelCode,
	callStaticProps,
	callLoadFunction,
	__vskHydrate,
	__vskId,
	__vskImportedNames,
	resetVskState,
	setVskImportedNames,
	securityHeaders,
	corsHeaders,
	corsPreflight,
	csrfToken,
	verifyCsrfToken,
	csrfGuard,
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
} from './server-utils.js';

export {
	renderHeadHtml,
	mergeHeadHtml,
} from './server-head.js';

export {
	irNodeToJS,
	generateFunctionBody,
	buildComponentMap,
} from './server-jsgen.js';

export {
	compileFile,
	render,
	renderPage,
	ssg,
	renderFullPage,
	renderPageStream,
} from './server-render.js';
