/**
 * Ripple utility functions — exact copy from ripple@0.3.13
 * Checks if an object is a tracked/derived object (has a numeric 'f' property).
 * @param {any} v - The object to check.
 * @returns {boolean}
 */
export function is_ripple_object(v) {
	return typeof v === 'object' && v !== null && typeof (/** @type {any} */ (v).f) === 'number';
}

/**
 * Native JS helpers — replaces @tsrx/core/runtime/language-helpers
 */
export var define_property = Object.defineProperty;
export var get_descriptor = Object.getOwnPropertyDescriptor;
export var is_array = Array.isArray;
export var object_keys = Object.keys;
export function get_own_property_symbols(obj) {
	return Object.getOwnPropertySymbols(obj);
}
