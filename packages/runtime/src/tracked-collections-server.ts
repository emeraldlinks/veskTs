import type {
	TrackedArray as TrackedArrayShape,
	TrackedArrayConstructor,
	TrackedObject as TrackedObjectShape,
	TrackedObjectConstructor,
	TrackedMap as TrackedMapShape,
	TrackedMapConstructor,
	TrackedSet as TrackedSetShape,
	TrackedSetConstructor,
} from '@vesk/types';

export type TrackedArray<T = unknown> = TrackedArrayShape<T>;
export type TrackedObject<T extends object = Record<PropertyKey, unknown>> = TrackedObjectShape<T>;
export type TrackedMap<K, V> = TrackedMapShape<K, V>;
export type TrackedSet<T> = TrackedSetShape<T>;

export const TrackedArray = Array as unknown as TrackedArrayConstructor;
export const TrackedObject = Object as unknown as TrackedObjectConstructor;
export const TrackedMap = Map as unknown as TrackedMapConstructor;
export const TrackedSet = Set as unknown as TrackedSetConstructor;

export function snapshot<T>(value: T): T {
	if (typeof value !== 'object' || value === null) {
		return value;
	}

	return (Array.isArray(value) ? [...value] : { ...(value as object) }) as T;
}
