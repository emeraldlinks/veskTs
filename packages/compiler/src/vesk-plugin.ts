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
    next(): void;
    eat(token: any): boolean;
    jsx_parseElementAt(startPos: number, startLoc?: any): any;
    jsx_parseElement(): any;
    jsx_parseExpressionContainer(): any;
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
