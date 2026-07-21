/**
 * Vesk Parser
 *
 * Acorn + TypeScript + Vesk plugin. Parses .vsk files with Vesk-specific
 * grammar extensions: component declarations, reactive bindings, etc.
 */
import * as acorn from 'acorn';
import { tsPlugin } from '@sveltejs/acorn-typescript';
import { VeskPlugin } from './vesk-plugin.js';

/**
 * Create the Vesk parser (Acorn + TypeScript + Vesk plugin).
 */
export function createBaseParser() {
  return acorn.Parser.extend(tsPlugin({ jsx: true }), VeskPlugin());
}

/**
 * Parse a Vesk source string into an AST.
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
