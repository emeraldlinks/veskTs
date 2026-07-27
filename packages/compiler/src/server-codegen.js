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
