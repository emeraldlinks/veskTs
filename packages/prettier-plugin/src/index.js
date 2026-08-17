import { createBaseParser } from '@vesk/compiler';
import { preprocessForClauses } from '@vesk/compiler/src/parser';
import { attachComments } from './comments.js';
import { printVeskNode } from './print.js';

export const languages = [
  {
    name: 'vesk',
    parsers: ['vesk'],
    extensions: ['.vsk'],
    vscodeLanguageIds: ['vsk'],
    tmScope: 'source.vsk',
  },
];

/**
 * @param {string} text
 * @param {import('prettier').ParserOptions} options
 * @returns {import('estree').Program}
 */
function parseVesk(text, options) {
  const parser = createBaseParser();
  const { code, annotations } = preprocessForClauses(text);
  const comments = [];
  const ast = parser.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    ranges: true,
    ...(options.filepath ? { sourceFilename: options.filepath } : {}),
    onComment: comments,
  });

  if (annotations.length > 0) {
    ast.__vskAnnotations = annotations;
  }
  // The printer splices `; key …` / `; index …` clauses back from the original
  // text, so stash both on the options object used by print().
  options.__vskAnnotations = annotations;

  attachComments(ast, comments);

  return ast;
}

/**
 * @param {import('estree').Node} node
 * @returns {number}
 */
function locStart(node) {
  return node.start;
}

/**
 * @param {import('estree').Node} node
 * @returns {number}
 */
function locEnd(node) {
  return node.end;
}

export const parsers = {
  vesk: {
    astFormat: 'vesk-ast',
    parse: parseVesk,
    locStart,
    locEnd,
  },
};

export const printers = {
  'vesk-ast': {
    print: printVeskNode,
  },
};

export default { languages, parsers, printers };
