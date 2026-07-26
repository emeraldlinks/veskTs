/**
 * Vesk IR Node Classes
 *
 * Tree-shaped intermediate representation consumed by codegen stages.
 * Not JSON-serializable — uses class instances for direct method dispatch.
 *
 * See /docs/decisions/001-ir-format.md for rationale.
 */

/**
 * Wraps a JS expression with its AST node and source text.
 */
export class Expression {
	/** @type {string} */
	raw;
	/** @type {import('estree').Node | null} */
	ast;
	/** @type {string | null} */
	source;
	/** @type {string[]} */
	deps;

	/**
	 * @param {string} raw — original source expression
	 * @param {string[]} [deps] — reactive dependency names (empty for server-only)
	 * @param {import('estree').Node | null} [ast] — ESTree AST node
	 * @param {string | null} [source] — full original source
	 */
	constructor(raw, deps = [], ast = null, source = null) {
		this.raw = raw;
		this.deps = deps;
		this.ast = ast;
		this.source = source;
	}
}

/**
 * Top-level IR container for a compiled module.
 */
export class IRRoot {
	/** @type {ComponentIR[]} */
	components;
	/** @type {string[]} */
	imports;
	/** @type {Set<string>} */
	importedNames;
	/** @type {string | null} */
	staticProps;
	/** @type {string | null} */
	loadFn;
	/** @type {string[]} */
	topLevelCode;

	/**
	 * @param {ComponentIR[]} components
	 * @param {string[]} [imports]
	 * @param {Set<string>} [importedNames]
	 * @param {string | null} [staticProps]
	 * @param {string | null} [loadFn]
	 * @param {string[]} [topLevelCode]
	 */
	constructor(components, imports = [], importedNames = new Set(), staticProps = null, loadFn = null, topLevelCode = []) {
		this.components = components;
		this.imports = imports;
		this.importedNames = importedNames;
		this.staticProps = staticProps;
		this.loadFn = loadFn;
		this.topLevelCode = topLevelCode;
	}
}

/**
 * IR for a single component.
 */
export class ComponentIR {
	/** @type {string} */
	name;
	/** @type {string[]} */
	paramNames;
	/** @type {boolean} */
	isClient;
	/** @type {boolean} */
	isAsync;
	/** @type {'expression' | 'statement'} */
	mode;
	/** @type {IRNode[]} */
	body;
	/** @type {null} */
	style;

	/**
	 * @param {string} name
	 * @param {string[]} paramNames
	 * @param {IRNode[]} body
	 * @param {object} [opts]
	 * @param {boolean} [opts.isClient]
	 * @param {boolean} [opts.isAsync]
	 * @param {'expression' | 'statement'} [opts.mode]
	 * @param {boolean} [opts.exported]
	 * @param {boolean} [opts.defaultExport]
	 */
	constructor(name, paramNames, body, opts = {}) {
		this.name = name;
		this.paramNames = paramNames;
		this.body = body;
		this.isClient = opts.isClient ?? false;
		this.isAsync = opts.isAsync ?? false;
		this.mode = opts.mode ?? 'expression';
		this.style = null;
		this.exported = opts.exported ?? false;
		this.defaultExport = opts.defaultExport ?? false;
	}
}

/**
 * Static HTML element with tag, attributes, and children.
 */
export class StaticNode {
	/** @type {string} */
	tag;
	/** @type {{ name: string, value: string }[]} */
	attributes;
	/** @type {IRNode[]} */
	children;
	/** @type {boolean} */
	selfClosing;
	/** @type {import('./ir.js').Expression | null} */
	keyExpr;

	/**
	 * @param {string} tag
	 * @param {{ name: string, value: string }[]} attributes
	 * @param {IRNode[]} children
	 * @param {import('./ir.js').Expression | null} [keyExpr]
	 */
	constructor(tag, attributes, children, keyExpr = null) {
		this.tag = tag;
		this.attributes = attributes;
		this.children = children;
		this.selfClosing = false;
		this.keyExpr = keyExpr;
	}
}

/**
 * Literal text node.
 */
export class TextNode {
	/** @type {string} */
	value;

	/**
	 * @param {string} value
	 */
	constructor(value) {
		this.value = value;
	}
}

/**
 * Dynamic expression binding — text interpolation or attribute value.
 */
export class DynamicBinding {
	/** @type {'text' | 'attribute'} */
	kind;
	/** @type {string | null} */
	target;
	/** @type {Expression} */
	expression;

	/**
	 * @param {Expression} expression
	 * @param {'text' | 'attribute'} [kind]
	 * @param {string | null} [target]
	 */
	constructor(expression, kind = 'text', target = null) {
		this.expression = expression;
		this.kind = kind;
		this.target = target;
	}
}

/**
 * Opaque dynamic region — for expression-mode `.map()`, conditionals, and
 * any expression that can't be statically analyzed. Uses runtime evaluation.
 */
export class OpaqueDynamicRegion {
	/** @type {Expression} */
	condition;
	/** @type {IRNode[]} */
	consequentNodes;
	/** @type {IRNode[]} */
	alternateNodes;

	/**
	 * @param {Expression} condition
	 * @param {IRNode[]} consequentNodes
	 * @param {IRNode[]} [alternateNodes]
	 */
	constructor(condition, consequentNodes, alternateNodes = []) {
		this.condition = condition;
		this.consequentNodes = consequentNodes;
		this.alternateNodes = alternateNodes;
	}
}

/**
 * Region for `.map()` calls — renders a list by iterating an expression.
 */
export class MapRegion {
	/** @type {Expression} */
	expression;
	/** @type {string} */
	itemVariable;
	/** @type {IRNode[]} */
	bodyTemplate;
	/** @type {Expression | null} */
	keyExpr;

	/**
	 * @param {Expression} expression — the .map() call expression
	 * @param {string} itemVariable — loop variable name
	 * @param {IRNode[]} bodyTemplate — IR for the body of the map callback
	 * @param {Expression | null} [keyExpr]
	 */
	constructor(expression, itemVariable, bodyTemplate, keyExpr = null) {
		this.expression = expression;
		this.itemVariable = itemVariable;
		this.bodyTemplate = bodyTemplate;
		this.keyExpr = keyExpr;
	}
}

/**
 * Component reference declaration — `let &[Child] = track()`.
 * On the server, this is a no-op (component is already in the map).
 * On the client, this creates a reactive cell that holds the component reference.
 */
export class ComponentRef {
	/** @type {string} */
	componentName;

	/**
	 * @param {string} componentName — the identifier bound by the destructuring
	 */
	constructor(componentName) {
		this.componentName = componentName;
	}
}

/**
 * Reference to a child component, resolved at render time.
 */
export class ComponentCall {
	/** @type {string} */
	componentName;
	/** @type {{ name: string, value: Expression }[]} */
	props;
	/** @type {Expression[]} */
	spreadProps;
	/** @type {IRNode[]} */
	children;

	/**
	 * @param {string} componentName
	 * @param {{ name: string, value: Expression }[]} props
	 * @param {IRNode[]} [children]
	 * @param {Expression[]} [spreadProps]
	 */
	constructor(componentName, props, children = [], spreadProps = []) {
		this.componentName = componentName;
		this.props = props;
		this.children = children;
		this.spreadProps = spreadProps;
	}
}

export class SlotNode {
	/**
	 * Marker for where a component's children are inserted
	 * (equivalent to React's `{props.children}` or Vue's `<slot/>`).
	 */
	constructor() {}
}

/**
 * Loop for `while`/`do-while` at body level.
 * Server: evaluates condition, renders body for each iteration.
 * Client: reactive loop that re-evaluates condition on dependency change.
 */
export class WhileLoop {
	/** @type {Expression} */
	condition;
	/** @type {IRNode[]} */
	bodyTemplate;
	/** @type {boolean} */
	isDoWhile;

	/**
	 * @param {Expression} condition
	 * @param {IRNode[]} bodyTemplate
	 * @param {boolean} [isDoWhile]
	 */
	constructor(condition, bodyTemplate, isDoWhile = false) {
		this.condition = condition;
		this.bodyTemplate = bodyTemplate;
		this.isDoWhile = isDoWhile;
	}
}

/**
 * Switch at body level — each case body is rendered when test matches.
 */
export class SwitchCase {
	/** @type {IRNode[]} */
	body;

	/**
	 * @param {IRNode[]} body
	 */
	constructor(body) {
		this.body = body;
	}
}

/**
 * Switch at body level.
 */
export class SwitchBlock {
	/** @type {Expression} */
	discriminant;
	/** @type {Array<{ test: Expression | null, body: IRNode[] }>} */
	cases;

	/**
	 * @param {Expression} discriminant
	 * @param {Array<{ test: Expression | null, body: IRNode[] }>} cases
	 */
	constructor(discriminant, cases) {
		this.discriminant = discriminant;
		this.cases = cases;
	}
}

/**
 * Try/catch at body level.
 * Server: renders bodyTemplate; if it throws, renders catchBody instead.
 * Client: wraps DOM creation in try-catch, renders catchBody on error.
 */
export class TryCatch {
	/** @type {IRNode[]} */
	bodyTemplate;
	/** @type {IRNode[]} */
	catchBody;
	/** @type {string | null} */
	catchParamName;

	/**
	 * @param {IRNode[]} bodyTemplate
	 * @param {IRNode[]} catchBody
	 * @param {string | null} [catchParamName]
	 */
	constructor(bodyTemplate, catchBody, catchParamName = null) {
		this.bodyTemplate = bodyTemplate;
		this.catchBody = catchBody;
		this.catchParamName = catchParamName;
	}
}

/**
 * Track declaration — `let &[name] = track(init)`.
 * Server: no-op (track declarations don't affect HTML).
 * Client: generates a reactive Cell.
 */
export class TrackDecl {
	/** @type {string} */
	name;
	/** @type {string | null} */
	rawName;
	/** @type {string} */
	init;

	/**
	 * @param {string} name — the auto-unwrapping variable name
	 * @param {string} init — the initializer source text (e.g. "track(0)")
	 * @param {string | null} [rawName] — optional raw Cell variable name
	 */
	constructor(name, init, rawName) {
		this.name = name;
		this.init = init;
		this.rawName = rawName || null;
	}
}

/**
 * Wraps a JS/TS statement that doesn't contain JSX — executed as-is at render time.
 * Variables declared here are available to subsequent JSX through the render scope.
 */
export class RuntimeStatement {
	/** @type {string} */
	raw;
	/** @type {import('estree').Node | null} */
	ast;
	/** @type {string | null} */
	source;

	/**
	 * @param {string} raw — original source text of the statement
	 * @param {import('estree').Node | null} [ast] — ESTree AST node
	 * @param {string | null} [source] — full original source
	 */
	constructor(raw, ast = null, source = null) {
		this.raw = raw;
		this.ast = ast;
		this.source = source;
	}
}

/**
 * Standard C-style for loop at body level.
 * Server: executes init once, then renders body while condition holds, running update after each iteration.
 * Supports `for(;;)`, `for-in`, and `for-of` via the `kind` field.
 */
export class ForLoop {
	/** @type {string} */
	init;
	/** @type {Expression} */
	condition;
	/** @type {string} */
	update;
	/** @type {IRNode[]} */
	bodyTemplate;
	/** @type {'for' | 'for-in'} */
	kind;

	/**
	 * @param {string} init — init statement text (e.g. "let i = 0")
	 * @param {Expression} condition — loop condition expression
	 * @param {string} update — update statement text (e.g. "i++")
	 * @param {IRNode[]} bodyTemplate
	 * @param {'for' | 'for-in'} [kind]
	 */
	constructor(init, condition, update, bodyTemplate, kind = 'for') {
		this.init = init;
		this.condition = condition;
		this.update = update;
		this.bodyTemplate = bodyTemplate;
		this.kind = kind;
	}
}

/**
 * Server-only block — children are stripped from client bundle.
 */
export class ServerBlock {
	/** @type {import('./ir.js').IRNode[]} */
	children;
	constructor(children) {
		this.children = children;
	}
}

/**
 * Client-only block — children are stripped from server output.
 */
export class ClientBlock {
	/** @type {import('./ir.js').IRNode[]} */
	children;
	constructor(children) {
		this.children = children;
	}
}

/**
 * Head block — contains title, meta, link, etc. for server-rendering into <head>.
 */
export class HeadBlock {
	/** @type {import('./ir.js').IRNode[]} */
	children;
	constructor(children) {
		this.children = children;
	}
}

/**
 * @typedef {StaticNode | TextNode | DynamicBinding | OpaqueDynamicRegion | MapRegion | WhileLoop | SwitchBlock | TryCatch | ForLoop | TrackDecl | RuntimeStatement | ComponentRef | ComponentCall | ServerBlock | ClientBlock | HeadBlock | SlotNode} IRNode
 */
