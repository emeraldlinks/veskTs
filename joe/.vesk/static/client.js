// --- track.js ---
/**
 * Vesk Reactive Runtime — Fine-Grained Reactivity Without VDOM
 *
 * Each `track()` call creates a reactive cell. Effects auto-track
 * which cells they read. When a cell changes, only the specific
 * effects that read it re-run, updating only the DOM nodes they touch.
 *
 * No virtual DOM. No diffing. No scheduling overhead.
 */

/** @type {Effect | null} */
let currentEffect = null;

/** @type {Set<Cell> | null} */
let currentDeps = null;

/** @type {number} */
let batchDepth = 0;

/** @type {Set<Effect>[]} */
const batchQueue = [];

/**
 * A reactive cell wrapping a value with subscriber tracking.
 * @template T
 */
class Cell {
	/** @type {T} */
	#value;

	/** @type {Set<Effect>} */
	#subscribers = new Set();

	/**
	 * @param {T} initialValue
	 */
	constructor(initialValue) {
		this.#value = initialValue;
	}

	/**
	 * Read the cell's value. If an effect is running, register it as a subscriber.
	 * @returns {T}
	 */
	get() {
		if (currentEffect) {
			this.#subscribers.add(currentEffect);
			currentDeps?.add(this);
		}
		return this.#value;
	}

	/**
	 * Read the value without tracking dependencies.
	 * @returns {T}
	 */
	peek() {
		return this.#value;
	}

	/**
	 * Set a new value. If changed, notify all subscribers.
	 * @param {T} newValue
	 * @returns {boolean} whether the value actually changed
	 */
	set(newValue) {
		if (Object.is(this.#value, newValue)) return false;
		this.#value = newValue;
		this.#notify();
		return true;
	}

	/**
	 * Update via callback. Notifies only if value changed.
	 * @param {(current: T) => T} fn
	 * @returns {boolean}
	 */
	update(fn) {
		return this.set(fn(this.#value));
	}

	/**
	 * Remove an effect from this cell's subscriber set.
	 * @param {Effect} effect
	 */
	unsubscribe(effect) {
		this.#subscribers.delete(effect);
	}

	/**
	 * Notify all subscribers. Respects batching.
	 * Snapshots the subscriber set before iterating to avoid infinite loops
	 * when effects re-subscribe during re-run.
	 */
	#notify() {
		if (batchDepth > 0) {
			batchQueue[batchQueue.length - 1].add(...this.#subscribers);
			return;
		}
		// Snapshot: effect.run() unsubscribes then re-subscribes, which would
		// cause the iterator to revisit the same element in an infinite loop.
		const subs = Array.from(this.#subscribers);
		for (const effect of subs) {
			effect.run();
		}
	}
}

/**
 * An effect that auto-tracks reactive dependencies.
 * When any cell it reads changes, it re-runs.
 */
class Effect {
	/** @type {() => void} */
	#fn;

	/** @type {Set<Cell>} */
	#deps = new Set();

	/** @type {boolean} */
	#active = false;

	/**
	 * @param {() => void} fn
	 */
	constructor(fn) {
		this.#fn = fn;
		this.run();
	}

	/** Run the effect, re-tracking dependencies. */
	run() {
		if (!this.#active && batchDepth > 0) {
			batchQueue[batchQueue.length - 1].add(this);
			return;
		}

		// Unsubscribe from old deps
		for (const cell of this.#deps) {
			cell.unsubscribe(this);
		}

		// Track new deps
		const prev = currentEffect;
		const prevDeps = currentDeps;
		currentEffect = this;
		currentDeps = new Set();

		try {
			this.#fn();
		} finally {
			this.#deps = currentDeps;
			currentEffect = prev;
			currentDeps = prevDeps;
		}

		this.#active = true;
	}

	/** Stop this effect from re-running. */
	destroy() {
		for (const cell of this.#deps) {
			cell.unsubscribe(this);
		}
		this.#deps.clear();
		this.#active = false;
	}
}

/**
 * Create a reactive cell.
 * @template T
 * @param {T} initialValue
 * @returns {Cell<T>}
 */
function track(initialValue) {
	return new Cell(initialValue);
}

/**
 * Create an effect that auto-tracks dependencies.
 * @param {() => void} fn
 * @returns {Effect}
 */
function effect(fn) {
	return new Effect(fn);
}

/**
 * Batch multiple updates into a single effect re-run cycle.
 * Effects triggered during the batch are deferred until the batch ends.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function batch(fn) {
	batchDepth++;
	batchQueue.push(new Set());
	try {
		return fn();
	} finally {
		const pending = batchQueue.pop();
		batchDepth--;
		if (batchDepth === 0 && pending) {
			for (const e of pending) {
				e.run();
			}
		}
	}
}

/**
 * Create a derived (computed) cell that updates when its dependencies change.
 * @template T
 * @param {() => T} fn
 * @returns {Cell<T>}
 */
function derived(fn) {
	const cell = track(undefined);
	effect(() => {
		cell.set(fn());
	});
	return cell;
}

// --- context.js ---
const ctx = { current: null };

function getActiveComponent() {
  return ctx.current ?? globalThis.__vesk_ctx ?? null;
}

function setActiveComponent(value) {
  ctx.current = value;
}

class Context {
  constructor(value) {
    this._v = value;
  }
  get() {
    let current = getActiveComponent();
    while (current) {
      if (current.c?.has(this)) return current.c.get(this);
      current = current.p;
    }
    return this._v;
  }
  set(value) {
    const component = getActiveComponent();
    if (component === null) throw new Error('No active component found, cannot set context');
    let map = component.c;
    if (map === null) map = component.c = new Map();
    map.set(this, value);
  }
}

function createContext(value) {
  return new Context(value);
}

// --- hydrate.js ---
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

function createHydrateWalker(container, elementList) {
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
function hydrate(container, componentFn, props) {
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
function hydrateViewport(container, componentFn, props, rootMargin = 500) {
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
function hydrateIdle(container, componentFn, props, options = {}) {
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
function needsHydration(container) {
	return container.querySelector('[data-vsk]') !== null;
}

/**
 * Count remaining hydration markers.
 */
function hydrationCount(container) {
	return container.querySelectorAll('[data-vsk]').length;
}

// --- resource.js ---

function createResource(fn) {
  const state = track({ loading: true, error: null, data: undefined });

  fn().then(
    data => state.set({ loading: false, error: null, data }),
    error => state.set({ loading: false, error, data: undefined })
  );

  function resource() {
    return state.get().data;
  }
  Object.defineProperty(resource, 'loading', {
    get() { return state.get().loading; }
  });
  Object.defineProperty(resource, 'error', {
    get() { return state.get().error; }
  });

  return resource;
}

// --- reconcile.js ---
function reconcile(anchor, endAnchor, items, keyFn, createItem) {
  const parent = anchor.parentNode;
  const map = new Map();

  for (const item of items) {
    const key = keyFn(item);
    const marker = document.createComment('k:' + key);
    const effs = [];
    parent.insertBefore(marker, endAnchor);
    createItem(item, effs);
    map.set(key, { marker, effs });
  }

  return (newItems) => {
    const newKeys = newItems.map(keyFn);
    const newSet = new Set(newKeys);

    for (const [key, { marker, effs }] of map) {
      if (!newSet.has(key)) {
        removeRange(marker, endAnchor);
        marker.remove();
        for (const e of effs) e.destroy();
        map.delete(key);
      }
    }

    let ref = endAnchor;
    for (let i = newKeys.length - 1; i >= 0; i--) {
      const key = newKeys[i];
      let entry = map.get(key);
      if (entry) {
        if (entry.marker.nextSibling !== ref) {
          moveBefore(entry.marker, endAnchor, ref);
        }
        ref = entry.marker;
      } else {
        const marker = document.createComment('k:' + key);
        const effs = [];
        parent.insertBefore(marker, ref);
        createItem(newItems[i], effs);
        map.set(key, { marker, effs });
        ref = marker;
      }
    }
  };
}

function removeRange(start, end) {
  let n = start.nextSibling;
  while (n && n !== end && !(n.nodeType === 8 && n.nodeValue && n.nodeValue.startsWith('k:'))) {
    const next = n.nextSibling;
    n.remove();
    n = next;
  }
}

function moveBefore(marker, endAnchor, ref) {
  const nodes = [];
  let n = marker.nextSibling;
  while (n && n !== endAnchor && !(n.nodeType === 8 && n.nodeValue && n.nodeValue.startsWith('k:'))) {
    nodes.push(n);
    n = n.nextSibling;
  }
  const parent = marker.parentNode;
  parent.insertBefore(marker, ref);
  for (const node of nodes) parent.insertBefore(node, ref);
}

// --- bindings.js ---
/**
 * Vesk Bindings — Two-way data binding via {ref} attribute
 *
 * Every binding is a ref-compatible function: (node) => cleanup
 * Usage: <input ref={bindValue(c)} />  where c is a Cell from track()
 */


function isCell(v) {
	return v && typeof v === 'object' && typeof v.get === 'function' && typeof v.set === 'function';
}

function bindValue(cell) {
	if (!isCell(cell)) throw new TypeError('bindValue requires a tracked cell');
	return (node) => {
		const onInput = () => cell.set(node.value);
		const onChange = () => cell.set(node.value);
		node.addEventListener('input', onInput);
		node.addEventListener('change', onChange);
		const eff = effect(() => { node.value = cell.get(); });
		return () => {
			node.removeEventListener('input', onInput);
			node.removeEventListener('change', onChange);
			eff.destroy();
		};
	};
}

function bindChecked(cell) {
	if (!isCell(cell)) throw new TypeError('bindChecked requires a tracked cell');
	return (node) => {
		const onChange = () => cell.set(node.checked);
		node.addEventListener('change', onChange);
		const eff = effect(() => { node.checked = Boolean(cell.get()); });
		return () => {
			node.removeEventListener('change', onChange);
			eff.destroy();
		};
	};
}

function bindGroup(cell, value) {
	if (!isCell(cell)) throw new TypeError('bindGroup requires a tracked cell');
	return (node) => {
		if (node.type === 'radio') {
			const onChange = () => { if (node.checked) cell.set(value); };
			node.addEventListener('change', onChange);
			const eff = effect(() => { node.checked = cell.get() === value; });
			return () => {
				node.removeEventListener('change', onChange);
				eff.destroy();
			};
		}
		const onChange = () => {
			const arr = cell.get();
			if (node.checked) {
				if (!arr.includes(value)) cell.set([...arr, value]);
			} else {
				cell.set(arr.filter((v) => v !== value));
			}
		};
		node.addEventListener('change', onChange);
		const eff = effect(() => { node.checked = cell.get().includes(value); });
		return () => {
			node.removeEventListener('change', onChange);
			eff.destroy();
		};
	};
}

// --- router.js ---

// ── Redirect — throws a redirect that SSR can catch ───────────

class Redirect extends Error {
	constructor(url, status = 302) {
		super(`Redirect to ${url}`);
		this.url = url;
		this.status = status;
		this.name = 'Redirect';
	}
}

function redirect(url, status = 302) {
	throw new Redirect(url, status);
}

/** 308 Permanent Redirect */
function permanentRedirect(url) {
	throw new Redirect(url, 308);
}

// ── NotFound — triggers a 404 response ──────────────────────────

class NotFoundError extends Error {
	constructor(msg = 'Not Found') {
		super(msg);
		this.name = 'NotFoundError';
	}
}

/** Trigger a 404 — caught by dev server or API route executor */
function notFound() {
	throw new NotFoundError();
}

// ── Router Context ──────────────────────────────────────────────

const RouterCtx = createContext(null);

let _currentRouter = null;
let _outletId = 0;

// ── Outlet Component ───────────────────────────────────────────

function Outlet(props) {
	const router = RouterCtx.get();
	if (!router) return document.createComment('outlet');
	const div = document.createElement('div');
	div.setAttribute('data-vesk-outlet', String(_outletId++));
	div.style.display = 'contents';
	if (router._outletPlaceholders) {
		router._outletPlaceholders.push(div);
	}
	const seg = router._currentSegments && router._currentSegments[router._depth];
	if (seg && seg.rendered) {
		div.appendChild(seg.rendered);
	}
	return div;
}

// ── Link Component ──────────────────────────────────────────────

function Link(props) {
	const href = props.href || '#';
	const attrs = [
		`href="${href.replace(/"/g, '&quot;')}"`,
		props.class ? `class="${String(props.class).replace(/"/g, '&quot;')}"` : '',
		props.style ? `style="${String(props.style).replace(/"/g, '&quot;')}"` : '',
		props.target ? `target="${String(props.target).replace(/"/g, '&quot;')}"` : '',
		props.rel ? `rel="${String(props.rel).replace(/"/g, '&quot;')}"` : '',
	].filter(Boolean).join(' ');
	let childStr = '';
	if (props.children != null) {
		childStr = typeof props.children === 'string' ? props.children
			: typeof props.children === 'number' ? String(props.children)
			: '';
	}
	if (typeof document === 'undefined') {
		return `<a ${attrs}>${childStr}</a>`;
	}
	const a = document.createElement('a');
	a.href = href;
	if (props.class) a.className = props.class;
	if (props.style) a.setAttribute('style', props.style);
	if (props.target) a.target = props.target;
	if (props.rel) a.rel = props.rel;
	if (childStr) a.textContent = childStr;
	a.addEventListener('click', (e) => {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
		if (props.target === '_blank') return;
		e.preventDefault();
		const nav = useNavigate();
		nav(href);
	});
	return a;
}

// ── NavLink Component ───────────────────────────────────────────

function NavLink(props) {
	if (typeof document === 'undefined') {
		return Link(props);
	}
	const a = Link(props);
	const path = usePathname();
	const isActive = props.href === path || (props.href !== '/' && path.startsWith(props.href));
	if (isActive) {
		a.classList.add(props.activeClass || 'active');
		if (props.ariaCurrent !== false) a.setAttribute('aria-current', 'page');
	}
	return a;
}

// ── Hooks ──────────────────────────────────────────────────────

const _state = {
	path: track('/'),
	params: track({}),
	search: track(''),
};

function useNavigate() {
	const router = RouterCtx.get() || _currentRouter;
	return (path, opts = {}) => {
		if (router && router.navigate) {
			router.navigate(path, opts);
		} else {
			window.history.pushState({}, '', path);
			_state.path.set(path);
		}
	};
}

function useParams() {
	return _state.params.get();
}

function usePathname() {
	return _state.path.get();
}

function useSearchParams() {
	const s = _state.search.get();
	const sp = new URLSearchParams(s || '');
	const setter = (next) => {
		const q = typeof next === 'string' ? next : new URLSearchParams(next).toString();
		_state.search.set(q);
		const nav = useNavigate();
		const path = _state.path.get();
		nav(path + (q ? '?' + q : ''), { replace: true });
	};
	return [sp, setter];
}

function useRouter() {
	const router = RouterCtx.get() || _currentRouter;
	return {
		push: (href) => router?.navigate?.(href),
		replace: (href) => router?.navigate?.(href, { replace: true }),
		back: () => window.history.back(),
		forward: () => window.history.forward(),
		refresh: () => router?.navigate?.(window.location.pathname, { replace: true }),
	};
}

// ── Route Tree Types ───────────────────────────────────────────

/*
 * RouteNode:
 *   path: string           // URL segment ('' for root, ':param' for dynamic, '*' for catch-all)
 *   fullPath: string       // Full URL pattern
 *   isGroup: boolean       // Route group (no URL segment)
 *   isDynamic: boolean     // [param] segment
 *   isCatchAll: boolean    // [...param] segment
 *   page: Function|null    // Page component
 *   layout: Function|null  // Layout component
 *   children: RouteNode[]
 *   layouts: RouteNode[]   // Flattened layout chain for this route
 */

function compileRoutePattern(fullPath) {
	const paramNames = [];
	const parts = fullPath.split('/').filter(Boolean);
	let regexStr = '^';
	for (const part of parts) {
		if (part.startsWith(':')) {
			const name = part.slice(1);
			paramNames.push(name);
			regexStr += '/([^/]+)';
		} else if (part === '*') {
			regexStr += '(?:/(.*))?';
		} else {
			regexStr += '/' + part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	regexStr += '$';
	return { regex: new RegExp(regexStr), paramNames };
}

function collectLayouts(nodes, pathParts) {
	const layouts = [];
	for (const node of nodes) {
		if (node.isGroup) {
			const childLayouts = collectLayouts(node.children, pathParts);
			layouts.push(...childLayouts);
			continue;
		}
		if (node.layout) {
			layouts.push({ layout: node.layout, node });
		}
		const len = pathParts.length;
		const matched = matchRouteNode(node, pathParts);
		if (matched) {
			const remaining = pathParts.slice(node.segmentCount || 1);
			if (remaining.length > 0 && node.children.length > 0) {
				const childLayouts = collectLayouts(node.children, remaining);
				layouts.push(...childLayouts);
			}
		}
	}
	return layouts;
}

function matchRouteNode(node, pathParts) {
	if (node.isGroup) return false;
	if (pathParts.length === 0) return node.fullPath === '/';
	const part = pathParts[0];
	if (node.isCatchAll) return true;
	if (node.isDynamic) return true;
	return node.path === part;
}

function extractParams(node, pathParts) {
	const params = {};
	let idx = 0;
	for (const node of node._matchChain || []) {
		if (node.isDynamic && pathParts[idx]) {
			const name = node.path.slice(1); // remove ':'
			params[name] = decodeURIComponent(pathParts[idx]);
		} else if (node.isCatchAll) {
			const name = node.path.slice(1); // remove ':'
			params[name] = pathParts.slice(idx).map(decodeURIComponent).join('/');
		}
		if (!node.isGroup) idx++;
	}
	return params;
}

// ── Route Tree Matching ────────────────────────────────────────

function flattenLayoutChain(tree, pathParts, result = []) {
	for (let i = 0; i < tree.length; i++) {
		const node = tree[i];
		if (node.isGroup) {
			flattenLayoutChain(node.children, pathParts, result);
			continue;
		}

		const part = pathParts[0];

		// Check if this node matches the current path segment
		let matched = false;
		if (node.fullPath === '/') {
			matched = pathParts.length === 0 || pathParts.every(p => p === '');
		} else if (node.isCatchAll) {
			matched = true;
		} else if (node.isDynamic) {
			matched = part !== undefined;
		} else {
			matched = node.path === part;
		}

		if (matched) {
			if (node.layout) {
				result.push(node);
			}
			const remaining = pathParts.slice(node.isCatchAll ? pathParts.length : 1);
			if (remaining.length === 0 || remaining.every(p => p === '')) {
				// This is the leaf — add the page
				if (node.page) result.push(node);
				break;
			} else if (node.children.length > 0) {
				flattenLayoutChain(node.children, remaining, result);
				break;
			}
		}
	}
	return result;
}

// ── Router Implementation ──────────────────────────────────────

function matchRoute(tree, pathname) {
	const pathParts = pathname.split('/').filter(Boolean);
	const matchChain = flattenLayoutChain(tree, pathParts);
	if (matchChain.length === 0) return null;

	const params = {};
	for (const node of matchChain) {
		if (node.isDynamic) {
			let partIndex = 0;
			let found = false;
			for (let i = 0; i < tree.length; i++) {
				if (tree[i].isGroup) continue;
				if (tree[i].fullPath === '/') continue;
				if (tree[i] === node) { found = true; break; }
				partIndex++;
			}
			if (pathParts[partIndex]) {
				const name = node.path.startsWith(':') ? node.path.slice(1) : node.path;
				params[name] = decodeURIComponent(pathParts[partIndex]);
			}
		}
		if (node.isCatchAll) {
			const name = node.path.startsWith(':') ? node.path.slice(1) : node.path;
			let idx = 0;
			for (let i = 0; i < tree.length; i++) {
				if (tree[i].isGroup) continue;
				if (tree[i] === node) break;
				idx++;
			}
			params[name] = pathParts.slice(idx).map(decodeURIComponent).join('/');
		}
	}

	return { matchChain, params };
}

function renderMatch(router, match, container) {
	container.innerHTML = '';
	const chain = match.matchChain;
	const paramValues = match.params;

	// Find the page node (the last one in the chain that has a page component)
	let pageNode = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}

	if (!pageNode) {
		container.innerHTML = '<h1>404 — Not Found</h1>';
		return;
	}

	// Collect layout nodes (everything before pageNode that has a layout)
	const layoutNodes = chain.filter(n => n.layout && n !== pageNode);

	// Create a client-side walker that creates fresh elements (no hydration)
	const clientWalker = createHydrateWalker(container, []);

	// Build the component tree: outermost layout wraps... wraps page
	// We render top-down: each component receives children (the next inner component)
	function renderLayoutChain(index) {
		if (index >= layoutNodes.length) {
			// Render the page
			_state.params.set(paramValues);
			_state.path.set(match.pathname || window.location.pathname);
			_state.search.set(window.location.search || '');

			const pageProps = { params: paramValues, ...pageNode.props };
			const dom = pageNode.page(pageProps, new Map(), clientWalker);
			return dom;
		}

		const node = layoutNodes[index];
		// Create a fragment to hold the child content
		const childDom = renderLayoutChain(index + 1);

		// Wrap in the layout
		const layoutProps = { children: childDom, params: paramValues };
		const layoutDom = node.layout(layoutProps, new Map(), clientWalker);
		return layoutDom;
	}

	const rootDom = renderLayoutChain(0);
	if (rootDom && typeof rootDom === 'object' && rootDom.nodeType) {
		container.appendChild(rootDom);
	} else if (typeof rootDom === 'string') {
		container.innerHTML = rootDom;
	}
}

/**
 * Hydrate initial SSR content — claims existing DOM nodes instead of re-rendering.
 * Supports layout chains by passing children as hydrator functions: each layout
 * receives a function that hydrates the inner component with a subWalker,
 * enabling the SlotNode codegen to claim nested data-vsk elements correctly.
 */
function hydrateInitial(router, match, container) {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}
	if (!pageNode) {
		container.innerHTML = '<h1>404 — Not Found</h1>';
		return;
	}

	const layoutNodes = chain.filter(n => n.layout && n !== pageNode);

	_state.params.set(paramValues);
	_state.path.set(match.pathname || window.location.pathname);
	_state.search.set(window.location.search || '');

	if (layoutNodes.length === 0) {
		hydrate(container, pageNode.page, { params: paramValues, ...pageNode.props });
		return;
	}

	// Build a hydration chain: outermost layout receives children as a function,
	// which when called hydrates the next level with a subWalker.
	function createChildrenFn(index) {
		return (childWalker) => {
			if (index >= layoutNodes.length) {
				// Page level
				return pageNode.page({ params: paramValues, ...pageNode.props }, new Map(), childWalker);
			}
			const node = layoutNodes[index];
			const childrenFn = createChildrenFn(index + 1);
			return node.layout({ params: paramValues, children: childrenFn }, new Map(), childWalker);
		};
	}

	// Start hydration with the outermost layout
	const allElements = Array.from(container.querySelectorAll('[data-vsk]'));
	const walker = createHydrateWalker(container, allElements);
	const topLayout = layoutNodes[0];
	topLayout.layout({ params: paramValues, children: createChildrenFn(1) }, new Map(), walker);
}

// ── Create Router (Manual) ─────────────────────────────────────

function createRouter(
	routes,
	options = {}
) {
	const container = options.container || document.getElementById('root');
	const prefetch = options.prefetch !== false;

	// Build route tree from flat route map
	const routeTree = buildTreeFromMap(routes, options);

	const router = {
		routeTree,
		container,
		_currentMatch: null,
		_outletPlaceholders: [],
		_currentSegments: null,
		_depth: 0,

		start() {
			_currentRouter = this;
			// Set up click delegation
			document.addEventListener('click', (e) => {
				const link = e.target.closest('a[href]');
				if (!link) return;
				if (link.hostname && link.hostname !== window.location.hostname) return;
				const href = link.getAttribute('href');
				if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				e.preventDefault();
				this.navigate(href);
			});

			window.addEventListener('popstate', () => {
				this.navigate(window.location.href, { replace: true });
			});

			if (prefetch) {
				document.addEventListener('mouseenter', (e) => {
					const link = e.target.closest('a[href]');
					if (link) this.prefetch(link.getAttribute('href'));
				}, { passive: true });
			}

			// Render initial route
			const path = window.location.pathname + window.location.search;
			this.navigate(path, { replace: true });

			return this;
		},

		async navigate(path, opts = {}) {
			const url = new URL(path, window.location.origin);
			const match = matchRoute(this.routeTree, url.pathname);

			if (!match) {
				window.location.href = path;
				return;
			}

			match.pathname = url.pathname;

			if (!opts.replace) {
				window.history.pushState({ path: url.pathname }, '', url.pathname);
			} else {
				window.history.replaceState({ path: url.pathname }, '', url.pathname);
			}

			_state.path.set(url.pathname);
			_state.search.set(url.search);

			renderMatch(this, match, this.container);
			this._currentMatch = match;
		},

		prefetch(path) {
			// For manual routes, could preload lazy components
		},

		get currentPath() {
			return _state.path.get();
		}
	};

	return router;
}

function buildTreeFromMap(routes) {
	const tree = [];
	for (const [pattern, loader] of Object.entries(routes)) {
		const parts = pattern.split('/').filter(Boolean);
		const isDynamic = parts.some(p => p.startsWith(':'));
		const node = {
			path: parts[parts.length - 1] || '',
			fullPath: pattern,
			isGroup: false,
			isDynamic,
			isCatchAll: false,
			page: null,
			layout: null,
			children: [],
			loader,
		};
		tree.push(node);
	}
	return tree;
}

// ── Create File Router ─────────────────────────────────────────

function createFileRouter(routeTree, options = {}) {
	const container = options.container || document.getElementById('root');
	const middleware = options.middleware || null;
	const renderFn = options.render || renderMatch;

	const router = {
		routeTree,
		container,
		_currentMatch: null,
		_outletPlaceholders: [],
		_currentSegments: null,
		_depth: 0,

		start() {
			_currentRouter = this;
			document.addEventListener('click', (e) => {
				const link = e.target.closest('a[href]');
				if (!link) return;
				if (link.hostname && link.hostname !== window.location.hostname) return;
				const href = link.getAttribute('href');
				if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				e.preventDefault();
				router.navigate(href);
			});
			window.addEventListener('popstate', () => {
				router.navigate(window.location.pathname, { replace: true });
			});

			const path = window.location.pathname;
			const hasSsrContent = container.querySelector('[data-vsk]');

			if (hasSsrContent) {
				const match = matchRoute(routeTree, path);
				if (match) {
					match.pathname = path;
					_state.path.set(path);
					_state.search.set(window.location.search);
					hydrateInitial(router, match, container);
					router._currentMatch = match;
					return router;
				}
			}

			router.navigate(path, { replace: true });
			return router;
		},

		navigate(pathname, opts = {}) {
			const url = pathname instanceof URL ? pathname : new URL(pathname, window.location.origin);
			const match = matchRoute(routeTree, url.pathname);
			if (!match) {
				container.innerHTML = '<h1>404 — Not Found</h1>';
				return;
			}

			match.pathname = url.pathname;

			// Run middleware chain (onion model)
			const middlewareFns = Array.isArray(middleware) ? middleware : (middleware ? [middleware] : []);

			async function runMwChain(index) {
				if (index >= middlewareFns.length) {
					// All middleware passed — render
					if (!opts.replace) {
						window.history.pushState({ path: url.pathname }, '', url.pathname);
					} else {
						window.history.replaceState({ path: url.pathname }, '', url.pathname);
					}
					_state.path.set(url.pathname);
					_state.search.set(url.search);
					renderFn(router, match, container);
					router._currentMatch = match;
					return;
				}

				const fn = middlewareFns[index];
				const ctx = { url: url.pathname, params: match.params, router, locals: {} };

				async function next(rewrite) {
					if (rewrite) {
						match.pathname = rewrite;
						url.pathname = rewrite;
					}
					return runMwChain(index + 1);
				}

				try {
					const result = await fn(ctx, next);
					if (result && result.redirect) {
						router.navigate(result.redirect, { replace: true });
						return;
					}
				} catch (e) {
					if (e && e.name === 'Redirect') {
						router.navigate(e.url, { replace: true });
						return;
					}
				}
			}

			if (middlewareFns.length > 0) {
				runMwChain(0);
			} else {
				if (!opts.replace) {
					window.history.pushState({ path: url.pathname }, '', url.pathname);
				} else {
					window.history.replaceState({ path: url.pathname }, '', url.pathname);
				}
				_state.path.set(url.pathname);
				_state.search.set(url.search);
				renderFn(router, match, container);
				router._currentMatch = match;
			}
		},

		get currentPath() {
			return _state.path.get();
		}
	};

	return router;
}

// ── Route Tree Builder (for compiler output) ───────────────────

function defineRoute(path, config) {
	return { path, ...config };
}

function buildRouteTree(definitions) {
	const tree = [];
	for (const def of definitions) {
		const parts = def.path.split('/').filter(Boolean);
		const isDynamic = parts.some(p => p.startsWith(':'));
		const isCatchAll = parts.some(p => p === '*');

		const node = {
			path: parts[parts.length - 1] || '',
			fullPath: def.path,
			isGroup: false,
			isDynamic,
			isCatchAll,
			page: def.page || null,
			layout: def.layout || null,
			children: (def.children || []).map(c => {
				const cParts = c.path.split('/').filter(Boolean);
				return {
					...c,
					path: cParts[cParts.length - 1] || '',
					fullPath: (def.path + (c.path ? '/' + c.path : '')).replace(/\/+/g, '/'),
					isDynamic: cParts.some(p => p.startsWith(':')),
					isCatchAll: cParts.some(p => p === '*'),
					isGroup: false,
					segmentCount: Math.max(1, cParts.length),
					children: [],
				};
			}),
			segmentCount: Math.max(1, parts.length),
		};
		tree.push(node);
	}
	return tree;
}

// --- request.js ---
/**
 * Vesk request hooks — cookies() and headers(), matching Next.js App Router API.
 *
 * SSR: reads from globalThis.__vesk_request (set by dev server before renderPage)
 * API: reads from globalThis.__vesk_request (set by executeApiRoute)
 * Client: cookies() reads document.cookie, headers() returns empty
 */

function getRequest() {
	return globalThis.__vesk_request || null;
}

/**
 * Get the current request's cookies.
 *
 * Returns a store-like object with:
 *   .get(name)     → value or undefined
 *   .getAll()      → [{ name, value }]
 *   .toString()    → raw Cookie header
 *   [name]         → direct access
 *
 * In SSR/API: reads from the incoming request's Cookie header.
 * On client: reads from document.cookie (synchronous snapshot).
 */
function cookies() {
	const req = getRequest();
	let jar = {};

	if (req && req.cookies) {
		jar = { ...req.cookies };
	} else if (typeof document !== 'undefined') {
		for (const pair of document.cookie.split(';')) {
			const eq = pair.indexOf('=');
			if (eq === -1) continue;
			const k = pair.slice(0, eq).trim();
			const v = pair.slice(eq + 1).trim();
			if (k) jar[k] = decodeURIComponent(v);
		}
	}

	return new Proxy(jar, {
		get(target, prop) {
			if (prop === 'get') return (name) => target[name] || undefined;
			if (prop === 'getAll') return () => Object.entries(target).map(([name, value]) => ({ name, value }));
			if (prop === 'toString') return () => Object.entries(target).map(([k, v]) => `${k}=${v}`).join('; ');
			if (prop in target) return target[prop];
			return undefined;
		},
	});
}

/**
 * Get the current request's headers.
 *
 * Returns a store-like object with:
 *   .get(name)     → value or null (case-insensitive)
 *   .has(name)     → boolean
 *   .entries()     → [name, value][] iterator
 *   [name]         → direct access (lowercase)
 *
 * In SSR/API: reads from the incoming request's headers.
 * On client: returns empty store (no server headers in browser).
 */
/**
 * Get the current request's locals — mutable context shared between middleware
 * and page/API handlers. Set by middleware, read by pages/APIs.
 *
 * SSR/API: reads from globalThis.__vesk_request.locals
 * Client: returns empty object
 */
function locals() {
	const req = getRequest();
	if (req && req.locals) return req.locals;
	return {};
}

function headers() {
	const req = getRequest();
	let map = new Map();

	if (req && req.headers) {
		for (const [k, v] of Object.entries(req.headers)) {
			map.set(k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v));
		}
	}

	return new Proxy({}, {
		get(_target, prop) {
			if (prop === 'get') return (name) => map.get(name.toLowerCase()) || null;
			if (prop === 'has') return (name) => map.has(name.toLowerCase());
			if (prop === 'entries') return () => map.entries();
			if (typeof prop === 'string') return map.get(prop.toLowerCase()) ?? undefined;
			return undefined;
		},
		ownKeys() {
			return [...map.keys()];
		},
		getOwnPropertyDescriptor() {
			return { enumerable: true, configurable: true };
		},
	});
}

// --- hmr-client.js ---
// Vesk HMR Client — dev-only, injected into client bundle
(function() {
  var host = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/_vesk/hmr';
  var ws = null;
  var status = 'loading';
  var errorMsg = '';
  var lastCompileMs = 0;
  var reconnectTimer = null;

  // ── Surgical page update — replaces only <main> content ──
  function applyPageUpdate(name) {
    try {
      var main = document.querySelector('main');
      if (!main) {
        __router.navigate(window.location.pathname, { replace: true });
        return;
      }
      var match = __router._currentMatch;
      if (!match) return;
      var params = match.params || {};
      var pageFn = __components[name];
      if (!pageFn) {
        __router.navigate(window.location.pathname, { replace: true });
        return;
      }
      var walker = createHydrateWalker(main, []);
      var newContent = pageFn({ params: params }, new Map(), walker);
      main.innerHTML = '';
      if (newContent && newContent.nodeType) main.appendChild(newContent);
    } catch(ex) {
      // Fallback to full navigate
      __router.navigate(window.location.pathname, { replace: true });
    }
  }

  function connect() {
    try {
      ws = new WebSocket(host);
      ws.onopen = function() {
        status = 'connected';
        updateDot();
      };
      ws.onmessage = function(e) {
        try {
          var msg = JSON.parse(e.data);
          switch (msg.type) {
            case 'component-update':
              eval(msg.fnSource);
              status = 'updated';
              lastCompileMs = msg.time || 0;
              updateDot();
              if (typeof __router !== 'undefined') {
                if (msg.kind === 'layout') {
                  __router.navigate(window.location.pathname, { replace: true });
                } else {
                  applyPageUpdate(msg.name);
                }
              }
              break;
            case 'full-reload':
              window.location.reload();
              break;
            case 'error':
              status = 'error';
              errorMsg = msg.message || 'Unknown error';
              updateDot();
              showToast('Compile error: ' + errorMsg);
              break;
            case 'compiling':
              status = 'compiling';
              updateDot();
              break;
          }
        } catch(ex) { /* ignore bad messages */ }
      };
      ws.onclose = function() {
        status = 'disconnected';
        updateDot();
        scheduleReconnect();
      };
      ws.onerror = function() {
        status = 'disconnected';
        updateDot();
        scheduleReconnect();
      };
    } catch(ex) { /* WebSocket unavailable */ }
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  }

  // ── Floating menu ──
  var menu = null;
  var dot = null;
  var label = null;

  function createMenu() {
    if (document.getElementById('__vesk_dev')) return;
    menu = document.createElement('div');
    menu.id = '__vesk_dev';
    menu.innerHTML =
      '<style>' +
      '#__vesk_dev{all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:ui-monospace,monospace;font-size:11px;line-height:1.4;color:#e0e0e0;cursor:pointer;}' +
      '#__vesk_dev *{box-sizing:border-box;}' +
      '#__vesk_dev .__v_bar{display:flex;align-items:center;gap:8px;background:#1a1b26;border:1px solid #2a2b3e;border-radius:10px;padding:6px 12px;box-shadow:0 4px 24px rgba(0,0,0,0.6);position:relative;transition:all .2s;}' +
      '#__vesk_dev .__v_bar:hover{border-color:#3a3b5e;}' +
      '#__vesk_dev .__v_dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;transition:background .3s;}' +
      '#__vesk_dev .__v_dot.connected{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,0.5);}' +
      '#__vesk_dev .__v_dot.compiling{background:#eab308;box-shadow:0 0 6px rgba(234,179,8,0.5);animation:__v_pulse .8s infinite;}' +
      '#__vesk_dev .__v_dot.error{background:#ef4444;box-shadow:0 0 6px rgba(239,68,68,0.5);}' +
      '#__vesk_dev .__v_dot.disconnected{background:#6b7280;}' +
      '#__vesk_dev .__v_dot.loading{background:#6b7280;animation:__v_pulse 1.2s infinite;}' +
      '#__vesk_dev .__v_label{white-space:nowrap;}' +
      '#__vesk_dev .__v_detail{display:none;position:absolute;bottom:calc(100% + 8px);right:0;background:#1a1b26;border:1px solid #2a2b3e;border-radius:8px;padding:10px 14px;min-width:240px;box-shadow:0 4px 24px rgba(0,0,0,0.6);white-space:pre-wrap;word-break:break-all;font-size:11px;}' +
      '#__vesk_dev .__v_bar.open .__v_detail{display:block;}' +
      '#__vesk_dev .__v_detail_row{display:flex;justify-content:space-between;gap:12px;padding:2px 0;}' +
      '#__vesk_dev .__v_detail_label{color:#888;}' +
      '#__vesk_dev .__v_detail_val{color:#e0e0e0;text-align:right;}' +
      '#__vesk_dev .__v_error{color:#ef4444;font-size:11px;margin-top:4px;max-width:280px;overflow:hidden;text-overflow:ellipsis;}' +
      '@keyframes __v_pulse{0%,100%{opacity:1}50%{opacity:.4}}' +
      '</style>' +
      '<div class="__v_bar">' +
      '  <span class="__v_dot loading"></span>' +
      '  <span class="__v_label">Vesk</span>' +
      '  <div class="__v_detail">' +
      '    <div class="__v_detail_row"><span class="__v_detail_label">Status</span><span class="__v_detail_val" id="__v_status">connecting...</span></div>' +
      '    <div class="__v_detail_row"><span class="__v_detail_label">Compile</span><span class="__v_detail_val" id="__v_time">-</span></div>' +
      '    <div class="__v_error" id="__v_error"></div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(menu);

    var bar = menu.querySelector('.__v_bar');
    bar.addEventListener('click', function(e) {
      e.stopPropagation();
      bar.classList.toggle('open');
    });

    dot = menu.querySelector('.__v_dot');
    label = menu.querySelector('.__v_label');
  }

  function updateDot() {
    if (!dot) return;
    dot.className = '__v_dot ' + status;
    var statusEl = document.getElementById('__v_status');
    if (statusEl) {
      var texts = { connected: 'Connected', compiling: 'Compiling...', error: 'Error', disconnected: 'Disconnected', loading: 'Connecting...', updated: 'Updated' };
      statusEl.textContent = texts[status] || status;
    }
  }

  function showToast(msg) {
    var errEl = document.getElementById('__v_error');
    if (errEl) errEl.textContent = msg;
  }

  // ── Init ──
  if (typeof document !== 'undefined' && document.body) {
    createMenu();
    connect();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
      createMenu();
      connect();
    });
  }
})();

// --- exports ---
export { track };
export { effect };
export { batch };
export { derived };
export { hydrate };
export { hydrateViewport };
export { hydrateIdle };
export { needsHydration };
export { hydrationCount };
export { createHydrateWalker };
export { createRouter };
export { createFileRouter };
export { Outlet };
export { Link };
export { NavLink };
export { useNavigate };
export { useParams };
export { usePathname };
export { useSearchParams };
export { useRouter };
export { buildRouteTree };
export { defineRoute };
export { Redirect };
export { redirect };
export { permanentRedirect };
export { notFound };
export { bindValue };
export { bindChecked };
export { bindGroup };
export { createContext };
export { Context };
export { getActiveComponent };
export { setActiveComponent };
export { createResource };
export { reconcile };
export { cookies };
export { headers };
export { locals };

import { track, getActiveComponent, setActiveComponent, effect, hydrate } from '/_vesk/static/client.js';
import { track } from '/_vesk/static/client.js';

const __components = {};

__components["Home"] = (props, __registry, __hydrate) => {
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const count = track(0);
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "home-page");
const $n3 = __hydrate.nextElement("button");
$n3.setAttribute("class", "btn-counter px-4 py-2 bg-blue-500 text-white rounded");
$n3.setAttribute("onClick", '');
$n3.setAttribute("data-testid", "counter-btn");
const $n4 = document.createTextNode(" Count: ");
$n3.appendChild($n4);
const $n5 = __hydrate.nextElement("span");
$n5.setAttribute("data-testid", "counter-value");
const $n6 = document.createTextNode('');
$n5.appendChild($n6);
$n3.appendChild($n5);
$n3.__evh_click = () => count.set(count.get() + 1);
$n3.setAttribute('data-vsk-ev', '');
$n0.appendChild($n3);
const $n7 = __hydrate.nextElement("button");
$n7.setAttribute("class", "px-4 py-2 bg-red-500 text-white rounded ml-2");
$n7.setAttribute("onClick", '');
$n7.setAttribute("data-testid", "reset-btn");
const $n8 = document.createTextNode(" Reset ");
$n7.appendChild($n8);
$n7.__evh_click = () => count.set(0);
$n7.setAttribute('data-vsk-ev', '');
$n0.appendChild($n7);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	effect(() => { $n6.data = String(count.get()); });
	if (!document.__vesk_dlg_click) {
		document.__vesk_dlg_click = true;
		document.addEventListener("click", (e) => {
			var el = e.target.closest('[data-vsk-ev]');
			if (el && el.__evh_click) el.__evh_click(e);
		});
	}
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, getActiveComponent, setActiveComponent, effect, hydrate } from '/_vesk/static/client.js';
import { NavLink } from '/_vesk/static/client.js';

const __components = {};

__components["RootLayout"] = (props, __registry, __hydrate) => {
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("nav");
$n0.setAttribute("class", "flex gap-4 px-6 py-3 border-b bg-white nav-root");
const $n1 = (() => { const __el = NavLink({ "href": "/", "class": "font-medium" }, __registry, __hydrate.subWalker(__hydrate.nextElement('div'))); return __el; })();
$n0.appendChild($n1);
const $n2 = (() => { const __el = NavLink({ "href": "/about", "class": "font-medium" }, __registry, __hydrate.subWalker(__hydrate.nextElement('div'))); return __el; })();
$n0.appendChild($n2);
const $n3 = (() => { const __el = NavLink({ "href": "/blog", "class": "font-medium" }, __registry, __hydrate.subWalker(__hydrate.nextElement('div'))); return __el; })();
$n0.appendChild($n3);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
const $n4 = __hydrate.nextElement("main");
$n4.setAttribute("class", "p-4");
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    props.children(__hydrate.subWalker($n4));
  } else {
    $n4.appendChild(props.children);
  }
}
	if ($n4.parentNode !== $root) $root.appendChild($n4);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, getActiveComponent, setActiveComponent, effect, hydrate } from '/_vesk/static/client.js';

const __components = {};

__components["About"] = (props, __registry, __hydrate) => {
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "about-page");
const $n3 = __hydrate.nextElement("button");
$n3.setAttribute("class", "about-btn px-3 py-1 bg-green-500 text-white rounded");
$n3.setAttribute("onClick", '');
$n3.setAttribute("data-testid", "about-btn");
const $n4 = document.createTextNode(" About Click ");
$n3.appendChild($n4);
$n3.__evh_click = () => alert('about');
$n3.setAttribute('data-vsk-ev', '');
$n0.appendChild($n3);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	if (!document.__vesk_dlg_click) {
		document.__vesk_dlg_click = true;
		document.addEventListener("click", (e) => {
			var el = e.target.closest('[data-vsk-ev]');
			if (el && el.__evh_click) el.__evh_click(e);
		});
	}
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, getActiveComponent, setActiveComponent, effect, hydrate } from '/_vesk/static/client.js';

const __components = {};

__components["AboutLayout"] = (props, __registry, __hydrate) => {
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "about-layout border-2 border-green-300 rounded p-4");
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    props.children(__hydrate.subWalker($n0));
  } else {
    $n0.appendChild(props.children);
  }
}
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, getActiveComponent, setActiveComponent, hydrate } from '/_vesk/static/client.js';

const __components = {};

__components["BlogList"] = (props, __registry, __hydrate) => {
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, getActiveComponent, setActiveComponent, effect, hydrate } from '/_vesk/static/client.js';

const __components = {};

__components["BlogLayout"] = (props, __registry, __hydrate) => {
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "blog-layout border-2 border-blue-300 rounded p-4");
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    props.children(__hydrate.subWalker($n0));
  } else {
    $n0.appendChild(props.children);
  }
}
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, getActiveComponent, setActiveComponent, effect, hydrate } from '/_vesk/static/client.js';

const __components = {};

__components["BlogPost"] = (props, __registry, __hydrate) => {
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "blog-post");
$n0.setAttribute("data-testid", "blog-post");
const $n2 = __hydrate.nextElement("h1");
$n2.setAttribute("data-testid", "post-title");
const $n3 = document.createTextNode("Post: ");
$n2.appendChild($n3);
const $n4 = document.createTextNode('');
$n2.appendChild($n4);
$n0.appendChild($n2);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	effect(() => { $n4.data = String(props.params.slug); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}

const __routeTree = [{"path":"","fullPath":"/","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Index","layout":"Layout_Index","loading":null,"error":null,"hasMiddleware":false,"children":[{"path":"about","fullPath":"/about","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_About","layout":"Layout_About","loading":null,"error":null,"hasMiddleware":false,"children":[],"sourceDir":"/home/joe/vesk/joe/app/about","segmentCount":1},{"path":"blog","fullPath":"/blog","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Blog","layout":"Layout_Blog","loading":null,"error":null,"hasMiddleware":false,"children":[{"path":":slug","fullPath":"/blog/:slug","isGroup":false,"isDynamic":true,"isCatchAll":false,"page":"Page_Blog_slug","layout":null,"loading":null,"error":null,"hasMiddleware":false,"children":[],"sourceDir":"/home/joe/vesk/joe/app/blog/[slug]","segmentCount":1}],"sourceDir":"/home/joe/vesk/joe/app/blog","segmentCount":1}],"sourceDir":"/home/joe/vesk/joe/app","segmentCount":0}];
const __router = createFileRouter(__routeTree);
if (typeof document !== 'undefined') __router.start();
