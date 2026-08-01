import { effect, render } from '@vesk/runtime/src/ripple-blocks';
import { get, set } from '@vesk/runtime/src/ripple-runtime';
import type { Tracked, Derived } from '@vesk/runtime/src/ripple-runtime';
import { is_ripple_object } from '@vesk/runtime/src/ripple-utils';

interface GetSetPair {
	getter: () => unknown;
	setter: (value: unknown) => void;
}

function not_tracked_type_error(name: string): TypeError {
	return new TypeError(`${name} argument is not a tracked object`);
}

function not_set_function_type_error(name: string): TypeError {
	return new TypeError(
		`${name} second argument must be a set function when first argument is a get function`,
	);
}

function get_bind_get_set(
	name: string,
	maybe_tracked: unknown,
	set_func: ((value: unknown) => void) | undefined,
): GetSetPair {
	if (typeof maybe_tracked === 'function') {
		if (typeof set_func !== 'function') {
			throw not_set_function_type_error(name);
		}
		return {
			getter: maybe_tracked as () => unknown,
			setter: set_func,
		};
	} else {
		if (!is_ripple_object(maybe_tracked)) {
			throw not_tracked_type_error(name);
		}
		const obj = maybe_tracked as Tracked | Derived;
		return {
			getter: () => get(obj),
			setter: (value) => set(obj, value),
		};
	}
}

function is_numberlike_input(input: HTMLInputElement): boolean {
	const type = input.type;
	return type === 'number' || type === 'range';
}

function to_number(value: string): number | null {
	return value === '' ? null : +value;
}

export function bindValue(
	maybe_tracked: unknown,
	set_func?: (value: unknown) => void,
): (node: HTMLElement) => () => void {
	const { getter, setter } = get_bind_get_set('bindValue()', maybe_tracked, set_func);

	return (node: HTMLElement) => {
		if (node.tagName === 'SELECT') {
			const select = node as HTMLSelectElement;

			const onChange = () => {
				const value = select.multiple
					? [].map.call(select.querySelectorAll(':checked'), (o: HTMLOptionElement) => o.value)
					: select.value;
				setter(value);
			};

			select.addEventListener('change', onChange);

			effect(() => {
				const value = getter() as string | string[];
				if (select.multiple) {
					for (const option of select.options) {
						option.selected = ((value as string[]) || []).includes(option.value);
					}
				} else {
					select.value = (value as string) ?? '';
				}
			});

			return () => select.removeEventListener('change', onChange);
		} else {
			const input = node as HTMLInputElement;

			const onInput = () => {
				let value: string | number | null = input.value;
				value = is_numberlike_input(input) ? to_number(value) : value;
				setter(value);
			};

			input.addEventListener('input', onInput);

			render(() => {
				const value = getter();
				if (is_numberlike_input(input) && value === to_number(input.value)) {
					return;
				}
				if (value !== input.value) {
					input.value = (value as string) ?? '';
				}
			});

			return () => input.removeEventListener('input', onInput);
		}
	};
}

export function bindChecked(
	maybe_tracked: unknown,
	set_func?: (value: unknown) => void,
): (input: HTMLInputElement) => () => void {
	const { getter, setter } = get_bind_get_set('bindChecked()', maybe_tracked, set_func);

	return (input: HTMLInputElement) => {
		const onChange = () => {
			setter(input.checked);
		};

		input.addEventListener('change', onChange);

		effect(() => {
			const value = getter();
			input.checked = Boolean(value);
		});

		return () => input.removeEventListener('change', onChange);
	};
}

export function bindGroup(
	maybe_tracked: unknown,
	set_func?: (value: unknown) => void,
): (input: HTMLInputElement) => () => void {
	const { getter, setter } = get_bind_get_set('bindGroup()', maybe_tracked, set_func);

	return (input: HTMLInputElement) => {
		const is_checkbox = input.getAttribute('type') === 'checkbox';

		const onChange = () => {
			const value = input.value;
			let result: unknown;

			if (is_checkbox) {
				const list = (getter() as unknown[]) || [];

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
			let value = getter();
			if (is_checkbox) {
				value = value || [];
				input.checked = (value as unknown[]).includes(input.value);
			} else {
				input.checked = value === input.value;
			}
		});

		return () => input.removeEventListener('change', onChange);
	};
}
