export { parse, createBaseParser } from '@vesk/compiler/src/parser';
export { VeskParserPlugin } from '@vesk/compiler/src/vesk-plugin';
export { generateIR } from '@vesk/compiler/src/ir-generator';
export { render } from '@vesk/compiler/src/server-codegen';
export { compileClient, compile } from '@vesk/compiler/src/client-codegen';
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
} from '@vesk/compiler/src/ir';
export type { IRNode } from '@vesk/compiler/src/ir';

export type { VeskPlugin } from '@vesk/compiler/src/types';
export type { VeskConfig } from '@vesk/compiler/src/types';
export type { VeskSecurity } from '@vesk/compiler/src/types';
export type { VeskCors } from '@vesk/compiler/src/types';
export type { VeskRateLimit } from '@vesk/compiler/src/types';

export { defineConfig, validateConfig, preset, definePlugin } from '@vesk/compiler/src/config';
export { scanRoutes, scanComponents, collectSources, matchUrl } from '@vesk/compiler/src/router';
