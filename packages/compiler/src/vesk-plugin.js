import * as acorn from 'acorn';

export function VeskPlugin(config = {}) {
	return (Parser) => {
		const tt = Parser.tokTypes || acorn.tokTypes;
		const tstt = Parser.acornTypeScript?.tokTypes;

		class VeskParser extends Parser {
			#componentDepth = 0;
			#closeTagName = null;

			constructor(options, input) {
				super(options, input);
			}

			#isBlockContext() {
				const ctx = this.curContext();
				return ctx && (ctx.token === "{" || ctx.token === "function");
			}

			readToken(code) {
				if (this.#componentDepth > 0 && code === 60 && !this.inType && this.#isBlockContext()) {
					const next = this.input.charCodeAt(this.pos + 1);
					if (next === 47 || (next >= 65 && next <= 90) || (next >= 97 && next <= 122)) {
						const savedExprAllowed = this.exprAllowed;
						this.exprAllowed = true;
						const result = super.readToken(code);
						this.exprAllowed = savedExprAllowed;
						return result;
					}
				}
				return super.readToken(code);
			}

			isLet(context) {
				if (!this.isContextual('let')) return false;

				const skip = /\s*/y;
				skip.lastIndex = this.pos;
				const match = skip.exec(this.input);
				if (!match) return super.isLet(context);

				const next = this.pos + match[0].length;
				const nextCh = this.input.charCodeAt(next);

				if (nextCh === 38) {
					const afterAmp = this.input.charCodeAt(next + 1);
					if (afterAmp === 123 || afterAmp === 91) return true;
				}

				return super.isLet(context);
			}

			parseBindingAtom() {
				if (this.type === tt.bitwiseAND) {
					const charAfterAmp = this.input.charCodeAt(this.end);
					if (charAfterAmp === 123 || charAfterAmp === 91) {
						this.next();
						const pattern = super.parseBindingAtom();
						pattern.lazy = true;
						return pattern;
					}
				}
				return super.parseBindingAtom();
			}

			parseExpression(noIn, refDestructuringErrors) {
				const expr = super.parseExpression(noIn, refDestructuringErrors);
				if (tstt && this.type === tstt.jsxTagStart) {
					this.raise(this.start, "Adjacent JSX elements must be wrapped in an enclosing tag");
				}
				return expr;
			}

			parseStatement(context, ...args) {
				// async component → async flag set on the ComponentDeclaration
				if (this.type === tt.name && this.value === 'async') {
					const afterAsync = this.input.slice(this.end).trimStart();
					if (afterAsync.startsWith('component') && (afterAsync.length === 9 || ' \t\r\n{'.includes(afterAsync[9]))) {
						this.next();
						const node = this.parseComponentDeclaration(/* async */ true);
						return node;
					}
				}

				if (this.type === tt.name && this.value === 'component') {
					return this.parseComponentDeclaration(/* async */ false);
				}

				if (this.type === tt._export) {
					const rest = this.input.slice(this.pos).trimStart();
					if (rest.startsWith('default async component') && (rest.length === 23 || ' \t\r\n{'.includes(rest[23]))) {
						this.next(); this.next(); this.next(); // export default async
						const node = this.startNode();
						node.declaration = this.parseComponentDeclaration(/* async */ true);
						node.default = true;
						return this.finishNode(node, 'ExportDefaultDeclaration');
					}
					if (rest.startsWith('async component') && (rest.length === 15 || ' \t\r\n{'.includes(rest[15]))) {
						this.next(); this.next(); // export async
						const node = this.startNode();
						node.declaration = this.parseComponentDeclaration(/* async */ true);
						return this.finishNode(node, 'ExportNamedDeclaration');
					}
					if (rest.startsWith('default component') && (rest.length === 17 || ' \t\r\n{'.includes(rest[17]))) {
						const node = this.startNode();
						this.next();
						this.next();
						node.declaration = this.parseComponentDeclaration(/* async */ false);
						node.default = true;
						return this.finishNode(node, 'ExportDefaultDeclaration');
					}
					if (rest.startsWith('component') && (rest.length === 9 || ' \t\r\n{'.includes(rest[9]))) {
						const node = this.startNode();
						this.next();
						node.declaration = this.parseComponentDeclaration(/* async */ false);
						return this.finishNode(node, 'ExportNamedDeclaration');
					}
				}

				if (tstt && this.type === tstt.jsxTagStart && this.#componentDepth > 0) {
					const node = this.jsx_parseElement();
					this.semicolon();
					return node;
				}

				return super.parseStatement(context, ...args);
			}

			parseBlock(createNewLexicalScope, node, exitStrict) {
				if (this.#componentDepth > 0) {
					if (createNewLexicalScope === void 0) createNewLexicalScope = true;
					if (node === void 0) node = this.startNode();

					node.body = [];
					this.expect(tt.braceL);
					if (createNewLexicalScope) {
						this.enterScope(0);
					}

					this.parseTemplateBody(node.body);

					if (exitStrict) {
						this.strict = false;
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

			parseTemplateBody(body) {
				if (this.type === tt.braceL) {
					const peekChar = this.input.charCodeAt(this.start + 1);

					// Check for closing {/tag} marker
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
							return; // stop — closing tag found; parseVeskBlock will consume {/tag}
						}
					}

					// Check if this is {#server} or {#client} by peeking
					if (peekChar === 35) {
						// Possibly {#tag} — read the tag name
						let p = this.start + 2; // skip '{' and '#'
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
					const node = this.jsx_parseExpressionContainer();
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

					const node = this.jsx_parseElement();
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

			parseVeskBlock(tagName) {
				const node = this.startNode();
				node.tag = tagName;
				node.body = [];

				// Advance past '{#tag}'
				this.pos = this.start;
				this.pos++; // skip '{'
				this.pos++; // skip '#'
				this.pos += tagName.length; // skip tag name
				this.pos++; // skip '}'
				this.next(); // read first token after opening

				// Save and set close tag marker for parseTemplateBody
				const prevCloseTag = this.#closeTagName;
				this.#closeTagName = tagName;
				this.parseTemplateBody(node.body);
				this.#closeTagName = prevCloseTag;

				// Current token is '{' (tt.braceL). Manually consume {/tag}
				// without calling this.next() because '/' would tokenize as regex.
				this.pos = this.start; // back to '{'
				this.pos++; // skip '{'
				this.pos++; // skip '/'
				while (this.pos < this.input.length) {
					const c = this.input.charCodeAt(this.pos);
					if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 36) {
						this.pos++;
					} else break;
				}
				this.pos++; // skip '}'
				this.next(); // sync tokenizer

				return this.finishNode(node, 'VeskBlock');
			}

			parseComponentDeclaration(isAsync = false) {
				const node = this.startNode();
				node.async = isAsync;
				this.next();
				node.id = this.parseIdent();
				if (typeof this.tsTryParseTypeParameters === 'function') {
					const typeParameters = this.tsTryParseTypeParameters(this.tsParseConstModifier);
					if (typeParameters) node.typeParameters = typeParameters;
				}
				this.enterScope(2 | (isAsync ? 4 : 0));

				// Parse optional `client` keyword before params: component App client(props) { ... }
				node.client = this.type === tt.name && this.value === 'client' ? (this.next(), true) : false;

				if (this.type === tt.parenL) {
					this.parseFunctionParams(node);
				} else {
					node.params = [];
				}

				// Parse optional `client` keyword after params: component App(props) client { ... }
				if (!node.client && this.type === tt.name && this.value === 'client') {
					node.client = true;
					this.next();
				}

				this.#componentDepth++;
				node.body = this.parseBlock(false);
				this.#componentDepth--;

				this.exitScope();
				this.finishNode(node, 'ComponentDeclaration');
				return node;
			}

			jsx_parseElementAt(startPos, startLoc) {
				const prefixLen = Math.min(20, this.input.length - startPos);
				const prefix = this.input.slice(startPos, startPos + prefixLen);
				if (/^<style[\s/>{\n]/.test(prefix) || prefix.startsWith('<style>')) {
					return this.parseStyleElement(startPos, startLoc);
				}
				return super.jsx_parseElementAt(startPos, startLoc);
			}

			parseStyleElement(startPos, startLoc) {
				const el = this.startNodeAt(startPos, startLoc);

				const openNode = this.startNodeAt(startPos, startLoc);
				let nodeName = this.jsx_parseElementName();
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
				const closingElement = this.jsx_parseClosingElementAt(closeIdx, undefined);

				el.openingElement = openingElement;
				el.closingElement = closingElement;
				el.children = children;
				return this.finishNode(el, 'JSXElement');
			}

			checkUnreserved(ref) {
				if (ref.name === 'component') {
					this.raise(
						ref.start,
						'`component` is a reserved keyword and cannot be used as an identifier'
					);
				}
				return super.checkUnreserved(ref);
			}

		}

		return VeskParser;
	};
}
