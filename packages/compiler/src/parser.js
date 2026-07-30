import * as acorn from "acorn";
import { tsPlugin } from "./acorn-ts-plugin/index.js";
import { VeskParserPlugin } from "./vesk-plugin.js";
function createBaseParser() {
  return acorn.Parser.extend(tsPlugin(), VeskParserPlugin());
}
function parse(source, options = {}) {
  const parser = createBaseParser();
  return parser.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
    ranges: true,
    ...options.filename ? { sourceFilename: options.filename } : {}
  });
}
export {
  createBaseParser,
  parse
};
