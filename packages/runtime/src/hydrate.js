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

const _SHOW_COMMENT = 128;
const _FILTER_ACCEPT = 1;
const _FILTER_SKIP = 2;

function collectVskMarkers(container) {
	const markers = [];
	const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
		acceptNode: (node) => (node.textContent === 'vsk' ? _FILTER_ACCEPT : _FILTER_SKIP),
	});
	while (walker.nextNode()) markers.push(walker.currentNode);
	return markers;
}

export function createHydrateWalker(container, markerList) {
	const markers = markerList || (container ? collectVskMarkers(container) : []);
	let markerIdx = 0;

	return {
		root: container,
		done() {
			return markerIdx >= markers.length;
		},
		nextElement(tag) {
			while (markerIdx < markers.length) {
				const marker = markers[markerIdx++];
				const el = marker.nextElementSibling;
				marker.remove();
				if (tag && (!el || el.tagName.toLowerCase() !== tag)) continue;
				for (let i = el.childNodes.length - 1; i >= 0; i--) {
					if (el.childNodes[i].nodeType === 3) {
						el.childNodes[i].remove();
					}
				}
				return el;
			}
			return document.createElement(tag || 'div');
		},
		subWalker(rootEl) {
			const subMarkers = markers.slice(markerIdx).filter((m) => {
				if (rootEl === m) return true;
				if (!rootEl || !m) return false;
				if (typeof rootEl.contains === 'function') return rootEl.contains(m);
				return false;
			});
			markerIdx += subMarkers.length;
			return createHydrateWalker(rootEl, subMarkers);
		},
	};
}

export function createHydrateChildWalker(parentEl) {
	let childIdx = 0;
	const children = parentEl ? parentEl.children : [];

	return {
		root: parentEl,
		nextElement(tag) {
			while (childIdx < children.length) {
				const child = children[childIdx++];
				if (!tag || child.tagName.toLowerCase() === tag) {
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
	const walker = createHydrateWalker(container);
	return componentFn(props, new Map(), walker);
}

export function hydrateViewport(container, componentFn, props, rootMargin = 500) {
	const allMarkers = collectVskMarkers(container);

	const viewportMarkers = [];
	const deferredMarkers = [];
	for (const marker of allMarkers) {
		const el = marker.nextElementSibling;
		if (!el) { deferredMarkers.push(marker); continue; }
		const rect = el.getBoundingClientRect();
		if (rect.bottom < -rootMargin || rect.top > window.innerHeight + rootMargin) {
			deferredMarkers.push(marker);
		} else {
			viewportMarkers.push(marker);
		}
	}

	for (const marker of deferredMarkers) {
		marker.textContent = 'vsk-hold';
	}

	const viewportWalker = createHydrateWalker(container, viewportMarkers);
	componentFn(props, new Map(), viewportWalker);

	if (deferredMarkers.length > 0) {
		return new Promise((resolve) => {
			const observer = new IntersectionObserver((entries) => {
				const toHydrate = [];
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const el = entry.target;
						const siblings = el.parentNode ? Array.from(el.parentNode.childNodes) : [];
						const heldMarker = siblings.find(
							(n) => n.nodeType === 8 && n.textContent === 'vsk-hold' && n.nextElementSibling === el
						);
						if (heldMarker) {
							heldMarker.textContent = 'vsk';
							toHydrate.push(heldMarker);
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

			observer._observed = deferredMarkers.length;
			for (const marker of deferredMarkers) {
				const el = marker.nextElementSibling;
				if (el) observer.observe(el);
			}
		});
	}

	return Promise.resolve();
}

export function hydrateIdle(container, componentFn, props, options = {}) {
	const allMarkers = collectVskMarkers(container);
	const chunkSize = options.chunkSize || 10;
	const timeout = options.timeout || 3000;
	let idx = 0;

	const rIC = window.requestIdleCallback || ((cb) => setTimeout(cb, 50));
	const cIC = window.cancelIdleCallback || clearTimeout;

	let rafId = null;
	let cancelled = false;

	function processChunk(deadline) {
		if (cancelled) return;
		const end = Math.min(idx + chunkSize, allMarkers.length);
		const chunk = allMarkers.slice(idx, end);
		idx = end;

		if (chunk.length > 0) {
			const walker = createHydrateWalker(container, chunk);
			componentFn(props, new Map(), walker);
		}

		if (idx < allMarkers.length && (!deadline || deadline.timeRemaining() > 0 || deadline.didTimeout)) {
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

export function needsHydration(container) {
	const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
		acceptNode: (node) => (node.textContent === 'vsk' ? _FILTER_ACCEPT : _FILTER_SKIP),
	});
	return walker.nextNode() !== null;
}

export function hydrationCount(container) {
	let count = 0;
	const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
		acceptNode: (node) => {
			if (node.textContent === 'vsk') { count++; return _FILTER_ACCEPT; }
			return _FILTER_SKIP;
		},
	});
	while (walker.nextNode());
	return count;
}
