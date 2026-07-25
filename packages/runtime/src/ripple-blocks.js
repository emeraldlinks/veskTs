/**
 * Ripple Block System — exact copy from ripple@0.3.13
 * Blocks are the fundamental unit of the reactive graph.
 */

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
import { is_ripple_object } from './ripple-utils.js';

/**
 * @param {Function} fn
 */
export function user_effect(fn) {
	if (active_block === null) {
		throw new Error(
			'effect() must be called within an active context, such as a component or effect',
		);
	}

	var component = active_component;
	if (component !== null && !component.m) {
		var e = (component.e ??= []);
		e.push({
			b: active_block,
			fn,
			r: active_reaction,
		});

		return;
	}

	return block(EFFECT_BLOCK, fn);
}

/**
 * @param {Function} fn
 */
export function effect(fn) {
	return block(EFFECT_BLOCK, fn);
}

/**
 * Creates a pre-effect block that runs eagerly before render blocks in the flush cycle.
 * @param {Function} fn
 */
export function pre_effect(fn) {
	return block(PRE_EFFECT_BLOCK, fn);
}

/**
 * @param {Function} fn
 * @param {any} [state]
 * @param {number} [flags]
 */
export function render(fn, state, flags = 0) {
	return block(RENDER_BLOCK | flags, fn, state);
}

/**
 * @param {Function} fn
 * @param {number} [flags]
 * @param {any} [state]
 */
export function branch(fn, flags = 0, state = null) {
	return block(BRANCH_BLOCK | flags, fn, state);
}

/**
 * @param {() => (void | (() => void))} fn
 * @returns {Block}
 */
export function root(fn) {
	return block(ROOT_BLOCK, fn, { start: null, end: null }, create_component_ctx());
}

/**
 * @param {Function} fn
 * @param {any} [state]
 * @returns {Block}
 */
export function create_try_block(fn, state) {
	return block(TRY_BLOCK, fn, state);
}

/**
 * @param {Function} fn
 * @param {number} [flags]
 * @param {any} [state]
 */
export function boundary_fn_running_block(fn, flags = 0, state = null) {
	return branch(fn, DIRECT_CHILD_BLOCK | flags, state);
}

/**
 * @param {Block} block
 * @param {Block} parent_block
 */
function push_block(block, parent_block) {
	var parent_last = parent_block.last;
	if (parent_last === null) {
		parent_block.last = parent_block.first = block;
	} else {
		parent_last.next = block;
		block.prev = parent_last;
		parent_block.last = block;
	}
}

/**
 * @param {number} flags
 * @param {Function} fn
 * @param {any} [state]
 * @param {Component} [co]
 * @returns {Block}
 */
export function block(flags, fn, state = null, co) {
	/** @type {Block} */
	var block = {
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
		(/** @type {Derived} */ (active_reaction).blocks ??= []).push(block);
	}

	if (active_block !== null) {
		push_block(block, active_block);
	}

	if ((flags & EFFECT_BLOCK) !== 0) {
		schedule_update(block);
	} else {
		run_block(block);
		block.f ^= BLOCK_HAS_RUN;
	}

	return block;
}

/**
 * @param {Block} parent
 * @param {boolean} [remove_dom]
 */
export function destroy_block_children(parent, remove_dom = false) {
	var block = parent.first;
	parent.first = parent.last = null;

	if (remove_dom || (parent.f & CONTAINS_TEARDOWN) !== 0) {
		while (block !== null) {
			var next = block.next;
			destroy_block(block, remove_dom);
			block = next;
		}
	}
}

/**
 * @param {Block} parent
 * @param {boolean} [remove_dom]
 */
export function destroy_non_branch_children(parent, remove_dom = false) {
	var block = parent.first;

	if (
		(parent.f & CONTAINS_TEARDOWN) === 0 &&
		parent.first !== null &&
		(parent.first.f & BRANCH_BLOCK) === 0
	) {
		parent.first = parent.last = null;
	} else {
		while (block !== null) {
			var next = block.next;
			if ((block.f & BRANCH_BLOCK) === 0) {
				destroy_block(block, remove_dom);
			}
			block = next;
		}
	}
}

/**
 * @param {Block} block
 */
export function unlink_block(block) {
	var parent = block.p;
	var prev = block.prev;
	var next = block.next;

	if (prev !== null) prev.next = next;
	if (next !== null) next.prev = prev;

	if (parent !== null) {
		if (parent.first === block) parent.first = next;
		if (parent.last === block) parent.last = prev;
	}
}

/**
 * @param {Block} block
 */
export function pause_block(block) {
	if ((block.f & PAUSED) !== 0) {
		return;
	}
	block.f ^= PAUSED;

	var child = block.first;

	while (child !== null) {
		var next = child.next;
		pause_block(child);
		child = next;
	}

	run_teardown(block);
}

/**
 * @param {Block} block
 */
export function resume_block(block) {
	if ((block.f & PAUSED) === 0) {
		return;
	}
	block.f ^= PAUSED;

	if (is_block_dirty(block)) {
		schedule_update(block);
	}

	var child = block.first;

	while (child !== null) {
		var next = child.next;
		resume_block(child);
		child = next;
	}
}

/**
 * @param {Block} target_block
 * @returns {boolean}
 */
export function is_destroyed(target_block) {
	/** @type {Block | null} */
	var block = target_block;

	while (block !== null) {
		var flags = block.f;

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

/**
 * @param {Block} block
 * @param {boolean} [remove_dom]
 */
export function destroy_block(block, remove_dom = true) {
	block.f ^= DESTROYED;

	var removed = false;
	var f = block.f;

	if (
		(remove_dom && (f & (BRANCH_BLOCK | ROOT_BLOCK)) !== 0 && (f & TRY_BLOCK) === 0) ||
		(f & HEAD_BLOCK) !== 0
	) {
		var s = block.s;
		if (s !== null && s.start !== null) {
			// remove_block_dom(s.start, s.end);
			removed = true;
		}
	}

	destroy_block_children(block, remove_dom && !removed);

	run_teardown(block);

	var parent = block.p;

	if (parent !== null && parent.first !== null) {
		unlink_block(block);
	}

	block.fn = block.s = block.d = block.p = block.co = block.t = null;
}
