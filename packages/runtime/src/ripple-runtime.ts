import {
	destroy_block as _destroy_block,
	destroy_non_branch_children,
	effect as _effect,
	pause_block,
	pre_effect,
} from '@vesk/runtime/src/ripple-blocks';

export { destroy_non_branch_children };
import {
	ASYNC_DERIVED_READ_THROWN,
	BLOCK_HAS_RUN,
	BRANCH_BLOCK,
	DERIVED,
	COMPUTED_PROPERTY,
	CONTAINS_TEARDOWN,
	CONTAINS_UPDATE,
	DESTROYED,
	EFFECT_BLOCK,
	PAUSED,
	PRE_EFFECT_BLOCK,
	ROOT_BLOCK,
	TRACKED,
	UNINITIALIZED,
	REF_PROP,
	TRACKED_OBJECT,
	DEFAULT_NAMESPACE,
	TRACKED_UPDATED,
	SUSPENSE_PENDING,
	SUSPENSE_REJECTED,
	TRY_BLOCK,
	DIRECT_CHILD_BLOCK,
	UPDATE_SOURCE,
	NAMESPACE_URI,
} from '@vesk/runtime/src/ripple-constants';
import { is_ripple_object, define_property, get_descriptor, is_array, object_keys, get_own_property_symbols } from '@vesk/runtime/src/ripple-utils';

export interface Block {
	co: Component | null;
	d: Dependency | null;
	first: Block | null;
	f: number;
	fn: ((state: unknown) => unknown) | null;
	last: Block | null;
	next: Block | null;
	p: Block | null;
	prev: Block | null;
	s: unknown;
	t: (() => void) | null;
	tc: (() => void)[] | null;
}

export interface Tracked<T = unknown> {
	a: { get?: Function; set?: Function };
	b: Block;
	c: number;
	d: DeferredTrackedEntry[] | null;
	f: number;
	__v: unknown;
	get(): T;
	set(value: T): void;
}

export interface Derived<T = unknown> {
	a: { get?: Function; set?: Function };
	b: Block;
	blocks: Block[] | null;
	c: number;
	co: Component | null;
	d: Dependency | null;
	f: number;
	fn: () => unknown;
	__v: unknown;
	get(): T;
	set(value: T): void;
}

export interface Dependency {
	c: number;
	t: Tracked | Derived;
	n: Dependency | null;
}

export interface Component {
	b: Block | null;
	c: Map<ContextClass, unknown> | null;
	e: ComponentEffect[] | null;
	m: boolean;
	p: Component | null;
}

export interface ComponentEffect {
	b: Block;
	fn: () => void;
	r: Block | Derived | null;
}

interface DeferredTrackedEntry {
	t: Tracked | Derived;
	v: unknown;
}

interface ContextClass {
	_v: unknown;
	get(): unknown;
	set(v: unknown): void;
}

const FLUSH_MICROTASK = 0;
const FLUSH_SYNC = 1;

export let active_block: Block | null = null;
export let active_reaction: Block | Derived | null = null;
export let active_scope: Block | null = null;
export let active_component: Component | null = null;
export let active_namespace: keyof typeof NAMESPACE_URI = DEFAULT_NAMESPACE;
export let is_mutating_allowed = true;

const old_values = new Map<Tracked | Derived, unknown>();

let scheduler_mode = FLUSH_MICROTASK;
let is_micro_task_queued = false;
let clock = 0;
let queued_root_blocks: Block[] = [];
export let disable_scoped_flush = false;
let queued_microtasks: (() => void)[] = [];
let flush_count = 0;
const queued_post_block_flush: (() => void)[] = [];
let active_dependency: Dependency | null = null;

export let tracking = false;
export let teardown = false;

function increment_clock(): number {
	return ++clock;
}

export function set_active_block(block: Block | null): void {
	active_block = block;
}

export function set_active_reaction(reaction: Block | Derived | null): void {
	active_reaction = reaction;
}

export function set_active_component(component: Component | null): void {
	active_component = component;
}

export function set_tracking(value: boolean): void {
	tracking = value;
}

export function run_teardown(block: Block): void {
	const fn = block.t;
	const callbacks = block.tc;
	if (fn !== null || callbacks !== null) {
		const previous_block = active_block;
		const previous_reaction = active_reaction;
		const previous_tracking = tracking;
		const previous_teardown = teardown;

		try {
			active_block = null;
			active_reaction = null;
			tracking = false;
			teardown = true;
			if (fn !== null) fn.call(null);
			if (callbacks !== null) {
				for (let i = 0; i < callbacks.length; i++) {
					callbacks[i]();
				}
			}
		} finally {
			active_block = previous_block;
			active_reaction = previous_reaction;
			tracking = previous_tracking;
			teardown = previous_teardown;
		}
	}
}

export function on_destroy(fn: () => void): void {
	const block = scope();
	if (block === null) return;
	if (block.tc === null) block.tc = [];
	block.tc.push(fn);
}

export function with_block<T>(block: Block, fn: () => T): T {
	const prev_block = active_block;
	const previous_component = active_component;
	active_block = block;
	active_component = block.co;
	try {
		return fn();
	} finally {
		active_component = previous_component;
		active_block = prev_block;
	}
}

function update_derived(computed: Derived): void {
	let value = computed.__v;

	if (value === UNINITIALIZED || is_tracking_dirty(computed.d)) {
		value = run_derived(computed);

		if (value !== computed.__v) {
			computed.__v = value;
			computed.c = increment_clock();
		}
	}
}

function update_tracked_value_clock(tracked: Tracked, value: unknown): void {
	tracked.__v = value;
	tracked.c = increment_clock();
}

function destroy_computed_children(computed: Derived): void {
	const blocks = computed.blocks;

	if (blocks !== null) {
		computed.blocks = null;
		for (let i = 0; i < blocks.length; i++) {
			_destroy_block(blocks[i]);
		}
	}
}

function run_derived(computed: Derived): unknown {
	const previous_block = active_block;
	const previous_reaction = active_reaction;
	const previous_tracking = tracking;
	const previous_dependency = active_dependency;
	const previous_component = active_component;
	const previous_is_mutating_allowed = is_mutating_allowed;

	try {
		active_block = computed.b;
		active_reaction = computed;
		tracking = true;
		active_dependency = null;
		active_component = computed.co;
		is_mutating_allowed = false;

		destroy_computed_children(computed);

		const value = computed.fn();

		computed.d = active_dependency;

		return value;
	} catch (error: unknown) {
		computed.d = active_dependency;
		if (error === ASYNC_DERIVED_READ_THROWN) {
			let dep = active_dependency;
			while (dep !== null) {
				if ((dep.t as Tracked).__v === SUSPENSE_REJECTED) {
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

export function handle_error(error: unknown, _block: Block): void {
	throw error;
}

export function run_block(block: Block): void {
	const previous_block = active_block;
	const previous_reaction = active_reaction;
	const previous_tracking = tracking;
	const previous_dependency = active_dependency;
	const previous_component = active_component;

	try {
		active_block = block;
		active_reaction = block;
		active_component = block.co;

		destroy_non_branch_children(block);
		run_teardown(block);

		tracking = (block.f & (ROOT_BLOCK | BRANCH_BLOCK)) === 0;
		active_dependency = null;
		const res = block.fn!(block.s);

		if (typeof res === 'function') {
			block.t = res as () => void;
			let current: Block | null = block;

			while (current !== null && (current.f & CONTAINS_TEARDOWN) === 0) {
				current.f ^= CONTAINS_TEARDOWN;
				current = current.p;
			}
		}

		block.d = active_dependency;
	} catch (error: unknown) {
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

const empty_get_set = { get: undefined, set: undefined } as { get?: Function; set?: Function };

class TrackedValue<T = unknown> implements Tracked<T> {
	a: { get?: Function; set?: Function };
	b: Block;
	c: number;
	d: DeferredTrackedEntry[] | null;
	f: number;
	__v: unknown;

	constructor(v: unknown, block: Block, a: { get?: Function; set?: Function }) {
		this.a = a;
		this.b = block;
		this.c = 0;
		this.d = null;
		this.f = TRACKED;
		this.__v = v;
	}

	get(): T {
		return get_tracked(this as unknown as Tracked) as T;
	}

	set(value: T): void {
		set(this as unknown as Tracked, value);
	}

	get [0]() {
		return get_tracked(this as unknown as Tracked);
	}
	set [0](v: unknown) {
		set(this as unknown as Tracked, v);
	}

	get [1](): Tracked<T> {
		return this as unknown as Tracked<T>;
	}

	get value(): T {
		return get_tracked(this as unknown as Tracked) as T;
	}
	set value(v: T) {
		set(this as unknown as Tracked, v);
	}

	get length(): number {
		return 2;
	}

	*[Symbol.iterator](): Iterator<unknown | Tracked<T>> {
		yield get_tracked(this as unknown as Tracked);
		yield this as unknown as Tracked<T>;
	}
}

class DerivedValue<T = unknown> implements Derived<T> {
	a: { get?: Function; set?: Function };
	b: Block;
	blocks: Block[] | null;
	c: number;
	co: Component | null;
	d: Dependency | null;
	f: number;
	fn: () => unknown;
	__v: unknown;

	constructor(fn: () => unknown, block: Block, a: { get?: Function; set?: Function }) {
		this.a = a;
		this.b = block;
		this.blocks = null;
		this.c = 0;
		this.co = active_component;
		this.d = null;
		this.f = DERIVED;
		this.fn = fn;
		this.__v = UNINITIALIZED;
	}

	get(): T {
		return get_derived(this as unknown as Derived) as T;
	}

	set(value: T): void {
		set(this as unknown as Derived, value);
	}

	get [0]() {
		return get_derived(this as unknown as Derived);
	}
	set [0](v: unknown) {
		set(this as unknown as Derived, v);
	}

	get [1](): Derived<T> {
		return this as unknown as Derived<T>;
	}

	get value(): T {
		return get_derived(this as unknown as Derived) as T;
	}
	set value(v: T) {
		set(this as unknown as Derived, v);
	}

	get length(): number {
		return 2;
	}

	*[Symbol.iterator](): Iterator<unknown | Derived<T>> {
		yield get_derived(this as unknown as Derived);
		yield this as unknown as Derived<T>;
	}
}

export type GetHook = (value: unknown) => unknown;
export type SetHook = (next: unknown, prev: unknown) => unknown;

export function tracked<T>(v: T, block?: Block, get?: GetHook, set?: SetHook): Tracked<T>;
export function tracked(v: unknown, block?: Block, get?: GetHook, set?: SetHook): Tracked {
	return new TrackedValue(v, block || active_block!, get || set ? { get, set } : empty_get_set);
}

export function derived<T>(fn: () => T, block?: Block, get?: GetHook, set?: SetHook): Derived<T>;
export function derived(fn: () => unknown, block?: Block, get?: GetHook, set?: SetHook): Derived {
	return new DerivedValue(fn, block || active_block!, get || set ? { get, set } : empty_get_set);
}

export function track<T>(fn: () => T, b?: Block): Derived<T>;
export function track<T>(v: T, b?: Block): Tracked<T>;
export function track<T>(v: T, get: GetHook, set?: SetHook): Tracked<T>;
export function track(v: unknown, b?: Block | GetHook, get?: GetHook | SetHook, set?: SetHook): Tracked | Derived {
	if (is_ripple_object(v)) {
		return v as Tracked | Derived;
	}

	let hookGet: GetHook | undefined;
	let hookSet: SetHook | undefined;
	if (typeof b === 'function') {
		hookSet = (set === undefined ? get : set) as SetHook | undefined;
		hookGet = b as GetHook;
		b = undefined;
	} else {
		hookGet = get as GetHook | undefined;
		hookSet = set;
	}

	if (typeof v === 'function') {
		return derived(v as () => unknown, b as Block | undefined, hookGet, hookSet);
	}
	return tracked(v, b as Block | undefined, hookGet, hookSet);
}

function create_dependency(tracked: Tracked | Derived): Dependency {
	const reaction = active_reaction as Derived | Block;
	const existing = reaction.d;

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

function is_tracking_dirty(tracking: Dependency | null): boolean {
	if (tracking === null) {
		return false;
	}
	while (tracking !== null) {
		const t = tracking.t;

		if ((t.f & DERIVED) !== 0) {
			try {
				update_derived(t as Derived);
			} catch (e: unknown) {
				if (e === ASYNC_DERIVED_READ_THROWN) {
					return true;
				}
				throw e;
			}
		}

		if (t.c > tracking.c) {
			return true;
		}
		tracking = tracking.n;
	}

	return false;
}

export function is_block_dirty(block: Block): boolean {
	const flags = block.f;

	if ((flags & (ROOT_BLOCK | BRANCH_BLOCK)) !== 0) {
		return false;
	}
	if ((flags & BLOCK_HAS_RUN) === 0) {
		block.f ^= BLOCK_HAS_RUN;
		return true;
	}

	return is_tracking_dirty(block.d);
}

function flush_updates(root_block: Block): void {
	let current: Block | null = root_block;
	const pre_effects: Block[] = [];
	const other_blocks: Block[] = [];
	const effects: Block[] = [];
	let scope_root: Block | null = disable_scoped_flush ? root_block : null;

	while (current !== null) {
		const flags = current.f;
		const on_path = (flags & CONTAINS_UPDATE) !== 0;

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
			const child: Block | null = current.first;

			if (child !== null) {
				current = child;
				continue;
			}
		}

		let parent = current.p;
		current = current.next;

		while (current === null && parent !== null) {
			if (parent === scope_root) {
				scope_root = null;
			}
			current = parent.next;
			parent = parent.p;
		}
	}

	let arr_length = 0;

	arr_length = pre_effects.length;
	for (let i = 0; i < arr_length; i++) {
		const block = pre_effects[i];
		try {
			if ((block.f & (PAUSED | DESTROYED)) === 0 && is_block_dirty(block)) {
				run_block(block);
			}
		} catch (error: unknown) {
			handle_error(error, block);
		}
	}

	arr_length = other_blocks.length;
	for (let i = 0; i < arr_length; i++) {
		const block = other_blocks[i];
		try {
			if ((block.f & (PAUSED | DESTROYED)) === 0 && is_block_dirty(block)) {
				run_block(block);
			}
		} catch (error: unknown) {
			handle_error(error, block);
		}
	}

	arr_length = effects.length;
	for (let i = 0; i < arr_length; i++) {
		const block = effects[i];
		try {
			if ((block.f & (PAUSED | DESTROYED)) === 0 && is_block_dirty(block)) {
				run_block(block);
			}
		} catch (error: unknown) {
			handle_error(error, block);
		}
	}
}

function flush_queued_root_blocks(root_blocks: Block[]): void {
	for (let i = 0; i < root_blocks.length; i++) {
		flush_updates(root_blocks[i]);
	}

	if (queued_post_block_flush.length > 0) {
		const callbacks = queued_post_block_flush;
		queued_post_block_flush.length = 0;
		for (let j = 0; j < callbacks.length; j++) {
			callbacks[j]();
		}
	}
}

export async function tick(): Promise<void> {
	return new Promise((f) => requestAnimationFrame(() => f()));
}

function flush_microtasks(): void {
	is_micro_task_queued = false;

	if (queued_microtasks.length > 0) {
		const microtasks = queued_microtasks;
		queued_microtasks = [];
		for (let i = 0; i < microtasks.length; i++) {
			microtasks[i]();
		}
	}

	flush_count++;
	if (flush_count > 1001) {
		throw new Error(
			'Maximum update depth exceeded. This typically indicates that an effect reads and writes the same piece of state.',
		);
	}
	const previous_queued_root_blocks = queued_root_blocks;
	queued_root_blocks = [];
	flush_queued_root_blocks(previous_queued_root_blocks);

	if (!is_micro_task_queued) {
		flush_count = 0;
	}
	old_values.clear();
}

export function queue_microtask(fn?: () => void): void {
	if (!is_micro_task_queued) {
		is_micro_task_queued = true;
		queueMicrotask(flush_microtasks);
	}
	if (fn !== undefined) {
		queued_microtasks.push(fn);
	}
}

export function queue_post_block_flush_callback(fn: () => void): void {
	queued_post_block_flush.push(fn);
}

export function schedule_update(block: Block | null): void {
	if (block === null) return;
	if (scheduler_mode === FLUSH_MICROTASK) {
		queue_microtask();
	}
	block.f |= UPDATE_SOURCE;
	let current: Block | null = block;

	while (current !== null) {
		const flags = current.f;
		if ((flags & CONTAINS_UPDATE) !== 0) return;
		current.f ^= CONTAINS_UPDATE;
		if ((flags & ROOT_BLOCK) !== 0) {
			break;
		}
		current = current.p;
	}

	queued_root_blocks.push(current!);
}

function register_dependency(tracked: Tracked | Derived): void {
	if (!disable_scoped_flush && active_block !== null && active_block !== (tracked as Tracked).b) {
		let already_seen = false;
		let prev_dep = active_reaction === null ? null : active_reaction.d;
		while (prev_dep !== null) {
			if (prev_dep.t === tracked) {
				already_seen = true;
				break;
			}
			prev_dep = prev_dep.n;
		}

		if (!already_seen) {
			const owner = (tracked as Tracked).b;
			let node: Block | null = active_block;
			while (node !== null && node !== owner) {
				node = node.p;
			}
			if (node === null) {
				disable_scoped_flush = true;
			}
		}
	}

	let dependency = active_dependency;

	if (dependency === null) {
		dependency = create_dependency(tracked);
		active_dependency = dependency;
	} else {
		let current: Dependency | null = dependency;

		while (current !== null) {
			if (current.t === tracked) {
				current.c = tracked.c;
				return;
			}
			const next: Dependency | null = current.n;
			if (next === null) {
				break;
			}
			current = next;
		}

		dependency = create_dependency(tracked);
		current!.n = dependency;
	}
}

export function get_derived(computed: Derived): unknown {
	update_derived(computed);
	if (tracking) {
		register_dependency(computed);
	}
	let value = computed.__v;
	const get = computed.a.get;
	if (get !== undefined) {
		value = trigger_track_get(get, value);
		computed.__v = value;
	}

	if (value === SUSPENSE_PENDING || value === SUSPENSE_REJECTED) {
		throw ASYNC_DERIVED_READ_THROWN;
	}

	return value;
}

export function get(t: unknown): unknown {
	if (!is_ripple_object(t)) {
		return t;
	}

	return (t as Tracked | Derived).f & DERIVED
		? get_derived(t as Derived)
		: get_tracked(t as Tracked);
}

export function get_tracked(tracked: Tracked): unknown {
	let value = tracked.__v;
	if (tracking) {
		register_dependency(tracked);
	}

	if (value === SUSPENSE_PENDING || value === SUSPENSE_REJECTED) {
		throw ASYNC_DERIVED_READ_THROWN;
	}

	if (teardown && old_values.has(tracked)) {
		value = old_values.get(tracked);
	}
	const get = tracked.a.get;
	if (get !== undefined) {
		value = trigger_track_get(get, value);
	}
	return value;
}

export function is_tracked_pending(t: unknown): boolean {
	try {
		if (typeof t === 'function') {
			(t as () => void)();
		} else {
			get(t);
		}
		return false;
	} catch (error: unknown) {
		if (error === ASYNC_DERIVED_READ_THROWN) {
			return true;
		}
		throw error;
	}
}

export function peek_tracked(tracked: unknown): unknown {
	if (!is_ripple_object(tracked)) {
		return tracked;
	}

	return (tracked as Tracked | Derived).__v;
}

export function set(tracked: Tracked | Derived, value: unknown): void {
	if (!is_mutating_allowed) {
		throw new Error(
			'Assignments or updates to tracked values are not allowed during computed "track(() => ...)" evaluation',
		);
	}

	const old_value = tracked.__v;

	if (value !== old_value) {
		const tracked_block = (tracked as Tracked).b;

		if (tracked_block !== null && (tracked_block.f & CONTAINS_TEARDOWN) !== 0) {
			if (teardown) {
				old_values.set(tracked, value);
			} else {
				old_values.set(tracked, old_value);
			}
		}

		const setFn = tracked.a.set;
		if (setFn !== undefined) {
			value = untrack(() => setFn(value, old_value));
		}

		tracked.__v = value;
		tracked.c = increment_clock();
		schedule_update(tracked_block);
	}
}

export function untrack<T>(fn: () => T): T {
	const previous_tracking = tracking;
	const previous_dependency = active_dependency;
	tracking = false;
	active_dependency = null;
	try {
		return fn();
	} finally {
		tracking = previous_tracking;
		active_dependency = previous_dependency;
	}
}

export function flush_sync<T>(fn?: () => T): T | undefined {
	const previous_scheduler_mode = scheduler_mode;
	const previous_queued_root_blocks = queued_root_blocks;

	try {
		const root_blocks: Block[] = [];

		scheduler_mode = FLUSH_SYNC;
		queued_root_blocks = root_blocks;
		is_micro_task_queued = false;

		flush_queued_root_blocks(previous_queued_root_blocks);

		const result = fn?.();

		if (queued_root_blocks.length > 0 || root_blocks.length > 0) {
			flush_sync();
		}

		flush_count = 0;

		return result as T;
	} finally {
		scheduler_mode = previous_scheduler_mode;
		queued_root_blocks = previous_queued_root_blocks;
	}
}

function trigger_track_get(fn: Function, v: unknown): unknown {
	let previous_is_mutating_allowed = is_mutating_allowed;
	try {
		is_mutating_allowed = false;
		return untrack(() => fn(v));
	} finally {
		is_mutating_allowed = previous_is_mutating_allowed;
	}
}

export function spread_props(fn: () => object): object {
	return proxy_props(fn);
}

export function proxy_props(fn: () => object): object {
	const memo = derived(fn, active_block as Block);

	return new Proxy(
		{},
		{
			get(_, property) {
				const obj = get_derived(memo) as Record<string | symbol, unknown> | Record<string | symbol, unknown>[];

				if (is_array(obj)) {
					let item: Record<string | symbol, unknown>;
					for (let i = obj.length - 1; i >= 0; i--) {
						item = obj[i] as Record<string | symbol, unknown>;
						if (property in item) {
							return item[property];
						}
					}
					return undefined;
				}

				return (obj as Record<string | symbol, unknown>)[property];
			},
			has(_, property) {
				if (property === TRACKED_OBJECT) {
					return true;
				}
				const obj = get_derived(memo) as Record<string | symbol, unknown> | Record<string | symbol, unknown>[];

				if (is_array(obj)) {
					for (let i = obj.length - 1; i >= 0; i--) {
						if (property in (obj[i] as Record<string | symbol, unknown>)) {
							return true;
						}
					}
					return false;
				}

				return property in obj;
			},
			getOwnPropertyDescriptor(_, key) {
				const obj = get_derived(memo) as Record<string | symbol, unknown> | Record<string | symbol, unknown>[];

				if (is_array(obj)) {
					let item: Record<string | symbol, unknown>;
					for (let i = obj.length - 1; i >= 0; i--) {
						item = obj[i] as Record<string | symbol, unknown>;
						if (key in item) {
							return get_descriptor(item, key);
						}
					}
					return undefined;
				}

				if (key in (obj as Record<string | symbol, unknown>)) {
					return get_descriptor(obj as Record<string | symbol, unknown>, key);
				}
				return undefined;
			},
			ownKeys() {
				const obj = get_derived(memo) as Record<string | symbol, unknown> | Record<string | symbol, unknown>[];
				const done: Record<string | symbol, 1> = {};
				const keys: (string | symbol)[] = [];

				if (is_array(obj)) {
					let item: Record<string | symbol, unknown>;
					for (let i = 0; i < obj.length; i++) {
						item = obj[i] as Record<string | symbol, unknown>;
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

				return Reflect.ownKeys(obj as Record<string | symbol, unknown>);
			},
		},
	);
}

export function computed_property(fn: () => unknown): () => unknown {
	define_property(fn, COMPUTED_PROPERTY, {
		value: true,
		enumerable: false,
	});
	return fn;
}

export function call_property(
	obj: Record<string | symbol, unknown>,
	property: string | number | symbol,
	chain_obj: boolean,
	chain_prop: boolean,
	...args: unknown[]
): unknown {
	if (!chain_obj && !chain_prop) {
		return (obj[property] as Function).call(obj, ...args);
	} else if (chain_obj && chain_prop) {
		return (obj[property] as Function | undefined)?.call(obj, ...args);
	} else if (chain_obj) {
		return (obj[property] as Function | undefined)?.call(obj, ...args);
	} else {
		return (obj[property] as Function | undefined)?.call(obj, ...args);
	}
}

export function get_property(obj: Record<string | symbol, unknown>, property: string | number | symbol, chain = false): unknown {
	if (chain && obj == null) {
		return undefined;
	}
	const trackedVal = obj[property];
	if (trackedVal == null) {
		return trackedVal;
	}
	return get(trackedVal);
}

export function set_property(obj: Record<string | symbol, unknown>, property: string | number | symbol, value: unknown): void {
	const trackedVal = obj[property];
	set(trackedVal as Tracked | Derived, value);
}

export function update(tracked: Tracked, d = 1): number {
	let value = get(tracked) as number;
	const result = d === 1 ? value++ : value--;
	set(tracked, value);
	return result;
}

export function increment(tracked: Tracked): void {
	set(tracked, (tracked.__v as number) + 1);
}

export function decrement(tracked: Tracked): void {
	set(tracked, (tracked.__v as number) - 1);
}

export function update_pre(tracked: Tracked, d = 1): number {
	let value = get(tracked) as number;
	const new_value = d === 1 ? ++value : --value;
	set(tracked, new_value);
	return new_value;
}

export function update_property(obj: Record<string | symbol, unknown>, property: string | number | symbol, d = 1): number {
	const trackedVal = obj[property] as Tracked;
	let value = get(trackedVal) as number;
	const new_value = d === 1 ? value++ : value--;
	set(trackedVal, value);
	return new_value;
}

export function update_pre_property(obj: Record<string | symbol, unknown>, property: string | number | symbol, d = 1): number {
	const trackedVal = obj[property] as Tracked;
	let value = get(trackedVal) as number;
	const new_value = d === 1 ? ++value : --value;
	set(trackedVal, new_value);
	return new_value;
}

export function with_scope<T>(block: Block, fn: () => T): T {
	const previous_scope = active_scope;
	try {
		active_scope = block;
		return fn();
	} finally {
		active_scope = previous_scope;
	}
}

export function scope(): Block | null {
	return active_scope || active_block;
}

export function safe_scope(err = 'Cannot access outside of a component context'): Block {
	if (active_scope === null) {
		throw new Error(err);
	}

	return active_scope;
}

export function create_component_ctx(): Component {
	return {
		b: active_block,
		c: null,
		e: null,
		m: false,
		p: active_component,
	};
}

export function push_component(): void {
	const component = create_component_ctx();
	active_component = component;
}

export function pop_component(): void {
	const component = active_component as Component;
	component.m = true;
	const effects = component.e;
	if (effects !== null) {
		const length = effects.length;
		for (let i = 0; i < length; i++) {
			const { b: block, fn, r: reaction } = effects[i];
			const previous_block = active_block;
			const previous_reaction = active_reaction;

			try {
				active_block = block;
				active_reaction = reaction;
				_effect(fn);
			} finally {
				active_block = previous_block;
				active_reaction = previous_reaction;
			}
		}
	}
	active_component = component.p;
}

export function exclude_from_object(obj: Record<string | symbol, unknown>, exclude_keys: string[]): Record<string | symbol, unknown> {
	const keys = object_keys(obj as Record<string, unknown>);
	const new_obj: Record<string | symbol, unknown> = {};

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
