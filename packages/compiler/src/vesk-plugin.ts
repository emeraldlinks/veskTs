import * as acorn from 'acorn';
import type { Options } from 'acorn';

declare module 'acorn' {
  interface Parser {
    pos: number;
    start: number;
    end: number;
    type: any;
    value: any;
    exprAllowed: boolean;
    inType: boolean;
    curContext(): any;
    readToken(code: number): any;
    isLet(context: any): boolean;
    parseBindingAtom(): any;
    parseExpression(noIn: boolean, refDestructuringErrors: any): any;
    parseStatement(context: any, ...args: any[]): any;
    parseBlock(createNewLexicalScope?: boolean, node?: any, exitStrict?: boolean): any;
    startNode(): any;
    finishNode(node: any, type: string): any;
    finishToken(type: any, value?: any): any;
    expect(token: any): void;
    enterScope(flags: number): void;
    exitScope(): void;
    semicolon(): void;
    raise(pos: number, message: string): void;
    unexpected(pos?: number): void;
    next(): void;
    eat(token: any): boolean;
    jsx_parseElementAt(startPos: number, startLoc?: any): any;
    jsx_parseElement(): any;
    jsx_parseExpressionContainer(): any;
    jsx_parseOpeningElementAt(startPos: number, startLoc?: any): any;
    jsx_parseClosingElementAt(pos: number, loc: any): any;
    jsx_parseElementName(): any;
    parseIdent(allowBinding?: boolean): any;
    parseFunctionParams(node: any): void;
    parseExprAtom(): any;
    isContextual(name: string): boolean;
    startLoc: any;
    endLoc: any;
    lastTokEnd: number;
    lastTokStart: number;
    lastTokEndLoc: any;
    lastTokStartLoc: any;
    curLine: number;
    lineStart: number;
    startNodeAt(pos: number, loc?: any): any;
    checkUnreserved(ref: any): any;
  }
}

export interface VeskPluginConfig {
  [key: string]: unknown;
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function getJSXElementName(node: any): string | null {
  if (!node) return null;
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXNamespacedName' && node.namespace && node.name) {
    return `${node.namespace.name}:${node.name.name}`;
  }
  if (node.type === 'JSXMemberExpression') {
    const parts: string[] = [];
    let cur: any = node;
    while (cur && cur.type === 'JSXMemberExpression') {
      if (cur.property && cur.property.name) parts.unshift(cur.property.name);
      cur = cur.object;
    }
    if (cur && cur.type === 'JSXIdentifier' && cur.name) parts.unshift(cur.name);
    return parts.join('.') || null;
  }
  return null;
}

function isIdentStartCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36;
}
function isIdentCharCode(code: number): boolean {
  return isIdentStartCode(code) || (code >= 48 && code <= 57);
}

function looksLikeGenericArrowAt(input: string, pos: number): boolean {
  let i = pos + 1;
  while (i < input.length && isWsChar(input.charCodeAt(i))) i++;
  if (i >= input.length || !isIdentStartCode(input.charCodeAt(i))) return false;
  while (i < input.length && isIdentCharCode(input.charCodeAt(i))) i++;
  while (i < input.length && isWsChar(input.charCodeAt(i))) i++;
  if (input.charCodeAt(i) !== 44) return false; // ','
  i++;
  while (i < input.length && isWsChar(input.charCodeAt(i))) i++;
  if (input.charCodeAt(i) !== 62) return false; // '>'
  i++;
  while (i < input.length && isWsChar(input.charCodeAt(i))) i++;
  if (input.charCodeAt(i) !== 40) return false; // '('
  return true;
}

const TS_PRIMITIVE_TYPES = new Set(['number','string','boolean','any','unknown','never','void','object','symbol','bigint','undefined','null']);
const HTML_TAGS = new Set(['a','abbr','address','area','article','aside','audio','b','base','bdi','bdo','blockquote','body','br','button','canvas','caption','cite','code','col','colgroup','data','datalist','dd','del','details','dfn','dialog','div','dl','dt','em','embed','fieldset','figcaption','figure','footer','form','h1','h2','h3','h4','h5','h6','head','header','hgroup','hr','html','i','iframe','img','input','ins','kbd','label','legend','li','link','main','map','mark','menu','meta','meter','nav','noscript','object','ol','optgroup','option','output','p','picture','pre','progress','q','rp','rt','ruby','s','samp','script','section','select','slot','small','source','span','strong','style','sub','summary','sup','table','tbody','td','template','textarea','tfoot','th','thead','time','title','tr','track','u','ul','var','video','wbr']);

function looksLikeTypeAssertionAt(input: string, pos: number): boolean {
  let i = pos + 1;
  while (i < input.length && isWsChar(input.charCodeAt(i))) i++;
  const nameStart = i;
  if (i >= input.length || !isIdentStartCode(input.charCodeAt(i))) return false;
  while (i < input.length && isIdentCharCode(input.charCodeAt(i))) i++;
  const name = input.slice(nameStart, i);
  // If it's a known HTML tag (lowercase), it's JSX, not a type assertion
  if (HTML_TAGS.has(name) || VOID_ELEMENTS.has(name)) return false;
  // Only treat as type assertion if name is a TS primitive or capitalized type
  const isPrimitive = TS_PRIMITIVE_TYPES.has(name);
  const isCapitalized = name[0] >= 'A' && name[0] <= 'Z';
  if (!isPrimitive && !isCapitalized) return false;
  // allow qualified type like `ns.Type` or `Array<string>`? For now only single identifier, skip generics check
  // If next is '<', skip balanced <...>
  if (input.charCodeAt(i) === 60) {
    let depth = 0;
    let j = i;
    while (j < input.length) {
      const c = input.charCodeAt(j);
      if (c === 60) depth++;
      else if (c === 62) {
        depth--;
        if (depth === 0) { i = j + 1; break; }
      }
      j++;
      if (j - i > 100) break;
    }
  }
  while (i < input.length && isWsChar(input.charCodeAt(i))) i++;
  if (input.charCodeAt(i) !== 62) return false; // '>'
  i++;
  while (i < input.length && isWsChar(input.charCodeAt(i))) i++;
  if (i >= input.length) return false;
  const c = input.charCodeAt(i);
  // expression start: identifier, (, [, {, ", ', `, !, ~, +, -, number, this/super etc.
  if (isIdentStartCode(c) || c === 40 || c === 91 || c === 123 || c === 34 || c === 39 || c === 96 || c === 33 || c === 126 || c === 43 || c === 45 || (c >= 48 && c <= 57)) return true;
  return false;
}

function isWsChar(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

function isStyleBoundary(code: number): boolean {
  return isWsChar(code) || code === 62 || code === 47 || code === 123;
}

function matchKeywordSequence(input: string, words: string[]): boolean {
  let p = 0;
  while (p < input.length && isWsChar(input.charCodeAt(p))) p++;
  if (!input.startsWith(words[0], p)) return false;
  p += words[0].length;
  for (let i = 1; i < words.length; i++) {
    const wsStart = p;
    while (p < input.length && isWsChar(input.charCodeAt(p))) p++;
    if (p === wsStart) return false;
    if (!input.startsWith(words[i], p)) return false;
    p += words[i].length;
  }
  if (p >= input.length) return true;
  const c = input.charCodeAt(p);
  return isWsChar(c) || c === 123;
}

export function VeskParserPlugin(config: VeskPluginConfig = {}) {
  return (Parser: typeof acorn.Parser): typeof acorn.Parser => {
    const tt = (Parser as any).tokTypes || acorn.tokTypes;
    const tstt = (Parser as any).acornTypeScript?.tokTypes;

    class VeskParser extends Parser {
      #componentDepth = 0;
      #closeTagName: string | null = null;
      #jsxStartsStatement = false;
      #inTSTypeDecl = false;

      constructor(options: Options, input: string) {
        super(options, input);
      }

      #isBlockContext(): boolean {
        const ctx = this.curContext();
        return ctx && (ctx.token === '{' || ctx.token === 'function');
      }

      readToken(code: number): any {
        if (this.#componentDepth > 0 && code === 60 && this.#isBlockContext()) {
          const next = this.input.charCodeAt(this.pos + 1);
          if (next === 47 || (next >= 65 && next <= 90) || (next >= 97 && next <= 122)) {
            const startsNewStatement = (this as any).hasPrecedingLineBreak();
            const inType = (this as any).inType;
            const forceJsx = () => {
              const savedExprAllowed = (this as any).exprAllowed;
              (this as any).exprAllowed = true;
              const result = super.readToken(code);
              (this as any).exprAllowed = savedExprAllowed;
              return result;
            };
            if (inType) {
              if (startsNewStatement) {
                if (looksLikeGenericArrowAt(this.input, this.pos) || looksLikeTypeAssertionAt(this.input, this.pos)) {
                  this.#jsxStartsStatement = false;
                  return super.readToken(code);
                }
                this.#jsxStartsStatement = true;
                ++this.pos;
                return this.finishToken(tstt.jsxTagStart);
              }
            } else {
              const prev = this.type;
              const canEndExpr =
                prev === tt.name || prev === tt.num || prev === tt.string || prev === tt.regexp ||
                prev === tt.bracketR || prev === tt.backQuote || prev === tt.template ||
                prev === tt._this || prev === tt._super || prev === tt._true || prev === tt._false ||
                prev === tt._null || prev === tt.jsxTagEnd;
              if (!canEndExpr || startsNewStatement) {
                if (looksLikeGenericArrowAt(this.input, this.pos) || looksLikeTypeAssertionAt(this.input, this.pos)) {
                  this.#jsxStartsStatement = false;
                  return super.readToken(code);
                }
                this.#jsxStartsStatement = true;
                return forceJsx();
              }
            }
          }
        }
        this.#jsxStartsStatement = false;
        return super.readToken(code);
      }

      isLet(context: any): boolean {
        if (!(this as any).isContextual('let')) return false;

        let p = this.pos;
        while (p < this.input.length && isWsChar(this.input.charCodeAt(p))) p++;
        const nextCh = this.input.charCodeAt(p);

        if (nextCh === 38) {
          const afterAmp = this.input.charCodeAt(p + 1);
          if (afterAmp === 123 || afterAmp === 91) return true;
        }

        return super.isLet(context);
      }

      parseBindingAtom(): any {
        if (this.type === tt.bitwiseAND) {
          const charAfterAmp = this.input.charCodeAt(this.end);
          if (charAfterAmp === 123 || charAfterAmp === 91) {
            this.next();
            const pattern = super.parseBindingAtom();
            (pattern as any).lazy = true;
            return pattern;
          }
        }
        return super.parseBindingAtom();
      }

      parseExpression(noIn: boolean, refDestructuringErrors: any): any {
        const expr = super.parseExpression(noIn, refDestructuringErrors);
        if (tstt && this.type === tstt.jsxTagStart && !this.#jsxStartsStatement) {
          this.raise(this.start, "Adjacent JSX elements must be wrapped in an enclosing tag. Wrap them in a fragment: <><Comp1 /><Comp2 /></> or a single parent element.");
        }
        return expr;
      }

      parseStatement(context: any, ...args: any[]): any {
        if (this.type === tt.name && this.value === 'async') {
          const afterAsync = this.input.slice(this.end).trimStart();
          if (matchKeywordSequence(afterAsync, ['component'])) {
            this.next();
            const node = this.parseComponentDeclaration(true);
            return node;
          }
        }

        if (this.type === tt.name && this.value === 'component') {
          return this.parseComponentDeclaration(false);
        }

        if (this.type === tt._export) {
          const rest = this.input.slice(this.pos).trimStart();
          if (matchKeywordSequence(rest, ['default', 'async', 'component'])) {
            this.next(); this.next(); this.next();
            const node = this.startNode();
            node.declaration = this.parseComponentDeclaration(true);
            (node as any).default = true;
            return this.finishNode(node, 'ExportDefaultDeclaration');
          }
          if (matchKeywordSequence(rest, ['async', 'component'])) {
            this.next(); this.next();
            const node = this.startNode();
            node.declaration = this.parseComponentDeclaration(true);
            return this.finishNode(node, 'ExportNamedDeclaration');
          }
          if (matchKeywordSequence(rest, ['default', 'component'])) {
            const node = this.startNode();
            this.next();
            this.next();
            node.declaration = this.parseComponentDeclaration(false);
            (node as any).default = true;
            return this.finishNode(node, 'ExportDefaultDeclaration');
          }
          if (matchKeywordSequence(rest, ['component'])) {
            const node = this.startNode();
            this.next();
            node.declaration = this.parseComponentDeclaration(false);
            return this.finishNode(node, 'ExportNamedDeclaration');
          }
        }

        if (tstt && this.type === tstt.jsxTagStart && this.#componentDepth > 0) {
          const node = (this as any).jsx_parseElement();
          this.semicolon();
          return node;
        }

        if (this.#componentDepth > 0 && this.type === tt.privateId && (this.value === 'server' || this.value === 'client' || this.value === 'empty')) {
          let p = this.end;
          while (p < this.input.length && isWsChar(this.input.charCodeAt(p))) p++;
          if (this.input.charCodeAt(p) === 123) {
            const node = this.startNode();
            (node as any).tag = this.value;
            (node as any).body = [];
            this.next();
            this.expect(tt.braceL);
            this.parseTemplateBody((node as any).body);
            this.next();
            return this.finishNode(node, 'VeskBlock');
          }
        }

        if (this.#componentDepth > 0 && this.type === tt.name && this.value === 'empty') {
          let p = this.end;
          while (p < this.input.length && isWsChar(this.input.charCodeAt(p))) p++;
          if (this.input.charCodeAt(p) === 123) {
            const node = this.startNode();
            (node as any).tag = 'empty';
            this.next();
            (node as any).body = this.parseBlock(false).body;
            return this.finishNode(node, 'VeskBlock');
          }
        }

        if (this.#componentDepth > 0 && tstt) {
          const isTsDecl = (this.type === tstt.interface || this.type === tstt.enum ||
            this.type === tstt.type || this.type === tstt.module || this.type === tstt.namespace);
          if (isTsDecl) {
            this.#inTSTypeDecl = true;
            try {
              return super.parseStatement(context, ...args);
            } finally {
              this.#inTSTypeDecl = false;
            }
          }
        }

        return super.parseStatement(context, ...args);
      }

      parseBlock(createNewLexicalScope?: boolean, node?: any, exitStrict?: boolean): any {
        if (this.#componentDepth > 0 && !this.#inTSTypeDecl) {
          if (createNewLexicalScope === void 0) createNewLexicalScope = true;
          if (node === void 0) node = this.startNode();

          node.body = [];
          this.expect(tt.braceL);
          if (createNewLexicalScope) {
            this.enterScope(0);
          }

          this.parseTemplateBody(node.body);

          if (exitStrict) {
            (this as any).strict = false;
          }
          this.exprAllowed = true;

          this.next();
          if (createNewLexicalScope) {
            this.exitScope();
          }
          return this.finishNode(node, 'BlockStatement');
        }

        return super.parseBlock(createNewLexicalScope, node, exitStrict);
      }

      parseTemplateBody(body: any[]): void {
        if (this.type === tt.braceL) {
          const peekChar = this.input.charCodeAt(this.start + 1);

          if (this.#closeTagName !== null && peekChar === 47) {
            let p = this.start + 2;
            const nameStart = p;
            while (p < this.input.length) {
              const c = this.input.charCodeAt(p);
              if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36) {
                p++;
              } else break;
            }
            const closeTag = this.input.slice(nameStart, p);
            if (closeTag === this.#closeTagName && p < this.input.length && this.input.charCodeAt(p) === 125) {
              return;
            }
          }

          if (peekChar === 35) {
            let p = this.start + 2;
            const nameStart = p;
            while (p < this.input.length) {
              const c = this.input.charCodeAt(p);
              if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36) {
                p++;
              } else break;
            }
            const tagName = this.input.slice(nameStart, p);
            if (tagName === 'server' || tagName === 'client') {
              if (p < this.input.length && this.input.charCodeAt(p) === 125) {
                const node = this.parseVeskBlock(tagName);
                body.push(node);
                this.parseTemplateBody(body);
                return;
              }
            }
          }
          const node = (this as any).jsx_parseExpressionContainer();
          body.push(node);
        }
        else if (this.type === tt.braceR) {
          return;
        }
        else if (tstt && this.type === tstt.jsxTagStart) {
          const nextChar = this.input.charCodeAt(this.pos);
          if (nextChar === 47) {
            return;
          }

          const node = (this as any).jsx_parseElement();
          body.push(node);

          this.exprAllowed = true;
        }
        else if (tstt && this.type === tstt.jsxText) {
          this.next();
        }
        else {
          const node = this.parseStatement(null);
          body.push(node);
          this.exprAllowed = true;
        }

        this.parseTemplateBody(body);
      }

      parseVeskBlock(tagName: string): any {
        const node = this.startNode();
        (node as any).tag = tagName;
        (node as any).body = [];

        this.pos = this.start;
        const endPos = this.start + 2 + tagName.length + 1;
        if (endPos > this.input.length) {
          this.raise(this.start, `Unclosed ${tagName} block`);
        }
        this.pos++;
        this.pos++;
        this.pos += tagName.length;
        this.pos++;
        this.next();

        const prevCloseTag = this.#closeTagName;
        this.#closeTagName = tagName;
        this.parseTemplateBody((node as any).body);
        this.#closeTagName = prevCloseTag;

        this.pos = this.start;
        this.pos++;
        this.pos++;
        while (this.pos < this.input.length) {
          const c = this.input.charCodeAt(this.pos);
          if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36) {
            this.pos++;
          } else break;
        }
        if (this.pos < this.input.length) this.pos++;
        this.next();

        return this.finishNode(node, 'VeskBlock');
      }

      parseComponentDeclaration(isAsync = false): any {
        const node = this.startNode();
        (node as any).async = isAsync;
        this.next();
        (node as any).id = this.parseIdent();
        if (typeof (this as any).tsTryParseTypeParameters === 'function') {
          const typeParameters = (this as any).tsTryParseTypeParameters((this as any).tsParseConstModifier);
          if (typeParameters) (node as any).typeParameters = typeParameters;
        }

        // Mirror acorn's parseFunction: clear await/yield bookkeeping so a
        // later component declaration doesn't trip checkYieldAwaitInDefaultParams
        // on stale positions from a previous async component body.
        const savedYield = (this as any).yieldPos;
        const savedAwait = (this as any).awaitPos;
        const savedAwaitIdent = (this as any).awaitIdentPos;
        const savedMaybeInArrow = (this as any).maybeInArrowParameters;
        (this as any).yieldPos = 0;
        (this as any).awaitPos = 0;
        (this as any).awaitIdentPos = 0;
        (this as any).maybeInArrowParameters = false;

        this.enterScope(2 | (isAsync ? 4 : 0));

        (node as any).client = (this.type === tt.name || this.type === tt.privateId) && this.value === 'client' ? (this.next(), true) : false;

        if (this.type === tt.parenL) {
          this.parseFunctionParams(node);
        } else {
          (node as any).params = [];
        }

        if (!(node as any).client && (this.type === tt.name || this.type === tt.privateId) && this.value === 'client') {
          (node as any).client = true;
          this.next();
        }

        this.#componentDepth++;
        (node as any).body = this.parseBlock(false);
        this.#componentDepth--;

        this.exitScope();
        (this as any).yieldPos = savedYield;
        (this as any).awaitPos = savedAwait;
        (this as any).awaitIdentPos = savedAwaitIdent;
        (this as any).maybeInArrowParameters = savedMaybeInArrow;
        this.finishNode(node, 'ComponentDeclaration');
        return node;
      }

      jsx_parseElementAt(startPos: number, startLoc?: any): any {
        const prefixLen = Math.min(20, this.input.length - startPos);
        const prefix = this.input.slice(startPos, startPos + prefixLen);
        if (prefix.startsWith('<style') && isStyleBoundary(prefix.charCodeAt(6))) {
          return this.parseStyleElement(startPos, startLoc);
        }
        return super.jsx_parseElementAt(startPos, startLoc);
      }

      jsx_parseOpeningElementAt(startPos: number, startLoc?: any): any {
        // Manual implementation that treats HTML void elements as
        // self-closing even without `/>`. Delegating to super would leave
        // a stale tc_expr context (the `>` updateContext only pops the
        // extra level when a `/` was present), so the following `}` is
        // mis-read as JSX text: "Unexpected token `}`".
        const node = this.startNodeAt(startPos, startLoc);
        node.attributes = [];
        const nodeName = (this as any).jsx_parseElementName();
        if (nodeName) node.name = nodeName;
        const nameStr = getJSXElementName(nodeName);
        const isVoid = !!(nameStr && VOID_ELEMENTS.has(nameStr));
        while (this.type !== tt.slash && this.type !== tstt.jsxTagEnd) {
          node.attributes.push((this as any).jsx_parseAttribute());
        }
        const hasSlash = this.eat(tt.slash);
        node.selfClosing = hasSlash || isVoid;
        if (this.type !== tstt.jsxTagEnd) this.unexpected();
        if (isVoid && !hasSlash) {
          const stack: any[] = (this as any).context;
          if (stack.length > 0 && stack[stack.length - 1].token === '<tag>...</tag>') {
            stack.pop();
            (this as any).exprAllowed = true;
          }
        }
        // Consume `>`. For void `>` we already popped tc_expr above so the
        // following `}` is read as a normal JS token, not JSX text.
        this.next();
        return this.finishNode(node, nodeName ? 'JSXOpeningElement' : 'JSXOpeningFragment');
      }

      parseStyleElement(startPos: number, startLoc?: any): any {
        const el = this.startNodeAt(startPos, startLoc);

        const openNode = this.startNodeAt(startPos, startLoc);
        let nodeName = (this as any).jsx_parseElementName();
        if (nodeName) openNode.name = nodeName;
        openNode.attributes = [];
        this.lastTokEnd = this.pos;
        openNode.selfClosing = false;
        const openingElement = this.finishNode(openNode, 'JSXOpeningElement');

        if (openingElement.selfClosing) {
          el.openingElement = openingElement;
          el.children = [];
          return this.finishNode(el, 'JSXElement');
        }

        const contentStart = openingElement.end;
        const closeIdx = this.input.indexOf('</style>', contentStart);

        if (closeIdx < 0) {
          this.raise(contentStart, 'Unclosed <style> element: missing </style>');
        }

        const children = [];
        if (closeIdx > contentStart) {
          const raw = this.input.slice(contentStart, closeIdx);
          children.push({ type: 'JSXText', value: raw });
        }

        this.pos = closeIdx;
        this.next();
        this.next();
        this.eat(tt.slash);
        this.lastTokEnd = this.pos;
        const closingElement = (this as any).jsx_parseClosingElementAt(closeIdx, undefined);

        el.openingElement = openingElement;
        el.closingElement = closingElement;
        el.children = children;
        return this.finishNode(el, 'JSXElement');
      }

      checkUnreserved(ref: any): any {
        if (ref.name === 'component') {
          this.raise(
            ref.start,
            '`component` is a reserved keyword and cannot be used as an identifier'
          );
        }
        return super.checkUnreserved(ref);
      }
    }

    return VeskParser as unknown as typeof acorn.Parser;
  };
}
