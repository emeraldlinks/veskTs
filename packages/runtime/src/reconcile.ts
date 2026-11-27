import { destroy_block } from '@vesk/runtime/src/ripple-blocks';
import type { Block } from '@vesk/runtime/src/ripple-runtime';
import type { ClaimByKeyOptions } from '@vesk/runtime/src/hydrate';

interface MapEntry<T> {
	marker: Comment;
	end: Comment;
	item: T;
	effs: Block[];
	update?: (item: T, index: number) => void;
}

function warnDuplicateKey(key: string): void {
	if ((globalThis as { __vsk_dev?: boolean }).__vsk_dev === false) return;
	console.warn(`[vesk] duplicate keyed item key: ${key}`);
}

export type KeyedClaimFn = (key: string, options?: ClaimByKeyOptions) => { el: Element } | null;
export type KeyedPeekFn = (key: string) => Element | null;

export interface KeyedHydrateWalker {
	peekKey?: KeyedPeekFn;
	claimByKey?: KeyedClaimFn;
}

export function reconcile<T>(
	anchor: Node,
	endAnchor: Node,
	items: T[],
	keyFn: (item: T, index: number) => string,
	createItem: (item: T, index: number, effs: Block[], root: Element | null) => void | ((item: T, index: number) => void),
	claim?: KeyedClaimFn,
): (newItems: T[]) => void {
	const parent = anchor.parentNode as HTMLElement;
	const map = new Map<string, MapEntry<T>>();
	const initialKeys = new Set<string>();

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const key = keyFn(item, i);
		if (initialKeys.has(key)) warnDuplicateKey(key);
		initialKeys.add(key);
		const marker = document.createComment('k:' + key);
		const end = document.createComment('k-end:' + key);
		const effs: Block[] = [];
		const c = claim ? claim(key) : null;
		parent.insertBefore(marker, c ? c.el : endAnchor);
		const update = createItem(item, i, effs, c ? c.el : null);
		parent.insertBefore(end, c ? c.el.nextSibling : endAnchor);
		map.set(key, { marker, end, item, effs, update: typeof update === 'function' ? update : undefined });
	}

	return (newItems: T[]) => {
		const newKeys = newItems.map(keyFn);
		const newSet = new Set<string>();
		for (let i = 0; i < newKeys.length; i++) {
			const key = newKeys[i];
			if (newSet.has(key)) warnDuplicateKey(key);
			newSet.add(key);
		}

		for (const [key, entry] of map) {
			if (!newSet.has(key)) {
				removeRange(entry.marker, entry.end);
				entry.marker.remove();
				entry.end.remove();
				for (const e of entry.effs) destroy_block(e);
				map.delete(key);
			}
		}

		let ref: Node = endAnchor;
		for (let i = newKeys.length - 1; i >= 0; i--) {
			const key = newKeys[i];
			const entry = map.get(key);
			if (entry) {
				if (entry.item !== newItems[i]) {
					entry.update?.(newItems[i], i);
					entry.item = newItems[i];
				}
				if (entry.end.nextSibling !== ref) {
					moveBefore(entry, ref);
				}
				ref = entry.marker;
			} else {
				const marker = document.createComment('k:' + key);
				const end = document.createComment('k-end:' + key);
				const effs: Block[] = [];
				parent.insertBefore(marker, ref);
				const tail = endAnchor.previousSibling;
				const update = createItem(newItems[i], i, effs, null);
				parent.insertBefore(end, endAnchor);
				let n = tail ? tail.nextSibling : parent.firstChild;
				const added: Node[] = [];
				while (n && n !== endAnchor) {
					added.push(n);
					n = n.nextSibling;
				}
				for (const node of added) parent.insertBefore(node, ref);
				map.set(key, { marker, end, item: newItems[i], effs, update: typeof update === 'function' ? update : undefined });
				ref = marker;
			}
		}
	};
}

/**
 * Keyed-list hydration (claim-by-key). Positions the map's `anchor`/`endAnchor`
 * around the SSR-claimed item elements so the map region stays inside the
 * containing element, then hands off to `reconcile` with the walker's
 * `claimByKey` as the claim function. Items that never had SSR markers (the
 * list was empty or the client data grew) anchor at the end of the region and
 * render fresh. SSR↔client reorder adopts each item by key and moves it into
 * client order (node identity preserved — no content swapping, no twins);
 * only genuinely missing keys render fresh. RULE: NO DUPLICATION.
 */
export function reconcileHydrated<T>(
	anchor: Node,
	endAnchor: Node,
	items: T[],
	keyFn: (item: T, index: number) => string,
	createItem: (item: T, index: number, effs: Block[], root: Element | null) => void,
	walker: KeyedHydrateWalker,
	parent: Node,
	skipK = 0,
): (newItems: T[]) => void {
	// Phase 1: adopt every item by key up front. Relocate moves out-of-order
	// nodes to the cursor, so afterwards adopted elements stand contiguous in
	// client order with node identity preserved. Anchors must be placed AFTER
	// this (phase 2): placing them first would strand moved nodes outside the
	// region and corrupt every later range operation.
	//
	// Markerless regions scope claim-by-key to their own container: the
	// structural walker's positional cursor sits on the top-level container, so
	// keyed items nested under a region element would otherwise steal that
	// element's siblings. `scopeToRegion` also shares the adoption ledger, so a
	// later sibling region (or a top-level claim) skips already-adopted nodes.
	// A CONTAINERLESS keyed region (items are direct children of the walker's
	// OWN root — e.g. a statement-mode keyed `for` beside static siblings in a
	// page) must NOT re-scope: a fresh walker over the root from index 0 would
	// positionally adopt the root's unrelated siblings (headings, nav) as the
	// region's items. It claims from the live walker's cursor instead, where
	// `skipK` (the compile-time static residue standing between the cursor and
	// the region's first SSR item) aligns the first claim to the right slot.
	let claimWalker = walker;
	const layout = walker as { scopeToRegion?: (root: HTMLElement) => KeyedHydrateWalker; root?: Node | null };
	const scope = layout.scopeToRegion;
	const parentIsElement = parent && parent.nodeType === 1;
	if (scope && parentIsElement && layout.root !== parent) {
		claimWalker = scope.call(walker, parent as HTMLElement);
	}
	if ((globalThis as { __vesk_hydrate_debug?: boolean }).__vesk_hydrate_debug) {
		// eslint-disable-next-line no-console
		console.error('[hyd-dbg] reconcileHydrated items=', items.length, 'scoped=', claimWalker !== walker, 'parent=<', parent && parent.nodeName, '>', 'hasClaim=', !!claimWalker.claimByKey, 'walkerType=', (walker as { constructor?: { name?: string } }).constructor && (walker as { constructor: { name?: string } }).constructor.name);
	}
	const claimed = new Map<string, Element>();
	for (let i = 0; i < items.length; i++) {
		const key = keyFn(items[i], i);
		if (claimed.has(key)) continue;
		const c = claimWalker.claimByKey ? claimWalker.claimByKey(key, { relocate: true, skipK: i === 0 ? skipK : 0 }) : null;
		if (c) claimed.set(key, c.el);
	}

	// Phase 2: anchors around the adopted span, in client order.
	const orderedEls: Element[] = [];
	for (let i = 0; i < items.length; i++) {
		const el = claimed.get(keyFn(items[i], i));
		if (el && !orderedEls.includes(el)) orderedEls.push(el);
	}

	if (orderedEls.length > 0) {
		parent.insertBefore(anchor, orderedEls[0]);
		const last = orderedEls[orderedEls.length - 1];
		parent.insertBefore(endAnchor, last.nextSibling);
	} else {
		parent.appendChild(anchor);
		parent.appendChild(endAnchor);
	}

	return reconcile(anchor, endAnchor, items, keyFn, createItem, (key: string) => {
		const el = claimed.get(key);
		return el ? { el } : null;
	});
}

function removeRange(start: Node, end: Node): void {
	let n = start.nextSibling;
	while (n && n !== end) {
		const next = n.nextSibling;
		n.remove();
		n = next;
	}
}

function moveBefore<T>(entry: MapEntry<T>, ref: Node): void {
	const parent = entry.marker.parentNode as HTMLElement;
	const nodes: Node[] = [entry.marker];
	let n = entry.marker.nextSibling;
	while (n && n !== entry.end) {
		nodes.push(n);
		n = n.nextSibling;
	}
	nodes.push(entry.end);
	for (const node of nodes) parent.insertBefore(node, ref);
}
