export function is_ripple_object(v: unknown): v is { f: number } {
	return typeof v === 'object' && v !== null && typeof (v as { f: unknown }).f === 'number';
}

export const define_property = Object.defineProperty;
export const get_descriptor = Object.getOwnPropertyDescriptor;
export const is_array = Array.isArray;
export const object_keys = Object.keys;
export function get_own_property_symbols(obj: Record<string | symbol, unknown>): symbol[] {
	return Object.getOwnPropertySymbols(obj);
}
