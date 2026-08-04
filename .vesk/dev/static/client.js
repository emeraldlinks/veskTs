// --- ripple-constants.js ---
const ROOT_BLOCK = 1 << 1;
const RENDER_BLOCK = 1 << 2;
const EFFECT_BLOCK = 1 << 3;
const BRANCH_BLOCK = 1 << 4;
const FOR_BLOCK = 1 << 5;
const TRY_BLOCK = 1 << 6;
const IF_BLOCK = 1 << 7;
const SWITCH_BLOCK = 1 << 8;
const COMPOSITE_BLOCK = 1 << 9;
const ASYNC_BLOCK = 1 << 10;
const HEAD_BLOCK = 1 << 11;
const PRE_EFFECT_BLOCK = 1 << 12;
const DIRECT_CHILD_BLOCK = 1 << 13;
const CONTAINS_UPDATE = 1 << 14;
const CONTAINS_TEARDOWN = 1 << 15;
const BLOCK_HAS_RUN = 1 << 16;
const TRACKED = 1 << 17;
const DERIVED = 1 << 18;
const DEFERRED = 1 << 19;
const PAUSED = 1 << 20;
const DESTROYED = 1 << 21;
const UPDATE_SOURCE = 1 << 22;
const CONTROL_FLOW_BLOCK = FOR_BLOCK | IF_BLOCK | SWITCH_BLOCK | TRY_BLOCK | COMPOSITE_BLOCK;
const UNINITIALIZED = Symbol("uninitialized");
const TRACKED_ARRAY = Symbol();
const TRACKED_OBJECT = Symbol();
const COMPUTED_PROPERTY = Symbol();
const HMR = Symbol();
const REF_PROP = "ref";
const ARRAY_SET_INDEX_AT = Symbol();
const MAX_ARRAY_LENGTH = 2 ** 32 - 1;
const DEFAULT_NAMESPACE = "html";
const NAMESPACE_URI = {
  html: "http://www.w3.org/1999/xhtml",
  svg: "http://www.w3.org/2000/svg",
  mathml: "http://www.w3.org/1998/Math/MathML"
};
const TRACKED_UPDATED = Symbol("TRACKED_UPDATED");
const SUSPENSE_PENDING = Symbol("suspense_pending");
const SUSPENSE_REJECTED = Symbol("suspense_rejected");
const ASYNC_DERIVED_READ_THROWN = Symbol("async_derived_read_thrown");

// --- ripple-utils.js ---
function is_ripple_object(v) {
  return typeof v === "object" && v !== null && typeof v.f === "number";
}
const define_property = Object.defineProperty;
const get_descriptor = Object.getOwnPropertyDescriptor;
const is_array = Array.isArray;
const object_keys = Object.keys;
function get_own_property_symbols(obj) {
  return Object.getOwnPropertySymbols(obj);
}

// --- ripple-runtime.js ---
const FLUSH_MICROTASK = 0;
const FLUSH_SYNC = 1;
let active_block = null;
let active_reaction = null;
let active_scope = null;
let active_component = null;
let active_namespace = DEFAULT_NAMESPACE;
let is_mutating_allowed = true;
const old_values = /* @__PURE__ */ new Map();
let scheduler_mode = FLUSH_MICROTASK;
let is_micro_task_queued = false;
let clock = 0;
let queued_root_blocks = [];
let disable_scoped_flush = false;
let queued_microtasks = [];
let flush_count = 0;
const queued_post_block_flush = [];
let active_dependency = null;
let tracking = false;
let teardown = false;
function increment_clock() {
  return ++clock;
}
function set_active_block(block) {
  active_block = block;
}
function set_active_reaction(reaction) {
  active_reaction = reaction;
}
function set_active_component(component) {
  active_component = component;
}
function set_tracking(value) {
  tracking = value;
}
function run_teardown(block) {
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
      if (fn !== null)
        fn.call(null);
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
function on_destroy(fn) {
  const block = scope();
  if (block === null)
    return;
  if (block.tc === null)
    block.tc = [];
  block.tc.push(fn);
}
function with_block(block, fn) {
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
function update_derived(computed) {
  let value = computed.__v;
  if (value === UNINITIALIZED || is_tracking_dirty(computed.d)) {
    value = run_derived(computed);
    if (value !== computed.__v) {
      computed.__v = value;
      computed.c = increment_clock();
    }
  }
}
function update_tracked_value_clock(tracked2, value) {
  tracked2.__v = value;
  tracked2.c = increment_clock();
}
function destroy_computed_children(computed) {
  const blocks = computed.blocks;
  if (blocks !== null) {
    computed.blocks = null;
    for (let i = 0; i < blocks.length; i++) {
      _destroy_block(blocks[i]);
    }
  }
}
function run_derived(computed) {
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
  } catch (error) {
    computed.d = active_dependency;
    if (error === ASYNC_DERIVED_READ_THROWN) {
      let dep = active_dependency;
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
function handle_error(error, _block) {
  throw error;
}
function run_block(block) {
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
    const res = block.fn(block.s);
    if (typeof res === "function") {
      block.t = res;
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
const empty_get_set = { get: void 0, set: void 0 };
class TrackedValue {
  a;
  b;
  c;
  d;
  f;
  __v;
  constructor(v, block, a) {
    this.a = a;
    this.b = block;
    this.c = 0;
    this.d = null;
    this.f = TRACKED;
    this.__v = v;
  }
  get [0]() {
    return get_tracked(this);
  }
  set [0](v) {
    set(this, v);
  }
  get [1]() {
    return this;
  }
  get value() {
    return get_tracked(this);
  }
  set value(v) {
    set(this, v);
  }
  get length() {
    return 2;
  }
  *[Symbol.iterator]() {
    yield get_tracked(this);
    yield this;
  }
}
class DerivedValue {
  a;
  b;
  blocks;
  c;
  co;
  d;
  f;
  fn;
  __v;
  constructor(fn, block, a) {
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
  get [0]() {
    return get_derived(this);
  }
  set [0](v) {
    set(this, v);
  }
  get [1]() {
    return this;
  }
  get value() {
    return get_derived(this);
  }
  set value(v) {
    set(this, v);
  }
  get length() {
    return 2;
  }
  *[Symbol.iterator]() {
    yield get_derived(this);
    yield this;
  }
}
function tracked(v, block, get2, set2) {
  return new TrackedValue(v, block || active_block, get2 || set2 ? { get: get2, set: set2 } : empty_get_set);
}
function derived(fn, block, get2, set2) {
  return new DerivedValue(fn, block || active_block, get2 || set2 ? { get: get2, set: set2 } : empty_get_set);
}
function track(v, b, get2, set2) {
  if (is_ripple_object(v)) {
    return v;
  }
  if (typeof v === "function") {
    return derived(v, b, get2, set2);
  }
  return tracked(v, b, get2, set2);
}
function create_dependency(tracked2) {
  const reaction = active_reaction;
  const existing = reaction.d;
  if (existing !== null) {
    reaction.d = existing.n;
    existing.c = tracked2.c;
    existing.t = tracked2;
    existing.n = null;
    return existing;
  }
  return {
    c: tracked2.c,
    t: tracked2,
    n: null
  };
}
function is_tracking_dirty(tracking2) {
  if (tracking2 === null) {
    return false;
  }
  while (tracking2 !== null) {
    const t = tracking2.t;
    if ((t.f & DERIVED) !== 0) {
      try {
        update_derived(t);
      } catch (e) {
        if (e === ASYNC_DERIVED_READ_THROWN) {
          return true;
        }
        throw e;
      }
    }
    if (t.c > tracking2.c) {
      return true;
    }
    tracking2 = tracking2.n;
  }
  return false;
}
function is_block_dirty(block) {
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
function flush_updates(root_block) {
  let current = root_block;
  const pre_effects = [];
  const other_blocks = [];
  const effects = [];
  let scope_root = disable_scoped_flush ? root_block : null;
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
      const child = current.first;
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
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      handle_error(error, block);
    }
  }
}
function flush_queued_root_blocks(root_blocks) {
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
async function tick() {
  return new Promise((f) => requestAnimationFrame(() => f()));
}
function flush_microtasks() {
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
    throw new Error("Maximum update depth exceeded. This typically indicates that an effect reads and writes the same piece of state.");
  }
  const previous_queued_root_blocks = queued_root_blocks;
  queued_root_blocks = [];
  flush_queued_root_blocks(previous_queued_root_blocks);
  if (!is_micro_task_queued) {
    flush_count = 0;
  }
  old_values.clear();
}
function queue_microtask(fn) {
  if (!is_micro_task_queued) {
    is_micro_task_queued = true;
    queueMicrotask(flush_microtasks);
  }
  if (fn !== void 0) {
    queued_microtasks.push(fn);
  }
}
function queue_post_block_flush_callback(fn) {
  queued_post_block_flush.push(fn);
}
function schedule_update(block) {
  if (block === null)
    return;
  if (scheduler_mode === FLUSH_MICROTASK) {
    queue_microtask();
  }
  block.f |= UPDATE_SOURCE;
  let current = block;
  while (current !== null) {
    const flags = current.f;
    if ((flags & CONTAINS_UPDATE) !== 0)
      return;
    current.f ^= CONTAINS_UPDATE;
    if ((flags & ROOT_BLOCK) !== 0) {
      break;
    }
    current = current.p;
  }
  queued_root_blocks.push(current);
}
function register_dependency(tracked2) {
  if (!disable_scoped_flush && active_block !== null && active_block !== tracked2.b) {
    let already_seen = false;
    let prev_dep = active_reaction === null ? null : active_reaction.d;
    while (prev_dep !== null) {
      if (prev_dep.t === tracked2) {
        already_seen = true;
        break;
      }
      prev_dep = prev_dep.n;
    }
    if (!already_seen) {
      const owner = tracked2.b;
      let node = active_block;
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
    dependency = create_dependency(tracked2);
    active_dependency = dependency;
  } else {
    let current = dependency;
    while (current !== null) {
      if (current.t === tracked2) {
        current.c = tracked2.c;
        return;
      }
      const next = current.n;
      if (next === null) {
        break;
      }
      current = next;
    }
    dependency = create_dependency(tracked2);
    current.n = dependency;
  }
}
function get_derived(computed) {
  update_derived(computed);
  if (tracking) {
    register_dependency(computed);
  }
  let value = computed.__v;
  const get2 = computed.a.get;
  if (get2 !== void 0) {
    value = trigger_track_get(get2, value);
    computed.__v = value;
  }
  if (value === SUSPENSE_PENDING || value === SUSPENSE_REJECTED) {
    throw ASYNC_DERIVED_READ_THROWN;
  }
  return value;
}
function get(t) {
  if (!is_ripple_object(t)) {
    return t;
  }
  return t.f & DERIVED ? get_derived(t) : get_tracked(t);
}
function get_tracked(tracked2) {
  let value = tracked2.__v;
  if (tracking) {
    register_dependency(tracked2);
  }
  if (value === SUSPENSE_PENDING || value === SUSPENSE_REJECTED) {
    throw ASYNC_DERIVED_READ_THROWN;
  }
  if (teardown && old_values.has(tracked2)) {
    value = old_values.get(tracked2);
  }
  const get2 = tracked2.a.get;
  if (get2 !== void 0) {
    value = trigger_track_get(get2, value);
  }
  return value;
}
function is_tracked_pending(t) {
  try {
    if (typeof t === "function") {
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
function peek_tracked(tracked2) {
  if (!is_ripple_object(tracked2)) {
    return tracked2;
  }
  return tracked2.__v;
}
function set(tracked2, value) {
  if (!is_mutating_allowed) {
    throw new Error('Assignments or updates to tracked values are not allowed during computed "track(() => ...)" evaluation');
  }
  const old_value = tracked2.__v;
  if (value !== old_value) {
    const tracked_block = tracked2.b;
    if (tracked_block !== null && (tracked_block.f & CONTAINS_TEARDOWN) !== 0) {
      if (teardown) {
        old_values.set(tracked2, value);
      } else {
        old_values.set(tracked2, old_value);
      }
    }
    const setFn = tracked2.a.set;
    if (setFn !== void 0) {
      value = untrack(() => setFn(value, old_value));
    }
    tracked2.__v = value;
    tracked2.c = increment_clock();
    schedule_update(tracked_block);
  }
}
function untrack(fn) {
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
function flush_sync(fn) {
  const previous_scheduler_mode = scheduler_mode;
  const previous_queued_root_blocks = queued_root_blocks;
  try {
    const root_blocks = [];
    scheduler_mode = FLUSH_SYNC;
    queued_root_blocks = root_blocks;
    is_micro_task_queued = false;
    flush_queued_root_blocks(previous_queued_root_blocks);
    const result = fn?.();
    if (queued_root_blocks.length > 0 || root_blocks.length > 0) {
      flush_sync();
    }
    flush_count = 0;
    return result;
  } finally {
    scheduler_mode = previous_scheduler_mode;
    queued_root_blocks = previous_queued_root_blocks;
  }
}
function trigger_track_get(fn, v) {
  let previous_is_mutating_allowed = is_mutating_allowed;
  try {
    is_mutating_allowed = false;
    return untrack(() => fn(v));
  } finally {
    is_mutating_allowed = previous_is_mutating_allowed;
  }
}
function spread_props(fn) {
  return proxy_props(fn);
}
function proxy_props(fn) {
  const memo = derived(fn, active_block);
  return new Proxy({}, {
    get(_, property) {
      const obj = get_derived(memo);
      if (is_array(obj)) {
        let item;
        for (let i = obj.length - 1; i >= 0; i--) {
          item = obj[i];
          if (property in item) {
            return item[property];
          }
        }
        return void 0;
      }
      return obj[property];
    },
    has(_, property) {
      if (property === TRACKED_OBJECT) {
        return true;
      }
      const obj = get_derived(memo);
      if (is_array(obj)) {
        for (let i = obj.length - 1; i >= 0; i--) {
          if (property in obj[i]) {
            return true;
          }
        }
        return false;
      }
      return property in obj;
    },
    getOwnPropertyDescriptor(_, key) {
      const obj = get_derived(memo);
      if (is_array(obj)) {
        let item;
        for (let i = obj.length - 1; i >= 0; i--) {
          item = obj[i];
          if (key in item) {
            return get_descriptor(item, key);
          }
        }
        return void 0;
      }
      if (key in obj) {
        return get_descriptor(obj, key);
      }
      return void 0;
    },
    ownKeys() {
      const obj = get_derived(memo);
      const done = {};
      const keys = [];
      if (is_array(obj)) {
        let item;
        for (let i = 0; i < obj.length; i++) {
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
    }
  });
}
function computed_property(fn) {
  define_property(fn, COMPUTED_PROPERTY, {
    value: true,
    enumerable: false
  });
  return fn;
}
function call_property(obj, property, chain_obj, chain_prop, ...args) {
  if (!chain_obj && !chain_prop) {
    return obj[property].call(obj, ...args);
  } else if (chain_obj && chain_prop) {
    return obj[property]?.call(obj, ...args);
  } else if (chain_obj) {
    return obj[property]?.call(obj, ...args);
  } else {
    return obj[property]?.call(obj, ...args);
  }
}
function get_property(obj, property, chain = false) {
  if (chain && obj == null) {
    return void 0;
  }
  const trackedVal = obj[property];
  if (trackedVal == null) {
    return trackedVal;
  }
  return get(trackedVal);
}
function set_property(obj, property, value) {
  const trackedVal = obj[property];
  set(trackedVal, value);
}
function update(tracked2, d = 1) {
  let value = get(tracked2);
  const result = d === 1 ? value++ : value--;
  set(tracked2, value);
  return result;
}
function increment(tracked2) {
  set(tracked2, tracked2.__v + 1);
}
function decrement(tracked2) {
  set(tracked2, tracked2.__v - 1);
}
function update_pre(tracked2, d = 1) {
  let value = get(tracked2);
  const new_value = d === 1 ? ++value : --value;
  set(tracked2, new_value);
  return new_value;
}
function update_property(obj, property, d = 1) {
  const trackedVal = obj[property];
  let value = get(trackedVal);
  const new_value = d === 1 ? value++ : value--;
  set(trackedVal, value);
  return new_value;
}
function update_pre_property(obj, property, d = 1) {
  const trackedVal = obj[property];
  let value = get(trackedVal);
  const new_value = d === 1 ? ++value : --value;
  set(trackedVal, new_value);
  return new_value;
}
function with_scope(block, fn) {
  const previous_scope = active_scope;
  try {
    active_scope = block;
    return fn();
  } finally {
    active_scope = previous_scope;
  }
}
function scope() {
  return active_scope || active_block;
}
function safe_scope(err = "Cannot access outside of a component context") {
  if (active_scope === null) {
    throw new Error(err);
  }
  return active_scope;
}
function create_component_ctx() {
  return {
    b: active_block,
    c: null,
    e: null,
    m: false,
    p: active_component
  };
}
function push_component() {
  const component = create_component_ctx();
  active_component = component;
}
function pop_component() {
  const component = active_component;
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
function exclude_from_object(obj, exclude_keys) {
  const keys = object_keys(obj);
  const new_obj = {};
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
function user_effect(fn) {
  if (active_block === null) {
    throw new Error("effect() must be called within an active context, such as a component or effect");
  }
  const component = active_component;
  if (component !== null && !component.m) {
    const e = component.e ??= [];
    e.push({
      b: active_block,
      fn,
      r: active_reaction
    });
    return;
  }
  return block(EFFECT_BLOCK, fn);
}
function effect(fn) {
  return block(EFFECT_BLOCK, fn);
}
function pre_effect(fn) {
  return block(PRE_EFFECT_BLOCK, fn);
}
function render(fn, state, flags = 0) {
  return block(RENDER_BLOCK | flags, fn, state);
}
function branch(fn, flags = 0, state = null) {
  return block(BRANCH_BLOCK | flags, fn, state);
}
function root(fn) {
  return block(ROOT_BLOCK, fn, { start: null, end: null }, create_component_ctx());
}
function create_try_block(fn, state) {
  return block(TRY_BLOCK, fn, state);
}
function boundary_fn_running_block(fn, flags = 0, state = null) {
  return branch(fn, DIRECT_CHILD_BLOCK | flags, state);
}
function push_block(block2, parent_block) {
  const parent_last = parent_block.last;
  if (parent_last === null) {
    parent_block.last = parent_block.first = block2;
  } else {
    parent_last.next = block2;
    block2.prev = parent_last;
    parent_block.last = block2;
  }
}
function block(flags, fn, state = null, co) {
  const newBlock = {
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
    tc: null
  };
  if (active_reaction !== null && (active_reaction.f & DERIVED) !== 0) {
    (active_reaction.blocks ??= []).push(newBlock);
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
function destroy_block_children(parent, remove_dom = false) {
  let block2 = parent.first;
  parent.first = parent.last = null;
  if (remove_dom || (parent.f & CONTAINS_TEARDOWN) !== 0) {
    while (block2 !== null) {
      const next = block2.next;
      destroy_block(block2, remove_dom);
      block2 = next;
    }
  }
}
function destroy_non_branch_children(parent, remove_dom = false) {
  let block2 = parent.first;
  if ((parent.f & CONTAINS_TEARDOWN) === 0 && parent.first !== null && (parent.first.f & BRANCH_BLOCK) === 0) {
    parent.first = parent.last = null;
  } else {
    while (block2 !== null) {
      const next = block2.next;
      if ((block2.f & BRANCH_BLOCK) === 0) {
        destroy_block(block2, remove_dom);
      }
      block2 = next;
    }
  }
}
function unlink_block(block2) {
  const parent = block2.p;
  const prev = block2.prev;
  const next = block2.next;
  if (prev !== null)
    prev.next = next;
  if (next !== null)
    next.prev = prev;
  if (parent !== null) {
    if (parent.first === block2)
      parent.first = next;
    if (parent.last === block2)
      parent.last = prev;
  }
}
function pause_block(block2) {
  if ((block2.f & PAUSED) !== 0) {
    return;
  }
  block2.f ^= PAUSED;
  let child = block2.first;
  while (child !== null) {
    const next = child.next;
    pause_block(child);
    child = next;
  }
  run_teardown(block2);
}
function resume_block(block2) {
  if ((block2.f & PAUSED) === 0) {
    return;
  }
  block2.f ^= PAUSED;
  if (is_block_dirty(block2)) {
    schedule_update(block2);
  }
  let child = block2.first;
  while (child !== null) {
    const next = child.next;
    resume_block(child);
    child = next;
  }
}
function is_destroyed(target_block) {
  let block2 = target_block;
  while (block2 !== null) {
    const flags = block2.f;
    if ((flags & DESTROYED) !== 0) {
      return true;
    }
    if ((flags & ROOT_BLOCK) !== 0) {
      return false;
    }
    block2 = block2.p;
  }
  return true;
}
function destroy_block(block2, remove_dom = true) {
  block2.f ^= DESTROYED;
  let removed = false;
  const f = block2.f;
  if (remove_dom && (f & (BRANCH_BLOCK | ROOT_BLOCK)) !== 0 && (f & TRY_BLOCK) === 0 || (f & HEAD_BLOCK) !== 0) {
    const s = block2.s;
    if (s !== null && s.start !== null) {
      removed = true;
    }
  }
  destroy_block_children(block2, remove_dom && !removed);
  run_teardown(block2);
  const parent = block2.p;
  if (parent !== null && parent.first !== null) {
    unlink_block(block2);
  }
  block2.fn = block2.s = block2.d = block2.p = block2.co = block2.t = null;
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
  _v;
  constructor(value) {
    this._v = value;
  }
  get() {
    let current = getActiveComponent();
    while (current) {
      if (current.c?.has(this))
        return current.c.get(this);
      current = current.p;
    }
    return this._v;
  }
  set(value) {
    const component = getActiveComponent();
    if (component === null)
      throw new Error("No active component found, cannot set context");
    let map = component.c;
    if (map === null)
      map = component.c = /* @__PURE__ */ new Map();
    map.set(this, value);
  }
}
function createContext(value) {
  return new Context(value);
}

// --- hydrate.js ---
function reactiveProps(props) {
  return new Proxy(props, {
    get(target, key) {
      const val = Reflect.get(target, key);
      if (typeof val === "object" && val !== null && typeof val.f === "number") {
        return get(val);
      }
      return val;
    }
  });
}
const _SHOW_COMMENT = 128;
const _FILTER_ACCEPT = 1;
const _FILTER_SKIP = 2;
function collectVskMarkers(container) {
  const markers = [];
  const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
    acceptNode: (node) => node.textContent === "vsk" ? _FILTER_ACCEPT : _FILTER_SKIP
  });
  while (walker.nextNode())
    markers.push(walker.currentNode);
  return markers;
}
function createHydrateWalker(container, markerList) {
  const markers = markerList || (container ? collectVskMarkers(container) : []);
  let markerIdx = 0;
  return {
    root: container,
    done() {
      return markerIdx >= markers.length;
    },
    nextElement(tag) {
      while (markerIdx < markers.length) {
        const marker = markers[markerIdx++];
        const el = marker.nextElementSibling;
        marker.remove();
        if (tag && (!el || el.tagName.toLowerCase() !== tag))
          continue;
        if (el) {
          for (let i = el.childNodes.length - 1; i >= 0; i--) {
            if (el.childNodes[i].nodeType === 3) {
              el.childNodes[i].remove();
            }
          }
        }
        return el || document.createElement(tag || "div");
      }
      return document.createElement(tag || "div");
    },
    subWalker(rootEl) {
      const subMarkers = markers.slice(markerIdx).filter((m) => {
        if (rootEl === m)
          return true;
        if (!rootEl || !m)
          return false;
        if (typeof rootEl.contains === "function")
          return rootEl.contains(m);
        return false;
      });
      markerIdx += subMarkers.length;
      return createHydrateWalker(rootEl, subMarkers);
    }
  };
}
function createHydrateChildWalker(parentEl) {
  let childIdx = 0;
  const children = parentEl ? parentEl.children : [];
  return {
    root: parentEl,
    done() {
      return childIdx >= children.length;
    },
    nextElement(tag) {
      while (childIdx < children.length) {
        const child = children[childIdx++];
        if (!tag || child.tagName.toLowerCase() === tag) {
          for (let i = child.childNodes.length - 1; i >= 0; i--) {
            if (child.childNodes[i].nodeType === 3) {
              child.childNodes[i].remove();
            }
          }
          return child;
        }
      }
      return document.createElement(tag || "div");
    },
    subWalker(rootEl) {
      return createHydrateChildWalker(rootEl);
    }
  };
}
function hydrate(container, componentFn, props) {
  const walker = createHydrateWalker(container);
  return componentFn(props || {}, /* @__PURE__ */ new Map(), walker);
}
function hydrateViewport(container, componentFn, props, rootMargin = 500) {
  if (document.readyState !== "complete") {
    return new Promise((resolve) => {
      const onLoad = () => {
        window.removeEventListener("load", onLoad);
        resolve(hydrateViewport(container, componentFn, props, rootMargin));
      };
      window.addEventListener("load", onLoad);
    });
  }
  const allMarkers = collectVskMarkers(container);
  const viewportMarkers = [];
  const deferredMarkers = [];
  for (const marker of allMarkers) {
    const el = marker.nextElementSibling;
    if (!el) {
      deferredMarkers.push(marker);
      continue;
    }
    const rect = el.getBoundingClientRect();
    if (rect.bottom < -rootMargin || rect.top > window.innerHeight + rootMargin) {
      deferredMarkers.push(marker);
    } else {
      viewportMarkers.push(marker);
    }
  }
  for (const marker of deferredMarkers) {
    marker.textContent = "vsk-hold";
  }
  const viewportWalker = createHydrateWalker(container, viewportMarkers);
  componentFn(props || {}, /* @__PURE__ */ new Map(), viewportWalker);
  if (deferredMarkers.length > 0) {
    return new Promise((resolve) => {
      const observer = new IntersectionObserver((entries) => {
        const toHydrate = [];
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target;
            const siblings = el.parentNode ? Array.from(el.parentNode.childNodes) : [];
            const heldMarker = siblings.find((n) => n.nodeType === 8 && n.textContent === "vsk-hold" && n.nextElementSibling === el);
            if (heldMarker) {
              heldMarker.textContent = "vsk";
              toHydrate.push(heldMarker);
            }
            observer.unobserve(el);
          }
        }
        if (toHydrate.length > 0) {
          const w = createHydrateWalker(container, toHydrate);
          componentFn(props || {}, /* @__PURE__ */ new Map(), w);
        }
        if (observer._observed === 0) {
          observer.disconnect();
          resolve();
        }
      }, { rootMargin: `${rootMargin}px` });
      observer._observed = deferredMarkers.length;
      for (const marker of deferredMarkers) {
        const el = marker.nextElementSibling;
        if (el)
          observer.observe(el);
      }
    });
  }
  return Promise.resolve();
}
function hydrateIdle(container, componentFn, props, options = {}) {
  const allMarkers = collectVskMarkers(container);
  const chunkSize = options.chunkSize || 10;
  const timeout = options.timeout || 3e3;
  let idx = 0;
  const rIC = window.requestIdleCallback || ((cb) => setTimeout(cb, 50));
  const cIC = window.cancelIdleCallback || clearTimeout;
  let rafId = null;
  let cancelled = false;
  function processChunk(deadline) {
    if (cancelled)
      return;
    const end = Math.min(idx + chunkSize, allMarkers.length);
    const chunk = allMarkers.slice(idx, end);
    idx = end;
    if (chunk.length > 0) {
      const walker = createHydrateWalker(container, chunk);
      componentFn(props || {}, /* @__PURE__ */ new Map(), walker);
    }
    if (idx < allMarkers.length && (!deadline || deadline.timeRemaining() > 0 || deadline.didTimeout)) {
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
    }
  };
}
function needsHydration(container) {
  const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
    acceptNode: (node) => node.textContent === "vsk" ? _FILTER_ACCEPT : _FILTER_SKIP
  });
  return walker.nextNode() !== null;
}
function hydrateOnInteraction(container, componentFn, props, options = {}) {
  const events = options.events || ["click", "touchstart", "focus", "mouseenter"];
  let hydrated = false;
  function trigger(_eventType) {
    if (hydrated)
      return;
    hydrated = true;
    for (const ev of events) {
      container.removeEventListener(ev, handler);
    }
    const markers = collectVskMarkers(container);
    if (markers.length > 0) {
      const walker = createHydrateWalker(container, markers);
      componentFn(props || {}, /* @__PURE__ */ new Map(), walker);
    }
  }
  const handler = (e) => trigger(e.type);
  for (const ev of events) {
    container.addEventListener(ev, handler, { once: true });
  }
  return {
    cancel() {
      hydrated = true;
      for (const ev of events)
        container.removeEventListener(ev, handler);
    },
    hydrateNow() {
      trigger("manual");
    }
  };
}
function hydrationCount(container) {
  let count = 0;
  const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
    acceptNode: (node) => {
      if (node.textContent === "vsk") {
        count++;
        return _FILTER_ACCEPT;
      }
      return _FILTER_SKIP;
    }
  });
  while (walker.nextNode())
    ;
  return count;
}

// --- resource.js ---
class HttpError extends Error {
  status;
  constructor(status, statusText) {
    super(`HTTP ${status}: ${statusText}`);
    this.status = status;
    this.name = "HttpError";
  }
}
class TimeoutError extends Error {
  constructor(timeout) {
    super(`Request timed out after ${timeout}ms`);
    this.name = "TimeoutError";
  }
}
const g = () => globalThis;
const isServer = () => !!g().__vsk_ssr;
function getClientCache() {
  const value = g().__vsk_fetch_cache;
  if (value)
    return value;
  const map = /* @__PURE__ */ new Map();
  g().__vsk_fetch_cache = map;
  return map;
}
function getInflight() {
  const value = g().__vsk_fetch_inflight;
  if (value)
    return value;
  const map = /* @__PURE__ */ new Map();
  g().__vsk_fetch_inflight = map;
  return map;
}
function getRegistry() {
  const value = g().__vsk_fetch_registry;
  if (value)
    return value;
  const map = /* @__PURE__ */ new Map();
  g().__vsk_fetch_registry = map;
  return map;
}
function getSsrData(key) {
  const store = g().__vsk_ssr_data;
  if (!store)
    return void 0;
  return store[key];
}
function setSsrData(key, value) {
  if (!g().__vsk_ssr_data)
    g().__vsk_ssr_data = {};
  g().__vsk_ssr_data[key] = value;
}
function clearSsrData() {
  delete g().__vsk_ssr_data;
}
function setInto(into, data) {
  if (into && typeof into === "object" && typeof into.f === "number") {
    set(into, data);
  }
}
function isAbortError(error) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}
function makeAbortError() {
  if (typeof DOMException !== "undefined")
    return new DOMException("aborted", "AbortError");
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}
function normalizeHeaders(headers) {
  const out = {};
  if (!headers)
    return out;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => out[key] = value);
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers)
      out[key] = value;
  } else {
    Object.assign(out, headers);
  }
  return out;
}
function prepareBody(body, headers) {
  if (body === void 0 || body === null)
    return { headers };
  if (typeof body === "string" || typeof body === "boolean" || typeof body === "number" || typeof FormData !== "undefined" && body instanceof FormData || typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams || typeof Blob !== "undefined" && body instanceof Blob || typeof ArrayBuffer !== "undefined" && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) {
    return { body, headers };
  }
  if (!headers["content-type"] && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return { body: JSON.stringify(body), headers };
}
function buildRequestInit(options) {
  const { method, credentials, cache, mode, redirect, referrer, referrerPolicy, integrity, keepalive } = options;
  const init = { method, credentials, cache, mode, redirect, referrer, referrerPolicy, integrity, keepalive };
  const prepared = prepareBody(options.body, normalizeHeaders(options.headers));
  init.headers = prepared.headers;
  if (prepared.body !== void 0)
    init.body = prepared.body;
  return init;
}
function resolveFetchUrl(url) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//"))
    return url;
  const reqUrl = g().__vesk_request?.url;
  const base = typeof reqUrl === "string" && /^https?:\/\//i.test(reqUrl) ? reqUrl : g().__vesk_ssr_base_url || "";
  if (base)
    return new URL(url, base).href;
  return url;
}
function createFetcher(url, options) {
  const init = buildRequestInit(options);
  return async (signal) => {
    const res = await fetch(resolveFetchUrl(url), signal ? { ...init, signal } : init);
    if (!res.ok)
      throw new HttpError(res.status, res.statusText);
    return res.json();
  };
}
function linkSignal(userSignal, controller) {
  if (!userSignal)
    return;
  if (userSignal.aborted)
    controller.abort();
  else
    userSignal.addEventListener("abort", () => controller.abort(), { once: true });
}
async function runFetcher(handle, timeout) {
  const { retry = 0, retryDelay = 1e3, method, signal } = handle.options;
  const maxAttempts = retry + 1;
  const canRetry = !method || method.toUpperCase() === "GET";
  let attempt = 0;
  let lastError;
  while (true) {
    if (handle.block !== null && is_destroyed(handle.block))
      throw makeAbortError();
    const controller = new AbortController();
    handle.controller = controller;
    linkSignal(signal, controller);
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
      if (timeout <= 0)
        return;
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(timeout));
      }, timeout);
    });
    try {
      const result = await Promise.race([handle.fetcher(controller.signal), timeoutPromise]);
      return result;
    } catch (error) {
      if (isAbortError(error))
        throw error;
      lastError = error;
      const retriable = canRetry && attempt < maxAttempts - 1 && !(error instanceof HttpError && error.status >= 400 && error.status < 500);
      if (!retriable)
        throw error;
      if (retryDelay > 0)
        await sleep(retryDelay * Math.pow(2, attempt));
      attempt++;
    } finally {
      if (timer !== null)
        clearTimeout(timer);
      if (handle.controller === controller)
        handle.controller = null;
    }
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function settle(handle, data) {
  if (handle.block !== null && is_destroyed(handle.block))
    return;
  if (handle.into)
    setInto(handle.into, data);
  const current = get(handle.state);
  if (current.data === data && !current.loading && current.error === null)
    return;
  set(handle.state, { loading: false, error: null, data });
}
function settleError(handle, error) {
  if (handle.block !== null && is_destroyed(handle.block))
    return;
  if (isAbortError(error)) {
    if (handle.controller !== null)
      return;
    const current2 = get(handle.state);
    if (current2.loading)
      set(handle.state, { loading: false, error: null, data: current2.data });
    return;
  }
  const current = get(handle.state);
  set(handle.state, { loading: false, error, data: current.data });
}
function markRefetching(handle) {
  const current = get(handle.state);
  if (current.loading)
    return;
  set(handle.state, {
    loading: true,
    error: null,
    data: handle.options.keepPreviousData ? current.data : void 0
  });
}
function attachSettle(handle, promise) {
  promise.then((data) => settle(handle, data), (error) => settleError(handle, error));
}
function writeCache(key, data) {
  if (isServer())
    return;
  const entry = getClientCache().get(key);
  if (!entry || entry.data !== data)
    getClientCache().set(key, { data, fetchedAt: Date.now() });
}
function trackSsrPromise(promise) {
  const tk = g().__vsk_ssr_token || "";
  const promisesKey = tk ? `__vsk_ssr_promises_${tk}` : "__vsk_ssr_promises";
  if (!g()[promisesKey])
    g()[promisesKey] = [];
  g()[promisesKey].push(promise);
}
function registerDestroyAbort(handle) {
  if (isServer() || handle.block === null)
    return;
  on_destroy(() => {
    if (is_destroyed(handle.block)) {
      handle.controller?.abort();
      const registry = getRegistry().get(handle.key);
      if (registry)
        registry.delete(handle);
    }
  });
}
function startRequest(handle, skipCache) {
  const key = handle.key;
  const options = handle.options;
  if (isServer()) {
    const existing = getInflight().get(key);
    const prom2 = existing ?? runFetcher(handle, options.timeout || 0);
    if (!existing) {
      getInflight().set(key, prom2);
      prom2.then((data) => {
        setSsrData(key, data);
        settle(handle, data);
      }, (error) => settleError(handle, error)).finally(() => {
        if (getInflight().get(key) === prom2)
          getInflight().delete(key);
      });
    } else {
      attachSettle(handle, prom2);
    }
    trackSsrPromise(prom2);
    return prom2;
  }
  if (!skipCache && options.staleTime && options.staleTime > 0) {
    const entry = getClientCache().get(key);
    if (entry && Date.now() - entry.fetchedAt < options.staleTime) {
      settle(handle, entry.data);
      return Promise.resolve(entry.data);
    }
  }
  if (options.dedupe !== false) {
    const existing = getInflight().get(key);
    if (existing) {
      attachSettle(handle, existing);
      return existing;
    }
  }
  markRefetching(handle);
  const controller = new AbortController();
  handle.controller = controller;
  linkSignal(options.signal, controller);
  const prom = runFetcher(handle, options.timeout || 0);
  prom.then((data) => {
    writeCache(key, data);
    settle(handle, data);
  }, (error) => settleError(handle, error)).finally(() => {
    if (options.dedupe !== false && getInflight().get(key) === prom)
      getInflight().delete(key);
  });
  if (options.dedupe !== false)
    getInflight().set(key, prom);
  registerDestroyAbort(handle);
  return prom;
}
function revalidate(handle) {
  if (!isServer()) {
    const registry = getRegistry().get(handle.key);
    if (registry && registry.size > 0) {
      const prev2 = getInflight().get(handle.key);
      if (prev2) {
        getInflight().delete(handle.key);
        registry.forEach((h) => h.controller?.abort());
      }
      registry.forEach((h) => startRequest(h, true));
      return;
    }
  }
  const prev = getInflight().get(handle.key);
  if (prev)
    getInflight().delete(handle.key);
  handle.controller?.abort();
  startRequest(handle, true);
}
function mutate(key, data) {
  if (isServer())
    return;
  const registry = getRegistry().get(key);
  const prev = getInflight().get(key);
  if (data !== void 0) {
    getClientCache().set(key, { data, fetchedAt: Date.now() });
    if (prev) {
      getInflight().delete(key);
      if (registry)
        registry.forEach((h) => h.controller?.abort());
    }
    if (registry) {
      registry.forEach((h) => {
        if (h.into)
          setInto(h.into, data);
        set(h.state, { loading: false, error: null, data });
      });
    }
    return;
  }
  if (registry && registry.size > 0) {
    if (prev) {
      getInflight().delete(key);
      registry.forEach((h) => h.controller?.abort());
    }
    registry.forEach((h) => startRequest(h, true));
  }
}
function createResourceAccessor(state) {
  function resource() {
    return get(state).data;
  }
  Object.defineProperty(resource, "loading", {
    get() {
      return get(state).loading;
    }
  });
  Object.defineProperty(resource, "error", {
    get() {
      return get(state).error;
    }
  });
  resource._state = state;
  return resource;
}
function createResource(fn, key, into, options = {}) {
  const resourceKey = key || options.key || fn._ssrKey || fn.toString().slice(0, 64);
  const handle = {
    key: resourceKey,
    state: tracked({ loading: true, error: null, data: void 0 }),
    into,
    fetcher: fn,
    options,
    block: scope(),
    controller: null
  };
  const accessor = createResourceAccessor(handle.state);
  accessor.refresh = () => revalidate(handle);
  accessor.abort = () => {
    if (!isServer())
      handle.controller?.abort();
  };
  if (options.enabled === false) {
    set(handle.state, { loading: false, error: null, data: void 0 });
    return accessor;
  }
  if (!isServer()) {
    const registry = getRegistry();
    const set2 = registry.get(resourceKey) ?? /* @__PURE__ */ new Set();
    set2.add(handle);
    registry.set(resourceKey, set2);
    if (handle.block !== null) {
      on_destroy(() => {
        if (is_destroyed(handle.block)) {
          handle.controller?.abort();
          const current = getRegistry().get(resourceKey);
          if (current)
            current.delete(handle);
        }
      });
    }
  }
  const ssrData = getSsrData(resourceKey);
  if (ssrData !== void 0) {
    settle(handle, ssrData);
    writeCache(resourceKey, ssrData);
    return accessor;
  }
  startRequest(handle, false);
  return accessor;
}
function useFetch(urlOrFn, options = {}) {
  const fetcher = typeof urlOrFn === "function" ? urlOrFn : createFetcher(urlOrFn, options);
  const key = options.key || (typeof urlOrFn === "string" ? urlOrFn : void 0);
  const resource = createResource(fetcher, key, options.into, options);
  return resource;
}
useFetch.text = (url, options) => useFetch(() => fetch(url, buildRequestInit(options ?? {})).then((r) => r.text()), {
  ...options,
  key: options?.key ?? url
});
useFetch.json = (url, options) => useFetch(() => fetch(url, buildRequestInit(options ?? {})).then((r) => r.json()), {
  ...options,
  key: options?.key ?? url
});
useFetch.arrayBuffer = (url, options) => useFetch(() => fetch(url, buildRequestInit(options ?? {})).then((r) => r.arrayBuffer()), {
  ...options,
  key: options?.key ?? url
});
async function resolveSsrResources() {
  const promises = g().__vsk_ssr_promises || [];
  if (promises.length === 0)
    return {};
  await Promise.allSettled(promises);
  const data = g().__vsk_ssr_data || {};
  delete g().__vsk_ssr_promises;
  return data;
}

// --- reconcile.js ---
function reconcile(anchor, endAnchor, items, keyFn, createItem) {
  const parent = anchor.parentNode;
  const map = /* @__PURE__ */ new Map();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = keyFn(item);
    const marker = document.createComment("k:" + key);
    const effs = [];
    parent.insertBefore(marker, endAnchor);
    createItem(item, i, effs);
    map.set(key, { marker, effs });
  }
  return (newItems) => {
    const newKeys = newItems.map(keyFn);
    const newSet = new Set(newKeys);
    for (const [key, { marker, effs }] of map) {
      if (!newSet.has(key)) {
        removeRange(marker, endAnchor);
        marker.remove();
        for (const e of effs)
          destroy_block(e);
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
        const marker = document.createComment("k:" + key);
        const effs = [];
        parent.insertBefore(marker, ref);
        createItem(newItems[i], i, effs);
        map.set(key, { marker, effs });
        ref = marker;
      }
    }
  };
}
function removeRange(start, end) {
  let n = start.nextSibling;
  while (n && n !== end && !(n.nodeType === 8 && n.nodeValue && n.nodeValue.startsWith("k:"))) {
    const next = n.nextSibling;
    n.remove();
    n = next;
  }
}
function moveBefore(marker, endAnchor, ref) {
  const nodes = [];
  let n = marker.nextSibling;
  while (n && n !== endAnchor && !(n.nodeType === 8 && n.nodeValue && n.nodeValue.startsWith("k:"))) {
    nodes.push(n);
    n = n.nextSibling;
  }
  const parent = marker.parentNode;
  parent.insertBefore(marker, ref);
  for (const node of nodes)
    parent.insertBefore(node, ref);
}

// --- bindings.js ---
function not_tracked_type_error(name) {
  return new TypeError(`${name} argument is not a tracked object`);
}
function not_set_function_type_error(name) {
  return new TypeError(`${name} second argument must be a set function when first argument is a get function`);
}
function get_bind_get_set(name, maybe_tracked, set_func) {
  if (typeof maybe_tracked === "function") {
    if (typeof set_func !== "function") {
      throw not_set_function_type_error(name);
    }
    return {
      getter: maybe_tracked,
      setter: set_func
    };
  } else {
    if (!is_ripple_object(maybe_tracked)) {
      throw not_tracked_type_error(name);
    }
    const obj = maybe_tracked;
    return {
      getter: () => get(obj),
      setter: (value) => set(obj, value)
    };
  }
}
function is_numberlike_input(input) {
  const type = input.type;
  return type === "number" || type === "range";
}
function to_number(value) {
  return value === "" ? null : +value;
}
function bindValue(maybe_tracked, set_func) {
  const { getter, setter } = get_bind_get_set("bindValue()", maybe_tracked, set_func);
  return (node) => {
    if (node.tagName === "SELECT") {
      const select = node;
      const onChange = () => {
        const value = select.multiple ? [].map.call(select.querySelectorAll(":checked"), (o) => o.value) : select.value;
        setter(value);
      };
      select.addEventListener("change", onChange);
      effect(() => {
        const value = getter();
        if (select.multiple) {
          for (const option of select.options) {
            option.selected = (value || []).includes(option.value);
          }
        } else {
          select.value = value ?? "";
        }
      });
      return () => select.removeEventListener("change", onChange);
    } else {
      const input = node;
      const onInput = () => {
        let value = input.value;
        value = is_numberlike_input(input) ? to_number(value) : value;
        setter(value);
      };
      input.addEventListener("input", onInput);
      render(() => {
        const value = getter();
        if (is_numberlike_input(input) && value === to_number(input.value)) {
          return;
        }
        if (value !== input.value) {
          input.value = value ?? "";
        }
      });
      return () => input.removeEventListener("input", onInput);
    }
  };
}
function bindChecked(maybe_tracked, set_func) {
  const { getter, setter } = get_bind_get_set("bindChecked()", maybe_tracked, set_func);
  return (input) => {
    const onChange = () => {
      setter(input.checked);
    };
    input.addEventListener("change", onChange);
    effect(() => {
      const value = getter();
      input.checked = Boolean(value);
    });
    return () => input.removeEventListener("change", onChange);
  };
}
function bindGroup(maybe_tracked, set_func) {
  const { getter, setter } = get_bind_get_set("bindGroup()", maybe_tracked, set_func);
  return (input) => {
    const is_checkbox = input.getAttribute("type") === "checkbox";
    const onChange = () => {
      const value = input.value;
      let result;
      if (is_checkbox) {
        const list = getter() || [];
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
    input.addEventListener("change", onChange);
    effect(() => {
      let value = getter();
      if (is_checkbox) {
        value = value || [];
        input.checked = value.includes(input.value);
      } else {
        input.checked = value === input.value;
      }
    });
    return () => input.removeEventListener("change", onChange);
  };
}

// --- router-match.js ---
function compileRoutePattern(fullPath) {
  const paramNames = [];
  const parts = fullPath.split("/").filter(Boolean);
  let regexStr = "^";
  for (const part of parts) {
    if (part.startsWith(":")) {
      const name = part.slice(1);
      paramNames.push(name);
      regexStr += "/([^/]+)";
    } else if (part === "*") {
      regexStr += "(?:/(.*))?";
    } else {
      regexStr += "/" + part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  regexStr += "$";
  return { regex: new RegExp(regexStr), paramNames };
}
function collectLayouts(nodes, pathParts) {
  const layouts = [];
  for (const node of nodes) {
    if (node.isGroup) {
      const childLayouts = collectLayouts(node.children || [], pathParts);
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
      if (remaining.length > 0 && (node.children || []).length > 0) {
        const childLayouts = collectLayouts(node.children || [], remaining);
        layouts.push(...childLayouts);
      }
    }
  }
  return layouts;
}
function matchRouteNode(node, pathParts) {
  if (node.isGroup)
    return false;
  if (pathParts.length === 0)
    return node.fullPath === "/";
  const part = pathParts[0];
  if (node.isCatchAll)
    return true;
  if (node.isDynamic)
    return true;
  return node.path === part;
}
function extractParams(node, pathParts) {
  const params = {};
  let idx = 0;
  for (const n of node._matchChain || []) {
    if (n.isDynamic && pathParts[idx]) {
      const name = n.path.slice(1);
      params[name] = decodeURIComponent(pathParts[idx]);
    } else if (n.isCatchAll) {
      const name = n.path.slice(1);
      params[name] = pathParts.slice(idx).map(decodeURIComponent).join("/");
    }
    if (!n.isGroup)
      idx++;
  }
  return params;
}
function flattenLayoutChain(tree, pathParts, result = []) {
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    if (node.isGroup) {
      flattenLayoutChain(node.children || [], pathParts, result);
      continue;
    }
    const part = pathParts[0];
    const segCount = node.segmentCount != null ? node.segmentCount : 1;
    let matched = false;
    if (node.fullPath === "/") {
      matched = true;
    } else if (node.isCatchAll) {
      matched = true;
    } else if (node.isDynamic) {
      matched = part !== void 0;
    } else {
      matched = node.path === part;
    }
    if (matched) {
      const consumeCount = node.isCatchAll ? pathParts.length : segCount;
      const remaining = pathParts.slice(consumeCount);
      const isLeaf = remaining.length === 0 || remaining.every((p) => p === "");
      result.push(node);
      if (isLeaf) {
        break;
      } else if ((node.children || []).length > 0) {
        flattenLayoutChain(node.children || [], remaining, result);
        break;
      }
    }
  }
  return result;
}
function matchRoute(tree, pathname) {
  const pathParts = pathname.split("/").filter(Boolean);
  const matchChain = flattenLayoutChain(tree, pathParts);
  if (matchChain.length === 0)
    return null;
  const params = {};
  let partIdx = 0;
  for (const node of matchChain) {
    const segCount = node.segmentCount != null ? node.segmentCount : 1;
    if (node.isDynamic && !node.isCatchAll) {
      const name = node.path.startsWith(":") ? node.path.slice(1) : node.path;
      if (partIdx < pathParts.length) {
        params[name] = decodeURIComponent(pathParts[partIdx]);
      }
    }
    if (node.isCatchAll) {
      const name = node.path.startsWith(":") ? node.path.slice(1) : node.path;
      params[name] = pathParts.slice(partIdx).map(decodeURIComponent).join("/");
    }
    partIdx += segCount;
  }
  return { matchChain, params };
}
function buildTreeFromMap(routes, _options) {
  const root = [];
  for (const [pattern, loader] of Object.entries(routes)) {
    const parts = pattern.split("/").filter(Boolean);
    const isDynamic = parts.some((p) => p.startsWith(":"));
    const isCatchAll = parts.some((p) => p.startsWith("..."));
    const node = {
      path: parts[parts.length - 1] || "",
      fullPath: pattern,
      isGroup: false,
      isDynamic,
      isCatchAll,
      page: loader,
      layout: null,
      loading: null,
      error: null,
      notFound: null,
      children: [],
      segmentCount: parts.length || 1,
      loader
    };
    root.push(node);
  }
  return root;
}

// --- router-components.js ---
class Redirect extends Error {
  url;
  status;
  constructor(url, status = 302) {
    super(`Redirect to ${url}`);
    this.url = url;
    this.status = status;
    this.name = "Redirect";
  }
}
function redirect(url, status = 302) {
  throw new Redirect(url, status);
}
function permanentRedirect(url) {
  throw new Redirect(url, 308);
}
class NotFoundError extends Error {
  constructor(msg = "Not Found") {
    super(msg);
    this.name = "NotFoundError";
  }
}
function notFound() {
  throw new NotFoundError();
}
const RouterCtx = createContext(null);
let _currentRouter = null;
let _outletId = 0;
let __isHydrating = false;
function setIsHydrating(v) {
  __isHydrating = v;
}
const _state = {
  path: track("/"),
  params: track({}),
  search: track("")
};
const _scrollPositions = /* @__PURE__ */ new Map();
let _isPopStateNavigation = false;
function setIsPopStateNavigation(v) {
  _isPopStateNavigation = v;
}
function setCurrentRouter(r) {
  _currentRouter = r;
}
function getCurrentRouter() {
  return _currentRouter;
}
function findLoadingComponent(chain) {
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].loading)
      return chain[i].loading;
  }
  return null;
}
function findErrorComponent(chain) {
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].error)
      return chain[i].error;
  }
  return null;
}
function findNotFoundComponent(chain) {
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].notFound)
      return chain[i].notFound;
  }
  return null;
}
function showLoadingInContainer(container, loadingFn, params) {
  const tempRoot = document.createDocumentFragment();
  const walker = createHydrateWalker(tempRoot, []);
  const loadingContent = loadingFn({ params }, /* @__PURE__ */ new Map(), walker);
  container.replaceChildren();
  if (loadingContent && typeof loadingContent === "object" && loadingContent.nodeType) {
    container.appendChild(loadingContent);
  } else if (typeof loadingContent === "string") {
    container.innerHTML = loadingContent;
  }
}
function handleScroll(pathname, isReplace) {
  if (typeof window === "undefined" || typeof window.scrollTo !== "function")
    return;
  if (_isPopStateNavigation) {
    setIsPopStateNavigation(false);
    const savedY = _scrollPositions.get(pathname);
    requestAnimationFrame(() => {
      window.scrollTo(0, savedY !== void 0 ? savedY : 0);
    });
  } else if (!isReplace) {
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }
}
const HEAD_MARKER = "data-vesk-head";
function applyHead(headHtml) {
  if (typeof document === "undefined" || !headHtml)
    return;
  const head = document.head;
  if (!head)
    return;
  for (const el of Array.from(head.querySelectorAll("[" + HEAD_MARKER + "]"))) {
    el.remove();
  }
  const titleMatch = headHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const existing = head.querySelector("title");
    if (existing)
      existing.textContent = titleMatch[1];
    else {
      const t = document.createElement("title");
      t.textContent = titleMatch[1];
      head.appendChild(t);
    }
  }
  for (const m of headHtml.matchAll(/<meta\b([^>]*)>/gi)) {
    const meta = document.createElement("meta");
    const raw = m[1] || "";
    for (const attrMatch of raw.matchAll(/([a-zA-Z0-9\-:]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      const name = attrMatch[1];
      const value = attrMatch[3] ?? attrMatch[4] ?? "";
      if (name.toLowerCase() === "charset")
        continue;
      meta.setAttribute(name, value);
    }
    if (!meta.hasAttributes())
      continue;
    meta.setAttribute(HEAD_MARKER, "");
    head.appendChild(meta);
  }
}
function Outlet(props) {
  const router = RouterCtx.get();
  if (!router)
    return document.createComment("outlet");
  const div = document.createElement("div");
  div.setAttribute("data-vesk-outlet", String(_outletId++));
  div.style.display = "contents";
  if (router._outletPlaceholders) {
    router._outletPlaceholders.push(div);
  }
  const seg = router._currentSegments && router._currentSegments[router._depth || 0];
  if (seg && seg.rendered) {
    div.appendChild(seg.rendered);
  }
  return div;
}
function Link(props, registry, hydrate) {
  const href = props.href || "#";
  if (hydrate && hydrate.nextElement) {
    let a2 = hydrate.nextElement("a");
    if (a2 && !a2.parentNode && hydrate.root) {
      const existing = hydrate.root.querySelector("a");
      if (existing)
        a2 = existing;
    }
    if (props.children != null) {
      if (typeof props.children === "string" || typeof props.children === "number") {
        a2.textContent = String(props.children);
      } else if (props.children.textContent) {
        a2.textContent = props.children.textContent;
      }
    }
    a2.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
        return;
      if (props.target === "_blank")
        return;
      e.preventDefault();
      e.stopPropagation();
      const nav = useNavigate();
      nav(href);
    });
    return document.createDocumentFragment();
  }
  const attrs = [
    `href="${href.replace(/"/g, "&quot;")}"`,
    props.class ? `class="${String(props.class).replace(/"/g, "&quot;")}"` : "",
    props.style ? `style="${String(props.style).replace(/"/g, "&quot;")}"` : "",
    props.target ? `target="${String(props.target).replace(/"/g, "&quot;")}"` : "",
    props.rel ? `rel="${String(props.rel).replace(/"/g, "&quot;")}"` : ""
  ].filter(Boolean).join(" ");
  let childStr = "";
  if (props.children != null) {
    childStr = typeof props.children === "string" ? props.children : typeof props.children === "number" ? String(props.children) : "";
  }
  if (typeof document === "undefined") {
    return `<a ${attrs}>${childStr}</a>`;
  }
  const a = document.createElement("a");
  a.href = href;
  if (props.class)
    a.className = props.class;
  if (props.style)
    a.setAttribute("style", props.style);
  if (props.target)
    a.target = props.target;
  if (props.rel)
    a.rel = props.rel;
  if (childStr) {
    a.textContent = childStr;
  } else if (props.children != null) {
    if (props.children.nodeType) {
      a.appendChild(props.children);
    } else if (Array.isArray(props.children)) {
      for (const c of props.children) {
        if (c && c.nodeType)
          a.appendChild(c);
        else if (c != null)
          a.appendChild(document.createTextNode(String(c)));
      }
    }
  }
  a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
      return;
    if (props.target === "_blank")
      return;
    e.preventDefault();
    e.stopPropagation();
    const nav = useNavigate();
    nav(href);
  });
  return a;
}
function NavLink(props, registry, hydrate) {
  if (typeof document === "undefined") {
    return Link(props, registry, hydrate);
  }
  if (__isHydrating) {
    const a2 = document.querySelector(`a[href="${props.href}"]`);
    if (a2) {
      if (props.children != null) {
        if (typeof props.children === "string" || typeof props.children === "number") {
          a2.textContent = String(props.children);
        } else if (props.children.textContent) {
          a2.textContent = props.children.textContent;
        }
      }
      a2.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
          return;
        if (props.target === "_blank")
          return;
        e.preventDefault();
        e.stopPropagation();
        const nav = useNavigate();
        nav(props.href);
      });
      const path2 = usePathname();
      const isActive2 = props.href === path2 || props.href !== "/" && path2.startsWith(props.href) && (path2.length === props.href.length || path2[props.href.length] === "/" || path2[props.href.length] === "?");
      if (isActive2) {
        a2.classList.add(props.activeClass || "active");
        if (props.ariaCurrent !== false)
          a2.setAttribute("aria-current", "page");
      }
      return document.createDocumentFragment();
    }
  }
  const a = Link(props, registry, hydrate);
  const path = usePathname();
  const isActive = props.href === path || props.href !== "/" && path.startsWith(props.href) && (path.length === props.href.length || path[props.href.length] === "/" || path[props.href.length] === "?");
  if (isActive) {
    a.classList.add(props.activeClass || "active");
    if (props.ariaCurrent !== false)
      a.setAttribute("aria-current", "page");
  }
  return a;
}
function useNavigate() {
  const router = RouterCtx.get() || _currentRouter;
  return (path, opts = {}) => {
    if (router && router.navigate) {
      router.navigate(path, opts);
    } else {
      window.history.pushState({}, "", path);
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
  const sp = new URLSearchParams(s || "");
  const setter = (next) => {
    const q = typeof next === "string" ? next : new URLSearchParams(next).toString();
    _state.search.value = q;
    const nav = useNavigate();
    const path = get(_state.path);
    nav(path + (q ? "?" + q : ""), { replace: true });
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
    prefetch: (href) => router?.prefetch?.(href)
  };
}

// --- router.js ---
const loadedChunks = /* @__PURE__ */ new Set();
function ensureChunk(chunkUrl) {
  if (!chunkUrl || loadedChunks.has(chunkUrl))
    return Promise.resolve();
  loadedChunks.add(chunkUrl);
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = chunkUrl;
    s.onload = () => resolve();
    s.onerror = () => {
      loadedChunks.delete(chunkUrl);
      reject(new Error(`Failed to load chunk: ${chunkUrl}`));
    };
    document.head.appendChild(s);
  });
}
function hasPendingChunks(nodes) {
  const urls = [];
  function walk(n) {
    if (n._chunk && !loadedChunks.has(n._chunk))
      urls.push(n._chunk);
    if (n.children)
      n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return urls;
}
const _dataPromises = /* @__PURE__ */ new Map();
async function fetchRouteData(path) {
  try {
    const res = await fetch(path, { headers: { "X-Vesk-Data": "1" }, credentials: "same-origin" });
    if (res.redirected && res.url) {
      const finalUrl = new URL(res.url);
      const requested = new URL(path, window.location.origin);
      if (finalUrl.pathname !== requested.pathname || finalUrl.search !== requested.search) {
        return { redirect: finalUrl.pathname + finalUrl.search };
      }
    }
    if (res.status === 404)
      return { notFound: true };
    if (!res.ok)
      return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json"))
      return null;
    return await res.json();
  } catch {
    return null;
  }
}
function getRouteData(path) {
  const key = path;
  const existing = _dataPromises.get(key);
  if (existing)
    return existing;
  const p = fetchRouteData(key).finally(() => {
    _dataPromises.delete(key);
  });
  _dataPromises.set(key, p);
  return p;
}
function findPageNode(match) {
  const chain = match.matchChain;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].page)
      return chain[i];
  }
  return null;
}
function renderNotFound(router, match, container) {
  const chain = match.matchChain;
  const paramValues = match.params;
  const notFoundFn = findNotFoundComponent(chain);
  if (notFoundFn) {
    const tempRoot = document.createDocumentFragment();
    const walker = createHydrateWalker(tempRoot, []);
    const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
    const nfDom = notFoundFn(nfProps, /* @__PURE__ */ new Map(), walker);
    if (nfDom && typeof nfDom === "object" && nfDom.nodeType) {
      if (container.replaceChildren)
        container.replaceChildren(nfDom);
      else {
        container.innerHTML = "";
        container.appendChild(nfDom);
      }
    } else if (typeof nfDom === "string") {
      container.innerHTML = nfDom;
    }
    return;
  }
  if (container.replaceChildren)
    container.replaceChildren();
  else
    container.innerHTML = "";
  container.innerHTML = "<h1>404 \u2014 Not Found</h1>";
  router._currentMatch = match;
}
function applyRouteData(router, match, data, container, render = renderMatch) {
  if (data.notFound) {
    renderNotFound(router, match, container);
    return;
  }
  const pathname = match.pathname || window.location.pathname;
  const pageNode = findPageNode(match);
  if (pageNode && data.props) {
    pageNode.props = data.props;
    pageNode._dataPath = pathname;
  }
  if (data.head) {
    applyHead(data.head);
    if (pageNode)
      pageNode._head = data.head;
  }
  render(router, match, container);
  router._currentMatch = match;
}
function shouldFetchData(router, match) {
  const pageNode = findPageNode(match);
  if (!pageNode)
    return false;
  const pathname = match.pathname || window.location.pathname;
  return pageNode._dataPath !== pathname;
}
function storePrefetchedData(match, data) {
  if (!data || data.notFound || data.redirect)
    return;
  const pathname = match.pathname || window.location.pathname;
  const pageNode = findPageNode(match);
  if (pageNode && data.props) {
    pageNode.props = data.props;
    pageNode._dataPath = pathname;
  }
  if (data.head && pageNode)
    pageNode._head = data.head;
}
function renderMatch(router, match, container) {
  const chain = match.matchChain;
  const paramValues = match.params;
  let pageNode = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].page) {
      pageNode = chain[i];
      break;
    }
  }
  if (!pageNode) {
    const notFoundFn = findNotFoundComponent(chain);
    if (notFoundFn) {
      const tempRoot2 = document.createDocumentFragment();
      const walker = createHydrateWalker(tempRoot2, []);
      const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
      const nfDom = notFoundFn(nfProps, /* @__PURE__ */ new Map(), walker);
      if (nfDom && typeof nfDom === "object" && nfDom.nodeType) {
        if (container.replaceChildren)
          container.replaceChildren(nfDom);
        else {
          container.innerHTML = "";
          container.appendChild(nfDom);
        }
      } else if (typeof nfDom === "string") {
        container.innerHTML = nfDom;
      }
      return;
    }
    if (container.replaceChildren) {
      container.replaceChildren();
    } else {
      container.innerHTML = "";
    }
    container.innerHTML = "<h1>404 \u2014 Not Found</h1>";
    return;
  }
  const layoutNodes = chain.filter((n) => n.layout);
  const tempRoot = document.createDocumentFragment();
  const clientWalker = createHydrateWalker(tempRoot, []);
  function renderLayoutChain(index) {
    if (index >= layoutNodes.length) {
      set(_state.params, paramValues);
      set(_state.path, match.pathname || window.location.pathname);
      set(_state.search, window.location.search || "");
      const pageProps = { params: paramValues, ...pageNode.props };
      const result2 = pageNode.page(pageProps, /* @__PURE__ */ new Map(), clientWalker);
      if (router && pageNode._pageName && result2 && result2.nodeType === 1) {
        if (!router.__componentInstances)
          router.__componentInstances = /* @__PURE__ */ new Map();
        const name = pageNode._pageName;
        if (!router.__componentInstances.has(name))
          router.__componentInstances.set(name, []);
        router.__componentInstances.get(name).push({ root: result2, props: pageProps, node: pageNode, type: "page" });
      }
      return result2;
    }
    const node = layoutNodes[index];
    const childDom = renderLayoutChain(index + 1);
    const layoutProps = { children: childDom, params: paramValues };
    const result = node.layout(layoutProps, /* @__PURE__ */ new Map(), clientWalker);
    if (router && node._layoutName && result && result.nodeType === 1) {
      if (!router.__componentInstances)
        router.__componentInstances = /* @__PURE__ */ new Map();
      const name = node._layoutName;
      if (!router.__componentInstances.has(name))
        router.__componentInstances.set(name, []);
      router.__componentInstances.get(name).push({ root: result, props: layoutProps, node, type: "layout" });
    }
    return result;
  }
  let rootDom;
  try {
    root(() => {
      rootDom = renderLayoutChain(0);
    });
  } catch (error) {
    if (error && error.name === "NotFoundError") {
      const notFoundFn = findNotFoundComponent(chain);
      if (notFoundFn) {
        const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
        const nfDom = notFoundFn(nfProps, /* @__PURE__ */ new Map(), clientWalker);
        if (nfDom && typeof nfDom === "object" && nfDom.nodeType) {
          if (container.replaceChildren)
            container.replaceChildren(nfDom);
          else {
            container.innerHTML = "";
            container.appendChild(nfDom);
          }
        } else if (typeof nfDom === "string") {
          container.innerHTML = nfDom;
        }
        return;
      }
      container.innerHTML = "<h1>404 \u2014 Not Found</h1>";
      return;
    }
    const errorFn = findErrorComponent(chain);
    if (errorFn) {
      const retry = () => {
        if (router && router.navigate) {
          router.navigate(window.location.pathname, { replace: true });
        }
      };
      const errorProps = { error, retry, params: paramValues };
      const errorDom = errorFn(errorProps, /* @__PURE__ */ new Map(), clientWalker);
      if (errorDom && typeof errorDom === "object" && errorDom.nodeType) {
        if (container.replaceChildren)
          container.replaceChildren(errorDom);
        else {
          container.innerHTML = "";
          container.appendChild(errorDom);
        }
      } else if (typeof errorDom === "string") {
        container.innerHTML = errorDom;
      }
      return;
    }
    throw error;
  }
  if (rootDom && typeof rootDom === "object" && rootDom.nodeType) {
    if (container.replaceChildren) {
      container.replaceChildren(rootDom);
    } else {
      container.innerHTML = "";
      container.appendChild(rootDom);
    }
  } else if (typeof rootDom === "string") {
    container.innerHTML = rootDom;
  }
}
function hydrateInitial(router, match, container, strategy) {
  const chain = match.matchChain;
  const paramValues = match.params;
  let pageNode = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (chain[i].page) {
      pageNode = chain[i];
      break;
    }
  }
  if (!pageNode) {
    const notFoundFn = findNotFoundComponent(chain);
    if (notFoundFn) {
      const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
      const walker2 = createHydrateWalker(container);
      root(() => {
        notFoundFn(nfProps, /* @__PURE__ */ new Map(), walker2);
      });
      return;
    }
    container.innerHTML = "<h1>404 \u2014 Not Found</h1>";
    return;
  }
  const layoutNodes = chain.filter((n) => n.layout);
  set(_state.params, paramValues);
  set(_state.path, match.pathname || window.location.pathname);
  set(_state.search, window.location.search || "");
  const hydrators = router.__hydrators;
  const hydPage = hydrators && pageNode._pageName ? hydrators[pageNode._pageName] || pageNode.page : pageNode.page;
  const hydLayouts = layoutNodes.map((n) => {
    if (hydrators && n._layoutName) {
      return hydrators[n._layoutName] || n.layout;
    }
    return n.layout;
  });
  if (layoutNodes.length === 0) {
    if (!strategy || strategy === "full") {
      const walker2 = createHydrateWalker(container);
      setIsHydrating(true);
      root(() => {
        hydPage({ params: paramValues, ...pageNode.props }, /* @__PURE__ */ new Map(), walker2);
      });
      setIsHydrating(false);
    } else if (strategy === "viewport") {
      hydrateViewport(container, hydPage, { params: paramValues, ...pageNode.props });
    } else if (strategy === "idle") {
      hydrateIdle(container, hydPage, { params: paramValues, ...pageNode.props });
    } else if (strategy === "interaction") {
      hydrateOnInteraction(container, hydPage, { params: paramValues, ...pageNode.props });
    }
    return;
  }
  setIsHydrating(true);
  function renderLayoutChain(index) {
    if (index >= layoutNodes.length) {
      return (subWalker) => {
        if (!strategy || strategy === "full") {
          hydPage({ params: paramValues, ...pageNode.props }, /* @__PURE__ */ new Map(), subWalker);
        } else if (strategy === "viewport") {
          hydrateViewport(subWalker.root, hydPage, { params: paramValues, ...pageNode.props });
        } else if (strategy === "idle") {
          hydrateIdle(subWalker.root, hydPage, { params: paramValues, ...pageNode.props });
        } else if (strategy === "interaction") {
          hydrateOnInteraction(subWalker.root, hydPage, { params: paramValues, ...pageNode.props });
        }
      };
    }
    const node = layoutNodes[index];
    const hydLayout = hydLayouts[index];
    const childHydrator = renderLayoutChain(index + 1);
    const layoutProps = { children: childHydrator, params: paramValues };
    hydLayout(layoutProps, /* @__PURE__ */ new Map(), walker);
    return null;
  }
  const walker = createHydrateWalker(container);
  root(() => {
    renderLayoutChain(0);
  });
  setIsHydrating(false);
}
function createRouter(routes, options = {}) {
  const container = options.container || document.getElementById("root");
  const prefetch = options.prefetch !== false;
  const hydrateStrategy = options.hydrate || "full";
  const routeTree = Array.isArray(routes) ? routes : buildTreeFromMap(routes, options);
  const router = {
    routeTree,
    container,
    _currentMatch: null,
    _outletPlaceholders: [],
    _currentSegments: null,
    _depth: 0,
    start() {
      setCurrentRouter(this);
      if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
        window.history.scrollRestoration = "manual";
      }
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        let _scrollTimer = null;
        window.addEventListener("scroll", () => {
          if (_scrollTimer)
            return;
          _scrollTimer = setTimeout(() => {
            if (window.scrollY !== void 0) {
              _scrollPositions.set(window.location.pathname, window.scrollY);
            }
            _scrollTimer = null;
          }, 100);
        }, { passive: true });
      }
      document.addEventListener("click", (e) => {
        const link = e.target?.nodeType === 1 ? e.target.closest("a[href]") : null;
        if (!link)
          return;
        if (link.hostname && link.hostname !== window.location.hostname)
          return;
        const href = link.getAttribute("href");
        if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:"))
          return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
          return;
        e.preventDefault();
        this.navigate(href);
      });
      window.addEventListener("popstate", () => {
        setIsPopStateNavigation(true);
        this.navigate(window.location.href, { replace: true });
      });
      if (prefetch) {
        document.addEventListener("mouseenter", (e) => {
          const link = e.target?.nodeType === 1 ? e.target.closest("a[href]") : null;
          if (link)
            this.prefetch(link.getAttribute("href"));
        }, { passive: true });
      }
      const path = window.location.pathname + window.location.search;
      if (container.children.length > 0) {
        const url = new URL(path, window.location.origin);
        const match = matchRoute(this.routeTree, url.pathname);
        if (match) {
          match.pathname = url.pathname;
          hydrateInitial(this, match, container, hydrateStrategy);
          this._currentMatch = match;
        } else {
          this.navigate(path, { replace: true });
        }
      } else {
        this.navigate(path, { replace: true });
      }
      return this;
    },
    navigate(path, opts = {}) {
      const url = new URL(path, window.location.origin);
      const match = matchRoute(this.routeTree, url.pathname);
      if (!match) {
        window.location.href = path;
        return;
      }
      match.pathname = url.pathname;
      if (!_isPopStateNavigation) {
        _scrollPositions.set(window.location.pathname, window.scrollY);
      }
      const loadingFn = findLoadingComponent(match.matchChain);
      this._navToken = (this._navToken || 0) + 1;
      const navToken = this._navToken;
      let firstRenderFailed = false;
      const doRender = () => {
        if (!opts.replace) {
          window.history.pushState({ path: url.pathname }, "", url.pathname);
        } else {
          window.history.replaceState({ path: url.pathname }, "", url.pathname);
        }
        set(_state.path, url.pathname);
        set(_state.search, url.search);
        try {
          renderMatch(this, match, this.container);
        } catch (e) {
          firstRenderFailed = true;
          throw e;
        }
        this._currentMatch = match;
        handleScroll(url.pathname, opts.replace);
      };
      const fetchData = () => {
        if (firstRenderFailed)
          return;
        if (!shouldFetchData(this, match))
          return;
        getRouteData(url.pathname + url.search).then((data) => {
          if (navToken !== this._navToken)
            return;
          if (!data)
            return;
          if (data.redirect) {
            this.navigate(data.redirect, { replace: true });
            return;
          }
          applyRouteData(this, match, data, this.container);
        });
      };
      if (loadingFn) {
        showLoadingInContainer(this.container, loadingFn, match.params);
        Promise.resolve().then(() => {
          try {
            doRender();
          } finally {
            fetchData();
          }
        });
      } else {
        try {
          doRender();
        } finally {
          fetchData();
        }
      }
    },
    prefetch(path) {
      const url = new URL(path, window.location.origin);
      const match = matchRoute(this.routeTree, url.pathname);
      if (!match)
        return;
      match.pathname = url.pathname;
      this._prefetched = this._prefetched || /* @__PURE__ */ new Map();
      this._prefetched.set(url.pathname, match);
      if (typeof document === "undefined")
        return;
      getRouteData(url.pathname + url.search).then((data) => {
        if (data)
          storePrefetchedData(match, data);
      });
    },
    get currentPath() {
      return get(_state.path);
    },
    hmrUpdate() {
      const updated = globalThis.__updatedComponents;
      if (!updated || updated.size === 0)
        return;
      globalThis.__updatedComponents = /* @__PURE__ */ new Set();
      if (typeof this.__updateComponents === "function") {
        this.__updateComponents(this.routeTree);
      }
      const instances = this.__componentInstances;
      if (instances && instances.size > 0) {
        let didUpdate = false;
        for (const [name, nameInstances] of instances) {
          if (updated.has(name)) {
            for (const inst of nameInstances) {
              try {
                const isPage = inst.type === "page";
                const newFn = isPage ? inst.node.page : inst.node.layout;
                if (!newFn)
                  continue;
                const walker = createHydrateWalker(document.createDocumentFragment(), []);
                let newDom;
                root(() => {
                  newDom = newFn(inst.props, /* @__PURE__ */ new Map(), walker);
                });
                if (newDom && newDom.nodeType === 1 && inst.root && inst.root.parentNode) {
                  inst.root.parentNode.replaceChild(newDom, inst.root);
                  inst.root = newDom;
                  didUpdate = true;
                }
              } catch (e) {
                console.error("HMR update error:", e);
              }
            }
          }
        }
        if (!didUpdate) {
          const path = window.location.pathname + window.location.search;
          this.navigate(path, { replace: true });
        }
      } else {
        const path = window.location.pathname + window.location.search;
        this.navigate(path, { replace: true });
      }
    }
  };
  return router;
}
function createFileRouter(routeTree, options = {}) {
  const container = options.container || document.getElementById("root");
  const middleware = options.middleware || null;
  const renderFn = options.render || renderMatch;
  const hydrateStrategy = options.hydrate || "full";
  const router = {
    _hydrateStrategy: hydrateStrategy,
    routeTree,
    container,
    _currentMatch: null,
    _outletPlaceholders: [],
    _currentSegments: null,
    _depth: 0,
    start() {
      setCurrentRouter(this);
      if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
        window.history.scrollRestoration = "manual";
      }
      if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
        let _scrollTimer = null;
        const _onScroll = () => {
          if (_scrollTimer)
            return;
          _scrollTimer = setTimeout(() => {
            if (window.scrollY !== void 0) {
              _scrollPositions.set(window.location.pathname, window.scrollY);
            }
            _scrollTimer = null;
          }, 100);
        };
        window.addEventListener("scroll", _onScroll, { passive: true });
      }
      window.addEventListener("popstate", () => {
        setIsPopStateNavigation(true);
        router.navigate(window.location.pathname + window.location.search, { replace: true });
      });
      if (options.prefetch !== false) {
        document.addEventListener("mouseenter", (e) => {
          const link = e.target?.nodeType === 1 ? e.target.closest("a[href]") : null;
          if (link)
            router.prefetch(link.getAttribute("href"));
        }, { passive: true });
      }
      const path = window.location.pathname;
      if (container.children.length > 0) {
        const match = matchRoute(routeTree, path);
        if (match) {
          match.pathname = path;
          hydrateInitial(router, match, container, hydrateStrategy);
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
        const chain = flattenLayoutChain(routeTree, url.pathname.split("/").filter(Boolean));
        const notFoundFn = findNotFoundComponent(chain);
        if (notFoundFn) {
          const tempRoot = document.createDocumentFragment();
          const walker = createHydrateWalker(tempRoot, []);
          const nfProps = { params: {}, url: url.pathname };
          const nfDom = notFoundFn(nfProps, /* @__PURE__ */ new Map(), walker);
          if (nfDom && typeof nfDom === "object" && nfDom.nodeType) {
            if (container.replaceChildren)
              container.replaceChildren(nfDom);
            else {
              container.innerHTML = "";
              container.appendChild(nfDom);
            }
          } else if (typeof nfDom === "string") {
            container.innerHTML = nfDom;
          }
        } else {
          container.innerHTML = "<h1>404 \u2014 Not Found</h1>";
        }
        return;
      }
      match.pathname = url.pathname;
      if (!_isPopStateNavigation) {
        _scrollPositions.set(window.location.pathname, window.scrollY);
      }
      const loadingFn = findLoadingComponent(match.matchChain);
      router._navToken = (router._navToken || 0) + 1;
      const navToken = router._navToken;
      const middlewareFns = Array.isArray(middleware) ? middleware : middleware ? [middleware] : [];
      let firstRenderFailed = false;
      const doRender = () => {
        const fullUrl = url.pathname + url.search;
        if (!opts.replace) {
          window.history.pushState({ path: fullUrl }, "", fullUrl);
        } else {
          window.history.replaceState({ path: fullUrl }, "", fullUrl);
        }
        set(_state.path, url.pathname);
        set(_state.search, url.search);
        try {
          renderFn(router, match, container);
        } catch (e) {
          firstRenderFailed = true;
          throw e;
        }
        router._currentMatch = match;
        handleScroll(url.pathname, opts.replace);
      };
      const fetchData = () => {
        if (firstRenderFailed)
          return;
        if (!shouldFetchData(router, match))
          return;
        getRouteData(url.pathname + url.search).then(async (data) => {
          if (navToken !== router._navToken)
            return;
          if (!data)
            return;
          if (data.redirect) {
            router.navigate(data.redirect, { replace: true });
            return;
          }
          const pending = hasPendingChunks(match.matchChain);
          if (pending.length > 0) {
            await Promise.all(pending.map(ensureChunk));
            if (navToken !== router._navToken)
              return;
            if (typeof router.__updateComponents === "function") {
              router.__updateComponents(match.matchChain);
            }
          }
          applyRouteData(router, match, data, container, renderFn);
        });
      };
      const pendingChunks = hasPendingChunks(match.matchChain);
      const doRenderWithChunks = pendingChunks.length > 0 ? () => Promise.all(pendingChunks.map(ensureChunk)).then(() => {
        if (typeof router.__updateComponents === "function") {
          router.__updateComponents(match.matchChain);
        }
        doRender();
      }) : (() => {
        doRender();
      });
      async function runMwChain(index) {
        if (index >= middlewareFns.length) {
          await doRenderWithChunks();
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
          if (e && e.name === "Redirect") {
            router.navigate(e.url, { replace: true });
            return;
          }
        }
      }
      if (middlewareFns.length > 0 || loadingFn) {
        if (loadingFn) {
          showLoadingInContainer(container, loadingFn, match.params);
        }
        Promise.resolve().then(() => {
          try {
            if (middlewareFns.length > 0) {
              runMwChain(0);
            } else {
              doRenderWithChunks();
            }
          } finally {
            fetchData();
          }
        });
      } else {
        try {
          doRenderWithChunks();
        } finally {
          fetchData();
        }
      }
    },
    prefetch(path) {
      const url = new URL(path, window.location.origin);
      const match = matchRoute(routeTree, url.pathname);
      if (!match)
        return;
      match.pathname = url.pathname;
      router._prefetched = router._prefetched || /* @__PURE__ */ new Map();
      router._prefetched.set(url.pathname, match);
      const preloadUrls = hasPendingChunks(match.matchChain);
      preloadUrls.forEach(ensureChunk);
      if (typeof document === "undefined")
        return;
      getRouteData(url.pathname + url.search).then((data) => {
        if (data)
          storePrefetchedData(match, data);
      });
    },
    get currentPath() {
      return get(_state.path);
    },
    hmrUpdate() {
      const updated = globalThis.__updatedComponents;
      if (!updated || updated.size === 0)
        return;
      globalThis.__updatedComponents = /* @__PURE__ */ new Set();
      if (typeof router.__updateComponents === "function") {
        router.__updateComponents(router.routeTree);
      }
      const instances = router.__componentInstances;
      if (instances && instances.size > 0) {
        let didUpdate = false;
        for (const [name, nameInstances] of instances) {
          if (updated.has(name)) {
            for (const inst of nameInstances) {
              try {
                const isPage = inst.type === "page";
                const newFn = isPage ? inst.node.page : inst.node.layout;
                if (!newFn)
                  continue;
                const walker = createHydrateWalker(document.createDocumentFragment(), []);
                let newDom;
                root(() => {
                  newDom = newFn(inst.props, /* @__PURE__ */ new Map(), walker);
                });
                if (newDom && newDom.nodeType === 1 && inst.root && inst.root.parentNode) {
                  inst.root.parentNode.replaceChild(newDom, inst.root);
                  inst.root = newDom;
                  didUpdate = true;
                }
              } catch (e) {
                console.error("HMR update error:", e);
              }
            }
          }
        }
        if (!didUpdate) {
          const path = window.location.pathname + window.location.search;
          router.navigate(path, { replace: true });
        }
      } else {
        const path = window.location.pathname + window.location.search;
        router.navigate(path, { replace: true });
      }
    }
  };
  return router;
}
function defineRoute(path, config) {
  return { path, ...config };
}
function buildRouteTree(definitions) {
  const tree = [];
  for (const def of definitions) {
    const parts = (def.path || "").split("/").filter(Boolean);
    const isDynamic = parts.some((p) => p.startsWith(":"));
    const isCatchAll = parts.some((p) => p === "*");
    const node = {
      path: parts[parts.length - 1] || "",
      fullPath: def.fullPath || def.path,
      isGroup: false,
      isDynamic,
      isCatchAll,
      page: def.page || null,
      layout: def.layout || null,
      loading: def.loading || null,
      error: def.error || null,
      notFound: def.notFound || null,
      children: (def.children || []).map((c) => {
        const cParts = (c.path || "").split("/").filter(Boolean);
        return {
          ...c,
          path: cParts[cParts.length - 1] || "",
          fullPath: ((def.path || "") + (c.path ? "/" + c.path : "")).replace(/\/+/g, "/"),
          isDynamic: cParts.some((p) => p.startsWith(":")),
          isCatchAll: cParts.some((p) => p === "*"),
          isGroup: false,
          loading: null,
          error: null,
          notFound: null,
          segmentCount: Math.max(1, cParts.length),
          children: []
        };
      }),
      segmentCount: Math.max(1, parts.length)
    };
    tree.push(node);
  }
  return tree;
}

// --- portal.js ---
function Portal(props, _registry, _ctx) {
  if (typeof document === "undefined")
    return "";
  const target = typeof props.target === "string" ? document.querySelector(props.target) : props.target;
  if (!target)
    return document.createComment("portal: no target");
  if (props.children != null) {
    if (typeof props.children === "function") {
      const frag = document.createDocumentFragment();
      props.children(frag);
      target.appendChild(frag);
    } else {
      target.appendChild(props.children);
    }
  }
  return document.createComment("portal");
}

// --- seo.js ---
function JsonLd(props) {
  const schema = props.schema || props.children || {};
  const json = JSON.stringify({
    "@context": "https://schema.org",
    ...schema
  });
  if (typeof document === "undefined") {
    return `<script type="application/ld+json">${json.replace(/<\/script>/g, "<\\/script>")}<\/script>`;
  }
  if (!document.querySelector(`script[type="application/ld+json"][data-key="${props.key || ""}"]`)) {
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.textContent = json;
    if (props.key)
      el.setAttribute("data-key", props.key);
    document.head.appendChild(el);
  }
  return null;
}
function ArticleSchema(article) {
  return {
    "@type": "Article",
    headline: article.headline,
    description: article.description,
    author: Array.isArray(article.author) ? article.author.map((a) => ({ "@type": "Person", name: a })) : { "@type": "Person", name: article.author },
    datePublished: article.datePublished,
    dateModified: article.dateModified || article.datePublished,
    image: article.image ? Array.isArray(article.image) ? article.image : [article.image] : void 0,
    publisher: article.publisher || void 0,
    mainEntityOfPage: article.url ? { "@type": "WebPage", "@id": article.url } : void 0
  };
}
function ProductSchema(product) {
  return {
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.image ? Array.isArray(product.image) ? product.image : [product.image] : void 0,
    sku: product.sku,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : void 0,
    offers: {
      "@type": "Offer",
      price: product.price,
      priceCurrency: product.currency || "USD",
      availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: product.url
    },
    review: product.reviews ? product.reviews.map((r) => ({
      "@type": "Review",
      reviewRating: { "@type": "Rating", ratingValue: r.rating },
      author: { "@type": "Person", name: r.author },
      reviewBody: r.body
    })) : void 0,
    aggregateRating: product.aggregateRating ? {
      "@type": "AggregateRating",
      ratingValue: product.aggregateRating.value,
      reviewCount: product.aggregateRating.count
    } : void 0
  };
}
function FAQPageSchema(faqs) {
  return {
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer }
    }))
  };
}
function BreadcrumbListSchema(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url
    }))
  };
}
function OrganizationSchema(org) {
  return {
    "@type": org.type || "Organization",
    name: org.name,
    url: org.url,
    logo: org.logo,
    description: org.description,
    sameAs: org.sameAs || void 0,
    contactPoint: org.contactPoint ? {
      "@type": "ContactPoint",
      telephone: org.contactPoint.telephone,
      contactType: org.contactPoint.contactType || "customer service",
      email: org.contactPoint.email
    } : void 0,
    address: org.address ? {
      "@type": "PostalAddress",
      streetAddress: org.address.streetAddress,
      addressLocality: org.address.addressLocality,
      addressRegion: org.address.addressRegion,
      postalCode: org.address.postalCode,
      addressCountry: org.address.addressCountry
    } : void 0
  };
}
function LocalBusinessSchema(biz) {
  return {
    ...OrganizationSchema(biz),
    "@type": biz.subtype || "LocalBusiness",
    openingHoursSpecification: biz.hours ? biz.hours.map((h) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: h.days,
      opens: h.open,
      closes: h.close
    })) : void 0,
    priceRange: biz.priceRange,
    telephone: biz.telephone
  };
}
function VideoSchema(video) {
  return {
    "@type": "VideoObject",
    name: video.name,
    description: video.description,
    thumbnailUrl: video.thumbnailUrl ? Array.isArray(video.thumbnailUrl) ? video.thumbnailUrl : [video.thumbnailUrl] : void 0,
    uploadDate: video.uploadDate,
    duration: video.duration,
    contentUrl: video.contentUrl,
    embedUrl: video.embedUrl,
    interactionStatistic: video.viewCount ? {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/WatchAction",
      userInteractionCount: video.viewCount
    } : void 0
  };
}

// --- image.js ---
function generateSrcset(src, widths) {
  if (!src || widths.length === 0)
    return "";
  const ext = src.lastIndexOf(".") > src.lastIndexOf("/") ? src.slice(src.lastIndexOf(".")) : "";
  const base = ext ? src.slice(0, -ext.length) : src;
  return widths.map((w) => `${base}-${w}w${ext} ${w}w`).join(", ");
}
function Image(props) {
  const { src, alt = "", width, height, priority = false, loading = priority ? "eager" : "lazy", decoding = priority ? "sync" : "async", fetchpriority = priority ? "high" : "auto", sizes = "100vw", widths = [640, 768, 1024, 1280, 1536], class: className = "", style = "", placeholder, ...rest } = props;
  const srcset = generateSrcset(src, widths);
  const attrs = {
    src,
    alt,
    loading,
    decoding,
    fetchpriority,
    sizes,
    width: width ? String(width) : void 0,
    height: height ? String(height) : void 0,
    class: className || void 0,
    style: style || void 0,
    ...rest
  };
  if (srcset)
    attrs.srcset = srcset;
  if (typeof document === "undefined") {
    const attrStr = Object.entries(attrs).filter(([, v]) => v != null && v !== false).map(([k, v]) => v === true ? k : `${k}="${String(v).replace(/"/g, "&quot;")}"`).join(" ");
    const phStyle = placeholder ? `background:${placeholder};background-size:cover;` : "";
    const wrapperStyle = width && height ? `display:inline-block;width:${typeof width === "number" ? width + "px" : width};height:${typeof height === "number" ? height + "px" : height};overflow:hidden;${phStyle}` : phStyle;
    return `<span style="${wrapperStyle}"><img ${attrStr} /></span>`;
  }
  const el = document.createElement("span");
  const img = document.createElement("img");
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null && v !== false)
      img.setAttribute(k, v === true ? "" : String(v));
  }
  if (placeholder)
    el.style.background = placeholder;
  if (width && height) {
    el.style.display = "inline-block";
    el.style.width = typeof width === "number" ? width + "px" : width;
    el.style.height = typeof height === "number" ? height + "px" : height;
    el.style.overflow = "hidden";
  }
  el.appendChild(img);
  return el;
}

// --- experiment.js ---
function getUserId() {
  if (typeof document === "undefined")
    return "";
  let id = sessionStorage.getItem("vsk_exp_user");
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem("vsk_exp_user", id);
  }
  return id;
}
function selectVariant(variants, seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  const r = Math.abs(hash) % 1e4 / 1e4;
  const totalWeight = variants.reduce((s, v) => s + (v.weight || 1), 0);
  let cumulative = 0;
  for (const v of variants) {
    cumulative += (v.weight || 1) / totalWeight;
    if (r <= cumulative)
      return v;
  }
  return variants[variants.length - 1];
}
function isSSR() {
  return typeof document === "undefined";
}
function getCookie(name) {
  if (isSSR())
    return null;
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}
function setCookie(name, value, maxAge = 86400) {
  if (isSSR())
    return;
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAge};SameSite=Lax`;
}
function Experiment(props) {
  const { name, variants = [], default: defaultContent = null, sticky = true, track = true } = props;
  const cookieName = `vsk_exp_${name}`;
  let assignedVariant;
  if (isSSR()) {
    const seed2 = name;
    assignedVariant = selectVariant(variants, seed2);
    return assignedVariant ? assignedVariant.children || assignedVariant.content || null : defaultContent;
  }
  const userId = getUserId();
  const seed = name + userId;
  if (sticky) {
    const stored = getCookie(cookieName);
    if (stored) {
      assignedVariant = variants.find((v) => v.name === stored);
    }
  }
  if (!assignedVariant) {
    assignedVariant = selectVariant(variants, seed);
    if (sticky && assignedVariant) {
      setCookie(cookieName, assignedVariant.name || "default", 86400 * 30);
    }
  }
  if (track && assignedVariant && typeof window !== "undefined") {
    const w = window;
    const existing = w.__vsk_experiments || (w.__vsk_experiments = []);
    existing.push({ experiment: name, variant: assignedVariant.name || "default" });
  }
  return assignedVariant ? assignedVariant.children || assignedVariant.content || null : defaultContent;
}

// --- form.js ---
function formIsSSR() {
  return typeof document === "undefined";
}
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function actionUrl(action) {
  if (typeof action === "string")
    return action;
  if (action && typeof action === "object") {
    const a = action;
    if (a.__veskAction === true || typeof a.url === "string")
      return String(a.url || "");
  }
  return "";
}
function readServerFieldErrors() {
  return globalThis.__vesk_action_errors || {};
}
function required(msg) {
  return { validate: (v) => v != null && v !== "", message: msg || "This field is required" };
}
function email(msg) {
  return { validate: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), message: msg || "Invalid email address" };
}
function minLength(n, msg) {
  return { validate: (v) => !v || v.length >= n, message: msg || `Must be at least ${n} characters` };
}
function maxLength(n, msg) {
  return { validate: (v) => !v || v.length <= n, message: msg || `Must be at most ${n} characters` };
}
function pattern(re, msg) {
  return { validate: (v) => !v || re.test(v), message: msg || "Invalid format" };
}
function custom(fn, msg) {
  return { validate: fn, message: msg || "Invalid value" };
}
function Field(props) {
  const { name, label, rules = [], children, errorClass, class: className, style, ...rest } = props;
  if (formIsSSR()) {
    const labelHtml = label ? `<label>${label}</label>` : "";
    const serverErrors = readServerFieldErrors();
    const serverErr = serverErrors[name] ? String(serverErrors[name]) : "";
    const errStyle = serverErr ? "" : "display:none";
    const errText = serverErr ? escapeHtml(serverErr) : "";
    const errCls = errorClass ? ` class="${errorClass}"` : "";
    const wrapCls = className ? ` class="${className}"` : "";
    const wrapStyle = style ? ` style="${String(style).replace(/"/g, "&quot;")}"` : "";
    const fieldAttrs = ` data-vsk-field="${name}"`;
    const extra = Object.entries(rest).filter(([, v]) => v != null && v !== false).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, "&quot;")}"`).join("");
    return `<div${fieldAttrs}${wrapCls}${wrapStyle}${extra}>${labelHtml}${children || ""}<div data-vsk-error style="${errStyle}"${errCls}>${errText}</div></div>`;
  }
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-vsk-field", name);
  if (className)
    wrapper.className = className;
  if (style)
    wrapper.style.cssText = style;
  for (const [k, v] of Object.entries(rest)) {
    if (v != null && v !== false)
      wrapper.setAttribute(k, v === true ? "" : String(v));
  }
  wrapper.__vsk_rules = rules;
  if (label) {
    const lbl = document.createElement("label");
    lbl.textContent = label;
    wrapper.appendChild(lbl);
  }
  if (children)
    wrapper.insertAdjacentHTML("beforeend", children);
  const errEl = document.createElement("div");
  errEl.setAttribute("data-vsk-error", "");
  errEl.style.display = "none";
  if (errorClass)
    errEl.className = errorClass;
  wrapper.appendChild(errEl);
  return wrapper;
}
function Form(props) {
  const { children, onSubmit, onError, onSuccess, action, method = "POST", class: className, style, ...rest } = props;
  if (formIsSSR()) {
    const attrs = { action: actionUrl(action), method };
    if (className)
      attrs.class = className;
    if (style)
      attrs.style = style;
    for (const [k, v] of Object.entries(rest)) {
      if (v != null && v !== false)
        attrs[k] = v;
    }
    const attrStr = Object.entries(attrs).filter(([, v]) => v != null && v !== false).map(([k, v]) => v === true ? k : `${k}="${String(v).replace(/"/g, "&quot;")}"`).join(" ");
    return `<form ${attrStr}>${children || ""}</form>`;
  }
  const form = document.createElement("form");
  const resolvedAction = actionUrl(action);
  if (resolvedAction)
    form.action = resolvedAction;
  if (method)
    form.method = method;
  if (className)
    form.className = className;
  if (style)
    form.style.cssText = style;
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v === "string")
      form.setAttribute(k, v);
  }
  if (children)
    form.insertAdjacentHTML("beforeend", children);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const obj = {};
    for (const [k, v] of data.entries()) {
      if (k in obj) {
        if (!Array.isArray(obj[k]))
          obj[k] = [obj[k]];
        obj[k].push(v);
      } else {
        obj[k] = v;
      }
    }
    const fields = form.querySelectorAll("[data-vsk-field]");
    let hasErrors = false;
    for (const el of fields) {
      const fieldName = el.getAttribute("data-vsk-field");
      const rules = el.__vsk_rules || [];
      const errEl = el.querySelector("[data-vsk-error]");
      let errMsg = "";
      for (const rule of rules) {
        if (!rule.validate(obj[fieldName || ""])) {
          errMsg = rule.message;
          break;
        }
      }
      if (errEl) {
        errEl.textContent = errMsg;
        errEl.style.display = errMsg ? "" : "none";
      }
      if (errMsg)
        hasErrors = true;
    }
    if (hasErrors) {
      form.dispatchEvent(new CustomEvent("vsk-error", { detail: { errors: true } }));
      return;
    }
    form.classList.add("vsk-submitting");
    const submitBtn = form.querySelector('[type="submit"], button[type="submit"]');
    if (submitBtn)
      submitBtn.disabled = true;
    form.dispatchEvent(new CustomEvent("vsk-loading", { detail: { loading: true } }));
    const isActionDescriptor = typeof action === "object" && action !== null;
    try {
      if (onSubmit) {
        const result = onSubmit(obj, form);
        if (result && typeof result.then === "function")
          await result;
      } else if (isActionDescriptor) {
        const res = await fetch(resolvedAction, {
          method,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(obj)
        });
        const payload = await res.json().catch(() => null);
        if (payload && payload.ok === false && Array.isArray(payload.issues)) {
          const byField = {};
          for (const issue of payload.issues) {
            if (issue && typeof issue.field === "string" && !(issue.field in byField)) {
              byField[issue.field] = String(issue.message || "Invalid value");
            }
          }
          let hasServerErrors = false;
          for (const el of fields) {
            const fieldName = el.getAttribute("data-vsk-field");
            const errEl = el.querySelector("[data-vsk-error]");
            const msg = fieldName ? byField[fieldName] : "";
            if (errEl) {
              errEl.textContent = msg;
              errEl.style.display = msg ? "" : "none";
            }
            if (msg)
              hasServerErrors = true;
          }
          if (hasServerErrors) {
            form.dispatchEvent(new CustomEvent("vsk-error", { detail: { issues: payload.issues } }));
            return;
          }
        }
        if (!res.ok)
          throw res;
        form.dispatchEvent(new CustomEvent("vsk-success", { detail: { response: res, data: payload } }));
        if (onSuccess)
          onSuccess(res);
      } else if (resolvedAction) {
        const res = await fetch(resolvedAction, { method, body: data });
        if (!res.ok)
          throw res;
        form.dispatchEvent(new CustomEvent("vsk-success", { detail: { response: res } }));
        if (onSuccess)
          onSuccess(res);
      }
    } catch (err) {
      form.dispatchEvent(new CustomEvent("vsk-error", { detail: { error: err } }));
      if (onError)
        onError(err);
    } finally {
      if (submitBtn)
        submitBtn.disabled = false;
      form.classList.remove("vsk-submitting");
      form.dispatchEvent(new CustomEvent("vsk-loading", { detail: { loading: false } }));
    }
  });
  return form;
}

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
export { on_destroy };
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
export { hydrateOnInteraction };
export { needsHydration };
export { hydrationCount };
export { createHydrateWalker };
export { collectVskMarkers };
export { reactiveProps };
export { createRouter };
export { createFileRouter };
export { Outlet };
export { Link };
export { NavLink };
export { useNavigate };
export { useParams };
export { usePathname };
export { useSearchParams };
export { useRouter };
export { buildRouteTree };
export { defineRoute };
export { Redirect };
export { redirect };
export { permanentRedirect };
export { notFound };
export { NotFoundError };
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
export { JsonLd };
export { ArticleSchema };
export { ProductSchema };
export { FAQPageSchema };
export { BreadcrumbListSchema };
export { OrganizationSchema };
export { LocalBusinessSchema };
export { VideoSchema };
export { Image };
export { Experiment };
export { Form };
export { Field };
export { required };
export { email };
export { minLength };
export { maxLength };
export { pattern };
export { custom };
export { defineAction };
export { getAction };
export { clearActions };
export { validateActionInput };
export { issuesToFieldMap };
export { isFormAction };

const __components = {};
const __hydrators = {};
const __runtime_comps = __components;

__components["Home"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
document.title = " VeskTS test app ";
const count = track(10);
const $n0 = document.createElement("h1");
$n0.setAttribute("class", "text-4xl font-bold mb-2");
const $n1 = document.createTextNode("Welcome to Vesk");
$n0.appendChild($n1);
	$root.appendChild($n0);
const $n2 = document.createElement("p");
$n2.setAttribute("class", "text-gray-500 mb-4");
const $n3 = document.createTextNode(" A compiler-first reactive UI framework for the post-VDOM web. ");
$n2.appendChild($n3);
	$root.appendChild($n2);
const $n4 = document.createElement("p");
const $n5 = document.createTextNode('');
$n4.appendChild($n5);
	$root.appendChild($n4);
const $n6 = document.createComment('if');
$root.appendChild($n6);
let $n8 = [];
const $n7 = document.createComment('if-end');
const $n9 = () => {
	const __p = $n6.parentNode;
	const $n10 = document.createDocumentFragment();
const $n11 = document.createElement("p");
const $n12 = document.createTextNode(" 2 is higher");
$n11.appendChild($n12);
	$n10.appendChild($n11);
	__p.insertBefore($n10, $n7);
};
const $n13 = () => {
	const __p = $n6.parentNode;
	const $n14 = document.createDocumentFragment();
const $n15 = document.createElement("p");
const $n16 = document.createTextNode(" Hurray 3 people won");
$n15.appendChild($n16);
	$n14.appendChild($n15);
	__p.insertBefore($n14, $n7);
};
$root.appendChild($n7);
if (2 > 3) { $n9(); } else { $n13(); }
const $n17 = document.createElement("button");
const $n18 = document.createTextNode(" + ");
$n17.appendChild($n18);
$n17.__evh_click = () => set(count, get(count) + 1);
$n17.setAttribute('data-vsk-ev', '');
	$root.appendChild($n17);
const $n19 = document.createElement("div");
$n19.setAttribute("class", "bg-white gg rounded-xl p-6 shadow-sm border border-gray-100");
const $n20 = document.createElement("h2");
$n20.setAttribute("class", "text-xl  font-semibold mb-2");
const $n21 = document.createTextNode("Getting Started");
$n20.appendChild($n21);
$n19.appendChild($n20);
const $n22 = document.createElement("p");
const $n23 = document.createTextNode("Edit ");
$n22.appendChild($n23);
const $n24 = document.createElement("code");
$n24.setAttribute("class", "bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n25 = document.createTextNode("app/page.vsk");
$n24.appendChild($n25);
$n22.appendChild($n24);
const $n26 = document.createTextNode(" to change this page.");
$n22.appendChild($n26);
$n19.appendChild($n22);
const $n27 = document.createElement("style");
const $n28 = document.createTextNode(".gg { color: red; } ");
$n27.appendChild($n28);
$n19.appendChild($n27);
const $n29 = __components["Appx"]({  });
$n19.appendChild($n29);
const $n30 = __components["Appxx"]({ "count": count });
$n19.appendChild($n30);
	$root.appendChild($n19);
	effect(() => { $n5.data = String(get(count)); });
	{
	    let __iv = true;
	    effect(() => {
	      const __nv = 2 > 3;
	      if (__nv !== __iv) {
	        for (const e of $n8) destroy_block(e);
	        $n8.length = 0;
	        __cleanup($n6, $n7);
	        if (__nv) { $n9(); } else { $n13(); }
	        __iv = __nv;
	      }
	    });
	  }
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

__components["Throws"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
if (props.fail) throw new Error(props.msg);
const $n0 = document.createElement("p");
const $n1 = document.createTextNode("OK");
$n0.appendChild($n1);
	$root.appendChild($n0);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["Appx"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = document.createComment('try');
$root.appendChild($n0);
let $n2 = [];
const $n1 = document.createComment('try-end');
const $n3 = () => {
	const __p = $n0.parentNode;
const $n4 = __components["Throws"]({ "fail": true, "msg": "Boom!" });
	__p.insertBefore($n4, $n1);
};
const $n5 = (e) => {
	const __p = $n0.parentNode;
const $n6 = document.createElement("p");
$n6.setAttribute("class", "error");
const $n7 = document.createTextNode("Error: ");
$n6.appendChild($n7);
const $n8 = document.createTextNode('');
$n6.appendChild($n8);
	__p.insertBefore($n6, $n1);
	effect(() => { $n8.data = String(e.message); });
};
$root.appendChild($n1);
try { $n3(); } catch(e) { $n5(e); }
const $n9 = () => {
	const __p = $n0.parentNode;
const $n10 = __runtime_comps["Throws"]({ "fail": true, "msg": "Boom!" });
	__p.insertBefore($n10, $n1);
};
const $n11 = (e) => {
	const __p = $n0.parentNode;
const $n12 = document.createElement("p");
$n12.setAttribute("class", "error");
const $n13 = document.createTextNode("Error: ");
$n12.appendChild($n13);
const $n14 = document.createTextNode('');
$n12.appendChild($n14);
	__p.insertBefore($n12, $n1);
	effect(() => { $n14.data = String(e.message); });
};
	{
	    effect(() => {
	      for (const e of $n2) destroy_block(e);
	      $n2.length = 0;
	      __cleanup($n0, $n1);
	      try { $n9(); } catch(e) { $n11(e); }
	    });
	  }
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["Throw"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
if (props.count < 15) throw new Error(props.msg);
const $n0 = document.createElement("p");
const $n1 = document.createTextNode("OK ");
$n0.appendChild($n1);
const $n2 = document.createTextNode('');
$n0.appendChild($n2);
	$root.appendChild($n0);
	effect(() => { $n2.data = String(props.count); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["Appxx"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = document.createElement("p");
const $n1 = document.createTextNode(" Count: ");
$n0.appendChild($n1);
const $n2 = document.createTextNode('');
$n0.appendChild($n2);
	$root.appendChild($n0);
const $n3 = document.createComment('try');
$root.appendChild($n3);
let $n5 = [];
const $n4 = document.createComment('try-end');
const $n6 = () => {
	const __p = $n3.parentNode;
const $n7 = __components["Throw"]({ "count": props.count, "msg": `Insufficient! ${props.count} ` });
	__p.insertBefore($n7, $n4);
};
const $n8 = (e) => {
	const __p = $n3.parentNode;
const $n9 = document.createElement("p");
$n9.setAttribute("class", "error");
const $n10 = document.createTextNode("Error: ");
$n9.appendChild($n10);
const $n11 = document.createTextNode('');
$n9.appendChild($n11);
	__p.insertBefore($n9, $n4);
	effect(() => { $n11.data = String(e.message); });
};
$root.appendChild($n4);
try { $n6(); } catch(e) { $n8(e); }
const $n12 = () => {
	const __p = $n3.parentNode;
const $n13 = __runtime_comps["Throw"]({ "count": props.count, "msg": `Insufficient! ${props.count} ` });
	__p.insertBefore($n13, $n4);
};
const $n14 = (e) => {
	const __p = $n3.parentNode;
const $n15 = document.createElement("p");
$n15.setAttribute("class", "error");
const $n16 = document.createTextNode("Error: ");
$n15.appendChild($n16);
const $n17 = document.createTextNode('');
$n15.appendChild($n17);
	__p.insertBefore($n15, $n4);
	effect(() => { $n17.data = String(e.message); });
};
	effect(() => { $n2.data = String(props.count); });
	{
	    effect(() => {
	      for (const e of $n5) destroy_block(e);
	      $n5.length = 0;
	      __cleanup($n3, $n4);
	      try { $n12(); } catch(e) { $n14(e); }
	    });
	  }
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["Layout"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	if (!document.getElementById("vesk-Layout")) {
			const s = document.createElement('style'); s.id = "vesk-Layout"; s.textContent = "  .nav { margin-left: 20px; display: flex; gap: 10px; } "; document.head.appendChild(s);
	}
	const $root = document.createDocumentFragment();
const $n0 = document.createElement("nav");
$n0.setAttribute("class", "flex nav gap-6 px-8 py-4 border-b border-gray-200 bg-white");
const $n1 = (() => { const $f = document.createDocumentFragment();
const $n2 = document.createTextNode("Home");
$f.appendChild($n2);
return $f; })();
const $n3 = NavLink({ "href": "/", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n1 });
$n0.appendChild($n3);
const $n4 = (() => { const $f = document.createDocumentFragment();
const $n5 = document.createTextNode("About");
$f.appendChild($n5);
return $f; })();
const $n6 = NavLink({ "href": "/about", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n4 });
$n0.appendChild($n6);
const $n7 = (() => { const $f = document.createDocumentFragment();
const $n8 = document.createTextNode("Blog");
$f.appendChild($n8);
return $f; })();
const $n9 = NavLink({ "href": "/blog", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n7 });
$n0.appendChild($n9);
const $n10 = (() => { const $f = document.createDocumentFragment();
const $n11 = document.createTextNode("Posts");
$f.appendChild($n11);
return $f; })();
const $n12 = NavLink({ "href": "/posts", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n10 });
$n0.appendChild($n12);
const $n13 = (() => { const $f = document.createDocumentFragment();
const $n14 = document.createTextNode("Statements");
$f.appendChild($n14);
return $f; })();
const $n15 = NavLink({ "href": "/statements", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n13 });
$n0.appendChild($n15);
const $n16 = (() => { const $f = document.createDocumentFragment();
const $n17 = document.createTextNode("Async");
$f.appendChild($n17);
return $f; })();
const $n18 = NavLink({ "href": "/async", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n16 });
$n0.appendChild($n18);
const $n19 = (() => { const $f = document.createDocumentFragment();
const $n20 = document.createTextNode("Map");
$f.appendChild($n20);
return $f; })();
const $n21 = NavLink({ "href": "/map", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n19 });
$n0.appendChild($n21);
const $n22 = (() => { const $f = document.createDocumentFragment();
const $n23 = document.createTextNode("Empty");
$f.appendChild($n23);
return $f; })();
const $n24 = NavLink({ "href": "/empty", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n22 });
$n0.appendChild($n24);
	$root.appendChild($n0);
const $n25 = document.createElement("main");
$n25.setAttribute("class", "max-w-3xl mx-auto my-8 px-4");
if (props.children !== undefined && props.children !== null) $n25.appendChild(props.children);
	$root.appendChild($n25);
const $n26 = document.createElement("footer");
$n26.setAttribute("class", "text-center py-8 text-gray-400 text-sm");
const $n27 = document.createElement("p");
const $n28 = document.createTextNode("Powered by Vesk");
$n27.appendChild($n28);
$n26.appendChild($n27);
	$root.appendChild($n26);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["ErrorPage"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = document.createElement("div");
$n0.setAttribute("class", "min-h-screen flex items-center justify-center bg-gray-50");
const $n1 = document.createElement("div");
$n1.setAttribute("class", "max-w-2xl mx-auto p-8 bg-white rounded-xl shadow-sm border border-gray-200");
const $n2 = document.createElement("h1");
$n2.setAttribute("class", "text-4xl font-bold text-red-600 mb-4");
const $n3 = document.createTextNode("Error ");
$n2.appendChild($n3);
const $n4 = document.createTextNode('');
$n2.appendChild($n4);
$n1.appendChild($n2);
const $n5 = document.createElement("p");
$n5.setAttribute("class", "text-lg text-gray-700 mb-6");
const $n6 = document.createTextNode('');
$n5.appendChild($n6);
$n1.appendChild($n5);
const $n7 = document.createElement("pre");
$n7.setAttribute("class", "bg-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto max-h-64 overflow-y-auto");
const $n8 = document.createTextNode('');
$n7.appendChild($n8);
$n1.appendChild($n7);
const $n9 = document.createElement("p");
$n9.setAttribute("class", "mt-6 text-gray-500 text-sm");
const $n10 = document.createTextNode('');
$n9.appendChild($n10);
$n1.appendChild($n9);
$n0.appendChild($n1);
	$root.appendChild($n0);
	effect(() => { $n4.data = String(props.statusCode); });
	effect(() => { $n6.data = String(props.error); });
	effect(() => { $n8.data = String(props.stack); });
	effect(() => { $n10.data = String(props.url); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["NotFound404"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = document.createElement("main");
$n0.setAttribute("class", "max-w-3xl mx-auto my-16 px-4 text-center");
const $n1 = document.createElement("h1");
$n1.setAttribute("class", "text-6xl font-bold text-gray-200 mb-4");
const $n2 = document.createTextNode("404");
$n1.appendChild($n2);
$n0.appendChild($n1);
const $n3 = document.createElement("h2");
$n3.setAttribute("class", "text-2xl font-semibold mb-2");
const $n4 = document.createTextNode("Page Not Found");
$n3.appendChild($n4);
$n0.appendChild($n3);
const $n5 = document.createElement("p");
$n5.setAttribute("class", "text-gray-500 mb-8");
const $n6 = document.createTextNode("Sorry, we couldn't find ");
$n5.appendChild($n6);
const $n7 = document.createElement("code");
$n7.setAttribute("class", "bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n8 = document.createTextNode('');
$n7.appendChild($n8);
$n5.appendChild($n7);
$n0.appendChild($n5);
const $n9 = (() => { const $f = document.createDocumentFragment();
const $n10 = document.createTextNode("← Go home");
$f.appendChild($n10);
return $f; })();
const $n11 = Link({ "href": "/", "class": "text-blue-600 no-underline hover:underline font-medium", children: $n9 });
$n0.appendChild($n11);
	$root.appendChild($n0);
	effect(() => { $n8.data = String(props.url); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["About"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = document.createElement("h1");
$n0.setAttribute("class", "text-3xl font-bold mb-4");
const $n1 = document.createTextNode("About Vesk");
$n0.appendChild($n1);
	$root.appendChild($n0);
const $n2 = document.createElement("p");
$n2.setAttribute("class", "text-gray-600 mb-3");
const $n3 = document.createTextNode(" Vesk is a compiler-first reactive UI framework. It compiles .vsk components to standard ESM with SSR, hydration, and fine-grained reactivity. ");
$n2.appendChild($n3);
	$root.appendChild($n2);
const $n4 = document.createElement("p");
$n4.setAttribute("class", "text-gray-600 mb-3");
const $n5 = document.createTextNode(" Key features include zero-JS pages, islands architecture, AOT event delegation, and streaming SSR. ");
$n4.appendChild($n5);
	$root.appendChild($n4);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

const signup = {
	__veskAction: true,
	id: '-mvdn9i',
	url: '/_vesk/action/-mvdn9i'
};

__components["Actions"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
document.title = "Actions demo";
const $n0 = document.createElement("h1");
$n0.setAttribute("class", "text-2xl font-bold mb-4");
const $n1 = document.createTextNode("Server actions");
$n0.appendChild($n1);
	$root.appendChild($n0);
const $n2 = (() => { const $f = document.createDocumentFragment();
const $n3 = (() => { const $f = document.createDocumentFragment();
const $n4 = document.createElement("input");
$n4.setAttribute("name", "name");
$n4.setAttribute("class", "border rounded px-2 py-1");
$f.appendChild($n4);
return $f; })();
const $n5 = Field({ "name": "name", "label": "Name", children: $n3 });
$f.appendChild($n5);
const $n6 = (() => { const $f = document.createDocumentFragment();
const $n7 = document.createElement("input");
$n7.setAttribute("name", "email");
$n7.setAttribute("type", "email");
$n7.setAttribute("class", "border rounded px-2 py-1");
$f.appendChild($n7);
return $f; })();
const $n8 = Field({ "name": "email", "label": "Email", children: $n6 });
$f.appendChild($n8);
const $n9 = (() => { const $f = document.createDocumentFragment();
const $n10 = document.createElement("input");
$n10.setAttribute("name", "password");
$n10.setAttribute("type", "password");
$n10.setAttribute("class", "border rounded px-2 py-1");
$f.appendChild($n10);
return $f; })();
const $n11 = Field({ "name": "password", "label": "Password", children: $n9 });
$f.appendChild($n11);
const $n12 = document.createElement("button");
$n12.setAttribute("type", "submit");
$n12.setAttribute("class", "bg-blue-600 text-white px-4 py-2 rounded");
const $n13 = document.createTextNode("Submit");
$n12.appendChild($n13);
$f.appendChild($n12);
return $f; })();
const $n14 = Form({ "action": signup, "onSuccess": () => console.log('done'), children: $n2 });
	$root.appendChild($n14);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["AsyncPage"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
document.title = "Async — load() + async components";
const now = Date.now()
const $n0 = document.createElement("h1");
$n0.setAttribute("class", "text-3xl font-bold mb-4");
const $n1 = document.createTextNode("Async Demo");
$n0.appendChild($n1);
	$root.appendChild($n0);
const $n2 = document.createElement("p");
$n2.setAttribute("class", "text-gray-500 mb-6");
const $n3 = document.createTextNode(" Props were fetched by an ");
$n2.appendChild($n3);
const $n4 = document.createElement("code");
const $n5 = document.createTextNode("export async function load()");
$n4.appendChild($n5);
$n2.appendChild($n4);
const $n6 = document.createTextNode(" during SSR, then awaited by this component. ");
$n2.appendChild($n6);
	$root.appendChild($n2);
const $n7 = document.createElement("h2");
$n7.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n8 = document.createTextNode("Posts from load()");
$n7.appendChild($n8);
	$root.appendChild($n7);
const $n9 = document.createComment('if');
$root.appendChild($n9);
let $n11 = [];
const $n10 = document.createComment('if-end');
const $n12 = () => {
	const __p = $n9.parentNode;
	const $n13 = document.createDocumentFragment();
const $n14 = document.createComment('map');
$n13.appendChild($n14);
let $n16 = [];
const $n15 = document.createComment('map-end');
const $n17 = (post, __e, __r) => {
	__r = __r || $n15;
	const __p = $n14.parentNode;
const $n18 = document.createElement("div");
$n18.setAttribute("class", "bg-white rounded-lg p-4 mb-3 shadow-sm border border-gray-100");
const $n19 = document.createElement("h3");
$n19.setAttribute("class", "font-semibold");
const $n20 = document.createTextNode('');
__e.push(effect(() => { $n20.data = String(post.title); }));
$n19.appendChild($n20);
$n18.appendChild($n19);
const $n21 = document.createElement("p");
$n21.setAttribute("class", "text-gray-500 text-sm");
const $n22 = document.createTextNode('');
__e.push(effect(() => { $n22.data = String(post.excerpt); }));
$n21.appendChild($n22);
$n18.appendChild($n21);
	__p.insertBefore($n18, __r);
};
$n13.appendChild($n15);
const $n23 = () => { const __l = props.posts; return __l != null && __l.length > 0; };
for (const post of props.posts) {
	$n17(post, $n16);
}
	__p.insertBefore($n13, $n10);
};
const $n24 = () => {
	const __p = $n9.parentNode;
	const $n25 = document.createDocumentFragment();
const $n26 = document.createElement("p");
$n26.setAttribute("class", "text-gray-400 text-sm");
const $n27 = document.createTextNode("Loading posts…");
$n26.appendChild($n27);
	$n25.appendChild($n26);
	__p.insertBefore($n25, $n10);
};
$root.appendChild($n10);
if (props.posts && props.posts.length > 0) { $n12(); } else { $n24(); }
const $n28 = document.createElement("h2");
$n28.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n29 = document.createTextNode("async component with await");
$n28.appendChild($n29);
	$root.appendChild($n28);
const $n30 = document.createElement("p");
$n30.setAttribute("class", "text-gray-400 text-sm");
const $n31 = document.createTextNode("server timestamp: ");
$n30.appendChild($n31);
const $n32 = document.createTextNode('');
$n30.appendChild($n32);
	$root.appendChild($n30);
	{
	  let __first = true;
	  effect(() => {
	    const __nv = props.posts;
	    if (__first) { __first = false; return; }
	    for (const e of $n16) destroy_block(e);
	    $n16.length = 0;
	    __cleanup($n14, $n15);
	    for (const post of props.posts) {
	    	$n17(post, $n16);
	    }
	  });
	}
	{
	    let __iv = true;
	    effect(() => {
	      const __nv = props.posts && props.posts.length > 0;
	      if (__nv !== __iv) {
	        for (const e of $n11) destroy_block(e);
	        $n11.length = 0;
	        __cleanup($n9, $n10);
	        if (__nv) { $n12(); } else { $n24(); }
	        __iv = __nv;
	      }
	    });
	  }
	effect(() => { $n32.data = String(now); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["Blog"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = document.createElement("h1");
$n0.setAttribute("class", "text-3xl font-bold mb-4");
const $n1 = document.createTextNode("Blog");
$n0.appendChild($n1);
	$root.appendChild($n0);
const $n2 = document.createElement("div");
$n2.setAttribute("class", "bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100");
const $n3 = document.createElement("h2");
$n3.setAttribute("class", "text-lg font-semibold mb-1");
const $n4 = (() => { const $f = document.createDocumentFragment();
const $n5 = document.createTextNode("Hello World");
$f.appendChild($n5);
return $f; })();
const $n6 = Link({ "href": "/blog/hello-world", "class": "text-gray-900 no-underline hover:text-blue-600", children: $n4 });
$n3.appendChild($n6);
$n2.appendChild($n3);
const $n7 = document.createElement("p");
$n7.setAttribute("class", "text-gray-400 text-sm");
const $n8 = document.createTextNode("First post powered by Vesk");
$n7.appendChild($n8);
$n2.appendChild($n7);
	$root.appendChild($n2);
const $n9 = document.createElement("div");
$n9.setAttribute("class", "bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100");
const $n10 = document.createElement("h2");
$n10.setAttribute("class", "text-lg font-semibold mb-1");
const $n11 = (() => { const $f = document.createDocumentFragment();
const $n12 = document.createTextNode("SSR in Vesk");
$f.appendChild($n12);
return $f; })();
const $n13 = Link({ "href": "/blog/ssr-in-vesk", "class": "text-gray-900 no-underline hover:text-blue-600", children: $n11 });
$n10.appendChild($n13);
$n9.appendChild($n10);
const $n14 = document.createElement("p");
$n14.setAttribute("class", "text-gray-400 text-sm");
const $n15 = document.createTextNode("How server-side rendering works");
$n14.appendChild($n15);
$n9.appendChild($n14);
	$root.appendChild($n9);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["BlogPost"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = (() => { const $f = document.createDocumentFragment();
const $n1 = document.createTextNode(" ← Back to blog ");
$f.appendChild($n1);
return $f; })();
const $n2 = Link({ "href": "/blog", "class": "inline-block mb-6 text-blue-600 no-underline hover:underline", children: $n0 });
	$root.appendChild($n2);
const $n3 = document.createElement("h1");
$n3.setAttribute("class", "text-3xl font-bold mb-2");
const $n4 = document.createTextNode("Post: ");
$n3.appendChild($n4);
const $n5 = document.createTextNode('');
$n3.appendChild($n5);
	$root.appendChild($n3);
const $n6 = document.createElement("div");
$n6.setAttribute("class", "text-gray-600 leading-relaxed");
const $n7 = document.createElement("p");
const $n8 = document.createTextNode("This is a dynamic blog post rendered at ");
$n7.appendChild($n8);
const $n9 = document.createElement("code");
$n9.setAttribute("class", "bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n10 = document.createTextNode("/");
$n9.appendChild($n10);
const $n11 = document.createTextNode('');
$n9.appendChild($n11);
$n7.appendChild($n9);
const $n12 = document.createTextNode(".");
$n7.appendChild($n12);
$n6.appendChild($n7);
	$root.appendChild($n6);
	effect(() => { $n5.data = String(props.params.slug); });
	effect(() => { $n11.data = String(props.params.slug); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["EmptyDemo"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
document.title = "Empty — keyed for-of with empty fallback";
const todos = track([
		{ id: 1, text: 'Buy milk' },
		{ id: 2, text: 'Write docs' },
	]);
function clear() {
	set(todos, []);
}
function restore() {
	set(todos, [{ id: 1, text: 'Buy milk' }, { id: 2, text: 'Write docs' }]);
}
const $n0 = document.createElement("h1");
$n0.setAttribute("class", "text-3xl font-bold mb-4");
const $n1 = document.createTextNode("Empty-state Demo");
$n0.appendChild($n1);
	$root.appendChild($n0);
const $n2 = document.createElement("div");
$n2.setAttribute("class", "flex gap-2 mb-6");
const $n3 = document.createElement("button");
$n3.setAttribute("class", "bg-red-600 text-white text-sm px-3 py-1 rounded");
const $n4 = document.createTextNode("Clear");
$n3.appendChild($n4);
$n3.__evh_click = clear;
$n3.setAttribute('data-vsk-ev', '');
$n2.appendChild($n3);
const $n5 = document.createElement("button");
$n5.setAttribute("class", "bg-blue-600 text-white text-sm px-3 py-1 rounded");
const $n6 = document.createTextNode("Restore");
$n5.appendChild($n6);
$n5.__evh_click = restore;
$n5.setAttribute('data-vsk-ev', '');
$n2.appendChild($n5);
	$root.appendChild($n2);
const $n7 = document.createElement("h2");
$n7.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n8 = document.createTextNode("Keyed for-of with empty block");
$n7.appendChild($n8);
	$root.appendChild($n7);
const $n9 = document.createElement("ul");
$n9.setAttribute("class", "space-y-2");
const $n10 = document.createComment('map');
$n9.appendChild($n10);
let $n12 = [];
const $n11 = document.createComment('map-end');
const $n13 = (todo, __e, __r) => {
	__r = __r || $n11;
	const __p = $n10.parentNode;
const $n14 = document.createElement("li");
$n14.setAttribute("class", "bg-gray-50 rounded px-3 py-2");
const $n15 = document.createElement("b");
const $n16 = document.createTextNode('');
__e.push(effect(() => { $n16.data = String(todo.text); }));
$n15.appendChild($n16);
$n14.appendChild($n15);
const $n17 = document.createElement("span");
$n17.setAttribute("class", "text-gray-400 text-sm");
const $n18 = document.createTextNode("#");
$n17.appendChild($n18);
const $n19 = document.createTextNode('');
__e.push(effect(() => { $n19.data = String(todo.id); }));
$n17.appendChild($n19);
$n14.appendChild($n17);
	__p.insertBefore($n14, __r);
};
const $n20 = () => {
	const __p = $n10.parentNode;
	const $n21 = document.createDocumentFragment();
const $n22 = document.createElement("li");
$n22.setAttribute("class", "bg-gray-100 rounded px-3 py-2 text-gray-500");
const $n23 = document.createTextNode("No todos yet — click Restore to add some.");
$n22.appendChild($n23);
	$n21.appendChild($n22);
	__p.insertBefore($n21, $n11);
};
$n9.appendChild($n11);
const $n24 = () => { const __l = get(todos); return __l != null && __l.length > 0; };
let $n25 = () => {};
const $n26 = () => { $n25 = reconcile($n10, $n11, get(todos), todo => todo.id, (todo, __i, __e) => $n13(todo, __e)); };
let $n27 = !$n24();
if (!$n27) { $n26(); } else { $n20(); }
	$root.appendChild($n9);
const $n28 = document.createElement("h2");
$n28.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n29 = document.createTextNode("Statement-mode empty block");
$n28.appendChild($n29);
	$root.appendChild($n28);
const $n30 = document.createComment('map');
$root.appendChild($n30);
let $n32 = [];
const $n31 = document.createComment('map-end');
const $n33 = (todo, __e, __r) => {
	__r = __r || $n31;
	const __p = $n30.parentNode;
const $n34 = document.createElement("div");
$n34.setAttribute("class", "bg-gray-50 rounded px-3 py-2 mb-2");
const $n35 = document.createElement("b");
const $n36 = document.createTextNode('');
__e.push(effect(() => { $n36.data = String(todo.text); }));
$n35.appendChild($n36);
$n34.appendChild($n35);
const $n37 = document.createElement("span");
$n37.setAttribute("class", "text-gray-400 text-sm");
const $n38 = document.createTextNode("#");
$n37.appendChild($n38);
const $n39 = document.createTextNode('');
__e.push(effect(() => { $n39.data = String(todo.id); }));
$n37.appendChild($n39);
$n34.appendChild($n37);
	__p.insertBefore($n34, __r);
};
const $n40 = () => {
	const __p = $n30.parentNode;
	const $n41 = document.createDocumentFragment();
const $n42 = document.createElement("div");
$n42.setAttribute("class", "bg-gray-100 rounded px-3 py-2 mb-2 text-gray-500");
const $n43 = document.createTextNode("Statement-mode: list is empty.");
$n42.appendChild($n43);
	$n41.appendChild($n42);
	__p.insertBefore($n41, $n31);
};
$root.appendChild($n31);
const $n44 = () => { const __l = get(todos); return __l != null && __l.length > 0; };
let $n45 = () => {};
const $n46 = () => { $n45 = reconcile($n30, $n31, get(todos), todo => todo.id, (todo, __i, __e) => $n33(todo, __e)); };
let $n47 = !$n44();
if (!$n47) { $n46(); } else { $n40(); }
const $n48 = document.createElement("p");
$n48.setAttribute("class", "text-gray-500 text-sm mt-6");
const $n49 = document.createTextNode(" The ");
$n48.appendChild($n49);
const $n50 = document.createElement("code");
const $n51 = document.createTextNode("empty");
$n50.appendChild($n51);
$n48.appendChild($n50);
const $n52 = document.createTextNode(" block renders when the list is empty. The list uses ");
$n48.appendChild($n52);
const $n53 = document.createElement("code");
const $n54 = document.createTextNode("; key todo.id");
$n53.appendChild($n54);
$n48.appendChild($n53);
const $n55 = document.createTextNode(" for keyed reconciliation. ");
$n48.appendChild($n55);
	$root.appendChild($n48);
	{
	  let __first = true;
	  effect(() => {
	    const __new = $n24();
	    if (__first) { __first = false; return; }
	    if (__new !== $n27) {
	      if (__new) $n25(get(todos));
	      return;
	    }
	    $n27 = !__new;
	    for (const e of $n12) destroy_block(e);
	    $n12.length = 0;
	    __cleanup($n10, $n11);
	    if (__new) { $n26(); } else { $n20(); }
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __new = $n44();
	    if (__first) { __first = false; return; }
	    if (__new !== $n47) {
	      if (__new) $n45(get(todos));
	      return;
	    }
	    $n47 = !__new;
	    for (const e of $n32) destroy_block(e);
	    $n32.length = 0;
	    __cleanup($n30, $n31);
	    if (__new) { $n46(); } else { $n40(); }
	  });
	}
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

__components["MapDemo"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
document.title = "Map — inline .map() in JSX";
const users = [
		{ id: 1, name: 'Ada', role: 'admin' },
		{ id: 2, name: 'Grace', role: 'dev' },
		{ id: 3, name: 'Alan', role: 'dev' },
	]
const numbers = [1, 2, 3, 4, 5]
const $n0 = document.createElement("h1");
$n0.setAttribute("class", "text-3xl font-bold mb-4");
const $n1 = document.createTextNode("Inline .map() Demo");
$n0.appendChild($n1);
	$root.appendChild($n0);
const $n2 = document.createElement("h2");
$n2.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n3 = document.createTextNode("map over objects");
$n2.appendChild($n3);
	$root.appendChild($n2);
const $n4 = document.createElement("ul");
$n4.setAttribute("class", "space-y-2");
const $n5 = document.createComment('map');
$n4.appendChild($n5);
let $n7 = [];
const $n6 = document.createComment('map-end');
const $n8 = (u, __e, __r) => {
	__r = __r || $n6;
	const __p = $n5.parentNode;
const $n9 = document.createElement("li");
$n9.setAttribute("class", "bg-gray-50 rounded px-3 py-2");
const $n10 = document.createElement("b");
const $n11 = document.createTextNode('');
__e.push(effect(() => { $n11.data = String(u.name); }));
$n10.appendChild($n11);
$n9.appendChild($n10);
const $n12 = document.createTextNode(" — ");
$n9.appendChild($n12);
const $n13 = document.createTextNode('');
__e.push(effect(() => { $n13.data = String(u.role); }));
$n9.appendChild($n13);
	__p.insertBefore($n9, __r);
};
$n4.appendChild($n6);
const $n14 = () => { const __l = users; return __l != null && __l.length > 0; };
for (const u of users) {
	$n8(u, $n7);
}
	$root.appendChild($n4);
const $n15 = document.createElement("h2");
$n15.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n16 = document.createTextNode("map with index");
$n15.appendChild($n16);
	$root.appendChild($n15);
const $n17 = document.createElement("p");
const $n18 = document.createComment('map');
$n17.appendChild($n18);
let $n20 = [];
const $n19 = document.createComment('map-end');
const $n21 = (u, __i, __e, __r) => {
	__r = __r || $n19;
	const i = __i;
	const __p = $n18.parentNode;
const $n22 = document.createElement("span");
$n22.setAttribute("class", "mr-3");
const $n23 = document.createTextNode("#");
$n22.appendChild($n23);
const $n24 = document.createTextNode('');
__e.push(effect(() => { $n24.data = String(i + 1); }));
$n22.appendChild($n24);
const $n25 = document.createTextNode(": ");
$n22.appendChild($n25);
const $n26 = document.createTextNode('');
__e.push(effect(() => { $n26.data = String(u.name); }));
$n22.appendChild($n26);
	__p.insertBefore($n22, __r);
};
$n17.appendChild($n19);
const $n27 = () => { const __l = users; return __l != null && __l.length > 0; };
let __i = 0;
for (const u of users) {
	$n21(u, __i, $n20);
	__i++;
}
	$root.appendChild($n17);
const $n28 = document.createElement("h2");
$n28.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n29 = document.createTextNode("map with keys");
$n28.appendChild($n29);
	$root.appendChild($n28);
const $n30 = document.createElement("div");
$n30.setAttribute("class", "flex gap-2");
const $n31 = document.createComment('map');
$n30.appendChild($n31);
let $n33 = [];
const $n32 = document.createComment('map-end');
const $n34 = (n, __e, __r) => {
	__r = __r || $n32;
	const __p = $n31.parentNode;
const $n35 = document.createElement("span");
$n35.setAttribute("class", "bg-blue-600 text-white text-sm px-3 py-1 rounded-full");
const $n36 = document.createTextNode('');
__e.push(effect(() => { $n36.data = String(n); }));
$n35.appendChild($n36);
	__p.insertBefore($n35, __r);
};
$n30.appendChild($n32);
const $n37 = () => { const __l = numbers; return __l != null && __l.length > 0; };
let $n38 = () => {};
const $n39 = () => { $n38 = reconcile($n31, $n32, numbers, n => n, (n, __i, __e) => $n34(n, __e)); };
$n39();
	$root.appendChild($n30);
const $n40 = document.createElement("h2");
$n40.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n41 = document.createTextNode("chained map + filter");
$n40.appendChild($n41);
	$root.appendChild($n40);
const $n42 = document.createElement("p");
const $n43 = document.createComment('map');
$n42.appendChild($n43);
let $n45 = [];
const $n44 = document.createComment('map-end');
const $n46 = (n, __e, __r) => {
	__r = __r || $n44;
	const __p = $n43.parentNode;
const $n47 = document.createElement("span");
$n47.setAttribute("class", "mr-3");
const $n48 = document.createTextNode('');
__e.push(effect(() => { $n48.data = String(n); }));
$n47.appendChild($n48);
const $n49 = document.createTextNode("²=");
$n47.appendChild($n49);
const $n50 = document.createTextNode('');
__e.push(effect(() => { $n50.data = String(n * n); }));
$n47.appendChild($n50);
	__p.insertBefore($n47, __r);
};
$n42.appendChild($n44);
const $n51 = () => { const __l = numbers.filter(n => n % 2 === 1); return __l != null && __l.length > 0; };
for (const n of numbers.filter(n => n % 2 === 1)) {
	$n46(n, $n45);
}
	$root.appendChild($n42);
	{
	  let __first = true;
	  effect(() => {
	    const __nv = users;
	    if (__first) { __first = false; return; }
	    for (const e of $n7) destroy_block(e);
	    $n7.length = 0;
	    __cleanup($n5, $n6);
	    for (const u of users) {
	    	$n8(u, $n7);
	    }
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __nv = users;
	    if (__first) { __first = false; return; }
	    for (const e of $n20) destroy_block(e);
	    $n20.length = 0;
	    __cleanup($n18, $n19);
	    let __i = 0;
	    for (const u of users) {
	    	$n21(u, __i, $n20);
	    	__i++;
	    }
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __nv = numbers;
	    if (__first) { __first = false; return; }
	    $n38(numbers);
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __nv = numbers.filter(n => n % 2 === 1);
	    if (__first) { __first = false; return; }
	    for (const e of $n45) destroy_block(e);
	    $n45.length = 0;
	    __cleanup($n43, $n44);
	    for (const n of numbers.filter(n => n % 2 === 1)) {
	    	$n46(n, $n45);
	    }
	  });
	}
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["PostCard"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = document.createElement("article");
$n0.setAttribute("class", "bg-white rounded-lg p-6 mb-4 shadow-sm border border-gray-100");
const $n1 = document.createElement("div");
$n1.setAttribute("class", "flex items-center justify-between mb-2");
const $n2 = document.createElement("h2");
$n2.setAttribute("class", "text-xl font-semibold");
const $n3 = document.createTextNode('');
$n2.appendChild($n3);
$n1.appendChild($n2);
const $n4 = document.createElement("span");
$n4.setAttribute("class", "text-gray-400 text-sm");
const $n5 = document.createTextNode('');
$n4.appendChild($n5);
$n1.appendChild($n4);
$n0.appendChild($n1);
const $n6 = document.createElement("p");
$n6.setAttribute("class", "text-gray-500 mb-3");
const $n7 = document.createTextNode('');
$n6.appendChild($n7);
$n0.appendChild($n6);
const $n8 = document.createElement("div");
$n8.setAttribute("class", "flex gap-2 mb-3");
$n0.appendChild($n8);
const $n9 = document.createElement("p");
$n9.setAttribute("class", "text-gray-400 text-sm");
const $n10 = document.createTextNode("By ");
$n9.appendChild($n10);
const $n11 = document.createTextNode('');
$n9.appendChild($n11);
$n0.appendChild($n9);
	$root.appendChild($n0);
	effect(() => { $n3.data = String(props.post.title); });
	effect(() => { $n5.data = String(props.post.date); });
	effect(() => { $n7.data = String(props.post.excerpt); });
	effect(() => { $n11.data = String(props.post.author); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["PostsSummary"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const summary = useFetch('/api/posts', {
		key: 'posts',
		staleTime: 30000,
	})
const $n0 = document.createElement("p");
$n0.setAttribute("class", "text-gray-500 text-sm mt-2");
	$root.appendChild($n0);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["Posts"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
document.title = "Posts — useFetch demo";
const posts = track([]);
const postsResource = useFetch('/api/posts', {
	key: 'posts',
	into: posts,
	staleTime: 30000,
	keepPreviousData: true,
	retry: 2,
	retryDelay: 400,
	timeout: 8000
});
const $n0 = document.createElement("div");
$n0.setAttribute("class", "flex items-center justify-between mb-6");
const $n1 = document.createElement("div");
const $n2 = document.createElement("h1");
$n2.setAttribute("class", "text-3xl font-bold mb-1");
const $n3 = document.createTextNode("Posts");
$n2.appendChild($n3);
$n1.appendChild($n2);
const $n4 = document.createElement("p");
$n4.setAttribute("class", "text-gray-500");
const $n5 = document.createTextNode(" Fetched with useFetch — deduped, cached with staleTime, retried with backoff, timed out, and written into a tracked cell. ");
$n4.appendChild($n5);
$n1.appendChild($n4);
$n0.appendChild($n1);
const $n6 = document.createElement("div");
$n6.setAttribute("class", "flex items-center gap-3");
const $n7 = document.createElement("span");
$n7.setAttribute("class", "text-sm text-gray-400");
const $n8 = document.createComment('if');
$n7.appendChild($n8);
let $n10 = [];
const $n9 = document.createComment('if-end');
const $n11 = () => {
	const __p = $n8.parentNode;
	const $n12 = document.createDocumentFragment();
const $n13 = document.createTextNode('');
$n10.push(effect(() => { $n13.data = String(get(posts).length > 0 ? 'Refreshing…' : 'Loading…'); }));
	$n12.appendChild($n13);
	__p.insertBefore($n12, $n9);
};
const $n14 = () => {
	const __p = $n8.parentNode;
	const $n15 = document.createDocumentFragment();
const $n16 = document.createTextNode('');
$n10.push(effect(() => { $n16.data = String('Fresh'); }));
	$n15.appendChild($n16);
	__p.insertBefore($n15, $n9);
};
$n7.appendChild($n9);
if (postsResource.loading) { $n11(); } else { $n14(); }
$n6.appendChild($n7);
const $n17 = document.createElement("button");
$n17.setAttribute("class", "bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg");
const $n18 = document.createTextNode("Refresh");
$n17.appendChild($n18);
$n17.__evh_click = () => postsResource.refresh();
$n17.setAttribute('data-vsk-ev', '');
$n6.appendChild($n17);
$n0.appendChild($n6);
	$root.appendChild($n0);
const $n19 = document.createComment('if');
$root.appendChild($n19);
let $n21 = [];
const $n20 = document.createComment('if-end');
const $n22 = () => {
	const __p = $n19.parentNode;
	const $n23 = document.createDocumentFragment();
const $n24 = document.createElement("div");
$n24.setAttribute("class", "bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4");
const $n25 = document.createElement("p");
$n25.setAttribute("class", "mb-2");
const $n26 = document.createTextNode("Failed to load posts: ");
$n25.appendChild($n26);
const $n27 = document.createTextNode('');
$n21.push(effect(() => { $n27.data = String(postsResource.error.message); }));
$n25.appendChild($n27);
$n24.appendChild($n25);
const $n28 = document.createElement("button");
$n28.setAttribute("class", "bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2 rounded-lg");
const $n29 = document.createTextNode("Retry");
$n28.appendChild($n29);
$n28.__evh_click = () => postsResource.refresh();
$n28.setAttribute('data-vsk-ev', '');
$n24.appendChild($n28);
	$n23.appendChild($n24);
	__p.insertBefore($n23, $n20);
};
$root.appendChild($n20);
if (postsResource.error) { $n22(); }
const $n30 = document.createComment('map');
$root.appendChild($n30);
let $n32 = [];
const $n31 = document.createComment('map-end');
const $n33 = (post, __e, __r) => {
	__r = __r || $n31;
	const __p = $n30.parentNode;
const $n34 = __components["PostCard"]({ "post": post });
	__p.insertBefore($n34, __r);
};
$root.appendChild($n31);
const $n35 = () => { const __l = get(posts); return __l != null && __l.length > 0; };
for (const post of get(posts)) {
	$n33(post, $n32);
}
const $n36 = __components["PostsSummary"]({  });
	$root.appendChild($n36);
	{
	    let __iv = true;
	    effect(() => {
	      const __nv = postsResource.loading;
	      if (__nv !== __iv) {
	        for (const e of $n10) destroy_block(e);
	        $n10.length = 0;
	        __cleanup($n8, $n9);
	        if (__nv) { $n11(); } else { $n14(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	    let __iv = true;
	    effect(() => {
	      const __nv = postsResource.error;
	      if (__nv !== __iv) {
	        for (const e of $n21) destroy_block(e);
	        $n21.length = 0;
	        __cleanup($n19, $n20);
	        if (__nv) { $n22(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	  let __first = true;
	  effect(() => {
	    const __nv = get(posts);
	    if (__first) { __first = false; return; }
	    for (const e of $n32) destroy_block(e);
	    $n32.length = 0;
	    __cleanup($n30, $n31);
	    for (const post of get(posts)) {
	    	$n33(post, $n32);
	    }
	  });
	}
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

__components["Statements"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
document.title = "Statements — every JS construct";
const items = ['alpha', 'beta', 'gamma']
const obj = { name: 'Vesk', year: 2026, tags: ['fast', 'reactive'] }
const score = 7
let n = 0
const $n0 = document.createElement("h1");
$n0.setAttribute("class", "text-3xl font-bold mb-4");
const $n1 = document.createTextNode("JS Statement Demo");
$n0.appendChild($n1);
	$root.appendChild($n0);
const $n2 = document.createElement("h2");
$n2.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n3 = document.createTextNode("if / else");
$n2.appendChild($n3);
	$root.appendChild($n2);
const $n4 = document.createComment('if');
$root.appendChild($n4);
let $n6 = [];
const $n5 = document.createComment('if-end');
const $n7 = () => {
	const __p = $n4.parentNode;
	const $n8 = document.createDocumentFragment();
const $n9 = document.createElement("p");
$n9.setAttribute("class", "text-green-600");
const $n10 = document.createTextNode("Score ");
$n9.appendChild($n10);
const $n11 = document.createTextNode('');
$n6.push(effect(() => { $n11.data = String(score); }));
$n9.appendChild($n11);
const $n12 = document.createTextNode(" is above the threshold");
$n9.appendChild($n12);
	$n8.appendChild($n9);
	__p.insertBefore($n8, $n5);
};
const $n13 = () => {
	const __p = $n4.parentNode;
	const $n14 = document.createDocumentFragment();
const $n15 = document.createElement("p");
$n15.setAttribute("class", "text-red-600");
const $n16 = document.createTextNode("Score ");
$n15.appendChild($n16);
const $n17 = document.createTextNode('');
$n6.push(effect(() => { $n17.data = String(score); }));
$n15.appendChild($n17);
const $n18 = document.createTextNode(" is low");
$n15.appendChild($n18);
	$n14.appendChild($n15);
	__p.insertBefore($n14, $n5);
};
$root.appendChild($n5);
if (score > 5) { $n7(); } else { $n13(); }
const $n19 = document.createElement("h2");
$n19.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n20 = document.createTextNode("ternary");
$n19.appendChild($n20);
	$root.appendChild($n19);
const $n21 = document.createElement("p");
const $n22 = document.createComment('if');
$n21.appendChild($n22);
let $n24 = [];
const $n23 = document.createComment('if-end');
const $n25 = () => {
	const __p = $n22.parentNode;
	const $n26 = document.createDocumentFragment();
const $n27 = document.createTextNode('');
$n24.push(effect(() => { $n27.data = String('even'); }));
	$n26.appendChild($n27);
	__p.insertBefore($n26, $n23);
};
const $n28 = () => {
	const __p = $n22.parentNode;
	const $n29 = document.createDocumentFragment();
const $n30 = document.createTextNode('');
$n24.push(effect(() => { $n30.data = String('odd'); }));
	$n29.appendChild($n30);
	__p.insertBefore($n29, $n23);
};
$n21.appendChild($n23);
if (score % 2 === 0) { $n25(); } else { $n28(); }
	$root.appendChild($n21);
const $n31 = document.createElement("h2");
$n31.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n32 = document.createTextNode("switch");
$n31.appendChild($n32);
	$root.appendChild($n31);
const $n33 = document.createElement("h2");
$n33.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n34 = document.createTextNode("for loop");
$n33.appendChild($n34);
	$root.appendChild($n33);
const $n35 = document.createElement("h2");
$n35.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n36 = document.createTextNode("for-of (array values)");
$n35.appendChild($n36);
	$root.appendChild($n35);
const $n37 = document.createComment('map');
$root.appendChild($n37);
let $n39 = [];
const $n38 = document.createComment('map-end');
const $n40 = (item, __e, __r) => {
	__r = __r || $n38;
	const __p = $n37.parentNode;
const $n41 = document.createElement("span");
$n41.setAttribute("class", "mr-2");
const $n42 = document.createTextNode('');
__e.push(effect(() => { $n42.data = String(item); }));
$n41.appendChild($n42);
	__p.insertBefore($n41, __r);
};
$root.appendChild($n38);
const $n43 = () => { const __l = items; return __l != null && __l.length > 0; };
for (const item of items) {
	$n40(item, $n39);
}
const $n44 = document.createElement("h2");
$n44.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n45 = document.createTextNode("for-in (object keys)");
$n44.appendChild($n45);
	$root.appendChild($n44);
const $n46 = document.createElement("h2");
$n46.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n47 = document.createTextNode("while");
$n46.appendChild($n47);
	$root.appendChild($n46);
const $n48 = document.createElement("h2");
$n48.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n49 = document.createTextNode("do-while");
$n48.appendChild($n49);
	$root.appendChild($n48);
const $n50 = document.createElement("h2");
$n50.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n51 = document.createTextNode("try / catch / throw");
$n50.appendChild($n51);
	$root.appendChild($n50);
const $n52 = document.createComment('try');
$root.appendChild($n52);
let $n54 = [];
const $n53 = document.createComment('try-end');
const $n55 = () => {
	const __p = $n52.parentNode;
throw new Error('Boom!')
};
const $n56 = (e) => {
	const __p = $n52.parentNode;
const $n57 = document.createElement("p");
$n57.setAttribute("class", "text-red-600");
const $n58 = document.createTextNode("Caught: ");
$n57.appendChild($n58);
const $n59 = document.createTextNode('');
$n57.appendChild($n59);
	__p.insertBefore($n57, $n53);
	effect(() => { $n59.data = String(e.message); });
};
$root.appendChild($n53);
try { $n55(); } catch(e) { $n56(e); }
const $n60 = () => {
	const __p = $n52.parentNode;
throw new Error('Boom!')
};
const $n61 = (e) => {
	const __p = $n52.parentNode;
const $n62 = document.createElement("p");
$n62.setAttribute("class", "text-red-600");
const $n63 = document.createTextNode("Caught: ");
$n62.appendChild($n63);
const $n64 = document.createTextNode('');
$n62.appendChild($n64);
	__p.insertBefore($n62, $n53);
	effect(() => { $n64.data = String(e.message); });
};
const $n65 = document.createElement("h2");
$n65.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n66 = document.createTextNode("labeled block");
$n65.appendChild($n66);
	$root.appendChild($n65);
const $n67 = document.createElement("p");
$n67.setAttribute("class", "text-gray-500");
const $n68 = document.createTextNode("This whole paragraph lives inside a labeled block.");
$n67.appendChild($n68);
	$root.appendChild($n67);
const $n69 = document.createElement("h2");
$n69.setAttribute("class", "text-xl font-semibold mt-6 mb-2");
const $n70 = document.createTextNode("runtime statements");
$n69.appendChild($n70);
	$root.appendChild($n69);
const total = items.length * 2
const $n71 = document.createElement("p");
const $n72 = document.createTextNode("items.length * 2 = ");
$n71.appendChild($n72);
const $n73 = document.createTextNode('');
$n71.appendChild($n73);
	$root.appendChild($n71);
	{
	    let __iv = true;
	    effect(() => {
	      const __nv = score > 5;
	      if (__nv !== __iv) {
	        for (const e of $n6) destroy_block(e);
	        $n6.length = 0;
	        __cleanup($n4, $n5);
	        if (__nv) { $n7(); } else { $n13(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	    let __iv = true;
	    effect(() => {
	      const __nv = score % 2 === 0;
	      if (__nv !== __iv) {
	        for (const e of $n24) destroy_block(e);
	        $n24.length = 0;
	        __cleanup($n22, $n23);
	        if (__nv) { $n25(); } else { $n28(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	  let __first = true;
	  effect(() => {
	    const __nv = items;
	    if (__first) { __first = false; return; }
	    for (const e of $n39) destroy_block(e);
	    $n39.length = 0;
	    __cleanup($n37, $n38);
	    for (const item of items) {
	    	$n40(item, $n39);
	    }
	  });
	}
	{
	    effect(() => {
	      for (const e of $n54) destroy_block(e);
	      $n54.length = 0;
	      __cleanup($n52, $n53);
	      try { $n60(); } catch(e) { $n61(e); }
	    });
	  }
	effect(() => { $n73.data = String(total); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["Store"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = document.createElement("h1");
$n0.setAttribute("class", "text-3xl font-bold mb-4");
const $n1 = document.createTextNode("Store");
$n0.appendChild($n1);
	$root.appendChild($n0);
const $n2 = document.createElement("p");
$n2.setAttribute("class", "text-gray-600 mb-6");
const $n3 = document.createTextNode("Route-level error and not-found boundaries live under /store.");
$n2.appendChild($n3);
	$root.appendChild($n2);
const $n4 = document.createElement("ul");
$n4.setAttribute("class", "space-y-3");
const $n5 = document.createElement("li");
const $n6 = (() => { const $f = document.createDocumentFragment();
const $n7 = document.createTextNode("/store/widget — renders normally");
$f.appendChild($n7);
return $f; })();
const $n8 = Link({ "href": "/store/widget", "class": "text-blue-600 no-underline hover:underline", children: $n6 });
$n5.appendChild($n8);
$n4.appendChild($n5);
const $n9 = document.createElement("li");
const $n10 = (() => { const $f = document.createDocumentFragment();
const $n11 = document.createTextNode("/store/missing — throws NotFoundError → store not-found");
$f.appendChild($n11);
return $f; })();
const $n12 = Link({ "href": "/store/missing", "class": "text-blue-600 no-underline hover:underline", children: $n10 });
$n9.appendChild($n12);
$n4.appendChild($n9);
const $n13 = document.createElement("li");
const $n14 = (() => { const $f = document.createDocumentFragment();
const $n15 = document.createTextNode("/store/boom — throws Error → store error boundary");
$f.appendChild($n15);
return $f; })();
const $n16 = Link({ "href": "/store/boom", "class": "text-blue-600 no-underline hover:underline", children: $n14 });
$n13.appendChild($n16);
$n4.appendChild($n13);
	$root.appendChild($n4);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["StoreError"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = document.createElement("div");
$n0.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-amber-50 border-l-4 border-amber-500 rounded-r-lg");
const $n1 = document.createElement("h1");
$n1.setAttribute("class", "text-2xl font-bold text-amber-800 mb-2");
const $n2 = document.createTextNode("Store Error Boundary");
$n1.appendChild($n2);
$n0.appendChild($n1);
const $n3 = document.createElement("p");
$n3.setAttribute("class", "text-amber-700 mb-4");
const $n4 = document.createTextNode('');
$n3.appendChild($n4);
$n0.appendChild($n3);
const $n5 = document.createElement("pre");
$n5.setAttribute("class", "bg-amber-100 p-3 rounded text-xs font-mono overflow-x-auto");
const $n6 = document.createTextNode('');
$n5.appendChild($n6);
$n0.appendChild($n5);
const $n7 = document.createElement("p");
$n7.setAttribute("class", "text-sm text-amber-600");
const $n8 = document.createTextNode('');
$n7.appendChild($n8);
$n0.appendChild($n7);
	$root.appendChild($n0);
	effect(() => { $n4.data = String(props.error); });
	effect(() => { $n6.data = String(props.stack); });
	effect(() => { $n8.data = String(props.url); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["StoreNotFound"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = document.createElement("div");
$n0.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-rose-50 border-l-4 border-rose-500 rounded-r-lg text-center");
const $n1 = document.createElement("h1");
$n1.setAttribute("class", "text-3xl font-bold text-rose-700 mb-2");
const $n2 = document.createTextNode("Store Not Found");
$n1.appendChild($n2);
$n0.appendChild($n1);
const $n3 = document.createElement("p");
$n3.setAttribute("class", "text-rose-600 mb-6");
const $n4 = document.createTextNode("That store item doesn't exist: ");
$n3.appendChild($n4);
const $n5 = document.createElement("code");
$n5.setAttribute("class", "bg-rose-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n6 = document.createTextNode('');
$n5.appendChild($n6);
$n3.appendChild($n5);
$n0.appendChild($n3);
const $n7 = (() => { const $f = document.createDocumentFragment();
const $n8 = document.createTextNode("← Back to store");
$f.appendChild($n8);
return $f; })();
const $n9 = Link({ "href": "/store", "class": "text-rose-700 no-underline hover:underline font-medium", children: $n7 });
$n0.appendChild($n9);
	$root.appendChild($n0);
	effect(() => { $n6.data = String(props.url); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__components["StoreItem"] = (props) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = document.createDocumentFragment();
const $n0 = document.createComment('if');
$root.appendChild($n0);
let $n2 = [];
const $n1 = document.createComment('if-end');
const $n3 = () => {
	const __p = $n0.parentNode;
	const $n4 = document.createDocumentFragment();
throw new NotFoundError()
	__p.insertBefore($n4, $n1);
};
$root.appendChild($n1);
if (props.params.item === 'missing') { $n3(); }
const $n5 = document.createComment('if');
$root.appendChild($n5);
let $n7 = [];
const $n6 = document.createComment('if-end');
const $n8 = () => {
	const __p = $n5.parentNode;
	const $n9 = document.createDocumentFragment();
throw new Error('Store exploded: stock API unavailable')
	__p.insertBefore($n9, $n6);
};
$root.appendChild($n6);
if (props.params.item === 'boom') { $n8(); }
const $n10 = document.createElement("h1");
$n10.setAttribute("class", "text-3xl font-bold mb-2");
const $n11 = document.createTextNode("Item: ");
$n10.appendChild($n11);
const $n12 = document.createTextNode('');
$n10.appendChild($n12);
	$root.appendChild($n10);
const $n13 = document.createElement("p");
$n13.setAttribute("class", "text-gray-600");
const $n14 = document.createTextNode("Rendered normally at the store item route.");
$n13.appendChild($n14);
	$root.appendChild($n13);
	{
	    let __iv = true;
	    effect(() => {
	      const __nv = props.params.item === 'missing';
	      if (__nv !== __iv) {
	        for (const e of $n2) destroy_block(e);
	        $n2.length = 0;
	        __cleanup($n0, $n1);
	        if (__nv) { $n3(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	    let __iv = true;
	    effect(() => {
	      const __nv = props.params.item === 'boom';
	      if (__nv !== __iv) {
	        for (const e of $n7) destroy_block(e);
	        $n7.length = 0;
	        __cleanup($n5, $n6);
	        if (__nv) { $n8(); }
	        __iv = __nv;
	      }
	    });
	  }
	effect(() => { $n12.data = String(props.params.item); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};
Object.defineProperty(__components, "Page_App", { get: () => __components["Home"], configurable: true });
Object.defineProperty(__components, "Layout_App", { get: () => __components["Layout"], configurable: true });
Object.defineProperty(__components, "Error_App", { get: () => __components["ErrorPage"], configurable: true });
Object.defineProperty(__components, "NotFound_App", { get: () => __components["NotFound404"], configurable: true });
Object.defineProperty(__components, "Page_App_about", { get: () => __components["About"], configurable: true });
Object.defineProperty(__components, "Page_App_actions", { get: () => __components["Actions"], configurable: true });
Object.defineProperty(__components, "Page_App_async", { get: () => __components["AsyncPage"], configurable: true });
Object.defineProperty(__components, "Page_App_blog", { get: () => __components["Blog"], configurable: true });
Object.defineProperty(__components, "Page_App_blog_slug", { get: () => __components["BlogPost"], configurable: true });
Object.defineProperty(__components, "Page_App_empty", { get: () => __components["EmptyDemo"], configurable: true });
Object.defineProperty(__components, "Page_App_map", { get: () => __components["MapDemo"], configurable: true });
Object.defineProperty(__components, "Page_App_posts", { get: () => __components["Posts"], configurable: true });
Object.defineProperty(__components, "Page_App_statements", { get: () => __components["Statements"], configurable: true });
Object.defineProperty(__components, "Page_App_store", { get: () => __components["Store"], configurable: true });
Object.defineProperty(__components, "Error_App_store", { get: () => __components["StoreError"], configurable: true });
Object.defineProperty(__components, "NotFound_App_store", { get: () => __components["StoreNotFound"], configurable: true });
Object.defineProperty(__components, "Page_App_store_item", { get: () => __components["StoreItem"], configurable: true });
__hydrators["Home"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
document.title = " VeskTS test app ";
const count = track(10);
const $n2 = __hydrate.nextElement("p");
const $n3 = document.createTextNode('');
$n2.appendChild($n3);
	if ($n2.parentNode !== $root) $root.appendChild($n2);
const $n4 = document.createComment('if');
$root.appendChild($n4);
let $n6 = [];
const $n5 = document.createComment('if-end');
const $n7 = () => {
	const __p = $n4.parentNode;
	const $n8 = document.createDocumentFragment();
	__p.insertBefore($n8, $n5);
};
const $n10 = () => {
	const __p = $n4.parentNode;
	const $n11 = document.createDocumentFragment();
	__p.insertBefore($n11, $n5);
};
$root.appendChild($n5);
const $n13 = __hydrate.nextElement("button");
const $n14 = document.createTextNode(" + ");
$n13.appendChild($n14);
$n13.__evh_click = () => set(count, get(count) + 1);
$n13.setAttribute('data-vsk-ev', '');
	if ($n13.parentNode !== $root) $root.appendChild($n13);
const $n15 = __hydrate.nextElement("div");
$n15.setAttribute("class", "bg-white gg rounded-xl p-6 shadow-sm border border-gray-100");
const $n19 = __hydrators["Appx"]({  }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n15.appendChild($n19);
const $n20 = __hydrators["Appxx"]({ "count": count }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n15.appendChild($n20);
	if ($n15.parentNode !== $root) $root.appendChild($n15);
	effect(() => { $n3.data = String(get(count)); });
	{
	    let __iv = !2 > 3;
	    effect(() => {
	      const __nv = 2 > 3;
	      if (__nv !== __iv) {
	        for (const e of $n6) destroy_block(e);
	        $n6.length = 0;
	        __cleanup($n4, $n5);
	        if (__nv) { $n7(); } else { $n10(); }
	        __iv = __nv;
	      }
	    });
	  }
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

__hydrators["Throws"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
if (props.fail) throw new Error(props.msg);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["Appx"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = document.createComment('try');
$root.appendChild($n0);
let $n2 = [];
const $n1 = document.createComment('try-end');
const $n3 = () => {
	const __p = $n0.parentNode;
const $n4 = document.createDocumentFragment();
const $n5 = __hydrators["Throws"]({ "fail": true, "msg": "Boom!" }, __registry, __hydrate.subWalker($n4));
	__p.insertBefore($n5, $n1);
};
const $n6 = (e) => {
	const __p = $n0.parentNode;
const $n7 = __hydrate.nextElement("p");
$n7.setAttribute("class", "error");
const $n8 = document.createTextNode("Error: ");
$n7.appendChild($n8);
const $n9 = document.createTextNode('');
$n7.appendChild($n9);
	__p.insertBefore($n7, $n1);
	effect(() => { $n9.data = String(e.message); });
};
$root.appendChild($n1);
try { $n3(); } catch(e) { $n6(e); }
const $n10 = () => {
	const __p = $n0.parentNode;
const $n11 = __runtime_comps["Throws"]({ "fail": true, "msg": "Boom!" });
	__p.insertBefore($n11, $n1);
};
const $n12 = (e) => {
	const __p = $n0.parentNode;
const $n13 = document.createElement("p");
$n13.setAttribute("class", "error");
const $n14 = document.createTextNode("Error: ");
$n13.appendChild($n14);
const $n15 = document.createTextNode('');
$n13.appendChild($n15);
	__p.insertBefore($n13, $n1);
	effect(() => { $n15.data = String(e.message); });
};
	{
	    effect(() => {
	      for (const e of $n2) destroy_block(e);
	      $n2.length = 0;
	      __cleanup($n0, $n1);
	      try { $n10(); } catch(e) { $n12(e); }
	    });
	  }
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["Throw"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
if (props.count < 15) throw new Error(props.msg);
const $n0 = __hydrate.nextElement("p");
const $n1 = document.createTextNode("OK ");
$n0.appendChild($n1);
const $n2 = document.createTextNode('');
$n0.appendChild($n2);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	effect(() => { $n2.data = String(props.count); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["Appxx"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("p");
const $n1 = document.createTextNode(" Count: ");
$n0.appendChild($n1);
const $n2 = document.createTextNode('');
$n0.appendChild($n2);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
const $n3 = document.createComment('try');
$root.appendChild($n3);
let $n5 = [];
const $n4 = document.createComment('try-end');
const $n6 = () => {
	const __p = $n3.parentNode;
const $n7 = document.createDocumentFragment();
const $n8 = __hydrators["Throw"]({ "count": props.count, "msg": `Insufficient! ${props.count} ` }, __registry, __hydrate.subWalker($n7));
	__p.insertBefore($n8, $n4);
};
const $n9 = (e) => {
	const __p = $n3.parentNode;
const $n10 = __hydrate.nextElement("p");
$n10.setAttribute("class", "error");
const $n11 = document.createTextNode("Error: ");
$n10.appendChild($n11);
const $n12 = document.createTextNode('');
$n10.appendChild($n12);
	__p.insertBefore($n10, $n4);
	effect(() => { $n12.data = String(e.message); });
};
$root.appendChild($n4);
try { $n6(); } catch(e) { $n9(e); }
const $n13 = () => {
	const __p = $n3.parentNode;
const $n14 = __runtime_comps["Throw"]({ "count": props.count, "msg": `Insufficient! ${props.count} ` });
	__p.insertBefore($n14, $n4);
};
const $n15 = (e) => {
	const __p = $n3.parentNode;
const $n16 = document.createElement("p");
$n16.setAttribute("class", "error");
const $n17 = document.createTextNode("Error: ");
$n16.appendChild($n17);
const $n18 = document.createTextNode('');
$n16.appendChild($n18);
	__p.insertBefore($n16, $n4);
	effect(() => { $n18.data = String(e.message); });
};
	effect(() => { $n2.data = String(props.count); });
	{
	    effect(() => {
	      for (const e of $n5) destroy_block(e);
	      $n5.length = 0;
	      __cleanup($n3, $n4);
	      try { $n13(); } catch(e) { $n15(e); }
	    });
	  }
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["Layout"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	if (!document.getElementById("vesk-Layout")) {
			const s = document.createElement('style'); s.id = "vesk-Layout"; s.textContent = "  .nav { margin-left: 20px; display: flex; gap: 10px; } "; document.head.appendChild(s);
	}
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("nav");
$n0.setAttribute("class", "flex nav gap-6 px-8 py-4 border-b border-gray-200 bg-white");
const $n1 = (() => { const $f = document.createDocumentFragment();
const $n2 = document.createTextNode("Home");
$f.appendChild($n2);
return $f; })();
const $n3 = NavLink({ "href": "/", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n1 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n0.appendChild($n3);
const $n4 = (() => { const $f = document.createDocumentFragment();
const $n5 = document.createTextNode("About");
$f.appendChild($n5);
return $f; })();
const $n6 = NavLink({ "href": "/about", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n4 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n0.appendChild($n6);
const $n7 = (() => { const $f = document.createDocumentFragment();
const $n8 = document.createTextNode("Blog");
$f.appendChild($n8);
return $f; })();
const $n9 = NavLink({ "href": "/blog", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n7 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n0.appendChild($n9);
const $n10 = (() => { const $f = document.createDocumentFragment();
const $n11 = document.createTextNode("Posts");
$f.appendChild($n11);
return $f; })();
const $n12 = NavLink({ "href": "/posts", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n10 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n0.appendChild($n12);
const $n13 = (() => { const $f = document.createDocumentFragment();
const $n14 = document.createTextNode("Statements");
$f.appendChild($n14);
return $f; })();
const $n15 = NavLink({ "href": "/statements", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n13 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n0.appendChild($n15);
const $n16 = (() => { const $f = document.createDocumentFragment();
const $n17 = document.createTextNode("Async");
$f.appendChild($n17);
return $f; })();
const $n18 = NavLink({ "href": "/async", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n16 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n0.appendChild($n18);
const $n19 = (() => { const $f = document.createDocumentFragment();
const $n20 = document.createTextNode("Map");
$f.appendChild($n20);
return $f; })();
const $n21 = NavLink({ "href": "/map", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n19 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n0.appendChild($n21);
const $n22 = (() => { const $f = document.createDocumentFragment();
const $n23 = document.createTextNode("Empty");
$f.appendChild($n23);
return $f; })();
const $n24 = NavLink({ "href": "/empty", "class": "text-gray-500 hover:text-black font-medium no-underline", children: $n22 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n0.appendChild($n24);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
const $n25 = __hydrate.nextElement("main");
$n25.setAttribute("class", "max-w-3xl mx-auto my-8 px-4");
if (props.children !== undefined && props.children !== null) {
  if (typeof props.children === 'function') {
    props.children(__hydrate.subWalker($n25));
  } else {
    $n25.appendChild(props.children);
  }
}
	if ($n25.parentNode !== $root) $root.appendChild($n25);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["ErrorPage"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "min-h-screen flex items-center justify-center bg-gray-50");
const $n1 = __hydrate.nextElement("div");
$n1.setAttribute("class", "max-w-2xl mx-auto p-8 bg-white rounded-xl shadow-sm border border-gray-200");
const $n2 = __hydrate.nextElement("h1");
$n2.setAttribute("class", "text-4xl font-bold text-red-600 mb-4");
const $n3 = document.createTextNode("Error ");
$n2.appendChild($n3);
const $n4 = document.createTextNode('');
$n2.appendChild($n4);
$n1.appendChild($n2);
const $n5 = __hydrate.nextElement("p");
$n5.setAttribute("class", "text-lg text-gray-700 mb-6");
const $n6 = document.createTextNode('');
$n5.appendChild($n6);
$n1.appendChild($n5);
const $n7 = __hydrate.nextElement("pre");
$n7.setAttribute("class", "bg-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto max-h-64 overflow-y-auto");
const $n8 = document.createTextNode('');
$n7.appendChild($n8);
$n1.appendChild($n7);
const $n9 = __hydrate.nextElement("p");
$n9.setAttribute("class", "mt-6 text-gray-500 text-sm");
const $n10 = document.createTextNode('');
$n9.appendChild($n10);
$n1.appendChild($n9);
$n0.appendChild($n1);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	effect(() => { $n4.data = String(props.statusCode); });
	effect(() => { $n6.data = String(props.error); });
	effect(() => { $n8.data = String(props.stack); });
	effect(() => { $n10.data = String(props.url); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["NotFound404"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("main");
$n0.setAttribute("class", "max-w-3xl mx-auto my-16 px-4 text-center");
const $n3 = __hydrate.nextElement("p");
$n3.setAttribute("class", "text-gray-500 mb-8");
const $n4 = document.createTextNode("Sorry, we couldn't find ");
$n3.appendChild($n4);
const $n5 = __hydrate.nextElement("code");
$n5.setAttribute("class", "bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n6 = document.createTextNode('');
$n5.appendChild($n6);
$n3.appendChild($n5);
$n0.appendChild($n3);
const $n7 = (() => { const $f = document.createDocumentFragment();
const $n8 = document.createTextNode("← Go home");
$f.appendChild($n8);
return $f; })();
const $n9 = Link({ "href": "/", "class": "text-blue-600 no-underline hover:underline font-medium", children: $n7 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n0.appendChild($n9);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	effect(() => { $n6.data = String(props.url); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["About"] = (props, __registry, __hydrate) => { return __hydrate.root; };

const signup = {
	__veskAction: true,
	id: '-mvdn9i',
	url: '/_vesk/action/-mvdn9i'
};

__hydrators["Actions"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
document.title = "Actions demo";
const $n1 = (() => { const $f = document.createDocumentFragment();
const $n2 = (() => { const $f = document.createDocumentFragment();
return $f; })();
const $n4 = Field({ "name": "name", "label": "Name", children: $n2 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$f.appendChild($n4);
const $n5 = (() => { const $f = document.createDocumentFragment();
return $f; })();
const $n7 = Field({ "name": "email", "label": "Email", children: $n5 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$f.appendChild($n7);
const $n8 = (() => { const $f = document.createDocumentFragment();
return $f; })();
const $n10 = Field({ "name": "password", "label": "Password", children: $n8 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$f.appendChild($n10);
return $f; })();
const $n12 = Form({ "action": signup, "onSuccess": () => console.log('done'), children: $n1 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
	if ($n12.parentNode !== $root) $root.appendChild($n12);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["AsyncPage"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
document.title = "Async — load() + async components";
const now = Date.now()
const $n3 = document.createComment('if');
$root.appendChild($n3);
let $n5 = [];
const $n4 = document.createComment('if-end');
const $n6 = () => {
	const __p = $n3.parentNode;
	const $n7 = document.createDocumentFragment();
const $n8 = document.createComment('map');
$n7.appendChild($n8);
let $n10 = [];
const $n9 = document.createComment('map-end');
const $n11 = (post, __e, __r) => {
	__r = __r || $n9;
	const __p = $n8.parentNode;
const $n12 = __hydrate.nextElement("div");
$n12.setAttribute("class", "bg-white rounded-lg p-4 mb-3 shadow-sm border border-gray-100");
const $n13 = __hydrate.nextElement("h3");
$n13.setAttribute("class", "font-semibold");
const $n14 = document.createTextNode('');
__e.push(effect(() => { $n14.data = String(post.title); }));
$n13.appendChild($n14);
$n12.appendChild($n13);
const $n15 = __hydrate.nextElement("p");
$n15.setAttribute("class", "text-gray-500 text-sm");
const $n16 = document.createTextNode('');
__e.push(effect(() => { $n16.data = String(post.excerpt); }));
$n15.appendChild($n16);
$n12.appendChild($n15);
	__p.insertBefore($n12, __r);
};
$n7.appendChild($n9);
const $n17 = () => { const __l = props.posts; return __l != null && __l.length > 0; };
for (const post of props.posts) {
	$n11(post, $n10);
}
	__p.insertBefore($n7, $n4);
};
const $n18 = () => {
	const __p = $n3.parentNode;
	const $n19 = document.createDocumentFragment();
	__p.insertBefore($n19, $n4);
};
$root.appendChild($n4);
const $n22 = __hydrate.nextElement("p");
$n22.setAttribute("class", "text-gray-400 text-sm");
const $n23 = document.createTextNode("server timestamp: ");
$n22.appendChild($n23);
const $n24 = document.createTextNode('');
$n22.appendChild($n24);
	if ($n22.parentNode !== $root) $root.appendChild($n22);
	{
	  let __first = true;
	  effect(() => {
	    const __nv = props.posts;
	    if (__first) { __first = false; return; }
	    for (const e of $n10) destroy_block(e);
	    $n10.length = 0;
	    __cleanup($n8, $n9);
	    for (const post of props.posts) {
	    	$n11(post, $n10);
	    }
	  });
	}
	{
	    let __iv = !props.posts && props.posts.length > 0;
	    effect(() => {
	      const __nv = props.posts && props.posts.length > 0;
	      if (__nv !== __iv) {
	        for (const e of $n5) destroy_block(e);
	        $n5.length = 0;
	        __cleanup($n3, $n4);
	        if (__nv) { $n6(); } else { $n18(); }
	        __iv = __nv;
	      }
	    });
	  }
	effect(() => { $n24.data = String(now); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["Blog"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n1 = __hydrate.nextElement("div");
$n1.setAttribute("class", "bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100");
const $n2 = __hydrate.nextElement("h2");
$n2.setAttribute("class", "text-lg font-semibold mb-1");
const $n3 = (() => { const $f = document.createDocumentFragment();
const $n4 = document.createTextNode("Hello World");
$f.appendChild($n4);
return $f; })();
const $n5 = Link({ "href": "/blog/hello-world", "class": "text-gray-900 no-underline hover:text-blue-600", children: $n3 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n2.appendChild($n5);
$n1.appendChild($n2);
	if ($n1.parentNode !== $root) $root.appendChild($n1);
const $n7 = __hydrate.nextElement("div");
$n7.setAttribute("class", "bg-white rounded-lg p-5 mb-4 shadow-sm border border-gray-100");
const $n8 = __hydrate.nextElement("h2");
$n8.setAttribute("class", "text-lg font-semibold mb-1");
const $n9 = (() => { const $f = document.createDocumentFragment();
const $n10 = document.createTextNode("SSR in Vesk");
$f.appendChild($n10);
return $f; })();
const $n11 = Link({ "href": "/blog/ssr-in-vesk", "class": "text-gray-900 no-underline hover:text-blue-600", children: $n9 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n8.appendChild($n11);
$n7.appendChild($n8);
	if ($n7.parentNode !== $root) $root.appendChild($n7);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["BlogPost"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = (() => { const $f = document.createDocumentFragment();
const $n1 = document.createTextNode(" ← Back to blog ");
$f.appendChild($n1);
return $f; })();
const $n2 = Link({ "href": "/blog", "class": "inline-block mb-6 text-blue-600 no-underline hover:underline", children: $n0 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
	if ($n2.parentNode !== $root) $root.appendChild($n2);
const $n3 = __hydrate.nextElement("h1");
$n3.setAttribute("class", "text-3xl font-bold mb-2");
const $n4 = document.createTextNode("Post: ");
$n3.appendChild($n4);
const $n5 = document.createTextNode('');
$n3.appendChild($n5);
	if ($n3.parentNode !== $root) $root.appendChild($n3);
const $n6 = __hydrate.nextElement("div");
$n6.setAttribute("class", "text-gray-600 leading-relaxed");
const $n7 = __hydrate.nextElement("p");
const $n8 = document.createTextNode("This is a dynamic blog post rendered at ");
$n7.appendChild($n8);
const $n9 = __hydrate.nextElement("code");
$n9.setAttribute("class", "bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n10 = document.createTextNode("/");
$n9.appendChild($n10);
const $n11 = document.createTextNode('');
$n9.appendChild($n11);
$n7.appendChild($n9);
const $n12 = document.createTextNode(".");
$n7.appendChild($n12);
$n6.appendChild($n7);
	if ($n6.parentNode !== $root) $root.appendChild($n6);
	effect(() => { $n5.data = String(props.params.slug); });
	effect(() => { $n11.data = String(props.params.slug); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["EmptyDemo"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
document.title = "Empty — keyed for-of with empty fallback";
const todos = track([
		{ id: 1, text: 'Buy milk' },
		{ id: 2, text: 'Write docs' },
	]);
function clear() {
	set(todos, []);
}
function restore() {
	set(todos, [{ id: 1, text: 'Buy milk' }, { id: 2, text: 'Write docs' }]);
}
const $n1 = __hydrate.nextElement("div");
$n1.setAttribute("class", "flex gap-2 mb-6");
const $n2 = __hydrate.nextElement("button");
$n2.setAttribute("class", "bg-red-600 text-white text-sm px-3 py-1 rounded");
const $n3 = document.createTextNode("Clear");
$n2.appendChild($n3);
$n2.__evh_click = clear;
$n2.setAttribute('data-vsk-ev', '');
$n1.appendChild($n2);
const $n4 = __hydrate.nextElement("button");
$n4.setAttribute("class", "bg-blue-600 text-white text-sm px-3 py-1 rounded");
const $n5 = document.createTextNode("Restore");
$n4.appendChild($n5);
$n4.__evh_click = restore;
$n4.setAttribute('data-vsk-ev', '');
$n1.appendChild($n4);
	if ($n1.parentNode !== $root) $root.appendChild($n1);
const $n7 = __hydrate.nextElement("ul");
$n7.setAttribute("class", "space-y-2");
const $n8 = document.createComment('map');
$n7.appendChild($n8);
let $n10 = [];
const $n9 = document.createComment('map-end');
const $n11 = (todo, __e, __r) => {
	__r = __r || $n9;
	const __p = $n8.parentNode;
const $n12 = __hydrate.nextElement("li");
$n12.setAttribute("class", "bg-gray-50 rounded px-3 py-2");
const $n13 = __hydrate.nextElement("b");
const $n14 = document.createTextNode('');
__e.push(effect(() => { $n14.data = String(todo.text); }));
$n13.appendChild($n14);
$n12.appendChild($n13);
const $n15 = __hydrate.nextElement("span");
$n15.setAttribute("class", "text-gray-400 text-sm");
const $n16 = document.createTextNode("#");
$n15.appendChild($n16);
const $n17 = document.createTextNode('');
__e.push(effect(() => { $n17.data = String(todo.id); }));
$n15.appendChild($n17);
$n12.appendChild($n15);
	__p.insertBefore($n12, __r);
};
const $n18 = () => {
	const __p = $n8.parentNode;
	const $n19 = document.createDocumentFragment();
const $n20 = __hydrate.nextElement("li");
$n20.setAttribute("class", "bg-gray-100 rounded px-3 py-2 text-gray-500");
const $n21 = document.createTextNode("No todos yet — click Restore to add some.");
$n20.appendChild($n21);
	$n19.appendChild($n20);
	__p.insertBefore($n19, $n9);
};
$n7.appendChild($n9);
const $n22 = () => { const __l = get(todos); return __l != null && __l.length > 0; };
let $n23 = () => {};
const $n24 = () => { $n23 = reconcile($n8, $n9, get(todos), todo => todo.id, (todo, __i, __e) => $n11(todo, __e)); };
let $n25 = !$n22();
if (!$n25) { $n24(); } else { $n18(); }
	if ($n7.parentNode !== $root) $root.appendChild($n7);
const $n27 = document.createComment('map');
$root.appendChild($n27);
let $n29 = [];
const $n28 = document.createComment('map-end');
const $n30 = (todo, __e, __r) => {
	__r = __r || $n28;
	const __p = $n27.parentNode;
const $n31 = __hydrate.nextElement("div");
$n31.setAttribute("class", "bg-gray-50 rounded px-3 py-2 mb-2");
const $n32 = __hydrate.nextElement("b");
const $n33 = document.createTextNode('');
__e.push(effect(() => { $n33.data = String(todo.text); }));
$n32.appendChild($n33);
$n31.appendChild($n32);
const $n34 = __hydrate.nextElement("span");
$n34.setAttribute("class", "text-gray-400 text-sm");
const $n35 = document.createTextNode("#");
$n34.appendChild($n35);
const $n36 = document.createTextNode('');
__e.push(effect(() => { $n36.data = String(todo.id); }));
$n34.appendChild($n36);
$n31.appendChild($n34);
	__p.insertBefore($n31, __r);
};
const $n37 = () => {
	const __p = $n27.parentNode;
	const $n38 = document.createDocumentFragment();
const $n39 = __hydrate.nextElement("div");
$n39.setAttribute("class", "bg-gray-100 rounded px-3 py-2 mb-2 text-gray-500");
const $n40 = document.createTextNode("Statement-mode: list is empty.");
$n39.appendChild($n40);
	$n38.appendChild($n39);
	__p.insertBefore($n38, $n28);
};
$root.appendChild($n28);
const $n41 = () => { const __l = get(todos); return __l != null && __l.length > 0; };
let $n42 = () => {};
const $n43 = () => { $n42 = reconcile($n27, $n28, get(todos), todo => todo.id, (todo, __i, __e) => $n30(todo, __e)); };
let $n44 = !$n41();
if (!$n44) { $n43(); } else { $n37(); }
	{
	  let __first = true;
	  effect(() => {
	    const __new = $n22();
	    if (__first) { __first = false; return; }
	    if (__new !== $n25) {
	      if (__new) $n23(get(todos));
	      return;
	    }
	    $n25 = !__new;
	    for (const e of $n10) destroy_block(e);
	    $n10.length = 0;
	    __cleanup($n8, $n9);
	    if (__new) { $n24(); } else { $n18(); }
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __new = $n41();
	    if (__first) { __first = false; return; }
	    if (__new !== $n44) {
	      if (__new) $n42(get(todos));
	      return;
	    }
	    $n44 = !__new;
	    for (const e of $n29) destroy_block(e);
	    $n29.length = 0;
	    __cleanup($n27, $n28);
	    if (__new) { $n43(); } else { $n37(); }
	  });
	}
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

__hydrators["MapDemo"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
document.title = "Map — inline .map() in JSX";
const users = [
		{ id: 1, name: 'Ada', role: 'admin' },
		{ id: 2, name: 'Grace', role: 'dev' },
		{ id: 3, name: 'Alan', role: 'dev' },
	]
const numbers = [1, 2, 3, 4, 5]
const $n2 = __hydrate.nextElement("ul");
$n2.setAttribute("class", "space-y-2");
const $n3 = document.createComment('map');
$n2.appendChild($n3);
let $n5 = [];
const $n4 = document.createComment('map-end');
const $n6 = (u, __e, __r) => {
	__r = __r || $n4;
	const __p = $n3.parentNode;
const $n7 = __hydrate.nextElement("li");
$n7.setAttribute("class", "bg-gray-50 rounded px-3 py-2");
const $n8 = __hydrate.nextElement("b");
const $n9 = document.createTextNode('');
__e.push(effect(() => { $n9.data = String(u.name); }));
$n8.appendChild($n9);
$n7.appendChild($n8);
const $n10 = document.createTextNode(" — ");
$n7.appendChild($n10);
const $n11 = document.createTextNode('');
__e.push(effect(() => { $n11.data = String(u.role); }));
$n7.appendChild($n11);
	__p.insertBefore($n7, __r);
};
$n2.appendChild($n4);
const $n12 = () => { const __l = users; return __l != null && __l.length > 0; };
for (const u of users) {
	$n6(u, $n5);
}
	if ($n2.parentNode !== $root) $root.appendChild($n2);
const $n14 = __hydrate.nextElement("p");
const $n15 = document.createComment('map');
$n14.appendChild($n15);
let $n17 = [];
const $n16 = document.createComment('map-end');
const $n18 = (u, __i, __e, __r) => {
	__r = __r || $n16;
	const i = __i;
	const __p = $n15.parentNode;
const $n19 = __hydrate.nextElement("span");
$n19.setAttribute("class", "mr-3");
const $n20 = document.createTextNode("#");
$n19.appendChild($n20);
const $n21 = document.createTextNode('');
__e.push(effect(() => { $n21.data = String(i + 1); }));
$n19.appendChild($n21);
const $n22 = document.createTextNode(": ");
$n19.appendChild($n22);
const $n23 = document.createTextNode('');
__e.push(effect(() => { $n23.data = String(u.name); }));
$n19.appendChild($n23);
	__p.insertBefore($n19, __r);
};
$n14.appendChild($n16);
const $n24 = () => { const __l = users; return __l != null && __l.length > 0; };
let __i = 0;
for (const u of users) {
	$n18(u, __i, $n17);
	__i++;
}
	if ($n14.parentNode !== $root) $root.appendChild($n14);
const $n26 = __hydrate.nextElement("div");
$n26.setAttribute("class", "flex gap-2");
const $n27 = document.createComment('map');
$n26.appendChild($n27);
let $n29 = [];
const $n28 = document.createComment('map-end');
const $n30 = (n, __e, __r) => {
	__r = __r || $n28;
	const __p = $n27.parentNode;
const $n31 = __hydrate.nextElement("span");
$n31.setAttribute("class", "bg-blue-600 text-white text-sm px-3 py-1 rounded-full");
const $n32 = document.createTextNode('');
__e.push(effect(() => { $n32.data = String(n); }));
$n31.appendChild($n32);
	__p.insertBefore($n31, __r);
};
$n26.appendChild($n28);
const $n33 = () => { const __l = numbers; return __l != null && __l.length > 0; };
let $n34 = () => {};
const $n35 = () => { $n34 = reconcile($n27, $n28, numbers, n => n, (n, __i, __e) => $n30(n, __e)); };
$n35();
	if ($n26.parentNode !== $root) $root.appendChild($n26);
const $n37 = __hydrate.nextElement("p");
const $n38 = document.createComment('map');
$n37.appendChild($n38);
let $n40 = [];
const $n39 = document.createComment('map-end');
const $n41 = (n, __e, __r) => {
	__r = __r || $n39;
	const __p = $n38.parentNode;
const $n42 = __hydrate.nextElement("span");
$n42.setAttribute("class", "mr-3");
const $n43 = document.createTextNode('');
__e.push(effect(() => { $n43.data = String(n); }));
$n42.appendChild($n43);
const $n44 = document.createTextNode("²=");
$n42.appendChild($n44);
const $n45 = document.createTextNode('');
__e.push(effect(() => { $n45.data = String(n * n); }));
$n42.appendChild($n45);
	__p.insertBefore($n42, __r);
};
$n37.appendChild($n39);
const $n46 = () => { const __l = numbers.filter(n => n % 2 === 1); return __l != null && __l.length > 0; };
for (const n of numbers.filter(n => n % 2 === 1)) {
	$n41(n, $n40);
}
	if ($n37.parentNode !== $root) $root.appendChild($n37);
	{
	  let __first = true;
	  effect(() => {
	    const __nv = users;
	    if (__first) { __first = false; return; }
	    for (const e of $n5) destroy_block(e);
	    $n5.length = 0;
	    __cleanup($n3, $n4);
	    for (const u of users) {
	    	$n6(u, $n5);
	    }
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __nv = users;
	    if (__first) { __first = false; return; }
	    for (const e of $n17) destroy_block(e);
	    $n17.length = 0;
	    __cleanup($n15, $n16);
	    let __i = 0;
	    for (const u of users) {
	    	$n18(u, __i, $n17);
	    	__i++;
	    }
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __nv = numbers;
	    if (__first) { __first = false; return; }
	    $n34(numbers);
	  });
	}
	{
	  let __first = true;
	  effect(() => {
	    const __nv = numbers.filter(n => n % 2 === 1);
	    if (__first) { __first = false; return; }
	    for (const e of $n40) destroy_block(e);
	    $n40.length = 0;
	    __cleanup($n38, $n39);
	    for (const n of numbers.filter(n => n % 2 === 1)) {
	    	$n41(n, $n40);
	    }
	  });
	}
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["PostCard"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("article");
$n0.setAttribute("class", "bg-white rounded-lg p-6 mb-4 shadow-sm border border-gray-100");
const $n1 = __hydrate.nextElement("div");
$n1.setAttribute("class", "flex items-center justify-between mb-2");
const $n2 = __hydrate.nextElement("h2");
$n2.setAttribute("class", "text-xl font-semibold");
const $n3 = document.createTextNode('');
$n2.appendChild($n3);
$n1.appendChild($n2);
const $n4 = __hydrate.nextElement("span");
$n4.setAttribute("class", "text-gray-400 text-sm");
const $n5 = document.createTextNode('');
$n4.appendChild($n5);
$n1.appendChild($n4);
$n0.appendChild($n1);
const $n6 = __hydrate.nextElement("p");
$n6.setAttribute("class", "text-gray-500 mb-3");
const $n7 = document.createTextNode('');
$n6.appendChild($n7);
$n0.appendChild($n6);
const $n8 = __hydrate.nextElement("div");
$n8.setAttribute("class", "flex gap-2 mb-3");
$n0.appendChild($n8);
const $n9 = __hydrate.nextElement("p");
$n9.setAttribute("class", "text-gray-400 text-sm");
const $n10 = document.createTextNode("By ");
$n9.appendChild($n10);
const $n11 = document.createTextNode('');
$n9.appendChild($n11);
$n0.appendChild($n9);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	effect(() => { $n3.data = String(props.post.title); });
	effect(() => { $n5.data = String(props.post.date); });
	effect(() => { $n7.data = String(props.post.excerpt); });
	effect(() => { $n11.data = String(props.post.author); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["PostsSummary"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const summary = useFetch('/api/posts', {
		key: 'posts',
		staleTime: 30000,
	})
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["Posts"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
document.title = "Posts — useFetch demo";
const posts = track([]);
const postsResource = useFetch('/api/posts', {
	key: 'posts',
	into: posts,
	staleTime: 30000,
	keepPreviousData: true,
	retry: 2,
	retryDelay: 400,
	timeout: 8000
});
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "flex items-center justify-between mb-6");
const $n2 = __hydrate.nextElement("div");
$n2.setAttribute("class", "flex items-center gap-3");
const $n3 = __hydrate.nextElement("span");
$n3.setAttribute("class", "text-sm text-gray-400");
const $n4 = document.createComment('if');
$n3.appendChild($n4);
let $n6 = [];
const $n5 = document.createComment('if-end');
const $n7 = () => {
	const __p = $n4.parentNode;
	const $n8 = document.createDocumentFragment();
const $n9 = document.createTextNode('');
$n6.push(effect(() => { $n9.data = String(get(posts).length > 0 ? 'Refreshing…' : 'Loading…'); }));
	$n8.appendChild($n9);
	__p.insertBefore($n8, $n5);
};
const $n10 = () => {
	const __p = $n4.parentNode;
	const $n11 = document.createDocumentFragment();
const $n12 = document.createTextNode('');
$n6.push(effect(() => { $n12.data = String('Fresh'); }));
	$n11.appendChild($n12);
	__p.insertBefore($n11, $n5);
};
$n3.appendChild($n5);
$n2.appendChild($n3);
const $n13 = __hydrate.nextElement("button");
$n13.setAttribute("class", "bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg");
const $n14 = document.createTextNode("Refresh");
$n13.appendChild($n14);
$n13.__evh_click = () => postsResource.refresh();
$n13.setAttribute('data-vsk-ev', '');
$n2.appendChild($n13);
$n0.appendChild($n2);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
const $n15 = document.createComment('if');
$root.appendChild($n15);
let $n17 = [];
const $n16 = document.createComment('if-end');
const $n18 = () => {
	const __p = $n15.parentNode;
	const $n19 = document.createDocumentFragment();
const $n20 = __hydrate.nextElement("div");
$n20.setAttribute("class", "bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-4");
const $n21 = __hydrate.nextElement("p");
$n21.setAttribute("class", "mb-2");
const $n22 = document.createTextNode("Failed to load posts: ");
$n21.appendChild($n22);
const $n23 = document.createTextNode('');
$n17.push(effect(() => { $n23.data = String(postsResource.error.message); }));
$n21.appendChild($n23);
$n20.appendChild($n21);
const $n24 = __hydrate.nextElement("button");
$n24.setAttribute("class", "bg-red-600 hover:bg-red-700 text-white text-sm px-4 py-2 rounded-lg");
const $n25 = document.createTextNode("Retry");
$n24.appendChild($n25);
$n24.__evh_click = () => postsResource.refresh();
$n24.setAttribute('data-vsk-ev', '');
$n20.appendChild($n24);
	$n19.appendChild($n20);
	__p.insertBefore($n19, $n16);
};
$root.appendChild($n16);
const $n26 = document.createComment('map');
$root.appendChild($n26);
let $n28 = [];
const $n27 = document.createComment('map-end');
const $n29 = (post, __e, __r) => {
	__r = __r || $n27;
	const __p = $n26.parentNode;
const $n30 = __hydrators["PostCard"]({ "post": post }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
	__p.insertBefore($n30, __r);
};
$root.appendChild($n27);
const $n31 = () => { const __l = get(posts); return __l != null && __l.length > 0; };
for (const post of get(posts)) {
	$n29(post, $n28);
}
const $n32 = __hydrators["PostsSummary"]({  }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
	if ($n32.parentNode !== $root) $root.appendChild($n32);
	{
	    let __iv = !postsResource.loading;
	    effect(() => {
	      const __nv = postsResource.loading;
	      if (__nv !== __iv) {
	        for (const e of $n6) destroy_block(e);
	        $n6.length = 0;
	        __cleanup($n4, $n5);
	        if (__nv) { $n7(); } else { $n10(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	    let __iv = !postsResource.error;
	    effect(() => {
	      const __nv = postsResource.error;
	      if (__nv !== __iv) {
	        for (const e of $n17) destroy_block(e);
	        $n17.length = 0;
	        __cleanup($n15, $n16);
	        if (__nv) { $n18(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	  let __first = true;
	  effect(() => {
	    const __nv = get(posts);
	    if (__first) { __first = false; return; }
	    for (const e of $n28) destroy_block(e);
	    $n28.length = 0;
	    __cleanup($n26, $n27);
	    for (const post of get(posts)) {
	    	$n29(post, $n28);
	    }
	  });
	}
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

__hydrators["Statements"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
document.title = "Statements — every JS construct";
const items = ['alpha', 'beta', 'gamma']
const obj = { name: 'Vesk', year: 2026, tags: ['fast', 'reactive'] }
const score = 7
let n = 0
const $n2 = document.createComment('if');
$root.appendChild($n2);
let $n4 = [];
const $n3 = document.createComment('if-end');
const $n5 = () => {
	const __p = $n2.parentNode;
	const $n6 = document.createDocumentFragment();
const $n7 = __hydrate.nextElement("p");
$n7.setAttribute("class", "text-green-600");
const $n8 = document.createTextNode("Score ");
$n7.appendChild($n8);
const $n9 = document.createTextNode('');
$n4.push(effect(() => { $n9.data = String(score); }));
$n7.appendChild($n9);
const $n10 = document.createTextNode(" is above the threshold");
$n7.appendChild($n10);
	$n6.appendChild($n7);
	__p.insertBefore($n6, $n3);
};
const $n11 = () => {
	const __p = $n2.parentNode;
	const $n12 = document.createDocumentFragment();
const $n13 = __hydrate.nextElement("p");
$n13.setAttribute("class", "text-red-600");
const $n14 = document.createTextNode("Score ");
$n13.appendChild($n14);
const $n15 = document.createTextNode('');
$n4.push(effect(() => { $n15.data = String(score); }));
$n13.appendChild($n15);
const $n16 = document.createTextNode(" is low");
$n13.appendChild($n16);
	$n12.appendChild($n13);
	__p.insertBefore($n12, $n3);
};
$root.appendChild($n3);
const $n18 = __hydrate.nextElement("p");
const $n19 = document.createComment('if');
$n18.appendChild($n19);
let $n21 = [];
const $n20 = document.createComment('if-end');
const $n22 = () => {
	const __p = $n19.parentNode;
	const $n23 = document.createDocumentFragment();
const $n24 = document.createTextNode('');
$n21.push(effect(() => { $n24.data = String('even'); }));
	$n23.appendChild($n24);
	__p.insertBefore($n23, $n20);
};
const $n25 = () => {
	const __p = $n19.parentNode;
	const $n26 = document.createDocumentFragment();
const $n27 = document.createTextNode('');
$n21.push(effect(() => { $n27.data = String('odd'); }));
	$n26.appendChild($n27);
	__p.insertBefore($n26, $n20);
};
$n18.appendChild($n20);
	if ($n18.parentNode !== $root) $root.appendChild($n18);
const $n31 = document.createComment('map');
$root.appendChild($n31);
let $n33 = [];
const $n32 = document.createComment('map-end');
const $n34 = (item, __e, __r) => {
	__r = __r || $n32;
	const __p = $n31.parentNode;
const $n35 = __hydrate.nextElement("span");
$n35.setAttribute("class", "mr-2");
const $n36 = document.createTextNode('');
__e.push(effect(() => { $n36.data = String(item); }));
$n35.appendChild($n36);
	__p.insertBefore($n35, __r);
};
$root.appendChild($n32);
const $n37 = () => { const __l = items; return __l != null && __l.length > 0; };
for (const item of items) {
	$n34(item, $n33);
}
const $n42 = document.createComment('try');
$root.appendChild($n42);
let $n44 = [];
const $n43 = document.createComment('try-end');
const $n45 = () => {
	const __p = $n42.parentNode;
const $n46 = document.createDocumentFragment();
throw new Error('Boom!')
};
const $n47 = (e) => {
	const __p = $n42.parentNode;
const $n48 = __hydrate.nextElement("p");
$n48.setAttribute("class", "text-red-600");
const $n49 = document.createTextNode("Caught: ");
$n48.appendChild($n49);
const $n50 = document.createTextNode('');
$n48.appendChild($n50);
	__p.insertBefore($n48, $n43);
	effect(() => { $n50.data = String(e.message); });
};
$root.appendChild($n43);
try { $n45(); } catch(e) { $n47(e); }
const $n51 = () => {
	const __p = $n42.parentNode;
throw new Error('Boom!')
};
const $n52 = (e) => {
	const __p = $n42.parentNode;
const $n53 = document.createElement("p");
$n53.setAttribute("class", "text-red-600");
const $n54 = document.createTextNode("Caught: ");
$n53.appendChild($n54);
const $n55 = document.createTextNode('');
$n53.appendChild($n55);
	__p.insertBefore($n53, $n43);
	effect(() => { $n55.data = String(e.message); });
};
const total = items.length * 2
const $n59 = __hydrate.nextElement("p");
const $n60 = document.createTextNode("items.length * 2 = ");
$n59.appendChild($n60);
const $n61 = document.createTextNode('');
$n59.appendChild($n61);
	if ($n59.parentNode !== $root) $root.appendChild($n59);
	{
	    let __iv = !score > 5;
	    effect(() => {
	      const __nv = score > 5;
	      if (__nv !== __iv) {
	        for (const e of $n4) destroy_block(e);
	        $n4.length = 0;
	        __cleanup($n2, $n3);
	        if (__nv) { $n5(); } else { $n11(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	    let __iv = !score % 2 === 0;
	    effect(() => {
	      const __nv = score % 2 === 0;
	      if (__nv !== __iv) {
	        for (const e of $n21) destroy_block(e);
	        $n21.length = 0;
	        __cleanup($n19, $n20);
	        if (__nv) { $n22(); } else { $n25(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	  let __first = true;
	  effect(() => {
	    const __nv = items;
	    if (__first) { __first = false; return; }
	    for (const e of $n33) destroy_block(e);
	    $n33.length = 0;
	    __cleanup($n31, $n32);
	    for (const item of items) {
	    	$n34(item, $n33);
	    }
	  });
	}
	{
	    effect(() => {
	      for (const e of $n44) destroy_block(e);
	      $n44.length = 0;
	      __cleanup($n42, $n43);
	      try { $n51(); } catch(e) { $n52(e); }
	    });
	  }
	effect(() => { $n61.data = String(total); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["Store"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n2 = __hydrate.nextElement("ul");
$n2.setAttribute("class", "space-y-3");
const $n3 = __hydrate.nextElement("li");
const $n4 = (() => { const $f = document.createDocumentFragment();
const $n5 = document.createTextNode("/store/widget — renders normally");
$f.appendChild($n5);
return $f; })();
const $n6 = Link({ "href": "/store/widget", "class": "text-blue-600 no-underline hover:underline", children: $n4 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n3.appendChild($n6);
$n2.appendChild($n3);
const $n7 = __hydrate.nextElement("li");
const $n8 = (() => { const $f = document.createDocumentFragment();
const $n9 = document.createTextNode("/store/missing — throws NotFoundError → store not-found");
$f.appendChild($n9);
return $f; })();
const $n10 = Link({ "href": "/store/missing", "class": "text-blue-600 no-underline hover:underline", children: $n8 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n7.appendChild($n10);
$n2.appendChild($n7);
const $n11 = __hydrate.nextElement("li");
const $n12 = (() => { const $f = document.createDocumentFragment();
const $n13 = document.createTextNode("/store/boom — throws Error → store error boundary");
$f.appendChild($n13);
return $f; })();
const $n14 = Link({ "href": "/store/boom", "class": "text-blue-600 no-underline hover:underline", children: $n12 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n11.appendChild($n14);
$n2.appendChild($n11);
	if ($n2.parentNode !== $root) $root.appendChild($n2);
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["StoreError"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-amber-50 border-l-4 border-amber-500 rounded-r-lg");
const $n2 = __hydrate.nextElement("p");
$n2.setAttribute("class", "text-amber-700 mb-4");
const $n3 = document.createTextNode('');
$n2.appendChild($n3);
$n0.appendChild($n2);
const $n4 = __hydrate.nextElement("pre");
$n4.setAttribute("class", "bg-amber-100 p-3 rounded text-xs font-mono overflow-x-auto");
const $n5 = document.createTextNode('');
$n4.appendChild($n5);
$n0.appendChild($n4);
const $n6 = __hydrate.nextElement("p");
$n6.setAttribute("class", "text-sm text-amber-600");
const $n7 = document.createTextNode('');
$n6.appendChild($n7);
$n0.appendChild($n6);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	effect(() => { $n3.data = String(props.error); });
	effect(() => { $n5.data = String(props.stack); });
	effect(() => { $n7.data = String(props.url); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["StoreNotFound"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = __hydrate.nextElement("div");
$n0.setAttribute("class", "max-w-2xl mx-auto my-12 p-8 bg-rose-50 border-l-4 border-rose-500 rounded-r-lg text-center");
const $n2 = __hydrate.nextElement("p");
$n2.setAttribute("class", "text-rose-600 mb-6");
const $n3 = document.createTextNode("That store item doesn't exist: ");
$n2.appendChild($n3);
const $n4 = __hydrate.nextElement("code");
$n4.setAttribute("class", "bg-rose-100 px-1.5 py-0.5 rounded text-sm font-mono");
const $n5 = document.createTextNode('');
$n4.appendChild($n5);
$n2.appendChild($n4);
$n0.appendChild($n2);
const $n6 = (() => { const $f = document.createDocumentFragment();
const $n7 = document.createTextNode("← Back to store");
$f.appendChild($n7);
return $f; })();
const $n8 = Link({ "href": "/store", "class": "text-rose-700 no-underline hover:underline font-medium", children: $n6 }, __registry, __hydrate.subWalker(__hydrate.nextElement()));
$n0.appendChild($n8);
	if ($n0.parentNode !== $root) $root.appendChild($n0);
	effect(() => { $n5.data = String(props.url); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};

__hydrators["StoreItem"] = (props, __registry, __hydrate) => {
	props = reactiveProps(props);
	const __prev = getActiveComponent();
	setActiveComponent({ c: null, p: __prev });
	try {
	const $root = __hydrate.root;
const $n0 = document.createComment('if');
$root.appendChild($n0);
let $n2 = [];
const $n1 = document.createComment('if-end');
const $n3 = () => {
	const __p = $n0.parentNode;
	const $n4 = document.createDocumentFragment();
throw new NotFoundError()
	__p.insertBefore($n4, $n1);
};
$root.appendChild($n1);
const $n5 = document.createComment('if');
$root.appendChild($n5);
let $n7 = [];
const $n6 = document.createComment('if-end');
const $n8 = () => {
	const __p = $n5.parentNode;
	const $n9 = document.createDocumentFragment();
throw new Error('Store exploded: stock API unavailable')
	__p.insertBefore($n9, $n6);
};
$root.appendChild($n6);
const $n10 = __hydrate.nextElement("h1");
$n10.setAttribute("class", "text-3xl font-bold mb-2");
const $n11 = document.createTextNode("Item: ");
$n10.appendChild($n11);
const $n12 = document.createTextNode('');
$n10.appendChild($n12);
	if ($n10.parentNode !== $root) $root.appendChild($n10);
	{
	    let __iv = !props.params.item === 'missing';
	    effect(() => {
	      const __nv = props.params.item === 'missing';
	      if (__nv !== __iv) {
	        for (const e of $n2) destroy_block(e);
	        $n2.length = 0;
	        __cleanup($n0, $n1);
	        if (__nv) { $n3(); }
	        __iv = __nv;
	      }
	    });
	  }
	{
	    let __iv = !props.params.item === 'boom';
	    effect(() => {
	      const __nv = props.params.item === 'boom';
	      if (__nv !== __iv) {
	        for (const e of $n7) destroy_block(e);
	        $n7.length = 0;
	        __cleanup($n5, $n6);
	        if (__nv) { $n8(); }
	        __iv = __nv;
	      }
	    });
	  }
	effect(() => { $n12.data = String(props.params.item); });
	return $root;
	} finally {
		setActiveComponent(__prev);
	}
};
Object.defineProperty(__hydrators, "Page_App", { get: () => __hydrators["Home"], configurable: true });
Object.defineProperty(__hydrators, "Layout_App", { get: () => __hydrators["Layout"], configurable: true });
Object.defineProperty(__hydrators, "Error_App", { get: () => __hydrators["ErrorPage"], configurable: true });
Object.defineProperty(__hydrators, "NotFound_App", { get: () => __hydrators["NotFound404"], configurable: true });
Object.defineProperty(__hydrators, "Page_App_about", { get: () => __hydrators["About"], configurable: true });
Object.defineProperty(__hydrators, "Page_App_actions", { get: () => __hydrators["Actions"], configurable: true });
Object.defineProperty(__hydrators, "Page_App_async", { get: () => __hydrators["AsyncPage"], configurable: true });
Object.defineProperty(__hydrators, "Page_App_blog", { get: () => __hydrators["Blog"], configurable: true });
Object.defineProperty(__hydrators, "Page_App_blog_slug", { get: () => __hydrators["BlogPost"], configurable: true });
Object.defineProperty(__hydrators, "Page_App_empty", { get: () => __hydrators["EmptyDemo"], configurable: true });
Object.defineProperty(__hydrators, "Page_App_map", { get: () => __hydrators["MapDemo"], configurable: true });
Object.defineProperty(__hydrators, "Page_App_posts", { get: () => __hydrators["Posts"], configurable: true });
Object.defineProperty(__hydrators, "Page_App_statements", { get: () => __hydrators["Statements"], configurable: true });
Object.defineProperty(__hydrators, "Page_App_store", { get: () => __hydrators["Store"], configurable: true });
Object.defineProperty(__hydrators, "Error_App_store", { get: () => __hydrators["StoreError"], configurable: true });
Object.defineProperty(__hydrators, "NotFound_App_store", { get: () => __hydrators["StoreNotFound"], configurable: true });
Object.defineProperty(__hydrators, "Page_App_store_item", { get: () => __hydrators["StoreItem"], configurable: true });
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
    if (typeof n.error === 'string') n.error = __components[n.error];
    if (typeof n.notFound === 'string') n.notFound = __components[n.notFound];
    if (n.children) __resolveNames(n.children);
  }
}
function __updateComponents(nodes) {
  for (const n of nodes) {
    if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName];
    if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName];
    if (n._errorName && __components[n._errorName]) n.error = __components[n._errorName];
    if (n._notFoundName && __components[n._notFoundName]) n.notFound = __components[n._notFoundName];
    if (n.children) __updateComponents(n.children);
  }
}
const __routeTree = [{"path":"","fullPath":"/","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":null,"layout":null,"loading":null,"error":null,"notFound":null,"hasMiddleware":false,"children":[{"path":"app","fullPath":"/app","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_App","layout":"Layout_App","loading":null,"error":"Error_App","notFound":"NotFound_App","hasMiddleware":true,"children":[{"path":"about","fullPath":"/app/about","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_App_about","layout":null,"loading":null,"error":null,"notFound":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/about","segmentCount":1},{"path":"actions","fullPath":"/app/actions","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_App_actions","layout":null,"loading":null,"error":null,"notFound":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/actions","segmentCount":1},{"path":"async","fullPath":"/app/async","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_App_async","layout":null,"loading":null,"error":null,"notFound":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/async","segmentCount":1},{"path":"blog","fullPath":"/app/blog","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_App_blog","layout":null,"loading":null,"error":null,"notFound":null,"hasMiddleware":true,"children":[{"path":":slug","fullPath":"/app/blog/:slug","isGroup":false,"isDynamic":true,"isCatchAll":false,"page":"Page_App_blog_slug","layout":null,"loading":null,"error":null,"notFound":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/blog/[slug]","segmentCount":1}],"sourceDir":"/root/vesk/test-app/app/blog","segmentCount":1},{"path":"empty","fullPath":"/app/empty","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_App_empty","layout":null,"loading":null,"error":null,"notFound":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/empty","segmentCount":1},{"path":"map","fullPath":"/app/map","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_App_map","layout":null,"loading":null,"error":null,"notFound":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/map","segmentCount":1},{"path":"posts","fullPath":"/app/posts","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_App_posts","layout":null,"loading":null,"error":null,"notFound":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/posts","segmentCount":1},{"path":"statements","fullPath":"/app/statements","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_App_statements","layout":null,"loading":null,"error":null,"notFound":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/statements","segmentCount":1},{"path":"store","fullPath":"/app/store","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_App_store","layout":null,"loading":null,"error":"Error_App_store","notFound":"NotFound_App_store","hasMiddleware":false,"children":[{"path":":item","fullPath":"/app/store/:item","isGroup":false,"isDynamic":true,"isCatchAll":false,"page":"Page_App_store_item","layout":null,"loading":null,"error":null,"notFound":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/store/[item]","segmentCount":1}],"sourceDir":"/root/vesk/test-app/app/store","segmentCount":1}],"sourceDir":"/root/vesk/test-app/app","segmentCount":1}],"sourceDir":"/root/vesk/test-app","segmentCount":0}];
__resolveNames(__routeTree);
const __router = createFileRouter(__routeTree);
globalThis.__vesk_router = __router;
__router.__hydrators = __hydrators;
__router.__updateComponents = __updateComponents;
if (typeof document !== 'undefined') __router.start();
globalThis.__vesk_hmr_eval = (code) => eval(code);
