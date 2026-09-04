import type { Node as ESTreeNode } from 'estree';

export class Expression {
  raw: string;
  ast: ESTreeNode | null;
  source: string | null;
  deps: string[];

  constructor(raw: string, deps: string[] = [], ast: ESTreeNode | null = null, source: string | null = null) {
    this.raw = raw;
    this.deps = deps;
    this.ast = ast;
    this.source = source;
  }
}

export class IRRoot {
  components: ComponentIR[];
  imports: string[];
  importedNames: Set<string>;
  staticProps: string | null;
  loadFn: string | null;
  topLevelCode: string[];

  constructor(
    components: ComponentIR[],
    imports: string[] = [],
    importedNames: Set<string> = new Set(),
    staticProps: string | null = null,
    loadFn: string | null = null,
    topLevelCode: string[] = []
  ) {
    this.components = components;
    this.imports = imports;
    this.importedNames = importedNames;
    this.staticProps = staticProps;
    this.loadFn = loadFn;
    this.topLevelCode = topLevelCode;
  }
}

export class ComponentIR {
  name: string;
  paramNames: string[];
  propsType: string | null;
  isClient: boolean;
  isAsync: boolean;
  ssrAwait: boolean;
  mode: 'expression' | 'statement';
  body: IRNode[];
  style: string | null;
  exported: boolean;
  defaultExport: boolean;

  constructor(
    name: string,
    paramNames: string[],
    body: IRNode[],
    opts: {
      isClient?: boolean;
      isAsync?: boolean;
      ssrAwait?: boolean;
      mode?: 'expression' | 'statement';
      exported?: boolean;
      defaultExport?: boolean;
      propsType?: string | null;
    } = {}
  ) {
    this.name = name;
    this.paramNames = paramNames;
    this.body = body;
    this.isClient = opts.isClient ?? false;
    this.isAsync = opts.isAsync ?? false;
    this.ssrAwait = opts.ssrAwait ?? false;
    this.mode = opts.mode ?? 'expression';
    this.style = null;
    this.exported = opts.exported ?? false;
    this.defaultExport = opts.defaultExport ?? false;
    this.propsType = opts.propsType ?? null;
  }
}

export class StaticNode {
  tag: string;
  attributes: { name: string; value: string }[];
  children: IRNode[];
  selfClosing: boolean;
  keyExpr: Expression | null;

  constructor(
    tag: string,
    attributes: { name: string; value: string }[],
    children: IRNode[],
    keyExpr: Expression | null = null
  ) {
    this.tag = tag;
    this.attributes = attributes;
    this.children = children;
    this.selfClosing = false;
    this.keyExpr = keyExpr;
  }
}

export class TextNode {
  value: string;

  constructor(value: string) {
    this.value = value;
  }
}

export class DynamicBinding {
  kind: 'text' | 'attribute';
  target: string | null;
  expression: Expression;

  constructor(expression: Expression, kind: 'text' | 'attribute' = 'text', target: string | null = null) {
    this.expression = expression;
    this.kind = kind;
    this.target = target;
  }
}

export class OpaqueDynamicRegion {
  condition: Expression;
  consequentNodes: IRNode[];
  alternateNodes: IRNode[];

  constructor(condition: Expression, consequentNodes: IRNode[], alternateNodes: IRNode[] = []) {
    this.condition = condition;
    this.consequentNodes = consequentNodes;
    this.alternateNodes = alternateNodes;
  }
}

export class MapRegion {
  expression: Expression;
  itemVariable: string;
  indexVariable: string | null;
  bodyTemplate: IRNode[];
  keyExpr: Expression | null;
  alternateNodes: IRNode[];

  constructor(expression: Expression, itemVariable: string, bodyTemplate: IRNode[], keyExpr: Expression | null = null, indexVariable: string | null = null, alternateNodes: IRNode[] = []) {
    this.expression = expression;
    this.itemVariable = itemVariable;
    this.indexVariable = indexVariable;
    this.bodyTemplate = bodyTemplate;
    this.keyExpr = keyExpr;
    this.alternateNodes = alternateNodes;
  }
}

export class ComponentRef {
  componentName: string;

  constructor(componentName: string) {
    this.componentName = componentName;
  }
}

export class ComponentCall {
  componentName: string;
  props: { name: string; value: Expression }[];
  spreadProps: Expression[];
  children: IRNode[];
  start: number;
  /**
   * Raw JS expression for the component value when the JSX tag is a member
   * expression (e.g. `<it.icon>` → `it.icon`). Dotted tags can never be HTML
   * elements or registry names, so codegen must invoke this expression
   * directly instead of resolving `componentName` through the registry.
   */
  calleeExpr: string | null;

  constructor(
    componentName: string,
    props: { name: string; value: Expression }[],
    children: IRNode[] = [],
    spreadProps: Expression[] = [],
    start = -1,
    calleeExpr: string | null = null
  ) {
    this.componentName = componentName;
    this.props = props;
    this.children = children;
    this.spreadProps = spreadProps;
    this.start = start;
    this.calleeExpr = calleeExpr;
  }
}

export class SlotNode {
  constructor() {}
}

export class WhileLoop {
  condition: Expression;
  bodyTemplate: IRNode[];
  isDoWhile: boolean;

  constructor(condition: Expression, bodyTemplate: IRNode[], isDoWhile: boolean = false) {
    this.condition = condition;
    this.bodyTemplate = bodyTemplate;
    this.isDoWhile = isDoWhile;
  }
}

export class SwitchCase {
  body: IRNode[];

  constructor(body: IRNode[]) {
    this.body = body;
  }
}

export class SwitchBlock {
  discriminant: Expression;
  cases: Array<{ test: Expression | null; body: IRNode[] }>;

  constructor(discriminant: Expression, cases: Array<{ test: Expression | null; body: IRNode[] }>) {
    this.discriminant = discriminant;
    this.cases = cases;
  }
}

export class TryCatch {
  bodyTemplate: IRNode[];
  catchBody: IRNode[];
  catchParamName: string | null;

  constructor(bodyTemplate: IRNode[], catchBody: IRNode[], catchParamName: string | null = null) {
    this.bodyTemplate = bodyTemplate;
    this.catchBody = catchBody;
    this.catchParamName = catchParamName;
  }
}

export class TrackDecl {
  name: string;
  rawName: string | null;
  init: string;

  constructor(name: string, init: string, rawName: string | null) {
    this.name = name;
    this.init = init;
    this.rawName = rawName || null;
  }
}

export class RuntimeStatement {
  raw: string;
  ast: ESTreeNode | null;
  source: string | null;

  constructor(raw: string, ast: ESTreeNode | null = null, source: string | null = null) {
    this.raw = raw;
    this.ast = ast;
    this.source = source;
  }
}

export class ForLoop {
  init: string;
  condition: Expression;
  update: string;
  bodyTemplate: IRNode[];
  kind: 'for' | 'for-in';

  constructor(init: string, condition: Expression, update: string, bodyTemplate: IRNode[], kind: 'for' | 'for-in' = 'for') {
    this.init = init;
    this.condition = condition;
    this.update = update;
    this.bodyTemplate = bodyTemplate;
    this.kind = kind;
  }
}

export class ServerBlock {
  children: IRNode[];
  constructor(children: IRNode[]) {
    this.children = children;
  }
}

export class ClientBlock {
  children: IRNode[];
  constructor(children: IRNode[]) {
    this.children = children;
  }
}

export class HeadBlock {
  children: IRNode[];
  constructor(children: IRNode[]) {
    this.children = children;
  }
}

export type IRNode =
  | StaticNode
  | TextNode
  | DynamicBinding
  | OpaqueDynamicRegion
  | MapRegion
  | WhileLoop
  | SwitchBlock
  | TryCatch
  | ForLoop
  | TrackDecl
  | RuntimeStatement
  | ComponentRef
  | ComponentCall
  | ServerBlock
  | ClientBlock
  | HeadBlock
  | SlotNode;
