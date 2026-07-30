import * as acorn from 'acorn';
import type { Options } from 'acorn';
import type { Program } from 'estree';
import { tsPlugin } from './acorn-ts-plugin/index.js';
import { VeskParserPlugin } from './vesk-plugin.js';

export interface ParseOptions {
  filename?: string;
  [key: string]: unknown;
}

export function createBaseParser(): typeof acorn.Parser {
  return acorn.Parser.extend(tsPlugin() as unknown as (BaseParser: typeof acorn.Parser) => typeof acorn.Parser, VeskParserPlugin() as unknown as (BaseParser: typeof acorn.Parser) => typeof acorn.Parser);
}

export function parse(source: string, options: ParseOptions = {}): Program {
  const parser = createBaseParser();
  return parser.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    ranges: true,
    ...(options.filename ? { sourceFilename: options.filename } : {}),
  } as Options) as unknown as Program;
}
