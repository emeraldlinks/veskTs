/**
 * Vesk Bindings — Two-way data binding via {ref} attribute
 * Updated to use Ripple's get()/set() API
 */

import { effect, render } from './ripple-blocks.js';
import { get, set } from './ripple-runtime.js';
import { is_ripple_object } from './ripple-utils.js';

/**
 * @param {string} name
 * @returns {TypeError}
 */
function not_tracked_type_error(name) {
	return new TypeError(`${name} argument is not a tracked object`);
}

/**
 * @param {string} name
 * @returns {TypeError}
 */
function not_set_function_type_error(name) {
	return new TypeError(
		`${name} second argument must be a set function when first argument is a get function`,
	);
}

/**
 * @param {string} name
 * @param {unknown} maybe_tracked
 * @param {Function | undefined} set_func
 * @returns {{getter: Function, setter: Function}}
 */
function get_bind_get_set(name, maybe_tracked, set_func) {
	if (typeof maybe_tracked === 'function') {
		if (typeof set_func !== 'function') {
			throw not_set_function_type_error(name);
		}

		return {
			getter: maybe_tracked,
			setter: set_func,
		};
	} else {
		if (!is_ripple_object(maybe_tracked)) {
			throw not_tracked_type_error(name);
		}

		return {
			getter: () => get(maybe_tracked),
			setter: (value) => set(maybe_tracked, value),
		};
	}
}

function is_numberlike_input(input) {
	var type = input.type;
	return type === 'number' || type === 'range';
}

function to_number(value) {
	return value === '' ? null : +value;
}

/**
 * @param {unknown} maybe_tracked
 * @param {Function | undefined} set_func
 * @returns {(node: HTMLElement) => void}
 */
export function bindValue(maybe_tracked, set_func = undefined) {
	var { getter, setter } = get_bind_get_set('bindValue()', maybe_tracked, set_func);

	return (node) => {
		var clear_event;

		if (node.tagName === 'SELECT') {
			var select = /** @type {HTMLSelectElement} */ (node);

			clear_event = select.addEventListener('change', () => {
				var value = select.multiple
					? [].map.call(select.querySelectorAll(':checked'), (o) => o.value)
					: select.value;
				setter(value);
			});

			effect(() => {
				var value = getter();
				if (select.multiple) {
					for (var option of select.options) {
						option.selected = (value || []).includes(option.value);
					}
				} else {
					select.value = value ?? '';
				}
			});

			return () => select.removeEventListener('change', clear_event);
		} else {
			var input = /** @type {HTMLInputElement} */ (node);

			var onInput = () => {
				var value = input.value;
				value = is_numberlike_input(input) ? to_number(value) : value;
				setter(value);
			};

			input.addEventListener('input', onInput);

			render(() => {
				var value = getter();
				if (is_numberlike_input(input) && value === to_number(input.value)) {
					return;
				}
				if (value !== input.value) {
					input.value = value ?? '';
				}
			});

			return () => input.removeEventListener('input', onInput);
		}
	};
}

/**
 * @param {unknown} maybe_tracked
 * @param {Function | undefined} set_func
 * @returns {(node: HTMLInputElement) => void}
 */
export function bindChecked(maybe_tracked, set_func = undefined) {
	var { getter, setter } = get_bind_get_set('bindChecked()', maybe_tracked, set_func);

	return (input) => {
		var onChange = () => {
			setter(input.checked);
		};

		input.addEventListener('change', onChange);

		effect(() => {
			var value = getter();
			input.checked = Boolean(value);
		});

		return () => input.removeEventListener('change', onChange);
	};
}

/**
 * @param {unknown} maybe_tracked
 * @param {Function | undefined} set_func
 * @returns {(node: HTMLInputElement) => void}
 */
export function bindGroup(maybe_tracked, set_func = undefined) {
	var { getter, setter } = get_bind_get_set('bindGroup()', maybe_tracked, set_func);

	return (input) => {
		var is_checkbox = input.getAttribute('type') === 'checkbox';

		var onChange = () => {
			var value = input.value;
			var result;

			if (is_checkbox) {
				/** @type {Array<any>} */
				var list = getter() || [];

				if (input.checked) {
					if (!list.includes(value)) {
						result = [...list, value];
					} else {
						result = list;
					}
				} else {
					result = list.filter((v) => v !== value);
				}
			} else {
				result = input.value;
			}

			setter(result);
		};

		input.addEventListener('change', onChange);

		effect(() => {
			var value = getter();
			if (is_checkbox) {
				value = value || [];
				input.checked = value.includes(input.value);
			} else {
				input.checked = value === input.value;
			}
		});

		return () => input.removeEventListener('change', onChange);
	};
}
