import type { TrackedMap as TrackedMapShape, TrackedMapConstructor } from '@vesk/types';
import {
	get,
	increment,
	set,
	tracked,
	with_scope,
	type Block,
	type Tracked,
} from '@vesk/runtime/src/ripple-runtime';
import { collection_scope } from './tracked-proxy.js';

class TrackedMapImpl<K, V> extends Map<K, V> {
	#tracked_size: Tracked;
	#tracked_items = new Map<K, Tracked>();
	#block: Block | undefined;

	constructor(iterable?: Iterable<readonly [K, V]>) {
		super();

		const block = (this.#block = collection_scope());

		if (iterable) {
			for (const [key, value] of iterable) {
				super.set(key, value);
				this.#tracked_items.set(key, tracked(0, block));
			}
		}

		this.#tracked_size = tracked(super.size, block);
	}

	get(key: K): V | undefined {
		const t = this.#tracked_items.get(key);

		if (t === undefined) {
			void this.size;
		} else {
			get(t);
		}

		return super.get(key);
	}

	has(key: K): boolean {
		const has = super.has(key);
		const t = this.#tracked_items.get(key);

		if (t === undefined) {
			void this.size;
		} else {
			get(t);
		}

		return has;
	}

	set(key: K, value: V): this {
		const block = this.#block;
		const tracked_items = this.#tracked_items;
		const t = tracked_items.get(key);
		const prev_res = super.get(key);

		super.set(key, value);

		if (!t) {
			tracked_items.set(key, tracked(0, block));
			set(this.#tracked_size, super.size);
		} else if (prev_res !== value) {
			increment(t);
		}

		return this;
	}

	delete(key: K): boolean {
		const tracked_items = this.#tracked_items;
		const t = tracked_items.get(key);
		const result = super.delete(key);

		if (t) {
			increment(t);
			tracked_items.delete(key);
			set(this.#tracked_size, super.size);
		}

		return result;
	}

	clear(): void {
		if (super.size === 0) {
			return;
		}

		for (const [, t] of this.#tracked_items) {
			increment(t);
		}

		super.clear();
		this.#tracked_items.clear();
		set(this.#tracked_size, 0);
	}

	keys(): MapIterator<K> {
		void this.size;
		return super.keys();
	}

	values(): MapIterator<V> {
		void this.size;
		this.#read_all();
		return super.values();
	}

	entries(): MapIterator<[K, V]> {
		void this.size;
		this.#read_all();
		return super.entries();
	}

	forEach(
		callbackfn: (value: V, key: K, map: Map<K, V>) => void,
		thisArg?: unknown,
	): void {
		void this.size;
		this.#read_all();
		super.forEach(callbackfn, thisArg);
	}

	[Symbol.iterator](): MapIterator<[K, V]> {
		void this.size;
		this.#read_all();
		return super[Symbol.iterator]();
	}

	get size(): number {
		return get(this.#tracked_size) as number;
	}

	toJSON(): Array<[K, V]> {
		void this.size;
		this.#read_all();
		return [...this.entries()];
	}

	#read_all(): void {
		for (const [, t] of this.#tracked_items) {
			get(t);
		}
	}
}

export type TrackedMap<K, V> = TrackedMapShape<K, V>;
export const TrackedMap = TrackedMapImpl as unknown as TrackedMapConstructor;

export function tracked_map<K, V>(
	block: Block | undefined,
	iterable?: Iterable<readonly [K, V]>,
): TrackedMapShape<K, V> {
	const create = () => new TrackedMapImpl<K, V>(iterable);

	return (block ? with_scope(block, create) : create()) as unknown as TrackedMapShape<K, V>;
}
