import { get } from './ripple-runtime';

export interface HydrateWalker {
	root: HTMLElement | null;
	done(): boolean;
	nextElement(tag?: string): Element;
	subWalker(rootEl: HTMLElement): HydrateWalker;
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

export function reactiveProps<T extends Record<string, unknown>>(props: T): T {
	return new Proxy(props, {
		get(target, key) {
			const val = Reflect.get(target, key);
			if (typeof val === 'object' && val !== null && typeof (val as unknown as { f: unknown }).f === 'number') {
				return get(val);
			}
			return val;
		}
	});
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

export function createHydrateWalker(container: HTMLElement | null, markerList?: Comment[]): HydrateWalker {
	const markers = markerList || (container ? collectVskMarkers(container) : []);
	let markerIdx = 0;

	return {
		root: container,
		done() {
			return markerIdx >= markers.length;
		},
		nextElement(tag?: string) {
			while (markerIdx < markers.length) {
				const marker = markers[markerIdx++];
				const el = marker.nextElementSibling;
				marker.remove();
				if (tag && (!el || el.tagName.toLowerCase() !== tag)) continue;
				if (el) {
					for (let i = el.childNodes.length - 1; i >= 0; i--) {
						if (el.childNodes[i].nodeType === 3) {
							el.childNodes[i].remove();
						}
					}
				}
				return el || document.createElement(tag || 'div');
			}
			return document.createElement(tag || 'div');
		},
		subWalker(rootEl: HTMLElement) {
			const subMarkers = markers.slice(markerIdx).filter((m: Comment) => {
				if (rootEl === (m as unknown as HTMLElement)) return true;
				if (!rootEl || !m) return false;
				if (typeof rootEl.contains === 'function') return rootEl.contains(m);
				return false;
			});
			markerIdx += subMarkers.length;
			return createHydrateWalker(rootEl, subMarkers);
		},
	};
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
	return componentFn(props || {}, new Map(), walker);
}

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

	for (const marker of deferredMarkers) {
		marker.textContent = 'vsk-hold';
	}

	const viewportWalker = createHydrateWalker(container, viewportMarkers);
	componentFn(props || {}, new Map(), viewportWalker);

	if (deferredMarkers.length > 0) {
		return new Promise<void>((resolve) => {
			const observer = new IntersectionObserver((entries) => {
				const toHydrate: Comment[] = [];
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const el = entry.target;
						const siblings = el.parentNode ? Array.from(el.parentNode.childNodes) : [];
						const heldMarker = siblings.find(
							(n) => n.nodeType === 8 && n.textContent === 'vsk-hold' && (n as Comment).nextElementSibling === el
						) as Comment | undefined;
						if (heldMarker) {
							heldMarker.textContent = 'vsk';
							toHydrate.push(heldMarker);
						}
						observer.unobserve(el);
					}
				}
				if (toHydrate.length > 0) {
					const w = createHydrateWalker(container, toHydrate);
					componentFn(props || {}, new Map(), w);
				}
				if ((observer as unknown as { _observed: number })._observed === 0) {
					observer.disconnect();
					resolve();
				}
			}, { rootMargin: `${rootMargin}px` });

			(observer as unknown as { _observed: number })._observed = deferredMarkers.length;
			for (const marker of deferredMarkers) {
				const el = marker.nextElementSibling;
				if (el) observer.observe(el);
			}
		});
	}

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
			componentFn(props || {}, new Map(), walker);
		}

		if (idx < allMarkers.length && (!deadline || deadline.timeRemaining() > 0 || deadline.didTimeout)) {
			rafId = rIC(processChunk as IdleRequestCallback, { timeout });
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
			componentFn(props || {}, new Map(), walker);
		}
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
