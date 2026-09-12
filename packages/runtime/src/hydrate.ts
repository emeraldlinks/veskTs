import { get, scope, set_active_block } from '@vesk/runtime/src/ripple-runtime';
import { root } from '@vesk/runtime/src/ripple-blocks';

// Hydrators invoke user component functions outside the router. componentFn
// runs `track()`/`effect()` calls that attach to whatever block is active.
// With no active block, `schedule_update` walks an empty parent chain and
// queues a null root — the effects never flush. Establish a root block window
// (mirroring the router's runInBlockWindow) so effects created during
// hydration attach to a real root and run on the microtask flush.
function runInHydrateBlock<T>(fn: () => T): T {
	const previous = scope();
	const block = root(() => {});
	set_active_block(block);
	try {
		const result = fn();
		set_active_block(previous);
		return result;
	} catch (error) {
		set_active_block(previous);
		throw error;
	}
}

export interface HydrateClaim {
	el: Element;
}

export interface HydrateWalker {
	root: HTMLElement | null;
	done(): boolean;
	nextElement(tag?: string): Element;
	subWalker(rootEl: HTMLElement): HydrateWalker;
	/**
	 * Claim the SSR element of a keyed list item whose `data-vsk-key` matches
	 * `key`. Consumes the item's root marker and stamps the element, but leaves
	 * the item's interior markers in place so the item's own render claims them
	 * positionally. Returns `null` when no matching SSR marker remains (the item
	 * is new client-side and is rendered fresh).
	 */
	claimByKey?(key: string): HydrateClaim | null;
	/**
	 * Non-consuming variant of `claimByKey`, used to discover the DOM bounds of
	 * a keyed list region before anchoring it.
	 */
	peekKey?(key: string): Element | null;
}

interface HydrateIdleOptions {
	chunkSize?: number;
	timeout?: number;
}

interface HydrateInteractionOptions {
	events?: string[];
}

interface HydrateCancelBase {
	cancel(): void;
}

interface HydrateCancel extends HydrateCancelBase {
	hydrateNow(): void;
}

/**
 * Wrap a props object in a Proxy so tracked values passed as props are read
 * reactively at use time (matching how the compiler passes cells down).
 */
export function reactiveProps<T extends Record<string, unknown>>(props: T): T {
	return new Proxy(props, {
		get(target, key) {
			const val = Reflect.get(target, key);
			if (typeof val === 'object' && val !== null && typeof (val as unknown as { f: unknown }).f === 'number') {
				return get(val);
			}
			return val;
		},
	});
}

// ---------------------------------------------------------------------------
// Dev-mode hydration-integrity canary (T1)
//
// Claiming the SSR DOM is inherently positional: a element claimed from the
// wrong slot fails silently in production (the SSR node is adopted as-is). To
// surface SSR/client divergence early, dev mode:
//   * stamps every adopted node with `data-vsk-claimed`,
//   * warns with the container fragment when a positional claim misses, and
//   * runs `assertFullyHydrated()` at the end of every full hydration so
//     unclaimed phantom markers are reported instead of rotting in the DOM.
// ---------------------------------------------------------------------------

let __hydrateDevMode = true;

const CLAIMED_ATTR = 'data-vsk-claimed';

export function setHydrateDevMode(enabled: boolean): void {
	__hydrateDevMode = enabled;
}

function devWarn(message: string): void {
	if (__hydrateDevMode && typeof console !== 'undefined') {
		console.warn('[vesk-hydrate] ' + message);
	}
}

function stampClaimed(el: Element): void {
	if (__hydrateDevMode) {
		try {
			el.setAttribute(CLAIMED_ATTR, '');
		} catch {
			// Some hosts restrict attribute writes on special nodes (SVG,
			// <template> children); claiming is still valid.
		}
	}
}

// Strip the direct text children of a claimed element. Static text inside a
// claimed subtree is re-created client-side as fresh text nodes, so the
// SSR-serialized text nodes are dropped to avoid duplicates.
function stripDirectTextNodes(el: Element): void {
	for (let i = el.childNodes.length - 1; i >= 0; i--) {
		if (el.childNodes[i].nodeType === 3) el.childNodes[i].remove();
	}
}

/**
 * Dev-mode check that every `<!--vsk-->` marker in `container` has been
 * claimed by the most recent full hydration pass. Markers that remain belong
 * to SSR regions the client never rendered (or rendered differently) — orphaned
 * phantom content that will never be cleaned up. Returns `false` and warns when
 * any such marker survives. Runs automatically at the end of `hydrate`,
 * `hydrateInitial`, and every hydration strategy's completion.
 */
export function assertFullyHydrated(container: HTMLElement): boolean {
	let unclaimed = 0;
	let sample = '';
	const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
		acceptNode: (node) => (node.textContent === 'vsk' ? _FILTER_ACCEPT : _FILTER_SKIP),
	});
	while (walker.nextNode()) {
		const el = (walker.currentNode as Comment).nextElementSibling;
		if (el && underClaimedAncestor(el, container)) continue;
		unclaimed++;
		if (!sample && container.outerHTML) sample = String(container.outerHTML).slice(0, 800);
	}
	if (unclaimed > 0) {
		devWarn(
			`${unclaimed} hydration marker${unclaimed === 1 ? '' : 's'} never claimed; ` +
				`SSR and client markup diverge. Container fragment:\n${sample}`
		);
		return false;
	}
	return true;
}

function underClaimedAncestor(el: Element, container: HTMLElement): boolean {
	for (let n: Element | null = el; n && n !== container; n = n.parentElement) {
		if (n.nodeType === 1 && (n as Element).hasAttribute(CLAIMED_ATTR)) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Walker marker lifecycle state machine (T3)
//
// Each marker tracked by a walker passes through `unclaimed → claimed`.
// Claiming adopts the SSR element (and strips the marker from the live DOM so
// the canary above only ever sees genuine phantoms). `claimByKey` also moves
// the marker to `claimed` but does NOT advance the positional cursor: the
// item's interior markers are claimed by the item's own render immediately
// afterwards, and the cursor must still point at the item's region for that.
// A `done()` walker whose markers were never all consumed is that same miss
// surface — the canary reports it.
// ---------------------------------------------------------------------------

type MarkerState = 'unclaimed' | 'claimed';

interface TrackedMarker {
	comment: Comment;
	state: MarkerState;
}

const _SHOW_COMMENT = 128;
export const _FILTER_ACCEPT = 1;
export const _FILTER_SKIP = 2;

export function collectVskMarkers(container: HTMLElement): Comment[] {
	const markers: Comment[] = [];
	const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
		acceptNode: (node) => (node.textContent === 'vsk' ? _FILTER_ACCEPT : _FILTER_SKIP),
	});
	while (walker.nextNode()) markers.push(walker.currentNode as Comment);
	return markers;
}

function adoptElement(marker: Comment, tag?: string): Element | null {
	const el = marker.nextElementSibling;
	if (!el) {
		marker.remove();
		return null;
	}
	// Tag mismatch: leave the marker and the SSR element fully intact so the
	// element's real owner can claim it. Consuming it here would strip the SSR
	// text and stamp a claim on a node this claim does not own, drifting every
	// later claim into fresh-node fallback (the empty `/store/widget` h1
	// defect: the layout's missing conditional span claim stole the h1 marker).
	if (tag && el.tagName.toLowerCase() !== tag) return null;
	marker.remove();
	stripDirectTextNodes(el);
	stampClaimed(el);
	return el;
}

class WalkerEngine implements HydrateWalker {
	root: HTMLElement | null;
	private markers: TrackedMarker[];
	private idx = 0;

	constructor(root: HTMLElement | null, markers: Comment[]) {
		this.root = root;
		this.markers = markers.map((c) => ({ comment: c, state: 'unclaimed' as MarkerState }));
	}

	done(): boolean {
		return this.idx >= this.markers.length;
	}

	nextElement(tag?: string): Element {
		while (this.idx < this.markers.length) {
			const tm = this.markers[this.idx];
			if (tm.state === 'claimed') {
				this.idx++;
				continue;
			}
			const el = tm.comment.nextElementSibling as Element | null;
			if (tag && el && el.tagName.toLowerCase() !== tag) {
				// SSR rendered a different tag than this claim wants. Leave the
				// marker AND the element untouched and back off without moving
				// the cursor: the element's real owner may still claim it, and
				// consuming it here would strip its SSR text, stamp a claim on
				// a node this render does not own, and drift every later claim
				// into fresh-node fallback (the empty `/store/widget` h1).
				break;
			}
			this.idx++;
			const adopted = adoptElement(tm.comment, tag);
			if (adopted === null) {
				// SSR rendered no element after this marker. Fall out to a
				// fresh element instead of hunting through the remaining
				// markers: a hunt drains markers later claims still need, so
				// one divergence cascades every following claim into fresh-node
				// fallback and its elements drift into the walker's outer
				// fallback root.
				tm.state = 'claimed';
				break;
			}
			tm.state = 'claimed';
			return adopted;
		}
		// Every marker the walker knew about is consumed, yet the render asked
		// for more elements than SSR provided — or the SSR element tag did not
		// match. Best effort: build a fresh element and warn in dev. (Warn only
		// when SSR markers actually existed; SPA/client-only renders use empty
		// marker lists on temp roots and legitimately build everything fresh.)
		if (__hydrateDevMode && this.root && this.markers.length > 0) {
			devWarn(
				`hydration claim missed <${tag || 'element'}> (${
					this.markers.length
				} markers consumed); the client rendered more or different content than SSR.` +
					(this.root.outerHTML ? ` Fragment:\n${String(this.root.outerHTML).slice(0, 800)}` : '')
			);
		}
		return document.createElement(tag || 'div');
	}

	subWalker(rootEl: HTMLElement): HydrateWalker {
			const subMarkers = this.markers.slice(this.idx).filter((m) => {
				if (m.state === 'claimed') return false;
				if (rootEl === (m.comment as unknown as HTMLElement)) return true;
				if (!rootEl || !m.comment) return false;
				if (typeof rootEl.contains === 'function') return rootEl.contains(m.comment);
				return false;
			});
			this.idx += subMarkers.length;
		for (const m of subMarkers) m.state = 'claimed';
		return new WalkerEngine(rootEl, subMarkers.map((m) => m.comment));
	}

	claimByKey(key: string): HydrateClaim | null {
		const strKey = String(key);
		// Strict positional claim: the item claims the cursor's marker. Interior
		// markers of the previously-claimed item are consumed by that item's own
		// render, so by the time we get here the cursor points at this item's
		// SSR root. Only EXACT ordering SSR == client is claimed; divergence
		// renders the item fresh at the region tail (canary reports the ghost).
		for (let i = this.idx; i < this.markers.length; i++) {
			const tm = this.markers[i];
			if (tm.state === 'claimed') continue;
			const el = tm.comment.nextElementSibling;
			if (el && el.getAttribute('data-vsk-key') === strKey) {
				tm.state = 'claimed';
				tm.comment.remove();
				stripDirectTextNodes(el);
				stampClaimed(el);
				return { el };
			}
			// First unclaimed marker is not this item — don't scan past it.
			return null;
		}
		return null;
	}

	peekKey(key: string): Element | null {
		const strKey = String(key);
		// Non-consuming scan across EVERY remaining unclaimed marker: used to
		// discover the containing region's DOM bounds before anchoring, so it
		// must find items regardless of their position in the region.
		for (let i = this.idx; i < this.markers.length; i++) {
			const tm = this.markers[i];
			if (tm.state === 'claimed') continue;
			const el = tm.comment.nextElementSibling;
			if (el && el.getAttribute('data-vsk-key') === strKey) return el;
		}
		return null;
	}
}

export function createHydrateWalker(container: HTMLElement | null, markerList?: Comment[]): HydrateWalker {
	const markers = markerList || (container ? collectVskMarkers(container) : []);
	return new WalkerEngine(container, markers);
}

export function createHydrateChildWalker(parentEl: HTMLElement | null): HydrateWalker {
	let childIdx = 0;
	const children = parentEl ? parentEl.children : [];

	return {
		root: parentEl,
		done() {
			return childIdx >= children.length;
		},
		nextElement(tag?: string) {
			while (childIdx < children.length) {
				const child = children[childIdx++];
				if (!tag || child.tagName.toLowerCase() === tag) {
					stripDirectTextNodes(child);
					stampClaimed(child);
					return child;
				}
			}
			return document.createElement(tag || 'div');
		},
		subWalker(rootEl: HTMLElement) {
			return createHydrateChildWalker(rootEl);
		},
	};
}

export function hydrate(
	container: HTMLElement,
	componentFn: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown,
	props?: Record<string, unknown>,
): unknown {
	const walker = createHydrateWalker(container);
	const result = runInHydrateBlock(() => componentFn(props || {}, new Map(), walker));
	assertFullyHydrated(container);
	return result;
}

// ---------------------------------------------------------------------------
// Viewport viewport hydration: markers below the fold are held until the
// observer reports them intersecting. The hold is tracked explicitly (no
// `vsk-hold` text mutation, no `_observed` monkey-patch) so the marker state
// machine stays unambiguous and `assertFullyHydrated` can count held markers.
// ---------------------------------------------------------------------------

export function hydrateViewport(
	container: HTMLElement,
	componentFn: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown,
	props?: Record<string, unknown>,
	rootMargin = 500,
): Promise<void> {
	if (document.readyState !== 'complete') {
		return new Promise<void>((resolve) => {
			const onLoad = () => {
				window.removeEventListener('load', onLoad);
				resolve(hydrateViewport(container, componentFn, props, rootMargin));
			};
			window.addEventListener('load', onLoad);
		});
	}
	const allMarkers = collectVskMarkers(container);

	const viewportMarkers: Comment[] = [];
	const deferredMarkers: Comment[] = [];
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

	const held = new Set<Comment>(deferredMarkers);

	const viewportWalker = createHydrateWalker(container, viewportMarkers);
	runInHydrateBlock(() => componentFn(props || {}, new Map(), viewportWalker));

	if (deferredMarkers.length > 0) {
		return new Promise<void>((resolve) => {
			const observer = new IntersectionObserver((entries) => {
				const toHydrate: Comment[] = [];
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const el = entry.target;
						const siblings = el.parentNode ? Array.from(el.parentNode.childNodes) : [];
						const heldMarker = siblings.find(
							(n) => n.nodeType === 8 && held.has(n as Comment) && (n as Comment).nextElementSibling === el
						) as Comment | undefined;
						if (heldMarker) {
							held.delete(heldMarker);
							toHydrate.push(heldMarker);
						}
						observer.unobserve(el);
					}
				}
				if (toHydrate.length > 0) {
					const w = createHydrateWalker(container, toHydrate);
					runInHydrateBlock(() => componentFn(props || {}, new Map(), w));
				}
				if (held.size === 0) {
					observer.disconnect();
					assertFullyHydrated(container);
					resolve();
				}
			}, { rootMargin: `${rootMargin}px` });
			for (const marker of deferredMarkers) {
				const el = marker.nextElementSibling;
				if (el) observer.observe(el);
			}
		});
	}

	assertFullyHydrated(container);
	return Promise.resolve();
}

export function hydrateIdle(
	container: HTMLElement,
	componentFn: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown,
	props?: Record<string, unknown>,
	options: HydrateIdleOptions = {},
): HydrateCancelBase {
	const allMarkers = collectVskMarkers(container);
	const chunkSize = options.chunkSize || 10;
	const timeout = options.timeout || 3000;
	let idx = 0;

	const rIC = window.requestIdleCallback || ((cb: IdleRequestCallback) => setTimeout(cb, 50));
	const cIC = window.cancelIdleCallback || clearTimeout;

	let rafId: number | null = null;
	let cancelled = false;

	function processChunk(deadline?: IdleDeadline) {
		if (cancelled) return;
		const end = Math.min(idx + chunkSize, allMarkers.length);
		const chunk = allMarkers.slice(idx, end);
		idx = end;

		if (chunk.length > 0) {
			const walker = createHydrateWalker(container, chunk);
			runInHydrateBlock(() => componentFn(props || {}, new Map(), walker));
		}

		if (idx < allMarkers.length && (!deadline || deadline.timeRemaining() > 0 || deadline.didTimeout)) {
			rafId = rIC(processChunk as IdleRequestCallback, { timeout });
		} else if (idx >= allMarkers.length) {
			assertFullyHydrated(container);
		}
	}

	rafId = rIC(processChunk as IdleRequestCallback, { timeout });

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

export function needsHydration(container: HTMLElement): boolean {
	const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
		acceptNode: (node) => (node.textContent === 'vsk' ? _FILTER_ACCEPT : _FILTER_SKIP),
	});
	return walker.nextNode() !== null;
}

export function hydrateOnInteraction(
	container: HTMLElement,
	componentFn: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown,
	props?: Record<string, unknown>,
	options: HydrateInteractionOptions = {},
): HydrateCancel {
	const events = options.events || ['click', 'touchstart', 'focus', 'mouseenter'];
	let hydrated = false;

	function trigger(_eventType: string) {
		if (hydrated) return;
		hydrated = true;

		for (const ev of events) {
			container.removeEventListener(ev, handler);
		}

		const markers = collectVskMarkers(container);
		if (markers.length > 0) {
			const walker = createHydrateWalker(container, markers);
			runInHydrateBlock(() => componentFn(props || {}, new Map(), walker));
		}
		assertFullyHydrated(container);
	}

	const handler = (e: Event) => trigger(e.type);

	for (const ev of events) {
		container.addEventListener(ev, handler, { once: true });
	}

	return {
		cancel() { hydrated = true; for (const ev of events) container.removeEventListener(ev, handler); },
		hydrateNow() { trigger('manual'); },
	};
}

export function hydrationCount(container: HTMLElement): number {
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

export function hydrateInitial(
	container: HTMLElement,
	componentFn: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown,
	props?: Record<string, unknown>,
): void {
	const walker = createHydrateWalker(container);
	runInHydrateBlock(() => componentFn(props || {}, new Map(), walker));
	assertFullyHydrated(container);
}