/**
 * Vesk Bindings — Two-way data binding via {ref} attribute
 *
 * Every binding is a ref-compatible function: (node) => cleanup
 * Usage: <input ref={bindValue(c)} />  where c is a Cell from track()
 */

import { effect } from './track.js';

function isCell(v) {
	return v && typeof v === 'object' && typeof v.get === 'function' && typeof v.set === 'function';
}

export function bindValue(cell) {
	if (!isCell(cell)) throw new TypeError('bindValue requires a tracked cell');
	return (node) => {
		const onInput = () => cell.set(node.value);
		const onChange = () => cell.set(node.value);
		node.addEventListener('input', onInput);
		node.addEventListener('change', onChange);
		const eff = effect(() => { node.value = cell.get(); });
		return () => {
			node.removeEventListener('input', onInput);
			node.removeEventListener('change', onChange);
			eff.destroy();
		};
	};
}

export function bindChecked(cell) {
	if (!isCell(cell)) throw new TypeError('bindChecked requires a tracked cell');
	return (node) => {
		const onChange = () => cell.set(node.checked);
		node.addEventListener('change', onChange);
		const eff = effect(() => { node.checked = Boolean(cell.get()); });
		return () => {
			node.removeEventListener('change', onChange);
			eff.destroy();
		};
	};
}

export function bindGroup(cell, value) {
	if (!isCell(cell)) throw new TypeError('bindGroup requires a tracked cell');
	return (node) => {
		if (node.type === 'radio') {
			const onChange = () => { if (node.checked) cell.set(value); };
			node.addEventListener('change', onChange);
			const eff = effect(() => { node.checked = cell.get() === value; });
			return () => {
				node.removeEventListener('change', onChange);
				eff.destroy();
			};
		}
		const onChange = () => {
			const arr = cell.get();
			if (node.checked) {
				if (!arr.includes(value)) cell.set([...arr, value]);
			} else {
				cell.set(arr.filter((v) => v !== value));
			}
		};
		node.addEventListener('change', onChange);
		const eff = effect(() => { node.checked = cell.get().includes(value); });
		return () => {
			node.removeEventListener('change', onChange);
			eff.destroy();
		};
	};
}
