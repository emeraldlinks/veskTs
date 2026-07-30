export { parse, createBaseParser } from './parser.js';
export { VeskParserPlugin } from './vesk-plugin.js';
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
export type { IRNode } from './ir.js';

export type { VeskPlugin } from './types.js';
export type { VeskConfig } from './types.js';
export type { VeskSecurity } from './types.js';
export type { VeskCors } from './types.js';
export type { VeskRateLimit } from './types.js';

export { defineConfig, validateConfig, preset, definePlugin } from './config.js';
export { scanRoutes, scanComponents, collectSources, matchUrl } from './router.js';
