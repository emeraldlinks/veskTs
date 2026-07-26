/**
 * @vesk/compiler
 *
 * The Vesk compiler pipeline:
 * [1] Lexer/Tokenizer (Acorn + TypeScript + VeskPlugin)
 * [2] Parser → AST
 * [3] Semantic analysis
 * [4] IR generation
 * [5] Codegen (server + client)
 */

export { parse, createBaseParser } from './parser.js';
export { VeskPlugin } from './vesk-plugin.js';
export { generateIR } from './ir-generator.js';
export { render } from './server-codegen.js';
export { compileClient, compile } from './client-codegen.js';
export {
	IRRoot,
	ComponentIR,
	StaticNode,
	TextNode,
	DynamicBinding,
	OpaqueDynamicRegion,
	MapRegion,
	ComponentCall,
	Expression,
} from './ir.js';

/** @typedef {import('./config.js').VeskPlugin} VeskPlugin */
/** @typedef {import('./config.js').VeskConfig} VeskConfig */

export { defineConfig, validateConfig } from './config.js';
export { scanRoutes, scanComponents, collectSources, matchUrl } from './router.js';
