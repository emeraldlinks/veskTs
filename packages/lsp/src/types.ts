/** @module types — Core type definitions for the Vesk LSP. */

// ── AST node shape (subset of acorn + acorn-ts-plugin) ────────

/** Base shape shared by every acorn/estree AST node. */
export interface BaseNode {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } };
  range?: [number, number];
}

export interface Identifier extends BaseNode {
  type: 'Identifier';
  name: string;
}

export interface Literal extends BaseNode {
  type: 'Literal';
  value: string | number | boolean | null | RegExp;
  regex?: { pattern: string; flags: string };
}

export interface Program extends BaseNode {
  type: 'Program';
  body: Statement[];
  sourceType: 'module' | 'script';
  __vskAnnotations?: VeskAnnotation[];
}

export type Statement =
  | ImportDeclaration
  | ExportNamedDeclaration
  | ExportDefaultDeclaration
  | VariableDeclaration
  | FunctionDeclaration
  | ClassDeclaration
  | ComponentDeclaration
  | ExpressionStatement
  | BlockStatement
  | ReturnStatement
  | IfStatement
  | ForStatement
  | ForOfStatement
  | ForInStatement
  | WhileStatement
  | SwitchStatement
  | TryStatement
  | ThrowStatement
  | TSInterfaceDeclaration
  | TSTypeAliasDeclaration
  | TSEnumDeclaration
  | TSDeclareFunction
  | TSModuleDeclaration
  | BreakStatement
  | ContinueStatement
  | LabeledStatement
  | EmptyStatement
  | DebuggerStatement
  | WithStatement
  | BaseNode;

export interface ImportDeclaration extends BaseNode {
  type: 'ImportDeclaration';
  specifiers: ImportSpecifier[];
  source: Literal;
  importKind?: 'value' | 'type';
}

export interface ImportSpecifier extends BaseNode {
  type: 'ImportSpecifier' | 'ImportDefaultSpecifier' | 'ImportNamespaceSpecifier';
  local: Identifier;
  imported?: Identifier;
}

export interface ExportNamedDeclaration extends BaseNode {
  type: 'ExportNamedDeclaration';
  declaration?: Statement;
  specifiers: ExportSpecifier[];
  source?: Literal;
}

export interface ExportDefaultDeclaration extends BaseNode {
  type: 'ExportDefaultDeclaration';
  declaration: Statement | Expression;
}

export interface ExportSpecifier extends BaseNode {
  type: 'ExportSpecifier';
  local: Identifier;
  exported: Identifier;
}

export interface VariableDeclaration extends BaseNode {
  type: 'VariableDeclaration';
  declarations: VariableDeclarator[];
  kind: 'var' | 'let' | 'const';
}

export interface VariableDeclarator extends BaseNode {
  type: 'VariableDeclarator';
  id: Pattern;
  init: Expression | null;
  lazy?: boolean;
  typeAnnotation?: TSTypeAnnotation;
}

export type Pattern =
  | Identifier
  | ArrayPattern
  | ObjectPattern
  | AssignmentPattern
  | RestElement
  | BaseNode;

export interface ArrayPattern extends BaseNode {
  type: 'ArrayPattern';
  elements: (Pattern | null)[];
}

export interface ObjectPattern extends BaseNode {
  type: 'ObjectPattern';
  properties: (Property | RestElement)[];
}

export interface Property extends BaseNode {
  type: 'Property';
  key: Identifier | Literal;
  value: Pattern;
  shorthand: boolean;
  computed: boolean;
}

export interface RestElement extends BaseNode {
  type: 'RestElement';
  argument: Pattern;
}

export interface AssignmentPattern extends BaseNode {
  type: 'AssignmentPattern';
  left: Pattern;
  right: Expression;
}

export interface FunctionDeclaration extends BaseNode {
  type: 'FunctionDeclaration';
  id: Identifier | null;
  params: Pattern[];
  body: BlockStatement;
  async?: boolean;
  generator?: boolean;
  returnType?: TSTypeAnnotation;
  typeParameters?: TSTypeParameterDeclaration;
}

export interface ComponentDeclaration extends BaseNode {
  type: 'ComponentDeclaration';
  id: Identifier;
  params: Pattern[];
  body: BlockStatement | ReturnStatement;
  client?: boolean;
  async?: boolean;
  returnType?: TSTypeAnnotation;
  typeParameters?: TSTypeParameterDeclaration;
}

export interface ClassDeclaration extends BaseNode {
  type: 'ClassDeclaration';
  id: Identifier | null;
  body: ClassBody;
  superClass?: Expression;
}

export interface ClassBody extends BaseNode {
  type: 'ClassBody';
  body: ClassMember[];
}

export type ClassMember = MethodDefinition | PropertyDefinition | BaseNode;

export interface MethodDefinition extends BaseNode {
  type: 'MethodDefinition';
  key: Expression;
  value: FunctionExpression;
  kind: 'constructor' | 'method' | 'get' | 'set';
}

export interface PropertyDefinition extends BaseNode {
  type: 'PropertyDefinition';
  key: Expression;
  value: Expression | null;
}

export interface BlockStatement extends BaseNode {
  type: 'BlockStatement';
  body: Statement[];
}

export interface ReturnStatement extends BaseNode {
  type: 'ReturnStatement';
  argument: Expression | null;
}

export interface ExpressionStatement extends BaseNode {
  type: 'ExpressionStatement';
  expression: Expression;
}

export interface IfStatement extends BaseNode {
  type: 'IfStatement';
  test: Expression;
  consequent: Statement;
  alternate: Statement | null;
}

export interface ForStatement extends BaseNode {
  type: 'ForStatement';
  init: VariableDeclaration | Expression | null;
  test: Expression | null;
  update: Expression | null;
  body: Statement;
}

export interface ForOfStatement extends BaseNode {
  type: 'ForOfStatement';
  left: VariableDeclaration | Pattern;
  right: Expression;
  body: Statement;
  await?: boolean;
}

export interface ForInStatement extends BaseNode {
  type: 'ForInStatement';
  left: VariableDeclaration | Pattern;
  right: Expression;
  body: Statement;
}

export interface WhileStatement extends BaseNode {
  type: 'WhileStatement';
  test: Expression;
  body: Statement;
}

export interface SwitchStatement extends BaseNode {
  type: 'SwitchStatement';
  discriminant: Expression;
  cases: SwitchCase[];
}

export interface SwitchCase extends BaseNode {
  type: 'SwitchCase';
  test: Expression | null;
  consequent: Statement[];
}

export interface TryStatement extends BaseNode {
  type: 'TryStatement';
  block: BlockStatement;
  handler: CatchClause | null;
  finalizer: BlockStatement | null;
}

export interface CatchClause extends BaseNode {
  type: 'CatchClause';
  param: Pattern | null;
  body: BlockStatement;
}

export interface ThrowStatement extends BaseNode {
  type: 'ThrowStatement';
  argument: Expression;
}

export interface BreakStatement extends BaseNode {
  type: 'BreakStatement';
  label?: Identifier;
}

export interface ContinueStatement extends BaseNode {
  type: 'ContinueStatement';
  label?: Identifier;
}

export interface LabeledStatement extends BaseNode {
  type: 'LabeledStatement';
  label: Identifier;
  body: Statement;
}

export interface EmptyStatement extends BaseNode {
  type: 'EmptyStatement';
}

export interface DebuggerStatement extends BaseNode {
  type: 'DebuggerStatement';
}

export interface WithStatement extends BaseNode {
  type: 'WithStatement';
  object: Expression;
  body: Statement;
}

export type Expression =
  | Identifier
  | Literal
  | AssignmentExpression
  | BinaryExpression
  | LogicalExpression
  | UnaryExpression
  | UpdateExpression
  | ConditionalExpression
  | CallExpression
  | NewExpression
  | MemberExpression
  | ArrowFunctionExpression
  | FunctionExpression
  | SequenceExpression
  | ObjectExpression
  | ArrayExpression
  | SpreadElement
  | TemplateLiteral
  | TaggedTemplateExpression
  | ThisExpression
  | ParenthesizedExpression
  | ChainExpression
  | TSAsExpression
  | TSSatisfiesExpression
  | TSTypeAssertion
  | TSNonNullExpression
  | BaseNode;

export interface AssignmentExpression extends BaseNode {
  type: 'AssignmentExpression';
  operator: string;
  left: Expression;
  right: Expression;
}

export interface BinaryExpression extends BaseNode {
  type: 'BinaryExpression';
  operator: string;
  left: Expression;
  right: Expression;
}

export interface LogicalExpression extends BaseNode {
  type: 'LogicalExpression';
  operator: string;
  left: Expression;
  right: Expression;
}

export interface UnaryExpression extends BaseNode {
  type: 'UnaryExpression';
  operator: string;
  argument: Expression;
  prefix: boolean;
}

export interface UpdateExpression extends BaseNode {
  type: 'UpdateExpression';
  operator: string;
  argument: Expression;
  prefix: boolean;
}

export interface ConditionalExpression extends BaseNode {
  type: 'ConditionalExpression';
  test: Expression;
  consequent: Expression;
  alternate: Expression;
}

export interface CallExpression extends BaseNode {
  type: 'CallExpression';
  callee: Expression;
  arguments: Expression[];
  optional?: boolean;
}

export interface NewExpression extends BaseNode {
  type: 'NewExpression';
  callee: Expression;
  arguments: Expression[];
}

export interface MemberExpression extends BaseNode {
  type: 'MemberExpression';
  object: Expression;
  property: Expression;
  computed: boolean;
  optional?: boolean;
}

export interface ArrowFunctionExpression extends BaseNode {
  type: 'ArrowFunctionExpression';
  params: Pattern[];
  body: BlockStatement | Expression;
  async?: boolean;
  expression?: boolean;
  returnType?: TSTypeAnnotation;
  typeParameters?: TSTypeParameterDeclaration;
}

export interface FunctionExpression extends BaseNode {
  type: 'FunctionExpression';
  id: Identifier | null;
  params: Pattern[];
  body: BlockStatement;
  async?: boolean;
}

export interface SequenceExpression extends BaseNode {
  type: 'SequenceExpression';
  expressions: Expression[];
}

export interface ObjectExpression extends BaseNode {
  type: 'ObjectExpression';
  properties: (Property | SpreadElement)[];
}

export interface ArrayExpression extends BaseNode {
  type: 'ArrayExpression';
  elements: (Expression | SpreadElement | null)[];
}

export interface SpreadElement extends BaseNode {
  type: 'SpreadElement';
  argument: Expression;
}

export interface TemplateLiteral extends BaseNode {
  type: 'TemplateLiteral';
  quasis: TemplateElement[];
  expressions: Expression[];
}

export interface TemplateElement extends BaseNode {
  type: 'TemplateElement';
  value: { raw: string; cooked: string };
  tail: boolean;
}

export interface TaggedTemplateExpression extends BaseNode {
  type: 'TaggedTemplateExpression';
  tag: Expression;
  quasi: TemplateLiteral;
}

export interface ThisExpression extends BaseNode {
  type: 'ThisExpression';
}

export interface ParenthesizedExpression extends BaseNode {
  type: 'ParenthesizedExpression';
  expression: Expression;
}

export interface ChainExpression extends BaseNode {
  type: 'ChainExpression';
  expression: Expression;
}

// ── TypeScript AST nodes ─────────────────────────────────────

export interface TSTypeAnnotation extends BaseNode {
  type: 'TSTypeAnnotation';
  typeAnnotation: TSType;
}

export type TSType =
  | TSKeywordType
  | TSTypeReference
  | TSArrayType
  | TSTupleType
  | TSUnionType
  | TSIntersectionType
  | TSTypeLiteral
  | TSLiteralType
  | TSFunctionType
  | TSConstructorType
  | TSTypeOperator
  | TSTypePredicate
  | TSIndexedAccessType
  | TSConditionalType
  | TSMappedType
  | TSSymbolType
  | TSSemplateLiteralType
  | TSInferType
  | TSImportType
  | TSParenthesizedType
  | BaseNode;

export interface TSKeywordType extends BaseNode {
  type:
    | 'TSNumberKeyword' | 'TSStringKeyword' | 'TSBooleanKeyword' | 'TSAnyKeyword'
    | 'TSUnknownKeyword' | 'TSVoidKeyword' | 'TSNeverKeyword' | 'TSNullKeyword'
    | 'TSUndefinedKeyword' | 'TSObjectKeyword' | 'TSBigIntKeyword' | 'TSSymbolKeyword';
}

export interface TSTypeReference extends BaseNode {
  type: 'TSTypeReference';
  typeName: Identifier | TSQualifiedName;
  typeParameters?: TSTypeParameterInstantiation;
}

export interface TSQualifiedName extends BaseNode {
  type: 'TSQualifiedName';
  left: Identifier | TSQualifiedName;
  right: Identifier;
}

export interface TSArrayType extends BaseNode {
  type: 'TSArrayType';
  elementType: TSType;
}

export interface TSTupleType extends BaseNode {
  type: 'TSTupleType';
  elementTypes: TSType[];
}

export interface TSUnionType extends BaseNode {
  type: 'TSUnionType';
  types: TSType[];
}

export interface TSIntersectionType extends BaseNode {
  type: 'TSIntersectionType';
  types: TSType[];
}

export interface TSTypeLiteral extends BaseNode {
  type: 'TSTypeLiteral';
  members: TSPropertySignature[];
}

export interface TSPropertySignature extends BaseNode {
  type: 'TSPropertySignature';
  key: Identifier | Literal;
  typeAnnotation?: TSTypeAnnotation;
  optional?: boolean;
}

export interface TSMethodSignature extends BaseNode {
  type: 'TSMethodSignature';
  key: Identifier;
  params: Pattern[];
  returnType?: TSTypeAnnotation;
  optional?: boolean;
}

export interface TSLiteralType extends BaseNode {
  type: 'TSLiteralType';
  literal: Literal;
}

export interface TSFunctionType extends BaseNode {
  type: 'TSFunctionType';
  parameters: Pattern[];
  returnType: TSTypeAnnotation;
}

export interface TSConstructorType extends BaseNode {
  type: 'TSConstructorType';
  parameters: Pattern[];
  returnType: TSTypeAnnotation;
}

export interface TSTypeOperator extends BaseNode {
  type: 'TSTypeOperator';
  operator: string;
  typeAnnotation: TSType;
}

export interface TSTypePredicate extends BaseNode {
  type: 'TSTypePredicate';
  parameterName: Identifier;
  typeAnnotation: TSTypeAnnotation;
}

export interface TSIndexedAccessType extends BaseNode {
  type: 'TSIndexedAccessType';
  objectType: TSType;
  indexType: TSType;
}

export interface TSConditionalType extends BaseNode {
  type: 'TSConditionalType';
  checkType: TSType;
  extendsType: TSType;
  trueType: TSType;
  falseType: TSType;
}

export interface TSMappedType extends BaseNode {
  type: 'TSMappedType';
  typeParameter: TSTypeParameterDeclaration;
  typeAnnotation?: TSTypeAnnotation;
  optional?: boolean;
}

export interface TSSymbolType extends BaseNode {
  type: 'TSSymbolType';
}

export interface TSSemplateLiteralType extends BaseNode {
  type: 'TSSemplateLiteralType';
}

export interface TSInferType extends BaseNode {
  type: 'TSInferType';
  typeParameter: TSTypeParameterDeclaration;
}

export interface TSImportType extends BaseNode {
  type: 'TSImportType';
  argument: Literal;
}

export interface TSParenthesizedType extends BaseNode {
  type: 'TSParenthesizedType';
  typeAnnotation: TSType;
}

export interface TSTypeParameterDeclaration extends BaseNode {
  type: 'TSTypeParameterDeclaration';
  params: TSTypeParameter[];
}

export interface TSTypeParameterInstantiation extends BaseNode {
  type: 'TSTypeParameterInstantiation';
  params: TSType[];
}

export interface TSTypeParameter extends BaseNode {
  type: 'TSTypeParameter';
  name: Identifier;
  constraint?: TSType;
  default?: TSType;
}

export interface TSInterfaceDeclaration extends BaseNode {
  type: 'TSInterfaceDeclaration';
  id: Identifier;
  body: TSInterfaceBody;
  typeParameters?: TSTypeParameterDeclaration;
  extends?: TSTypeReference[];
}

export interface TSInterfaceBody extends BaseNode {
  type: 'TSInterfaceBody';
  body: (TSPropertySignature | TSMethodSignature | TSCallSignatureDeclaration | TSIndexSignature)[];
}

export interface TSCallSignatureDeclaration extends BaseNode {
  type: 'TSCallSignatureDeclaration';
  parameters: Pattern[];
  returnType?: TSTypeAnnotation;
}

export interface TSIndexSignature extends BaseNode {
  type: 'TSIndexSignature';
  parameters: Pattern[];
  typeAnnotation?: TSTypeAnnotation;
}

export interface TSTypeAliasDeclaration extends BaseNode {
  type: 'TSTypeAliasDeclaration';
  id: Identifier;
  typeAnnotation: TSType;
  typeParameters?: TSTypeParameterDeclaration;
}

export interface TSEnumDeclaration extends BaseNode {
  type: 'TSEnumDeclaration';
  id: Identifier;
  members: TSEnumMember[];
}

export interface TSEnumMember extends BaseNode {
  type: 'TSEnumMember';
  id: Identifier | Literal;
  initializer?: Expression;
}

export interface TSAsExpression extends BaseNode {
  type: 'TSAsExpression';
  expression: Expression;
  typeAnnotation: TSTypeAnnotation;
}

export interface TSSatisfiesExpression extends BaseNode {
  type: 'TSSatisfiesExpression';
  expression: Expression;
  typeAnnotation: TSTypeAnnotation;
}

export interface TSTypeAssertion extends BaseNode {
  type: 'TSTypeAssertion';
  typeAnnotation: TSTypeAnnotation;
  expression: Expression;
}

export interface TSNonNullExpression extends BaseNode {
  type: 'TSNonNullExpression';
  expression: Expression;
}

export interface TSDeclareFunction extends BaseNode {
  type: 'TSDeclareFunction';
  id: Identifier | null;
  params: Pattern[];
  returnType?: TSTypeAnnotation;
}

export interface TSModuleDeclaration extends BaseNode {
  type: 'TSModuleDeclaration';
  id: Identifier | Literal;
  body?: TSModuleDeclaration | BlockStatement;
}

// ── JSX AST nodes ────────────────────────────────────────────

export interface JSXIdentifier extends BaseNode {
  type: 'JSXIdentifier';
  name: string;
}

export interface JSXMemberExpression extends BaseNode {
  type: 'JSXMemberExpression';
  object: JSXIdentifier | JSXMemberExpression;
  property: JSXIdentifier;
}

export interface JSXOpeningElement extends BaseNode {
  type: 'JSXOpeningElement';
  name: JSXIdentifier | JSXMemberExpression;
  attributes: (JSXAttribute | JSXSpreadAttribute)[];
  selfClosing: boolean;
}

export interface JSXClosingElement extends BaseNode {
  type: 'JSXClosingElement';
  name: JSXIdentifier | JSXMemberExpression;
}

export interface JSXAttribute extends BaseNode {
  type: 'JSXAttribute';
  name: JSXIdentifier;
  value: JSXExpressionContainer | Literal | JSXElement | null;
}

export interface JSXSpreadAttribute extends BaseNode {
  type: 'JSXSpreadAttribute';
  argument: Expression;
}

export interface JSXExpressionContainer extends BaseNode {
  type: 'JSXExpressionContainer';
  expression: Expression;
}

export interface JSXElement extends BaseNode {
  type: 'JSXElement';
  openingElement: JSXOpeningElement;
  children: JSXChild[];
  closingElement: JSXClosingElement | null;
}

export interface JSXFragment extends BaseNode {
  type: 'JSXFragment';
  openingFragment: BaseNode;
  children: JSXChild[];
  closingFragment: BaseNode;
}

export interface JSXText extends BaseNode {
  type: 'JSXText';
  value: string;
  raw: string;
}

export type JSXChild = JSXElement | JSXFragment | JSXExpressionContainer | JSXText;

// ── Vesk-specific AST nodes ──────────────────────────────────

export interface VeskAnnotation {
  kind: 'for-clause';
  forStart: number;
  clauseStart: number;
  clauseEnd: number;
  keyRange?: [number, number];
  indexName?: string;
}

// ── Project index types ──────────────────────────────────────

/** A named export from a project file. */
export interface ExportInfo {
  /** Symbol name as it appears in `export` or `export default`. */
  name: string;
  /** True when exported via `export default`. */
  isDefault: boolean;
  /** True when re-exported from another module (`export { x } from '...'`). */
  isReExport: boolean;
  /** 0-based line number. */
  line: number;
  /** 0-based column offset. */
  column: number;
}

/** A component declared in a `.vsk` file. */
export interface ComponentInfo {
  /** Component name (e.g. `Card`). */
  name: string;
  /** 0-based line number. */
  line: number;
  /** 0-based column offset. */
  column: number;
  /** Whether the component is exported. */
  exported: boolean;
  /** Whether it is the default export. */
  defaultExport: boolean;
}

/** A top-level declaration (function, const, class, interface, type, enum). */
export interface DeclInfo {
  /** Declaration name. */
  name: string;
  /** 0-based line number. */
  line: number;
  /** 0-based column offset. */
  column: number;
  /** Kind of declaration: `function`, `component`, `variable`, `class`, `interface`, `type`, `enum`. */
  kind: 'function' | 'component' | 'variable' | 'class' | 'interface' | 'type' | 'enum';
}

/** A resolved type declaration from `.d.ts` files or local interfaces/types. */
export interface TypeDeclaration {
  /** Fully qualified name (e.g. `Props`, `React.FC`). */
  name: string;
  /** Kind of type declaration. */
  kind: 'interface' | 'type' | 'function' | 'class' | 'enum' | 'const';
  /** File path where this type is declared. */
  filePath: string;
  /** 0-based start offset in the source. */
  start: number;
  /** 0-based end offset in the source. */
  end: number;
  /** 0-based line number. */
  line: number;
  /** For interfaces/types: the resolved property map (name → type string). */
  members?: Map<string, string>;
  /** For functions: parameter types. */
  params?: FunctionParam[];
  /** For functions/classes: return type string. */
  returnType?: string;
  /** JSDoc comment if present. */
  jsdoc?: string;
  /** Generic type parameters if present. */
  typeParams?: string[];
  /** Interface heritage (extends). */
  extends?: string[];
}

/** A function parameter with optional type info. */
export interface FunctionParam {
  /** Parameter name. */
  name: string;
  /** Type string (e.g. `string`, `number`, `Props`). */
  type?: string;
  /** Whether the parameter is optional. */
  optional: boolean;
  /** Default value expression text if present. */
  defaultValue?: string;
}

/** A single tracked symbol within a document. */
export interface SymbolInfo {
  /** Symbol name. */
  name: string;
  /** 0-based start offset in source. */
  start: number;
  /** 0-based end offset in source. */
  end: number;
  /** Semantic kind of the symbol. */
  kind: SymbolKind;
  /** Resolved or inferred type string, if available. */
  type?: string;
  /** 0-based start offset of the declaration statement. */
  declStart?: number;
  /** 0-based end offset of the declaration statement. */
  declEnd?: number;
  /** JSDoc comment for this symbol, if present. */
  jsdoc?: string;
}

/** Semantic kind of a tracked symbol. */
export type SymbolKind =
  | 'variable'
  | 'reactive'
  | 'import'
  | 'function'
  | 'class'
  | 'param'
  | 'interface'
  | 'type'
  | 'enum'
  | 'const'
  | 'property';

/** A component declaration discovered during analysis. */
export interface ComponentDeclInfo {
  /** Component name. */
  name: string;
  /** 0-based start offset. */
  start: number;
  /** 0-based end offset. */
  end: number;
  /** 0-based line number. */
  line: number;
  /** Names of destructured/positional parameters. */
  paramNames: string[];
  /** Name of the props parameter (e.g. `props`), or null. */
  propsName: string | null;
  /** Whether the component is async. */
  async?: boolean;
  /** Inferred prop types (name → type string), from TS annotations. */
  propTypes?: Map<string, string>;
  /** Generic type parameter names. */
  typeParams?: string[];
}

/** An attribute on a JSX opening tag. */
export interface AttrInfo {
  /** Attribute name. */
  name: string;
  /** 0-based start offset of the attribute name. */
  nameStart: number;
  /** 0-based end offset of the attribute name. */
  nameEnd: number;
  /** 0-based start offset of the attribute value. */
  valueStart: number;
  /** 0-based end offset of the attribute value. */
  valueEnd: number;
  /** Whether the value is a JSX expression (`{...}`). */
  isExpression: boolean;
  /** Resolved type of the attribute value, if inferable. */
  valueType?: string;
}

/** Information about a JSX opening tag encountered in the source. */
export interface OpeningTagInfo {
  /** Tag name (e.g. `div`, `Card`). */
  name: string;
  /** 0-based start offset of the opening `<`. */
  start: number;
  /** 0-based end offset of the `>` or `/>`. */
  end: number;
  /** 0-based start offset of the tag name itself. */
  nameStart: number;
  /** 0-based end offset of the tag name. */
  nameEnd: number;
  /** True when the tag starts with an uppercase letter (component). */
  isComponent: boolean;
  /** Attributes on this tag. */
  attrs: AttrInfo[];
}

/** An identifier that is used (referenced) but not bound in the current scope. */
export interface UsedIdentifier {
  /** Identifier name. */
  name: string;
  /** 0-based offset in source. */
  start: number;
}

/** Result of full-document analysis. */
export interface DocAnalysis {
  /** Symbols keyed by name. Each name may have multiple declarations (shadowing). */
  symbols: Map<string, SymbolInfo[]>;
  /** Component declarations found in the document. */
  components: ComponentDeclInfo[];
  /** JSX expression container ranges. */
  expressions: { start: number; end: number }[];
  /** JSX opening tags. */
  tags: OpeningTagInfo[];
  /** Unbound identifiers (candidates for "undefined" diagnostics). */
  used: UsedIdentifier[];
  /** Local import specifiers. */
  imports: Set<string>;
  /** Whether the document parsed successfully. */
  ok: boolean;
}

/** Workspace settings from the client. */
export interface VeskSettings {
  /** Enable Tailwind CSS completions in `class` attributes. */
  tailwindCompletion: boolean;
  /** Enable tag auto-close in the editor. */
  tagAutoClose: boolean;
}

/** Path alias from `tsconfig.json` / `jsconfig.json`. */
export interface PathAlias {
  /** Prefix (e.g. `@`). */
  prefix: string;
  /** Resolved target directories. */
  targets: string[];
}

/** Index of all project files and their metadata. */
export interface ProjectIndex {
  /** Absolute path to the workspace root. */
  workspaceRoot: string;
  /** Absolute path to the `app/` or `src/app/` directory, or null. */
  appDir: string | null;
  /** Base URL from tsconfig. */
  baseUrl: string;
  /** Path aliases from tsconfig. */
  pathAliases: PathAlias[];
  /** Map of file path → file metadata. */
  files: Map<string, ProjectFile>;
  /** Map of component name → source file path (from route/component scanning). */
  componentSources: Map<string, string>;
  /** Tailwind CSS class names for completion. */
  tailwindClasses: Set<string>;
  /** Type declarations resolved from `.d.ts` files and local `interface`/`type` statements. */
  typeDeclarations: Map<string, TypeDeclaration>;
  /** Map of file path → raw `.d.ts` source (for hover/documentation). */
  dtsSources: Map<string, string>;
}

/** Metadata for a single project file. */
export interface ProjectFile {
  /** Document URI (set when opened). */
  uri: string;
  /** Absolute file path. */
  path: string;
  /** Named exports. */
  exports: ExportInfo[];
  /** Component declarations (`.vsk` only). */
  components: ComponentInfo[];
  /** Top-level declarations. */
  declarations: DeclInfo[];
  /** Last modified timestamp (for cache invalidation). */
  lastModified: number;
}
