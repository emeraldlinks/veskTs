/**
 * True hydration walker.
 *
 * Instead of a flat list of data-vsk elements, each component gets a
 * walker scoped to its parent DOM element. The walker iterates over
 * parent.childNodes and claims elements by matching tag name.
 *
 * Key properties:
 * - Zero DOM mutations for claimed elements (they already exist from SSR)
 * - Each component only claims elements within its own scope
 * - No ordering conflicts between Layout and NavLink
 * - Static text stays untouched (already in DOM from SSR)
 * - Only reactive text and event handlers need attachment
 */

/**
 * Create a scoped walker for a parent DOM element.
 * Walks parent.children (element nodes only) in order.
 *
 * @param {Element} parentEl - The parent DOM element to walk
 * @returns {Object} Walker with claimElement, claimText, subScope methods
 */
export function createWalker(parentEl) {
	let childIdx = 0;
	const children = parentEl ? parentEl.children : [];

	return {
		/** The parent element this walker is scoped to */
		parent: parentEl,

		/**
		 * Claim the next element child matching the given tag.
		 * Skips non-matching elements. Returns existing DOM element
		 * (zero DOM mutation) or creates new if not found.
		 *
		 * @param {string} tag - Element tag name to match (e.g. "nav", "a")
		 * @param {string} [className] - Optional class to match exactly
		 * @returns {Element} The claimed element
		 */
		claimElement(tag, className) {
			while (childIdx < children.length) {
				const child = children[childIdx];
				childIdx++;
				if (child.nodeType === 1 &&
					child.tagName.toLowerCase() === tag &&
					(!className || child.className === className)) {
					return child;
				}
			}
			// Fallback: create new element (SSR didn't have it)
			return document.createElement(tag);
		},

		/**
		 * Claim the next text node child.
		 * Returns existing text node (zero DOM mutation) or creates new.
		 * Skips whitespace-only text nodes from SSR indentation.
		 *
		 * @returns {Text} The claimed text node
		 */
		claimText() {
			const parentNodes = parentEl ? parentEl.childNodes : [];
			while (childIdx < parentNodes.length) {
				const node = parentNodes[childIdx];
				childIdx++;
				if (node.nodeType === 3) {
					return node;
				}
			}
			return document.createTextNode('');
		},

		/**
		 * Create a sub-walker scoped to a child element.
		 * Used when passing scope to child components (NavLink, etc.)
		 *
		 * @param {Element} el - The child element to scope to
		 * @returns {Object} A new walker scoped to el's children
		 */
		subScope(el) {
			return createWalker(el);
		},

		/**
		 * Get the current child index (for debugging/testing).
		 */
		get index() {
			return childIdx;
		}
	};
}

/**
 * Hydrate a container: walk all children, claim elements, attach
 * effects and event handlers. The SSR DOM stays completely untouched.
 *
 * @param {Element} container - The #root container with SSR content
 * @param {Function} componentFn - The component function to hydrate with
 * @param {Object} props - Props to pass to the component
 */
export function hydrateContainer(container, componentFn, props) {
	const walker = createWalker(container);
	return componentFn(props, new Map(), walker);
}
