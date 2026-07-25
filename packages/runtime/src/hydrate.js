/**
 * Vesk hydration runtime.
 *
 * Uses `data-vsk` attributes on server-rendered elements to match
 * them with the client codegen's imperative DOM creation calls.
 * After matching, the attribute is removed to avoid re-matching.
 *
 * Text nodes: NOT matched individually. Instead, `nextElement` clears
 * the matched element's direct SSR text children; the codegen
 * re-creates them fresh via `document.createTextNode`.
 *
 * Supports time-sliced hydration via `hydrateViewport` and
 * `hydrateIdle` for progressive enhancement.
 */

export function reactiveProps(props) {
	return new Proxy(props, {
		get(target, key) {
			const val = Reflect.get(target, key);
			if (typeof val === 'object' && val !== null && typeof val.f === 'number') {
				return get(val);
			}
			return val;
		}
	});
}

export function createHydrateWalker(container, elementList) {
	const elements = elementList || [];
	let elemIdx = 0;

	return {
		root: container,
		done() {
			return elemIdx >= elements.length;
		},
		nextElement(tag) {
			while (elemIdx < elements.length) {
				const el = elements[elemIdx++];
				if (tag && el.tagName.toLowerCase() !== tag) continue;
				if (el.removeAttribute) el.removeAttribute('data-vsk');
				// Clear direct text children from SSR — codegen re-creates them fresh
				for (let i = el.childNodes.length - 1; i >= 0; i--) {
					if (el.childNodes[i].nodeType === 3) {
						el.childNodes[i].remove();
					}
				}
				return el;
			}
			const result = document.createElement(tag || 'div');
			return result;
		},
		subWalker(rootEl) {
			// Flat-list sub-walker: uses remaining elements contained within rootEl
			const subElements = elements.slice(elemIdx).filter((el) => {
				if (rootEl === el) return true;
				if (!rootEl || !el) return false;
				if (typeof rootEl.contains === 'function') return rootEl.contains(el);
				if (typeof rootEl.compareDocumentPosition === 'function') {
					return (rootEl.compareDocumentPosition(el) & 16) !== 0;
				}
				return false;
			});
			elemIdx += subElements.length;
			return createHydrateWalker(rootEl, subElements);
		},
	};
}

/**
 * Create a tree-structured walker that walks the actual children
 * of a parent DOM element, claiming elements by matching tag name.
 *
 * Unlike the flat-list walker (createHydrateWalker), this walker
 * iterates over parentEl.children in DOM order. This ensures each
 * component only claims elements within its own scope, preventing
 * conflicts between Layout, NavLink, and Page components.
 *
 * @param {Element} parentEl - The parent element whose children to walk
 * @returns {Object} Walker with nextElement, subWalker methods
 */
export function createHydrateChildWalker(parentEl) {
	let childIdx = 0;
	const children = parentEl ? parentEl.children : [];

		return {
		root: parentEl,
		nextElement(tag) {
			while (childIdx < children.length) {
				const child = children[childIdx++];
				if (!tag || child.tagName.toLowerCase() === tag) {
					// Clear SSR text children — codegen re-creates them fresh
					for (let i = child.childNodes.length - 1; i >= 0; i--) {
						if (child.childNodes[i].nodeType === 3) {
							child.childNodes[i].remove();
						}
					}
					return child;
				}
			}
			return document.createElement(tag || 'div');
		},
		subWalker(rootEl) {
			return createHydrateChildWalker(rootEl);
		},
	};
}
export function hydrate(container, componentFn, props) {
	const allElements = Array.from(container.querySelectorAll('[data-vsk]'));
	const walker = createHydrateWalker(container, allElements);
	return componentFn(props, new Map(), walker);
}

/**
 * Viewport-prioritized hydration — hydrates all elements via a single
 * componentFn call (avoiding duplicate effects), but defers visibility
 * checks for progressive enhancement indicators.
 *
 * @param {HTMLElement} container
 * @param {Function} componentFn
 * @param {object} props
 * @param {number} [rootMargin=500] pixels outside viewport to include
 * @returns {Promise} resolves when all viewport elements are hydrated
 */
export function hydrateViewport(container, componentFn, props, rootMargin = 500) {
	const allElements = Array.from(container.querySelectorAll('[data-vsk]'));

	// Split into viewport and deferred batches
	const viewportEls = [];
	const deferredEls = [];
	for (const el of allElements) {
		const rect = el.getBoundingClientRect();
		if (rect.bottom < -rootMargin || rect.top > window.innerHeight + rootMargin) {
			deferredEls.push(el);
		} else {
			viewportEls.push(el);
		}
	}

	// Temporarily hide deferred elements from querySelector
	for (const el of deferredEls) {
		el.dataset.vskHold = el.getAttribute('data-vsk') || '';
		el.removeAttribute('data-vsk');
	}

	// Hydrate viewport batch first
	const viewportWalker = createHydrateWalker(container, viewportEls);
	componentFn(props, new Map(), viewportWalker);

	// When deferred elements scroll into view, hydrate them
	if (deferredEls.length > 0) {
		return new Promise((resolve) => {
			const observer = new IntersectionObserver((entries) => {
				const toHydrate = [];
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const el = entry.target;
						const held = el.dataset.vskHold;
						if (held !== undefined) {
							el.setAttribute('data-vsk', held);
							delete el.dataset.vskHold;
							toHydrate.push(el);
						}
						observer.unobserve(el);
					}
				}
				if (toHydrate.length > 0) {
					const w = createHydrateWalker(container, toHydrate);
					componentFn(props, new Map(), w);
				}
				if (observer._observed === 0) {
					observer.disconnect();
					resolve();
				}
			}, { rootMargin: `${rootMargin}px` });

			observer._observed = deferredEls.length;
			for (const el of deferredEls) {
				observer.observe(el);
			}
		});
	}

	return Promise.resolve();
}

/**
 * Idle-time hydration — hydrates all elements using requestIdleCallback
 * for progressive loading. Processes elements in chunks, creating fresh
 * DOM for each chunk via createElement (since SSR DOM is already present).
 */
export function hydrateIdle(container, componentFn, props, options = {}) {
	const allElements = Array.from(container.querySelectorAll('[data-vsk]'));
	const chunkSize = options.chunkSize || 10;
	const timeout = options.timeout || 3000;
	let idx = 0;

	const rIC = window.requestIdleCallback || ((cb) => setTimeout(cb, 50));
	const cIC = window.cancelIdleCallback || clearTimeout;

	let rafId = null;
	let cancelled = false;

	function processChunk(deadline) {
		if (cancelled) return;
		const end = Math.min(idx + chunkSize, allElements.length);
		const chunk = allElements.slice(idx, end);
		idx = end;

		if (chunk.length > 0) {
			const walker = createHydrateWalker(container, chunk);
			componentFn(props, new Map(), walker);
		}

		if (idx < allElements.length && (!deadline || deadline.timeRemaining() > 0 || deadline.didTimeout)) {
			rafId = rIC(processChunk, { timeout });
		}
	}

	rafId = rIC(processChunk, { timeout });

	return {
		cancel() {
			cancelled = true;
			if (rafId !== null) {
				cIC(rafId);
				rafId = null;
			}
		},
	};
}

/**
 * Check if there are remaining hydration markers in the DOM.
 */
export function needsHydration(container) {
	return container.querySelector('[data-vsk]') !== null;
}

/**
 * Count remaining hydration markers.
 */
export function hydrationCount(container) {
	return container.querySelectorAll('[data-vsk]').length;
}
