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

export function createHydrateWalker(container, elementList) {
	const elements = elementList || [];
	let elemIdx = 0;

	return {
		root: container,
		done() {
			return elemIdx >= elements.length;
		},
		nextElement(tag) {
			if (elemIdx < elements.length) {
				const el = elements[elemIdx++];
				el.removeAttribute('data-vsk');
				// Clear direct text children from SSR — codegen re-creates them fresh
				for (let i = el.childNodes.length - 1; i >= 0; i--) {
					if (el.childNodes[i].nodeType === 3) {
						el.childNodes[i].remove();
					}
				}
				return el;
			}
			const result = document.createElement(tag);
			// Clear text children even on fresh elements
			for (let i = result.childNodes.length - 1; i >= 0; i--) {
				if (result.childNodes[i].nodeType === 3) {
					result.childNodes[i].remove();
				}
			}
			return result;
		},
		subWalker(rootEl) {
			// Sub-walker gets remaining elements within rootEl
			const subElements = elements.slice(elemIdx).filter((el) => rootEl.contains(el));
			// Adjust: consume the sub-elements from the parent walker's index
			elemIdx += subElements.length;
			return createHydrateWalker(rootEl, subElements);
		},
	};
}

/**
 * Full hydration: process all data-vsk elements in the container.
 * Suitable for small to medium pages.
 */
export function hydrate(container, componentFn, props) {
	const allElements = Array.from(container.querySelectorAll('[data-vsk]'));
	const walker = createHydrateWalker(container, allElements);
	return componentFn(props, new Map(), walker);
}

/**
 * Viewport-prioritized hydration — only hydrates elements visible
 * in or near the viewport. Remaining elements are hydrated on
 * scroll via IntersectionObserver.
 *
 * @param {HTMLElement} container
 * @param {Function} componentFn
 * @param {object} props
 * @param {number} [rootMargin=500] pixels outside viewport to include
 * @returns {{ then: Function }} promise-like object for chaining
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

	// Hydrate viewport batch
	const walker = createHydrateWalker(container, viewportEls);
	const result = componentFn(props, new Map(), walker);

	// Set up observer for deferred elements
	if (deferredEls.length > 0) {
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
		}, { rootMargin: `${rootMargin}px` });

		for (const el of deferredEls) {
			observer.observe(el);
		}
	}

	return result;
}

/**
 * Idle-time hydration — processes data-vsk elements during
 * browser idle periods via requestIdleCallback.
 * Falls back to setTimeout if requestIdleCallback is unavailable.
 */
export function hydrateIdle(container, componentFn, props, options = {}) {
	const allElements = Array.from(container.querySelectorAll('[data-vsk]'));
	const chunkSize = options.chunkSize || 10;
	const timeout = options.timeout || 3000;
	let idx = 0;
	let walker = createHydrateWalker(container, []);

	const rIC = window.requestIdleCallback || ((cb) => setTimeout(cb, 50));
	const cIC = window.cancelIdleCallback || clearTimeout;

	let rafId = null;

	function processChunk(deadline) {
		const end = Math.min(idx + chunkSize, allElements.length);
		const chunk = allElements.slice(idx, end);
		idx = end;

		// Create walker for this chunk
		walker = createHydrateWalker(container, chunk);
		// Run component function with this chunk's walker
		componentFn(props, new Map(), walker);

		if (idx < allElements.length && (!deadline || deadline.timeRemaining() > 0 || deadline.didTimeout)) {
			rafId = rIC(processChunk, { timeout });
		}
	}

	rafId = rIC(processChunk, { timeout });

	return {
		cancel() {
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
