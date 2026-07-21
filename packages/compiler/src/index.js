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
