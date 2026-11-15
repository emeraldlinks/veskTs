import type { TrackedSet as TrackedSetShape, TrackedSetConstructor } from '@vesk/types';
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

class TrackedSetImpl<T> extends Set<T> {
	#tracked_size: Tracked;
	#tracked_items = new Map<T, Tracked>();
	#block: Block | undefined;

	constructor(iterable?: Iterable<T>) {
		super();

		const block = (this.#block = collection_scope());

		if (iterable) {
			for (const item of iterable) {
				super.add(item);
				this.#tracked_items.set(item, tracked(0, block));
			}
		}

		this.#tracked_size = tracked(super.size, block);
	}

	add(value: T): this {
		const block = this.#block;

		if (!super.has(value)) {
			super.add(value);
			this.#tracked_items.set(value, tracked(0, block));
			set(this.#tracked_size, super.size);
		}

		return this;
	}

	delete(value: T): boolean {
		if (!super.delete(value)) {
			return false;
		}

		const t = this.#tracked_items.get(value);

		if (t) {
			increment(t);
		}

		this.#tracked_items.delete(value);
		set(this.#tracked_size, super.size);

		return true;
	}

	has(value: T): boolean {
		const has = super.has(value);
		const t = this.#tracked_items.get(value);

		if (t === undefined) {
			void this.size;
		} else {
			get(t);
		}

		return has;
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

	keys(): SetIterator<T> {
		void this.size;
		return super.keys();
	}

	values(): SetIterator<T> {
		void this.size;
		return super.values();
	}

	entries(): SetIterator<[T, T]> {
		void this.size;
		return super.entries();
	}

	forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: unknown): void {
		void this.size;
		super.forEach(callbackfn, thisArg);
	}

	[Symbol.iterator](): SetIterator<T> {
		void this.size;
		return super[Symbol.iterator]();
	}

	get size(): number {
		return get(this.#tracked_size) as number;
	}

	union<U>(other: ReadonlySet<U>): TrackedSetShape<T | U> {
		void this.size;
		this.#read_other(other);

		const out = new TrackedSetImpl<T | U>();

		for (const value of this) {
			out.add(value);
		}

		for (const value of other) {
			out.add(value);
		}

		return out as unknown as TrackedSetShape<T | U>;
	}

	intersection<U>(other: ReadonlySet<U>): TrackedSetShape<T & U> {
		void this.size;
		this.#read_other(other);

		const out = new TrackedSetImpl<T & U>();

		for (const value of this) {
			if (other.has(value as unknown as U)) {
				out.add(value as unknown as T & U);
			}
		}

		return out as unknown as TrackedSetShape<T & U>;
	}

	difference<U>(other: ReadonlySet<U>): TrackedSetShape<T> {
		void this.size;
		this.#read_other(other);

		const out = new TrackedSetImpl<T>();

		for (const value of this) {
			if (!other.has(value as unknown as U)) {
				out.add(value);
			}
		}

		return out as unknown as TrackedSetShape<T>;
	}

	symmetricDifference<U>(other: ReadonlySet<U>): TrackedSetShape<T | U> {
		void this.size;
		this.#read_other(other);

		const out = new TrackedSetImpl<T | U>();

		for (const value of this) {
			if (!other.has(value as unknown as U)) {
				out.add(value);
			}
		}

		for (const value of other) {
			if (!this.has(value as unknown as T)) {
				out.add(value);
			}
		}

		return out as unknown as TrackedSetShape<T | U>;
	}

	isSubsetOf(other: ReadonlySet<unknown>): boolean {
		void this.size;
		this.#read_other(other);

		for (const value of this) {
			if (!other.has(value)) {
				return false;
			}
		}

		return true;
	}

	isSupersetOf(other: ReadonlySet<unknown>): boolean {
		void this.size;
		this.#read_other(other);

		for (const value of other) {
			if (!this.has(value as T)) {
				return false;
			}
		}

		return true;
	}

	isDisjointFrom(other: ReadonlySet<unknown>): boolean {
		void this.size;
		this.#read_other(other);

		for (const value of other) {
			if (this.has(value as T)) {
				return false;
			}
		}

		return true;
	}

	toJSON(): T[] {
		void this.size;
		return [...this];
	}

	#read_other(other: ReadonlySet<unknown>): void {
		if (other instanceof TrackedSetImpl) {
			void other.size;
		}
	}
}

export type TrackedSet<T> = TrackedSetShape<T>;
export const TrackedSet = TrackedSetImpl as unknown as TrackedSetConstructor;

export function tracked_set<T>(
	block: Block | undefined,
	iterable?: Iterable<T>,
): TrackedSetShape<T> {
	const create = () => new TrackedSetImpl<T>(iterable);

	return (block ? with_scope(block, create) : create()) as unknown as TrackedSetShape<T>;
}
