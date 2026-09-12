import { destroy_block } from '@vesk/runtime/src/ripple-blocks';
import type { Block } from '@vesk/runtime/src/ripple-runtime';

interface MapEntry {
	marker: Comment;
	effs: Block[];
}

export type KeyedClaimFn = (key: string) => { el: Element } | null;
export type KeyedPeekFn = (key: string) => Element | null;

export interface KeyedHydrateWalker {
	peekKey?: KeyedPeekFn;
	claimByKey?: KeyedClaimFn;
}

export function reconcile<T>(
	anchor: Node,
	endAnchor: Node,
	items: T[],
	keyFn: (item: T) => string,
	createItem: (item: T, index: number, effs: Block[], root: Element | null) => void,
	claim?: KeyedClaimFn,
): (newItems: T[]) => void {
	const parent = anchor.parentNode as HTMLElement;
	const map = new Map<string, MapEntry>();

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const key = keyFn(item);
		const marker = document.createComment('k:' + key);
		const effs: Block[] = [];
		// When hydrated, the item's SSR root element (if any) is claimed here;
		// the marker is anchored to it so `removeRange`/`moveBefore` operate on
		// the claimed content instead of duplicating it.
		const c = claim ? claim(key) : null;
		parent.insertBefore(marker, c ? c.el : endAnchor);
		createItem(item, i, effs, c ? c.el : null);
		map.set(key, { marker, effs });
	}

	return (newItems: T[]) => {
		const newKeys = newItems.map(keyFn);
		const newSet = new Set(newKeys);

		for (const [key, { marker, effs }] of map) {
			if (!newSet.has(key)) {
				removeRange(marker, endAnchor);
				marker.remove();
				for (const e of effs) destroy_block(e);
				map.delete(key);
			}
		}

		let ref: Node = endAnchor;
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
				const effs: Block[] = [];
				parent.insertBefore(marker, ref);
				createItem(newItems[i], i, effs, null);
				map.set(key, { marker, effs });
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
 * render fresh. Ordering is exact when SSR data matches the client data;
 * divergence degrades to appending fresh items at the region tail instead of
 * duplicating already-claimed SSR content.
 */
export function reconcileHydrated<T>(
	anchor: Node,
	endAnchor: Node,
	items: T[],
	keyFn: (item: T) => string,
	createItem: (item: T, index: number, effs: Block[], root: Element | null) => void,
	walker: KeyedHydrateWalker,
	parent: Node,
): (newItems: T[]) => void {
	// Discover the region's SSR bounds without consuming any markers.
	const claimedEls: Element[] = [];
	for (let i = 0; i < items.length; i++) {
		const el = walker.peekKey ? walker.peekKey(keyFn(items[i])) : null;
		if (el) claimedEls.push(el);
	}

	if (claimedEls.length > 0) {
		const order = new Map<ChildNode, number>();
		const kids = parent.childNodes;
		for (let i = 0; i < kids.length; i++) order.set(kids[i], i);
		let first = claimedEls[0];
		let last = claimedEls[0];
		for (const el of claimedEls) {
			if ((order.get(el) ?? -1) < (order.get(first) ?? -1)) first = el;
			if ((order.get(el) ?? -1) > (order.get(last) ?? -1)) last = el;
		}
		parent.insertBefore(anchor, first);
		parent.insertBefore(endAnchor, last.nextSibling);
	} else {
		parent.appendChild(anchor);
		parent.appendChild(endAnchor);
	}

	return reconcile(anchor, endAnchor, items, keyFn, createItem, (key: string) => walker.claimByKey!(key));
}

function removeRange(start: Node, end: Node): void {
	let n = start.nextSibling;
	while (n && n !== end && !(n.nodeType === 8 && n.nodeValue && n.nodeValue.startsWith('k:'))) {
		const next = n.nextSibling;
		n.remove();
		n = next;
	}
}

function moveBefore(marker: Node, endAnchor: Node, ref: Node): void {
	const nodes: Node[] = [];
	let n = marker.nextSibling;
	while (n && n !== endAnchor && !(n.nodeType === 8 && n.nodeValue && n.nodeValue.startsWith('k:'))) {
		nodes.push(n);
		n = n.nextSibling;
	}
	const parent = marker.parentNode as HTMLElement;
	parent.insertBefore(marker, ref);
	for (const node of nodes) parent.insertBefore(node, ref);
}