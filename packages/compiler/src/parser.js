/**
 * Vesk Parser — Phase 0 Proof of Concept
 *
 * Proves the base Acorn + TypeScript parser can parse a plain .tsx file
 * before touching Vesk-specific grammar.
 */
import * as acorn from 'acorn';
import { tsPlugin } from '@sveltejs/acorn-typescript';

/**
 * Create a base parser that handles TypeScript + JSX.
 * This is the foundation Vesk will extend for its own grammar.
 */
export function createBaseParser() {
  return acorn.Parser.extend(tsPlugin({ jsx: true }));
}

/**
 * Parse a TypeScript/TSX source string into an ESTree AST.
 * @param {string} source
 * @param {object} [options]
 * @param {string} [options.filename]
 * @returns {import('estree').Program}
 */
export function parse(source, options = {}) {
  const parser = createBaseParser();
  return parser.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    ranges: true,
    ...(options.filename ? { sourceFilename: options.filename } : {}),
  });
}
