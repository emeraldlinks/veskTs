import type { TrackedObject as TrackedObjectShape, TrackedObjectConstructor } from '@vesk/types';
import type { Block } from '@vesk/runtime/src/ripple-runtime';
import { collection_scope, object_proxy } from './tracked-proxy.js';

export function tracked_object<T extends object>(
	block: Block | undefined,
	obj: T,
): TrackedObjectShape<T> {
	return object_proxy(obj, block) as TrackedObjectShape<T>;
}

class TrackedObjectImpl<T extends object> {
	constructor(obj: T) {
		return tracked_object(collection_scope(), obj) as unknown as TrackedObjectImpl<T>;
	}
}

export type TrackedObject<T extends object = Record<PropertyKey, unknown>> = TrackedObjectShape<T>;
export const TrackedObject = TrackedObjectImpl as unknown as TrackedObjectConstructor;
