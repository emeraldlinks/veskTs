import type { TrackedArray as TrackedArrayShape, TrackedArrayConstructor } from '@vesk/types';
import type { Block } from '@vesk/runtime/src/ripple-runtime';
import { array_proxy, collection_scope } from './tracked-proxy';

export function tracked_array<T>(block: Block | undefined, ...elements: T[]): TrackedArrayShape<T> {
	return array_proxy({ elements, block });
}

export function tracked_array_from<T>(
	block: Block | undefined,
	arrayLike: ArrayLike<T> | Iterable<T>,
	mapFn?: (v: T, k: number) => unknown,
	thisArg?: unknown,
): TrackedArrayShape<T> {
	const elements = mapFn
		? Array.from(arrayLike, (v, k) => mapFn(v, k) as T, thisArg)
		: Array.from(arrayLike);

	return array_proxy({ elements, block, from_static: true });
}

export function tracked_array_of<T>(block: Block | undefined, ...items: T[]): TrackedArrayShape<T> {
	return array_proxy({ elements: Array.of(...items), block, from_static: true });
}

export async function tracked_array_from_async<T>(
	block: Block | undefined,
	arrayLike: ArrayLike<T> | Iterable<T> | AsyncIterable<T>,
	mapFn?: (v: T, k: number) => unknown,
	thisArg?: unknown,
): Promise<TrackedArrayShape<T>> {
	const elements = await array_from_async(arrayLike, mapFn, thisArg);
	return array_proxy({ elements, block, from_static: true });
}

class TrackedArrayImpl<T = unknown> {
	constructor(...elements: T[]) {
		return tracked_array(collection_scope(), ...elements) as unknown as TrackedArrayImpl<T>;
	}

	static from<U>(
		arrayLike: ArrayLike<U> | Iterable<U>,
		mapFn?: (v: U, k: number) => unknown,
		thisArg?: unknown,
	): TrackedArrayShape<U> {
		return tracked_array_from(collection_scope(), arrayLike, mapFn, thisArg);
	}

	static of<U>(...items: U[]): TrackedArrayShape<U> {
		return tracked_array_of(collection_scope(), ...items);
	}

	static fromAsync<U>(
		arrayLike: ArrayLike<U> | Iterable<U> | AsyncIterable<U>,
		mapFn?: (v: U, k: number) => unknown,
		thisArg?: unknown,
	): Promise<TrackedArrayShape<U>> {
		return tracked_array_from_async(collection_scope(), arrayLike, mapFn, thisArg);
	}
}

export type TrackedArray<T = unknown> = TrackedArrayShape<T>;
export const TrackedArray = TrackedArrayImpl as unknown as TrackedArrayConstructor;

async function array_from_async<T>(
	arrayLike: ArrayLike<T> | Iterable<T> | AsyncIterable<T>,
	mapFn?: (v: T, k: number) => unknown,
	thisArg?: unknown,
): Promise<T[]> {
	const native = (Array as unknown as {
		fromAsync?: (a: unknown, f?: unknown, t?: unknown) => Promise<T[]>;
	}).fromAsync;

	if (typeof native === 'function') {
		return native.call(Array, arrayLike, mapFn, thisArg);
	}

	const out: T[] = [];
	let i = 0;

	const push = async (value: T): Promise<void> => {
		out.push(mapFn ? ((await mapFn.call(thisArg, value, i)) as T) : value);
		i += 1;
	};

	if ((arrayLike as AsyncIterable<T>)[Symbol.asyncIterator]) {
		for await (const value of arrayLike as AsyncIterable<T>) {
			await push(value);
		}
	} else if ((arrayLike as Iterable<T>)[Symbol.iterator]) {
		for (const value of arrayLike as Iterable<T>) {
			await push(value);
		}
	} else {
		const list = arrayLike as ArrayLike<T>;

		for (let k = 0; k < list.length; k += 1) {
			await push(list[k] as T);
		}
	}

	return out;
}
