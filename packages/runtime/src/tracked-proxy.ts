import type { TrackedArray, TrackedObject } from '@vesk/types';
import {
	MAX_ARRAY_LENGTH,
	TRACKED_ARRAY,
	TRACKED_OBJECT,
	UNINITIALIZED,
} from '@vesk/runtime/src/ripple-constants';
import {
	get,
	set,
	scope,
	tracked,
	untrack,
	type Block,
	type Tracked,
} from '@vesk/runtime/src/ripple-runtime';

const array_prototype = Array.prototype;
const object_prototype = Object.prototype;

export interface ArrayProxyParams<T> {
	elements: Iterable<T>;
	block?: Block;
	from_static?: boolean;
	use_array?: boolean;
}

const methods_returning_arrays = new Set<PropertyKey>([
	'concat',
	'filter',
	'flat',
	'flatMap',
	'map',
	'slice',
	'splice',
	'toReversed',
	'toSorted',
	'toSpliced',
	'with',
]);

export function collection_scope(): Block | undefined {
	return scope() || undefined;
}

export function snapshot<T>(value: T): T {
	if (typeof value !== 'object' || value === null) {
		return value;
	}

	return untrack(() => (Array.isArray(value) ? [...value] : { ...(value as object) })) as T;
}

export function proxy<T extends object>(value: T, block?: Block): T {
	if (
		typeof value !== 'object' ||
		value === null ||
		TRACKED_ARRAY in value ||
		TRACKED_OBJECT in value
	) {
		return value;
	}

	const prototype = Object.getPrototypeOf(value);

	if (prototype !== object_prototype && prototype !== array_prototype) {
		return value;
	}

	const tracked_elements = new Map<string | symbol, Tracked>();
	const is_proxied_array = Array.isArray(value);
	const raw = value as Record<PropertyKey, unknown>;
	let tracked_len: Tracked | undefined;

	if (is_proxied_array) {
		tracked_len = tracked(raw.length, block);
		tracked_elements.set('length', tracked_len);
	}

	return new Proxy(value, {
		get(target, prop, receiver) {
			const target_raw = target as unknown as Record<PropertyKey, unknown>;
			let t = tracked_elements.get(prop);
			const exists = prop in target;

			if (t === undefined && (!exists || Object.getOwnPropertyDescriptor(target, prop)?.writable)) {
				t = tracked(exists ? target_raw[prop] : UNINITIALIZED, block);
				tracked_elements.set(prop, t);
			}

			if (t !== undefined) {
				const v = get(t);
				return v === UNINITIALIZED ? undefined : v;
			}

			const result = Reflect.get(target, prop, receiver);

			if (typeof result === 'function') {
				if (methods_returning_arrays.has(prop)) {
					return function (this: unknown, ...args: unknown[]) {
						const output = Reflect.apply(result, receiver, args);

						if (Array.isArray(output) && output !== target) {
							return array_proxy({ elements: output, block, use_array: true });
						}

						return output;
					};
				}

				if (is_proxied_array && (prop === 'entries' || prop === 'values' || prop === 'keys')) {
					void (receiver as { length: number }).length;
				}
			}

			return result;
		},

		set(target, prop, value, receiver) {
			let t = tracked_elements.get(prop);
			let exists = prop in target;

			if (is_proxied_array && prop === 'length' && t !== undefined) {
				const next_length = value as number;
				const prev_length = t.__v as number;

				for (let i = next_length; i < prev_length; i += 1) {
					let other_t = tracked_elements.get(i + '');

					if (other_t !== undefined) {
						set(other_t, UNINITIALIZED);
					} else if (i in target) {
						other_t = tracked(UNINITIALIZED, block);
						tracked_elements.set(i + '', other_t);
					}
				}
			}

			if (t === undefined) {
				if (!exists || Object.getOwnPropertyDescriptor(target, prop)?.writable) {
					t = tracked(undefined, block);
					set(t, value);
					tracked_elements.set(prop, t);
				}
			} else {
				exists = t.__v !== UNINITIALIZED;
				set(t, value);
			}

			const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);

			if (descriptor?.set) {
				descriptor.set.call(receiver, value);
			}

			if (!exists && is_proxied_array && typeof prop === 'string' && tracked_len !== undefined) {
				const n = Number(prop);

				if (Number.isInteger(n) && n >= (tracked_len.__v as number)) {
					set(tracked_len, n + 1);
				}
			}

			return true;
		},

		setPrototypeOf() {
			throw new Error(
				`Cannot set prototype of ${is_proxied_array ? '`TrackedArray`' : '`TrackedObject`'}`,
			);
		},

		deleteProperty(target, prop) {
			const t = tracked_elements.get(prop);

			if (t === undefined) {
				if (prop in target) {
					tracked_elements.set(prop, tracked(UNINITIALIZED, block));
				}
			} else {
				set(t, UNINITIALIZED);
			}

			return Reflect.deleteProperty(target, prop);
		},

		has(target, prop) {
			if (is_proxied_array && prop === TRACKED_ARRAY) {
				return true;
			}

			if (prop === TRACKED_OBJECT) {
				return true;
			}

			const target_raw = target as unknown as Record<PropertyKey, unknown>;
			let t = tracked_elements.get(prop);
			const exists = (t !== undefined && t.__v !== UNINITIALIZED) || Reflect.has(target, prop);

			if (t !== undefined || !exists || Object.getOwnPropertyDescriptor(target, prop)?.writable) {
				if (t === undefined) {
					t = tracked(exists ? target_raw[prop] : UNINITIALIZED, block);
					tracked_elements.set(prop, t);
				}

				const value = get(t);

				if (value === UNINITIALIZED) {
					return false;
				}
			}

			return exists;
		},

		defineProperty(_target, prop, descriptor) {
			if (
				!('value' in descriptor) ||
				descriptor.configurable === false ||
				descriptor.enumerable === false ||
				descriptor.writable === false
			) {
				throw new Error(
					'Only basic property descriptors are supported with value and configurable, enumerable, and writable set to true',
				);
			}

			let t = tracked_elements.get(prop);

			if (t === undefined) {
				t = tracked(descriptor.value, block);
				tracked_elements.set(prop, t);
			} else {
				set(t, descriptor.value);
			}

			return true;
		},

		ownKeys(target) {
			const own_keys = Reflect.ownKeys(target).filter((key) => {
				const t = tracked_elements.get(key);
				return t === undefined || t.__v !== UNINITIALIZED;
			});

			for (const [key, t] of tracked_elements) {
				if (t.__v !== UNINITIALIZED && !(key in target)) {
					own_keys.push(key);
				}
			}

			return own_keys;
		},

		getOwnPropertyDescriptor(target, prop) {
			const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);

			if (descriptor && 'value' in descriptor) {
				const t = tracked_elements.get(prop);

				if (t) {
					(descriptor as PropertyDescriptor).value = get(t);
				}
			} else if (descriptor === undefined) {
				const t = tracked_elements.get(prop);
				const value = t?.__v;

				if (t !== undefined && value !== UNINITIALIZED) {
					return {
						enumerable: true,
						configurable: true,
						value,
						writable: true,
					};
				}
			}

			return descriptor;
		},
	});
}

export function array_proxy<T>({
	elements,
	block,
	from_static = false,
	use_array = false,
}: ArrayProxyParams<T>): TrackedArray<T> {
	let arr: T[];
	let first: number | undefined;

	if (from_static && (first = get_first_if_length(elements as T[])) !== undefined) {
		arr = new Array<T>();
		arr[0] = first as unknown as T;
	} else if (use_array) {
		arr = elements as T[];
	} else {
		arr = new Array(...elements);
	}

	return proxy(arr, block) as unknown as TrackedArray<T>;
}

export function object_proxy<T extends object>(obj: T, block?: Block): TrackedObject<T> {
	return proxy(obj, block) as TrackedObject<T>;
}

function get_first_if_length<T>(array: T[]): number | undefined {
	const first = array[0];

	if (
		array.length === 1 &&
		0 in array &&
		Number.isInteger(first) &&
		(first as number) >= 0 &&
		(first as number) <= MAX_ARRAY_LENGTH
	) {
		return first as number;
	}
}
