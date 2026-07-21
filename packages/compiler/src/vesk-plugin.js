/**
 * Vesk Acorn Plugin — Phase 1 (Expression Mode Only)
 *
 * Extends the base Acorn + TypeScript parser with Vesk-specific grammar:
 * - `component` keyword for component declarations
 * - `let &[name] = track(...)` reactive binding syntax
 *
 * Adapted from Ripple's Acorn plugin (ripple@0.3.13).
 */
import * as acorn from 'acorn';

/**
 * @param {object} [config]
 * @returns {(Parser: typeof acorn.Parser) => typeof acorn.Parser}
 */
export function VeskPlugin(config = {}) {
	return (Parser) => {
		const tt = Parser.tokTypes || acorn.tokTypes;

		class VeskParser extends Parser {
			constructor(options, input) {
				super(options, input);
			}

			/**
			 * Override isLet to recognize `let &[]` and `let &{}` as variable declarations.
			 * Acorn's default isLet only checks for `{`, `[`, or identifier chars after `let`.
			 * The `&` character (ASCII 38) isn't in that set, so we extend the check.
			 */
			isLet(context) {
				if (!this.isContextual('let')) return false;

				const skip = /\s*/y;
				skip.lastIndex = this.pos;
				const match = skip.exec(this.input);
				if (!match) return super.isLet(context);

				const next = this.pos + match[0].length;
				const nextCh = this.input.charCodeAt(next);

				if (nextCh === 38) {
					// &
					const afterAmp = this.input.charCodeAt(next + 1);
					if (afterAmp === 123 || afterAmp === 91) return true; // { or [
				}

				return super.isLet(context);
			}

			/**
			 * Override parseBindingAtom to detect `&[]`/`&{}` lazy binding patterns.
			 * When found, parses the pattern normally but sets `pattern.lazy = true`.
			 * This flag is used by downstream phases to identify reactive bindings.
			 */
			parseBindingAtom() {
				if (this.type === tt.bitwiseAND) {
					const charAfterAmp = this.input.charCodeAt(this.end);
					if (charAfterAmp === 123 || charAfterAmp === 91) {
						// { or [
						this.next(); // consume &
						const pattern = super.parseBindingAtom();
						/** @type {any} */ (pattern).lazy = true;
						return pattern;
					}
				}
				return super.parseBindingAtom();
			}

			/**
			 * Override parseStatement to intercept `component` keyword at statement level.
			 * Routes to parseComponentDeclaration() for Vesk component syntax.
			 */
			parseStatement(context, ...args) {
				if (this.type === tt.name && this.value === 'component') {
					return this.parseComponentDeclaration();
				}
				return super.parseStatement(context, ...args);
			}

			/**
			 * Parse a Vesk component declaration (expression mode only, Phase 1).
			 *
			 * Syntax: `component Name(params) { body }`
			 * - `async` modifier: NOT supported yet (Phase 7)
			 * - `client` modifier: NOT supported yet (Phase 7)
			 * - Body: standard block statement with expression-mode rules
			 *
			 * The body is parsed as a standard JS block. The compiler phases
			 * (not the parser) enforce expression-mode rules like:
			 * - Find the main `return (<jsx>)` as the component's output
			 * - Reject bare statements inside the returned JSX tree
			 */
			parseComponentDeclaration() {
				const node = this.startNode();
				this.next(); // consume 'component'
				node.id = this.parseIdent();
				// SCOPE_FUNCTION (2) makes `this.inFunction` return true, allowing `return`
				this.enterScope(2);
				if (this.type === tt.parenL) {
					this.parseFunctionParams(node);
				} else {
					node.params = [];
				}
				node.body = this.parseBlock(false);
				node.async = false;
				this.exitScope();
				this.finishNode(node, 'ComponentDeclaration');
				return node;
			}

			/**
			 * Override checkUnreserved to prevent `component` from being used as a regular
			 * identifier in expression position. The `component` keyword can only appear
			 * at statement level (intercepted by parseStatement).
			 */
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
