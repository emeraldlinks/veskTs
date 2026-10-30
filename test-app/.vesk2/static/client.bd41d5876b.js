var __veskRuntime = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../../tmp/vesk-runtime-tree-shake/.runtime-tree-entry.mjs
  var runtime_tree_entry_exports = {};
  __export(runtime_tree_entry_exports, {
    Field: () => Field,
    Form: () => Form,
    Link: () => Link,
    LoadingIndicator: () => LoadingIndicator,
    Md: () => Md,
    NavLink: () => NavLink,
    NotFoundError: () => NotFoundError,
    applyStyle: () => applyStyle,
    collectVskMarkers: () => collectVskMarkers,
    createFileRouter: () => createFileRouter,
    createHydrateWalker: () => createHydrateWalker,
    createLayoutSlot: () => createLayoutSlot,
    createStore: () => createStore,
    defineAction: () => defineAction,
    destroy_block: () => destroy_block,
    effect: () => effect,
    email: () => email,
    ensureChunk: () => ensureChunk,
    get: () => get,
    getActiveComponent: () => getActiveComponent,
    hydrate: () => hydrate,
    hydrateIdle: () => hydrateIdle,
    hydrateOnInteraction: () => hydrateOnInteraction,
    hydrateViewport: () => hydrateViewport,
    leaf: () => leaf,
    matchRoute: () => matchRoute,
    minLength: () => minLength,
    needsHydration: () => needsHydration,
    primitive: () => primitive,
    reactiveProps: () => reactiveProps,
    reconcile: () => reconcile,
    reconcileHydrated: () => reconcileHydrated,
    required: () => required,
    rerenderNode: () => rerenderNode,
    set: () => set,
    setActiveComponent: () => setActiveComponent,
    toDomNode: () => toDomNode,
    track: () => track,
    useFetch: () => useFetch
  });

  // packages/runtime/src/ripple-constants.ts
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
  var UNINITIALIZED = Symbol("uninitialized");
  var TRACKED_ARRAY = Symbol();
  var TRACKED_OBJECT = Symbol();
  var COMPUTED_PROPERTY = Symbol();
  var HMR = Symbol();
  var ARRAY_SET_INDEX_AT = Symbol();
  var MAX_ARRAY_LENGTH = 2 ** 32 - 1;
  var TRACKED_UPDATED = Symbol("TRACKED_UPDATED");
  var SUSPENSE_PENDING = Symbol("suspense_pending");
  var SUSPENSE_REJECTED = Symbol("suspense_rejected");
  var ASYNC_DERIVED_READ_THROWN = Symbol("async_derived_read_thrown");

  // packages/runtime/src/ripple-blocks.ts
  function effect(fn) {
    return block(EFFECT_BLOCK, fn);
  }
  function root(fn) {
    return block(ROOT_BLOCK, fn, { start: null, end: null }, create_component_ctx());
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
    } else {
      newBlock.p = get_orphan_root();
      push_block(newBlock, newBlock.p);
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
    if (prev !== null) prev.next = next;
    if (next !== null) next.prev = prev;
    if (parent !== null) {
      if (parent.first === block2) parent.first = next;
      if (parent.last === block2) parent.last = prev;
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
    unsubscribe_reaction(block2);
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

  // packages/runtime/src/ripple-utils.ts
  function is_ripple_object(v) {
    return typeof v === "object" && v !== null && typeof v.f === "number";
  }

  // packages/runtime/src/ripple-runtime.ts
  var FLUSH_MICROTASK = 0;
  var FLUSH_SYNC = 1;
  var active_block = null;
  var active_reaction = null;
  var active_scope = null;
  var active_component = null;
  var is_mutating_allowed = true;
  var old_values = /* @__PURE__ */ new Map();
  var orphan_root = null;
  function get_orphan_root() {
    if (orphan_root === null) {
      orphan_root = {
        co: null,
        d: null,
        first: null,
        f: ROOT_BLOCK,
        fn: null,
        last: null,
        next: null,
        p: null,
        prev: null,
        s: null,
        t: null,
        tc: null
      };
    }
    return orphan_root;
  }
  function is_orphan(block2) {
    return block2 === null || block2 === void 0 || block2 === orphan_root;
  }
  var scheduler_mode = FLUSH_MICROTASK;
  var is_micro_task_queued = false;
  var clock = 0;
  var queued_root_blocks = [];
  var disable_scoped_flush = false;
  var queued_microtasks = [];
  var flush_count = 0;
  var queued_post_block_flush = [];
  var active_dependency = null;
  var tracking = false;
  var teardown = false;
  function increment_clock() {
    return ++clock;
  }
  function set_active_block(block2) {
    active_block = block2;
  }
  function run_teardown(block2) {
    const fn = block2.t;
    const callbacks = block2.tc;
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
  function on_destroy(fn) {
    const block2 = scope();
    if (block2 == null) return;
    if (block2.tc == null) block2.tc = [];
    block2.tc.push(fn);
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
  function destroy_computed_children(computed) {
    const blocks = computed.blocks;
    if (blocks !== null) {
      computed.blocks = null;
      for (let i = 0; i < blocks.length; i++) {
        destroy_block(blocks[i]);
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
  function run_block(block2) {
    const previous_block = active_block;
    const previous_reaction = active_reaction;
    const previous_tracking = tracking;
    const previous_dependency = active_dependency;
    const previous_component = active_component;
    try {
      active_block = block2;
      active_reaction = block2;
      unsubscribe_reaction(block2);
      active_component = block2.co;
      destroy_non_branch_children(block2);
      run_teardown(block2);
      tracking = (block2.f & (ROOT_BLOCK | BRANCH_BLOCK)) === 0;
      active_dependency = null;
      const res = block2.fn(block2.s);
      if (typeof res === "function") {
        block2.t = res;
        let current = block2;
        while (current !== null && (current.f & CONTAINS_TEARDOWN) === 0) {
          current.f ^= CONTAINS_TEARDOWN;
          current = current.p;
        }
      }
      block2.d = active_dependency;
    } catch (error) {
      block2.d = active_dependency;
      if (error !== ASYNC_DERIVED_READ_THROWN) {
        handle_error(error, block2);
      }
    } finally {
      active_block = previous_block;
      active_reaction = previous_reaction;
      tracking = previous_tracking;
      active_dependency = previous_dependency;
      active_component = previous_component;
    }
  }
  var empty_get_set = { get: void 0, set: void 0 };
  var TrackedValue = class {
    a;
    b;
    c;
    d;
    f;
    r;
    __v;
    constructor(v, block2, a) {
      this.a = a;
      this.b = block2;
      this.c = 0;
      this.d = null;
      this.f = TRACKED;
      this.r = null;
      this.__v = v;
    }
    get() {
      return get_tracked(this);
    }
    set(value) {
      set(this, value);
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
  };
  var DerivedValue = class {
    a;
    b;
    blocks;
    c;
    co;
    d;
    f;
    fn;
    r;
    __v;
    constructor(fn, block2, a) {
      this.a = a;
      this.b = block2;
      this.blocks = null;
      this.c = 0;
      this.co = active_component;
      this.d = null;
      this.f = DERIVED;
      this.fn = fn;
      this.r = null;
      this.__v = UNINITIALIZED;
    }
    get() {
      return get_derived(this);
    }
    set(value) {
      set(this, value);
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
  };
  function tracked(v, block2, get2, set2) {
    return new TrackedValue(v, block2 || active_block || get_orphan_root(), get2 || set2 ? { get: get2, set: set2 } : empty_get_set);
  }
  function derived(fn, block2, get2, set2) {
    return new DerivedValue(fn, block2 || active_block || get_orphan_root(), get2 || set2 ? { get: get2, set: set2 } : empty_get_set);
  }
  function track(v, b, get2, set2) {
    if (is_ripple_object(v)) {
      return v;
    }
    let hookGet;
    let hookSet;
    if (typeof b === "function") {
      hookSet = set2 === void 0 ? get2 : set2;
      hookGet = b;
      b = void 0;
    } else {
      hookGet = get2;
      hookSet = set2;
    }
    if (typeof v === "function") {
      return derived(v, b, hookGet, hookSet);
    }
    return tracked(v, b, hookGet, hookSet);
  }
  function create_dependency(tracked2) {
    const reaction = active_reaction;
    if (is_orphan(tracked2.b)) {
      (tracked2.r ??= /* @__PURE__ */ new Set()).add(reaction);
    }
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
  function is_block_dirty(block2) {
    const flags = block2.f;
    if ((flags & (ROOT_BLOCK | BRANCH_BLOCK)) !== 0) {
      return false;
    }
    if ((flags & BLOCK_HAS_RUN) === 0) {
      block2.f ^= BLOCK_HAS_RUN;
      return true;
    }
    return is_tracking_dirty(block2.d);
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
      const block2 = pre_effects[i];
      try {
        if ((block2.f & (PAUSED | DESTROYED)) === 0 && is_block_dirty(block2)) {
          run_block(block2);
        }
      } catch (error) {
        handle_error(error, block2);
      }
    }
    arr_length = other_blocks.length;
    for (let i = 0; i < arr_length; i++) {
      const block2 = other_blocks[i];
      try {
        if ((block2.f & (PAUSED | DESTROYED)) === 0 && is_block_dirty(block2)) {
          run_block(block2);
        }
      } catch (error) {
        handle_error(error, block2);
      }
    }
    arr_length = effects.length;
    for (let i = 0; i < arr_length; i++) {
      const block2 = effects[i];
      try {
        if ((block2.f & (PAUSED | DESTROYED)) === 0 && is_block_dirty(block2)) {
          run_block(block2);
        }
      } catch (error) {
        handle_error(error, block2);
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
      throw new Error(
        "Maximum update depth exceeded. This typically indicates that an effect reads and writes the same piece of state."
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
  function queue_microtask(fn) {
    if (!is_micro_task_queued) {
      is_micro_task_queued = true;
      queueMicrotask(flush_microtasks);
    }
    if (fn !== void 0) {
      queued_microtasks.push(fn);
    }
  }
  function schedule_update(block2) {
    if (block2 === null) return;
    if (block2.p === get_orphan_root() && globalThis.__vsk_ssr) return;
    if (scheduler_mode === FLUSH_MICROTASK) {
      queue_microtask();
    }
    block2.f |= UPDATE_SOURCE;
    let current = block2;
    while (current !== null) {
      const flags = current.f;
      if ((flags & CONTAINS_UPDATE) !== 0) return;
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
  function unsubscribe_reaction(reaction) {
    if (reaction === null) return;
    let dep = reaction.d;
    while (dep !== null) {
      const t = dep.t;
      if (is_orphan(t.b) && t.r !== null) {
        t.r.delete(reaction);
      }
      dep = dep.n;
    }
  }
  function schedule_ownerless_update(tracked2, visited) {
    const subscribers = tracked2.r;
    if (subscribers === null) return;
    for (const reaction of Array.from(subscribers)) {
      if (visited !== null) {
        if (visited.has(reaction)) continue;
        visited.add(reaction);
      }
      if (reaction.f & DESTROYED) {
        subscribers.delete(reaction);
        continue;
      }
      if ((reaction.f & DERIVED) !== 0) {
        schedule_ownerless_update(reaction, visited ?? /* @__PURE__ */ new Set());
        continue;
      }
      schedule_update(reaction);
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
  function set(tracked2, value) {
    if (!is_mutating_allowed) {
      throw new Error(
        'Assignments or updates to tracked values are not allowed during computed "track(() => ...)" evaluation'
      );
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
        value = untrack2(() => setFn(value, old_value));
      }
      tracked2.__v = value;
      tracked2.c = increment_clock();
      if (!is_orphan(tracked_block)) {
        schedule_update(tracked_block);
      } else {
        schedule_ownerless_update(tracked2, null);
      }
    }
  }
  function untrack2(fn) {
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
      return untrack2(() => fn(v));
    } finally {
      is_mutating_allowed = previous_is_mutating_allowed;
    }
  }
  function scope() {
    return active_scope || active_block;
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

  // packages/runtime/src/hydrate.ts
  function runInHydrateBlock(fn) {
    const previous = scope();
    const block2 = root(() => {
    });
    set_active_block(block2);
    try {
      const result = fn();
      set_active_block(previous);
      return result;
    } catch (error) {
      set_active_block(previous);
      throw error;
    }
  }
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
  var __hydrateDevMode = true;
  var claimRegistry = /* @__PURE__ */ new WeakMap();
  var walkerClaimRecords = /* @__PURE__ */ new WeakMap();
  function recordClaim(root2, record) {
    claimRegistry.set(record.el, record);
    if (!root2) return;
    const records = walkerClaimRecords.get(root2);
    if (records) records.push(record);
    else walkerClaimRecords.set(root2, [record]);
  }
  function isAdopted(el) {
    return claimRegistry.get(el)?.state === "adopted";
  }
  var __hydrateStrict = false;
  var __mismatchHandler = null;
  function reportHydrationIssue(issue) {
    if (!__mismatchHandler) return;
    try {
      __mismatchHandler(issue);
    } catch {
    }
  }
  function devWarn(message) {
    if (__hydrateDevMode && typeof console !== "undefined") {
      console.warn("[vesk-hydrate] " + message);
    }
  }
  function reportMiss(kind, detail, loud) {
    if (__mismatchHandler) {
      try {
        __mismatchHandler({ kind, detail });
      } catch {
      }
    }
    if (loud) devWarn(`${kind}: ${detail}`);
  }
  function recordAdopted(root2, el, expectedTag) {
    recordClaim(root2, {
      state: "adopted",
      el,
      owner: root2,
      expectedTag,
      actualTag: el.tagName.toLowerCase(),
      detached: false
    });
  }
  function stripDirectTextNodes(el) {
    let text = "";
    for (let i = el.childNodes.length - 1; i >= 0; i--) {
      const c = el.childNodes[i];
      if (c.nodeType === 3) {
        try {
          text = String(c.textContent ?? "") + text;
        } catch {
        }
        c.remove();
      }
    }
    el.__vsk_ssrText = text;
  }
  function captureSsrElementChildren(el) {
    el.__vsk_ssrEls = Array.prototype.slice.call(el.children);
  }
  function normText(el) {
    try {
      return (el.textContent || "").replace(/\s+/g, " ").trim();
    } catch {
      return "";
    }
  }
  function collectElements(rootEl) {
    const out = [];
    (function walk(n) {
      const kids = n.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.nodeType === 1) {
          out.push(c);
          walk(c);
        }
      }
    })(rootEl);
    return out;
  }
  function scanTwins(container) {
    let count = 0;
    const samples = [];
    for (const el of collectElements(container)) {
      const prev = el.previousElementSibling;
      if (!prev || prev.tagName !== el.tagName) continue;
      const t = normText(el);
      if (!t || t !== normText(prev)) continue;
      let a = false;
      let b = false;
      try {
        a = isAdopted(el);
        b = isAdopted(prev);
      } catch {
        continue;
      }
      if (a !== b) {
        count++;
        if (samples.length < 3) {
          try {
            samples.push(`<${el.tagName.toLowerCase()}> "${t.slice(0, 60)}"`);
          } catch {
          }
        }
      }
    }
    return { count, samples };
  }
  function auditHydration(container) {
    let unclaimed = 0;
    let sample = "";
    const orphans = [];
    const orphanNames = [];
    const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
      acceptNode: (node) => isVskMarkerText(node.textContent) ? _FILTER_ACCEPT : _FILTER_SKIP
    });
    while (walker.nextNode()) {
      const c = walker.currentNode;
      const el = c.nextElementSibling;
      if (el && underClaimedAncestor(el, container)) continue;
      unclaimed++;
      orphans.push(c);
      if (orphanNames.length < 5) {
        const parsed = parseVskMarker(c.textContent);
        const id = parsed && parsed.identity ? `<!--vsk:${parsed.identity}-->` : null;
        let tag = "";
        try {
          tag = el && el.tagName ? `<${el.tagName.toLowerCase()}>` : "(no element)";
        } catch {
          tag = "(unreadable)";
        }
        orphanNames.push(id ? `${id} before ${tag}` : `bare <!--vsk--> before ${tag} (untyped)`);
      }
      if (!sample && container.outerHTML) sample = String(container.outerHTML).slice(0, 800);
    }
    const structuralRecords = [];
    const seenRecords = /* @__PURE__ */ new Set();
    const collectWalkerRecords = (el) => {
      const records = walkerClaimRecords.get(el);
      if (records) {
        for (const record of records) {
          if (!seenRecords.has(record)) {
            seenRecords.add(record);
            structuralRecords.push(record);
          }
        }
      }
      for (let i = 0; i < el.children.length; i++) collectWalkerRecords(el.children[i]);
    };
    collectWalkerRecords(container);
    const structuralGhosts = structuralRecords.filter((record) => record.state === "ghost");
    if (structuralGhosts.length > 0) {
      unclaimed += structuralGhosts.length;
      if (orphanNames.length < 5) {
        orphanNames.push(
          `${structuralGhosts.length} structural hydration ghost(s) (${structuralGhosts.slice(0, 3).map((record) => `<${record.actualTag}> expected <${record.expectedTag}>`).join(", ")})`
        );
      }
    }
    const twinRes = scanTwins(container);
    const issues = [];
    if (unclaimed > 0) {
      issues.push({
        kind: "leftover-marker",
        detail: `${unclaimed} hydration marker${unclaimed === 1 ? "" : "s"} never claimed; SSR and client markup diverge. Orphans: ${orphanNames.join(", ")}.`
      });
    }
    for (const s of twinRes.samples) {
      issues.push({ kind: "twin", detail: `possible hydration twin: ${s}` });
    }
    if (twinRes.count > twinRes.samples.length) {
      issues.push({
        kind: "twin",
        detail: `${twinRes.count - twinRes.samples.length} further possible twin(s) (samples capped)`
      });
    }
    if (__hydrateStrict) {
      for (const c of orphans) {
        try {
          const el = c.nextElementSibling;
          if (el && underClaimedAncestor(el, container)) continue;
          if (el) el.remove();
          c.remove();
        } catch {
        }
      }
      for (const record of structuralGhosts) {
        try {
          if (record.detached || !record.owner || record.el.parentNode !== record.owner) continue;
          record.el.remove();
          record.detached = true;
        } catch {
        }
      }
    }
    if (__mismatchHandler) {
      for (const issue of issues) {
        try {
          __mismatchHandler(issue);
        } catch {
        }
      }
    }
    return {
      ok: unclaimed === 0 && twinRes.count === 0,
      unclaimed,
      twins: twinRes.count,
      issues,
      sample
    };
  }
  function assertFullyHydrated(container) {
    const report = auditHydration(container);
    if (!report.ok) {
      devWarn(
        `${report.unclaimed} hydration marker${report.unclaimed === 1 ? "" : "s"} never claimed; SSR and client markup diverge.` + (report.twins > 0 ? ` ${report.twins} possible twin(s) detected.` : "") + ` Container fragment:
${report.sample}`
      );
      return false;
    }
    return true;
  }
  function underClaimedAncestor(el, container) {
    for (let n = el; n && n !== container; n = n.parentElement) {
      if (n.nodeType === 1 && isAdopted(n)) return true;
    }
    return false;
  }
  function markerIdentity(comment) {
    try {
      const parsed = parseVskMarker(comment.textContent);
      return parsed ? parsed.identity : null;
    } catch {
      return null;
    }
  }
  function describeMarker(tm) {
    return tm.identity ? `<!--vsk:${tm.identity}-->` : "<!--vsk-->";
  }
  var _SHOW_COMMENT = 128;
  var _FILTER_ACCEPT = 1;
  var _FILTER_SKIP = 2;
  function isVskMarkerText(text) {
    if (text === "vsk") return true;
    if (typeof text !== "string" || text.length < 4) return false;
    return text.charAt(0) === "v" && text.charAt(1) === "s" && text.charAt(2) === "k" && text.charAt(3) === ":";
  }
  function parseVskMarker(text) {
    if (text === "vsk") return { identity: null };
    if (!isVskMarkerText(text)) return null;
    const rest = text.slice(4);
    return { identity: rest === "" ? null : rest };
  }
  function collectVskMarkers(container) {
    const markers = [];
    const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
      acceptNode: (node) => isVskMarkerText(node.textContent) ? _FILTER_ACCEPT : _FILTER_SKIP
    });
    while (walker.nextNode()) markers.push(walker.currentNode);
    return markers;
  }
  function checkMarkerIdentity(marker, el) {
    let identity = null;
    try {
      const parsed = parseVskMarker(marker.textContent);
      identity = parsed ? parsed.identity : null;
    } catch {
      identity = null;
    }
    if (identity === null) {
      reportMiss(
        "untyped-marker",
        `adopted a bare <!--vsk--> marker before <${el.tagName.toLowerCase()}>; all emission sites must type their markers.`,
        __hydrateDevMode
      );
      return;
    }
    if (identity.charAt(0) === "t" && identity.charAt(1) === ":") {
      const expected = identity.slice(2).toLowerCase();
      if (expected !== "" && expected !== el.tagName.toLowerCase()) {
        reportMiss(
          "marker-skew",
          `marker <!--vsk:${identity}--> precedes <${el.tagName.toLowerCase()}> \u2014 SSR/HTML-parser skew; adopting the live element.`,
          __hydrateDevMode
        );
      }
    }
  }
  function adoptElement(root2, marker, tag) {
    const el = marker.nextElementSibling;
    if (!el) {
      marker.remove();
      return null;
    }
    if (tag && el.tagName.toLowerCase() !== tag) return null;
    checkMarkerIdentity(marker, el);
    marker.remove();
    stripDirectTextNodes(el);
    captureSsrElementChildren(el);
    recordAdopted(root2, el, tag || el.tagName.toLowerCase());
    return el;
  }
  function adoptElementRaw(root2, marker, tag) {
    const el = marker.nextElementSibling;
    if (!el) {
      marker.remove();
      return null;
    }
    if (tag && el.tagName.toLowerCase() !== tag) return null;
    checkMarkerIdentity(marker, el);
    marker.remove();
    captureSsrElementChildren(el);
    recordAdopted(root2, el, tag || el.tagName.toLowerCase());
    return el;
  }
  var WalkerEngine = class _WalkerEngine {
    root;
    markers;
    idx = 0;
    // Elements already adopted by an earlier claim in this walk. Marker-only SSR
    // can leave TWO keyed marks on the same element (the call-site marker and
    // the callee's own root marker — e.g. Link self-prefixes `<!--vsk:c:Link-->`
    // and the shared walker claims its call-site marker), and a claim must never
    // adopt the same node twice: double-adoption strips its SSR text a second
    // time and shells the cursor so every later claim misses its element.
    adopted = /* @__PURE__ */ new WeakSet();
    constructor(root2, markers) {
      this.root = root2;
      this.markers = markers.map((c) => ({ comment: c, state: "unclaimed", identity: markerIdentity(c) }));
    }
    done() {
      return this.idx >= this.markers.length;
    }
    // A marker whose `nextElementSibling` was already adopted is a dead alias of
    // a live claim point (double-marker collision). Retire it and move on so the
    // cursor never claims a node twice.
    isAlreadyAdopted(tm, el) {
      if (el !== null && this.adopted.has(el)) {
        tm.state = "claimed";
        this.idx++;
        tm.comment.remove();
        return true;
      }
      return false;
    }
    recordAdopted(el) {
      this.adopted.add(el);
    }
    // Marker-only SSR can stack several keyed marks before ONE element
    // (call-site marker + the callee's own root marker). The FIRST claim adopts
    // the element; the alias markers that immediately follow it are dead — they
    // point at an already-claimed node and must be physically retired so the
    // canary never counts them and a trailing alias never lingers in the DOM.
    retireAliases(el) {
      let i = this.idx;
      while (i < this.markers.length) {
        const tm = this.markers[i];
        if (tm.state === "claimed") {
          i++;
          continue;
        }
        if (tm.comment.nextElementSibling === el) {
          tm.state = "claimed";
          tm.comment.remove();
          i++;
          continue;
        }
        break;
      }
    }
    nextElement(tag) {
      while (this.idx < this.markers.length) {
        const tm = this.markers[this.idx];
        if (tm.state === "claimed") {
          this.idx++;
          continue;
        }
        const el = tm.comment.nextElementSibling;
        if (this.isAlreadyAdopted(tm, el)) continue;
        if (el === null && tm.identity !== null && tm.identity.charAt(0) === "c") {
          tm.state = "claimed";
          tm.comment.remove();
          this.idx++;
          continue;
        }
        if (tag && el && el.tagName.toLowerCase() !== tag) {
          reportMiss(
            "tag-mismatch",
            `claim wanted <${tag}> but the cursor holds ${describeMarker(tm)} before <${el.tagName.toLowerCase()}>; backing off for its real owner.`,
            false
          );
          break;
        }
        this.idx++;
        const adopted = adoptElement(this.root, tm.comment, tag);
        if (adopted === null) {
          tm.state = "claimed";
          break;
        }
        this.recordAdopted(adopted);
        this.retireAliases(adopted);
        this.retireAliasesOf(adopted);
        tm.state = "claimed";
        return adopted;
      }
      const hasUnconsumed = this.root !== null && this.idx < this.markers.length;
      let skipped = "";
      if (hasUnconsumed) {
        for (let s = this.idx; s < this.markers.length; s++) {
          if (this.markers[s].state === "claimed") continue;
          skipped = ` skipped ${describeMarker(this.markers[s])}`;
          break;
        }
      }
      reportMiss(
        hasUnconsumed ? "tag-mismatch" : "exhausted",
        `hydration claim missed <${tag || "element"}> (${this.markers.length - this.idx} markers unconsumed${skipped}); the client rendered more or different content than SSR.` + (this.root && this.root.outerHTML ? ` Fragment:
${String(this.root.outerHTML).slice(0, 800)}` : ""),
        hasUnconsumed && __hydrateDevMode
      );
      return document.createElement(tag || "div");
    }
    claimOnly(tag) {
      while (this.idx < this.markers.length) {
        const tm = this.markers[this.idx];
        if (tm.state === "claimed") {
          this.idx++;
          continue;
        }
        const el = tm.comment.nextElementSibling;
        if (this.isAlreadyAdopted(tm, el)) continue;
        if (el === null && tm.identity !== null && tm.identity.charAt(0) === "c") {
          tm.state = "claimed";
          tm.comment.remove();
          this.idx++;
          continue;
        }
        if (tag && el && el.tagName.toLowerCase() !== tag) {
          reportMiss(
            "tag-mismatch",
            `static claim wanted <${tag}> but the cursor holds ${describeMarker(tm)} before <${el.tagName.toLowerCase()}>; backing off for its real owner.`,
            false
          );
          break;
        }
        this.idx++;
        const adopted = adoptElementRaw(this.root, tm.comment, tag);
        if (adopted === null) {
          tm.state = "claimed";
          break;
        }
        this.recordAdopted(adopted);
        this.retireAliases(adopted);
        this.retireAliasesOf(adopted);
        tm.state = "claimed";
        return adopted;
      }
      const hasUnconsumed = this.root !== null && this.idx < this.markers.length;
      reportMiss(
        hasUnconsumed ? "tag-mismatch" : "exhausted",
        `hydration static claim missed <${tag || "element"}> (${this.markers.length - this.idx} markers unconsumed); the client rendered more or different content than SSR.`,
        hasUnconsumed && __hydrateDevMode
      );
      return document.createElement(tag || "div");
    }
    retireDetached() {
      while (this.idx < this.markers.length) {
        const tm = this.markers[this.idx];
        if (tm.state === "claimed") {
          this.idx++;
          continue;
        }
        const c = tm.comment;
        if (!c || !c.parentNode) {
          tm.state = "claimed";
          this.idx++;
          continue;
        }
        break;
      }
    }
    subWalker(rootEl) {
      const owned = [];
      const kept = [];
      for (const m of this.markers) {
        let mine = false;
        if (m.state !== "claimed") {
          if (rootEl === m.comment) mine = true;
          else if (rootEl && m.comment && typeof rootEl.contains === "function") mine = rootEl.contains(m.comment);
        }
        if (mine) {
          m.state = "claimed";
          owned.push(m);
        } else {
          kept.push(m);
        }
      }
      this.markers = kept;
      if (this.idx > this.markers.length) this.idx = this.markers.length;
      return new _WalkerEngine(rootEl, owned.map((m) => m.comment));
    }
    // Ownership transfer for an explicit marker subset (layout slot contract).
    // The listed markers are marked claimed here without advancing the cursor:
    // positional claims skip them, and a scoped walker built over the same
    // comments owns them exclusively. Exactly one engine owns each marker.
    takeMarkers(comments) {
      let owned;
      try {
        owned = new Set(comments);
      } catch {
        return;
      }
      if (owned.size === 0) return;
      for (const tm of this.markers) {
        if (tm.state !== "claimed" && owned.has(tm.comment)) tm.state = "claimed";
      }
    }
    // Retire every unclaimed marker in the whole walk that points at `el`.
    // Used after a cross-position adopt (relocate): the adopted node moves to
    // the cursor, so alias markers stacked at its old station would otherwise
    // dangle — pointing at its successor and misaligning later claims.
    retireAliasesOf(el) {
      for (const tm of this.markers) {
        if (tm.state !== "claimed" && tm.comment.nextElementSibling === el) {
          tm.state = "claimed";
          tm.comment.remove();
        }
      }
    }
    adoptKeyedElement(tm, el) {
      tm.state = "claimed";
      this.recordAdopted(el);
      checkMarkerIdentity(tm.comment, el);
      tm.comment.remove();
      stripDirectTextNodes(el);
      captureSsrElementChildren(el);
      recordAdopted(this.root, el, el.tagName.toLowerCase());
      return { el };
    }
    claimByKey(key, options) {
      const strKey = String(key);
      for (let i = this.idx; i < this.markers.length; i++) {
        const tm = this.markers[i];
        if (tm.state === "claimed") continue;
        const el = tm.comment.nextElementSibling;
        if (this.isAlreadyAdopted(tm, el)) continue;
        if (el && el.getAttribute("data-vsk-key") === strKey) {
          const claim = this.adoptKeyedElement(tm, el);
          this.retireAliases(el);
          return claim;
        }
        if (options && options.relocate) {
          const moved = this.relocateByKey(strKey, tm);
          if (moved) return moved;
        }
        if (this.peekKey(strKey) !== null) {
          reportMiss(
            "key-reorder",
            `keyed item "${strKey}" is not at the cursor; SSR order and client order diverge \u2014 item renders fresh, SSR twin orphaned.`,
            __hydrateDevMode
          );
        }
        return null;
      }
      return null;
    }
    // A4 adopt+move: find `key` anywhere later in the walk, adopt it in place,
    // then move it to the cursor (`anchor`, the mismatching marker) so region
    // order converges to client order with node identity preserved. The cursor
    // itself does not advance — skipped markers still belong to their owners.
    // Returns null when the key has no live SSR node (genuinely new item).
    relocateByKey(strKey, anchor) {
      for (let j = this.idx; j < this.markers.length; j++) {
        const tm = this.markers[j];
        if (tm.state === "claimed") continue;
        const el = tm.comment.nextElementSibling;
        if (!el || this.adopted.has(el)) continue;
        if (el.getAttribute("data-vsk-key") !== strKey) continue;
        const parent = el.parentNode;
        const anchorParent = anchor.comment.parentNode;
        if (!parent || parent !== anchorParent) continue;
        const claim = this.adoptKeyedElement(tm, el);
        this.retireAliasesOf(el);
        try {
          parent.insertBefore(el, anchor.comment);
        } catch {
        }
        reportMiss(
          "key-reorder",
          `keyed item "${strKey}" adopted out of position and moved into place; SSR order and client order diverged.`,
          false
        );
        return claim;
      }
      return null;
    }
    peekKey(key) {
      const strKey = String(key);
      for (let i = this.idx; i < this.markers.length; i++) {
        const tm = this.markers[i];
        if (tm.state === "claimed") continue;
        const el = tm.comment.nextElementSibling;
        if (el && this.adopted.has(el)) continue;
        if (el && el.getAttribute("data-vsk-key") === strKey) return el;
      }
      return null;
    }
    insertBeforeNextClaim(node, _offset = 0) {
      let i = this.idx;
      while (i < this.markers.length && this.markers[i].state === "claimed") i++;
      const next = i < this.markers.length ? this.markers[i] : null;
      const host = next && next.comment.parentNode ? next.comment.parentNode : this.root;
      if (host === null || host === void 0) return false;
      try {
        host.insertBefore(node, next ? next.comment : null);
        return true;
      } catch {
        return false;
      }
    }
    injectSkipK(_n) {
    }
    takeSkipK() {
      return 0;
    }
  };
  var StructuralWalker = class _StructuralWalker {
    root;
    // Snapshot taken at construction, so fresh nodes mounted during the render
    // are never re-claimed and claims stay aligned to the SSR source list.
    els;
    idx = 0;
    adopted = /* @__PURE__ */ new WeakSet();
    constructor(root2, els) {
      this.root = root2;
      this.els = els || (root2 ? Array.prototype.slice.call(root2.children) : []);
    }
    /**
     * Non-claimable framework preamble elements that the SSR renderer may emit
     * as real DOM nodes ahead of a component's first claimable element (scoped
     * `<style>` blocks, the loader title). The marker stream tracked them
     * implicitly; the structural walker must step PAST them without consuming a
     * claim slot, otherwise every subsequent positional claim shifts by one and
     * the whole subtree falls back to fresh-node building.
     */
    static skipTags = /* @__PURE__ */ new Set(["style", "script", "template", "title", "meta", "link", "base"]);
    static isSkippable(el) {
      return _StructuralWalker.skipTags.has(el.tagName.toLowerCase());
    }
    advancePastSkippable(index) {
      while (index < this.els.length && _StructuralWalker.isSkippable(this.els[index])) index++;
      return index;
    }
    done() {
      return this.idx >= this.els.length;
    }
    remainingCount() {
      return this.els.length - this.idx;
    }
    /**
     * Insert `node` immediately before the `offset`-th unconsumed SSR element
     * after the `skipK` cursor slot. Falls back to appending at the end of the
     * root. Used by root-level dynamic regions whose branch had no SSR content:
     * the fence anchors at the region's source position instead of the root's
     * end. `offset` carries the region's first-claim budget (SSR slots past the
     * cursor): a region that follows static residue must anchor after those
     * residue slots, at exactly where its own first claim will land — otherwise
     * fences wrap the WRONG slot and `__place` relocates the claimed content
     * (e.g. a try/catch whose preceding h2/p/style residue pushes its slot to
     * `idx + 3`).
     */
    insertBeforeCursor(node, offset = 0) {
      const host = this.root;
      if (host === null || host === void 0) return false;
      try {
        let n = this.advancePastSkippable(this.idx + (offset || 0));
        while (n < this.els.length && this.els[n].parentNode !== host) n++;
        if (n < this.els.length) host.insertBefore(node, this.els[n]);
        else host.appendChild(node);
        return true;
      } catch {
        return false;
      }
    }
    // Markerless value-thread offset (Phase 3.c): a transient residue deposit for
    // a compiled component's first top-level claim. `injectSkipK` is emitted by
    // the CALLER before invoking a self-claiming child (which cannot see the
    // caller's compile-time skipK); `takeSkipK` is read exactly once at the
    // callee's first claim and resets the deposit so later claims stay
    // positional against the advancing cursor. Consumed synchronously on the
    // same walker reference the call was made through.
    //
    // The deposit is ALSO consumed implicitly by the next claim made through this
    // walker when the caller passed no explicit skipK. A component written in plain
    // JS (lucide-vesk icons are the common case) never calls `takeSkipK`, so
    // before this the deposit was silently dropped: the icon's `nextElement("svg")`
    // claimed the slot still holding the STATIC residue in front of it
    // (`<button><span>Apply Now</span><svg/></button>`), the descriptor missed on
    // `<span>`, and the walker detached server-rendered content that no client
    // program had any intention of replacing. Implicit consumption keeps static
    // residue out of the way for plain-JS components exactly as it is for
    // compiled ones.
    inheritOffset = 0;
    injectSkipK(n) {
      this.inheritOffset = n;
    }
    takeSkipK() {
      const n = this.inheritOffset;
      this.inheritOffset = 0;
      return n;
    }
    claimAt(tag, skipK, raw) {
      if (globalThis.__vesk_hydrate_debug) {
        console.error("[hyd-dbg] claimAt", tag, "skip=", skipK, "idx=", this.idx, "els=", this.els.length);
      }
      let offset = skipK || 0;
      const inherited = this.inheritOffset;
      this.inheritOffset = 0;
      if (!offset) offset = inherited;
      let target = this.advancePastSkippable(this.idx + offset);
      if (target > this.els.length) target = this.idx;
      while (target < this.els.length) {
        const el = this.els[target];
        if (tag && el.tagName.toLowerCase() !== tag) {
          this.idx = this.advancePastSkippable(target + 1);
          const ghost = {
            state: "ghost",
            el,
            owner: this.root,
            expectedTag: tag || "div",
            actualTag: el.tagName.toLowerCase(),
            detached: false
          };
          recordClaim(this.root, ghost);
          if (this.root && el.parentNode === this.root) {
            try {
              el.remove();
              ghost.detached = true;
            } catch {
            }
          }
          const fresh2 = document.createElement(tag || "div");
          recordClaim(this.root, {
            state: "fresh",
            el: fresh2,
            owner: this.root,
            expectedTag: tag || "div",
            actualTag: fresh2.tagName.toLowerCase(),
            detached: false
          });
          reportMiss(
            "tag-mismatch",
            `descriptor wanted <${tag}> but the SSR slot holds <${el.tagName.toLowerCase()}>; consumed one slot, detached the local ghost, and rendered fresh.`,
            false
          );
          return fresh2;
        }
        if (this.adopted.has(el)) {
          target = this.advancePastSkippable(target + 1);
          continue;
        }
        this.idx = this.advancePastSkippable(target + 1);
        this.adopted.add(el);
        if (!raw) stripDirectTextNodes(el);
        captureSsrElementChildren(el);
        recordAdopted(this.root, el, tag || el.tagName.toLowerCase());
        return el;
      }
      this.idx = this.els.length;
      const fresh = document.createElement(tag || "div");
      recordClaim(this.root, {
        state: "fresh",
        el: fresh,
        owner: this.root,
        expectedTag: tag || "div",
        actualTag: fresh.tagName.toLowerCase(),
        detached: false
      });
      reportMiss(
        "exhausted",
        `hydration claim missed <${tag || "element"}>; the client rendered more or different content than SSR.`,
        // Not loud: an exhausted walker is the normal post-hydration
        // re-render shape (every further claim legitimately builds fresh
        // nodes) — telemetry-only, mirroring the marker engine.
        false
      );
      return fresh;
    }
    nextElement(tag, skipK = 0) {
      return this.claimAt(tag, skipK, false);
    }
    claimOnly(tag, skipK = 0) {
      return this.claimAt(tag, skipK, true);
    }
    subWalker(rootEl) {
      if (globalThis.__vesk_hydrate_debug) {
        console.error("[hyd-dbg] subWalker over <" + (rootEl && rootEl.tagName) + "> kids=" + (rootEl ? rootEl.children.length : -1));
      }
      return new _StructuralWalker(rootEl);
    }
    /**
     * Markerless region scope (Phase 3.e): keyed lists claim their items from a
     * walker over their OWN container, not the top-level walker — the top
     * walker's positional cursor would otherwise adopt the region container's
     * siblings. The scoped walker snapshots the region's children and SHARES
     * the adoption ledger, so sibling regions in the same container never
     * double-claim (skip `adopted`) and top-level claims never re-adopt a node
     * the region already claimed.
     */
    scopeToRegion(rootEl) {
      const w = new _StructuralWalker(rootEl);
      w.adopted = this.adopted;
      return w;
    }
    retireDetached() {
    }
    takeMarkers(_comments) {
    }
    claimByKey(_key, _options) {
      const k = _options && _options.skipK || 0;
      if (globalThis.__vesk_hydrate_debug) {
        console.error("[hyd-dbg] claimByKey key=", _key, "idx=", this.idx, "els=", this.els.length, "root=<", this.root ? this.root.tagName : "-", ">");
      }
      let target = this.advancePastSkippable(this.idx + k);
      if (target > this.els.length) target = this.idx;
      while (target < this.els.length) {
        const el = this.els[target];
        if (this.adopted.has(el)) {
          target = this.advancePastSkippable(target + 1);
          continue;
        }
        this.idx = this.advancePastSkippable(target + 1);
        this.adopted.add(el);
        stripDirectTextNodes(el);
        captureSsrElementChildren(el);
        recordAdopted(this.root, el, el.tagName.toLowerCase());
        return { el };
      }
      this.idx = this.els.length;
      return null;
    }
    peekKey(_key) {
      return null;
    }
    insertBeforeNextClaim(node, offset = 0) {
      return this.insertBeforeCursor(node, offset);
    }
  };
  function createHydrateWalker(container, markerList) {
    const markers = markerList || (container ? collectVskMarkers(container) : []);
    if (!markerList && container && markers.length === 0 && container.children.length > 0) {
      return new StructuralWalker(container);
    }
    return new WalkerEngine(container, markers);
  }
  function hydrate(container, componentFn, props) {
    const walker = createHydrateWalker(container);
    const result = runInHydrateBlock(() => componentFn(props || {}, /* @__PURE__ */ new Map(), walker));
    assertFullyHydrated(container);
    return result;
  }
  function bumpNavEpoch() {
    try {
      const g2 = globalThis;
      const next = (g2.__vesk_nav_epoch || 0) + 1;
      g2.__vesk_nav_epoch = next;
      return next;
    } catch {
      return 0;
    }
  }
  function navEpoch() {
    try {
      return globalThis.__vesk_nav_epoch || 0;
    } catch {
      return 0;
    }
  }
  function batchAlive(container, epoch, isCurrent) {
    try {
      if (!container.isConnected) return false;
    } catch {
      return false;
    }
    if (isCurrent) {
      try {
        return isCurrent() !== false;
      } catch {
        return false;
      }
    }
    return navEpoch() === epoch;
  }
  function hydrateViewport(container, componentFn, props, rootMargin = 500, options = {}) {
    const epoch = navEpoch();
    const isCurrent = options.isCurrent;
    let cancelled = false;
    let cancelFn = () => {
    };
    const promise = new Promise((resolve) => {
      const finish = () => {
        cancelled = true;
        cancelFn = () => {
        };
        resolve();
      };
      cancelFn = finish;
      if (!batchAlive(container, epoch, isCurrent)) return finish();
      start();
      function start() {
        if (cancelled) return finish();
        if (document.readyState !== "complete") {
          const onLoad = () => {
            window.removeEventListener("load", onLoad);
            if (cancelled || !batchAlive(container, epoch, isCurrent)) return finish();
            begin();
          };
          window.addEventListener("load", onLoad);
          return;
        }
        begin();
      }
      function begin() {
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
        const held = new Set(deferredMarkers);
        const viewportWalker = createHydrateWalker(container, viewportMarkers);
        runInHydrateBlock(() => componentFn(props || {}, /* @__PURE__ */ new Map(), viewportWalker));
        if (deferredMarkers.length === 0) {
          assertFullyHydrated(container);
          return finish();
        }
        const observer = new IntersectionObserver((entries) => {
          if (!batchAlive(container, epoch, isCurrent)) {
            observer.disconnect();
            return finish();
          }
          const toHydrate = [];
          for (const entry of entries) {
            if (entry.isIntersecting) {
              const el = entry.target;
              const siblings = el.parentNode ? Array.from(el.parentNode.childNodes) : [];
              const heldMarker = siblings.find(
                (n) => n.nodeType === 8 && held.has(n) && n.nextElementSibling === el
              );
              if (heldMarker) {
                held.delete(heldMarker);
                toHydrate.push(heldMarker);
              }
              observer.unobserve(el);
            }
          }
          if (toHydrate.length > 0) {
            if (!batchAlive(container, epoch, isCurrent)) {
              observer.disconnect();
              return finish();
            }
            const w = createHydrateWalker(container, toHydrate);
            runInHydrateBlock(() => componentFn(props || {}, /* @__PURE__ */ new Map(), w));
          }
          if (held.size === 0) {
            observer.disconnect();
            assertFullyHydrated(container);
            return finish();
          }
        }, { rootMargin: `${rootMargin}px` });
        cancelFn = () => {
          try {
            observer.disconnect();
          } catch {
          }
          finish();
        };
        for (const marker of deferredMarkers) {
          const el = marker.nextElementSibling;
          if (el) observer.observe(el);
        }
      }
    });
    return Object.assign(promise, { cancel: () => cancelFn() });
  }
  function hydrateIdle(container, componentFn, props, options = {}) {
    const epoch = navEpoch();
    const isCurrent = options.isCurrent;
    const timeout = options.timeout || 3e3;
    const rIC = window.requestIdleCallback || ((cb) => setTimeout(cb, 50));
    const cIC = window.cancelIdleCallback || clearTimeout;
    let rafId2 = null;
    let cancelled = false;
    let ran = false;
    function runOnce() {
      if (cancelled || ran) return;
      ran = true;
      if (!batchAlive(container, epoch, isCurrent)) return;
      const walker = createHydrateWalker(container);
      runInHydrateBlock(() => componentFn(props || {}, /* @__PURE__ */ new Map(), walker));
      assertFullyHydrated(container);
    }
    rafId2 = rIC(runOnce, { timeout });
    return {
      cancel() {
        cancelled = true;
        if (rafId2 !== null) {
          cIC(rafId2);
          rafId2 = null;
        }
      }
    };
  }
  function needsHydration(container) {
    const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
      acceptNode: (node) => isVskMarkerText(node.textContent) ? _FILTER_ACCEPT : _FILTER_SKIP
    });
    return walker.nextNode() !== null;
  }
  function hydrateOnInteraction(container, componentFn, props, options = {}) {
    const epoch = navEpoch();
    const isCurrent = options.isCurrent;
    const events = options.events || ["click", "touchstart", "focus", "mouseenter"];
    let hydrated = false;
    function trigger(_eventType) {
      if (hydrated) return;
      hydrated = true;
      for (const ev of events) {
        container.removeEventListener(ev, handler);
      }
      if (!batchAlive(container, epoch, isCurrent)) return;
      const markers = collectVskMarkers(container);
      if (markers.length > 0) {
        const walker = createHydrateWalker(container, markers);
        runInHydrateBlock(() => componentFn(props || {}, /* @__PURE__ */ new Map(), walker));
      }
      assertFullyHydrated(container);
    }
    const handler = (e) => trigger(e.type);
    for (const ev of events) {
      container.addEventListener(ev, handler, { once: true });
    }
    return {
      cancel() {
        hydrated = true;
        for (const ev of events) container.removeEventListener(ev, handler);
      },
      hydrateNow() {
        trigger("manual");
      }
    };
  }

  // packages/runtime/src/layout.ts
  var LAYOUT_SLOT_OPEN = "vsk-slot";
  var LAYOUT_SLOT_CLOSE = "vsk-slot-end";
  function slotIdentity(text, prefix) {
    if (text === prefix) return { id: "" };
    if (typeof text !== "string") return null;
    const want = prefix + ":";
    if (text.length > want.length && text.startsWith(want)) return { id: text.slice(want.length) };
    return null;
  }
  function slotOpenId(text) {
    return slotIdentity(text, LAYOUT_SLOT_OPEN);
  }
  function slotCloseId(text) {
    return slotIdentity(text, LAYOUT_SLOT_CLOSE);
  }
  function slotUsed(node) {
    try {
      return node.__vsk_slot_used === true;
    } catch {
      return false;
    }
  }
  function markSlotUsed(node) {
    try {
      node.__vsk_slot_used = true;
    } catch {
    }
  }
  function findSlotRange(parentEl) {
    let open = null;
    let openId = null;
    let close = null;
    try {
      const walker = document.createTreeWalker(parentEl, 128, {
        acceptNode: (node2) => {
          const t = node2.textContent;
          if (slotOpenId(t) !== null || slotCloseId(t) !== null) return 1;
          return 2;
        }
      });
      let nest = 0;
      while (walker.nextNode()) {
        const c = walker.currentNode;
        const t = c.textContent;
        if (open === null) {
          const id = slotOpenId(t);
          if (id !== null && !slotUsed(c)) {
            open = c;
            openId = id;
          }
        } else {
          if (slotOpenId(t) !== null && !slotUsed(c)) {
            nest++;
            continue;
          }
          const id = slotCloseId(t);
          if (id === null || slotUsed(c)) continue;
          if (id.id === openId.id && nest === 0) {
            try {
              if (!parentEl.contains?.(c)) continue;
            } catch {
            }
            close = c;
            break;
          }
          if (nest > 0) nest--;
        }
      }
    } catch {
      return null;
    }
    if (!open || !close) return null;
    const markers = [];
    const all = [];
    let depth = 0;
    let node = null;
    try {
      node = open.nextSibling;
    } catch {
      return null;
    }
    let guard = 0;
    while (node !== null && node !== close && guard++ < 1e5) {
      let next = null;
      let descend = null;
      try {
        const n = node;
        next = n.nextSibling;
        descend = n.firstChild;
        if (n.nodeType === 8) {
          if (slotOpenId(n.textContent) !== null) {
            depth++;
          } else if (slotCloseId(n.textContent) !== null) {
            if (depth === 0) break;
            depth--;
          } else if (isVskMarkerText(n.textContent)) {
            all.push(n);
            if (depth === 0) markers.push(n);
          }
        }
      } catch {
        return null;
      }
      if (descend !== null && descend !== void 0) {
        node = descend;
      } else {
        let cur = node;
        let nxt = next;
        while (nxt === null || nxt === void 0) {
          let parent = null;
          try {
            parent = cur.parentNode;
          } catch {
            return null;
          }
          if (parent === null || parent === void 0 || parent === parentEl) break;
          if (parent === close) {
            nxt = null;
            cur = null;
            break;
          }
          try {
            nxt = parent.nextSibling;
          } catch {
            return null;
          }
          cur = parent;
        }
        if (cur === null) break;
        node = nxt;
      }
    }
    if (node !== close) return null;
    markSlotUsed(open);
    markSlotUsed(close);
    return { markers, all, end: close };
  }
  function insertDetachedSlotContent(value, anchor) {
    let parent = null;
    try {
      parent = anchor.parentNode;
      if (!parent) return;
    } catch {
      return;
    }
    const nodes = [];
    if (value && typeof value === "object") {
      const v = value;
      if (v.nodeType === 11 || v.nodeType === 1) nodes.push(v);
      else if (typeof v.length === "number") {
        for (let i = 0; i < v.length; i++) {
          const n = v[i];
          if (n && (n.nodeType === 11 || n.nodeType === 1)) nodes.push(n);
        }
      } else return;
    } else return;
    for (const n of nodes) {
      if (n === anchor) continue;
      let attached = null;
      try {
        attached = n.parentNode;
      } catch {
        continue;
      }
      if (attached !== null && attached !== void 0) continue;
      try {
        parent.insertBefore(n, anchor);
      } catch {
      }
    }
  }
  function trackSlotContent(promise, anchor) {
    if (!promise || typeof promise.then !== "function" || !anchor) return promise;
    return promise.then(
      (value) => {
        let live = false;
        try {
          live = !!anchor.parentNode && anchor.isConnected !== false;
        } catch {
          live = false;
        }
        if (live) insertDetachedSlotContent(value, anchor);
        else {
          reportHydrationIssue({
            kind: "leftover-marker",
            detail: "async layout slot resolved after its SSR boundary detached (navigation replaced the DOM); late slot content dropped instead of duplicated."
          });
        }
        return value;
      },
      (error) => {
        throw error;
      }
    );
  }
  function createLayoutSlot(walker, parentEl) {
    const fallback = {
      walker,
      scoped: false,
      track: (promise) => trackSlotContent(promise, null)
    };
    if (!walker || !parentEl) return fallback;
    let range = null;
    try {
      range = findSlotRange(parentEl);
    } catch {
      return fallback;
    }
    if (!range) {
      reportHydrationIssue({
        kind: "untyped-marker",
        detail: "layout slot has no SSR slot boundaries (legacy output or unbalanced markers); hydrating the page on the shared walker \u2014 ordering is best-effort."
      });
      return fallback;
    }
    if (typeof walker.takeMarkers !== "function") {
      reportHydrationIssue({
        kind: "untyped-marker",
        detail: "layout slot walker cannot transfer markers; hydrating the page on the shared walker \u2014 ordering is best-effort."
      });
      return { walker, scoped: false, track: (promise) => trackSlotContent(promise, range.end) };
    }
    try {
      walker.takeMarkers(range.all);
    } catch {
      return fallback;
    }
    let slotWalker;
    try {
      slotWalker = createHydrateWalker(parentEl, range.markers);
    } catch {
      return fallback;
    }
    const end = range.end;
    return {
      walker: slotWalker,
      scoped: true,
      track: (promise) => trackSlotContent(promise, end)
    };
  }
  var _SHOW_COMMENT2 = 128;
  var _FILTER_ACCEPT2 = 1;
  var _FILTER_SKIP2 = 2;
  function auditLayoutSlots(container) {
    let unbalanced = 0;
    let leftoverInSlot = 0;
    try {
      const walker = document.createTreeWalker(container, _SHOW_COMMENT2, {
        acceptNode: (node) => {
          const t = node.textContent;
          if (slotOpenId(t) !== null || slotCloseId(t) !== null || isVskMarkerText(t)) return _FILTER_ACCEPT2;
          return _FILTER_SKIP2;
        }
      });
      const stack = [];
      while (walker.nextNode()) {
        const c = walker.currentNode;
        const t = c.textContent;
        const open = slotOpenId(t);
        if (open !== null) {
          stack.push(open.id);
          continue;
        }
        const close = slotCloseId(t);
        if (close !== null) {
          if (stack.length === 0) {
            unbalanced++;
            reportHydrationIssue({
              kind: "marker-skew",
              detail: "layout slot close without a matching open \u2014 SSR/client slot structure diverges; slot content may misorder."
            });
            continue;
          }
          const top = stack.pop();
          if (top !== "" && close.id !== "" && top !== close.id) {
            unbalanced++;
            reportHydrationIssue({
              kind: "marker-skew",
              detail: `layout slot id mismatch: open "${top}" closed by "${close.id}" \u2014 SSR/client slot structure diverges; slot content may misorder.`
            });
          }
          continue;
        }
        if (stack.length > 0 && isVskMarkerText(t)) leftoverInSlot++;
      }
      if (stack.length > 0) {
        unbalanced++;
        reportHydrationIssue({
          kind: "marker-skew",
          detail: "layout slot open without a matching close \u2014 SSR/client slot structure diverges; slot content may misorder."
        });
      }
      if (leftoverInSlot > 0) {
        reportHydrationIssue({
          kind: "leftover-marker",
          detail: `${leftoverInSlot} hydration marker(s) survived inside a layout slot region; the page rendered differently than SSR \u2014 duplication risk.`
        });
      }
    } catch {
    }
    return { ok: unbalanced === 0 && leftoverInSlot === 0, unbalanced, leftoverInSlot };
  }

  // packages/runtime/src/router-match.ts
  function flattenLayoutChain(tree, pathParts, result = []) {
    for (let i = 0; i < tree.length; i++) {
      const node = tree[i];
      if (node.isGroup) {
        const contributes = !!(node.layout || node.page);
        const marker = result.length;
        if (contributes) result.push(node);
        const before = result.length;
        flattenLayoutChain(node.children || [], pathParts, result);
        if (result.length > before) break;
        if (contributes) result.length = marker;
        if (node.page && (pathParts.length === 0 || pathParts.every((p) => p === ""))) {
          result.push(node);
          break;
        }
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
        const isLeaf2 = remaining.length === 0 || remaining.every((p) => p === "");
        if (node.standalone) result.length = 0;
        result.push(node);
        if (isLeaf2) {
          if (!node.page && (node.children || []).length > 0) {
            const before = result.length;
            flattenLayoutChain(node.children || [], remaining, result);
            if (result.length > before) break;
          }
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
    if (matchChain.length === 0) return null;
    const params = {};
    let partIdx = 0;
    for (const node of matchChain) {
      const segCount = node.segmentCount != null ? node.segmentCount : 1;
      if (node.isDynamic && !node.isCatchAll) {
        const name = node.path.startsWith(":") ? node.path.slice(1) : node.path;
        const paramIdx = partIdx + segCount - 1;
        if (paramIdx < pathParts.length) {
          params[name] = decodeURIComponent(pathParts[paramIdx]);
        }
      }
      if (node.isCatchAll) {
        const name = node.path.startsWith(":") ? node.path.slice(1) : node.path;
        params[name] = pathParts.slice(partIdx).map(decodeURIComponent).join("/");
      }
      partIdx += segCount;
    }
    return { matchChain, params, pathname };
  }

  // packages/runtime/src/context.ts
  var ctx = { current: null };
  function getActiveComponent() {
    return ctx.current ?? globalThis.__vesk_ctx ?? null;
  }
  function setActiveComponent(value) {
    ctx.current = value;
  }
  var Context = class {
    _v;
    /** Identity of this context instance — a Map key in the provider chain. */
    id;
    constructor(value) {
      this._v = value;
      this.id = Symbol("vesk-context");
    }
    /**
     * Reads the nearest value set by an ancestor component, else the default.
     * Typed as `T`, so a context created with a type carries that type all the
     * way to every reader.
     */
    get() {
      let current = getActiveComponent();
      while (current) {
        if (current.c?.has(this)) return current.c.get(this);
        current = current.p;
      }
      return this._v;
    }
    /** Sets the value for this component and its descendants. Typed as `T`. */
    set(value) {
      const component = getActiveComponent();
      if (component === null) throw new Error("No active component found, cannot set context");
      let map = component.c;
      if (map === null) map = component.c = /* @__PURE__ */ new Map();
      map.set(this, value);
    }
  };
  function createContext(value) {
    return new Context(value);
  }

  // packages/runtime/src/loading-indicator.ts
  function defaultEstimatedProgress(duration, elapsed) {
    const completionPercentage = elapsed / duration * 100;
    return 2 / Math.PI * 100 * Math.atan(completionPercentage / 50);
  }
  var globalOpts = {
    duration: 2e3,
    throttle: 200,
    hideDelay: 500,
    resetDelay: 400,
    estimatedProgress: defaultEstimatedProgress
  };
  function configureLoadingIndicator(opts) {
    if (!opts) return;
    if (typeof opts.duration === "number" && opts.duration > 0) globalOpts.duration = opts.duration;
    if (typeof opts.throttle === "number" && opts.throttle >= 0) globalOpts.throttle = opts.throttle;
    if (typeof opts.hideDelay === "number" && opts.hideDelay >= 0) globalOpts.hideDelay = opts.hideDelay;
    if (typeof opts.resetDelay === "number" && opts.resetDelay >= 0) globalOpts.resetDelay = opts.resetDelay;
    if (typeof opts.estimatedProgress === "function") globalOpts.estimatedProgress = opts.estimatedProgress;
  }
  var progressCell = tracked(0);
  var loadingCell = tracked(false);
  var errorCell = tracked(false);
  function isServer() {
    return !!globalThis.__vsk_ssr;
  }
  function now() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
    return Date.now();
  }
  var rafId = null;
  var throttleTimer = null;
  var hideTimer = null;
  var resetTimer = null;
  var animating = false;
  function clearAnim() {
    animating = false;
    if (throttleTimer !== null) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    if (rafId !== null) {
      clearTimeout(rafId);
      rafId = null;
    }
  }
  function clearTimers() {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (resetTimer !== null) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  }
  function startProgress() {
    animating = true;
    let startTimeStamp = null;
    const step = () => {
      rafId = null;
      if (!animating || isServer()) return;
      const ts = now();
      if (startTimeStamp === null) startTimeStamp = ts;
      const pct = globalOpts.estimatedProgress(globalOpts.duration, ts - startTimeStamp);
      set(progressCell, Math.max(0, Math.min(100, pct)));
      rafId = setTimeout(step, 16);
    };
    step();
  }
  function present(opts) {
    const throttleMs = opts?.force ? 0 : globalOpts.throttle;
    if (isServer() || throttleMs <= 0) {
      set(loadingCell, true);
      return;
    }
    if (throttleTimer !== null) clearTimeout(throttleTimer);
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      set(loadingCell, true);
    }, throttleMs);
  }
  function loadingStart(opts) {
    clearTimers();
    clearAnim();
    set(errorCell, false);
    set(progressCell, 0);
    present(opts);
    startProgress();
  }
  function hide() {
    hideTimer = setTimeout(() => {
      hideTimer = null;
      set(loadingCell, false);
      resetTimer = setTimeout(() => {
        resetTimer = null;
        set(progressCell, 0);
      }, globalOpts.resetDelay);
    }, globalOpts.hideDelay);
  }
  function loadingFinish(opts) {
    clearAnim();
    set(progressCell, 100);
    clearTimers();
    if (opts?.error) set(errorCell, true);
    if (opts?.force) {
      set(progressCell, 0);
      set(loadingCell, false);
      return;
    }
    if (!isServer()) hide();
  }
  function getLoadingState() {
    return { progress: progressCell, isLoading: loadingCell, error: errorCell };
  }
  var LOADING_INDICATOR_DEFAULT_COLOR = "repeating-linear-gradient(to right,#38bdf8 0%,#6366f1 50%,#8b5cf6 100%)";
  var LOADING_INDICATOR_DEFAULT_ERROR_COLOR = "repeating-linear-gradient(to right,#f87171 0%,#ef4444 100%)";
  var INDICATOR_ATTR = "data-vesk-loading-indicator";
  function heightCss(height) {
    if (typeof height === "number") return `${height}px`;
    if (typeof height === "string" && height.trim() !== "") return height;
    return "3px";
  }
  function escapeAttr(v) {
    let out = "";
    for (const ch of v) {
      if (ch === "&") out += "&amp;";
      else if (ch === '"') out += "&quot;";
      else if (ch === "<") out += "&lt;";
      else out += ch;
    }
    return out;
  }
  function baseStyleEntries(props) {
    const top = props.position !== "bottom";
    const entries = [
      ["position", "fixed"],
      [top ? "top" : "bottom", "0"],
      ["right", "0"],
      ["left", "0"],
      ["pointer-events", "none"],
      ["width", "auto"],
      ["height", heightCss(props.height)],
      ["z-index", String(props.zIndex != null ? props.zIndex : 999999)],
      ["transform-origin", "left"],
      ["transition", "transform 0.1s, height 0.4s, opacity 0.4s"]
    ];
    return entries;
  }
  function styleToString(entries, extra) {
    const parts = entries.map(([k, v]) => `${k}:${v}`);
    for (const [k, v] of Object.entries(extra)) parts.push(`${k}:${v}`);
    return parts.join(";");
  }
  function applyState(props) {
    const progress = get(progressCell);
    const isLoading = get(loadingCell) === true;
    const errored = get(errorCell) === true;
    const bg = errored ? props.errorColor || LOADING_INDICATOR_DEFAULT_ERROR_COLOR : props.color === false ? void 0 : props.color || LOADING_INDICATOR_DEFAULT_COLOR;
    const extra = {
      opacity: isLoading ? "1" : "0",
      transform: `scaleX(${progress}%)`
    };
    if (bg !== void 0) extra.background = bg;
    if (progress > 0 && bg !== void 0) {
      extra["background-size"] = `${100 / Math.min(progress, 100) * 100}% auto`;
    }
    return extra;
  }
  function wire(el, props, userStyle) {
    const base = baseStyleEntries(props);
    const paint = () => {
      el.style.cssText = styleToString(base, applyState(props)) + (userStyle ? ";" + userStyle : "");
    };
    paint();
    effect(paint);
  }
  function appendChildren(el, children) {
    if (children == null) return;
    if (typeof children === "string" || typeof children === "number") {
      el.appendChild(document.createTextNode(String(children)));
      return;
    }
    if (children.nodeType) {
      el.appendChild(children);
      return;
    }
    if (Array.isArray(children)) {
      for (const c of children) appendChildren(el, c);
    }
  }
  function LoadingIndicator(props = {}, _registry, hydrate2) {
    configureLoadingIndicator(props);
    const classNameRaw = props.className != null ? String(props.className) : props.class != null ? String(props.class) : "";
    const userStyle = props.style != null ? String(props.style) : "";
    if (typeof document === "undefined") {
      const attrs = [
        INDICATOR_ATTR,
        classNameRaw ? `class="${escapeAttr(classNameRaw)}"` : ""
      ].filter(Boolean).join(" ");
      const styleAttr = escapeAttr(styleToString(baseStyleEntries(props), applyState(props)) + (userStyle ? ";" + userStyle : ""));
      return `<div ${attrs} aria-hidden="true" role="presentation" style="${styleAttr}"></div>`;
    }
    let el;
    if (hydrate2 && typeof hydrate2.nextElement === "function") {
      el = hydrate2.nextElement("div");
      if (el && !el.parentNode && hydrate2.root) {
        const existing = hydrate2.root.querySelector(`[${INDICATOR_ATTR}]`);
        if (existing) el = existing;
      }
    } else {
      el = document.createElement("div");
    }
    el.setAttribute(INDICATOR_ATTR, "");
    if (classNameRaw) el.className = classNameRaw;
    appendChildren(el, props.children);
    wire(el, props, userStyle);
    if (el.parentNode) return document.createDocumentFragment();
    return el;
  }

  // packages/runtime/src/router-components.ts
  var NotFoundError = class extends Error {
    constructor(msg = "Not Found") {
      super(msg);
      this.name = "NotFoundError";
    }
  };
  var RouterCtx = createContext(null);
  var _currentRouter = null;
  function routerMode() {
    const r = RouterCtx.get() || _currentRouter;
    return !!(r && r._hashMode);
  }
  function routeHrefOf(href) {
    return routerMode() && href.startsWith("#") ? href.slice(1) : href;
  }
  function isRouteHref(href) {
    if (!routerMode()) return !href.startsWith("#");
    return !href.startsWith("#") || href.startsWith("#/");
  }
  function addActiveClass(el, activeClass) {
    const tokens = String(activeClass || "active").split(/\s+/);
    for (const t of tokens) if (t) el.classList.add(t);
  }
  var __isHydrating = false;
  function setIsHydrating(v) {
    __isHydrating = v;
  }
  var _state = {
    path: track("/"),
    params: track({}),
    search: track("")
  };
  var _scrollPositions = /* @__PURE__ */ new Map();
  var _isPopStateNavigation = false;
  function setIsPopStateNavigation(v) {
    _isPopStateNavigation = v;
  }
  function setCurrentRouter(r) {
    _currentRouter = r;
  }
  function getCurrentRouter() {
    return _currentRouter;
  }
  function isFn(v) {
    return typeof v === "function";
  }
  function findLoadingComponent(chain) {
    for (let i = chain.length - 1; i >= 0; i--) {
      const v = chain[i].loading;
      if (isFn(v)) return v;
    }
    return null;
  }
  function findErrorComponent(chain) {
    for (let i = chain.length - 1; i >= 0; i--) {
      const v = chain[i].error;
      if (isFn(v)) return v;
    }
    return null;
  }
  function findNotFoundComponent(chain) {
    for (let i = chain.length - 1; i >= 0; i--) {
      const v = chain[i].notFound;
      if (isFn(v)) return v;
    }
    return null;
  }
  function findOfflineComponent(chain) {
    for (let i = chain.length - 1; i >= 0; i--) {
      const v = chain[i].offline;
      if (v !== void 0 && v !== null) return v;
    }
    return null;
  }
  function findNetworkComponent(chain) {
    for (let i = chain.length - 1; i >= 0; i--) {
      const v = chain[i].network;
      if (v !== void 0 && v !== null) return v;
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
  function handleScroll(pathname, isReplace, scrollBehavior) {
    if (typeof window === "undefined" || typeof window.scrollTo !== "function") return;
    const behavior = scrollBehavior === "smooth" || scrollBehavior === "instant" ? scrollBehavior : "auto";
    if (_isPopStateNavigation) {
      setIsPopStateNavigation(false);
      const savedY = _scrollPositions.get(pathname);
      requestAnimationFrame(() => {
        window.scrollTo({ top: savedY !== void 0 ? savedY : 0, behavior });
      });
    } else if (!isReplace) {
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior }));
    }
  }
  var HEAD_MARKER = "data-vesk-head";
  var HEAD_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\xA0"
  };
  function decodeHeadText(value) {
    if (value.indexOf("&") === -1) return value;
    return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
      if (body.charCodeAt(0) === 35) {
        const hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88;
        const num = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
        if (!Number.isFinite(num) || num < 0 || num > 1114111) return match;
        try {
          return String.fromCodePoint(num);
        } catch {
          return match;
        }
      }
      const named = HEAD_ENTITIES[body.toLowerCase()];
      return named === void 0 ? match : named;
    });
  }
  function applyHeadAttrs(el, raw) {
    for (const attrMatch of raw.matchAll(/([a-zA-Z0-9\-:]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      const name = attrMatch[1];
      const value = attrMatch[3] ?? attrMatch[4] ?? "";
      if (name.toLowerCase() === "charset") continue;
      el.setAttribute(name, decodeHeadText(value));
    }
  }
  function applyHead(headHtml) {
    if (typeof document === "undefined") return;
    const head = document.head;
    if (!head) return;
    for (const el of Array.from(head.querySelectorAll("[" + HEAD_MARKER + "]"))) {
      el.remove();
    }
    if (!headHtml) return;
    const titleMatch = headHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      const t = document.createElement("title");
      t.textContent = decodeHeadText(titleMatch[1]);
      t.setAttribute(HEAD_MARKER, "");
      head.appendChild(t);
    }
    for (const m of headHtml.matchAll(/<meta\b([^>]*)>/gi)) {
      const meta = document.createElement("meta");
      applyHeadAttrs(meta, m[1] || "");
      if (!meta.hasAttributes()) continue;
      meta.setAttribute(HEAD_MARKER, "");
      head.appendChild(meta);
    }
    for (const m of headHtml.matchAll(/<link\b([^>]*)>/gi)) {
      const link = document.createElement("link");
      applyHeadAttrs(link, m[1] || "");
      if (!link.hasAttributes()) continue;
      link.setAttribute(HEAD_MARKER, "");
      head.appendChild(link);
    }
    const baseMatch = headHtml.match(/<base\b([^>]*)>/i);
    if (baseMatch) {
      const base = document.createElement("base");
      applyHeadAttrs(base, baseMatch[1] || "");
      if (base.hasAttributes()) {
        base.setAttribute(HEAD_MARKER, "");
        head.appendChild(base);
      }
    }
    for (const m of headHtml.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)) {
      const style = document.createElement("style");
      style.textContent = decodeHeadText(m[2]);
      style.setAttribute(HEAD_MARKER, "");
      head.appendChild(style);
    }
  }
  function mountLinkChildren(target, children) {
    if (children.nodeType) {
      target.appendChild(children);
    } else if (Array.isArray(children)) {
      for (const c of children) {
        if (c && c.nodeType) target.appendChild(c);
        else if (c != null) target.appendChild(document.createTextNode(String(c)));
      }
    }
  }
  function Link(props, registry, hydrate2) {
    const href = props.href || "#";
    if (hydrate2 && hydrate2.nextElement) {
      let a2 = hydrate2.nextElement("a");
      const claimed = a2 ? a2.parentNode !== null : false;
      if (!a2) a2 = document.createElement("a");
      applyLinkDom(a2, props, href);
      if (props.children != null) {
        if (typeof props.children === "string" || typeof props.children === "number") {
          a2.textContent = String(props.children);
        } else {
          a2.replaceChildren();
          mountLinkChildren(a2, props.children);
        }
      }
      a2.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (props.target === "_blank") return;
        if (!isRouteHref(href)) return;
        e.preventDefault();
        e.stopPropagation();
        const nav = useNavigate();
        nav(href, { scrollBehavior: props.scrollBehavior });
      });
      return claimed ? document.createDocumentFragment() : a2;
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
      const markerlessSsr = globalThis.__vsk_ssr_markerless === true;
      if (markerlessSsr) {
        return `<a ${attrs}>${childStr}</a>`;
      }
      return `<!--vsk:c:Link--><a ${attrs}>${childStr}</a>`;
    }
    const a = document.createElement("a");
    applyLinkDom(a, props, href);
    if (childStr) {
      a.textContent = childStr;
    } else if (props.children != null) {
      mountLinkChildren(a, props.children);
    }
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (props.target === "_blank") return;
      if (!isRouteHref(href)) return;
      e.preventDefault();
      e.stopPropagation();
      const nav = useNavigate();
      nav(href, { scrollBehavior: props.scrollBehavior });
    });
    return a;
  }
  function applyLinkDom(a, props, href) {
    const displayHref = routerMode() && !href.startsWith("#") ? "#" + href : href;
    a.href = displayHref;
    if (props.class) a.className = props.class;
    if (props.style) a.setAttribute("style", props.style);
    if (props.target) a.target = props.target;
    if (props.rel) a.rel = props.rel;
  }
  function NavLink(props, registry, hydrate2) {
    if (typeof document === "undefined") {
      return Link(props, registry, hydrate2);
    }
    if (hydrate2 && hydrate2.nextElement) {
      let a2 = hydrate2.nextElement("a");
      if (a2 && !a2.parentNode && hydrate2.root) {
        const existing = hydrate2.root.querySelector("a");
        if (existing) a2 = existing;
      }
      const claimed = a2 ? a2.parentNode !== null : false;
      if (!a2) a2 = document.createElement("a");
      applyLinkDom(a2, props, props.href);
      if (props.children != null) {
        if (typeof props.children === "string" || typeof props.children === "number") {
          a2.textContent = String(props.children);
        } else {
          a2.replaceChildren();
          mountLinkChildren(a2, props.children);
        }
      }
      a2.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (props.target === "_blank") return;
        if (!isRouteHref(props.href)) return;
        e.preventDefault();
        e.stopPropagation();
        const nav = useNavigate();
        nav(props.href, { scrollBehavior: props.scrollBehavior });
      });
      const path2 = usePathname();
      const routeHref2 = routeHrefOf(props.href);
      const isActive2 = routeHref2 === path2 || routeHref2 !== "/" && path2.startsWith(routeHref2) && (path2.length === routeHref2.length || path2[routeHref2.length] === "/" || path2[routeHref2.length] === "?");
      if (isActive2) {
        addActiveClass(a2, props.activeClass);
        if (props.ariaCurrent !== false) a2.setAttribute("aria-current", "page");
      }
      return claimed ? document.createDocumentFragment() : a2;
    }
    if (__isHydrating) {
      const q = document.querySelector(`a[href="${props.href}"]`);
      if (q) {
        applyLinkDom(q, props, props.href);
        if (props.children != null) {
          if (typeof props.children === "string" || typeof props.children === "number") {
            q.textContent = String(props.children);
          } else {
            q.replaceChildren();
            mountLinkChildren(q, props.children);
          }
        }
        q.addEventListener("click", (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          if (props.target === "_blank") return;
          if (!isRouteHref(props.href)) return;
          e.preventDefault();
          e.stopPropagation();
          const nav = useNavigate();
          nav(props.href, { scrollBehavior: props.scrollBehavior });
        });
        const path2 = usePathname();
        const routeHref2 = routeHrefOf(props.href);
        const isActive2 = routeHref2 === path2 || routeHref2 !== "/" && path2.startsWith(routeHref2) && (path2.length === routeHref2.length || path2[routeHref2.length] === "/" || path2[routeHref2.length] === "?");
        if (isActive2) {
          addActiveClass(q, props.activeClass);
          if (props.ariaCurrent !== false) q.setAttribute("aria-current", "page");
        }
        const claimed = q.parentNode !== null;
        return claimed ? document.createDocumentFragment() : q;
      }
    }
    const a = Link(props, registry, hydrate2);
    const path = usePathname();
    const routeHref = routeHrefOf(props.href);
    const isActive = routeHref === path || routeHref !== "/" && path.startsWith(routeHref) && (path.length === routeHref.length || path[routeHref.length] === "/" || path[routeHref.length] === "?");
    if (isActive) {
      addActiveClass(a, props.activeClass);
      if (props.ariaCurrent !== false) a.setAttribute("aria-current", "page");
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
  function usePathname() {
    return get(_state.path);
  }

  // packages/runtime/src/network.ts
  var listeners = /* @__PURE__ */ new Set();
  var installed = false;
  function readConnection() {
    if (typeof navigator === "undefined" || !navigator) return null;
    const navAny = navigator;
    return navAny.connection || navAny.mozConnection || navAny.webkitConnection;
  }
  function getNetworkState() {
    const conn = readConnection();
    let online = true;
    if (typeof navigator !== "undefined" && navigator && typeof navigator.onLine === "boolean") {
      online = navigator.onLine;
    }
    const rawType = typeof conn?.effectiveType === "string" ? conn.effectiveType : "";
    const effectiveType = rawType === "slow-2g" || rawType === "2g" || rawType === "3g" || rawType === "4g" ? rawType : "unknown";
    return {
      online,
      effectiveType,
      downlink: typeof conn?.downlink === "number" ? conn.downlink : null,
      rtt: typeof conn?.rtt === "number" ? conn.rtt : null,
      saveData: conn?.saveData === true
    };
  }
  function notify() {
    const state = getNetworkState();
    for (const fn of [...listeners]) {
      try {
        fn(state);
      } catch {
      }
    }
  }
  function install() {
    if (installed || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    installed = true;
    window.addEventListener("online", notify);
    window.addEventListener("offline", notify);
    const conn = readConnection();
    conn?.addEventListener?.("change", notify);
  }
  function watchNetwork(cb) {
    install();
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }

  // packages/runtime/src/router.ts
  var loadedChunks = /* @__PURE__ */ new Set();
  var failedChunks = /* @__PURE__ */ new Map();
  var inFlightChunks = /* @__PURE__ */ new Map();
  function chunkLoadError(chunkUrl) {
    return failedChunks.get(chunkUrl);
  }
  function ensureChunk(chunkUrl) {
    if (!chunkUrl || loadedChunks.has(chunkUrl)) return Promise.resolve();
    const inFlight = inFlightChunks.get(chunkUrl);
    if (inFlight) return inFlight;
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return Promise.resolve();
    }
    const promise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = chunkUrl;
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        inFlightChunks.delete(chunkUrl);
        failedChunks.set(chunkUrl, err);
        reject(err);
      };
      s.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        loadedChunks.add(chunkUrl);
        inFlightChunks.delete(chunkUrl);
        failedChunks.delete(chunkUrl);
        resolve();
      };
      s.onerror = () => {
        fail(new Error(`Failed to load chunk: ${chunkUrl}`));
      };
      const timer = setTimeout(() => {
        fail(new Error(`Timed out loading chunk: ${chunkUrl}`));
      }, CHUNK_LOAD_TIMEOUT_MS);
      document.head.appendChild(s);
    });
    inFlightChunks.set(chunkUrl, promise);
    return promise;
  }
  var CHUNK_LOAD_TIMEOUT_MS = typeof window !== "undefined" && Number(window.__vesk_chunk_timeout_ms) || 1e4;
  function loadChunksQuietly(urls) {
    navDebug("loadChunks start", urls);
    return Promise.all(urls.map((u) => ensureChunk(u).catch(() => void 0))).then(() => {
      navDebug("loadChunks done", urls);
    });
  }
  function navDebug(...parts) {
    if (typeof window === "undefined") return;
    const log = window.__veskNavDebug;
    if (log) log.push(parts.map((p) => Array.isArray(p) ? p.join(",") : String(p)).join(" "));
  }
  function hasPendingChunks(nodes) {
    const urls = [];
    const seen = /* @__PURE__ */ new Set();
    for (const n of nodes) {
      if (n._chunk && !seen.has(n._chunk)) {
        seen.add(n._chunk);
        if (!loadedChunks.has(n._chunk)) {
          urls.push(n._chunk);
        }
      }
    }
    return urls;
  }
  function installLinkPrefetch(warmChunks) {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    const recent = /* @__PURE__ */ new Map();
    const over = (e) => {
      const target = e.target;
      if (!target || target.nodeType !== 1) return;
      const link = target.closest ? target.closest("a[href]") : null;
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href) return;
      const now2 = Date.now();
      if (now2 - (recent.get(href) || 0) < 500) return;
      recent.set(href, now2);
      warmChunks(href);
    };
    document.addEventListener("pointerover", over, { passive: true });
    document.addEventListener("focusin", over, { passive: true });
    const schedule = (cb) => {
      const ric = typeof window !== "undefined" && typeof window.requestIdleCallback === "function" ? window.requestIdleCallback.bind(window) : (fn) => setTimeout(fn, 250);
      ric(() => {
        try {
          cb();
        } catch {
        }
      }, { timeout: 2e3 });
    };
    schedule(() => {
      if (typeof document.querySelectorAll !== "function") return;
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      if (anchors.length === 0) return;
      const seen = /* @__PURE__ */ new Set();
      let budget = 16;
      const warm = (a) => {
        const href = a.getAttribute("href");
        if (!href || seen.has(href) || budget-- <= 0) return;
        seen.add(href);
        warmChunks(href);
      };
      if (typeof IntersectionObserver === "function") {
        const io = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            warm(entry.target);
            io.unobserve(entry.target);
          }
          if (budget <= 0) io.disconnect();
        }, { rootMargin: "300px" });
        for (const a of anchors) io.observe(a);
      } else {
        for (const a of anchors) warm(a);
      }
    });
  }
  function warmRouteChunks(routeTree, href) {
    if (!href) return;
    let url;
    try {
      url = new URL(href, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    } catch {
      return;
    }
    const pathname = url.pathname;
    if (typeof window !== "undefined" && pathname === window.location.pathname && !url.search && !url.hash) return;
    const match = matchRoute(routeTree, pathname);
    if (!match) return;
    const urls = hasPendingChunks(match.matchChain);
    if (urls.length === 0) return;
    for (const u of urls) ensureChunk(u);
  }
  function isConnectivityFailure(err) {
    if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) return true;
    return err instanceof TypeError;
  }
  var _dataPromises = /* @__PURE__ */ new Map();
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
      if (res.status === 404) return { notFound: true };
      const ct = res.headers.get("content-type") || "";
      if (!res.ok) {
        if (ct.includes("application/json")) {
          try {
            const body = await res.json();
            if (body && typeof body === "object" && typeof body.error === "string") {
              return { error: body.error, statusCode: res.status };
            }
          } catch {
          }
        }
        return null;
      }
      if (!ct.includes("application/json")) return null;
      return await res.json();
    } catch (err) {
      if (isConnectivityFailure(err)) return { offline: true };
      if (await looksOffline()) return { offline: true };
      return null;
    }
  }
  function getRouteData(path, scope2) {
    const key = scope2 === void 0 ? path : path + "\0" + scope2;
    const existing = _dataPromises.get(key);
    if (existing) return existing;
    const p = fetchRouteData(path).finally(() => {
      _dataPromises.delete(key);
    });
    _dataPromises.set(key, p);
    return p;
  }
  function findPageNode(match) {
    const chain = match.matchChain;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i].page) return chain[i];
    }
    return null;
  }
  function findPageNodeOrFailed(match) {
    const chain = match.matchChain;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i].page || chain[i]._pageName) return chain[i];
    }
    return null;
  }
  function chunkErrorForNode(node) {
    if (!node) return void 0;
    if (node._chunk) {
      const err = chunkLoadError(node._chunk);
      if (err) return err;
    }
    if (node._chunkError) return new Error(String(node._chunkError));
    return void 0;
  }
  async function looksOffline() {
    if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) return true;
    if (typeof fetch !== "function") return false;
    try {
      await fetch("/__vesk_connectivity_" + Date.now(), { method: "HEAD", cache: "no-store" });
      return false;
    } catch (err) {
      return err instanceof TypeError;
    }
  }
  async function renderNotFound(router, match, container) {
    clearOfflineFlag(router, container);
    const chain = match.matchChain;
    const paramValues = match.params;
    const notFoundFn = findNotFoundComponent(chain);
    if (notFoundFn) {
      const tempRoot = document.createDocumentFragment();
      const walker = createHydrateWalker(tempRoot, []);
      const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
      const nfDom = await runInBlockWindow(() => notFoundFn(nfProps, /* @__PURE__ */ new Map(), walker));
      if (nfDom && typeof nfDom === "object" && nfDom.nodeType) {
        if (container.replaceChildren) container.replaceChildren(nfDom);
        else {
          container.innerHTML = "";
          container.appendChild(nfDom);
        }
      } else if (typeof nfDom === "string") {
        container.innerHTML = nfDom;
      }
      router._currentMatch = match;
      return;
    }
    if (container.replaceChildren) container.replaceChildren();
    else container.innerHTML = "";
    container.innerHTML = defaultErrorHtml(404, "Not Found");
    router._currentMatch = match;
  }
  function defaultOfflineHtml(url) {
    return '<div data-vesk-offline style="all:initial;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;font-family:system-ui,-apple-system,sans-serif;color:#1f2937;text-align:center;padding:24px"><div style="font-size:40px;line-height:1;margin-bottom:16px" aria-hidden="true">\u{1F4E1}</div><h1 style="font-size:22px;font-weight:700;margin:0 0 8px">You\u2019re offline</h1><p style="margin:0 0 20px;color:#6b7280;max-width:34em">Check your connection. <span style="color:#9ca3af">' + escapeOfflineUrl(url) + '</span> will load automatically once you\u2019re back online.</p><button type="button" data-vesk-offline-retry style="all:unset;cursor:pointer;background:#2563eb;color:#fff;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600">Retry now</button></div>';
  }
  function escapeOfflineUrl(url) {
    return String(url).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function defaultErrorHtml(status, message) {
    return '<div data-vesk-default-error="' + status + '" style="display:flex;align-items:center;justify-content:center;min-height:50vh;padding:32px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:inherit"><div style="display:flex;align-items:center"><span style="font-size:24px;font-weight:500;line-height:49px;padding-right:23px;margin-right:20px;border-right:1px solid currentColor;opacity:.85">' + status + '</span><span style="font-size:14px;line-height:49px;opacity:.7">' + message + "</span></div></div>";
  }
  async function renderOfflinePage(router, match, container) {
    const url = match.pathname || (typeof window !== "undefined" ? window.location.pathname : "");
    const chain = match.matchChain;
    const navTokenAtRender = router._navToken;
    const safeRetry = () => {
      const r = router;
      const now2 = Date.now();
      if (now2 - (r._lastOfflineRetry || 0) < 300) return;
      r._lastOfflineRetry = now2;
      router.navigate(url, { replace: true });
    };
    const mountComponent = async (entry) => {
      if (typeof entry === "string") {
        container.innerHTML = entry;
        return true;
      }
      const tempRoot = document.createDocumentFragment();
      const walker = createHydrateWalker(tempRoot, []);
      const props = { url, params: match.params, retry: safeRetry, ...getNetworkState() };
      const dom = await runInBlockWindow(() => entry(props, /* @__PURE__ */ new Map(), walker));
      if (dom && typeof dom === "object" && dom.nodeType) {
        if (container.replaceChildren) container.replaceChildren(dom);
        else {
          container.innerHTML = "";
          container.appendChild(dom);
        }
        return true;
      }
      if (typeof dom === "string") {
        container.innerHTML = dom;
        return true;
      }
      return false;
    };
    let mounted = false;
    let reactive = false;
    const offlineEntry = findOfflineComponent(chain);
    if (!mounted && offlineEntry && !getNetworkState().online) {
      mounted = await mountComponent(offlineEntry);
      reactive = mounted;
    }
    const networkEntry = findNetworkComponent(chain);
    if (!mounted && networkEntry) {
      mounted = await mountComponent(networkEntry);
      reactive = mounted;
    }
    const optionUI = router._offlineUI;
    if (!mounted && optionUI !== void 0 && optionUI !== null) {
      mounted = typeof optionUI === "function" ? await mountComponent(optionUI) : (container.innerHTML = String(optionUI), true);
      reactive = typeof optionUI === "function";
    }
    const errorFn = findErrorComponent(chain);
    if (!mounted && errorFn) {
      const err = new Error("You are offline");
      err.statusCode = 0;
      err.offline = true;
      await renderErrorPage(router, match, container, err);
      mounted = true;
    }
    if (!mounted) {
      container.innerHTML = defaultOfflineHtml(url);
      const retryBtn = container.querySelector ? container.querySelector("[data-vesk-offline-retry]") : null;
      if (retryBtn) retryBtn.addEventListener("click", safeRetry);
      reactive = true;
    }
    router._showingOffline = true;
    registerOnlineRecovery(router);
    if (reactive && typeof window !== "undefined") {
      container.__veskNetworkUI = true;
      const unsubscribe = watchNetwork(() => {
        const stillCurrent = router._navToken === navTokenAtRender && container.__veskNetworkUI === true && router._showingOffline === true;
        if (!stillCurrent) {
          unsubscribe();
          return;
        }
        void renderOfflinePage(router, match, container);
      });
    }
  }
  function registerOnlineRecovery(router) {
    const r = router;
    if (r._onlineHandler || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    r._onlineHandler = () => {
      if (!r._showingOffline) return;
      r._showingOffline = false;
      router.navigate(routeFromLocation(hashModeOf(r)), { replace: true });
    };
    window.addEventListener("online", r._onlineHandler);
  }
  async function applyRouteData(router, match, data, container, render2 = renderMatch) {
    if (data.offline) {
      await renderOfflinePage(router, match, container);
      return;
    }
    if (data.notFound) {
      await renderNotFound(router, match, container);
      return;
    }
    if (data.error) {
      const err = new Error(data.error);
      err.statusCode = data.statusCode || 500;
      await renderErrorPage(router, match, container, err);
      router._currentMatch = match;
      return;
    }
    const pathname = match.pathname || window.location.pathname;
    const pageNode = findPageNodeOrFailed(match);
    if (pageNode && data.props) {
      pageNode.props = data.props;
      pageNode._dataPath = pathname;
      pageNode._dataFetchedAt = Date.now();
    }
    if (data && "head" in data) {
      applyHead(data.head || "");
      if (pageNode) pageNode._head = data.head || "";
    }
    const hasRealProps = data.props ? Object.keys(data.props).some((k) => k !== "params") : false;
    if (!hasRealProps) {
      router._currentMatch = match;
      return;
    }
    let swapped = false;
    try {
      const fresh = await renderPageOnly(router, match);
      if (fresh !== void 0) {
        swapped = replacePageContent(container, fresh);
      }
    } catch {
      swapped = false;
    }
    if (!swapped) {
      await render2(router, match, container);
    }
    router._currentMatch = match;
  }
  function shouldFetchData(router, match) {
    const pageNode = findPageNodeOrFailed(match);
    if (!pageNode) return false;
    const pathname = match.pathname || window.location.pathname;
    if (pageNode._dataPath !== pathname) return true;
    const ttl = router._routeDataCache ?? 0;
    if (ttl <= 0) return true;
    const fetchedAt = pageNode._dataFetchedAt ?? 0;
    return Date.now() - fetchedAt >= ttl;
  }
  function hasRealPageData(data) {
    if (data.offline || data.notFound || data.redirect || data.error) return true;
    if (data.head && data.head.trim().length > 0) return true;
    const props = data.props;
    if (!props) return false;
    return Object.keys(props).some((k) => k !== "params");
  }
  function storePrefetchedData(match, data) {
    if (!data || data.notFound || data.redirect) return;
    const pathname = match.pathname || window.location.pathname;
    const pageNode = findPageNodeOrFailed(match);
    if (pageNode && data.props) {
      pageNode.props = data.props;
      pageNode._dataPath = pathname;
      pageNode._dataFetchedAt = Date.now();
    }
    if (data.head && pageNode) pageNode._head = data.head;
  }
  var PAGE_START_MARKER = "vesk:page";
  var PAGE_END_MARKER = "/vesk:page";
  function wrapPageContent(result) {
    const frag = document.createDocumentFragment();
    frag.appendChild(document.createComment(PAGE_START_MARKER));
    if (result && typeof result === "object" && result.nodeType) {
      frag.appendChild(result);
    } else if (typeof result === "string") {
      frag.appendChild(document.createTextNode(result));
    }
    frag.appendChild(document.createComment(PAGE_END_MARKER));
    return frag;
  }
  async function renderPageOnly(router, match) {
    const pageNode = findPageNodeOrFailed(match);
    if (!pageNode || !pageNode.page) return void 0;
    const tempRoot = document.createDocumentFragment();
    const walker = createHydrateWalker(tempRoot, []);
    const pageProps = { params: match.params, ...pageNode.props };
    const result = await runInBlockWindow(() => pageNode.page(pageProps, /* @__PURE__ */ new Map(), walker));
    if (result && result.nodeType === 1 && pageNode._pageName && router.__componentInstances) {
      const list = router.__componentInstances.get(pageNode._pageName);
      if (list && list.length > 0) list[list.length - 1].root = result;
    }
    return result;
  }
  function runInBlockWindow(fn) {
    const previous = scope();
    const block2 = root(() => {
    });
    set_active_block(block2);
    let result;
    try {
      result = fn();
    } catch (error) {
      set_active_block(previous);
      throw error;
    }
    if (result && typeof result.then === "function") {
      return result.then(
        (value) => {
          set_active_block(previous);
          return value;
        },
        (error) => {
          set_active_block(previous);
          throw error;
        }
      );
    }
    set_active_block(previous);
    return result;
  }
  function replacePageContent(container, newContent) {
    if (newContent === void 0 || newContent === null) return false;
    let start = null;
    let end = null;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!start && n.nodeValue === PAGE_START_MARKER) start = n;
      else if (start && n.nodeValue === PAGE_END_MARKER) {
        end = n;
        break;
      }
    }
    if (!start || !end || !end.parentNode) return false;
    let cur = start.nextSibling;
    while (cur && cur !== end) {
      const next = cur.nextSibling;
      cur.remove();
      cur = next;
    }
    if (typeof newContent === "string") {
      end.parentNode.insertBefore(document.createTextNode(newContent), end);
    } else {
      end.parentNode.insertBefore(newContent, end);
    }
    return true;
  }
  function storePageInstance(router, pageNode, pageProps, result) {
    if (!router || !pageNode._pageName || !result || result.nodeType !== 1) return;
    if (!router.__componentInstances) router.__componentInstances = /* @__PURE__ */ new Map();
    const name = pageNode._pageName;
    if (!router.__componentInstances.has(name)) router.__componentInstances.set(name, []);
    router.__componentInstances.get(name).push({ root: result, props: pageProps, node: pageNode, type: "page" });
  }
  function storeLayoutInstance(router, node, layoutProps, result) {
    if (!router || !node._layoutName || !result || result.nodeType !== 1) return;
    if (!router.__componentInstances) router.__componentInstances = /* @__PURE__ */ new Map();
    const name = node._layoutName;
    if (!router.__componentInstances.has(name)) router.__componentInstances.set(name, []);
    router.__componentInstances.get(name).push({ root: result, props: layoutProps, node, type: "layout" });
  }
  function renderMatch(router, match, container, navToken) {
    const chain = match.matchChain;
    const paramValues = match.params;
    let pageNode = findPageNodeOrFailed(match);
    const mountNotFound = (nfDom) => {
      if (nfDom && typeof nfDom === "object" && nfDom.nodeType) {
        if (container.replaceChildren) container.replaceChildren(nfDom);
        else {
          container.innerHTML = "";
          container.appendChild(nfDom);
        }
      } else if (typeof nfDom === "string") {
        container.innerHTML = nfDom;
      }
    };
    if (!pageNode) {
      const notFoundFn = findNotFoundComponent(chain);
      if (notFoundFn) {
        const tempRoot2 = document.createDocumentFragment();
        const walker = createHydrateWalker(tempRoot2, []);
        const nfProps = { params: paramValues, url: match.pathname || window.location.pathname };
        const nfDom = runInBlockWindow(() => notFoundFn(nfProps, /* @__PURE__ */ new Map(), walker));
        if (nfDom && typeof nfDom.then === "function") {
          return nfDom.then(mountNotFound);
        }
        mountNotFound(nfDom);
        return;
      }
      if (container.replaceChildren) {
        container.replaceChildren();
      } else {
        container.innerHTML = "";
      }
      container.innerHTML = defaultErrorHtml(404, "Not Found");
      return;
    }
    if (pageNode._pageName && (!pageNode.page || typeof pageNode.page === "string")) {
      const suspectOffline = failedChunks.has(pageNode._chunk) || typeof navigator !== "undefined" && !!navigator && navigator.onLine === false;
      navDebug("unresolved page guard", String(pageNode._pageName), "suspect=", String(suspectOffline));
      if (!suspectOffline) {
        const chunkErr0 = chunkErrorForNode(pageNode);
        return renderErrorPage(
          router,
          match,
          container,
          chunkErr0 || new Error(`Component "${pageNode._pageName}" is unavailable`)
        );
      }
      return looksOffline().then((offline) => {
        if (offline) return renderOfflinePage(router, match, container);
        const chunkErr = chunkErrorForNode(pageNode);
        return renderErrorPage(
          router,
          match,
          container,
          chunkErr || new Error(`Component "${pageNode._pageName}" is unavailable`)
        );
      });
    }
    const layoutNodes = chain.filter((n) => n.layout);
    const tempRoot = document.createDocumentFragment();
    const clientWalker = createHydrateWalker(tempRoot, []);
    function renderLayoutChain(index) {
      return renderLayoutWith(index, pageStep);
    }
    function renderLayoutWith(index, renderPage) {
      if (index >= layoutNodes.length) {
        return renderPage();
      }
      const node = layoutNodes[index];
      const childDom = renderLayoutWith(index + 1, renderPage);
      if (childDom && typeof childDom.then === "function") {
        return childDom.then((resolved) => {
          const layoutProps2 = { children: resolved, params: paramValues };
          const result2 = node.layout(layoutProps2, /* @__PURE__ */ new Map(), clientWalker);
          if (result2 && typeof result2.then === "function") {
            return result2.then((res) => {
              storeLayoutInstance(router, node, layoutProps2, res);
              return res;
            });
          }
          storeLayoutInstance(router, node, layoutProps2, result2);
          return result2;
        });
      }
      const layoutProps = { children: childDom, params: paramValues };
      const result = node.layout(layoutProps, /* @__PURE__ */ new Map(), clientWalker);
      if (result && typeof result.then === "function") {
        return result.then((res) => {
          storeLayoutInstance(router, node, layoutProps, res);
          return res;
        });
      }
      storeLayoutInstance(router, node, layoutProps, result);
      return result;
    }
    const pageStep = () => {
      set(_state.params, paramValues);
      set(_state.path, match.pathname || window.location.pathname);
      {
        const s = window.location.search || "";
        set(_state.search, s.startsWith("?") ? s.slice(1) : s);
      }
      const pageProps = { params: paramValues, ...pageNode.props };
      const result = pageNode.page(pageProps, /* @__PURE__ */ new Map(), clientWalker);
      if (result && typeof result.then === "function") {
        return result.then((res) => {
          storePageInstance(router, pageNode, pageProps, res);
          return wrapPageContent(res);
        });
      }
      storePageInstance(router, pageNode, pageProps, result);
      return wrapPageContent(result);
    };
    function renderErrorInLayout(error) {
      const errorFn = findErrorComponent(chain);
      if (!errorFn) throw error;
      const retry = () => {
        if (router && router.navigate) {
          router.navigate(routeFromLocation(hashModeOf(router)), { replace: true });
        }
      };
      const errorProps = { error, retry, params: paramValues, statusCode: error?.statusCode ?? 500, stack: error instanceof Error ? error.stack : String(error), url: typeof window !== "undefined" ? routeFromLocation(hashModeOf(router)) : "", offline: error?.offline === true, networkState: getNetworkState() };
      return runInBlockWindow(() => renderLayoutWith(0, () => {
        const result = errorFn(errorProps, /* @__PURE__ */ new Map(), clientWalker);
        if (result && typeof result.then === "function") {
          return result.then((res) => wrapPageContent(res));
        }
        return wrapPageContent(result);
      }));
    }
    function mountStandaloneError(error) {
      const errorFn = findErrorComponent(chain);
      if (!errorFn) throw error;
      const retry = () => {
        if (router && router.navigate) {
          router.navigate(routeFromLocation(hashModeOf(router)), { replace: true });
        }
      };
      const errorProps = { error, retry, params: paramValues, statusCode: error?.statusCode ?? 500, stack: error instanceof Error ? error.stack : String(error), url: typeof window !== "undefined" ? routeFromLocation(hashModeOf(router)) : "", offline: error?.offline === true, networkState: getNetworkState() };
      const errDom = runInBlockWindow(() => errorFn(errorProps, /* @__PURE__ */ new Map(), clientWalker));
      if (errDom && typeof errDom.then === "function") {
        errDom.then(mountDom);
      } else {
        mountDom(errDom);
      }
    }
    const mountDom = (dom) => {
      if (navToken !== void 0 && container.__veskMountToken !== navToken) {
        return;
      }
      if (dom && typeof dom === "object" && dom.nodeType) {
        if (container.replaceChildren) container.replaceChildren(dom);
        else {
          container.innerHTML = "";
          container.appendChild(dom);
        }
      } else if (typeof dom === "string") {
        container.innerHTML = dom;
      }
    };
    let rootDom;
    try {
      rootDom = runInBlockWindow(() => renderLayoutChain(0));
    } catch (error) {
      if (error instanceof NotFoundError) {
        if (typeof console !== "undefined") console.error("[vesk-debug] NotFoundError in renderLayoutChain:", error);
        return renderNotFound(router, match, container);
      }
      let errDom;
      try {
        errDom = renderErrorInLayout(error);
      } catch (err2) {
        mountStandaloneError(err2);
        return;
      }
      if (errDom && typeof errDom.then === "function") {
        return errDom.then(mountDom, (e) => {
          mountStandaloneError(e);
        });
      }
      mountDom(errDom);
      return;
    }
    if (rootDom && typeof rootDom.then === "function") {
      return rootDom.then(
        (resolved) => {
          mountDom(resolved);
        },
        (error) => {
          if (error instanceof NotFoundError) {
            return renderNotFound(router, match, container);
          }
          return Promise.resolve(renderErrorInLayout(error)).then(
            mountDom,
            (e) => {
              mountStandaloneError(e);
            }
          );
        }
      );
    }
    mountDom(rootDom);
  }
  function makeSsrError(message) {
    const e = new Error(message || "Internal Server Error");
    e.statusCode = 500;
    return e;
  }
  function clearOfflineFlag(router, container) {
    router._showingOffline = false;
    if (container) container.__veskNetworkUI = false;
  }
  async function renderErrorPage(router, match, container, error, navToken) {
    const stale = () => navToken !== void 0 && (router._navToken || 0) !== navToken;
    clearOfflineFlag(router, container);
    const chain = match.matchChain;
    const paramValues = match.params;
    const errorFn = findErrorComponent(chain);
    if (!errorFn) {
      if (stale()) return;
      if (container.replaceChildren) container.replaceChildren();
      else container.innerHTML = "";
      container.innerHTML = defaultErrorHtml(500, "Internal Server Error");
      return;
    }
    const layoutNodes = chain.filter((n) => n.layout);
    const tempRoot = document.createDocumentFragment();
    const walker = createHydrateWalker(tempRoot, []);
    const retry = () => {
      if (router && router.navigate) {
        router.navigate(routeFromLocation(hashModeOf(router)), { replace: true });
      }
    };
    const errorProps = { error, retry, params: paramValues, statusCode: error?.statusCode ?? 500, stack: error instanceof Error ? error.stack : String(error), url: typeof window !== "undefined" ? routeFromLocation(hashModeOf(router)) : "", offline: error?.offline === true, networkState: getNetworkState() };
    const renderErrorChain = (index) => {
      if (index >= layoutNodes.length) {
        const result2 = errorFn(errorProps, /* @__PURE__ */ new Map(), walker);
        if (result2 && typeof result2.then === "function") {
          return result2.then((res) => wrapPageContent(res));
        }
        return wrapPageContent(result2);
      }
      const node = layoutNodes[index];
      const childDom = renderErrorChain(index + 1);
      if (childDom && typeof childDom.then === "function") {
        return childDom.then((resolved) => {
          const layoutProps2 = { children: resolved, params: paramValues };
          const result2 = node.layout(layoutProps2, /* @__PURE__ */ new Map(), walker);
          if (result2 && typeof result2.then === "function") {
            return result2.then((res) => res);
          }
          return result2;
        });
      }
      const layoutProps = { children: childDom, params: paramValues };
      const result = node.layout(layoutProps, /* @__PURE__ */ new Map(), walker);
      if (result && typeof result.then === "function") {
        return result.then((res) => res);
      }
      return result;
    };
    const dom = await runInBlockWindow(() => renderErrorChain(0));
    if (stale()) return;
    if (dom && typeof dom === "object" && dom.nodeType) {
      if (container.replaceChildren) container.replaceChildren(dom);
      else {
        container.innerHTML = "";
        container.appendChild(dom);
      }
    } else if (typeof dom === "string") {
      container.innerHTML = dom;
    }
  }
  async function hydrateInitial(router, match, container, strategy) {
    const hydrationNavToken = router._navToken || 0;
    const chain = match.matchChain;
    const paramValues = match.params;
    let pageNode = findPageNodeOrFailed(match);
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
      container.innerHTML = defaultErrorHtml(404, "Not Found");
      return;
    }
    const ssrErrorMarker = (() => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_COMMENT);
      while (walker.nextNode()) {
        const v = walker.currentNode.nodeValue;
        if (v && v.startsWith("vesk-ssr-error")) {
          return v.slice("vesk-ssr-error".length);
        }
      }
      return null;
    })();
    set(_state.params, paramValues);
    set(_state.path, match.pathname || window.location.pathname);
    {
      const s = window.location.search || "";
      set(_state.search, s.startsWith("?") ? s.slice(1) : s);
    }
    if (ssrErrorMarker !== null) {
      let message = "Internal Server Error";
      if (ssrErrorMarker.startsWith(":")) {
        try {
          message = decodeURIComponent(ssrErrorMarker.slice(1));
        } catch {
        }
      }
      await renderErrorPage(router, match, container, makeSsrError(message), hydrationNavToken);
      return;
    }
    const layoutNodes = chain.filter((n) => n.layout);
    if (globalThis.__vesk_hydrate_debug) {
      console.error("[hyd-dbg] hydrateInitial", {
        pageName: pageNode._pageName,
        pageType: typeof pageNode.page,
        layoutNames: layoutNodes.map((n) => n._layoutName),
        hydratorKeys: router.__hydrators ? Object.keys(router.__hydrators) : null,
        containerKids: container.children.length
      });
    }
    const hydrators = router.__hydrators;
    if (!pageNode.page && !(hydrators && pageNode._pageName && hydrators[pageNode._pageName])) {
      if (await looksOffline()) {
        await renderOfflinePage(router, match, container);
        return;
      }
      const chunkErr = chunkErrorForNode(pageNode);
      await renderErrorPage(
        router,
        match,
        container,
        chunkErr || new Error(`Component "${pageNode._pageName}" is unavailable`),
        hydrationNavToken
      );
      return;
    }
    const hydPage = hydrators && pageNode._pageName ? hydrators[pageNode._pageName] || pageNode.page : pageNode.page;
    const hydLayouts = layoutNodes.map((n) => {
      if (hydrators && n._layoutName) {
        return hydrators[n._layoutName] || n.layout;
      }
      return n.layout;
    });
    try {
      let renderLayoutChain2 = function(index) {
        if (index >= layoutNodes.length) {
          return (subWalker) => {
            if (!strategy || strategy === "full") {
              const pageProps = { params: paramValues, ...pageNode.props };
              const result = hydPage(pageProps, /* @__PURE__ */ new Map(), subWalker);
              storePageInstance(router, pageNode, pageProps, result);
              return result;
            } else if (strategy === "viewport") {
              hydrateViewport(subWalker.root, hydPage, { params: paramValues, ...pageNode.props });
            } else if (strategy === "idle") {
              hydrateIdle(subWalker.root, hydPage, { params: paramValues, ...pageNode.props });
            } else if (strategy === "interaction") {
              hydrateOnInteraction(subWalker.root, hydPage, { params: paramValues, ...pageNode.props });
            }
            return void 0;
          };
        }
        const node = layoutNodes[index];
        const hydLayout = hydLayouts[index];
        const childHydrator = renderLayoutChain2(index + 1);
        return (walker2) => {
          const layoutProps = { children: childHydrator, params: paramValues };
          if (globalThis.__vesk_hydrate_debug && index === 0) {
            console.error("[hyd-dbg] invoking outer layout", node._layoutName, typeof hydLayout, "pageChild=", typeof childHydrator);
          }
          const result = hydLayout(layoutProps, /* @__PURE__ */ new Map(), walker2);
          storeLayoutInstance(router, node, layoutProps, result);
          return result;
        };
      };
      var renderLayoutChain = renderLayoutChain2;
      if (layoutNodes.length === 0) {
        const pageProps = { params: paramValues, ...pageNode.props };
        if (!strategy || strategy === "full") {
          const walker2 = createHydrateWalker(container);
          setIsHydrating(true);
          await runInBlockWindow(() => {
            const result = hydPage(pageProps, /* @__PURE__ */ new Map(), walker2);
            storePageInstance(router, pageNode, pageProps, result);
          });
          setIsHydrating(false);
        } else if (strategy === "viewport") {
          root(() => {
            hydrateViewport(container, hydPage, pageProps);
          });
        } else if (strategy === "idle") {
          root(() => {
            hydrateIdle(container, hydPage, pageProps);
          });
        } else if (strategy === "interaction") {
          root(() => {
            hydrateOnInteraction(container, hydPage, pageProps);
          });
        }
        return;
      }
      setIsHydrating(true);
      const walker = createHydrateWalker(container);
      await runInBlockWindow(() => renderLayoutChain2(0)(walker));
      if (!strategy || strategy === "full") {
        try {
          auditLayoutSlots(container);
        } catch {
        }
      }
      setIsHydrating(false);
    } catch (error) {
      setIsHydrating(false);
      if (globalThis.__vesk_hydrate_debug) {
        console.error("[hyd-dbg] hydrateInitial FAILED:", error);
        if (error instanceof Error && error.stack) {
          console.error("[hyd-dbg] hydrateInitial stack:", error.stack.split("\n").slice(0, 12).join("\n"));
        }
      }
      if (error instanceof NotFoundError) {
        if (typeof console !== "undefined") console.error("[vesk-debug] NotFoundError during hydration:", error);
        await renderNotFound(router, match, container);
        return;
      }
      try {
        await renderMatch(router, match, container);
      } catch (err2) {
        await renderErrorPage(router, match, container, err2, hydrationNavToken);
      }
    }
  }
  function hashModeOf(r) {
    return !!r && r._hashMode === true;
  }
  function routeFromLocation(mode) {
    if (mode) {
      const h = typeof window !== "undefined" ? window.location.hash : "";
      if (h.length > 1 && h[1] === "/") return h.slice(1);
      return "/";
    }
    return window.location.pathname + window.location.search;
  }
  function routeKey(mode) {
    return get(_state.path) || routeFromLocation(mode);
  }
  function scrollToHash() {
    const r = getCurrentRouter();
    if (hashModeOf(r)) return;
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (!h || h === "#") return;
    const id = h.slice(1);
    setTimeout(() => {
      try {
        const el = document.getElementById(id);
        if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
      }
    }, 80);
  }
  function createFileRouter(routeTree, options = {}) {
    const container = options.container || document.getElementById("root");
    const middleware = options.middleware || null;
    const renderFn = options.render || renderMatch;
    const hydrateStrategy = options.hydrate || "full";
    const hashMode = options.hash === true;
    const router = {
      _hydrateStrategy: hydrateStrategy,
      routeTree,
      container,
      _currentMatch: null,
      _outletPlaceholders: [],
      _currentSegments: null,
      _depth: 0,
      _routeDataCache: options.routeDataCache ?? 0,
      _offlineUI: options.offline ?? null,
      _beforeGuards: [],
      _viewTransitions: options.viewTransitions === true,
      _hashMode: hashMode,
      beforeEach(fn) {
        this._beforeGuards.push(fn);
        let active = true;
        return () => {
          if (!active) return;
          active = false;
          const guards = this._beforeGuards;
          const i = guards.indexOf(fn);
          if (i > -1) guards.splice(i, 1);
        };
      },
      _runGuards(to) {
        const from = get(_state.path) || window.location.pathname;
        for (const g2 of this._beforeGuards ?? []) {
          const d = g2(to, from);
          if (d instanceof Promise) {
            return d.then((r) => {
              if (r === false || typeof r === "string") return r;
            });
          }
          if (d === false || typeof d === "string") return d;
        }
      },
      go(n) {
        window.history.go(n);
      },
      get route() {
        const m = router._currentMatch;
        if (!m) return null;
        const chain = m.matchChain ?? [];
        const deepest = chain[chain.length - 1];
        return {
          pathname: m.pathname || "",
          params: m.params,
          pattern: deepest?.fullPath || "/"
        };
      },
      start() {
        setCurrentRouter(this);
        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
          let _scrollTimer = null;
          const _onScroll = () => {
            if (_scrollTimer) return;
            _scrollTimer = setTimeout(() => {
              if (window.scrollY !== void 0) {
                _scrollPositions.set(routeKey(hashMode), window.scrollY);
              }
              _scrollTimer = null;
            }, 100);
          };
          window.addEventListener("scroll", _onScroll, { passive: true });
        }
        window.addEventListener("popstate", () => {
          const p = routeFromLocation(hashMode);
          if (get(_state.path) === p) return;
          setIsPopStateNavigation(true);
          router.navigate(p, { replace: true });
        });
        if (hashMode) {
          window.addEventListener("hashchange", () => {
            const p = routeFromLocation(true);
            if (get(_state.path) === p) return;
            setIsPopStateNavigation(true);
            router.navigate(p, { replace: true });
          });
        }
        document.addEventListener("click", (e) => {
          const target = e.target;
          if (!target || target.nodeType !== 1) return;
          const anchor = target.closest("a[href]");
          if (!anchor) return;
          if (!anchor.hasAttribute("no-reload") && !anchor.hasAttribute("data-no-reload")) return;
          if (e.defaultPrevented) return;
          const me = e;
          if (me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button !== 0) return;
          if (anchor.target === "_blank") return;
          if (anchor.hasAttribute("download")) return;
          if (anchor.getAttribute("rel") === "external") return;
          const href = anchor.getAttribute("href");
          if (!href || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return;
          if (href.startsWith("#") && (!hashMode || !href.startsWith("#/"))) return;
          try {
            const url = new URL(href, window.location.origin);
            if (url.origin !== window.location.origin) return;
          } catch {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          router.navigate(href);
        });
        if (options.prefetch !== false) {
          installLinkPrefetch((href) => warmRouteChunks(router.routeTree, href));
        }
        const path = routeFromLocation(hashMode).split("?")[0];
        if (container.children.length > 0 && !hashMode) {
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
        const mode = hashModeOf(router);
        const raw = mode && typeof pathname === "string" && pathname.startsWith("#/") ? pathname.slice(1) : pathname;
        const url = raw instanceof URL ? raw : new URL(raw, window.location.origin);
        const match = matchRoute(routeTree, url.pathname);
        if (!match) {
          const chain = flattenLayoutChain(routeTree, url.pathname.split("/").filter(Boolean));
          const notFoundFn = findNotFoundComponent(chain);
          if (notFoundFn) {
            void (async () => {
              const tempRoot = document.createDocumentFragment();
              const walker = createHydrateWalker(tempRoot, []);
              const nfProps = { params: {}, url: url.pathname };
              const nfDom = await runInBlockWindow(() => notFoundFn(nfProps, /* @__PURE__ */ new Map(), walker));
              if (nfDom && typeof nfDom === "object" && nfDom.nodeType) {
                if (container.replaceChildren) container.replaceChildren(nfDom);
                else {
                  container.innerHTML = "";
                  container.appendChild(nfDom);
                }
              } else if (typeof nfDom === "string") {
                container.innerHTML = nfDom;
              }
            })();
          } else {
            container.innerHTML = defaultErrorHtml(404, "Not Found");
          }
          return;
        }
        match.pathname = url.pathname;
        const afterGuards = () => {
          if (!_isPopStateNavigation) {
            _scrollPositions.set(routeKey(mode), window.scrollY);
          }
          const swapView = (fn) => {
            const d = document;
            if (router._viewTransitions && typeof d.startViewTransition === "function") d.startViewTransition(fn);
            else fn();
          };
          const loadingFn = findLoadingComponent(match.matchChain);
          router._navToken = (router._navToken || 0) + 1;
          bumpNavEpoch();
          navDebug("navigate", url.pathname, "token=" + router._navToken, "pendingChunks", hasPendingChunks(match.matchChain));
          const navToken = router._navToken;
          loadingStart();
          const middlewareFns = Array.isArray(middleware) ? middleware : middleware ? [middleware] : [];
          let firstRenderFailed = false;
          const updateUrl = () => {
            const fullUrl = url.pathname + url.search;
            const target = mode ? fullUrl.startsWith("/") ? "#" + fullUrl : "#" + fullUrl : fullUrl;
            if (!opts.replace) {
              window.history.pushState({ path: fullUrl }, "", target);
            } else {
              window.history.replaceState({ path: fullUrl }, "", target);
            }
            set(_state.path, url.pathname);
            set(_state.search, url.search.startsWith("?") ? url.search.slice(1) : url.search);
          };
          const renderContent = () => {
            const propsNode = findPageNode(match);
            if (propsNode && propsNode._dataPath !== url.pathname) {
              propsNode.props = void 0;
            }
            try {
              container.__veskMountToken = navToken;
              renderFn(router, match, container, navToken);
            } catch (e) {
              firstRenderFailed = true;
              throw e;
            }
            router._currentMatch = match;
            clearOfflineFlag(router, container);
            handleScroll(url.pathname, opts.replace, opts.scrollBehavior);
          };
          const doRender = () => {
            navDebug("doRender", url.pathname, "token=" + navToken);
            updateUrl();
            swapView(() => renderContent());
            scrollToHash();
            navDebug("painted", url.pathname);
          };
          const fetchData = () => {
            if (firstRenderFailed) return;
            navDebug("fetchData?", url.pathname, String(shouldFetchData(router, match)));
            if (!shouldFetchData(router, match)) {
              loadingFinish();
              scrollToHash();
              return;
            }
            getRouteData(url.pathname + url.search, "nav" + navToken).then(async (data) => {
              navDebug("data arrived", url.pathname, "token=" + navToken, "current=" + router._navToken, "realProps", JSON.stringify(data && hasRealPageData(data)));
              if (navToken !== router._navToken) return;
              if (!data) {
                loadingFinish();
                return;
              }
              if (data.redirect) {
                loadingFinish();
                router.navigate(data.redirect, { replace: true });
                return;
              }
              if (!hasRealPageData(data)) {
                loadingFinish();
                return;
              }
              const pending = hasPendingChunks(match.matchChain);
              if (pending.length > 0) {
                await loadChunksQuietly(pending);
                if (navToken !== router._navToken) return;
                if (typeof router.__updateComponents === "function") {
                  router.__updateComponents(match.matchChain);
                }
              }
              await swapView(() => applyRouteData(router, match, data, container, renderFn));
              scrollToHash();
              loadingFinish({ error: !!data.error });
            }).catch(() => loadingFinish({ error: true }));
          };
          const pendingChunks = hasPendingChunks(match.matchChain);
          const handleNavFailure = (err) => {
            navDebug("handleNavFailure", String(err?.message || err).slice(0, 80));
            if (navToken !== router._navToken) return;
            loadingFinish({ error: true });
            looksOffline().then((offline) => {
              navDebug("handleNavFailure verdict", offline ? "offline" : "online");
              if (offline) return void renderOfflinePage(router, match, container);
              return void renderErrorPage(router, match, container, err, navToken);
            }).catch(() => {
            });
          };
          const doRenderWithChunks = pendingChunks.length > 0 ? () => {
            updateUrl();
            return loadChunksQuietly(pendingChunks).then(() => {
              if (navToken !== router._navToken) return;
              if (typeof router.__updateComponents === "function") {
                router.__updateComponents(match.matchChain);
              }
              try {
                renderContent();
                loadingFinish();
              } catch (e) {
                handleNavFailure(e);
              }
            }, (e) => {
              handleNavFailure(e);
            });
          } : (() => {
            if (typeof router.__updateComponents === "function") {
              router.__updateComponents(match.matchChain);
            }
            doRender();
          });
          async function runMwChain(index) {
            if (index >= middlewareFns.length) {
              await doRenderWithChunks();
              return;
            }
            const fn = middlewareFns[index];
            const ctx2 = { url: url.pathname, params: match.params, router, locals: {} };
            async function next(rewrite) {
              if (rewrite) {
                match.pathname = rewrite;
                url.pathname = rewrite;
              }
              return runMwChain(index + 1);
            }
            try {
              const result = await fn(ctx2, next);
              if (result && result.redirect) {
                router.navigate(result.redirect, { replace: true });
                return;
              }
            } catch (e) {
              if (e && e.name === "Redirect") {
                router.navigate(e.url, { replace: true });
                return;
              }
              handleNavFailure(e);
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
        };
        const guardResult = router._runGuards(url.pathname);
        if (guardResult instanceof Promise) {
          return guardResult.then((decision) => {
            if (decision === false) return;
            if (typeof decision === "string" && decision !== url.pathname && (router._guardDepth || 0) < 5) {
              router._guardDepth = (router._guardDepth || 0) + 1;
              const hop = router.navigate(decision, { replace: true });
              if (hop && typeof hop.then === "function") {
                return hop.then(
                  () => {
                    router._guardDepth = 0;
                  },
                  () => {
                    router._guardDepth = 0;
                  }
                );
              }
              router._guardDepth = 0;
              return;
            }
            afterGuards();
          });
        }
        if (guardResult === false) return;
        if (typeof guardResult === "string" && guardResult !== url.pathname && (router._guardDepth || 0) < 5) {
          router._guardDepth = (router._guardDepth || 0) + 1;
          try {
            router.navigate(guardResult, { replace: true });
          } finally {
            router._guardDepth = 0;
          }
          return;
        }
        afterGuards();
      },
      prefetch(path) {
        const mode = hashModeOf(router);
        const raw = mode && typeof path === "string" && path.startsWith("#/") ? path.slice(1) : path;
        const url = new URL(raw, window.location.origin);
        const match = matchRoute(routeTree, url.pathname);
        if (!match) return;
        match.pathname = url.pathname;
        router._prefetched = router._prefetched || /* @__PURE__ */ new Map();
        router._prefetched.set(url.pathname, match);
        const preloadUrls = hasPendingChunks(match.matchChain);
        preloadUrls.forEach(ensureChunk);
        if (typeof document === "undefined") return;
        getRouteData(url.pathname + url.search, "prefetch").then((data) => {
          if (data) storePrefetchedData(match, data);
        });
      },
      get currentPath() {
        return get(_state.path);
      },
      get isLoading() {
        const cells = getLoadingState();
        return Boolean(get(cells.isLoading));
      },
      hmrUpdate() {
        const updated = globalThis.__updatedComponents;
        if (!updated || updated.size === 0) return;
        globalThis.__updatedComponents = /* @__PURE__ */ new Set();
        if (typeof router.__updateComponents === "function") {
          router.__updateComponents(router.routeTree);
        }
        const path = routeFromLocation(hashModeOf(router)).split("?")[0];
        const match = matchRoute(router.routeTree, path);
        if (match) {
          match.pathname = path;
          const result = renderMatch(router, match, container);
          if (result && typeof result.then === "function") {
            result.catch((e) => console.error("HMR renderMatch error:", e));
          }
        }
      }
    };
    return router;
  }

  // packages/runtime/src/style.ts
  function kebab(key) {
    return key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
  }
  function applyStyle(el, value) {
    const node = el;
    if (value == null || value === false) {
      for (const key in node.__vskStyle || {}) node.style.removeProperty(key);
      node.__vskStyle = {};
      return;
    }
    if (typeof value === "string") {
      node.__vskStyle = void 0;
      if (node.getAttribute("style") !== value) node.setAttribute("style", value);
      return;
    }
    if (typeof value !== "object") return;
    const prev = node.__vskStyle || {};
    const next = {};
    for (const key in value) {
      const v = value[key];
      if (v == null || v === false) continue;
      next[kebab(key)] = String(v);
    }
    for (const key in prev) if (!(key in next)) node.style.removeProperty(key);
    for (const key in next) node.style.setProperty(key, next[key]);
    node.__vskStyle = next;
  }

  // packages/runtime/src/resource.ts
  var HttpError = class extends Error {
    status;
    statusCode;
    constructor(status, statusText) {
      super(`HTTP ${status}: ${statusText}`);
      this.status = status;
      this.statusCode = status;
      this.name = "HttpError";
    }
  };
  var TimeoutError = class extends Error {
    constructor(timeout) {
      super(`Request timed out after ${timeout}ms`);
      this.name = "TimeoutError";
    }
  };
  var g = () => globalThis;
  var isServer2 = () => !!g().__vsk_ssr;
  var ssrSink = null;
  function getClientCache() {
    const value = g().__vsk_fetch_cache;
    if (value) return value;
    const map = /* @__PURE__ */ new Map();
    g().__vsk_fetch_cache = map;
    return map;
  }
  function getInflight() {
    const value = g().__vsk_fetch_inflight;
    if (value) return value;
    const map = /* @__PURE__ */ new Map();
    g().__vsk_fetch_inflight = map;
    return map;
  }
  var DEFAULT_FAILURE_TTL = 1e4;
  function getServerFailureCache() {
    const value = g().__vsk_ssr_failure_cache;
    if (value) return value;
    const map = /* @__PURE__ */ new Map();
    g().__vsk_ssr_failure_cache = map;
    return map;
  }
  function clearFailureCache(key) {
    if (!isServer2()) return;
    g().__vsk_ssr_failure_cache?.delete(key);
  }
  function getRegistry() {
    const value = g().__vsk_fetch_registry;
    if (value) return value;
    const map = /* @__PURE__ */ new Map();
    g().__vsk_fetch_registry = map;
    return map;
  }
  function ssrSlotFor(token) {
    if (!token) return void 0;
    return g()[`__vsk_ssr_data_${token}`] || void 0;
  }
  function writeSsrSlot(token, key, value) {
    if (!token) return;
    const slot = g()[`__vsk_ssr_data_${token}`] || (g()[`__vsk_ssr_data_${token}`] = {});
    slot[key] = value;
  }
  function getSsrData(key) {
    const sink = ssrSink;
    if (sink) {
      const value = sink.get(key);
      if (value !== void 0) return value;
    }
    const slot = ssrSlotFor(g().__vsk_ssr_token || void 0);
    if (slot && slot[key] !== void 0) return slot[key];
    const store = g().__vsk_ssr_data;
    if (!store) return void 0;
    return store[key];
  }
  function getSsrFailures() {
    const tk = g().__vsk_ssr_token;
    if (!tk) return void 0;
    const key = `__vsk_ssr_failures_${tk}`;
    let store = g()[key];
    if (!store) {
      store = /* @__PURE__ */ new Map();
      g()[key] = store;
    }
    return store;
  }
  function setSsrData(key, value, ownerToken) {
    const sink = ssrSink;
    if (sink) sink.set(key, value);
    if (!g().__vsk_ssr_data) g().__vsk_ssr_data = {};
    g().__vsk_ssr_data[key] = value;
    if (ownerToken) writeSsrSlot(ownerToken, key, value);
    else writeSsrSlot(g().__vsk_ssr_token || void 0, key, value);
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
    if (typeof DOMException !== "undefined") return new DOMException("aborted", "AbortError");
    const error = new Error("aborted");
    error.name = "AbortError";
    return error;
  }
  function normalizeHeaders(headers) {
    const out = {};
    if (!headers) return out;
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      headers.forEach((value, key) => out[key] = value);
    } else if (Array.isArray(headers)) {
      for (const [key, value] of headers) out[key] = value;
    } else {
      Object.assign(out, headers);
    }
    return out;
  }
  function prepareBody(body, headers) {
    if (body === void 0 || body === null) return { headers };
    if (typeof body === "string" || typeof body === "boolean" || typeof body === "number" || typeof FormData !== "undefined" && body instanceof FormData || typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams || typeof Blob !== "undefined" && body instanceof Blob || typeof ArrayBuffer !== "undefined" && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) {
      return { body, headers };
    }
    if (!headers["content-type"] && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    return { body: JSON.stringify(body), headers };
  }
  function buildRequestInit(options) {
    const {
      method,
      credentials,
      cache,
      mode,
      redirect: redirect2,
      referrer,
      referrerPolicy,
      integrity,
      keepalive
    } = options;
    const init = { method, credentials, cache, mode, redirect: redirect2, referrer, referrerPolicy, integrity, keepalive };
    const prepared = prepareBody(options.body, normalizeHeaders(options.headers));
    init.headers = prepared.headers;
    if (prepared.body !== void 0) init.body = prepared.body;
    return init;
  }
  function resolveFetchUrl(url) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return url;
    const ctx2 = g().__vesk_request;
    const resolver = ctx2 && typeof ctx2.resolveUrl === "function" ? ctx2.resolveUrl : null;
    if (resolver) return resolver(url);
    const reqUrl = ctx2?.url;
    const base = typeof reqUrl === "string" && /^https?:\/\//i.test(reqUrl) ? reqUrl : globalThis.__vesk_ssr_base_url || "";
    if (base) return new URL(url, base).href;
    return url;
  }
  function doFetch(url, init) {
    const hook = g().__vesk_ssr_fetch;
    if (isServer2() && typeof hook === "function") {
      return hook(url, init);
    }
    return fetch(url, init);
  }
  function createFetcher(url, options) {
    const init = buildRequestInit(options);
    return async (signal) => {
      const res = await doFetch(resolveFetchUrl(url), signal ? { ...init, signal } : init);
      if (!res.ok) throw new HttpError(res.status, res.statusText);
      return res.json();
    };
  }
  function linkSignal(userSignal, controller) {
    if (!userSignal) return;
    if (userSignal.aborted) controller.abort();
    else userSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  async function runFetcher(handle, timeout) {
    const { retry = 0, retryDelay = 1e3, method, signal } = handle.options;
    const maxAttempts = retry + 1;
    const canRetry = !method || method.toUpperCase() === "GET";
    let attempt = 0;
    let lastError;
    while (true) {
      if (handle.block !== null && is_destroyed(handle.block)) throw makeAbortError();
      const controller = new AbortController();
      handle.controller = controller;
      linkSignal(signal, controller);
      let timer = null;
      const timeoutPromise = new Promise((_, reject) => {
        if (timeout <= 0) return;
        timer = setTimeout(() => {
          controller.abort();
          reject(new TimeoutError(timeout));
        }, timeout);
      });
      try {
        const result = await Promise.race([handle.fetcher(controller.signal), timeoutPromise]);
        return result;
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastError = error;
        const retriable = canRetry && attempt < maxAttempts - 1 && !(error instanceof HttpError && error.status >= 400 && error.status < 500);
        if (!retriable) throw error;
        if (retryDelay > 0) await sleep(retryDelay * (isServer2() ? 1 : Math.pow(2, attempt)));
        attempt++;
      } finally {
        if (timer !== null) clearTimeout(timer);
        if (handle.controller === controller) handle.controller = null;
      }
    }
  }
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function streamText(res, into, onChunk) {
    const decoder = new TextDecoder();
    let total = "";
    const emit = (text) => {
      if (!text) return;
      total += text;
      if (into) setInto(into, total);
      if (onChunk) onChunk(text, total);
    };
    const body = res.body;
    if (body && typeof body.getReader === "function") {
      const reader = body.getReader();
      return (async () => {
        for (; ; ) {
          const { done, value } = await reader.read();
          if (done) break;
          emit(decoder.decode(value, { stream: true }));
        }
        emit(decoder.decode());
        return total;
      })();
    }
    return res.text().then((text) => {
      emit(text);
      return total;
    });
  }
  function settle(handle, data) {
    if (handle.block !== null && is_destroyed(handle.block)) return;
    if (handle.into) setInto(handle.into, data);
    const current = get(handle.state);
    if (!(current.data === data && !current.loading && current.error === null)) {
      set(handle.state, { loading: false, error: null, data });
    }
    handle.settleNotify();
  }
  function settleError(handle, error) {
    if (handle.block !== null && is_destroyed(handle.block)) return;
    if (isAbortError(error)) {
      if (handle.controller !== null) return;
      const current2 = get(handle.state);
      if (current2.loading) set(handle.state, { loading: false, error: null, data: current2.data });
      handle.settleNotify();
      return;
    }
    const current = get(handle.state);
    set(handle.state, { loading: false, error, data: current.data });
    handle.settleNotify();
  }
  function markRefetching(handle) {
    const current = get(handle.state);
    if (current.loading) return;
    set(handle.state, {
      loading: true,
      error: null,
      data: handle.options.keepPreviousData ? current.data : void 0
    });
  }
  function attachSettle(handle, promise) {
    promise.then(
      (data) => settle(handle, data),
      (error) => settleError(handle, error)
    );
  }
  function writeCache(key, data) {
    if (isServer2()) return;
    const entry = getClientCache().get(key);
    if (!entry || entry.data !== data) getClientCache().set(key, { data, fetchedAt: Date.now() });
  }
  function trackSsrPromise(promise, defer = false) {
    const tk = g().__vsk_ssr_token || "";
    if (defer) {
      const deferredKey = tk ? `__vsk_ssr_deferred_${tk}` : "__vsk_ssr_deferred";
      if (!g()[deferredKey]) g()[deferredKey] = [];
      g()[deferredKey].push(promise);
      promise.then(void 0, () => {
      });
      return;
    }
    const promisesKey = tk ? `__vsk_ssr_promises_${tk}` : "__vsk_ssr_promises";
    if (!g()[promisesKey]) g()[promisesKey] = [];
    g()[promisesKey].push(promise);
  }
  function registerDestroyAbort(handle) {
    if (isServer2() || handle.block === null) return;
    on_destroy(() => {
      if (is_destroyed(handle.block)) {
        handle.controller?.abort();
        const registry = getRegistry().get(handle.key);
        if (registry) registry.delete(handle);
      }
    });
  }
  function startRequest(handle, skipCache) {
    const key = handle.key;
    const options = handle.options;
    if (isServer2()) {
      const failureTtl = options.failureTtl ?? DEFAULT_FAILURE_TTL;
      if (!skipCache && failureTtl > 0) {
        const failed = getServerFailureCache().get(key);
        if (failed && failed.ttl > 0 && Date.now() - failed.failedAt < failed.ttl) {
          getSsrFailures()?.set(key, failed.error);
          settleError(handle, failed.error);
          const settled = handle.settled.then(() => {
            throw failed.error;
          });
          settled.catch(() => {
          });
          return settled;
        }
      }
      const recorded = !skipCache ? getSsrFailures()?.get(key) : void 0;
      if (recorded !== void 0) {
        settleError(handle, recorded);
        const settled = handle.settled.then(() => {
          throw recorded;
        });
        settled.catch(() => {
        });
        return settled;
      }
      const existing = getInflight().get(key);
      const startToken = g().__vsk_ssr_token || void 0;
      const prom2 = existing ?? runFetcher(handle, options.timeout || 0);
      if (!existing) {
        getInflight().set(key, prom2);
        prom2.then(
          (data) => {
            setSsrData(key, data, startToken);
            clearFailureCache(key);
            settle(handle, data);
          },
          (error) => {
            getSsrFailures()?.set(key, error);
            if (isServer2() && !isAbortError(error) && failureTtl > 0) {
              getServerFailureCache().set(key, { error, failedAt: Date.now(), ttl: failureTtl });
            }
            settleError(handle, error);
          }
        ).finally(() => {
          if (getInflight().get(key) === prom2) getInflight().delete(key);
        });
      } else {
        attachSettle(handle, prom2);
      }
      trackSsrPromise(prom2, options.ssr === "defer");
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
    prom.then(
      (data) => {
        writeCache(key, data);
        settle(handle, data);
      },
      (error) => settleError(handle, error)
    ).finally(() => {
      if (options.dedupe !== false && getInflight().get(key) === prom) getInflight().delete(key);
    });
    if (options.dedupe !== false) getInflight().set(key, prom);
    registerDestroyAbort(handle);
    return prom;
  }
  function revalidate(handle) {
    if (!isServer2()) {
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
    if (prev) getInflight().delete(handle.key);
    handle.controller?.abort();
    startRequest(handle, true);
  }
  function createResourceAccessor(handle) {
    const state = handle.state;
    const accessor = {};
    Object.defineProperty(accessor, "loading", {
      get() {
        return get(state).loading;
      }
    });
    Object.defineProperty(accessor, "error", {
      get() {
        return get(state).error;
      }
    });
    Object.defineProperty(accessor, "data", {
      get() {
        return get(state).data;
      }
    });
    accessor._state = state;
    const toData = async () => {
      for (; ; ) {
        const s = get(state);
        if (!s.loading) {
          if (s.error) throw s.error;
          return s.data;
        }
        await handle.settled;
      }
    };
    accessor.then = (onFulfilled, onRejected) => toData().then(onFulfilled, onRejected);
    accessor.catch = (onRejected) => toData().catch(onRejected);
    accessor.finally = (onFinally) => toData().finally(onFinally);
    accessor.refresh = () => revalidate(handle);
    accessor.abort = () => {
      if (!isServer2()) handle.controller?.abort();
    };
    return accessor;
  }
  function createResource(fn, key, into, options = {}) {
    const resourceKey = key || options.key || fn._ssrKey || fn.toString().slice(0, 64);
    let notify2 = () => {
    };
    const handle = {
      key: resourceKey,
      state: tracked({ loading: true, error: null, data: void 0 }),
      into,
      fetcher: fn,
      options,
      block: scope(),
      controller: null,
      settled: new Promise((res) => {
        notify2 = res;
      }),
      settleNotify: () => {
        notify2();
        handle.settled = new Promise((res) => {
          notify2 = res;
        });
      }
    };
    const accessor = createResourceAccessor(handle);
    accessor.refresh = () => revalidate(handle);
    accessor.abort = () => {
      if (!isServer2()) handle.controller?.abort();
    };
    if (options.enabled === false) {
      set(handle.state, { loading: false, error: null, data: void 0 });
      return accessor;
    }
    if (!isServer2()) {
      const registry = getRegistry();
      const set2 = registry.get(resourceKey) ?? /* @__PURE__ */ new Set();
      set2.add(handle);
      registry.set(resourceKey, set2);
      if (handle.block !== null) {
        on_destroy(() => {
          if (is_destroyed(handle.block)) {
            handle.controller?.abort();
            const current = getRegistry().get(resourceKey);
            if (current) current.delete(handle);
          }
        });
      }
    }
    const ssrData = getSsrData(resourceKey);
    if (ssrData !== void 0) {
      if (isServer2()) {
        setSsrData(resourceKey, ssrData);
        clearFailureCache(resourceKey);
      }
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
  useFetch.text = (url, options) => useFetch(async () => {
    const res = await doFetch(resolveFetchUrl(url), buildRequestInit(options ?? {}));
    if (!res.ok) throw new HttpError(res.status, res.statusText);
    return res.text();
  }, {
    ...options,
    key: options?.key ?? url
  });
  useFetch.json = (url, options) => useFetch(async () => {
    const res = await doFetch(resolveFetchUrl(url), buildRequestInit(options ?? {}));
    if (!res.ok) throw new HttpError(res.status, res.statusText);
    return res.json();
  }, {
    ...options,
    key: options?.key ?? url
  });
  useFetch.arrayBuffer = (url, options) => useFetch(async () => {
    const res = await doFetch(resolveFetchUrl(url), buildRequestInit(options ?? {}));
    if (!res.ok) throw new HttpError(res.status, res.statusText);
    return res.arrayBuffer();
  }, {
    ...options,
    key: options?.key ?? url
  });
  useFetch.stream = (urlOrFn, options) => {
    const streamInto = options?.into;
    const streamOnChunk = options?.onChunk;
    const fetcher = (signal) => {
      const url = typeof urlOrFn === "function" ? urlOrFn() : urlOrFn;
      const init = buildRequestInit(options ?? {});
      return doFetch(resolveFetchUrl(url), signal ? { ...init, signal } : init).then(async (res) => {
        if (!res.ok) throw new HttpError(res.status, res.statusText);
        return streamText(res, streamInto, streamOnChunk);
      });
    };
    const key = options?.key ?? (typeof urlOrFn === "string" ? urlOrFn : void 0);
    const resource = useFetch(fetcher, { ...options, key });
    resource.into = streamInto;
    return resource;
  };

  // packages/runtime/src/reconcile.ts
  function reconcile(anchor, endAnchor, items, keyFn, createItem, claim) {
    const parent = anchor.parentNode;
    const map = /* @__PURE__ */ new Map();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = keyFn(item, i);
      const marker = document.createComment("k:" + key);
      const effs = [];
      const c = claim ? claim(key) : null;
      parent.insertBefore(marker, c ? c.el : endAnchor);
      createItem(item, i, effs, c ? c.el : null);
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
          const marker = document.createComment("k:" + key);
          const effs = [];
          parent.insertBefore(marker, ref);
          const tail = endAnchor.previousSibling;
          createItem(newItems[i], i, effs, null);
          let n = tail ? tail.nextSibling : parent.firstChild;
          const added = [];
          while (n && n !== endAnchor) {
            added.push(n);
            n = n.nextSibling;
          }
          for (const node of added) parent.insertBefore(node, ref);
          map.set(key, { marker, effs });
          ref = marker;
        }
      }
    };
  }
  function reconcileHydrated(anchor, endAnchor, items, keyFn, createItem, walker, parent, skipK = 0) {
    let claimWalker = walker;
    const layout = walker;
    const scope2 = layout.scopeToRegion;
    const parentIsElement = parent && parent.nodeType === 1;
    if (scope2 && parentIsElement && layout.root !== parent) {
      claimWalker = scope2.call(walker, parent);
    }
    if (globalThis.__vesk_hydrate_debug) {
      console.error("[hyd-dbg] reconcileHydrated items=", items.length, "scoped=", claimWalker !== walker, "parent=<", parent && parent.nodeName, ">", "hasClaim=", !!claimWalker.claimByKey, "walkerType=", walker.constructor && walker.constructor.name);
    }
    const claimed = /* @__PURE__ */ new Map();
    for (let i = 0; i < items.length; i++) {
      const key = keyFn(items[i], i);
      if (claimed.has(key)) continue;
      const c = claimWalker.claimByKey ? claimWalker.claimByKey(key, { relocate: true, skipK: i === 0 ? skipK : 0 }) : null;
      if (c) claimed.set(key, c.el);
    }
    const orderedEls = [];
    for (let i = 0; i < items.length; i++) {
      const el = claimed.get(keyFn(items[i], i));
      if (el && !orderedEls.includes(el)) orderedEls.push(el);
    }
    if (orderedEls.length > 0) {
      parent.insertBefore(anchor, orderedEls[0]);
      const last = orderedEls[orderedEls.length - 1];
      parent.insertBefore(endAnchor, last.nextSibling);
    } else {
      parent.appendChild(anchor);
      parent.appendChild(endAnchor);
    }
    return reconcile(anchor, endAnchor, items, keyFn, createItem, (key) => {
      const el = claimed.get(key);
      return el ? { el } : null;
    });
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
    for (const node of nodes) parent.insertBefore(node, ref);
  }

  // packages/runtime/src/form.ts
  function appendChildren2(parent, children) {
    if (children == null) return;
    if (typeof children === "string" || typeof children === "number") {
      parent.insertAdjacentHTML("beforeend", String(children));
    } else if (children instanceof Node) {
      parent.appendChild(children);
    } else if (Array.isArray(children)) {
      for (const c of children) appendChildren2(parent, c);
    }
  }
  function formIsSSR() {
    return typeof document === "undefined";
  }
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function actionUrl(action) {
    if (typeof action === "string") return action;
    if (action && typeof action === "object") {
      const a = action;
      if (a.__veskAction === true || typeof a.url === "string") return String(a.url || "");
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
  function Field(props, registry, hydrate2) {
    const { name, label, rules = [], children, errorClass, class: className, style, ...rest } = props;
    if (formIsSSR()) {
      const labelHtml = label ? `<label>${escapeHtml(String(label))}</label>` : "";
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
    if (hydrate2 && hydrate2.nextElement) {
      let wrapper2 = hydrate2.nextElement("div");
      if (wrapper2 && !wrapper2.parentNode && hydrate2.root) {
        const existing = hydrate2.root.querySelector(`[data-vsk-field="${name}"]`);
        if (existing) wrapper2 = existing;
      }
      const inner = wrapper2 ? wrapper2.querySelector(`[data-vsk-field="${name}"]`) : null;
      const fieldEl = inner || wrapper2;
      if (fieldEl) fieldEl.__vsk_rules = rules;
      return document.createDocumentFragment();
    }
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-vsk-field", name);
    if (className) wrapper.className = className;
    if (style) wrapper.style.cssText = style;
    for (const [k, v] of Object.entries(rest)) {
      if (v != null && v !== false) wrapper.setAttribute(k, v === true ? "" : String(v));
    }
    wrapper.__vsk_rules = rules;
    if (label) {
      const lbl = document.createElement("label");
      lbl.textContent = label;
      wrapper.appendChild(lbl);
    }
    if (children) appendChildren2(wrapper, children);
    const errEl = document.createElement("div");
    errEl.setAttribute("data-vsk-error", "");
    errEl.style.display = "none";
    if (errorClass) errEl.className = errorClass;
    wrapper.appendChild(errEl);
    return wrapper;
  }
  function bindFormSubmit(form, { action, method, onSubmit, onError, onSuccess }) {
    const resolvedAction = actionUrl(action);
    const actionSchema = typeof action === "object" && action !== null && action.input ? action.input : void 0;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const obj = {};
      for (const [k, v] of data.entries()) {
        if (k in obj) {
          if (!Array.isArray(obj[k])) obj[k] = [obj[k]];
          obj[k].push(v);
        } else {
          obj[k] = v;
        }
      }
      const fields = form.querySelectorAll("[data-vsk-field]");
      let hasErrors = false;
      for (const el of fields) {
        const fieldName = el.getAttribute("data-vsk-field");
        const propRules = el.__vsk_rules || [];
        const schemaRules = fieldName && actionSchema && actionSchema[fieldName] ? Array.isArray(actionSchema[fieldName]) ? actionSchema[fieldName] : [actionSchema[fieldName]] : [];
        const rules = [...propRules, ...schemaRules];
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
        if (errMsg) hasErrors = true;
      }
      if (hasErrors) {
        form.dispatchEvent(new CustomEvent("vsk-error", { detail: { errors: true } }));
        return;
      }
      form.classList.add("vsk-submitting");
      const submitBtn = form.querySelector('[type="submit"], button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      form.dispatchEvent(new CustomEvent("vsk-loading", { detail: { loading: true } }));
      const isActionDescriptor = typeof action === "object" && action !== null;
      try {
        if (onSubmit) {
          const result = onSubmit(obj, form);
          if (result && typeof result.then === "function") await result;
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
              if (msg) hasServerErrors = true;
            }
            if (hasServerErrors) {
              form.dispatchEvent(new CustomEvent("vsk-error", { detail: { issues: payload.issues } }));
              return;
            }
          }
          if (!res.ok) throw res;
          form.dispatchEvent(new CustomEvent("vsk-success", { detail: { response: res, data: payload } }));
          if (onSuccess) onSuccess(res);
        } else if (resolvedAction) {
          const res = await fetch(resolvedAction, { method, body: data });
          if (!res.ok) throw res;
          form.dispatchEvent(new CustomEvent("vsk-success", { detail: { response: res } }));
          if (onSuccess) onSuccess(res);
        }
      } catch (err) {
        form.dispatchEvent(new CustomEvent("vsk-error", { detail: { error: err } }));
        if (onError) onError(err);
      } finally {
        if (submitBtn) submitBtn.disabled = false;
        form.classList.remove("vsk-submitting");
        form.dispatchEvent(new CustomEvent("vsk-loading", { detail: { loading: false } }));
      }
    });
  }
  function Form(props, registry, hydrate2) {
    const { children, onSubmit, onError, onSuccess, action, method = "POST", class: className, style, ...rest } = props;
    if (formIsSSR()) {
      const attrs = { action: actionUrl(action), method, novalidate: true };
      if (className) attrs.class = className;
      if (style) attrs.style = style;
      for (const [k, v] of Object.entries(rest)) {
        if (v != null && v !== false) attrs[k] = v;
      }
      const attrStr = Object.entries(attrs).filter(([, v]) => v != null && v !== false).map(([k, v]) => v === true ? k : `${k}="${String(v).replace(/"/g, "&quot;")}"`).join(" ");
      return `<form ${attrStr}>${children || ""}</form>`;
    }
    if (hydrate2 && hydrate2.nextElement) {
      const skipK = typeof hydrate2.takeSkipK === "function" ? hydrate2.takeSkipK() : 0;
      let form2 = hydrate2.nextElement("form", skipK);
      if (form2 && !form2.parentNode && hydrate2.root) {
        const existing = hydrate2.root.querySelector("form");
        if (existing) form2 = existing;
      }
      if (form2) {
        form2.noValidate = true;
        bindFormSubmit(form2, { action, method, onSubmit, onError, onSuccess });
      }
      return document.createDocumentFragment();
    }
    const form = document.createElement("form");
    const resolvedAction = actionUrl(action);
    if (resolvedAction) form.action = resolvedAction;
    if (method) form.method = method;
    form.noValidate = true;
    if (className) form.className = className;
    if (style) form.style.cssText = style;
    for (const [k, v] of Object.entries(rest)) {
      if (typeof v === "string") form.setAttribute(k, v);
    }
    if (children) appendChildren2(form, children);
    bindFormSubmit(form, { action, method, onSubmit, onError, onSuccess });
    return form;
  }

  // packages/runtime/src/md.ts
  function unwrapMaybeCell(v) {
    if (v !== null && typeof v === "object" && typeof v.get === "function") {
      try {
        return v.get();
      } catch {
        return v;
      }
    }
    return v;
  }
  function isCell(v) {
    return v !== null && typeof v === "object" && typeof v.get === "function";
  }
  function escapeHtml2(s) {
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === "&") out += "&amp;";
      else if (ch === "<") out += "&lt;";
      else if (ch === ">") out += "&gt;";
      else if (ch === '"') out += "&quot;";
      else out += ch;
    }
    return out;
  }
  function isBlank(line) {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch !== " " && ch !== "	") return false;
    }
    return true;
  }
  function leadingSpaces(line) {
    let n = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "	") n += 4 - n % 4;
      else if (line[i] === " ") n++;
      else break;
    }
    return n;
  }
  function headingLevel(line) {
    let n = 0;
    while (n < line.length && line[n] === "#") n++;
    if (n === 0 || n > 6) return 0;
    if (n < line.length && (line[n] === " " || line[n] === "	")) return n;
    return 0;
  }
  function isHr(line) {
    const t = line.trim();
    if (t.length < 3) return false;
    const ch = t[0];
    if (ch !== "-" && ch !== "*" && ch !== "_") return false;
    for (let i = 1; i < t.length; i++) {
      if (t[i] !== ch && t[i] !== " ") return false;
    }
    return true;
  }
  function fenceInfo(line) {
    const t = line.trim();
    const ch = t[0];
    if (ch !== "`" && ch !== "~") return null;
    let n = 0;
    while (n < t.length && t[n] === ch) n++;
    if (n < 3) return null;
    return { char: ch, len: n, info: t.slice(n).trim() };
  }
  function fenceLang(info) {
    let i = 0;
    while (i < info.length && info[i] !== " " && info[i] !== "	") i++;
    return info.slice(0, i).toLowerCase();
  }
  function parseFenceMeta(info) {
    const tokens = [];
    let cur = "";
    let depth = 0;
    for (let i = 0; i < info.length; i++) {
      const ch = info[i];
      if (ch === "(") depth++;
      if (ch === ")") depth = Math.max(0, depth - 1);
      if ((ch === " " || ch === "	") && depth === 0) {
        if (cur) {
          tokens.push(cur);
          cur = "";
        }
        continue;
      }
      cur += ch;
    }
    if (cur) tokens.push(cur);
    const lang = tokens.length > 0 ? tokens[0].toLowerCase() : "";
    const params = {};
    for (let k = 1; k < tokens.length; k++) {
      const eq = tokens[k].indexOf("=");
      if (eq === -1) continue;
      const key = tokens[k].slice(0, eq).toLowerCase();
      let val = tokens[k].slice(eq + 1);
      if (val.startsWith('"') && val.endsWith('"') || val.startsWith("'") && val.endsWith("'")) {
        val = val.slice(1, -1);
      }
      if (key) params[key] = val;
    }
    return { lang, params };
  }
  var COLOR_FUNCS = /* @__PURE__ */ new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix"]);
  function safeColorValue(v) {
    if (v === "" || v.length > 64) return null;
    const out = [];
    let word = "";
    for (const ch of v) {
      const ok = ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z" || ch >= "0" && ch <= "9" || ch === "#" || ch === "%" || ch === "(" || ch === ")" || ch === "," || ch === "." || ch === "-" || ch === " ";
      if (!ok) return null;
      if (isIdentStart(ch) || isDigit(ch)) word += ch.toLowerCase();
      if (ch === "(") {
        const fnName = word.slice(0, -1);
        if (!COLOR_FUNCS.has(fnName)) return null;
      }
      if (!isIdentPart(ch)) word = "";
      out.push(ch);
    }
    return out.join("").trim() || null;
  }
  function isFenceClose(line, char, len) {
    const t = line.trim();
    if (t[0] !== char) return false;
    let n = 0;
    while (n < t.length && t[n] === char) n++;
    if (n < len) return false;
    for (let i = n; i < t.length; i++) {
      if (t[i] !== " ") return false;
    }
    return true;
  }
  function parseListMarker(line) {
    const indent = leadingSpaces(line);
    let i = indent;
    const ch = line[i];
    if (ch === "-" || ch === "*" || ch === "+") {
      if (i + 1 < line.length && (line[i + 1] === " " || line[i + 1] === "	")) {
        return { ordered: false, number: 0, indent, contentStart: i + 2 };
      }
      return null;
    }
    let num = 0;
    const digitsStart = i;
    while (i < line.length && line[i] >= "0" && line[i] <= "9") {
      num = num * 10 + (line.charCodeAt(i) - 48);
      i++;
    }
    if (i === digitsStart) return null;
    if (i < line.length && line[i] === "." && i + 1 < line.length && (line[i + 1] === " " || line[i + 1] === "	")) {
      return { ordered: true, number: num, indent, contentStart: i + 2 };
    }
    return null;
  }
  function splitTableRow(line) {
    const t = line.trim();
    if (t.length === 0) return null;
    let start = 0;
    let end = t.length;
    if (t[0] === "|") start = 1;
    if (t[end - 1] === "|" && end - 1 > 0 && t[end - 2] !== "\\") end--;
    const cells = [];
    let cell = "";
    let i = start;
    while (i < end) {
      const ch = t[i];
      if (ch === "\\" && i + 1 < end && (t[i + 1] === "|" || t[i + 1] === "\\")) {
        cell += t[i + 1];
        i += 2;
        continue;
      }
      if (ch === "|") {
        cells.push(cell.trim());
        cell = "";
        i++;
        continue;
      }
      cell += ch;
      i++;
    }
    cells.push(cell.trim());
    return cells;
  }
  function isTableSepRow(line) {
    const t = line.trim();
    if (t.length < 3) return false;
    let sawDash = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === "-") {
        sawDash = true;
        continue;
      }
      if (ch === ":" || ch === "|" || ch === " " || ch === "	") continue;
      return false;
    }
    return sawDash;
  }
  function parseAlignRow(cells) {
    const out = [];
    for (const c of cells) {
      const left = c.startsWith(":");
      const right = c.endsWith(":") && c.length > (left ? 1 : 0);
      if (left && right) out.push("center");
      else if (right) out.push("right");
      else if (left) out.push("left");
      else out.push(null);
    }
    return out;
  }
  function looksLikeTable(lines, i) {
    const row = lines[i].trim();
    if (!row.includes("|")) return false;
    if (row[0] !== "|" && !row.includes(" | ") && !(row.length > 1 && row[row.length - 1] === "|")) {
      if (!row.startsWith("|")) return false;
    }
    const sep = lines[i + 1];
    if (sep === void 0) return false;
    if (!isTableSepRow(sep)) return false;
    if (!sep.includes("|") && row.includes("|")) {
    }
    return true;
  }
  function setextLevel(line) {
    const t = line.trim();
    if (t.length === 0) return 0;
    let allEq = true;
    let allDash = true;
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== "=") allEq = false;
      if (t[i] !== "-") allDash = false;
      if (!allEq && !allDash) return 0;
    }
    if (allEq) return 1;
    if (allDash) return 2;
    return 0;
  }
  function parseBlocks(lines) {
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        i++;
        continue;
      }
      const trimmed = line.trim();
      const indent = leadingSpaces(line);
      const fence = fenceInfo(trimmed);
      if (fence) {
        const codeLines = [];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (isFenceClose(l, fence.char, fence.len)) {
            i++;
            break;
          }
          codeLines.push(l);
          i++;
        }
        blocks.push({ type: "code", code: codeLines.join("\n"), lang: fenceLang(fence.info), info: fence.info });
        continue;
      }
      if (indent >= 4) {
        const codeLines = [];
        while (i < lines.length) {
          const l = lines[i];
          if (isBlank(l)) {
            codeLines.push("");
            i++;
            continue;
          }
          const lIndent = leadingSpaces(l);
          if (lIndent < 4) break;
          codeLines.push(l.slice(4));
          i++;
        }
        while (codeLines.length > 0 && codeLines[codeLines.length - 1] === "") codeLines.pop();
        blocks.push({ type: "code", code: codeLines.join("\n"), lang: "", info: "" });
        continue;
      }
      const level = headingLevel(line);
      if (level > 0) {
        blocks.push({ type: "heading", level, text: line.slice(level).trim() });
        i++;
        continue;
      }
      if (isHr(line)) {
        blocks.push({ type: "hr" });
        i++;
        continue;
      }
      if (looksLikeTable(lines, i)) {
        const head = splitTableRow(lines[i]) || [];
        const sepCells = splitTableRow(lines[i + 1]) || [];
        if (sepCells.length !== head.length) {
          blocks.push({ type: "paragraph", text: trimmed });
          i++;
          continue;
        }
        const align = parseAlignRow(sepCells);
        i += 2;
        const rows = [];
        while (i < lines.length) {
          const l = lines[i];
          if (isBlank(l)) break;
          if (!l.includes("|")) break;
          const cells = splitTableRow(l);
          if (!cells) break;
          rows.push(cells);
          i++;
        }
        blocks.push({ type: "table", head, align, rows });
        continue;
      }
      if (trimmed[0] === ">") {
        const quoteLines = [];
        while (i < lines.length) {
          const l = lines[i];
          const t = l.trim();
          if (isBlank(l)) break;
          if (t[0] !== ">") break;
          let rest = t.length > 1 ? t.slice(1) : "";
          if (rest[0] === " ") rest = rest.slice(1);
          quoteLines.push(rest);
          i++;
        }
        blocks.push({ type: "blockquote", blocks: parseBlocks(quoteLines) });
        continue;
      }
      const marker = parseListMarker(line);
      if (marker) {
        const list = {
          type: "list",
          ordered: marker.ordered,
          start: marker.number,
          items: []
        };
        while (i < lines.length) {
          const l = lines[i];
          const m = parseListMarker(l);
          if (!m) break;
          if (m.ordered !== list.ordered) break;
          const contentIndent = m.contentStart;
          let first = l.slice(m.contentStart);
          let task = null;
          if (first.startsWith("[ ] ")) {
            task = false;
            first = first.slice(4);
          } else if (first.startsWith("[x] ") || first.startsWith("[X] ")) {
            task = true;
            first = first.slice(4);
          }
          const itemLines = [first];
          i++;
          while (i < lines.length) {
            const c = lines[i];
            if (isBlank(c)) {
              i++;
              continue;
            }
            const cm = parseListMarker(c);
            const cIndent = leadingSpaces(c);
            if (cm && cIndent < contentIndent && cm.ordered === m.ordered) break;
            if (cIndent >= contentIndent) {
              itemLines.push(c.slice(Math.min(c.length, contentIndent)));
              i++;
              continue;
            }
            break;
          }
          list.items.push({ blocks: parseBlocks(itemLines), task });
        }
        blocks.push(list);
        continue;
      }
      const paraLines = [line.slice(leadingSpaces(line))];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (isBlank(l)) break;
        const t = l.trim();
        if (setextLevel(t) > 0) break;
        if (headingLevel(l) > 0) break;
        if (isHr(l)) break;
        if (fenceInfo(t)) break;
        if (t[0] === ">") break;
        if (parseListMarker(l)) break;
        if (leadingSpaces(l) >= 4) break;
        paraLines.push(l.slice(leadingSpaces(l)));
        i++;
      }
      const joined = paraLines.join(" ");
      if (i < lines.length && paraLines.length > 0) {
        const lv = setextLevel(lines[i].trim());
        if (lv > 0) {
          blocks.push({ type: "heading", level: lv, text: joined });
          i++;
          continue;
        }
      }
      blocks.push({ type: "paragraph", text: joined, lines: paraLines });
    }
    return blocks;
  }
  var SAFE_SCHEMES = ["http:", "https:", "mailto:", "tel:"];
  function sanitizeUrl(url) {
    const u = url.trim();
    if (u === "") return "#";
    for (let i = 0; i < u.length; i++) {
      const ch = u[i];
      if (ch === ":") {
        const scheme = u.slice(0, i + 1).toLowerCase();
        for (const s of SAFE_SCHEMES) {
          if (scheme === s) return u;
        }
        return "#";
      }
      if (ch === "/" || ch === "?" || ch === "#" || ch === "&") break;
    }
    return u;
  }
  function normalizeRefLabel(label) {
    return label.trim().toLowerCase();
  }
  function parseRefDefinitionLine(rawLine) {
    const line = rawLine.trim();
    if (line.length < 4 || line[0] !== "[") return null;
    let depth = 1;
    let j = 1;
    while (j < line.length) {
      const c = line[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "[") depth++;
      else if (c === "]") {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    if (j >= line.length || line[j] !== "]") return null;
    const label = line.slice(1, j);
    if (label.trim() === "") return null;
    if (line[j + 1] !== ":") return null;
    let rest = line.slice(j + 2);
    while (rest.length > 0 && (rest[0] === " " || rest[0] === "	")) rest = rest.slice(1);
    if (rest === "") return null;
    let dest;
    if (rest[0] === "<") {
      const close = rest.indexOf(">");
      if (close === -1) return null;
      dest = rest.slice(1, close);
      rest = rest.slice(close + 1);
      if (dest.includes("<")) return null;
    } else {
      let e = 0;
      while (e < rest.length && rest[e] !== " " && rest[e] !== "	") e++;
      dest = rest.slice(0, e);
      rest = rest.slice(e);
    }
    if (dest === "") return null;
    let title = "";
    const trimmedRest = rest.trim();
    if (trimmedRest !== "") {
      const open = trimmedRest[0];
      if (open !== '"' && open !== "'" && open !== "(") return null;
      const close = open === "(" ? ")" : open;
      let m = 1;
      const titleChars = [];
      let closed = false;
      while (m < trimmedRest.length) {
        const c = trimmedRest[m];
        if (c === "\\" && m + 1 < trimmedRest.length) {
          titleChars.push(trimmedRest[m + 1]);
          m += 2;
          continue;
        }
        if (c === close) {
          closed = true;
          m++;
          break;
        }
        titleChars.push(c);
        m++;
      }
      if (!closed) return null;
      while (m < trimmedRest.length && (trimmedRest[m] === " " || trimmedRest[m] === "	")) m++;
      if (m < trimmedRest.length) return null;
      title = titleChars.join("");
    }
    return { label, def: { url: dest, title } };
  }
  function extractRefDefinitions(lines) {
    const defs = /* @__PURE__ */ new Map();
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fence = fenceInfo(line.trim());
      if (fence) {
        out.push(line);
        i++;
        while (i < lines.length) {
          out.push(lines[i]);
          const isClose = isFenceClose(lines[i], fence.char, fence.len);
          i++;
          if (isClose) break;
        }
        continue;
      }
      const parsed = parseRefDefinitionLine(line);
      if (parsed && !defs.has(normalizeRefLabel(parsed.label))) {
        defs.set(normalizeRefLabel(parsed.label), parsed.def);
        i++;
        continue;
      }
      out.push(line);
      i++;
    }
    return { lines: out, defs };
  }
  var KW_JS = /* @__PURE__ */ new Set([
    "abstract",
    "as",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "declare",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "finally",
    "for",
    "from",
    "function",
    "get",
    "if",
    "implements",
    "import",
    "in",
    "infer",
    "instanceof",
    "interface",
    "is",
    "keyof",
    "let",
    "namespace",
    "new",
    "of",
    "private",
    "protected",
    "public",
    "readonly",
    "return",
    "satisfies",
    "set",
    "static",
    "super",
    "switch",
    "this",
    "throw",
    "try",
    "type",
    "typeof",
    "var",
    "void",
    "while",
    "with",
    "yield",
    "string",
    "number",
    "boolean",
    "any",
    "unknown",
    "never",
    "object",
    "symbol",
    "bigint"
  ]);
  var KW_VSK = /* @__PURE__ */ new Set([...KW_JS, "component"]);
  var LIT_JS = /* @__PURE__ */ new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);
  var KW_PY = /* @__PURE__ */ new Set([
    "and",
    "as",
    "assert",
    "async",
    "await",
    "break",
    "class",
    "continue",
    "def",
    "del",
    "elif",
    "else",
    "except",
    "finally",
    "for",
    "from",
    "global",
    "if",
    "import",
    "in",
    "is",
    "lambda",
    "nonlocal",
    "not",
    "or",
    "pass",
    "raise",
    "return",
    "try",
    "while",
    "with",
    "yield",
    "match",
    "case"
  ]);
  var LIT_PY = /* @__PURE__ */ new Set(["True", "False", "None", "self", "cls"]);
  var KW_GO = /* @__PURE__ */ new Set([
    "break",
    "case",
    "chan",
    "const",
    "continue",
    "default",
    "defer",
    "else",
    "fallthrough",
    "for",
    "func",
    "go",
    "goto",
    "if",
    "import",
    "interface",
    "map",
    "package",
    "range",
    "return",
    "select",
    "struct",
    "switch",
    "type",
    "var"
  ]);
  var LIT_GO = /* @__PURE__ */ new Set(["true", "false", "nil", "iota"]);
  var KW_RUST = /* @__PURE__ */ new Set([
    "as",
    "async",
    "await",
    "break",
    "const",
    "continue",
    "crate",
    "dyn",
    "else",
    "enum",
    "extern",
    "fn",
    "for",
    "if",
    "impl",
    "in",
    "let",
    "loop",
    "match",
    "mod",
    "move",
    "mut",
    "pub",
    "ref",
    "return",
    "self",
    "Self",
    "static",
    "struct",
    "super",
    "trait",
    "type",
    "unsafe",
    "use",
    "where",
    "while"
  ]);
  var LIT_RUST = /* @__PURE__ */ new Set(["true", "false", "None", "Some", "Ok", "Err"]);
  var KW_SQL = /* @__PURE__ */ new Set([
    "select",
    "from",
    "where",
    "insert",
    "into",
    "values",
    "update",
    "set",
    "delete",
    "create",
    "table",
    "drop",
    "alter",
    "add",
    "column",
    "primary",
    "key",
    "foreign",
    "references",
    "join",
    "inner",
    "left",
    "right",
    "outer",
    "full",
    "on",
    "group",
    "by",
    "order",
    "having",
    "limit",
    "offset",
    "union",
    "all",
    "distinct",
    "as",
    "and",
    "or",
    "not",
    "null",
    "is",
    "in",
    "between",
    "like",
    "exists",
    "case",
    "when",
    "then",
    "else",
    "end",
    "index",
    "view",
    "with",
    "returning"
  ]);
  var KW_BASH = /* @__PURE__ */ new Set([
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "while",
    "until",
    "do",
    "done",
    "case",
    "esac",
    "in",
    "function",
    "return",
    "local",
    "export",
    "source",
    "alias",
    "set",
    "unset",
    "shift",
    "read",
    "echo",
    "cd",
    "exit",
    "trap"
  ]);
  function kwSet(items) {
    return new Set(items);
  }
  function profileFor(lang) {
    if (lang === "") return null;
    if (lang === "vsk" || lang === "vesk") {
      return { keywords: KW_VSK, literals: LIT_JS, lineComments: ["//"], blockComments: [["/*", "*/"]], strings: ['"', "'", "`"] };
    }
    if (lang === "js" || lang === "javascript" || lang === "mjs" || lang === "cjs" || lang === "ts" || lang === "typescript" || lang === "tsx" || lang === "jsx") {
      return { keywords: KW_JS, literals: LIT_JS, lineComments: ["//"], blockComments: [["/*", "*/"]], strings: ['"', "'", "`"] };
    }
    if (lang === "json" || lang === "jsonc" || lang === "json5") {
      return { keywords: /* @__PURE__ */ new Set(), literals: LIT_JS, lineComments: lang === "json" ? [] : ["//"], blockComments: lang === "json" ? [] : [["/*", "*/"]], strings: ['"'] };
    }
    if (lang === "py" || lang === "python") {
      return { keywords: KW_PY, literals: LIT_PY, lineComments: ["#"], strings: ['"', "'"] };
    }
    if (lang === "go") {
      return { keywords: KW_GO, literals: LIT_GO, lineComments: ["//"], blockComments: [["/*", "*/"]], strings: ['"', "'", "`"] };
    }
    if (lang === "rs" || lang === "rust") {
      return { keywords: KW_RUST, literals: LIT_RUST, lineComments: ["//"], blockComments: [["/*", "*/"]], strings: ['"'] };
    }
    if (lang === "sql" || lang === "postgres" || lang === "mysql" || lang === "sqlite") {
      return { keywords: KW_SQL, lineComments: ["--"], blockComments: [["/*", "*/"]], strings: ["'"] };
    }
    if (lang === "sh" || lang === "bash" || lang === "shell" || lang === "zsh") {
      return { keywords: KW_BASH, literals: /* @__PURE__ */ new Set(["true", "false"]), lineComments: ["#"], strings: ['"', "'"] };
    }
    if (lang === "yaml" || lang === "yml" || lang === "toml") {
      return { keywords: /* @__PURE__ */ new Set(), literals: LIT_PY, lineComments: ["#"], strings: ['"', "'"], highlightHashComment: true };
    }
    if (lang === "java" || lang === "kt" || lang === "kotlin" || lang === "swift" || lang === "c" || lang === "cpp" || lang === "cs" || lang === "csharp" || lang === "php" || lang === "dart" || lang === "scala" || lang === "zig") {
      return { keywords: kwSet(["abstract", "boolean", "break", "byte", "case", "catch", "char", "class", "const", "continue", "default", "do", "double", "else", "enum", "extends", "final", "finally", "float", "for", "fun", "func", "if", "implements", "import", "in", "instanceof", "int", "interface", "is", "let", "long", "namespace", "new", "null", "override", "package", "private", "protected", "public", "return", "short", "signed", "static", "struct", "super", "switch", "synchronized", "template", "this", "throw", "throws", "trait", "try", "type", "typedef", "typeof", "union", "unsigned", "val", "var", "void", "volatile", "when", "where", "while", "using", "public", "ref", "fn", "impl"]), literals: LIT_JS, lineComments: ["//"], blockComments: [["/*", "*/"]], strings: ['"', "'"] };
    }
    return null;
  }
  function isIdentStart(ch) {
    return ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z" || ch === "_" || ch === "$";
  }
  function isIdentPart(ch) {
    return isIdentStart(ch) || ch >= "0" && ch <= "9";
  }
  function isDigit(ch) {
    return ch >= "0" && ch <= "9";
  }
  function isHexDigit(ch) {
    return isDigit(ch) || ch >= "a" && ch <= "f" || ch >= "A" && ch <= "F";
  }
  function highlightCode(code, lang) {
    if (lang === "diff" || lang === "patch") return highlightDiff(code);
    if (lang === "css" || lang === "scss" || lang === "less" || lang === "postcss") return highlightCss(code);
    if (lang === "html" || lang === "xml" || lang === "svg" || lang === "vue" || lang === "svelte") return highlightHtml(code);
    const p = profileFor(lang);
    if (!p) return escapeHtml2(code);
    let out = "";
    let i = 0;
    const n = code.length;
    let prevKw = null;
    const emit = (cls, text) => {
      out += `<span class="tok-${cls}">${escapeHtml2(text)}</span>`;
    };
    while (i < n) {
      const ch = code[i];
      let matchedLine = false;
      if (p.lineComments) {
        for (const lc of p.lineComments) {
          if (code.startsWith(lc, i)) {
            let j = i;
            while (j < n && code[j] !== "\n") j++;
            emit("com", code.slice(i, j));
            i = j;
            matchedLine = true;
            break;
          }
        }
      }
      if (matchedLine) continue;
      let matchedBlock = false;
      if (p.blockComments) {
        for (const [open, close] of p.blockComments) {
          if (code.startsWith(open, i)) {
            const endIdx = code.indexOf(close, i + open.length);
            const j = endIdx === -1 ? n : endIdx + close.length;
            emit("com", code.slice(i, j));
            i = j;
            matchedBlock = true;
            break;
          }
        }
      }
      if (matchedBlock) continue;
      let matchedStr = false;
      if (p.strings) {
        for (const q of p.strings) {
          if (ch === q) {
            let j = i + 1;
            while (j < n) {
              if (code[j] === "\\") {
                j += 2;
                continue;
              }
              if (code[j] === q) {
                j++;
                break;
              }
              if (code[j] === "\n" && q !== "`") {
                break;
              }
              j++;
            }
            emit("str", code.slice(i, j));
            i = j;
            matchedStr = true;
            break;
          }
        }
      }
      if (matchedStr) continue;
      if (isDigit(ch) || ch === "." && i + 1 < n && isDigit(code[i + 1])) {
        let j = i;
        while (j < n && (isDigit(code[j]) || code[j] === "." || code[j] === "_" || (code[j] === "x" || code[j] === "b" || code[j] === "o") && (j === i + 1 && code[i] === "0") || (code[j] === "e" || code[j] === "E") && j > i && (isDigit(code[j - 1]) || code[j - 1] === ".") || (code[j] === "+" || code[j] === "-") && j > i && (code[j - 1] === "e" || code[j - 1] === "E"))) j++;
        emit("num", code.slice(i, j));
        i = j;
        continue;
      }
      if (isIdentStart(ch)) {
        let j = i;
        while (j < n && isIdentPart(code[j])) j++;
        const word = code.slice(i, j);
        let k = j;
        while (k < n && (code[k] === " " || code[k] === "	")) k++;
        const isProp = code[k] === ":" || code[k] === "?" && code[k + 1] === ":";
        const isTypeName = prevKw === "type" || prevKw === "interface";
        if (p.keywords.has(word)) {
          emit("kw", word);
          prevKw = word === "type" || word === "interface" ? word : null;
        } else if (p.literals && p.literals.has(word)) {
          emit("lit", word);
          prevKw = null;
        } else if (code[k] === "(") {
          emit("fn", word);
          prevKw = null;
        } else if (isTypeName) {
          emit("fn", word);
          prevKw = null;
        } else if (isProp) {
          emit("prop", word);
          prevKw = null;
        } else {
          emit("txt", word);
          prevKw = null;
        }
        i = j;
        continue;
      } else {
        if (ch !== " " && ch !== "	" && ch !== "\n") prevKw = null;
      }
      if (ch === "\n") {
        out += "\n";
        i++;
        continue;
      }
      if (ch === " " || ch === "	") {
        out += ch;
        i++;
        continue;
      }
      out += escapeHtml2(ch);
      i++;
    }
    return out;
  }
  function highlightDiff(code) {
    const lines = code.split("\n");
    let out = "";
    for (const line of lines) {
      let cls = "txt";
      if (line.startsWith("+") && !line.startsWith("+++")) cls = "add";
      else if (line.startsWith("-") && !line.startsWith("---")) cls = "del";
      else if (line.startsWith("@@")) cls = "kw";
      else if (line.startsWith("diff ") || line.startsWith("index ")) cls = "com";
      out += `<span class="tok-${cls}">${escapeHtml2(line)}</span>
`;
    }
    return out;
  }
  function highlightCss(code) {
    let out = "";
    let i = 0;
    const n = code.length;
    const emit = (cls, text) => {
      out += `<span class="tok-${cls}">${escapeHtml2(text)}</span>`;
    };
    let inProp = false;
    while (i < n) {
      const ch = code[i];
      if (code.startsWith("/*", i)) {
        const end = code.indexOf("*/", i + 2);
        const j = end === -1 ? n : end + 2;
        emit("com", code.slice(i, j));
        i = j;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < n) {
          if (code[j] === "\\") {
            j += 2;
            continue;
          }
          if (code[j] === ch) {
            j++;
            break;
          }
          j++;
        }
        emit("str", code.slice(i, j));
        i = j;
        continue;
      }
      if (ch === "#" && isHexDigit(code[i + 1] || "")) {
        let j = i + 1;
        while (j < n && isHexDigit(code[j])) j++;
        emit("num", code.slice(i, j));
        i = j;
        continue;
      }
      if (ch === "@" && isIdentStart(code[i + 1] || "")) {
        let j = i + 1;
        while (j < n && (isIdentPart(code[j]) || code[j] === "-")) j++;
        emit("kw", code.slice(i, j));
        i = j;
        continue;
      }
      if (isDigit(ch) || ch === "." && isDigit(code[i + 1] || "")) {
        let j = i;
        while (j < n && (isDigit(code[j]) || code[j] === "." || code[j] === "%" || isIdentPart(code[j]))) j++;
        emit("num", code.slice(i, j));
        inProp = false;
        i = j;
        continue;
      }
      if (isIdentStart(ch)) {
        let j = i;
        while (j < n && (isIdentPart(code[j]) || code[j] === "-")) j++;
        const word = code.slice(i, j);
        let k = j;
        while (k < n && code[k] === " ") k++;
        if (code[k] === ":" && code[k + 1] !== ":") {
          emit("prop", word);
          inProp = true;
        } else if (inProp) emit("txt", word);
        else if (word.startsWith("--")) emit("prop", word);
        else emit("sel", word);
        i = j;
        continue;
      }
      if (ch === "{" || ch === "}") {
        inProp = false;
        out += escapeHtml2(ch);
        i++;
        continue;
      }
      if (ch === ":") {
        inProp = true;
        out += escapeHtml2(ch);
        i++;
        continue;
      }
      if (ch === ";") {
        inProp = false;
        out += escapeHtml2(ch);
        i++;
        continue;
      }
      out += escapeHtml2(ch);
      i++;
    }
    return out;
  }
  function highlightHtml(code) {
    let out = "";
    let i = 0;
    const n = code.length;
    const emit = (cls, text) => {
      out += `<span class="tok-${cls}">${escapeHtml2(text)}</span>`;
    };
    while (i < n) {
      if (code.startsWith("<!--", i)) {
        const end = code.indexOf("-->", i + 4);
        const j2 = end === -1 ? n : end + 3;
        emit("com", code.slice(i, j2));
        i = j2;
        continue;
      }
      if (code[i] === "<") {
        let j2 = i + 1;
        if (code[j2] === "/") j2++;
        const nameStart = j2;
        while (j2 < n && (isIdentPart(code[j2]) || code[j2] === "-")) j2++;
        emit("kw", code.slice(i, j2));
        i = j2;
        while (i < n && code[i] !== ">") {
          if (code.startsWith("/>", i)) break;
          const ch = code[i];
          if (ch === '"' || ch === "'") {
            let k = i + 1;
            while (k < n && code[k] !== ch) k++;
            k = Math.min(k + 1, n);
            emit("str", code.slice(i, k));
            i = k;
            continue;
          }
          if (isIdentStart(ch) || ch === "-" || ch === ":") {
            let k = i;
            while (k < n && (isIdentPart(code[k]) || code[k] === "-" || code[k] === ":")) k++;
            emit(code[k] === "=" ? "attr" : "attr", code.slice(i, k));
            i = k;
            continue;
          }
          out += escapeHtml2(ch);
          i++;
        }
        if (code.startsWith("/>", i)) {
          out += escapeHtml2("/>");
          i += 2;
        } else if (i < n) {
          out += escapeHtml2(">");
          i++;
        }
        continue;
      }
      const next = code.indexOf("<", i);
      const j = next === -1 ? n : next;
      emit("txt", code.slice(i, j));
      i = j;
    }
    return out;
  }
  function stripMdMarkers(text) {
    let out = "";
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "`" || ch === "*" || ch === "_" || ch === "~") {
        i++;
        continue;
      }
      if (ch === "\\") {
        out += text[i + 1] || "";
        i += 2;
        continue;
      }
      if (ch === "[" || ch === "]") {
        i++;
        continue;
      }
      if (ch === "!") {
        i++;
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  }
  function slugify(text) {
    const plain = stripMdMarkers(text).toLowerCase().trim();
    let out = "";
    let lastDash = true;
    for (let i = 0; i < plain.length; i++) {
      const ch = plain[i];
      const ok = ch >= "a" && ch <= "z" || ch >= "0" && ch <= "9";
      if (ok) {
        out += ch;
        lastDash = false;
        continue;
      }
      if (!lastDash) {
        out += "-";
        lastDash = true;
      }
    }
    while (out.endsWith("-")) out = out.slice(0, -1);
    return out || "section";
  }
  function tryAutolink(text, i) {
    let schemeLen = -1;
    let prefix = "";
    if (text.startsWith("https://", i)) {
      schemeLen = 8;
      prefix = "";
    } else if (text.startsWith("http://", i)) {
      schemeLen = 7;
      prefix = "";
    } else if (text.startsWith("mailto:", i)) {
      schemeLen = 7;
      prefix = "";
    } else if (text.startsWith("www.", i) && (i === 0 || !isIdentPart(text[i - 1]))) {
      schemeLen = 0;
      prefix = "https://";
    }
    if (schemeLen === -1) return null;
    let j = i + schemeLen;
    let lastGood = j;
    let parenDepth = 0;
    while (j < text.length) {
      const ch = text[j];
      if (ch === " " || ch === "	" || ch === "<" || ch === '"' || ch === "'") break;
      if (ch === "(") parenDepth++;
      if (ch === ")") {
        if (parenDepth === 0) break;
        parenDepth--;
      }
      j++;
      if (!(ch === "." || ch === "," || ch === ";" || ch === "!" || ch === "?" || ch === ":")) lastGood = j;
    }
    if (lastGood === i + schemeLen && schemeLen === 0) return null;
    const raw = text.slice(i, lastGood);
    const href = prefix + raw;
    return { html: `<a href="${escapeHtml2(sanitizeUrl(href))}">${escapeHtml2(raw)}</a>`, end: lastGood };
  }
  var NAMED_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\xA0",
    copy: "\xA9",
    reg: "\xAE",
    trade: "\u2122",
    hellip: "\u2026",
    mdash: "\u2014",
    ndash: "\u2013",
    lsquo: "\u2018",
    rsquo: "\u2019",
    ldquo: "\u201C",
    rdquo: "\u201D",
    laquo: "\xAB",
    raquo: "\xBB",
    times: "\xD7",
    divide: "\xF7",
    plusmn: "\xB1",
    deg: "\xB0",
    middot: "\xB7",
    bull: "\u2022",
    dagger: "\u2020",
    sect: "\xA7",
    para: "\xB6",
    euro: "\u20AC",
    pound: "\xA3",
    yen: "\xA5",
    cent: "\xA2",
    sup2: "\xB2",
    sup3: "\xB3",
    frac12: "\xBD",
    frac14: "\xBC",
    frac34: "\xBE",
    micro: "\xB5",
    agrave: "\xE0",
    eacute: "\xE9",
    egrave: "\xE8",
    uuml: "\xFC",
    ouml: "\xF6",
    auml: "\xE4",
    szlig: "\xDF",
    ntilde: "\xF1",
    ccedil: "\xE7"
  };
  function tryEntity(text, i) {
    if (text[i] !== "&") return null;
    const n = text.length;
    if (text[i + 1] === "#") {
      let j2 = i + 2;
      let value = 0;
      if (text[j2] === "x" || text[j2] === "X") {
        j2++;
        while (j2 < n && isHexDigit(text[j2])) {
          value = value * 16 + parseInt(text[j2], 16);
          j2++;
        }
        if (j2 === i + 3) return null;
      } else {
        while (j2 < n && isDigit(text[j2])) {
          value = value * 10 + (text.charCodeAt(j2) - 48);
          j2++;
        }
        if (j2 === i + 2) return null;
      }
      if (text[j2] !== ";" || value === 0 || value > 1114111) return null;
      return { html: escapeHtml2(String.fromCodePoint(value)), end: j2 + 1 };
    }
    let j = i + 1;
    while (j < n && j <= i + 32 && isIdentPart(text[j])) j++;
    if (j === i + 1 || text[j] !== ";") return null;
    const name = text.slice(i + 1, j);
    const decoded = NAMED_ENTITIES[name];
    if (decoded === void 0) return null;
    return { html: escapeHtml2(decoded), end: j + 1 };
  }
  function parseLink(text, start) {
    let i = start;
    let isImage = false;
    if (text[i] === "!" && text[i + 1] === "[") {
      isImage = true;
      i++;
    }
    if (text[i] !== "[") return null;
    i++;
    let depth = 1;
    let labelEnd = -1;
    let j = i;
    while (j < text.length) {
      if (text[j] === "[") depth++;
      else if (text[j] === "]") {
        depth--;
        if (depth === 0) {
          labelEnd = j;
          break;
        }
      }
      j++;
    }
    if (labelEnd === -1) return null;
    const label = text.slice(i, labelEnd);
    j = labelEnd + 1;
    if (text[j] !== "(") return null;
    j++;
    while (j < text.length && text[j] === " ") j++;
    const urlStart = j;
    depth = 1;
    let urlEnd = -1;
    while (j < text.length) {
      if (text[j] === "(") depth++;
      else if (text[j] === ")") {
        depth--;
        if (depth === 0) {
          urlEnd = j;
          break;
        }
      }
      j++;
    }
    if (urlEnd === -1) return null;
    const rawDest = text.slice(urlStart, urlEnd);
    const parts = splitLinkTitle(rawDest);
    if (!parts || parts.url === "") return null;
    return { text: label, url: parts.url, title: parts.title, alt: label, image: isImage, end: urlEnd + 1 };
  }
  function splitLinkTitle(dest) {
    let titleStart = -1;
    for (let i = 1; i < dest.length; i++) {
      const c = dest[i];
      if ((c === '"' || c === "'" || c === "(") && (dest[i - 1] === " " || dest[i - 1] === "	")) {
        titleStart = i;
        break;
      }
    }
    if (titleStart === -1) return { url: dest.trim(), title: "" };
    let k = titleStart;
    while (k > 0 && (dest[k - 1] === " " || dest[k - 1] === "	")) k--;
    const url = dest.slice(0, k).trim();
    const open = dest[titleStart];
    const close = open === "(" ? ")" : open;
    let m = titleStart + 1;
    const titleChars = [];
    let closed = false;
    while (m < dest.length) {
      const c = dest[m];
      if (c === "\\" && m + 1 < dest.length) {
        titleChars.push(dest[m + 1]);
        m += 2;
        continue;
      }
      if (c === close) {
        closed = true;
        m++;
        break;
      }
      titleChars.push(c);
      m++;
    }
    if (!closed) return null;
    while (m < dest.length && (dest[m] === " " || dest[m] === "	")) m++;
    if (m < dest.length) return null;
    return { url, title: titleChars.join("") };
  }
  function findDelimiter(text, from, delim) {
    return text.indexOf(delim, from);
  }
  function isAsciiLetter(c) {
    return c >= "a" && c <= "z" || c >= "A" && c <= "Z";
  }
  function isTagNameChar(c) {
    return isAsciiLetter(c) || c >= "0" && c <= "9" || c === "-";
  }
  function scanHtmlTag(text, start) {
    if (text[start] !== "<") return null;
    if (text.startsWith("<!--", start)) {
      const close = text.indexOf("-->", start + 4);
      if (close === -1) return null;
      return { end: close + 3, tag: "!--", closing: false, selfClosing: false, attrSrc: "" };
    }
    let i = start + 1;
    let closing = false;
    if (text[i] === "/") {
      closing = true;
      i++;
    }
    if (!isAsciiLetter(text[i])) return null;
    const nameStart = i;
    while (i < text.length && isTagNameChar(text[i])) i++;
    const tag = text.slice(nameStart, i).toLowerCase();
    let k = i;
    let quote = "";
    while (k < text.length) {
      const c = text[k];
      if (quote !== "") {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      k++;
    }
    if (k >= text.length) return null;
    let selfClosing = false;
    let attrEnd = k;
    if (text[k - 1] === "/") {
      selfClosing = true;
      attrEnd = k - 1;
    }
    return { end: k + 1, tag, closing, selfClosing, attrSrc: text.slice(i, attrEnd) };
  }
  function recordRawHtml(warnings, tag, sample) {
    if (!warnings) return;
    warnings.push({ tag, sample: sample.length > 60 ? sample.slice(0, 57) + "\u2026" : sample });
  }
  var URL_ATTRS = /* @__PURE__ */ new Set(["href", "src", "xlink:href", "poster", "formaction"]);
  function escapeAttrValue(v) {
    return v.split('"').join("&quot;").split("&").join("&amp;");
  }
  function filterHtmlAttributes(attrSrc) {
    let out = "";
    let i = 0;
    const n = attrSrc.length;
    while (i < n) {
      while (i < n && (attrSrc[i] === " " || attrSrc[i] === "	" || attrSrc[i] === "\n")) {
        out += attrSrc[i];
        i++;
      }
      if (i >= n) break;
      const tokenStart = i;
      while (i < n && attrSrc[i] !== "=" && attrSrc[i] !== " " && attrSrc[i] !== "	" && attrSrc[i] !== "\n") i++;
      const name = attrSrc.slice(tokenStart, i);
      const nameLower = name.toLowerCase();
      let rawValue = null;
      if (attrSrc[i] === "=") {
        i++;
        while (i < n && (attrSrc[i] === " " || attrSrc[i] === "	")) i++;
        if (attrSrc[i] === '"' || attrSrc[i] === "'") {
          const q = attrSrc[i];
          const vStart = ++i;
          while (i < n && attrSrc[i] !== q) i++;
          rawValue = attrSrc.slice(vStart, i);
          if (i < n) i++;
        } else {
          const vStart = i;
          while (i < n && attrSrc[i] !== " " && attrSrc[i] !== "	" && attrSrc[i] !== "\n") i++;
          rawValue = attrSrc.slice(vStart, i);
        }
      }
      const tokenEnd = i;
      if (nameLower.startsWith("on")) continue;
      if (rawValue !== null && URL_ATTRS.has(nameLower)) {
        out += `${name}="${escapeAttrValue(sanitizeUrl(rawValue))}"`;
        continue;
      }
      out += attrSrc.slice(tokenStart, tokenEnd);
    }
    return out;
  }
  function tryRawHtml(text, start, opts) {
    const mode = opts.htmlMode;
    if (mode !== "allow" && mode !== "allowlist") return null;
    const scan = scanHtmlTag(text, start);
    if (!scan) return null;
    if (mode === "allowlist") {
      if (scan.tag === "!--") return null;
      const allowedTags = opts.allowTags || MD_DEFAULT_ALLOW_TAGS;
      if (!allowedTags.includes(scan.tag)) return null;
      if (scan.closing) {
        recordRawHtml(opts.rawHtmlWarnings, scan.tag, text.slice(start, scan.end));
        return { html: `</${scan.tag}>`, end: scan.end };
      }
      recordRawHtml(opts.rawHtmlWarnings, scan.tag, text.slice(start, scan.end));
      const filtered = filterHtmlAttributes(scan.attrSrc);
      const tail = scan.selfClosing ? " />" : ">";
      return { html: `<${scan.tag}${filtered}${tail}`, end: scan.end };
    }
    recordRawHtml(opts.rawHtmlWarnings, scan.tag, text.slice(start, scan.end));
    return { html: text.slice(start, scan.end), end: scan.end };
  }
  function renderInline(text, opts = {}) {
    let out = "";
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === "\\" && i + 1 < text.length) {
        out += escapeHtml2(text[i + 1]);
        i += 2;
        continue;
      }
      if (opts.autolink && (ch === "h" || ch === "m" || ch === "w")) {
        const auto = tryAutolink(text, i);
        if (auto) {
          out += auto.html;
          i = auto.end;
          continue;
        }
      }
      if (ch === "`") {
        let n = 0;
        while (i + n < text.length && text[i + n] === "`") n++;
        const delim = "`".repeat(n);
        const close = findDelimiter(text, i + n, delim);
        if (close !== -1) {
          let code = text.slice(i + n, close);
          code = code.split("\n").join(" ");
          out += `<code>${escapeHtml2(code)}</code>`;
          i = close + n;
          continue;
        }
        out += "`";
        i++;
        continue;
      }
      if (ch === "~" && text[i + 1] === "~") {
        const close = findDelimiter(text, i + 2, "~~");
        if (close !== -1 && close > i + 2) {
          out += `<del>${renderInline(text.slice(i + 2, close), opts)}</del>`;
          i = close + 2;
          continue;
        }
        out += "~";
        i++;
        continue;
      }
      if (ch === "*" || ch === "_") {
        const next = text[i + 1];
        if (next !== " " && next !== "	" && next !== void 0) {
          const inner = tryEmphasis(text, i, opts);
          if (inner) {
            out += inner.html;
            i = inner.end;
            continue;
          }
        }
        out += ch;
        i++;
        continue;
      }
      if (ch === "[" || ch === "!" && text[i + 1] === "[") {
        let link = parseLink(text, i);
        if (!link) link = parseRefLink(text, i, opts.defs);
        if (link) {
          const titleAttr = link.title !== "" ? ` title="${escapeHtml2(link.title)}"` : "";
          if (link.image) {
            out += `<img src="${escapeHtml2(sanitizeUrl(link.url))}" alt="${escapeHtml2(link.alt)}"${titleAttr} loading="lazy" />`;
          } else {
            out += `<a href="${escapeHtml2(sanitizeUrl(link.url))}"${titleAttr}>${renderInline(link.text, opts)}</a>`;
          }
          i = link.end;
          continue;
        }
      }
      if (ch === "<" && opts.autolink) {
        const angle = tryAngleAutolink(text, i);
        if (angle) {
          out += angle.html;
          i = angle.end;
          continue;
        }
      }
      if (ch === "<" && opts.htmlMode && opts.htmlMode !== "escape") {
        const raw = tryRawHtml(text, i, opts);
        if (raw) {
          out += raw.html;
          i = raw.end;
          continue;
        }
      }
      if (ch === "&") {
        const ent = tryEntity(text, i);
        if (ent) {
          out += ent.html;
          i = ent.end;
          continue;
        }
      }
      out += escapeHtml2(ch);
      i++;
    }
    return out;
  }
  function tryAngleAutolink(text, start) {
    let end = -1;
    for (let j = start + 1; j < text.length && j <= start + 512; j++) {
      const c = text[j];
      if (c === " " || c === "	" || c === "\n" || c === "<") return null;
      if (c === ">") {
        end = j;
        break;
      }
    }
    if (end === -1) return null;
    const inner = text.slice(start + 1, end);
    let href = null;
    if (inner.startsWith("https://") || inner.startsWith("http://") || inner.startsWith("mailto:")) {
      href = inner;
    } else if (isEmailLike(inner)) {
      href = "mailto:" + inner;
    }
    if (!href) return null;
    return { html: `<a href="${escapeHtml2(sanitizeUrl(href))}">${escapeHtml2(inner)}</a>`, end: end + 1 };
  }
  function isEmailLike(s) {
    const at = s.indexOf("@");
    if (at <= 0 || at !== s.lastIndexOf("@")) return false;
    const domain = s.slice(at + 1);
    const dot = domain.lastIndexOf(".");
    if (dot < 1 || dot === domain.length - 1) return false;
    const okChar = (c) => isIdentPart(c) || c === "." || c === "-" || c === "+" || c === "%" || c === "_" || c === "@";
    for (const c of s) {
      if (!okChar(c)) return false;
    }
    return true;
  }
  function parseRefLink(text, start, defs) {
    if (!defs || defs.size === 0) return null;
    let i = start;
    let isImage = false;
    if (text[i] === "!" && text[i + 1] === "[") {
      isImage = true;
      i++;
    }
    if (text[i] !== "[") return null;
    i++;
    let depth = 1;
    let labelEnd = -1;
    let j = i;
    while (j < text.length) {
      if (text[j] === "\\") {
        j += 2;
        continue;
      }
      if (text[j] === "[") depth++;
      else if (text[j] === "]") {
        depth--;
        if (depth === 0) {
          labelEnd = j;
          break;
        }
      }
      j++;
    }
    if (labelEnd === -1) return null;
    const label = text.slice(i, labelEnd);
    let refLabel;
    let end;
    const next = text[labelEnd + 1];
    if (next === "[") {
      const close = text.indexOf("]", labelEnd + 2);
      if (close === -1) return null;
      refLabel = text.slice(labelEnd + 2, close);
      end = close + 1;
      if (refLabel.trim() === "") refLabel = label;
    } else if (next === "(") {
      return null;
    } else {
      refLabel = label;
      end = labelEnd + 1;
    }
    const def = defs.get(normalizeRefLabel(refLabel));
    if (!def) return null;
    return { text: label, url: def.url, title: def.title, alt: label, image: isImage, end };
  }
  function isAlphaNum(ch) {
    if (ch === void 0) return false;
    return isIdentPart(ch);
  }
  function tryEmphasis(text, start, opts = {}) {
    const ch = text[start];
    const underscoreOk = (open, pos) => {
      if (ch !== "_") return true;
      return open ? !isAlphaNum(text[pos - 1]) : !isAlphaNum(text[pos + 1]);
    };
    if (!underscoreOk(true, start)) return null;
    if (text[start + 1] === ch) {
      let j2 = start + 2;
      while (j2 < text.length) {
        if (text[j2] === ch && text[j2 + 1] === ch) {
          if (j2 > start + 2 && (text[j2 - 1] === " " || text[j2 - 1] === "	")) {
            j2 += 2;
            continue;
          }
          if (!underscoreOk(false, j2)) {
            j2++;
            continue;
          }
          return { html: `<strong>${renderInline(text.slice(start + 2, j2), opts)}</strong>`, end: j2 + 2 };
        }
        j2++;
      }
    }
    let j = start + 1;
    while (j < text.length) {
      if (text[j] === ch) {
        if (j > start + 1 && (text[j - 1] === " " || text[j - 1] === "	")) {
          j++;
          continue;
        }
        if (!underscoreOk(false, j)) {
          j++;
          continue;
        }
        return { html: `<em>${renderInline(text.slice(start + 1, j), opts)}</em>`, end: j + 1 };
      }
      j++;
    }
    return null;
  }
  var MD_DEFAULT_ALLOW_TAGS = [
    "a",
    "abbr",
    "b",
    "bdi",
    "bdo",
    "br",
    "cite",
    "code",
    "data",
    "del",
    "dfn",
    "em",
    "i",
    "ins",
    "kbd",
    "mark",
    "q",
    "rp",
    "rt",
    "ruby",
    "s",
    "samp",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "time",
    "u",
    "var",
    "wbr"
  ];
  function ctxOf(o) {
    return {
      highlight: o.highlight === true,
      chrome: o.chrome === true,
      lineNumbers: o.lineNumbers === true,
      copy: o.copy !== false,
      ids: o.ids === true,
      autolink: o.autolink === true,
      hardBreaks: o.hardBreaks === true,
      html: o.html || __globalMode,
      allowTags: o.allowTags || __globalAllowTags || MD_DEFAULT_ALLOW_TAGS,
      headings: /* @__PURE__ */ new Map(),
      refs: /* @__PURE__ */ new Map(),
      warnings: []
    };
  }
  function inlineOpts(ctx2) {
    return { autolink: ctx2.autolink, defs: ctx2.refs, htmlMode: ctx2.html, allowTags: ctx2.allowTags, rawHtmlWarnings: ctx2.warnings };
  }
  function renderListItem(item, ctx2) {
    const blocks = item.blocks;
    let checkbox = "";
    if (item.task === true) checkbox = '<input type="checkbox" checked disabled class="md-task-box" />';
    else if (item.task === false) checkbox = '<input type="checkbox" disabled class="md-task-box" />';
    const liClass = item.task !== null ? ' class="md-task"' : "";
    if (blocks.length === 1 && blocks[0].type === "paragraph") {
      return `<li${liClass}>${checkbox}${renderInline(blocks[0].text, inlineOpts(ctx2))}</li>`;
    }
    const parts = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (i === 0 && b.type === "paragraph") {
        parts.push(renderInline(b.text, inlineOpts(ctx2)));
      } else {
        parts.push(renderBlock(b, ctx2));
      }
    }
    return `<li${liClass}>${checkbox}${parts.join("\n")}</li>`;
  }
  function renderHeadingId(text, ctx2) {
    const base = slugify(text);
    const seen = ctx2.headings.get(base) || 0;
    ctx2.headings.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  }
  function trimTrailingSpaces(s) {
    let e = s.length;
    while (e > 0 && s[e - 1] === " ") e--;
    return s.slice(0, e);
  }
  function hardJoin(lines, ctx2) {
    let out = "";
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let br = false;
      if (ctx2.hardBreaks) {
        if (line.endsWith("  ")) {
          br = true;
          line = trimTrailingSpaces(line);
        } else if (line.endsWith("\\")) {
          br = true;
          line = line.slice(0, -1);
        }
      }
      out += renderInline(trimTrailingSpaces(line), inlineOpts(ctx2));
      if (br && i < lines.length - 1) out += "<br />\n";
      else if (i < lines.length - 1) out += " ";
    }
    return out;
  }
  function wrapCodeLines(html) {
    const stack = [];
    let out = "";
    let i = 0;
    const n = html.length;
    const closeAll = () => {
      for (let k = stack.length - 1; k >= 0; k--) out += "</span>";
    };
    const reopen = () => {
      for (const c of stack) out += c;
    };
    out += '<span class="tok-line">';
    while (i < n) {
      if (html.startsWith('<span class="tok-', i)) {
        const close = html.indexOf(">", i);
        if (close === -1) {
          out += html[i];
          i++;
          continue;
        }
        const tag = html.slice(i, close + 1);
        stack.push(tag);
        out += tag;
        i = close + 1;
        continue;
      }
      if (html.startsWith("</span>", i)) {
        stack.pop();
        out += "</span>";
        i += 7;
        continue;
      }
      if (html[i] === "\n") {
        closeAll();
        out += '</span>\n<span class="tok-line">';
        reopen();
        i++;
        continue;
      }
      out += html[i];
      i++;
    }
    closeAll();
    out += "</span>";
    return out;
  }
  function renderCodeBlock(b, ctx2) {
    const legacy = !ctx2.chrome && !ctx2.highlight;
    if (legacy) {
      const lang = b.lang ? ` class="language-${escapeHtml2(b.lang)}"` : "";
      return `<pre><code${lang}>${escapeHtml2(b.code)}</code></pre>`;
    }
    const rawBody = ctx2.highlight && b.lang ? highlightCode(b.code, b.lang) : escapeHtml2(b.code);
    const body = ctx2.lineNumbers && ctx2.chrome ? wrapCodeLines(rawBody) : rawBody;
    const codeCls = b.lang ? `language-${escapeHtml2(b.lang)}` : "";
    const lineAttr = ctx2.lineNumbers && ctx2.chrome ? " md-lines" : "";
    if (!ctx2.chrome) {
      return `<pre><code${codeCls ? ` class="${codeCls}"` : ""}>${body}</code></pre>`;
    }
    const meta = parseFenceMeta(b.info || b.lang);
    const styleParts = [];
    if (meta.params.bg !== void 0) {
      const v = safeColorValue(meta.params.bg);
      styleParts.push(`--md-code-bg:${v === "none" ? "transparent" : v || "transparent"}`);
    }
    if (meta.params.fg !== void 0) {
      const v = safeColorValue(meta.params.fg);
      if (v && v !== "none") styleParts.push(`--md-code-fg:${v}`);
    }
    const styleAttr = styleParts.length > 0 ? ` style="${escapeHtml2(styleParts.join(";"))}"` : "";
    const langLabel = meta.lang ? `<span class="md-code-lang">${escapeHtml2(meta.lang)}</span>` : '<span class="md-code-lang"></span>';
    const copyBtn = ctx2.copy ? '<button type="button" class="md-copy" data-md-copy aria-label="Copy code">Copy</button>' : "";
    return `<div class="md-code"${meta.lang ? ` data-lang="${escapeHtml2(meta.lang)}"` : ""}${styleAttr}><div class="md-code-bar">${langLabel}${copyBtn}</div><pre><code${codeCls ? ` class="${codeCls}"` : ""}${lineAttr}>${body}</code></pre></div>`;
  }
  function renderBlock(b, ctx2) {
    if (b.type === "paragraph") {
      return `<p>${hardJoin(b.lines || [b.text], ctx2)}</p>`;
    }
    if (b.type === "heading") {
      const id = ctx2.ids ? ` id="${escapeHtml2(renderHeadingId(b.text, ctx2))}"` : "";
      return `<h${b.level}${id}>${renderInline(b.text, inlineOpts(ctx2))}</h${b.level}>`;
    }
    if (b.type === "hr") {
      return "<hr />";
    }
    if (b.type === "code") {
      return renderCodeBlock(b, ctx2);
    }
    if (b.type === "blockquote") {
      return `<blockquote>${renderBlocks(b.blocks, ctx2)}</blockquote>`;
    }
    if (b.type === "table") {
      return renderTable(b, ctx2);
    }
    return renderList(b, ctx2);
  }
  function renderList(b, ctx2) {
    const tag = b.ordered ? "ol" : "ul";
    const startAttr = b.ordered && b.start !== 1 ? ` start="${b.start}"` : "";
    const items = b.items.map((it) => renderListItem(it, ctx2)).join("\n");
    return `<${tag}${startAttr}${b.items.some((it) => it.task !== null) ? ' class="md-tasks"' : ""}>
${items}
</${tag}>`;
  }
  function renderTable(b, ctx2) {
    const styleFor = (a) => a ? ` style="text-align:${a}"` : "";
    const headCells = b.head.map((c, idx) => `<th${styleFor(b.align[idx] || null)}>${renderInline(c, inlineOpts(ctx2))}</th>`).join("");
    const bodyRows = b.rows.map((row) => {
      const cells = b.head.map((_, idx) => `<td${styleFor(b.align[idx] || null)}>${renderInline(row[idx] || "", inlineOpts(ctx2))}</td>`).join("");
      return `<tr>${cells}</tr>`;
    }).join("\n");
    return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${headCells}</tr></thead><tbody>
${bodyRows}
</tbody></table></div>`;
  }
  function renderBlocks(blocks, ctx2) {
    const out = [];
    for (const b of blocks) {
      out.push(renderBlock(b, ctx2));
    }
    return out.join("\n");
  }
  var MD_BASE_CSS = `
.vesk-md { color: inherit; font-size: 16px; line-height: 1.7; word-wrap: break-word; }
.vesk-md h1,.vesk-md h2,.vesk-md h3,.vesk-md h4,.vesk-md h5,.vesk-md h6 { margin: 1.4em 0 .6em; font-weight: 650; line-height: 1.25; }
.vesk-md h1 { font-size: 2em; }
.vesk-md h2 { font-size: 1.5em; }
.vesk-md h3 { font-size: 1.25em; } .vesk-md h4 { font-size: 1em; }
.vesk-md p { margin: .8em 0; }
.vesk-md a { color: color-mix(in srgb, currentColor 50%, #0969da); text-decoration: none; } .vesk-md a:hover { text-decoration: underline; }
.vesk-md img { max-width: 100%; border-radius: 6px; }
.vesk-md hr { border: 0; height: 1px; background: color-mix(in srgb, currentColor 18%, transparent); margin: 1.6em 0; }
.vesk-md blockquote { margin: .8em 0; padding: .2em 1em; color: color-mix(in srgb, currentColor 62%, transparent); border-left: .25em solid color-mix(in srgb, currentColor 18%, transparent); }
.vesk-md ul,.vesk-md ol { margin: .8em 0; padding-left: 2em; }
.vesk-md ul { list-style: disc; } .vesk-md ul ul { list-style: circle; } .vesk-md ul ul ul { list-style: square; }
.vesk-md ol { list-style: decimal; } .vesk-md ol ol { list-style: lower-alpha; }
.vesk-md li { margin: .25em 0; }
.vesk-md li.md-task { list-style: none; margin-left: -1.4em; display: flex; gap: .5em; align-items: baseline; }
.vesk-md code:not(pre code) { background: color-mix(in srgb, currentColor 12%, transparent); padding: .15em .35em; border-radius: 5px; font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size: 85%; }
.vesk-md .md-table-wrap { overflow-x: auto; margin: .8em 0; }
.vesk-md table.md-table { border-collapse: collapse; width: max-content; max-width: 100%; font-size: .95em; }
.vesk-md .md-table th,.vesk-md .md-table td { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); padding: 6px 13px; }
.vesk-md .md-table th { background: color-mix(in srgb, currentColor 8%, transparent); font-weight: 650; }
.vesk-md .md-table tr:nth-child(2n) td { background: color-mix(in srgb, currentColor 5%, transparent); }
.vesk-md .md-code { --md-code-bg: color-mix(in srgb, currentColor 6%, transparent); margin: 1em 0; border-radius: 8px; overflow: hidden; background: var(--md-code-bg); border: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
.vesk-md .md-code-bar { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: var(--md-code-bg); border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
.vesk-md .md-code-lang { font-family: ui-monospace,monospace; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: color-mix(in srgb, currentColor 60%, transparent); }
.vesk-md .md-copy { all: unset; cursor: pointer; font: 11px ui-monospace,monospace; color: color-mix(in srgb, currentColor 60%, transparent); padding: 2px 8px; border-radius: 6px; }
.vesk-md .md-copy:hover { color: inherit; background: color-mix(in srgb, currentColor 10%, transparent); }
.vesk-md .md-copy.md-copied { color: color-mix(in srgb, currentColor 70%, transparent); }
.vesk-md .md-code pre { margin: 0; overflow-x: auto; padding: 14px 16px; }
.vesk-md .md-code code { font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size: 13.5px; line-height: 1.55; color: var(--md-code-fg,inherit); background: none; padding: 0; }
.vesk-md code[md-lines] { counter-reset: ln; display: block; }
.vesk-md code[md-lines] .tok-line { display: block; counter-increment: ln; padding-left: 3.2em; position: relative; }
.vesk-md code[md-lines] .tok-line::before { content: counter(ln); position: absolute; left: 0; width: 2.4em; text-align: right; color: color-mix(in srgb, currentColor 50%, transparent); user-select: none; }
.tok-kw { color: color-mix(in srgb, currentColor 85%, transparent); } .tok-lit { color: color-mix(in srgb, currentColor 80%, transparent); } .tok-str { color: color-mix(in srgb, currentColor 72%, transparent); }
.tok-num { color: color-mix(in srgb, currentColor 80%, transparent); } .tok-com { color: color-mix(in srgb, currentColor 52%, transparent); font-style: italic; }
.tok-fn { color: color-mix(in srgb, currentColor 72%, transparent); } .tok-attr { color: color-mix(in srgb, currentColor 72%, transparent); } .tok-prop { color: color-mix(in srgb, currentColor 72%, transparent); }
.tok-sel { color: color-mix(in srgb, currentColor 74%, transparent); } .tok-add { color: color-mix(in srgb, currentColor 86%, transparent); background: color-mix(in srgb, currentColor 10%, transparent); display: inline-block; width: 100%; }
.tok-del { color: color-mix(in srgb, currentColor 86%, transparent); background: color-mix(in srgb, currentColor 10%, transparent); display: inline-block; width: 100%; }
.vesk-md-light { color: #24292f; --md-code-bg: #f6f8fa; --md-code-fg: #1f2328; --md-link: #0969da; }
.vesk-md-light a { color: #0969da; }
.vesk-md-light hr { background: #d0d7de; }
.vesk-md-light blockquote { color: #57606a; border-left-color: #d0d7de; }
.vesk-md-light code:not(pre code) { background: rgba(175,184,193,.2); }
.vesk-md-light .md-table th,.vesk-md-light .md-table td { border-color: #d0d7de; }
.vesk-md-light .md-table th { background: #f6f8fa; }
.vesk-md-light .md-table tr:nth-child(2n) td { background: #f6f8fa80; }
.vesk-md-light .md-code { border-color: #d1d9e0; }
.vesk-md-light .md-code-bar { border-bottom-color: #d1d9e0; }
.vesk-md-light .md-code-lang { color: #59636e; }
.vesk-md-light .md-copy { color: #59636e; }
.vesk-md-light .md-copy:hover { color: #1f2328; background: #eaeef2; }
.vesk-md-light .md-copy.md-copied { color: #1a7f37; }
.vesk-md-light code[md-lines] .tok-line::before { color: #8c959f; }
.vesk-md-light .tok-kw { color: #cf222e; } .vesk-md-light .tok-lit { color: #0550ae; } .vesk-md-light .tok-str { color: #0a3069; }
.vesk-md-light .tok-num { color: #0550ae; } .vesk-md-light .tok-com { color: #59636e; font-style: italic; }
.vesk-md-light .tok-fn { color: #8250df; } .vesk-md-light .tok-attr { color: #0550ae; } .vesk-md-light .tok-prop { color: #0550ae; }
.vesk-md-light .tok-sel { color: #116329; } .vesk-md-light .tok-add { color: #116329; background: #dafbe1; }
.vesk-md-light .tok-del { color: #cf222e; background: #ffebe9; }
.vesk-md-dark { --md-code-bg: #0d1117; --md-code-fg: #c9d1d9; color: #f0f6fc; --md-link: #4493f8; }
.vesk-md-dark a { color: #4493f8; }
.vesk-md-dark hr { background: #30363d; }
.vesk-md-dark blockquote { color: #8b949e; border-left-color: #30363d; }
.vesk-md-dark code:not(pre code) { background: rgba(110,118,129,.4); }
.vesk-md-dark .md-table th,.vesk-md-dark .md-table td { border-color: #30363d; }
.vesk-md-dark .md-table th { background: #161b22; }
.vesk-md-dark .md-table tr:nth-child(2n) td { background: #161b2280; }
.vesk-md-dark .md-code { border-color: #30363d; }
.vesk-md-dark .md-code-bar { border-bottom-color: #30363d; }
.vesk-md-dark .md-code-lang { color: #8b949e; }
.vesk-md-dark .md-copy { color: #8b949e; }
.vesk-md-dark .md-copy:hover { color: #c9d1d9; background: #30363d; }
.vesk-md-dark .md-copy.md-copied { color: #3fb950; }
.vesk-md-dark code[md-lines] .tok-line::before { color: #484f58; }
.vesk-md-dark .tok-kw { color: #ff7b72; } .vesk-md-dark .tok-lit { color: #79c0ff; }
.vesk-md-dark .tok-str { color: #a5d6ff; } .vesk-md-dark .tok-num { color: #f2cc60; }
.vesk-md-dark .tok-com { color: #8b949e; font-style: italic; }
.vesk-md-dark .tok-fn { color: #d2a8ff; } .vesk-md-dark .tok-attr { color: #79c0ff; }
.vesk-md-dark .tok-prop { color: #79c0ff; } .vesk-md-dark .tok-sel { color: #7ee787; }
.vesk-md-dark .tok-add { color: #aff5b4; background: rgba(46,160,67,.15); }
.vesk-md-dark .tok-del { color: #ffdcd7; background: rgba(248,81,73,.15); }
`;
  function renderMarkdownEx(md, options = {}) {
    const ctx2 = ctxOf(options);
    const normalized = String(md == null ? "" : md).split("\r\n").join("\n").split("\r").join("\n");
    const extracted = extractRefDefinitions(normalized.split("\n"));
    ctx2.refs = extracted.defs;
    const html = renderBlocks(parseBlocks(extracted.lines), ctx2);
    return { html, warnings: ctx2.warnings };
  }
  var __globalMode = "escape";
  var __globalAllowTags = null;
  function getMdPolicy() {
    return { html: __globalMode, allowTags: (__globalAllowTags || MD_DEFAULT_ALLOW_TAGS).slice() };
  }
  var __sessionWarnings = [];
  var __warnedKeys = /* @__PURE__ */ new Set();
  var __suppressMdConsoleWarnings = false;
  function rememberSessionWarnings(warnings) {
    for (const w of warnings) {
      if (__warnedKeys.has(w.tag)) continue;
      __warnedKeys.add(w.tag);
      __sessionWarnings.push(w);
      if (__warnedKeys.size > 500) break;
    }
  }
  function wireCopyHandlers(root2) {
    root2.addEventListener("click", (ev) => {
      const target = ev.target;
      if (!target) return;
      const btn = target.closest("[data-md-copy]");
      if (!btn) return;
      const wrap = btn.closest(".md-code");
      const code = wrap ? wrap.querySelector("pre > code") : null;
      const text = code ? code.textContent || "" : "";
      const done = () => {
        btn.classList.add("md-copied");
        btn.textContent = "Copied!";
        window.setTimeout(() => {
          btn.classList.remove("md-copied");
          btn.textContent = "Copy";
        }, 1500);
      };
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          void navigator.clipboard.writeText(text).then(done, done);
          return;
        }
      } catch {
      }
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        done();
      } catch {
      }
    });
  }
  function mdIsSSR() {
    return typeof document === "undefined";
  }
  function stringEndsWith(s, suffix) {
    if (suffix.length > s.length) return false;
    for (let i = 0; i < suffix.length; i++) {
      if (s[s.length - suffix.length + i] !== suffix[i]) return false;
    }
    return true;
  }
  function isPublicMarkdownPath(v) {
    if (typeof v !== "string") return false;
    const s = v;
    if (s.length < 2 || s.charCodeAt(0) !== 47) return false;
    if (s.charCodeAt(1) === 47) return false;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 63 || c === 35 || c === 92) return false;
    }
    const lower = s.toLowerCase();
    return stringEndsWith(lower, ".md") || stringEndsWith(lower, ".markdown");
  }
  var mdPathCache = /* @__PURE__ */ new Map();
  var mdPathCells = /* @__PURE__ */ new Map();
  var mdPathInflight = /* @__PURE__ */ new Set();
  function getMdPathCell(path) {
    let cell = mdPathCells.get(path);
    if (!cell) {
      cell = tracked(void 0);
      mdPathCells.set(path, cell);
    }
    return cell;
  }
  function ensureMdPathLoaded(path) {
    if (mdPathCache.has(path) || mdPathInflight.has(path)) return;
    const ssr = getSsrData("md:" + path);
    if (typeof ssr === "string") {
      mdPathCache.set(path, ssr);
      return;
    }
    mdPathInflight.add(path);
    fetch(path).then((r) => r.ok ? r.text() : Promise.reject(r)).then((text) => {
      mdPathCache.set(path, text);
      set(getMdPathCell(path), text);
    }).catch(() => {
      mdPathCache.set(path, null);
      set(getMdPathCell(path), null);
    }).finally(() => {
      mdPathInflight.delete(path);
    });
  }
  function readServerMdPath(path) {
    const hook = globalThis.__vsk_md_read_file;
    if (typeof hook !== "function") return null;
    try {
      const out = hook(path);
      if (typeof out === "string") return out;
    } catch {
    }
    return null;
  }
  function resolveMdSource(value) {
    const s = String(value ?? "");
    if (!isPublicMarkdownPath(s)) return s;
    if (mdIsSSR()) {
      const content = readServerMdPath(s);
      if (content !== null) {
        setSsrData("md:" + s, content);
        return content;
      }
      return s;
    }
    ensureMdPathLoaded(s);
    const cached = mdPathCache.get(s);
    return cached === void 0 || cached === null ? s : cached;
  }
  function streamCellFrom(rawContent) {
    if (rawContent === null || typeof rawContent !== "object") return null;
    const into = rawContent.into;
    if (into !== null && typeof into === "object" && typeof into.get === "function") {
      return into;
    }
    return null;
  }
  function buildHtml(content, props) {
    const global = getMdPolicy();
    const mode = props.html || global.html;
    const allowTags = Array.isArray(props.allowTags) ? props.allowTags.map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, "")).filter(Boolean) : global.allowTags;
    const { html, warnings } = renderMarkdownEx(content, {
      highlight: props.highlight !== false,
      chrome: props.highlight !== false,
      lineNumbers: props.lineNumbers === true,
      copy: props.copy !== false,
      ids: props.ids !== false,
      autolink: props.autolink !== false,
      hardBreaks: props.hardBreaks === true,
      html: mode,
      allowTags
    });
    if (warnings.length > 0 && mode !== "escape") {
      rememberSessionWarnings(warnings);
      if (!__suppressMdConsoleWarnings) {
        const byTag = /* @__PURE__ */ new Map();
        for (const w of warnings) byTag.set(w.tag, (byTag.get(w.tag) || 0) + 1);
        const tags = [...byTag.entries()].map(([t, n]) => `<${t}>\xD7${n}`).join(", ");
        console.warn(
          `[vesk-md] ${mode === "allow" ? "raw HTML rendered verbatim" : "allowlisted HTML rendered"} \u2014 ${tags}. Only use with trusted markdown content. Policy source: md.html in vesk.config.ts (or <Md html> prop).`
        );
      }
    }
    if (props.css === true) {
      return `<style data-vesk-md-css>${MD_BASE_CSS}</style>${html}`;
    }
    if (typeof props.css === "string" && props.css !== "") {
      return `<style data-vesk-md-css>${props.css}</style>${html}`;
    }
    return html;
  }
  function Md(props, _registry, hydrate2) {
    const rawContent = props.content;
    const streamTarget = streamCellFrom(rawContent);
    const contentCell = streamTarget ?? rawContent;
    const content = String(unwrapMaybeCell(contentCell) ?? "");
    const html = buildHtml(resolveMdSource(content), props);
    const classNameRaw = props.className != null ? String(props.className) : props.class != null ? String(props.class) : "";
    const themeClass = props.theme === "dark" ? " vesk-md-dark" : props.theme === "light" ? " vesk-md-light" : "";
    const className = `vesk-md${themeClass}${classNameRaw ? " " + classNameRaw : ""}`;
    const style = props.style != null ? String(props.style) : "";
    const wrapperParts = [];
    const propBg = safeColorValue(String(props.codeBg ?? ""));
    if (propBg) wrapperParts.push(`--md-code-bg:${propBg === "none" ? "transparent" : propBg}`);
    const propFg = safeColorValue(String(props.codeFg ?? ""));
    if (propFg && propFg !== "none") wrapperParts.push(`--md-code-fg:${propFg}`);
    const wrapperStyle = wrapperParts.length > 0 ? escapeHtml2(wrapperParts.join(";")) : "";
    const reactive = isCell(contentCell);
    const pathMode = isPublicMarkdownPath(content);
    if (mdIsSSR()) {
      const attrs = className ? ` class="${escapeHtml2(className)}"` : "";
      const styleAttr = style || wrapperStyle ? ` style="${[wrapperStyle, style.split('"').join("&quot;")].filter(Boolean).join(";")}"` : "";
      return `<div${attrs}${styleAttr}>${html}</div>`;
    }
    if (hydrate2 && typeof hydrate2.nextElement === "function") {
      let el = hydrate2.nextElement("div");
      if (el && !el.parentNode && hydrate2.root) {
        const existing = hydrate2.root.querySelector("div");
        if (existing) el = existing;
      }
      const claimed = !!el.parentNode;
      if (pathMode && claimed) {
        el.setAttribute("data-vsk-md-ssr", "1");
        if (mdPathCache.has(content)) el.innerHTML = html;
      } else {
        el.innerHTML = html;
      }
      el.className = className;
      el.style.cssText = [wrapperStyle, style].filter(Boolean).join(";");
      wireCopyHandlers(el);
      if (reactive || pathMode) {
        subscribeContent(el, contentCell, props, pathMode && claimed ? { trustInitialSsr: true, initialValue: content } : void 0);
      }
      if (el.parentNode) return document.createDocumentFragment();
      return el;
    }
    const div = document.createElement("div");
    div.innerHTML = html;
    div.className = className;
    div.style.cssText = [wrapperStyle, style].filter(Boolean).join(";");
    wireCopyHandlers(div);
    if (reactive || pathMode) subscribeContent(div, contentCell, props);
    return div;
  }
  function subscribeContent(el, rawContent, props, opts) {
    const trust = opts?.trustInitialSsr === true;
    const initial = opts?.initialValue;
    let ran = false;
    effect(() => {
      const value = String(unwrapMaybeCell(rawContent) ?? "");
      if (isPublicMarkdownPath(value)) {
        const known = getSsrData("md:" + value) !== void 0 || mdPathCache.has(value);
        ensureMdPathLoaded(value);
        const cell = getMdPathCell(value);
        get(cell);
        if (trust && !ran && value === initial && !known) {
          ran = true;
          return;
        }
        ran = true;
        el.innerHTML = buildHtml(resolveMdSource(value), props);
        wireCopyHandlers(el);
        return;
      }
      ran = true;
      el.innerHTML = buildHtml(resolveMdSource(value), props);
      wireCopyHandlers(el);
    });
  }

  // packages/runtime/src/primitive.ts
  var EMPTY_PROPS = Object.freeze({});
  function primitive(fn) {
    const wrapped = ((props, registry, scope2) => {
      return fn(props == null ? EMPTY_PROPS : props, registry, scope2);
    });
    wrapped.__veskPrimitive = true;
    return wrapped;
  }
  function leaf(fn) {
    fn.__veskLeaf = true;
    return fn;
  }
  function toDomNode(value) {
    if (typeof document === "undefined") return value;
    if (value == null || typeof value === "boolean") return value;
    if (typeof value.nodeType === "number") {
      return value;
    }
    if (typeof value !== "string") return value;
    if (value === "") return document.createDocumentFragment();
    const template = document.createElement("template");
    template.innerHTML = value;
    const { content } = template;
    if (content.childNodes.length === 1) {
      const only = content.firstChild;
      content.removeChild(only);
      return only;
    }
    return content;
  }
  function isCell2(value) {
    return typeof value === "object" && value !== null && typeof value.f === "number";
  }
  function readDep(dep) {
    return isCell2(dep) ? get(dep) : dep;
  }
  function rerenderNode(node, deps, call) {
    if (typeof document === "undefined") return node;
    if (deps.length === 0) return node;
    let owned = null;
    let current = null;
    if (Array.isArray(node)) {
      const roots = node.filter((n) => n && typeof n.nodeType === "number");
      owned = roots.length ? roots : null;
      current = owned ? owned[0] : null;
    } else if (node && typeof node.nodeType === "number") {
      current = node;
    }
    if (!current) return node;
    const liveRange = () => {
      if (owned) return owned;
      return current && current.parentNode ? [current] : null;
    };
    let seen = deps.map(readDep);
    effect(() => {
      const now2 = deps.map(readDep);
      if (now2.length === seen.length && now2.every((v, i) => Object.is(v, seen[i]))) return;
      seen = now2;
      const old = liveRange();
      if (!old || !old[0].parentNode) return;
      const next = toDomNode(call());
      if (!next || typeof next.nodeType !== "number") return;
      const fresh = next.nodeType === 11 ? Array.from(next.childNodes) : [next];
      const parent = old[0].parentNode;
      for (const freshNode of fresh) parent.insertBefore(freshNode, old[0]);
      for (const oldNode of old) if (oldNode.parentNode) oldNode.parentNode.removeChild(oldNode);
      owned = next.nodeType === 11 ? fresh : null;
      current = fresh[0] ?? current;
    });
    return node;
  }

  // packages/runtime/src/action.ts
  var registryKey = "__vesk_actions";
  function getActionRegistry() {
    const g2 = globalThis;
    if (!g2[registryKey]) g2[registryKey] = {};
    return g2[registryKey];
  }
  function hashString(str) {
    let h1 = 2166136261;
    let h2 = 16777619;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 16777619) >>> 0;
      h2 ^= c;
      h2 = Math.imul(h2, 16777619) >>> 0;
    }
    return (h1 ^ h2).toString(36).slice(0, 12);
  }
  function computeActionId(def) {
    return hashString(String(def.execute || ""));
  }
  function defineAction(config, config2) {
    let def;
    let id = null;
    if (typeof config === "string") {
      id = config;
      def = config2;
    } else {
      def = config;
    }
    if (!def || typeof def.execute !== "function") {
      throw new Error("defineAction requires an object with an `execute` function");
    }
    if (!id) id = computeActionId(def);
    const registry = getActionRegistry();
    if (!registry[id]) registry[id] = def;
    return { id, url: `/_vesk/action/${id}`, input: def.input, execute: def.execute };
  }

  // packages/runtime/src/store-persistence.ts
  var serverReadHook = null;
  function currentSsrToken() {
    const g2 = globalThis;
    return typeof g2.__vsk_ssr_token === "string" ? g2.__vsk_ssr_token : "";
  }
  function persistedStoreCookieName(storageKey) {
    return "vsk_store_" + encodeURIComponent(storageKey);
  }
  var pendingKeys = /* @__PURE__ */ new Map();
  function bucketFor(token) {
    const set2 = pendingKeys.get(token);
    if (set2) return set2;
    const fresh = /* @__PURE__ */ new Set();
    pendingKeys.set(token, fresh);
    return fresh;
  }
  function readPersistedStorage(storageKey) {
    if (!storageKey) return null;
    if (typeof window === "undefined") {
      bucketFor(currentSsrToken()).add(storageKey);
      return serverReadHook ? serverReadHook(storageKey) ?? null : null;
    }
    const init = globalThis.__VESK_STORE_INIT__;
    if (init && init[storageKey] !== void 0) {
      const raw = init[storageKey];
      delete init[storageKey];
      try {
        localStorage.setItem(storageKey, raw);
      } catch {
      }
      return raw;
    }
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }
  function writePersistedStorage(storageKey, raw) {
    if (!storageKey) return;
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(storageKey, raw);
      } catch {
      }
    }
    if (typeof document !== "undefined") {
      try {
        document.cookie = persistedStoreCookieName(storageKey) + "=" + encodeURIComponent(raw) + "; path=/; max-age=31536000; SameSite=Lax";
      } catch {
      }
    }
  }
  function clearPersistedStorage(storageKey) {
    if (!storageKey) return;
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(storageKey);
      } catch {
      }
    }
    if (typeof document !== "undefined") {
      try {
        document.cookie = persistedStoreCookieName(storageKey) + "=; path=/; max-age=0";
      } catch {
      }
    }
  }

  // packages/runtime/src/store.ts
  function cloneState(value) {
    return Array.isArray(value) ? value.slice() : { ...value };
  }
  function createStore(initial, options = {}) {
    const { persist = false, storageKey, devtools = false } = options;
    let value = cloneState(initial);
    if (persist && storageKey) {
      const stored = readPersistedStorage(storageKey);
      if (stored) {
        try {
          value = JSON.parse(stored);
        } catch {
        }
      }
    }
    const stateCell = track(value);
    const subs = /* @__PURE__ */ new Set();
    const watchers = [];
    const middlewares = [];
    let prevValue = cloneState(value);
    let batchDepth = 0;
    let dirty = false;
    function notifyNow(action, payload) {
      const current = stateCell.get();
      if (current === prevValue) return;
      subs.forEach((fn) => fn(current));
      watchers.forEach(({ selector, cb, equals }) => {
        const eq = equals ?? Object.is;
        const newVal = selector(current);
        const oldVal = selector(prevValue);
        if (!eq(newVal, oldVal)) cb(newVal, oldVal);
      });
      middlewares.forEach((fn) => fn(current, action, payload));
      if (devtools && typeof window !== "undefined") {
        const dt = window.__VESK_STORE_DEVTOOLS__;
        if (dt && typeof dt.send === "function") {
          dt.send({ type: action, payload, state: structuredClone(current) });
        }
      }
      prevValue = cloneState(current);
    }
    function notifyDirty(action, payload) {
      if (batchDepth > 0) {
        dirty = true;
      } else {
        notifyNow(action, payload);
      }
    }
    function persistToStorage() {
      if (persist && storageKey) {
        try {
          writePersistedStorage(storageKey, JSON.stringify(stateCell.get()));
        } catch (err) {
          console.log("error saving to localStorage: ", err);
        }
      }
    }
    function get2() {
      return stateCell.get();
    }
    function set2(next, action = "set") {
      stateCell.set(next);
      persistToStorage();
      notifyDirty(action, next);
    }
    function update(partialOrFn, action = "update") {
      const current = stateCell.get();
      const patch = typeof partialOrFn === "function" ? partialOrFn(current) : partialOrFn;
      const next = Object.assign(cloneState(current), patch);
      stateCell.set(next);
      persistToStorage();
      notifyDirty(action, patch);
    }
    function deleteKeys(keys, action = "delete") {
      const current = stateCell.get();
      const kArray = Array.isArray(keys) ? keys : [keys];
      const next = cloneState(current);
      kArray.forEach((k) => {
        delete next[k];
      });
      stateCell.set(next);
      persistToStorage();
      notifyDirty(action, keys);
    }
    function reset() {
      stateCell.set(cloneState(initial));
      notifyDirty("reset");
    }
    function rehydrate(newInitial) {
      Object.assign(initial, newInitial);
      stateCell.set(cloneState(initial));
      notifyDirty("rehydrate");
    }
    function clear() {
      stateCell.set(cloneState(initial));
      if (persist && storageKey) {
        clearPersistedStorage(storageKey);
      }
      notifyDirty("clear");
    }
    function batch(fn) {
      batchDepth++;
      try {
        return flush_sync(fn);
      } finally {
        batchDepth--;
        if (batchDepth === 0 && dirty) {
          notifyDirty("batch");
          dirty = false;
        }
      }
    }
    function subscribe(fn, selector, equals) {
      const eq = equals ?? Object.is;
      let hasPrev = false;
      let prev;
      const wrapper = selector ? (state) => {
        const selected = selector(state);
        if (!hasPrev || !eq(selected, prev)) {
          hasPrev = true;
          prev = selected;
          fn(selected);
        }
      } : fn;
      subs.add(wrapper);
      wrapper(stateCell.get());
      return () => subs.delete(wrapper);
    }
    function watch(selector, callback, equals) {
      watchers.push({ selector, cb: callback, equals });
      return () => {
        const i = watchers.findIndex((w) => w.cb === callback);
        if (i >= 0) watchers.splice(i, 1);
      };
    }
    function use(middleware) {
      middlewares.push(middleware);
      return () => {
        const i = middlewares.indexOf(middleware);
        if (i >= 0) middlewares.splice(i, 1);
      };
    }
    function derive(selector, equals) {
      return {
        subscribe(cb) {
          return subscribe(
            (v) => cb(v),
            selector,
            equals
          );
        }
      };
    }
    function toJSON() {
      return structuredClone(stateCell.get());
    }
    return {
      get: get2,
      set: set2,
      update,
      delete: deleteKeys,
      clear,
      subscribe,
      watch,
      use,
      derive,
      batch,
      reset,
      rehydrate,
      toJSON
    };
  }
  return __toCommonJS(runtime_tree_entry_exports);
})();

const { createFileRouter, get, set, effect, track, destroy_block, getActiveComponent, setActiveComponent, NavLink, Link, reactiveProps, matchRoute, ensureChunk, toDomNode, rerenderNode, applyStyle, useFetch, hydrate, hydrateViewport, hydrateIdle, hydrateOnInteraction, needsHydration, createHydrateWalker, collectVskMarkers, createLayoutSlot, LoadingIndicator, Form, Field, required, email, minLength, defineAction, primitive, leaf, reconcile, reconcileHydrated, Md, NotFoundError, createStore } = __veskRuntime;
export { createFileRouter, get, set, effect, track, destroy_block, getActiveComponent, setActiveComponent, NavLink, Link, reactiveProps, matchRoute, ensureChunk, toDomNode, rerenderNode, applyStyle, useFetch, hydrate, hydrateViewport, hydrateIdle, hydrateOnInteraction, needsHydration, createHydrateWalker, collectVskMarkers, createLayoutSlot, LoadingIndicator, Form, Field, required, email, minLength, defineAction, primitive, leaf, reconcile, reconcileHydrated, Md, NotFoundError, createStore };

const __components = globalThis.__components || (globalThis.__components = {});
const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});
const __runtime_comps = __components;

globalThis.reactiveProps = reactiveProps;
globalThis.getActiveComponent = getActiveComponent;
globalThis.setActiveComponent = setActiveComponent;
globalThis.track = track;
globalThis.set = set;
globalThis.get = get;
globalThis.effect = effect;
globalThis.destroy_block = destroy_block;
globalThis.reconcile = reconcile;
globalThis.NavLink = NavLink;
globalThis.Link = Link;
globalThis.createHydrateWalker = createHydrateWalker;
globalThis.needsHydration = needsHydration;
globalThis.hydrate = hydrate;
globalThis.hydrateViewport = hydrateViewport;
globalThis.hydrateIdle = hydrateIdle;
globalThis.hydrateOnInteraction = hydrateOnInteraction;
globalThis.collectVskMarkers = collectVskMarkers;
globalThis.matchRoute = matchRoute;
globalThis.ensureChunk = ensureChunk;
globalThis.__runtime_comps = __runtime_comps;
globalThis.__cleanup = __cleanup;
globalThis.__place = __place;

globalThis.get = get;
globalThis.set = set;
globalThis.destroy_block = destroy_block;
globalThis.getActiveComponent = getActiveComponent;
globalThis.setActiveComponent = setActiveComponent;
globalThis.reactiveProps = reactiveProps;
globalThis.applyStyle = applyStyle;
globalThis.toDomNode = toDomNode;
globalThis.rerenderNode = rerenderNode;
globalThis.effect = effect;
globalThis.track = track;
globalThis.useFetch = useFetch;
globalThis.hydrate = hydrate;
globalThis.hydrateViewport = hydrateViewport;
globalThis.hydrateIdle = hydrateIdle;
globalThis.hydrateOnInteraction = hydrateOnInteraction;
globalThis.needsHydration = needsHydration;
globalThis.createHydrateWalker = createHydrateWalker;
globalThis.collectVskMarkers = collectVskMarkers;
globalThis.createLayoutSlot = createLayoutSlot;
globalThis.LoadingIndicator = LoadingIndicator;
globalThis.NavLink = NavLink;
globalThis.Link = Link;
globalThis.Form = Form;
globalThis.Field = Field;
globalThis.required = required;
globalThis.email = email;
globalThis.minLength = minLength;
globalThis.defineAction = defineAction;
globalThis.primitive = primitive;
globalThis.leaf = leaf;
globalThis.reconcile = reconcile;
globalThis.reconcileHydrated = reconcileHydrated;
globalThis.Md = Md;
globalThis.NotFoundError = NotFoundError;
globalThis.createStore = createStore;
function __cleanup(start, end) {
	let n = start.nextSibling;
	while (n && n !== end) {
		const next = n.nextSibling;
		n.remove();
		n = next;
	}
}
function __place(start, end, nodes, fallback) {
	if (start.parentNode !== null) {
		const p = start.parentNode;
		for (let i = 0; i < nodes.length; i++) p.insertBefore(nodes[i], end);
		return;
	}
	if (nodes.length > 0 && nodes[0].parentNode) {
		const p = nodes[0].parentNode;
		p.insertBefore(start, nodes[0]);
		p.insertBefore(end, nodes[nodes.length - 1].nextSibling);
		// Client-surplus nodes (SSR rendered fewer items than the client data)
		// are freshly claimed and still detached — move them into the region in
		// client order before `end`, instead of stranding them off-parent.
		for (let i = 0; i < nodes.length; i++) {
			if (nodes[i].parentNode === null) p.insertBefore(nodes[i], end);
		}
		return;
	}
	fallback.appendChild(start);
	fallback.appendChild(end);
	for (let i = 0; i < nodes.length; i++) fallback.insertBefore(nodes[i], end);
}
globalThis.__components = __components;
function __resolveNames(nodes) {
  for (const n of nodes) {
    if (n.chunk) n._chunk = n.chunk;
    if (n.chunkError) n._chunkError = n.chunkError;
    if (typeof n.page === 'string') n._pageName = n.page;
    if (typeof n.layout === 'string') n._layoutName = n.layout;
    if (typeof n.error === 'string') n._errorName = n.error;
    if (typeof n.notFound === 'string') n._notFoundName = n.notFound;
    if (typeof n.offline === 'string') n._offlineName = n.offline;
    if (typeof n.network === 'string') n._networkName = n.network;
    if (n.children) __resolveNames(n.children);
  }
}
function __updateComponents(nodes) {
  for (const n of nodes) {
    if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName];
    if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName];
    if (n._errorName && __components[n._errorName]) n.error = __components[n._errorName];
    if (n._notFoundName && __components[n._notFoundName]) n.notFound = __components[n._notFoundName];
    if (n._offlineName && __components[n._offlineName]) n.offline = __components[n._offlineName];
    if (n._networkName && __components[n._networkName]) n.network = __components[n._networkName];
    if (n.children) __updateComponents(n.children);
  }
}
const __routeTree = [{"path":"","fullPath":"/","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Index","layout":"Layout_Index","loading":null,"error":"Error_Index","notFound":"NotFound_Index","offline":null,"network":null,"hasMiddleware":true,"children":[{"path":"about","fullPath":"/about","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_About","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/about","segmentCount":1,"chunk":"/_vesk/static/page-about.dbb840ce62.js"},{"path":"actions","fullPath":"/actions","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Actions","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/actions","segmentCount":1,"chunk":"/_vesk/static/page-actions.7f2305e9f2.js"},{"path":"apierr","fullPath":"/apierr","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Apierr","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/apierr","segmentCount":1,"chunk":"/_vesk/static/page-apierr.4ea23cf30e.js"},{"path":"async","fullPath":"/async","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Async","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/async","segmentCount":1,"chunk":"/_vesk/static/page-async.6705765ac1.js"},{"path":"blocknav","fullPath":"/blocknav","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Blocknav","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/blocknav","segmentCount":1,"chunk":"/_vesk/static/page-blocknav.024c2a5b4b.js"},{"path":"blog","fullPath":"/blog","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Blog","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":true,"children":[{"path":":slug","fullPath":"/blog/:slug","isGroup":false,"isDynamic":true,"isCatchAll":false,"page":"Page_Blog_slug","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/blog/[slug]","segmentCount":1,"chunk":"/_vesk/static/page-blog-_slug_.3d3e7ca3fd.js"}],"sourceDir":"/root/vesk/test-app/app/blog","segmentCount":1,"chunk":"/_vesk/static/page-blog.c46ac83d08.js"},{"path":"broken","fullPath":"/broken","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Broken","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/broken","segmentCount":1,"chunk":"/_vesk/static/page-broken.b004af6291.js"},{"path":"comp-test","fullPath":"/comp-test","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Comp-test","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/comp-test","segmentCount":1,"chunk":"/_vesk/static/page-comp-test.71df0862bc.js"},{"path":"dataerror","fullPath":"/dataerror","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Dataerror","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/dataerror","segmentCount":1,"chunk":"/_vesk/static/page-dataerror.aedaed928e.js"},{"path":"elif","fullPath":"/elif","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Elif","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/elif","segmentCount":1,"chunk":"/_vesk/static/page-elif.f079cc463b.js"},{"path":"empty","fullPath":"/empty","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Empty","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/empty","segmentCount":1,"chunk":"/_vesk/static/page-empty.f835b9dafa.js"},{"path":"guardtest","fullPath":"/guardtest","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Guardtest","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/guardtest","segmentCount":1,"chunk":"/_vesk/static/page-guardtest.86373d1d02.js"},{"path":"lobby","fullPath":"/lobby","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Lobby","layout":"Layout_Lobby","loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[{"path":"deep","fullPath":"/lobby/deep","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Lobby_deep","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/lobby/deep","segmentCount":1,"chunk":"/_vesk/static/page-lobby-deep.0877cf109d.js"}],"sourceDir":"/root/vesk/test-app/app/lobby","segmentCount":1,"standalone":true,"chunk":"/_vesk/static/page-lobby.52662840cd.js"},{"path":"map","fullPath":"/map","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Map","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/map","segmentCount":1,"chunk":"/_vesk/static/page-map.e405d29bb3.js"},{"path":"md","fullPath":"/md","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Md","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/md","segmentCount":1,"chunk":"/_vesk/static/page-md.7b3f7b5cb6.js"},{"path":"md-html","fullPath":"/md-html","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Md-html","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/md-html","segmentCount":1,"chunk":"/_vesk/static/page-md-html.8a79d717d9.js"},{"path":"portal","fullPath":"/portal","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Portal","layout":"Layout_Portal","loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[{"path":"guides","fullPath":"/portal/guides","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Portal_guides","layout":"Layout_Portal_guides","loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/portal/guides","segmentCount":1,"chunk":"/_vesk/static/page-portal-guides.b03aba4db5.js"}],"sourceDir":"/root/vesk/test-app/app/portal","segmentCount":1,"chunk":"/_vesk/static/page-portal.d527aa362a.js"},{"path":"posts","fullPath":"/posts","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Posts","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/posts","segmentCount":1,"chunk":"/_vesk/static/page-posts.aad25b96f6.js"},{"path":"root-components","fullPath":"/root-components","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Root-components","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/root-components","segmentCount":1,"chunk":"/_vesk/static/page-root-components.707b434500.js"},{"path":"standalonedep","fullPath":"/standalonedep","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Standalonedep","layout":"Layout_Standalonedep","loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/standalonedep","segmentCount":1,"standalone":true,"chunk":"/_vesk/static/page-standalonedep.ebfdb6fc67.js"},{"path":"statements","fullPath":"/statements","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Statements","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/statements","segmentCount":1,"chunk":"/_vesk/static/page-statements.cabf6b797a.js"},{"path":"store","fullPath":"/store","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Store","layout":"Layout_Store","loading":null,"error":"Error_Store","notFound":"NotFound_Store","offline":null,"network":null,"hasMiddleware":false,"children":[{"path":":item","fullPath":"/store/:item","isGroup":false,"isDynamic":true,"isCatchAll":false,"page":"Page_Store_item","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/store/[item]","segmentCount":1,"chunk":"/_vesk/static/page-store-_item_.d0210791f5.js"}],"sourceDir":"/root/vesk/test-app/app/store","segmentCount":1,"chunk":"/_vesk/static/page-store.9722a1788b.js"},{"path":"store-api","fullPath":"/store-api","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Store-api","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/store-api","segmentCount":1,"chunk":"/_vesk/static/page-store-api.69eddcf557.js"},{"path":"typed","fullPath":"/typed","isGroup":false,"isDynamic":false,"isCatchAll":false,"page":"Page_Typed","layout":null,"loading":null,"error":null,"notFound":null,"offline":null,"network":null,"hasMiddleware":false,"children":[],"sourceDir":"/root/vesk/test-app/app/typed","segmentCount":1,"chunk":"/_vesk/static/page-typed.5e66ae2f3f.js"}],"sourceDir":"/root/vesk/test-app/app","segmentCount":0,"chunk":"/_vesk/static/page-index.7519e4b421.js"}];
__resolveNames(__routeTree);
const __pendChunks = [];
const __currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
if (typeof matchRoute === 'function') {
  const __currentMatch = matchRoute(__routeTree, __currentPath);
  if (__currentMatch) {
    for (const n of __currentMatch.matchChain) {
      if (n._chunk && !__pendChunks.includes(n._chunk)) __pendChunks.push(n._chunk);
    }
  }
}
const __startRouter = function() {
  __updateComponents(__routeTree);
  const __router = createFileRouter(__routeTree);
  __router.__hydrators = __hydrators;
  __router.__updateComponents = __updateComponents;
  globalThis.__vesk_router = __router;
  if (typeof document !== 'undefined') __router.start();
};
if (__pendChunks.length > 0 && typeof ensureChunk === 'function') {
  Promise.all(__pendChunks.map(u => ensureChunk(u).catch(() => undefined))).then(__startRouter);
} else {
  __startRouter();
}
