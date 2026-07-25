// --- ripple-constants.js ---
// Ripple block flags — exact copy from ripple@0.3.13
var ROOT_BLOCK = 1 << 1;
var RENDER_BLOCK = 1 << 2;
var EFFECT_BLOCK = 1 << 3;
var BRANCH_BLOCK = 1 << 4;
var FOR_BLOCK = 1 << 5;
var TRY_BLOCK = 1 << 6;
var IF_BLOCK = 1 << 7;
var SWITCH_BLOCK = 1 << 8;
var COMPOSITE_BLOCK = 1 << 9;
var ASYNC_BLOCK = 1 << 10;
var HEAD_BLOCK = 1 << 11;
var PRE_EFFECT_BLOCK = 1 << 12;
var DIRECT_CHILD_BLOCK = 1 << 13;
var CONTAINS_UPDATE = 1 << 14;
var CONTAINS_TEARDOWN = 1 << 15;
var BLOCK_HAS_RUN = 1 << 16;
var TRACKED = 1 << 17;
var DERIVED = 1 << 18;
var DEFERRED = 1 << 19;
var PAUSED = 1 << 20;
var DESTROYED = 1 << 21;
var UPDATE_SOURCE = 1 << 22;

var CONTROL_FLOW_BLOCK = FOR_BLOCK | IF_BLOCK | SWITCH_BLOCK | TRY_BLOCK | COMPOSITE_BLOCK;

/** @type {unique symbol} */
const UNINITIALIZED = Symbol('uninitialized');
/** @type {unique symbol} */
const TRACKED_ARRAY = Symbol();
/** @type {unique symbol} */
const TRACKED_OBJECT = Symbol();
var COMPUTED_PROPERTY = Symbol();
/** @type {unique symbol} */
const HMR = Symbol();
var REF_PROP = 'ref';
/** @type {unique symbol} */
const ARRAY_SET_INDEX_AT = Symbol();
const MAX_ARRAY_LENGTH = 2 ** 32 - 1;
const DEFAULT_NAMESPACE = 'html';
const NAMESPACE_URI = {
	html: 'http://www.w3.org/1999/xhtml',
	svg: 'http://www.w3.org/2000/svg',
	mathml: 'http://www.w3.org/1998/Math/MathML',
};
/** @type {unique symbol} */
const TRACKED_UPDATED = Symbol('TRACKED_UPDATED');
/** @type {unique symbol} */
const SUSPENSE_PENDING = Symbol('suspense_pending');
/** @type {unique symbol} */
const SUSPENSE_REJECTED = Symbol('suspense_rejected');
/** @type {unique symbol} */
const ASYNC_DERIVED_READ_THROWN = Symbol('async_derived_read_thrown');

// --- ripple-utils.js ---
/**
 * Ripple utility functions — exact copy from ripple@0.3.13
 * Checks if an object is a tracked/derived object (has a numeric 'f' property).
 * @param {any} v - The object to check.
 * @returns {boolean}
 */
function is_ripple_object(v) {
	return typeof v === 'object' && v !== null && typeof (/** @type {any} */ (v).f) === 'number';
}

/**
 * Native JS helpers — replaces @tsrx/core/runtime/language-helpers
 */
var define_property = Object.defineProperty;
var get_descriptor = Object.getOwnPropertyDescriptor;
var is_array = Array.isArray;
var object_keys = Object.keys;
function get_own_property_symbols(obj) {
	return Object.getOwnPropertySymbols(obj);
}

// --- ripple-runtime.js ---
/**
 * Ripple Reactive Runtime — exact copy from ripple@0.3.13
 * Core reactivity with clock-based versioning, block system, and microtask scheduling.
 *
 * Adapted for Vesk: removed @tsrx dependencies, try/suspense, trackAsync, and SSR hydration.
 */

{ destroy_non_branch_children } from './ripple-blocks.js';

const FLUSH_MICROTASK = 0;
const FLUSH_SYNC = 1;

/** @type {null | Block} */
let active_block = null;
/** @type {null | Block | Derived} */
let active_reaction = null;
/** @type {null | Block} */
let active_scope = null;
/** @type {null | Component} */
let active_component = null;
/** @type {keyof typeof NAMESPACE_URI} */
let active_namespace = DEFAULT_NAMESPACE;
/** @type {boolean} */
let is_mutating_allowed = true;

/** @type {Map<Tracked | Derived, any>} */
var old_values = new Map();

/** @type {number} */
let scheduler_mode = FLUSH_MICROTASK;
/** @type {boolean} */
let is_micro_task_queued = false;
/** @type {number} */
let clock = 0;
/** @type {Block[]} */
let queued_root_blocks = [];
let disable_scoped_flush = false;
/** @type {(() => void)[]} */
let queued_microtasks = [];
/** @type {number} */
let flush_count = 0;
/** @type {(() => void)[]} */
var queued_post_block_flush = [];
/** @type {null | Dependency} */
let active_dependency = null;

let tracking = false;
let teardown = false;

/**
 * @returns {number}
 */
function increment_clock() {
	return ++clock;
}

/**
 * @param {Block | null} block
 */
function set_active_block(block) {
	active_block = block;
}

/**
 * @param {Block | Derived | null} reaction
 */
function set_active_reaction(reaction) {
	active_reaction = reaction;
}

/**
 * @param {Component | null} component
 */
function set_active_component(component) {
	active_component = component;
}

/**
 * @param {boolean} value
 */
function set_tracking(value) {
	tracking = value;
}

/**
 * @param {Block} block
 */
function run_teardown(block) {
	var fn = block.t;
	if (fn !== null) {
		var previous_block = active_block;
		var previous_reaction = active_reaction;
		var previous_tracking = tracking;
		var previous_teardown = teardown;

		try {
			active_block = null;
			active_reaction = null;
			tracking = false;
			teardown = true;
			fn.call(null);
		} finally {
			active_block = previous_block;
			active_reaction = previous_reaction;
			tracking = previous_tracking;
			teardown = previous_teardown;
		}
	}
}

/**
 * @param {Block} block
 * @param {() => any} fn
 */
function with_block(block, fn) {
	var prev_block = active_block;
	var previous_component = active_component;
	active_block = block;
	active_component = block.co;
	try {
		return fn();
	} finally {
		active_component = previous_component;
		active_block = prev_block;
	}
}

/**
 * @param {Derived} computed
 */
function update_derived(computed) {
	var value = computed.__v;

	if (value === UNINITIALIZED || is_tracking_dirty(computed.d)) {
		value = run_derived(computed);

		if (value !== computed.__v) {
			computed.__v = value;
			computed.c = increment_clock();
		}
	}
}

/**
 * @param {Tracked} tracked
 * @param {any} value
 */
function update_tracked_value_clock(tracked, value) {
	tracked.__v = value;
	tracked.c = increment_clock();
}

/**
 * @param {Derived} computed
 */
function destroy_computed_children(computed) {
	var blocks = computed.blocks;

	if (blocks !== null) {
		computed.blocks = null;
		for (var i = 0; i < blocks.length; i++) {
			destroy_block(blocks[i]);
		}
	}
}

/**
 * @param {Derived} computed
 */
function run_derived(computed) {
	var previous_block = active_block;
	var previous_reaction = active_reaction;
	var previous_tracking = tracking;
	var previous_dependency = active_dependency;
	var previous_component = active_component;
	var previous_is_mutating_allowed = is_mutating_allowed;

	try {
		active_block = computed.b;
		active_reaction = computed;
		tracking = true;
		active_dependency = null;
		active_component = computed.co;
		is_mutating_allowed = false;

		destroy_computed_children(computed);

		var value = computed.fn();

		computed.d = active_dependency;

		return value;
	} catch (error) {
		computed.d = active_dependency;
		if (error === ASYNC_DERIVED_READ_THROWN) {
			var dep = active_dependency;
			while (dep !== null) {
				if (dep.t.__v === SUSPENSE_REJECTED) {
					return SUSPENSE_REJECTED;
				}
				dep = dep.n;
			}
			return SUSPENSE_PENDING;
		}
		throw error;
	} finally {
		active_block = previous_block;
		active_reaction = previous_reaction;
		tracking = previous_tracking;
		active_dependency = previous_dependency;
		active_component = previous_component;
		is_mutating_allowed = previous_is_mutating_allowed;
	}
}

/**
 * @param {unknown} error
 * @param {Block} block
 */
function handle_error(error, block) {
	throw error;
}

/**
 * @param {Block} block
 */
function run_block(block) {
	var previous_block = active_block;
	var previous_reaction = active_reaction;
	var previous_tracking = tracking;
	var previous_dependency = active_dependency;
	var previous_component = active_component;

	try {
		active_block = block;
		active_reaction = block;
		active_component = block.co;

		destroy_non_branch_children(block);
		run_teardown(block);

		tracking = (block.f & (ROOT_BLOCK | BRANCH_BLOCK)) === 0;
		active_dependency = null;
		var res = block.fn(block.s);

		if (typeof res === 'function') {
			block.t = res;
			/** @type {Block | null} */
			let current = block;

			while (current !== null && (current.f & CONTAINS_TEARDOWN) === 0) {
				current.f ^= CONTAINS_TEARDOWN;
				current = current.p;
			}
		}

		block.d = active_dependency;
	} catch (error) {
		block.d = active_dependency;
		if (error !== ASYNC_DERIVED_READ_THROWN) {
			handle_error(error, block);
		}
	} finally {
		active_block = previous_block;
		active_reaction = previous_reaction;
		tracking = previous_tracking;
		active_dependency = previous_dependency;
		active_component = previous_component;
	}
}

var empty_get_set = { get: undefined, set: undefined };

class TrackedValue {
	/**
	 * @param {any} v
	 * @param {Block} block
	 * @param {{ get?: Function; set?: Function }} a
	 */
	constructor(v, block, a) {
		/** @type {{ get?: Function; set?: Function }} */
		this.a = a;
		/** @type {Block} */
		this.b = block;
		/** @type {number} */
		this.c = 0;
		/** @type {DeferredTrackedEntry[] | null} */
		this.d = null;
		/** @type {number} */
		this.f = TRACKED;
		/** @type {any} */
		this.__v = v;
	}
	/** @returns {any} */
	get [0]() {
		return get_tracked(this);
	}
	/** @param {any} v */
	set [0](v) {
		set(this, v);
	}
	/** @returns {Tracked} */
	get [1]() {
		return this;
	}
	/** @returns {any} */
	get value() {
		return get_tracked(this);
	}
	/** @param {any} v */
	set value(v) {
		set(this, v);
	}
	/** @returns {2} */
	get length() {
		return 2;
	}
	/** @returns {Iterator<any | Tracked>} */
	*[Symbol.iterator]() {
		yield get_tracked(this);
		yield this;
	}
}

class DerivedValue {
	/**
	 * @param {Function} fn
	 * @param {Block} block
	 * @param {{ get?: Function; set?: Function }} a
	 */
	constructor(fn, block, a) {
		/** @type {{ get?: Function; set?: Function }} */
		this.a = a;
		/** @type {Block} */
		this.b = block;
		/** @type {Block[] | null} */
		this.blocks = null;
		/** @type {number} */
		this.c = 0;
		/** @type {Component | null} */
		this.co = active_component;
		/** @type {Dependency | null} */
		this.d = null;
		/** @type {number} */
		this.f = DERIVED;
		/** @type {Function} */
		this.fn = fn;
		/** @type {any} */
		this.__v = UNINITIALIZED;
	}
	/** @returns {any} */
	get [0]() {
		return get_derived(this);
	}
	/** @param {any} v */
	set [0](v) {
		set(this, v);
	}
	/** @returns {Derived} */
	get [1]() {
		return this;
	}
	/** @returns {any} */
	get value() {
		return get_derived(this);
	}
	/** @param {any} v */
	set value(v) {
		set(this, v);
	}
	/** @returns {2} */
	get length() {
		return 2;
	}
	/** @returns {Iterator<any | Derived>} */
	*[Symbol.iterator]() {
		yield get_derived(this);
		yield this;
	}
}

/**
 * @param {any} v
 * @param {Block} block
 * @param {(value: any) => any} [get]
 * @param {(next: any, prev: any) => any} [set]
 * @returns {Tracked}
 */
function tracked(v, block, get, set) {
	return new TrackedValue(v, block || active_block, get || set ? { get, set } : empty_get_set);
}

/**
 * @param {any} fn
 * @param {Block} block
 * @param {(value: any) => any} [get]
 * @param {(next: any, prev: any) => any} [set]
 * @returns {Derived}
 */
function derived(fn, block, get, set) {
	return new DerivedValue(fn, block || active_block, get || set ? { get, set } : empty_get_set);
}

/**
 * @param {any} v
 * @param {Block} b
 * @param {(value: any) => any} [get]
 * @param {(next: any, prev: any) => any} [set]
 * @returns {Tracked | Derived}
 */
function track(v, b, get, set) {
	if (is_ripple_object(v)) {
		return v;
	}

	if (typeof v === 'function') {
		return derived(v, b, get, set);
	}
	return tracked(v, b, get, set);
}

/**
 * @param {Tracked | Derived} tracked
 * @returns {Dependency}
 */
function create_dependency(tracked) {
	var reaction = /** @type {Derived | Block} **/ (active_reaction);
	var existing = reaction.d;

	if (existing !== null) {
		reaction.d = existing.n;
		existing.c = tracked.c;
		existing.t = tracked;
		existing.n = null;
		return existing;
	}

	return {
		c: tracked.c,
		t: tracked,
		n: null,
	};
}

/**
 * @param {Dependency | null} tracking
 */
function is_tracking_dirty(tracking) {
	if (tracking === null) {
		return false;
	}
	while (tracking !== null) {
		var tracked = tracking.t;

		if ((tracked.f & DERIVED) !== 0) {
			try {
				update_derived(/** @type {Derived} **/ (tracked));
			} catch (e) {
				if (e === ASYNC_DERIVED_READ_THROWN) {
					return true;
				}
				throw e;
			}
		}

		if (tracked.c > tracking.c) {
			return true;
		}
		tracking = tracking.n;
	}

	return false;
}

/**
 * @param {Block} block
 */
function is_block_dirty(block) {
	var flags = block.f;

	if ((flags & (ROOT_BLOCK | BRANCH_BLOCK)) !== 0) {
		return false;
	}
	if ((flags & BLOCK_HAS_RUN) === 0) {
		block.f ^= BLOCK_HAS_RUN;
		return true;
	}

	return is_tracking_dirty(block.d);
}

/**
 * @param {Block} root_block
 */
function flush_updates(root_block) {
	/** @type {Block | null} */
	var current = root_block;
	var pre_effects = [];
	var other_blocks = [];
	var effects = [];
	/** @type {Block | null} */
	var scope_root = disable_scoped_flush ? root_block : null;

	while (current !== null) {
		var flags = current.f;
		var on_path = (flags & CONTAINS_UPDATE) !== 0;

		if (on_path) {
			current.f ^= CONTAINS_UPDATE;
		}

		if ((flags & UPDATE_SOURCE) !== 0) {
			current.f ^= UPDATE_SOURCE;
			if (scope_root === null) {
				scope_root = current;
			}
		}

		if ((flags & PAUSED) === 0 && (on_path || scope_root !== null)) {
			if ((flags & PRE_EFFECT_BLOCK) !== 0) {
				pre_effects.push(current);
			} else if ((flags & EFFECT_BLOCK) !== 0) {
				effects.push(current);
			} else {
				other_blocks.push(current);
			}
			/** @type {Block | null} */
			var child = current.first;

			if (child !== null) {
				current = child;
				continue;
			}
		}

		/** @type {Block | null} */
		var parent = current.p;
		current = current.next;

		while (current === null && parent !== null) {
			if (parent === scope_root) {
				scope_root = null;
			}
			current = parent.next;
			parent = parent.p;
		}
	}

	var arr_length = 0;

	// Phase 1: pre-effects
	arr_length = pre_effects.length;
	for (var i = 0; i < arr_length; i++) {
		var block = pre_effects[i];
		try {
			if ((block.f & (PAUSED | DESTROYED)) === 0 && is_block_dirty(block)) {
				run_block(block);
			}
		} catch (error) {
			handle_error(error, block);
		}
	}

	// Phase 2: other blocks
	arr_length = other_blocks.length;
	for (var i = 0; i < arr_length; i++) {
		var block = other_blocks[i];
		try {
			if ((block.f & (PAUSED | DESTROYED)) === 0 && is_block_dirty(block)) {
				run_block(block);
			}
		} catch (error) {
			handle_error(error, block);
		}
	}

	// Phase 3: effects
	arr_length = effects.length;
	for (var i = 0; i < arr_length; i++) {
		var block = effects[i];
		try {
			if ((block.f & (PAUSED | DESTROYED)) === 0 && is_block_dirty(block)) {
				run_block(block);
			}
		} catch (error) {
			handle_error(error, block);
		}
	}
}

/**
 * @param {Block[]} root_blocks
 */
function flush_queued_root_blocks(root_blocks) {
	for (let i = 0; i < root_blocks.length; i++) {
		flush_updates(root_blocks[i]);
	}

	if (queued_post_block_flush.length > 0) {
		var callbacks = queued_post_block_flush;
		queued_post_block_flush = [];
		for (var j = 0; j < callbacks.length; j++) {
			callbacks[j]();
		}
	}
}

/**
 * @returns {Promise<void>}
 */
async function tick() {
	return new Promise((f) => requestAnimationFrame(() => f()));
}

/**
 * @returns {void}
 */
function flush_microtasks() {
	is_micro_task_queued = false;

	if (queued_microtasks.length > 0) {
		var microtasks = queued_microtasks;
		queued_microtasks = [];
		for (var i = 0; i < microtasks.length; i++) {
			microtasks[i]();
		}
	}

	flush_count++;
	if (flush_count > 1001) {
		throw new Error(
			'Maximum update depth exceeded. This typically indicates that an effect reads and writes the same piece of state.',
		);
	}
	var previous_queued_root_blocks = queued_root_blocks;
	queued_root_blocks = [];
	flush_queued_root_blocks(previous_queued_root_blocks);

	if (!is_micro_task_queued) {
		flush_count = 0;
	}
	old_values.clear();
}

/**
 * @param { (() => void) } [fn]
 */
function queue_microtask(fn) {
	if (!is_micro_task_queued) {
		is_micro_task_queued = true;
		queueMicrotask(flush_microtasks);
	}
	if (fn !== undefined) {
		queued_microtasks.push(fn);
	}
}

/**
 * @param {() => void} fn
 */
function queue_post_block_flush_callback(fn) {
	queued_post_block_flush.push(fn);
}

/**
 * @param {Block} block
 */
function schedule_update(block) {
	if (block === null) return;
	if (scheduler_mode === FLUSH_MICROTASK) {
		queue_microtask();
	}
	block.f |= UPDATE_SOURCE;
	let current = block;

	while (current !== null) {
		var flags = current.f;
		if ((flags & CONTAINS_UPDATE) !== 0) return;
		current.f ^= CONTAINS_UPDATE;
		if ((flags & ROOT_BLOCK) !== 0) {
			break;
		}
		current = /** @type {Block} */ (current.p);
	}

	queued_root_blocks.push(current);
}

/**
 * @param {Tracked | Derived} tracked
 */
function register_dependency(tracked) {
	if (!disable_scoped_flush && active_block !== null && active_block !== tracked.b) {
		var already_seen = false;
		var prev_dep = active_reaction === null ? null : active_reaction.d;
		while (prev_dep !== null) {
			if (prev_dep.t === tracked) {
				already_seen = true;
				break;
			}
			prev_dep = prev_dep.n;
		}

		if (!already_seen) {
			var owner = tracked.b;
			/** @type {Block | null} */
			var node = active_block;
			while (node !== null && node !== owner) {
				node = node.p;
			}
			if (node === null) {
				disable_scoped_flush = true;
			}
		}
	}

	var dependency = active_dependency;

	if (dependency === null) {
		dependency = create_dependency(tracked);
		active_dependency = dependency;
	} else {
		var current = dependency;

		while (current !== null) {
			if (current.t === tracked) {
				current.c = tracked.c;
				return;
			}
			var next = current.n;
			if (next === null) {
				break;
			}
			current = next;
		}

		dependency = create_dependency(tracked);
		current.n = dependency;
	}
}

/**
 * @param {Derived} computed
 */
function get_derived(computed) {
	update_derived(computed);
	if (tracking) {
		register_dependency(computed);
	}
	var value = computed.__v;
	var get = computed.a.get;
	if (get !== undefined) {
		value = trigger_track_get(get, value);
		computed.__v = value;
	}

	if (value === SUSPENSE_PENDING || value === SUSPENSE_REJECTED) {
		throw ASYNC_DERIVED_READ_THROWN;
	}

	return value;
}

/**
 * @param {(Derived | Tracked) | (() => any)} t
 * @returns {any}
 */
function get(t) {
	if (!is_ripple_object(t)) {
		return t;
	}

	return (t.f & DERIVED) !== 0
		? get_derived(/** @type {Derived} */ (t))
		: get_tracked(/** @type {Tracked} */ (t));
}

/**
 * @param {Tracked} tracked
 */
function get_tracked(tracked) {
	var value = tracked.__v;
	if (tracking) {
		register_dependency(tracked);
	}

	if (value === SUSPENSE_PENDING || value === SUSPENSE_REJECTED) {
		throw ASYNC_DERIVED_READ_THROWN;
	}

	if (teardown && old_values.has(tracked)) {
		value = old_values.get(tracked);
	}
	var get = tracked.a.get;
	if (get !== undefined) {
		value = trigger_track_get(get, value);
	}
	return value;
}

/**
 * @param {(Derived | Tracked) | (() => any)} t
 * @returns {boolean}
 */
function is_tracked_pending(t) {
	try {
		if (typeof t === 'function') {
			t();
		} else {
			get(t);
		}
		return false;
	} catch (error) {
		if (error === ASYNC_DERIVED_READ_THROWN) {
			return true;
		}
		throw error;
	}
}

/**
 * @param {Tracked | Derived} tracked
 * @return {any}
 */
function peek_tracked(tracked) {
	if (!is_ripple_object(tracked)) {
		return tracked;
	}

	return tracked.__v;
}

/**
 * @param {Tracked | Derived} tracked
 * @param {any} value
 */
function set(tracked, value) {
	if (!is_mutating_allowed) {
		throw new Error(
			'Assignments or updates to tracked values are not allowed during computed "track(() => ...)" evaluation',
		);
	}

	var old_value = tracked.__v;

	if (value !== old_value) {
		var tracked_block = tracked.b;

		if (tracked_block !== null && (tracked_block.f & CONTAINS_TEARDOWN) !== 0) {
			if (teardown) {
				old_values.set(tracked, value);
			} else {
				old_values.set(tracked, old_value);
			}
		}

		let set = tracked.a.set;
		if (set !== undefined) {
			value = untrack(() => set(value, old_value));
		}

		tracked.__v = value;
		tracked.c = increment_clock();
		schedule_update(tracked_block);
	}
}

/**
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
function untrack(fn) {
	var previous_tracking = tracking;
	var previous_dependency = active_dependency;
	tracking = false;
	active_dependency = null;
	try {
		return fn();
	} finally {
		tracking = previous_tracking;
		active_dependency = previous_dependency;
	}
}

/**
 * @template T
 * @param {() => T} [fn]
 * @returns {T}
 */
function flush_sync(fn) {
	var previous_scheduler_mode = scheduler_mode;
	var previous_queued_root_blocks = queued_root_blocks;

	try {
		/** @type {Block[]} */
		var root_blocks = [];

		scheduler_mode = FLUSH_SYNC;
		queued_root_blocks = root_blocks;
		is_micro_task_queued = false;

		flush_queued_root_blocks(previous_queued_root_blocks);

		var result = fn?.();

		if (queued_root_blocks.length > 0 || root_blocks.length > 0) {
			flush_sync();
		}

		flush_count = 0;

		return /** @type {T} */ (result);
	} finally {
		scheduler_mode = previous_scheduler_mode;
		queued_root_blocks = previous_queued_root_blocks;
	}
}

/**
 * @template V
 * @param {Function} fn
 * @param {V} v
 */
function trigger_track_get(fn, v) {
	var previous_is_mutating_allowed = is_mutating_allowed;
	try {
		is_mutating_allowed = false;
		return untrack(() => fn(v));
	} finally {
		is_mutating_allowed = previous_is_mutating_allowed;
	}
}

/**
 * @param {() => Object} fn
 * @returns {Object}
 */
function spread_props(fn) {
	return proxy_props(fn);
}

/**
 * @param {() => Object} fn
 * @returns {Object}
 */
function proxy_props(fn) {
	const memo = derived(fn, /** @type {Block} */ (active_block));

	return new Proxy(
		{},
		{
			get(_, property) {
				/** @type {Record<string | symbol, any> | Record<string | symbol, any>[]} */
				var obj = get_derived(memo);

				if (is_array(obj)) {
					/** @type {Record<string | symbol, any>} */
					var item;
					for (var i = obj.length - 1; i >= 0; i--) {
						item = obj[i];
						if (property in item) {
							return item[property];
						}
					}
					return undefined;
				}

				return obj[property];
			},
			has(_, property) {
				if (property === TRACKED_OBJECT) {
					return true;
				}
				/** @type {Record<string | symbol, any> | Record<string | symbol, any>[]} */
				var obj = get_derived(memo);

				if (is_array(obj)) {
					for (var i = obj.length - 1; i >= 0; i--) {
						if (property in obj[i]) {
							return true;
						}
					}
					return false;
				}

				return property in obj;
			},
			getOwnPropertyDescriptor(_, key) {
				/** @type {Record<string | symbol, any> | Record<string | symbol, any>[]} */
				var obj = get_derived(memo);

				if (is_array(obj)) {
					/** @type {Record<string | symbol, any>} */
					var item;
					for (var i = obj.length - 1; i >= 0; i--) {
						item = obj[i];
						if (key in item) {
							return get_descriptor(item, key);
						}
					}
					return undefined;
				}

				if (key in obj) {
					return get_descriptor(obj, key);
				}
			},
			ownKeys() {
				/** @type {Record<string | symbol, any> | Record<string | symbol, any>[]} */
				var obj = get_derived(memo);
				/** @type {Record<string | symbol, 1>} */
				var done = {};
				/** @type {(string | symbol)[]} */
				var keys = [];

				if (is_array(obj)) {
					/** @type {Record<string | symbol, any>} */
					var item;
					for (var i = 0; i < obj.length; i++) {
						item = obj[i];
						for (const key of Reflect.ownKeys(item)) {
							if (done[key]) {
								continue;
							}
							done[key] = 1;
							keys.push(key);
						}
					}
					return keys;
				}

				return Reflect.ownKeys(obj);
			},
		},
	);
}

/**
 * @template T
 * @param {() => T} fn
 * @returns {() => T}
 */
function computed_property(fn) {
	define_property(fn, COMPUTED_PROPERTY, {
		value: true,
		enumerable: false,
	});
	return fn;
}

/**
 * @param {any} obj
 * @param {string | number | symbol} property
 * @param {boolean} chain_obj
 * @param {boolean} chain_prop
 * @param {...any} args
 * @returns {any}
 */
function call_property(obj, property, chain_obj, chain_prop, ...args) {
	if (!chain_obj && !chain_prop) {
		return obj[property].call(obj, ...args);
	} else if (chain_obj && chain_prop) {
		return obj?.[property]?.call(obj, ...args);
	} else if (chain_obj) {
		return obj?.[property].call(obj, ...args);
	} else if (chain_prop) {
		return obj[property]?.call(obj, ...args);
	}
}

/**
 * @param {any} obj
 * @param {string | number | symbol} property
 * @param {boolean} [chain=false]
 * @returns {any}
 */
function get_property(obj, property, chain = false) {
	if (chain && obj == null) {
		return undefined;
	}
	var tracked = obj[property];
	if (tracked == null) {
		return tracked;
	}
	return get(tracked);
}

/**
 * @param {any} obj
 * @param {string | number | symbol} property
 * @param {any} value
 * @returns {void}
 */
function set_property(obj, property, value) {
	var tracked = obj[property];
	set(tracked, value);
}

/**
 * @param {Tracked} tracked
 * @param {number} [d]
 * @returns {number}
 */
function update(tracked, d = 1) {
	var value = get(tracked);
	var result = d === 1 ? value++ : value--;
	set(tracked, value);
	return result;
}

/**
 * @param {Tracked} tracked
 * @returns {void}
 */
function increment(tracked) {
	set(tracked, tracked.__v + 1);
}

/**
 * @param {Tracked} tracked
 * @returns {void}
 */
function decrement(tracked) {
	set(tracked, tracked.__v - 1);
}

/**
 * @param {Tracked} tracked
 * @param {number} [d]
 * @returns {number}
 */
function update_pre(tracked, d = 1) {
	var value = get(tracked);
	var new_value = d === 1 ? ++value : --value;
	set(tracked, new_value);
	return new_value;
}

/**
 * @param {any} obj
 * @param {string | number | symbol} property
 * @param {number} [d=1]
 * @returns {number}
 */
function update_property(obj, property, d = 1) {
	var tracked = obj[property];
	var value = get(tracked);
	var new_value = d === 1 ? value++ : value--;
	set(tracked, value);
	return new_value;
}

/**
 * @param {any} obj
 * @param {string | number | symbol} property
 * @param {number} [d=1]
 * @returns {number}
 */
function update_pre_property(obj, property, d = 1) {
	var tracked = obj[property];
	var value = get(tracked);
	var new_value = d === 1 ? ++value : --value;
	set(tracked, new_value);
	return new_value;
}

/**
 * @template T
 * @param {Block} block
 * @param {() => T} fn
 * @returns {T}
 */
function with_scope(block, fn) {
	var previous_scope = active_scope;
	try {
		active_scope = block;
		return fn();
	} finally {
		active_scope = previous_scope;
	}
}

/**
 * @returns {Block | null}
 */
function scope() {
	return active_scope || active_block;
}

/**
 * @param {string} [err]
 * @returns {Block | never}
 */
function safe_scope(err = 'Cannot access outside of a component context') {
	if (active_scope === null) {
		throw new Error(err);
	}

	return /** @type {Block} */ (active_scope);
}

function create_component_ctx() {
	return {
		b: active_block,
		c: null,
		e: null,
		m: false,
		p: active_component,
	};
}

/**
 * @returns {void}
 */
function push_component() {
	var component = create_component_ctx();
	active_component = component;
}

/**
 * @returns {void}
 */
function pop_component() {
	var component = /** @type {Component} */ (active_component);
	component.m = true;
	var effects = component.e;
	if (effects !== null) {
		var length = effects.length;
		for (var i = 0; i < length; i++) {
			var { b: block, fn, r: reaction } = effects[i];
			var previous_block = active_block;
			var previous_reaction = active_reaction;

			try {
				active_block = block;
				active_reaction = reaction;
				effect(fn);
			} finally {
				active_block = previous_block;
				active_reaction = previous_reaction;
			}
		}
	}
	active_component = component.p;
}

/**
 * @param {Record<string | symbol, unknown>} obj
 * @param {string[]} exclude_keys
 * @returns {Record<string | symbol, unknown>}
 */
function exclude_from_object(obj, exclude_keys) {
	var keys = object_keys(obj);
	/** @type {Record<string | symbol, unknown>} */
	var new_obj = {};

	for (const key of keys) {
		if (!exclude_keys.includes(key)) {
			new_obj[key] = obj[key];
		}
	}

	for (const symbol of get_own_property_symbols(obj)) {
		new_obj[symbol] = obj[symbol];
	}

	return new_obj;
}

// --- ripple-blocks.js ---
/**
 * Ripple Block System — exact copy from ripple@0.3.13
 * Blocks are the fundamental unit of the reactive graph.
 */


/**
 * @param {Function} fn
 */
function user_effect(fn) {
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
function effect(fn) {
	return block(EFFECT_BLOCK, fn);
}

/**
 * Creates a pre-effect block that runs eagerly before render blocks in the flush cycle.
 * @param {Function} fn
 */
function pre_effect(fn) {
	return block(PRE_EFFECT_BLOCK, fn);
}

/**
 * @param {Function} fn
 * @param {any} [state]
 * @param {number} [flags]
 */
function render(fn, state, flags = 0) {
	return block(RENDER_BLOCK | flags, fn, state);
}

/**
 * @param {Function} fn
 * @param {number} [flags]
 * @param {any} [state]
 */
function branch(fn, flags = 0, state = null) {
	return block(BRANCH_BLOCK | flags, fn, state);
}

/**
 * @param {() => (void | (() => void))} fn
 * @returns {Block}
 */
function root(fn) {
	return block(ROOT_BLOCK, fn, { start: null, end: null }, create_component_ctx());
}

/**
 * @param {Function} fn
 * @param {any} [state]
 * @returns {Block}
 */
function create_try_block(fn, state) {
	return block(TRY_BLOCK, fn, state);
}

/**
 * @param {Function} fn
 * @param {number} [flags]
 * @param {any} [state]
 */
function boundary_fn_running_block(fn, flags = 0, state = null) {
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
function block(flags, fn, state = null, co) {
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
function destroy_block_children(parent, remove_dom = false) {
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
function destroy_non_branch_children(parent, remove_dom = false) {
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
function unlink_block(block) {
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
function pause_block(block) {
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
function resume_block(block) {
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
function is_destroyed(target_block) {
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
function destroy_block(block, remove_dom = true) {
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

// --- context.js ---
const ctx = { current: null };

function getActiveComponent() {
  return ctx.current ?? globalThis.__vesk_ctx ?? null;
}

function setActiveComponent(value) {
  ctx.current = value;
}

class Context {
  constructor(value) {
    this._v = value;
  }
  get() {
    let current = getActiveComponent();
    while (current) {
      if (current.c?.has(this)) return current.c.get(this);
      current = current.p;
    }
    return this._v;
  }
  set(value) {
    const component = getActiveComponent();
    if (component === null) throw new Error('No active component found, cannot set context');
    let map = component.c;
    if (map === null) map = component.c = new Map();
    map.set(this, value);
  }
}

function createContext(value) {
  return new Context(value);
}

// --- hydrate.js ---
/**
 * Vesk hydration runtime.
 *
 * Uses `data-vsk` attributes on server-rendered elements to match
 * them with the client codegen's imperative DOM creation calls.
 * After matching, the attribute is removed to avoid re-matching.
 *
 * Text nodes: NOT matched individually. Instead, `nextElement` clears
 * the matched element's direct SSR text children; the codegen
 * re-creates them fresh via `document.createTextNode`.
 *
 * Supports time-sliced hydration via `hydrateViewport` and
 * `hydrateIdle` for progressive enhancement.
 */

function reactiveProps(props) {
	return new Proxy(props, {
		get(target, key) {
			const val = Reflect.get(target, key);
			if (typeof val === 'object' && val !== null && typeof val.f === 'number') {
				return get(val);
			}
			return val;
		}
	});
}

function createHydrateWalker(container, elementList) {
	const elements = elementList || [];
	let elemIdx = 0;

	return {
		root: container,
		done() {
			return elemIdx >= elements.length;
		},
		nextElement(tag) {
			while (elemIdx < elements.length) {
				const el = elements[elemIdx++];
				if (tag && el.tagName.toLowerCase() !== tag) continue;
				if (el.removeAttribute) el.removeAttribute('data-vsk');
				// Clear direct text children from SSR — codegen re-creates them fresh
				for (let i = el.childNodes.length - 1; i >= 0; i--) {
					if (el.childNodes[i].nodeType === 3) {
						el.childNodes[i].remove();
					}
				}
				return el;
			}
			const result = document.createElement(tag || 'div');
			return result;
		},
		subWalker(rootEl) {
			// Flat-list sub-walker: uses remaining elements contained within rootEl
			const subElements = elements.slice(elemIdx).filter((el) => {
				if (rootEl === el) return true;
				if (!rootEl || !el) return false;
				if (typeof rootEl.contains === 'function') return rootEl.contains(el);
				if (typeof rootEl.compareDocumentPosition === 'function') {
					return (rootEl.compareDocumentPosition(el) & 16) !== 0;
				}
				return false;
			});
			elemIdx += subElements.length;
			return createHydrateWalker(rootEl, subElements);
		},
	};
}

/**
 * Create a tree-structured walker that walks the actual children
 * of a parent DOM element, claiming elements by matching tag name.
 *
 * Unlike the flat-list walker (createHydrateWalker), this walker
 * iterates over parentEl.children in DOM order. This ensures each
 * component only claims elements within its own scope, preventing
 * conflicts between Layout, NavLink, and Page components.
 *
 * @param {Element} parentEl - The parent element whose children to walk
 * @returns {Object} Walker with nextElement, subWalker methods
 */
function createHydrateChildWalker(parentEl) {
	let childIdx = 0;
	const children = parentEl ? parentEl.children : [];

		return {
		root: parentEl,
		nextElement(tag) {
			while (childIdx < children.length) {
				const child = children[childIdx++];
				if (!tag || child.tagName.toLowerCase() === tag) {
					// Clear SSR text children — codegen re-creates them fresh
					for (let i = child.childNodes.length - 1; i >= 0; i--) {
						if (child.childNodes[i].nodeType === 3) {
							child.childNodes[i].remove();
						}
					}
					return child;
				}
			}
			return document.createElement(tag || 'div');
		},
		subWalker(rootEl) {
			return createHydrateChildWalker(rootEl);
		},
	};
}
function hydrate(container, componentFn, props) {
	const allElements = Array.from(container.querySelectorAll('[data-vsk]'));
	const walker = createHydrateWalker(container, allElements);
	return componentFn(props, new Map(), walker);
}

/**
 * Viewport-prioritized hydration — hydrates all elements via a single
 * componentFn call (avoiding duplicate effects), but defers visibility
 * checks for progressive enhancement indicators.
 *
 * @param {HTMLElement} container
 * @param {Function} componentFn
 * @param {object} props
 * @param {number} [rootMargin=500] pixels outside viewport to include
 * @returns {Promise} resolves when all viewport elements are hydrated
 */
function hydrateViewport(container, componentFn, props, rootMargin = 500) {
	const allElements = Array.from(container.querySelectorAll('[data-vsk]'));

	// Split into viewport and deferred batches
	const viewportEls = [];
	const deferredEls = [];
	for (const el of allElements) {
		const rect = el.getBoundingClientRect();
		if (rect.bottom < -rootMargin || rect.top > window.innerHeight + rootMargin) {
			deferredEls.push(el);
		} else {
			viewportEls.push(el);
		}
	}

	// Temporarily hide deferred elements from querySelector
	for (const el of deferredEls) {
		el.dataset.vskHold = el.getAttribute('data-vsk') || '';
		el.removeAttribute('data-vsk');
	}

	// Hydrate viewport batch first
	const viewportWalker = createHydrateWalker(container, viewportEls);
	componentFn(props, new Map(), viewportWalker);

	// When deferred elements scroll into view, hydrate them
	if (deferredEls.length > 0) {
		return new Promise((resolve) => {
			const observer = new IntersectionObserver((entries) => {
				const toHydrate = [];
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const el = entry.target;
						const held = el.dataset.vskHold;
						if (held !== undefined) {
							el.setAttribute('data-vsk', held);
							delete el.dataset.vskHold;
							toHydrate.push(el);
						}
						observer.unobserve(el);
					}
				}
				if (toHydrate.length > 0) {
					const w = createHydrateWalker(container, toHydrate);
					componentFn(props, new Map(), w);
				}
				if (observer._observed === 0) {
					observer.disconnect();
					resolve();
				}
			}, { rootMargin: `${rootMargin}px` });

			observer._observed = deferredEls.length;
			for (const el of deferredEls) {
				observer.observe(el);
			}
		});
	}

	return Promise.resolve();
}

/**
 * Idle-time hydration — hydrates all elements using requestIdleCallback
 * for progressive loading. Processes elements in chunks, creating fresh
 * DOM for each chunk via createElement (since SSR DOM is already present).
 */
function hydrateIdle(container, componentFn, props, options = {}) {
	const allElements = Array.from(container.querySelectorAll('[data-vsk]'));
	const chunkSize = options.chunkSize || 10;
	const timeout = options.timeout || 3000;
	let idx = 0;

	const rIC = window.requestIdleCallback || ((cb) => setTimeout(cb, 50));
	const cIC = window.cancelIdleCallback || clearTimeout;

	let rafId = null;
	let cancelled = false;

	function processChunk(deadline) {
		if (cancelled) return;
		const end = Math.min(idx + chunkSize, allElements.length);
		const chunk = allElements.slice(idx, end);
		idx = end;

		if (chunk.length > 0) {
			const walker = createHydrateWalker(container, chunk);
			componentFn(props, new Map(), walker);
		}

		if (idx < allElements.length && (!deadline || deadline.timeRemaining() > 0 || deadline.didTimeout)) {
			rafId = rIC(processChunk, { timeout });
		}
	}

	rafId = rIC(processChunk, { timeout });

	return {
		cancel() {
			cancelled = true;
			if (rafId !== null) {
				cIC(rafId);
				rafId = null;
			}
		},
	};
}

/**
 * Check if there are remaining hydration markers in the DOM.
 */
function needsHydration(container) {
	return container.querySelector('[data-vsk]') !== null;
}

/**
 * Count remaining hydration markers.
 */
function hydrationCount(container) {
	return container.querySelectorAll('[data-vsk]').length;
}

// --- resource.js ---

/**
 * Pre-fetched SSR data store.
 * Populated server-side via useFetch / createResource.
 * On client hydration, resources read from here first to avoid re-fetching.
 */
function getSsrData(key) {
	const store = globalThis.__vesk_ssr_data;
	if (!store) return undefined;
	return store[key];
}

function setSsrData(key, value) {
	if (!globalThis.__vesk_ssr_data) globalThis.__vesk_ssr_data = {};
	globalThis.__vesk_ssr_data[key] = value;
}

function clearSsrData() {
	delete globalThis.__vesk_ssr_data;
}

/**
 * useFetch — auto-imported reactive data fetcher.
 *
 * No import needed in .vsk files — the compiler injects it automatically.
 *
 * Usage:
 *   const posts = useFetch('/api/posts');
 *   const post  = useFetch(() => fetch(`/api/posts/${id}`).then(r => r.json()));
 *   const data  = useFetch('/api/data', { parse: (r) => r.text() });
 *
 * Returns a reactive object:
 *   .data     — resolved data (reactive, safe to use in template)
 *   .loading  — boolean, true while fetching
 *   .error    — error object if fetch failed
 *   .refresh() — re-fetch the same URL/fn
 *
 * SSR: fetches during render, data serialized into HTML automatically.
 * Hydration: reads pre-serialized data, no re-fetch on mount.
 */
function useFetch(urlOrFn, options = {}) {
	const fetcher = typeof urlOrFn === 'function'
		? urlOrFn
		: () => {
			const url = typeof urlOrFn === 'string' ? urlOrFn : String(urlOrFn);
			return fetch(url).then(r => {
				if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
				return options.parse ? options.parse(r) : r.json();
			});
		};

	const resource = createResource(fetcher, options.key || (typeof urlOrFn === 'string' ? urlOrFn : undefined));
	resource.refresh = () => {
		fetcher().then(
			data => { const s = resource._state; if (s) set(s, { loading: false, error: null, data }); },
			error => { const s = resource._state; if (s) set(s, { loading: false, error, data: undefined }); }
		);
	};
	return resource;
}

/** @param {string} url */
useFetch.text = (url, options) => useFetch(url, { ...options, parse: r => r.text() });
/** @param {string} url */
useFetch.json = (url, options) => useFetch(url, { ...options, parse: r => r.json() });
/** @param {string} url */
useFetch.arrayBuffer = (url, options) => useFetch(url, { ...options, parse: r => r.arrayBuffer() });

/**
 * Create a reactive async resource (data fetcher).
 *
 * Usage:
 *   const data = createResource(() => fetch('/api/items').then(r => r.json()));
 *   {#if data.loading}
 *     <p>Loading...</p>
 *   {:else}
 *     {data().map(item => <li>{item.name}</li>)}
 *   {/if}
 *
 * During SSR, if the fetcher key matches pre-fetched data from the server,
 * the resource resolves immediately. Otherwise it fires the async function.
 *
 * @param {Function} fn - async function that returns the data
 * @param {string} [key] - optional key for SSR data hydration
 * @returns {Function & { loading: boolean, error: any }}
 */
function createResource(fn, key) {
  const state = tracked({ loading: true, error: null, data: undefined });
  const resourceKey = key || (fn._ssrKey || fn.toString().slice(0, 64));

  // Check for pre-fetched SSR data (hydration path)
  const ssrData = getSsrData(resourceKey);
  if (ssrData !== undefined) {
    set(state, { loading: false, error: null, data: ssrData });
    return createResourceAccessor(state);
  }

  // Track in SSR mode for server-side collection
  if (globalThis.__vsk_ssr) {
    if (!globalThis.__vsk_ssr_promises) globalThis.__vsk_ssr_promises = [];
    const prom = fn().then(
      data => {
        // Store resolved data for serialization
        if (!globalThis.__vsk_ssr_data) globalThis.__vsk_ssr_data = {};
        globalThis.__vsk_ssr_data[resourceKey] = data;
        set(state, { loading: false, error: null, data });
        return data;
      },
      error => {
        set(state, { loading: false, error, data: undefined });
        throw error;
      }
    );
    globalThis.__vsk_ssr_promises.push(prom);
  } else {
    // Normal client-side behavior: fire immediately
    fn().then(
      data => set(state, { loading: false, error: null, data }),
      error => set(state, { loading: false, error, data: undefined })
    );
  }

  return createResourceAccessor(state);
}

function createResourceAccessor(state) {
  function resource() {
    return get(state).data;
  }
  Object.defineProperty(resource, 'loading', {
    get() { return get(state).loading; }
  });
  Object.defineProperty(resource, 'error', {
    get() { return get(state).error; }
  });
  resource._state = state;
  return resource;
}

/**
 * SSR data resolver — awaits all pending resource promises and returns
 * the collected data map. Used by the SSR pipeline after component render
 * to collect and serialize fetched data into the HTML.
 *
 * @returns {Promise<Record<string, any>>}
 */
async function resolveSsrResources() {
  const promises = globalThis.__vsk_ssr_promises || [];
  if (promises.length === 0) return {};
  // Wait for all to settle
  await Promise.allSettled(promises);
  const data = globalThis.__vsk_ssr_data || {};
  delete globalThis.__vsk_ssr_promises;
  return data;
}

// --- reconcile.js ---

function reconcile(anchor, endAnchor, items, keyFn, createItem) {
  const parent = anchor.parentNode;
  const map = new Map();

  for (const item of items) {
    const key = keyFn(item);
    const marker = document.createComment('k:' + key);
    const effs = [];
    parent.insertBefore(marker, endAnchor);
    createItem(item, effs);
    map.set(key, { marker, effs });
  }

  return (newItems) => {
    const newKeys = newItems.map(keyFn);
    const newSet = new Set(newKeys);

    for (const [key, { marker, effs }] of map) {
      if (!newSet.has(key)) {
        removeRange(marker, endAnchor);
        marker.remove();
        for (const e of effs) destroy_block(e);
        map.delete(key);
      }
    }

    let ref = endAnchor;
    for (let i = newKeys.length - 1; i >= 0; i--) {
      const key = newKeys[i];
      let entry = map.get(key);
      if (entry) {
        if (entry.marker.nextSibling !== ref) {
          moveBefore(entry.marker, endAnchor, ref);
        }
        ref = entry.marker;
      } else {
        const marker = document.createComment('k:' + key);
        const effs = [];
        parent.insertBefore(marker, ref);
        createItem(newItems[i], effs);
        map.set(key, { marker, effs });
        ref = marker;
      }
    }
  };
}

function removeRange(start, end) {
  let n = start.nextSibling;
  while (n && n !== end && !(n.nodeType === 8 && n.nodeValue && n.nodeValue.startsWith('k:'))) {
    const next = n.nextSibling;
    n.remove();
    n = next;
  }
}

function moveBefore(marker, endAnchor, ref) {
  const nodes = [];
  let n = marker.nextSibling;
  while (n && n !== endAnchor && !(n.nodeType === 8 && n.nodeValue && n.nodeValue.startsWith('k:'))) {
    nodes.push(n);
    n = n.nextSibling;
  }
  const parent = marker.parentNode;
  parent.insertBefore(marker, ref);
  for (const node of nodes) parent.insertBefore(node, ref);
}

// --- bindings.js ---
/**
 * Vesk Bindings — Two-way data binding via {ref} attribute
 * Updated to use Ripple's get()/set() API
 */


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
function bindValue(maybe_tracked, set_func = undefined) {
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
function bindChecked(maybe_tracked, set_func = undefined) {
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
function bindGroup(maybe_tracked, set_func = undefined) {
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

// --- router.js ---

// ── Redirect — throws a redirect that SSR can catch ───────────

class Redirect extends Error {
	constructor(url, status = 302) {
		super(`Redirect to ${url}`);
		this.url = url;
		this.status = status;
		this.name = 'Redirect';
	}
}

function redirect(url, status = 302) {
	throw new Redirect(url, status);
}

/** 308 Permanent Redirect */
function permanentRedirect(url) {
	throw new Redirect(url, 308);
}

// ── NotFound — triggers a 404 response ──────────────────────────

class NotFoundError extends Error {
	constructor(msg = 'Not Found') {
		super(msg);
		this.name = 'NotFoundError';
	}
}

/** Trigger a 404 — caught by dev server or API route executor */
function notFound() {
	throw new NotFoundError();
}

// ── Router Context ──────────────────────────────────────────────

const RouterCtx = createContext(null);

let _currentRouter = null;
let _outletId = 0;

// ── Outlet Component ───────────────────────────────────────────

function Outlet(props) {
	const router = RouterCtx.get();
	if (!router) return document.createComment('outlet');
	const div = document.createElement('div');
	div.setAttribute('data-vesk-outlet', String(_outletId++));
	div.style.display = 'contents';
	if (router._outletPlaceholders) {
		router._outletPlaceholders.push(div);
	}
	const seg = router._currentSegments && router._currentSegments[router._depth];
	if (seg && seg.rendered) {
		div.appendChild(seg.rendered);
	}
	return div;
}

// ── Link Component ──────────────────────────────────────────────

function Link(props, registry, hydrate) {
	const href = props.href || '#';
	if (hydrate && hydrate.nextElement && !hydrate.done) {
		const a = hydrate.nextElement('a');
		if (props.children != null) {
			if (typeof props.children === 'string' || typeof props.children === 'number') {
				a.textContent = String(props.children);
			} else if (props.children.textContent) {
				a.textContent = props.children.textContent;
			}
		}
		a.addEventListener('click', (e) => {
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
			if (props.target === '_blank') return;
			e.preventDefault();
			const nav = useNavigate();
			nav(href);
		});
		return document.createDocumentFragment();
	}
	const attrs = [
		`href="${href.replace(/"/g, '&quot;')}"`,
		props.class ? `class="${String(props.class).replace(/"/g, '&quot;')}"` : '',
		props.style ? `style="${String(props.style).replace(/"/g, '&quot;')}"` : '',
		props.target ? `target="${String(props.target).replace(/"/g, '&quot;')}"` : '',
		props.rel ? `rel="${String(props.rel).replace(/"/g, '&quot;')}"` : '',
	].filter(Boolean).join(' ');
	let childStr = '';
	if (props.children != null) {
		childStr = typeof props.children === 'string' ? props.children
			: typeof props.children === 'number' ? String(props.children)
			: '';
	}
	if (typeof document === 'undefined') {
		return `<a ${attrs}>${childStr}</a>`;
	}
	const a = document.createElement('a');
	a.href = href;
	if (props.class) a.className = props.class;
	if (props.style) a.setAttribute('style', props.style);
	if (props.target) a.target = props.target;
	if (props.rel) a.rel = props.rel;
	if (childStr) {
		a.textContent = childStr;
	} else if (props.children != null) {
		if (props.children.nodeType) {
			a.appendChild(props.children);
		} else if (Array.isArray(props.children)) {
			for (const c of props.children) {
				if (c && c.nodeType) a.appendChild(c);
				else if (c != null) a.appendChild(document.createTextNode(String(c)));
			}
		}
	}
	a.addEventListener('click', (e) => {
		if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
		if (props.target === '_blank') return;
		e.preventDefault();
		const nav = useNavigate();
		nav(href);
	});
	return a;
}

// ── NavLink Component ───────────────────────────────────────────

function NavLink(props, registry, hydrate) {
	if (typeof document === 'undefined') {
		return Link(props, registry, hydrate);
	}
	if (__isHydrating) {
		// Hydration mode — claim existing <a> elements by href
		const a = document.querySelector(`a[href="${props.href}"]`);
		if (a) {
			if (props.children != null) {
				if (typeof props.children === 'string' || typeof props.children === 'number') {
					a.textContent = String(props.children);
				} else if (props.children.textContent) {
					a.textContent = props.children.textContent;
				}
			}
			a.addEventListener('click', (e) => {
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				if (props.target === '_blank') return;
				e.preventDefault();
				const nav = useNavigate();
				nav(props.href);
			});
			const path = usePathname();
			const isActive = props.href === path || (props.href !== '/' && path.startsWith(props.href) && (path.length === props.href.length || path[props.href.length] === '/' || path[props.href.length] === '?'));
			if (isActive) {
				a.classList.add(props.activeClass || 'active');
				if (props.ariaCurrent !== false) a.setAttribute('aria-current', 'page');
			}
			return document.createDocumentFragment();
		}
	}
	const a = Link(props, registry, hydrate);
	const path = usePathname();
		const isActive = props.href === path || (props.href !== '/' && path.startsWith(props.href) && (path.length === props.href.length || path[props.href.length] === '/' || path[props.href.length] === '?'));
	if (isActive) {
		a.classList.add(props.activeClass || 'active');
		if (props.ariaCurrent !== false) a.setAttribute('aria-current', 'page');
	}
	return a;
}

// ── Hooks ──────────────────────────────────────────────────────

/** Set to true during initial hydration to signal components to claim SSR elements */
let __isHydrating = false;

const _state = {
	path: track('/'),
	params: track({}),
	search: track(''),
};

function useNavigate() {
	const router = RouterCtx.get() || _currentRouter;
	return (path, opts = {}) => {
		if (router && router.navigate) {
			router.navigate(path, opts);
		} else {
			window.history.pushState({}, '', path);
			_state.path.value = path;
		}
	};
}

function useParams() {
	return get(_state.params);
}

function usePathname() {
	return get(_state.path);
}

function useSearchParams() {
	const s = get(_state.search);
	const sp = new URLSearchParams(s || '');
	const setter = (next) => {
		const q = typeof next === 'string' ? next : new URLSearchParams(next).toString();
		_state.search.value = q;
		const nav = useNavigate();
		const path = get(_state.path);
		nav(path + (q ? '?' + q : ''), { replace: true });
	};
	return [sp, setter];
}

function useRouter() {
	const router = RouterCtx.get() || _currentRouter;
	return {
		push: (href) => router?.navigate?.(href),
		replace: (href) => router?.navigate?.(href, { replace: true }),
		back: () => window.history.back(),
		forward: () => window.history.forward(),
		refresh: () => router?.navigate?.(window.location.pathname, { replace: true }),
	};
}

// ── Route Tree Types ───────────────────────────────────────────

/*
 * RouteNode:
 *   path: string           // URL segment ('' for root, ':param' for dynamic, '*' for catch-all)
 *   fullPath: string       // Full URL pattern
 *   isGroup: boolean       // Route group (no URL segment)
 *   isDynamic: boolean     // [param] segment
 *   isCatchAll: boolean    // [...param] segment
 *   page: Function|null    // Page component
 *   layout: Function|null  // Layout component
 *   children: RouteNode[]
 *   layouts: RouteNode[]   // Flattened layout chain for this route
 */

function compileRoutePattern(fullPath) {
	const paramNames = [];
	const parts = fullPath.split('/').filter(Boolean);
	let regexStr = '^';
	for (const part of parts) {
		if (part.startsWith(':')) {
			const name = part.slice(1);
			paramNames.push(name);
			regexStr += '/([^/]+)';
		} else if (part === '*') {
			regexStr += '(?:/(.*))?';
		} else {
			regexStr += '/' + part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	regexStr += '$';
	return { regex: new RegExp(regexStr), paramNames };
}

function collectLayouts(nodes, pathParts) {
	const layouts = [];
	for (const node of nodes) {
		if (node.isGroup) {
			const childLayouts = collectLayouts(node.children, pathParts);
			layouts.push(...childLayouts);
			continue;
		}
		if (node.layout) {
			layouts.push({ layout: node.layout, node });
		}
		const len = pathParts.length;
		const matched = matchRouteNode(node, pathParts);
		if (matched) {
			const remaining = pathParts.slice(node.segmentCount != null ? node.segmentCount : 1);
			if (remaining.length > 0 && node.children.length > 0) {
				const childLayouts = collectLayouts(node.children, remaining);
				layouts.push(...childLayouts);
			}
		}
	}
	return layouts;
}

function matchRouteNode(node, pathParts) {
	if (node.isGroup) return false;
	if (pathParts.length === 0) return node.fullPath === '/';
	const part = pathParts[0];
	if (node.isCatchAll) return true;
	if (node.isDynamic) return true;
	return node.path === part;
}

function extractParams(node, pathParts) {
	const params = {};
	let idx = 0;
	for (const node of node._matchChain || []) {
		if (node.isDynamic && pathParts[idx]) {
			const name = node.path.slice(1); // remove ':'
			params[name] = decodeURIComponent(pathParts[idx]);
		} else if (node.isCatchAll) {
			const name = node.path.slice(1); // remove ':'
			params[name] = pathParts.slice(idx).map(decodeURIComponent).join('/');
		}
		if (!node.isGroup) idx++;
	}
	return params;
}

// ── Route Tree Matching ────────────────────────────────────────

function flattenLayoutChain(tree, pathParts, result = []) {
	for (let i = 0; i < tree.length; i++) {
		const node = tree[i];
		if (node.isGroup) {
			flattenLayoutChain(node.children, pathParts, result);
			continue;
		}

		const part = pathParts[0];
		const segCount = node.segmentCount != null ? node.segmentCount : 1;

		// Check if this node matches the current path segment
		let matched = false;
		if (node.fullPath === '/') {
			// Root node always matches as a layout prefix
			matched = true;
		} else if (node.isCatchAll) {
			matched = true;
		} else if (node.isDynamic) {
			matched = part !== undefined;
		} else {
			matched = node.path === part;
		}

		if (matched) {
			const consumeCount = node.isCatchAll ? pathParts.length : segCount;
			const remaining = pathParts.slice(consumeCount);
			const isLeaf = remaining.length === 0 || remaining.every(p => p === '');
			if (isLeaf && node.page && node.layout) {
				// Node serves as both layout and page — push once for layout
				// renderMatch will also render its page component
				result.push(node);
				break;
			} else if (node.layout) {
				result.push(node);
			}
			if (isLeaf) {
				if (node.page) result.push(node);
				break;
			} else if (node.children.length > 0) {
				flattenLayoutChain(node.children, remaining, result);
				break;
			}
		}
	}
	return result;
}

// ── Router Implementation ──────────────────────────────────────

function matchRoute(tree, pathname) {
	const pathParts = pathname.split('/').filter(Boolean);
	const matchChain = flattenLayoutChain(tree, pathParts);
	if (matchChain.length === 0) return null;

	// Extract params by walking the match chain alongside path parts
	const params = {};
	let partIdx = 0;
	for (const node of matchChain) {
		const segCount = node.segmentCount != null ? node.segmentCount : 1;
		if (node.isDynamic && !node.isCatchAll) {
			const name = node.path.startsWith(':') ? node.path.slice(1) : node.path;
			if (partIdx < pathParts.length) {
				params[name] = decodeURIComponent(pathParts[partIdx]);
			}
		}
		if (node.isCatchAll) {
			const name = node.path.startsWith(':') ? node.path.slice(1) : node.path;
			params[name] = pathParts.slice(partIdx).map(decodeURIComponent).join('/');
		}
		partIdx += segCount;
	}

	return { matchChain, params };
}

function renderMatch(router, match, container) {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}

	if (!pageNode) {
		if (container.replaceChildren) {
			container.replaceChildren();
		} else {
			container.innerHTML = '';
		}
		container.innerHTML = '<h1>404 — Not Found</h1>';
		return;
	}

	const layoutNodes = chain.filter(n => n.layout);
	const tempRoot = document.createDocumentFragment();
	const clientWalker = createHydrateWalker(tempRoot, []);

	function renderLayoutChain(index) {
		if (index >= layoutNodes.length) {
			_state.params.value = paramValues;
			_state.path.value = match.pathname || window.location.pathname;
			_state.search.value = window.location.search || '';
			const pageProps = { params: paramValues, ...pageNode.props };
			return pageNode.page(pageProps, new Map(), clientWalker);
		}
		const node = layoutNodes[index];
		const childDom = renderLayoutChain(index + 1);
		const layoutProps = { children: childDom, params: paramValues };
		return node.layout(layoutProps, new Map(), clientWalker);
	}

	let rootDom;
	root(() => {
		rootDom = renderLayoutChain(0);
	});

	if (rootDom && typeof rootDom === 'object' && rootDom.nodeType) {
		if (container.replaceChildren) {
			container.replaceChildren(rootDom);
		} else {
			container.innerHTML = '';
			container.appendChild(rootDom);
		}
	} else if (typeof rootDom === 'string') {
		container.innerHTML = rootDom;
	}
}

/**
 * Hydrate initial SSR content — claims existing DOM nodes instead of re-rendering.
 * Uses tree-structured walker scoped to each component's parent element.
 * Each component claims elements from its parent's children by tag matching.
 * Child components (via slot) receive a sub-walker scoped to the parent element.
 * This ensures zero DOM mutations for the initial load.
 */
function hydrateInitial(router, match, container) {
	const chain = match.matchChain;
	const paramValues = match.params;

	let pageNode = null;
	for (let i = chain.length - 1; i >= 0; i--) {
		if (chain[i].page) { pageNode = chain[i]; break; }
	}
	if (!pageNode) {
		container.innerHTML = '<h1>404 — Not Found</h1>';
		return;
	}

	const layoutNodes = chain.filter(n => n.layout);

	_state.params.value = paramValues;
	_state.path.value = match.pathname || window.location.pathname;
	_state.search.value = window.location.search || '';

	const allElements = Array.from(container.querySelectorAll('[data-vsk]'));
	const walker = createHydrateWalker(container, allElements);

	// Use hydrator versions of component functions
	const hydrators = router.__hydrators;
	const hydPage = hydrators && pageNode._pageName
		? (hydrators[pageNode._pageName] || pageNode.page)
		: pageNode.page;
	const hydLayouts = layoutNodes.map(n => {
		if (hydrators && n._layoutName) {
			return hydrators[n._layoutName] || n.layout;
		}
		return n.layout;
	});

	if (layoutNodes.length === 0) {
		__isHydrating = true;
		root(() => {
			hydPage({ params: paramValues, ...pageNode.props }, new Map(), walker);
		});
		__isHydrating = false;
		return;
	}

	__isHydrating = true;

	function renderLayoutChain(index) {
		if (index >= layoutNodes.length) {
			return (subWalker) => {
				hydPage({ params: paramValues, ...pageNode.props }, new Map(), subWalker);
			};
		}
		const node = layoutNodes[index];
		const hydLayout = hydLayouts[index];
		const childHydrator = renderLayoutChain(index + 1);
		const layoutProps = { children: childHydrator, params: paramValues };
		hydLayout(layoutProps, new Map(), walker);
		return null;
	}

	root(() => {
		renderLayoutChain(0);
	});

	__isHydrating = false;
}

// ── Create Router (Manual) ─────────────────────────────────────

function createRouter(
	routes,
	options = {}
) {
	const container = options.container || document.getElementById('root');
	const prefetch = options.prefetch !== false;

	// Build route tree from flat route map
	const routeTree = buildTreeFromMap(routes, options);

	const router = {
		routeTree,
		container,
		_currentMatch: null,
		_outletPlaceholders: [],
		_currentSegments: null,
		_depth: 0,

		start() {
			_currentRouter = this;
			// Set up click delegation
			document.addEventListener('click', (e) => {
				const link = e.target.closest('a[href]');
				if (!link) return;
				if (link.hostname && link.hostname !== window.location.hostname) return;
				const href = link.getAttribute('href');
				if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				e.preventDefault();
				this.navigate(href);
			});

			window.addEventListener('popstate', () => {
				this.navigate(window.location.href, { replace: true });
			});

			if (prefetch) {
				document.addEventListener('mouseenter', (e) => {
					const link = e.target.closest('a[href]');
					if (link) this.prefetch(link.getAttribute('href'));
				}, { passive: true });
			}

			// Render initial route — hydrate if SSR content exists
			const path = window.location.pathname + window.location.search;
			if (container.children.length > 0) {
				const url = new URL(path, window.location.origin);
				const match = matchRoute(this.routeTree, url.pathname);
				if (match) {
					match.pathname = url.pathname;
					hydrateInitial(this, match, container);
					this._currentMatch = match;
				} else {
					this.navigate(path, { replace: true });
				}
			} else {
				this.navigate(path, { replace: true });
			}

			return this;
		},

		async navigate(path, opts = {}) {
			const url = new URL(path, window.location.origin);
			const match = matchRoute(this.routeTree, url.pathname);

			if (!match) {
				window.location.href = path;
				return;
			}

			match.pathname = url.pathname;

			if (!opts.replace) {
				window.history.pushState({ path: url.pathname }, '', url.pathname);
			} else {
				window.history.replaceState({ path: url.pathname }, '', url.pathname);
			}

			_state.path.value = url.pathname;
			_state.search.value = url.search;

			renderMatch(this, match, this.container);
			this._currentMatch = match;
		},

		prefetch(path) {
			// For manual routes, could preload lazy components
		},

		get currentPath() {
			return get(_state.path);
		},

		hmrUpdate() {
			const updated = globalThis.__updatedComponents;
			if (!updated || updated.size === 0) return;
			globalThis.__updatedComponents = new Set();
			if (typeof this.__updateComponents === 'function') {
				this.__updateComponents(this.routeTree);
			}
			const path = window.location.pathname + window.location.search;
			this.navigate(path, { replace: true });
		},
	};

	return router;
}

function buildTreeFromMap(routes) {
	const root = [];
	for (const [pattern, loader] of Object.entries(routes)) {
		const parts = pattern.split('/').filter(Boolean);
		const isDynamic = parts.some(p => p.startsWith(':'));
		const isCatchAll = parts.some(p => p.startsWith('...'));
		const node = {
			path: parts[parts.length - 1] || '',
			fullPath: pattern,
			isGroup: false,
			isDynamic,
			isCatchAll,
			page: loader,
			layout: null,
			children: [],
			segmentCount: parts.length || 1,
			loader,
		};
		root.push(node);
	}
	return root;
}

// ── Create File Router ─────────────────────────────────────────

function createFileRouter(routeTree, options = {}) {
	const container = options.container || document.getElementById('root');
	const middleware = options.middleware || null;
	const renderFn = options.render || renderMatch;

	const router = {
		routeTree,
		container,
		_currentMatch: null,
		_outletPlaceholders: [],
		_currentSegments: null,
		_depth: 0,

		start() {
			_currentRouter = this;
			document.addEventListener('click', (e) => {
				if (e.defaultPrevented) return;
				const link = e.target.closest('a[href]');
				if (!link) return;
				if (link.hostname && link.hostname !== window.location.hostname) return;
				const href = link.getAttribute('href');
				if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
				e.preventDefault();
				router.navigate(href);
			});
			window.addEventListener('popstate', () => {
				router.navigate(window.location.pathname + window.location.search, { replace: true });
			});

			const path = window.location.pathname;
			if (container.children.length > 0) {
				const match = matchRoute(routeTree, path);
				if (match) {
					match.pathname = path;
					hydrateInitial(router, match, container);
					router._currentMatch = match;
				} else {
					router.navigate(path, { replace: true });
				}
			} else {
				router.navigate(path, { replace: true });
			}
			return router;
		},

		navigate(pathname, opts = {}) {
			const url = pathname instanceof URL ? pathname : new URL(pathname, window.location.origin);
			const match = matchRoute(routeTree, url.pathname);
			if (!match) {
				container.innerHTML = '<h1>404 — Not Found</h1>';
				return;
			}

			match.pathname = url.pathname;

			// Run middleware chain (onion model)
			const middlewareFns = Array.isArray(middleware) ? middleware : (middleware ? [middleware] : []);

			async function runMwChain(index) {
				if (index >= middlewareFns.length) {
					// All middleware passed — render
					const fullUrl = url.pathname + url.search;
					if (!opts.replace) {
						window.history.pushState({ path: fullUrl }, '', fullUrl);
					} else {
						window.history.replaceState({ path: fullUrl }, '', fullUrl);
					}
					_state.path.value = url.pathname;
					_state.search.value = url.search;
					renderFn(router, match, container);
					router._currentMatch = match;
					return;
				}

				const fn = middlewareFns[index];
				const ctx = { url: url.pathname, params: match.params, router, locals: {} };

				async function next(rewrite) {
					if (rewrite) {
						match.pathname = rewrite;
						url.pathname = rewrite;
					}
					return runMwChain(index + 1);
				}

				try {
					const result = await fn(ctx, next);
					if (result && result.redirect) {
						router.navigate(result.redirect, { replace: true });
						return;
					}
				} catch (e) {
					if (e && e.name === 'Redirect') {
						router.navigate(e.url, { replace: true });
						return;
					}
				}
			}

			if (middlewareFns.length > 0) {
				runMwChain(0);
			} else {
				if (!opts.replace) {
					window.history.pushState({ path: url.pathname }, '', url.pathname);
				} else {
					window.history.replaceState({ path: url.pathname }, '', url.pathname);
				}
				_state.path.value = url.pathname;
				_state.search.value = url.search;
				renderFn(router, match, container);
				router._currentMatch = match;
			}
		},

		get currentPath() {
			return get(_state.path);
		},

		hmrUpdate() {
			const updated = globalThis.__updatedComponents;
			if (!updated || updated.size === 0) return;
			globalThis.__updatedComponents = new Set();
			if (typeof this.__updateComponents === 'function') {
				this.__updateComponents(this.routeTree);
			}
			const path = window.location.pathname + window.location.search;
			this.navigate(path, { replace: true });
		},
	};

	return router;
}

// ── Route Tree Builder (for compiler output) ───────────────────

function defineRoute(path, config) {
	return { path, ...config };
}

function buildRouteTree(definitions) {
	const tree = [];
	for (const def of definitions) {
		const parts = def.path.split('/').filter(Boolean);
		const isDynamic = parts.some(p => p.startsWith(':'));
		const isCatchAll = parts.some(p => p === '*');

		const node = {
			path: parts[parts.length - 1] || '',
			fullPath: def.path,
			isGroup: false,
			isDynamic,
			isCatchAll,
			page: def.page || null,
			layout: def.layout || null,
			children: (def.children || []).map(c => {
				const cParts = c.path.split('/').filter(Boolean);
				return {
					...c,
					path: cParts[cParts.length - 1] || '',
					fullPath: (def.path + (c.path ? '/' + c.path : '')).replace(/\/+/g, '/'),
					isDynamic: cParts.some(p => p.startsWith(':')),
					isCatchAll: cParts.some(p => p === '*'),
					isGroup: false,
					segmentCount: Math.max(1, cParts.length),
					children: [],
				};
			}),
			segmentCount: Math.max(1, parts.length),
		};
		tree.push(node);
	}
	return tree;
}

// --- request.js ---
/**
 * Vesk request hooks — cookies(), headers(), useBody(), useParams(), cors(),
 * lifecycle hooks (defineHook/runHooks), and webhook handler factory.
 *
 * SSR: reads from globalThis.__vesk_request (set by dev server before renderPage)
 * API: reads from globalThis.__vesk_request (set by executeApiRoute)
 * Client: cookies() reads document.cookie, headers() returns empty
 */

function getRequest() {
	return globalThis.__vesk_request || null;
}

// ── Lifecycle Hook Registry ────────────────────────────────────

function getHooks() {
	if (!globalThis.__vesk_hooks) globalThis.__vesk_hooks = {};
	return globalThis.__vesk_hooks;
}

/**
 * Register a lifecycle hook function.
 *
 * Built-in hook names:
 *   'beforeRequest'  — runs before the handler, receives (request, context)
 *                       context = { params, locals }
 *                       return a Response to short-circuit
 *   'afterRequest'   — runs after the handler, receives (request, response)
 *                       return a Response to replace the response
 *   'onError'        — runs when the handler throws, receives (error, request)
 *                       return a Response to send instead of the default 500
 *
 * Custom names are also allowed for user-defined hook systems.
 *
 * @param {string} name
 * @param {Function} fn
 */
function defineHook(name, fn) {
	const hooks = getHooks();
	if (!hooks[name]) hooks[name] = [];
	hooks[name].push(fn);
}

/**
 * Remove a previously registered hook.
 * @param {string} name
 * @param {Function} fn
 */
function removeHook(name, fn) {
	const hooks = getHooks();
	if (!hooks[name]) return;
	hooks[name] = hooks[name].filter(h => h !== fn);
}

/**
 * Run all hooks registered for a given lifecycle event.
 * Each hook runs in sequence. If a hook returns a Response,
 * subsequent hooks are skipped and the Response is returned.
 *
 * @param {string} name
 * @param {...any} args
 * @returns {Promise<Response|undefined>}
 */
async function runHooks(name, ...args) {
	const hooks = getHooks()[name] || [];
	for (const fn of hooks) {
		const result = await fn(...args);
		if (result instanceof Response) return result;
	}
}

// ── Composable Request Hooks ──────────────────────────────────

/**
 * Get the current request's matching parameters.
 *
 * In API routes, this returns the dynamic route params resolved
 * from the URL path (e.g., { id: '42' } for /api/users/42).
 *
 * Must be called within a request context (API handler or SSR render).
 *
 * @returns {Record<string,string>}
 */
function useParams() {
	const ctx = getRequest();
	return ctx?.params || {};
}

/**
 * Get the current request context object.
 *
 * Returns:
 *   { headers, url, method, cookies, locals, params }
 *
 * @returns {object|null}
 */
function useRequest() {
	return getRequest();
}

/**
 * Parse and cache the request body.
 *
 * Automatically detects content type. Returns the parsed JSON object
 * for application/json, a string for text/plain, or a plain object
 * for application/x-www-form-urlencoded.
 *
 * Caches the result so it can be safely called multiple times.
 *
 * @returns {Promise<unknown|null>}
 */
async function useBody() {
	const ctx = getRequest();
	if (!ctx) throw new Error('useBody() called outside request context');
	if (ctx._parsedBody !== undefined) return ctx._parsedBody;

	const req = ctx._request;
	if (!req) return null;

	const ct = (req.headers.get && req.headers.get('content-type')) || '';
	try {
		if (ct.includes('json')) {
			ctx._parsedBody = await req.json();
		} else if (ct.includes('x-www-form-urlencoded')) {
			const text = await req.text();
			const obj = {};
			for (const pair of text.split('&')) {
				const [k, v] = pair.split('=').map(s => decodeURIComponent(s || ''));
				if (k) obj[k] = v;
			}
			ctx._parsedBody = obj;
		} else {
			ctx._parsedBody = await req.text();
		}
	} catch {
		ctx._parsedBody = null;
	}
	return ctx._parsedBody;
}

// ── CORS Middleware ────────────────────────────────────────────

/**
 * Create a CORS middleware.
 *
 * Usage in a route module:
 *   import { cors } from '@vesk/runtime';
 *   export const beforeRequest = [cors()];
 *
 * Or use it standalone:
 *   const c = cors({ origin: 'https://app.com' });
 *   const result = c(request);
 *   if (result instanceof Response) return result;
 *
 * @param {object} [options]
 * @param {string} [options.origin='*']
 * @param {string} [options.methods='GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS']
 * @param {string} [options.allowedHeaders='Content-Type, Authorization']
 * @param {boolean} [options.credentials=true]
 * @param {number} [options.maxAge=86400]
 * @param {string[]} [options.exposeHeaders]
 * @returns {Function} middleware that returns Response (for OPTIONS) or undefined
 */
function cors(options = {}) {
	const {
		origin = '*',
		methods = 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
		allowedHeaders = 'Content-Type, Authorization',
		credentials = true,
		maxAge = 86400,
		exposeHeaders,
	} = options;

	const corsHeaders = {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': methods,
		'Access-Control-Allow-Headers': allowedHeaders,
		'Access-Control-Max-Age': String(maxAge),
	};
	if (credentials) corsHeaders['Access-Control-Allow-Credentials'] = 'true';
	if (exposeHeaders?.length) corsHeaders['Access-Control-Expose-Headers'] = exposeHeaders.join(', ');

	/**
	 * Apply CORS headers to an existing Response.
	 * @param {Response} response
	 * @returns {Response}
	 */
	function applyCors(response) {
		const headers = new Headers(response.headers);
		for (const [k, v] of Object.entries(corsHeaders)) {
			headers.set(k, v);
		}
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}

	/**
	 * CORS middleware function.
	 * - For OPTIONS requests: returns a 204 with CORS headers (preflight).
	 * - For other methods: attaches a `_corsHeaders` property so the
	 *   afterRequest hook can apply them.
	 *
	 * @param {Request} request
	 * @returns {Response|undefined}
	 */
	function middleware(request) {
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}
		// Tag the response pipeline to add CORS headers later
		middleware._pending = corsHeaders;
	}

	middleware.applyCors = applyCors;
	middleware._corsHeaders = corsHeaders;

	return middleware;
}

// ── Webhook Handler Factory ─────────────────────────────────────

/**
 * Create a webhook handler that verifies payload signatures.
 *
 * Usage in a route module:
 *   import { webhook } from '@vesk/runtime';
 *
 *   export const POST = webhook({
 *     secret: process.env.STRIPE_SECRET,
 *     handler: async (event, request) => {
 *       return ServerResponse.json({ received: true });
 *     },
 *   });
 *
 * Supports:
 *   - HMAC-SHA256 signature verification (SHA256= / sha256= prefix)
 *   - Raw body reading for signature computation
 *   - Configurable header name (default: x-webhook-signature)
 *
 * @param {object} options
 * @param {string} options.secret - Shared secret for HMAC verification
 * @param {Function} options.handler - Handler called with (parsedEvent, request)
 * @param {string} [options.headerName='x-webhook-signature'] - Signature header name
 * @param {string} [options.signaturePrefix='sha256='] - Expected signature prefix
 * @returns {Function} POST handler
 */
function webhook(options) {
	const {
		secret,
		handler,
		headerName = 'x-webhook-signature',
		signaturePrefix = 'sha256=',
	} = options;

	if (!secret) throw new Error('webhook() requires a secret');
	if (!handler) throw new Error('webhook() requires a handler function');

	/**
	 * Compute HMAC-SHA256 signature.
	 * @param {string|Buffer} body
	 * @returns {string}
	 */
	function computeSignature(body) {
		const key = typeof secret === 'string' ? new TextEncoder().encode(secret) : secret;
		const data = typeof body === 'string' ? new TextEncoder().encode(body) : body;

		// Use Web Crypto API
		const crypto = globalThis.crypto;
		if (!crypto?.subtle) {
			throw new Error('Web Crypto API not available (required for webhook signature verification)');
		}
		// We return the promise but the caller awaits it
		return crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
			.then(key => crypto.subtle.sign('HMAC', key, data))
			.then(sig => {
				const hex = Array.from(new Uint8Array(sig))
					.map(b => b.toString(16).padStart(2, '0'))
					.join('');
				return hex;
			});
	}

	async function webhookHandler(request) {
		const signature = request.headers.get(headerName);
		if (!signature) {
			return new Response(JSON.stringify({ error: 'Missing signature header' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const body = await request.text();
		const expectedSig = await computeSignature(body);
		const prefixLen = signaturePrefix.length;
		const providedSig = signature.startsWith(signaturePrefix)
			? signature.slice(prefixLen)
			: signature;

		// Constant-time comparison (sort of — at least not short-circuit on first char)
		if (providedSig.length !== expectedSig.length) {
			return new Response(JSON.stringify({ error: 'Invalid signature' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		let match = true;
		for (let i = 0; i < expectedSig.length; i++) {
			if (providedSig[i] !== expectedSig[i]) match = false;
		}
		if (!match) {
			return new Response(JSON.stringify({ error: 'Invalid signature' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Parse the event (try JSON first)
		let event;
		try {
			event = JSON.parse(body);
		} catch {
			event = body;
		}

		return handler(event, request);
	}

	return webhookHandler;
} // closes webhook

/**
 * Get the current request's cookies.
 *
 * Returns a store-like object with:
 *   .get(name)     → value or undefined
 *   .getAll()      → [{ name, value }]
 *   .toString()    → raw Cookie header
 *   [name]         → direct access
 *
 * In SSR/API: reads from the incoming request's Cookie header.
 * On client: reads from document.cookie (synchronous snapshot).
 */
function cookies() {
	const req = getRequest();
	let jar = {};

	if (req && req.cookies) {
		jar = { ...req.cookies };
	} else if (typeof document !== 'undefined') {
		for (const pair of document.cookie.split(';')) {
			const eq = pair.indexOf('=');
			if (eq === -1) continue;
			const k = pair.slice(0, eq).trim();
			const v = pair.slice(eq + 1).trim();
			if (k) jar[k] = decodeURIComponent(v);
		}
	}

	return new Proxy(jar, {
		get(target, prop) {
			if (prop === 'get') return (name) => target[name] || undefined;
			if (prop === 'getAll') return () => Object.entries(target).map(([name, value]) => ({ name, value }));
			if (prop === 'toString') return () => Object.entries(target).map(([k, v]) => `${k}=${v}`).join('; ');
			if (prop in target) return target[prop];
			return undefined;
		},
	});
}

/**
 * Get the current request's headers.
 *
 * Returns a store-like object with:
 *   .get(name)     → value or null (case-insensitive)
 *   .has(name)     → boolean
 *   .entries()     → [name, value][] iterator
 *   [name]         → direct access (lowercase)
 *
 * In SSR/API: reads from the incoming request's headers.
 * On client: returns empty store (no server headers in browser).
 */
/**
 * Get the current request's locals — mutable context shared between middleware
 * and page/API handlers. Set by middleware, read by pages/APIs.
 *
 * SSR/API: reads from globalThis.__vesk_request.locals
 * Client: returns empty object
 */
function locals() {
	const req = getRequest();
	if (req && req.locals) return req.locals;
	return {};
}

function headers() {
	const req = getRequest();
	let map = new Map();

	if (req && req.headers) {
		for (const [k, v] of Object.entries(req.headers)) {
			map.set(k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v));
		}
	}

	return new Proxy({}, {
		get(_target, prop) {
			if (prop === 'get') return (name) => map.get(name.toLowerCase()) || null;
			if (prop === 'has') return (name) => map.has(name.toLowerCase());
			if (prop === 'entries') return () => map.entries();
			if (typeof prop === 'string') return map.get(prop.toLowerCase()) ?? undefined;
			return undefined;
		},
		ownKeys() {
			return [...map.keys()];
		},
		getOwnPropertyDescriptor() {
			return { enumerable: true, configurable: true };
		},
	});
}

// ── ServerRequest ──────────────────────────────────────────────

/**
 * Enhanced Request class for Vesk server API routes.
 *
 * Extends the standard Web API Request with:
 *   .cookies  — parsed cookies object
 *   .params   — route params (set by the router)
 *   .locals   — mutable context shared between middleware and handlers
 */
class ServerRequest extends Request {
	/**
	 * @param {string|URL} input
	 * @param {RequestInit} [init]
	 */
	constructor(input, init) {
		super(input, init);
		this._cookies = {};
		this._params = {};
		this._locals = {};
	}

	/** Parsed cookies, keyed by name. */
	get cookies() { return this._cookies; }
	set cookies(v) { this._cookies = v; }

	/** Route parameters (e.g., { id: '42' }). */
	get params() { return this._params; }
	set params(v) { this._params = v; }

	/** Mutable request-scoped context object. */
	get locals() { return this._locals; }
	set locals(v) { this._locals = v; }
}

// ── ServerResponse ─────────────────────────────────────────────

/**
 * ServerResponse — Vesk server response builder.
 *
 *   ServerResponse.json({ data })
 *   ServerResponse.redirect('/login')
 *   ServerResponse.rewrite('/new-path')
 *   ServerResponse.next()
 */
class ServerResponse extends Response {
	/**
	 * @param {unknown} body
	 * @param {ResponseInit} [init]
	 * @returns {ServerResponse}
	 */
	static json(body, init) {
		const res = new ServerResponse(JSON.stringify(body), {
			...init,
			headers: { 'Content-Type': 'application/json', ...init?.headers },
		});
		return res;
	}

	/**
	 * Create a redirect response.
	 * @param {string} url
	 * @param {number} [status] - default 307 (temporary) or 308 (permanent)
	 * @returns {ServerResponse}
	 */
	static redirect(url, status = 307) {
		return new ServerResponse(null, {
			status,
			headers: { Location: url },
		});
	}

	/**
	 * Rewrite to a different URL (internal rewrite, status 200).
	 * @param {string} url
	 * @returns {ServerResponse}
	 */
	static rewrite(url) {
		return new ServerResponse(null, {
			status: 200,
			headers: { 'x-vesk-rewrite': url },
		});
	}

	/**
	 * Pass through to the next handler / default handling.
	 * @returns {ServerResponse}
	 */
	static next() {
		return new ServerResponse(null, {
			status: 200,
			headers: { 'x-vesk-next': '1' },
		});
	}
}

/**
 * Request body validation helper — wraps a Zod schema and parses the
 * request body, returning a 400 Response on validation failure.
 *
 * Usage:
 *   import { z } from 'zod';
 *   import { withValidation } from '@vesk/runtime';
 *
 *   const CreateUserSchema = z.object({ name: z.string(), email: z.string().email() });
 *   export async function POST(request) {
 *     const body = await withValidation(request, CreateUserSchema);
 *     if (body instanceof Response) return body; // 400 on validation error
 *     // body is typed as z.infer<typeof CreateUserSchema>
 *     return Response.json({ id: 1, ...body });
 *   }
 *
 * @param {Request} request
 * @param {import('zod').ZodType} schema
 * @param {object} [opts]
 * @param {boolean} [opts.jsonOnly] - only parse JSON, no form data
 * @returns {Promise<unknown | Response>}
 */
async function withValidation(request, schema, opts = {}) {
	let data;
	const contentType = request.headers.get('content-type') || '';

	try {
		if (contentType.includes('json')) {
			data = await request.json();
		} else if (!opts.jsonOnly) {
			const formData = await request.formData();
			if (formData && typeof formData === 'object') {
				data = Object.fromEntries(
					[...formData.entries()].map(([k, v]) => [k, v])
				);
			} else {
				data = await request.text().then(t => t ? JSON.parse(t) : {});
			}
		} else {
			data = await request.json();
		}

		const result = schema.safeParse(data);
		if (!result.success) {
			return ServerResponse.json({
				error: 'Validation failed',
				issues: result.error.issues.map(i => ({
					path: i.path.join('.'),
					message: i.message,
				})),
			}, { status: 400 });
		}
		return result.data;
	} catch (e) {
		return ServerResponse.json({
			error: 'Invalid request body',
			details: e.message,
		}, { status: 400 });
	}
}

// --- portal.js ---
function Portal(props, __registry, __ctx) {
  if (typeof document === 'undefined') return '';
  const target = typeof props.target === 'string'
    ? document.querySelector(props.target)
    : props.target;
  if (!target) return document.createComment('portal: no target');
  if (props.children != null) {
    if (typeof props.children === 'function') {
      const frag = document.createDocumentFragment();
      props.children(frag);
      target.appendChild(frag);
    } else {
      target.appendChild(props.children);
    }
  }
  return document.createComment('portal');
}

// --- hmr-client.js ---
// Vesk HMR Client — dev-only, injected into client bundle
(function() {
  var host = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/_vesk/hmr';
  var ws = null;
  var status = 'loading';
  var errorMsg = '';
  var lastCompileMs = 0;
  var reconnectTimer = null;

  // ── Surgical page update — replaces only <main> content ──
  function applyPageUpdate(name) {
    try {
      var main = document.querySelector('main');
      if (!main) {
        __router.navigate(window.location.pathname, { replace: true });
        return;
      }
      var match = __router._currentMatch;
      if (!match) return;
      var params = match.params || {};
      var pageFn = __components[name];
      if (!pageFn) {
        __router.navigate(window.location.pathname, { replace: true });
        return;
      }
      var walker = createHydrateWalker(main, []);
      var newContent = pageFn({ params: params }, new Map(), walker);
      main.innerHTML = '';
      if (newContent && newContent.nodeType) main.appendChild(newContent);
    } catch(ex) {
      // Fallback to full navigate
      __router.navigate(window.location.pathname, { replace: true });
    }
  }

  function connect() {
    try {
      ws = new WebSocket(host);
      ws.onopen = function() {
        status = 'connected';
        updateDot();
      };
      ws.onmessage = function(e) {
        try {
          var msg = JSON.parse(e.data);
          switch (msg.type) {
            case 'component-update':
              eval(msg.fnSource);
              status = 'updated';
              lastCompileMs = msg.time || 0;
              updateDot();
              if (typeof __router !== 'undefined') {
                if (typeof __router.__updateComponents === 'function') {
                  __router.__updateComponents(__router.routeTree);
                }
                if (msg.kind === 'layout') {
                  __router.navigate(window.location.pathname, { replace: true });
                } else if (msg.kind === 'page') {
                  applyPageUpdate(msg.name);
                } else {
                  __router.navigate(window.location.pathname, { replace: true });
                }
              }
              break;
            case 'full-reload':
              window.location.reload();
              break;
            case 'error':
              status = 'error';
              errorMsg = msg.message || 'Unknown error';
              updateDot();
              showToast('Compile error: ' + errorMsg);
              break;
            case 'compiling':
              status = 'compiling';
              updateDot();
              break;
          }
        } catch(ex) { /* ignore bad messages */ }
      };
      ws.onclose = function() {
        status = 'disconnected';
        updateDot();
        scheduleReconnect();
      };
      ws.onerror = function() {
        status = 'disconnected';
        updateDot();
        scheduleReconnect();
      };
    } catch(ex) { /* WebSocket unavailable */ }
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  }

  // ── Floating menu ──
  var menu = null;
  var dot = null;
  var label = null;

  function createMenu() {
    if (document.getElementById('__vesk_dev')) return;
    menu = document.createElement('div');
    menu.id = '__vesk_dev';
    menu.innerHTML =
      '<style>' +
      '#__vesk_dev{all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:ui-monospace,monospace;font-size:11px;line-height:1.4;color:#e0e0e0;cursor:pointer;}' +
      '#__vesk_dev *{box-sizing:border-box;}' +
      '#__vesk_dev .__v_bar{display:flex;align-items:center;gap:8px;background:#1a1b26;border:1px solid #2a2b3e;border-radius:10px;padding:6px 12px;box-shadow:0 4px 24px rgba(0,0,0,0.6);position:relative;transition:all .2s;}' +
      '#__vesk_dev .__v_bar:hover{border-color:#3a3b5e;}' +
      '#__vesk_dev .__v_dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;transition:background .3s;}' +
      '#__vesk_dev .__v_dot.connected{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,0.5);}' +
      '#__vesk_dev .__v_dot.compiling{background:#eab308;box-shadow:0 0 6px rgba(234,179,8,0.5);animation:__v_pulse .8s infinite;}' +
      '#__vesk_dev .__v_dot.error{background:#ef4444;box-shadow:0 0 6px rgba(239,68,68,0.5);}' +
      '#__vesk_dev .__v_dot.disconnected{background:#6b7280;}' +
      '#__vesk_dev .__v_dot.loading{background:#6b7280;animation:__v_pulse 1.2s infinite;}' +
      '#__vesk_dev .__v_label{white-space:nowrap;}' +
      '#__vesk_dev .__v_detail{display:none;position:absolute;bottom:calc(100% + 8px);right:0;background:#1a1b26;border:1px solid #2a2b3e;border-radius:8px;padding:10px 14px;min-width:240px;box-shadow:0 4px 24px rgba(0,0,0,0.6);white-space:pre-wrap;word-break:break-all;font-size:11px;}' +
      '#__vesk_dev .__v_bar.open .__v_detail{display:block;}' +
      '#__vesk_dev .__v_detail_row{display:flex;justify-content:space-between;gap:12px;padding:2px 0;}' +
      '#__vesk_dev .__v_detail_label{color:#888;}' +
      '#__vesk_dev .__v_detail_val{color:#e0e0e0;text-align:right;}' +
      '#__vesk_dev .__v_error{color:#ef4444;font-size:11px;margin-top:4px;max-width:280px;overflow:hidden;text-overflow:ellipsis;}' +
      '@keyframes __v_pulse{0%,100%{opacity:1}50%{opacity:.4}}' +
      '</style>' +
      '<div class="__v_bar">' +
      '  <span class="__v_dot loading"></span>' +
      '  <span class="__v_label">Vesk</span>' +
      '  <div class="__v_detail">' +
      '    <div class="__v_detail_row"><span class="__v_detail_label">Status</span><span class="__v_detail_val" id="__v_status">connecting...</span></div>' +
      '    <div class="__v_detail_row"><span class="__v_detail_label">Compile</span><span class="__v_detail_val" id="__v_time">-</span></div>' +
      '    <div class="__v_error" id="__v_error"></div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(menu);

    var bar = menu.querySelector('.__v_bar');
    bar.addEventListener('click', function(e) {
      e.stopPropagation();
      bar.classList.toggle('open');
    });

    dot = menu.querySelector('.__v_dot');
    label = menu.querySelector('.__v_label');
  }

  function updateDot() {
    if (!dot) return;
    dot.className = '__v_dot ' + status;
    var statusEl = document.getElementById('__v_status');
    if (statusEl) {
      var texts = { connected: 'Connected', compiling: 'Compiling...', error: 'Error', disconnected: 'Disconnected', loading: 'Connecting...', updated: 'Updated' };
      statusEl.textContent = texts[status] || status;
    }
  }

  function showToast(msg) {
    var errEl = document.getElementById('__v_error');
    if (errEl) errEl.textContent = msg;
  }

  // ── Init ──
  if (typeof document !== 'undefined' && document.body) {
    createMenu();
    connect();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
      createMenu();
      connect();
    });
  }
})();

// --- exports ---
export { track };
export { get };
export { set };
export { untrack };
export { peek_tracked as peek };
export { derived };
export { flush_sync as flushSync };
export { tick };
export { schedule_update };
export { queue_microtask };
export { active_block };
export { set_active_block };
export { set_active_component };
export { is_mutating_allowed };
export { tracking };
export { teardown };
export { run_block };
export { run_teardown };
export { create_component_ctx };
export { push_component };
export { pop_component };
export { with_block };
export { with_scope };
export { scope };
export { safe_scope };
export { set_tracking };
export { set_active_reaction };
export { is_block_dirty };
export { destroy_non_branch_children };
export { disable_scoped_flush };
export { effect };
export { user_effect };
export { block };
export { branch };
export { root };
export { render };
export { pre_effect };
export { destroy_block };
export { destroy_block_children };
export { pause_block };
export { resume_block };
export { is_destroyed };
export { unlink_block };
export { create_try_block };
export { boundary_fn_running_block };
export { hydrate };
export { hydrateViewport };
export { hydrateIdle };
export { needsHydration };
export { hydrationCount };
export { createHydrateWalker };
export { reactiveProps };
export { createRouter };
export { createFileRouter };
export { Outlet };
export { Link };
export { NavLink };
export { useNavigate };
export { useParams as routerParams };
export { usePathname };
export { useSearchParams };
export { useRouter };
export { buildRouteTree };
export { defineRoute };
export { Redirect };
export { redirect };
export { permanentRedirect };
export { notFound };
export { bindValue };
export { bindChecked };
export { bindGroup };
export { createContext };
export { Context };
export { getActiveComponent };
export { setActiveComponent };
export { createResource };
export { setSsrData };
export { clearSsrData };
export { resolveSsrResources };
export { useFetch };
export { Portal };
export { reconcile };
export { cookies };
export { headers };
export { locals };
export { ServerResponse };
export { withValidation };
export { useBody };
export { useParams };
export { cors };
export { webhook };

import { track, get, set, destroy_block, getActiveComponent, setActiveComponent, reactiveProps, effect, hydrate } from '/_vesk/static/client.js';
import { track } from '/_vesk/static/client.js';


const __components = {};

__components["Home"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const count = track(0);
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "home-page");
const $n3 = __hydrate.nextElement("button");
$n3.setAttribute("class", "btn-counter px-4 py-2 bg-blue-500 text-white rounded");
$n3.setAttribute("onClick", '');
$n3.setAttribute("data-testid", "counter-btn");
const $n4 = document.createTextNode(" Count: ");
$n3.appendChild($n4);
const $n5 = __hydrate.nextElement("span");
$n5.setAttribute("data-testid", "counter-value");
const $n6 = document.createTextNode('');
$n5.appendChild($n6);
$n3.appendChild($n5);
$n3.__evh_click = () => count.set(count.get() + 1);
$n3.setAttribute('data-vsk-ev', '');
$n0.appendChild($n3);
const $n7 = __hydrate.nextElement("button");
$n7.setAttribute("class", "px-4 py-2 bg-red-500 text-white rounded ml-2");
$n7.setAttribute("onClick", '');
$n7.setAttribute("data-testid", "reset-btn");
const $n8 = document.createTextNode(" Reset ");
$n7.appendChild($n8);
$n7.__evh_click = () => count.set(0);
$n7.setAttribute('data-vsk-ev', '');
$n0.appendChild($n7);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	effect(() => { $n6.data = String(count.get()); });
	if (!document.__vesk_dlg_click) {
		document.__vesk_dlg_click = true;
		document.addEventListener("click", (e) => {
			var el = e.target.closest('[data-vsk-ev]');
			if (el && el.__evh_click) el.__evh_click(e);
		});
	}
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, get, set, destroy_block, getActiveComponent, setActiveComponent, reactiveProps, effect, hydrate } from '/_vesk/static/client.js';
import { NavLink } from '/_vesk/static/client.js';


const __components = {};

__components["RootLayout"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("nav");
$n0.setAttribute("class", "flex gap-4 px-6 py-3 border-b bg-white nav-root");
const $n1 = (() => { const $f = document.createDocumentFragment();
const $n2 = document.createTextNode("Home");
$f.appendChild($n2);
return $f; })();
NavLink({ "href": "/", "class": "font-medium", children: $n1 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
const $n4 = (() => { const $f = document.createDocumentFragment();
const $n5 = document.createTextNode("About");
$f.appendChild($n5);
return $f; })();
NavLink({ "href": "/about", "class": "font-medium", children: $n4 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
const $n7 = (() => { const $f = document.createDocumentFragment();
const $n8 = document.createTextNode("Blog");
$f.appendChild($n8);
return $f; })();
NavLink({ "href": "/blog", "class": "font-medium", children: $n7 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
	if ($n0.parentNode !== $root) $root.appendChild($n0);
const $n10 = __hydrate.nextElement("main");
$n10.setAttribute("class", "p-4");
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    props.children(__hydrate.subWalker($n10));
  } else {
    $n10.appendChild(props.children);
  }
}
	if ($n10.parentNode !== $root) $root.appendChild($n10);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, get, set, destroy_block, getActiveComponent, setActiveComponent, reactiveProps, effect, hydrate } from '/_vesk/static/client.js';


const __components = {};

__components["About"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "about-page");
const $n3 = __hydrate.nextElement("button");
$n3.setAttribute("class", "about-btn px-3 py-1 bg-green-500 text-white rounded");
$n3.setAttribute("onClick", '');
$n3.setAttribute("data-testid", "about-btn");
const $n4 = document.createTextNode(" About Click ");
$n3.appendChild($n4);
$n3.__evh_click = () => alert('about');
$n3.setAttribute('data-vsk-ev', '');
$n0.appendChild($n3);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	if (!document.__vesk_dlg_click) {
		document.__vesk_dlg_click = true;
		document.addEventListener("click", (e) => {
			var el = e.target.closest('[data-vsk-ev]');
			if (el && el.__evh_click) el.__evh_click(e);
		});
	}
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, get, set, destroy_block, getActiveComponent, setActiveComponent, reactiveProps, effect, hydrate } from '/_vesk/static/client.js';


const __components = {};

__components["AboutLayout"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "about-layout border-2 border-green-300 rounded p-4");
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    props.children(__hydrate.subWalker($n0));
  } else {
    $n0.appendChild(props.children);
  }
}
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, get, set, destroy_block, getActiveComponent, setActiveComponent, reactiveProps, hydrate } from '/_vesk/static/client.js';


const __components = {};

__components["BlogList"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, get, set, destroy_block, getActiveComponent, setActiveComponent, reactiveProps, effect, hydrate } from '/_vesk/static/client.js';


const __components = {};

__components["BlogLayout"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "blog-layout border-2 border-blue-300 rounded p-4");
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    props.children(__hydrate.subWalker($n0));
  } else {
    $n0.appendChild(props.children);
  }
}
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}
import { track, get, set, destroy_block, getActiveComponent, setActiveComponent, reactiveProps, effect, hydrate } from '/_vesk/static/client.js';


const __components = {};

__components["BlogPost"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "blog-post");
$n0.setAttribute("data-testid", "blog-post");
const $n2 = __hydrate.nextElement("h1");
$n2.setAttribute("data-testid", "post-title");
const $n3 = document.createTextNode("Post: ");
$n2.appendChild($n3);
const $n4 = document.createTextNode('');
$n2.appendChild($n4);
$n0.appendChild($n2);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	effect(() => { $n4.data = String(props.params.slug); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

function __cleanup(start, end) {

	let n = start.nextSibling;

	while (n && n !== end) {

		const next = n.nextSibling;

		n.remove();

		n = next;

	}

}

globalThis.__components = __components;
function __resolveNames(nodes) {
  for (const n of nodes) {
    if (typeof n.page === 'string') {
      n._pageName = n.page;
      n.page = __components[n.page];
    }
    if (typeof n.layout === 'string') {
      n._layoutName = n.layout;
      n.layout = __components[n.layout];
    }
    if (n.children) __resolveNames(n.children);
  }
}
function __updateComponents(nodes) {
  for (const n of nodes) {
    if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName];
    if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName];
    if (n.children) __updateComponents(n.children);
  }
}
const __routeTree = [{"path":"","fullPath":"/","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Index","layout":"Layout_Index","loading":null,"error":null,"hasMiddleware":false,"children":[{"path":"about","fullPath":"/about","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_About","layout":"Layout_About","loading":null,"error":null,"hasMiddleware":false,"children":[],"sourceDir":"/home/joe/vesk/joe/app/about","segmentCount":1},{"path":"blog","fullPath":"/blog","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Blog","layout":"Layout_Blog","loading":null,"error":null,"hasMiddleware":false,"children":[{"path":":slug","fullPath":"/blog/:slug","isGroup":false,"isDynamic":true,"isCatchAll":false,"page":"Page_Blog_slug","layout":null,"loading":null,"error":null,"hasMiddleware":false,"children":[],"sourceDir":"/home/joe/vesk/joe/app/blog/[slug]","segmentCount":1}],"sourceDir":"/home/joe/vesk/joe/app/blog","segmentCount":1}],"sourceDir":"/home/joe/vesk/joe/app","segmentCount":0}];
__resolveNames(__routeTree);
const __router = createFileRouter(__routeTree);
__router.__updateComponents = __updateComponents;
if (typeof document !== 'undefined') __router.start();
