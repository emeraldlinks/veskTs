import { track, flush_sync } from './ripple-runtime.js';
import type { StoreMiddleware } from '@vesk/types';
import { readPersistedStorage, writePersistedStorage, clearPersistedStorage } from './store-persistence.js';

/**
 * @typedef Subscriber
 * A callback that receives the current store state or derived value.
 * @example
 * const unsub = store.subscribe(state => console.log(state));
 */
type Subscriber<T> = (value: T) => void;

/**
 * @typedef StoreOptions
 * Options for creating a store.
 * @property persist Whether to persist store in localStorage (default: false)
 * @property storageKey The key to use in localStorage if persist is true
 * @property devtools Whether to send devtools events (default: false)
 */
interface StoreOptions {
  persist?: boolean;
  storageKey?: string;
  devtools?: boolean;
}

/**
 * @typedef Middleware
 * A function that runs before or after each update.
 * @param state Current state of the store
 * @param action Optional string describing the event
 * @param payload Optional data passed to update/set
 */
type Middleware<T> = StoreMiddleware<T>;

/**
 * Clone store state by kind. A plain object spread turns an array into a plain
 * object (`{ ...[1, 2, 3] }` is `{"0":1,"1":2,"2":3}`), so a store seeded with
 * an array handed back a corrupted, non-array value from `get()` — before any
 * mutation, and again on every `reset()`/`clear()`/`rehydrate()`. Arrays are
 * copied with `slice()` so they stay arrays.
 */
function cloneState<T>(value: T): T {
  return (Array.isArray(value)
    ? (value as unknown[]).slice()
    : { ...value }) as T;
}

/**
 * @function createStore
 * Creates a reactive store with optional persistence and tools like watch & middleware.
 *
 * @param initial The initial state object (or array)
 * @param options Optional store options
 * @returns Store API with get, set, update, delete, subscribe, derive, watch, use, clear, batch, reset, rehydrate, toJSON
 *
 * @example
 * const counterStore = createStore({ count: 0 });
 */
export function createStore<T extends object>(
  initial: T,
  options: StoreOptions = {}
) {
  const { persist = false, storageKey, devtools = false } = options;

  // Load persisted state if enabled — on the server this reads through the
  // adapter-installed hook (request cookie) and registers the key for the
  // pre-paint script; on the client it prefers the pre-painted
  // `window.__VESK_STORE_INIT__` value, then localStorage. Fallback: seed.
  let value: T = cloneState(initial);
  if (persist && storageKey) {
    const stored = readPersistedStorage(storageKey);
    if (stored) {
      try {
        value = JSON.parse(stored);
      } catch {}
    }
  }

  // Reactive cell holding the state
  const stateCell = track(value);

  const subs = new Set<Subscriber<T>>();
  const watchers: {
    selector: (state: T) => any;
    cb: (newVal: any, oldVal: any) => void;
    equals?: (a: any, b: any) => boolean;
  }[] = [];
  const middlewares: Middleware<T>[] = [];

  let prevValue = cloneState(value);

  // Batching state
  let batchDepth = 0;
  let dirty = false;

  /** Notify subscribers and watchers immediately (used when not batching) */
  function notifyNow(action?: string, payload?: any) {
    const current = stateCell.get();
    // Only notify if state changed (reference equality)
    if (current === prevValue) return;

    // Notify subscribers
    subs.forEach(fn => fn(current));
    // Notify watchers
    watchers.forEach(({ selector, cb, equals }) => {
      const eq = equals ?? Object.is;
      const newVal = selector(current);
      const oldVal = selector(prevValue);
      if (!eq(newVal, oldVal)) cb(newVal, oldVal);
    });
    // Notify middlewares
    middlewares.forEach(fn => fn(current, action, payload));
    // Devtools hook
    if (devtools && typeof window !== "undefined") {
      const dt = (window as any).__VESK_STORE_DEVTOOLS__;
      if (dt && typeof dt.send === "function") {
        dt.send({ type: action, payload, state: structuredClone(current) });
      }
    }
    // Update prevValue
    prevValue = cloneState(current);
  }

  /** Called by mutators to signal that a change occurred */
  function notifyDirty(action?: string, payload?: any) {
    if (batchDepth > 0) {
      dirty = true;
    } else {
      notifyNow(action, payload);
    }
  }

  /** Persist current state if enabled — localStorage plus a same-site cookie
   *  mirror so the next SSR render serves the user's actual value. */
  function persistToStorage() {
    if (persist && storageKey) {
      try {
        writePersistedStorage(storageKey, JSON.stringify(stateCell.get()));
      } catch (err) {
        console.log("error saving to localStorage: ", err);
      }
    }
  }

  /** @function get — Returns the current store state */
  function get(): T {
    return stateCell.get();
  }

  /** @function set — Replaces the entire store state */
  function set(next: T, action = "set") {
    stateCell.set(next);
    persistToStorage();
    notifyDirty(action, next);
  }

  /**
   * @function update
   * Merges a partial object or uses a callback to modify the current state.
   *
   * - Object patch: `store.update({ count: 1 })`
   * - Callback style: `store.update(prev => ({ count: prev.count + 1 }))`
   */
  function update(partial: Partial<T>): void;
  function update(partialFn: (prev: T) => Partial<T>): void;
  function update(
    partialOrFn: Partial<T> | ((prev: T) => Partial<T>),
    action = "update"
  ) {
    const current = stateCell.get();
    const patch =
      typeof partialOrFn === "function" ? partialOrFn(current) : partialOrFn;
    // `Object.assign` onto the clone rather than an object spread: for an
    // array store the merge stays an array and patches land on indexes,
    // instead of degrading into `{"0": …}`.
    const next = Object.assign(cloneState(current), patch) as T;
    stateCell.set(next);
    persistToStorage();
    notifyDirty(action, patch);
  }

  /** @function delete — Removes one or multiple keys from the store */
  function deleteKeys(keys: (keyof T) | (keyof T)[], action = "delete") {
    const current = stateCell.get();
    const kArray = Array.isArray(keys) ? keys : [keys];
    const next = cloneState(current);
    kArray.forEach(k => {
      delete (next as any)[k];
    });
    stateCell.set(next);
    persistToStorage();
    notifyDirty(action, keys);
  }

  /** @function reset — Resets state to the original initial value (does not affect persistence) */
  function reset() {
    stateCell.set(cloneState(initial));
    notifyDirty("reset");
  }

  /** @function rehydrate — Merges new initial state and updates store (keeps same identity) */
  function rehydrate(newInitial: Partial<T>) {
    Object.assign(initial, newInitial);
    stateCell.set(cloneState(initial));
    notifyDirty("rehydrate");
  }

  /** @function clear — Clears both state and its localStorage record */
  function clear() {
    stateCell.set(cloneState(initial));
    if (persist && storageKey) {
      clearPersistedStorage(storageKey);
    }
    notifyDirty("clear");
  }

  /** @function batch — Runs a batch of synchronous store operations, delaying subscribers until after. */
  function batch<R>(fn: () => R): R {
    batchDepth++;
    try {
      return flush_sync(fn) as R;
    } finally {
      batchDepth--;
      if (batchDepth === 0 && dirty) {
        notifyDirty("batch");
        dirty = false;
      }
    }
  }

  /** @function subscribe
   * Subscribes to all store changes (full state or a selected part).
   *
   * @param {Function} fn Callback to receive state or selected part
   * @param {Function} [selector] Optional selector to receive subset
   *
   * @example
   * store.subscribe(s => console.log(s)); // full state
   * store.subscribe(s => console.log(s.theme), s => s.theme); // only theme
   */
  function subscribe(
    fn: Subscriber<T>,
    selector?: (state: T) => any,
    equals?: (a: any, b: any) => boolean
  ) {
    const eq = equals ?? Object.is;
    let hasPrev = false;
    let prev: unknown;
    const wrapper = selector
      ? (state: T) => {
          const selected = selector(state);
          if (!hasPrev || !eq(selected, prev)) {
            hasPrev = true;
            prev = selected;
            fn(selected);
          }
        }
      : fn;
    subs.add(wrapper);
    wrapper(stateCell.get()); // initial call
    return () => subs.delete(wrapper);
  }

  /**
   * @function watch
   * Watches a specific value in the store and runs callback when it changes.
   * Provides both new and old values.
   *
   * @param {Function} selector Function selecting what to watch
   * @param {Function} callback Called with (newValue, oldValue)
   * @param {Function} [equals] Optional equality function (defaults to Object.is)
   *
   * @example
   * store.watch(s => s.count, (n, o) => console.log(`count: ${o} → ${n}`));
   */
  function watch<K>(
    selector: (s: T) => K,
    callback: (n: K, o: K) => void,
    equals?: (a: K, b: K) => boolean
  ) {
    watchers.push({ selector, cb: callback, equals });
    return () => {
      const i = watchers.findIndex(w => w.cb === callback);
      if (i >= 0) watchers.splice(i, 1);
    };
  }

  /**
   * @function use
   * Adds middleware to run on every state change.
   *
   * Middleware is for logging, analytics, or side effects.
   *
   * @param {Function} middleware Function with (state, action?, payload?)
   *
   * @example
   * store.use((s, action) => console.log(`[${action}]`, s));
   */
  function use(middleware: Middleware<T>) {
    middlewares.push(middleware);
    return () => {
      const i = middlewares.indexOf(middleware);
      if (i >= 0) middlewares.splice(i, 1);
    };
  }

  /**
   * @function derive
   * Creates a derived store that reacts to changes in selected parts of the state.
   *
   * @example
   * const themeStore = store.derive(s => s.theme);
   * themeStore.subscribe(v => console.log("theme:", v));
   */
  function derive<K>(
    selector: (s: T) => K,
    equals?: (a: K, b: K) => boolean
  ) {
    return {
      subscribe(cb: (v: K) => void) {
        return subscribe(
          (v: unknown) => cb(v as K),
          selector,
          equals as ((a: unknown, b: unknown) => boolean) | undefined
        );
      },
    };
  }

  /** @function toJSON — Returns a deep copy of the current state for debugging */
  function toJSON() {
    return structuredClone(stateCell.get());
  }

  return {
    get,
    set,
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
    toJSON,
  };
}

// -------------------- Example Stores --------------------
//
// Commented out on purpose: a top-level `createStore(...)` is a side effect,
// so shipping ready-made example stores here would force `store.ts` into every
// client runtime bundle — the tree-shaker cannot drop a module whose top level
// runs anything. `createStore` is imported on demand and stays tree-shaken.
// Build your own with `createStore({ ... })`.

// /**
//  * This provides a basic store for your app like theme, user etc.
//  * It's an example which you can delete;
//  */
// export const appStore = createStore(
//   {
//     user: { name: "Joe", location: "unknown", preferences: [] },
//     count: 0,
//     theme: "dark",
//   },
//   { persist: true, storageKey: "appStore" }
// );

// export const routeStore = createStore(
//   { path: "/" },
//   { persist: true, storageKey: "routeStore" }
// );
