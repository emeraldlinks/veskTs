import {
	BLOCK_HAS_RUN,
	BRANCH_BLOCK,
	DERIVED,
	CONTAINS_TEARDOWN,
	DESTROYED,
	EFFECT_BLOCK,
	PAUSED,
	PRE_EFFECT_BLOCK,
	RENDER_BLOCK,
	ROOT_BLOCK,
	TRY_BLOCK,
	HEAD_BLOCK,
	DIRECT_CHILD_BLOCK,
	UNINITIALIZED,
} from './ripple-constants.js';
import {
	active_block,
	active_component,
	active_reaction,
	create_component_ctx,
	is_block_dirty,
	run_block,
	run_teardown,
	schedule_update,
	untrack,
} from './ripple-runtime.js';
import type { Block, Component, Derived } from './ripple-runtime.js';
import { is_ripple_object } from './ripple-utils.js';

export function user_effect(fn: () => void): Block | void {
	if (active_block === null) {
		throw new Error(
			'effect() must be called within an active context, such as a component or effect',
		);
	}

	const component = active_component;
	if (component !== null && !component.m) {
		const e = (component.e ??= []);
		e.push({
			b: active_block,
			fn,
			r: active_reaction,
		});

		return;
	}

	return block(EFFECT_BLOCK, fn);
}

export function effect(fn: () => void): Block {
	return block(EFFECT_BLOCK, fn);
}

export function pre_effect(fn: () => void): Block {
	return block(PRE_EFFECT_BLOCK, fn);
}

export function render(fn: (state: unknown) => unknown, state?: unknown, flags = 0): Block {
	return block(RENDER_BLOCK | flags, fn, state);
}

export function branch(fn: (state: unknown) => unknown, flags = 0, state: unknown = null): Block {
	return block(BRANCH_BLOCK | flags, fn, state);
}

export function root(fn: () => void | (() => void)): Block {
	return block(ROOT_BLOCK, fn, { start: null, end: null }, create_component_ctx());
}

export function create_try_block(fn: (state: unknown) => unknown, state?: unknown): Block {
	return block(TRY_BLOCK, fn, state);
}

export function boundary_fn_running_block(fn: (state: unknown) => unknown, flags = 0, state: unknown = null): Block {
	return branch(fn, DIRECT_CHILD_BLOCK | flags, state);
}

interface BlockWithStartEnd {
	start: Node | null;
	end: Node | null;
}

function push_block(block: Block, parent_block: Block): void {
	const parent_last = parent_block.last;
	if (parent_last === null) {
		parent_block.last = parent_block.first = block;
	} else {
		parent_last.next = block;
		block.prev = parent_last;
		parent_block.last = block;
	}
}

export function block(
	flags: number,
	fn: (state: unknown) => unknown,
	state: unknown = null,
	co?: Component,
): Block {
	const newBlock: Block = {
		co: co || active_component,
		d: null,
		first: null,
		f: flags,
		fn,
		last: null,
		next: null,
		p: active_block,
		prev: null,
		s: state,
		t: null,
	};

	if (active_reaction !== null && (active_reaction.f & DERIVED) !== 0) {
		((active_reaction as Derived).blocks ??= []).push(newBlock);
	}

	if (active_block !== null) {
		push_block(newBlock, active_block);
	}

	if ((flags & EFFECT_BLOCK) !== 0) {
		schedule_update(newBlock);
	} else {
		run_block(newBlock);
		newBlock.f ^= BLOCK_HAS_RUN;
	}

	return newBlock;
}

export function destroy_block_children(parent: Block, remove_dom = false): void {
	let block = parent.first;
	parent.first = parent.last = null;

	if (remove_dom || (parent.f & CONTAINS_TEARDOWN) !== 0) {
		while (block !== null) {
			const next = block.next;
			destroy_block(block, remove_dom);
			block = next;
		}
	}
}

export function destroy_non_branch_children(parent: Block, remove_dom = false): void {
	let block = parent.first;

	if (
		(parent.f & CONTAINS_TEARDOWN) === 0 &&
		parent.first !== null &&
		(parent.first.f & BRANCH_BLOCK) === 0
	) {
		parent.first = parent.last = null;
	} else {
		while (block !== null) {
			const next = block.next;
			if ((block.f & BRANCH_BLOCK) === 0) {
				destroy_block(block, remove_dom);
			}
			block = next;
		}
	}
}

export function unlink_block(block: Block): void {
	const parent = block.p;
	const prev = block.prev;
	const next = block.next;

	if (prev !== null) prev.next = next;
	if (next !== null) next.prev = prev;

	if (parent !== null) {
		if (parent.first === block) parent.first = next;
		if (parent.last === block) parent.last = prev;
	}
}

export function pause_block(block: Block): void {
	if ((block.f & PAUSED) !== 0) {
		return;
	}
	block.f ^= PAUSED;

	let child = block.first;

	while (child !== null) {
		const next = child.next;
		pause_block(child);
		child = next;
	}

	run_teardown(block);
}

export function resume_block(block: Block): void {
	if ((block.f & PAUSED) === 0) {
		return;
	}
	block.f ^= PAUSED;

	if (is_block_dirty(block)) {
		schedule_update(block);
	}

	let child = block.first;

	while (child !== null) {
		const next = child.next;
		resume_block(child);
		child = next;
	}
}

export function is_destroyed(target_block: Block): boolean {
	let block: Block | null = target_block;

	while (block !== null) {
		const flags = block.f;

		if ((flags & DESTROYED) !== 0) {
			return true;
		}
		if ((flags & ROOT_BLOCK) !== 0) {
			return false;
		}
		block = block.p;
	}
	return true;
}

export function destroy_block(block: Block, remove_dom = true): void {
	block.f ^= DESTROYED;

	let removed = false;
	const f = block.f;

	if (
		(remove_dom && (f & (BRANCH_BLOCK | ROOT_BLOCK)) !== 0 && (f & TRY_BLOCK) === 0) ||
		(f & HEAD_BLOCK) !== 0
	) {
		const s = block.s as BlockWithStartEnd | null;
		if (s !== null && s.start !== null) {
			removed = true;
		}
	}

	destroy_block_children(block, remove_dom && !removed);

	run_teardown(block);

	const parent = block.p;

	if (parent !== null && parent.first !== null) {
		unlink_block(block);
	}

	block.fn = block.s = block.d = block.p = block.co = block.t = null;
}
