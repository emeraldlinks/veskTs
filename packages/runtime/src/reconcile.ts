import { destroy_block } from './ripple-blocks';
import type { Block } from './ripple-runtime';

interface MapEntry {
	marker: Comment;
	effs: Block[];
}

export function reconcile<T>(
	anchor: Node,
	endAnchor: Node,
	items: T[],
	keyFn: (item: T) => string,
	createItem: (item: T, effs: Block[]) => void,
): (newItems: T[]) => void {
	const parent = anchor.parentNode as HTMLElement;
	const map = new Map<string, MapEntry>();

	for (const item of items) {
		const key = keyFn(item);
		const marker = document.createComment('k:' + key);
		const effs: Block[] = [];
		parent.insertBefore(marker, endAnchor);
		createItem(item, effs);
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
				createItem(newItems[i], effs);
				map.set(key, { marker, effs });
				ref = marker;
			}
		}
	};
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
