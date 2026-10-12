/**
 * Path Store — a fine-grained reactive store whose every value knows *why* it
 * holds what it holds.
 *
 * Three things no mainstream store offers together:
 *
 * 1. **Path-level fine-grained reactivity.** `store.at('user.name')` is its own
 *    dependency. Reading it inside a binding re-runs only when `user.name`
 *    (or an ancestor that replaces it) changes — not on every store write.
 *    Whole-state writes are reconciled onto the existing path cells.
 *
 * 2. **A queryable causal graph.** Every commit records the action that produced
 *    it and the leaf paths it changed. `derived()` nodes are evaluated against a
 *    read-recording proxy, so their dependencies are captured automatically.
 *    The proxy also records an *envelope* dependency on the owning array when a
 *    selector scans an array (element reads or `.length`), so aggregate
 *    derivatives over arrays re-run on append/remove — not only on the element
 *    leaves that happened to exist on the last evaluation. `store.why(path)`
 *    walks the graph and answers "because action X wrote `items.3`".
 *
 * 3. **Structural-sharing time travel.** Immutable writes mean each version's
 *    snapshot shares untouched subtrees with its neighbours, so a full history
 *    costs only the changed spine. `undo` / `redo` restore a version.
 *
 * Reactivity contract (does NOT conflict with the ripple engine):
 * - Path cells are real ripple `track()` cells, so `at(path).get()` and
 *   `derived` reads are first-class reactive reads in `.vsk` bindings.
 * - ALL internal bookkeeping — commit, cell reconciliation, derived
 *   evaluation, time-travel restore — runs inside `untrack(...)`. Writing
 *   inside an effect therefore never subscribes that effect to unrelated
 *   paths, and derived selectors never inherit the caller's reactive scope.
 * - Deriving a value reads plain state through a recording proxy; it does not
 *   subscribe to anything itself.
 *
 * Tightness:
 * - A path-local write (`at(path).set`, `setIn`, `updateIn`) diffs ONLY the
 *   subtree under that path (the touched spine), not the whole tree, then
 *   reconciles only the cells on the touched spine and its descendants.
 * - Derived invalidation goes through a dependency trie: a commit visits the
 *   deriveds whose deps are prefix/descendant-related to its changed paths —
 *   no O(derived × changes) scan.
 * - Exotic values (Date, Map, Set, RegExp, typed arrays) survive state
 *   cloning; the internal state is kept immutable.
 *
 * SSR + persistence:
 * - Same shared mechanism as `@vesk/runtime/store` (see `store-persistence.ts`):
 *   on the server a persisted store reads its value through the
 *   adapter-installed read hook (typically a request cookie), so SSR HTML
 *   renders the user's actual state (no theme flash, SEO-correct).
 * - Constructed persisted keys are registered so the adapter can emit a tiny
 *   blocking `<head>` script that moves each persisted localStorage value into
 *   `window.__VESK_STORE_INIT__` before first paint (served at
 *   `/store-init.js?t=<token>`, never inlined — CSP-safe). The store init
 *   prefers that value, so hydration never flashes the default state. Client
 *   writes mirror to a same-site cookie for the next render.
 *
 * SSR-safe, no DOM at module scope, and never imports the deprecated `batch`.
 */
import { track, untrack } from './ripple-runtime.js';
import type { Tracked } from './ripple-runtime.js';
import { getIn, setIn, updateIn } from './nested-update.js';
import type { Path as Segments } from './nested-update.js';
import {
	installPersistedStoreServerHooks as _installPersistedStoreServerHooks,
	persistedStoreCookieName,
	getPersistedStoreKeys as _getPersistedStoreKeys,
	resetPersistedStoreKeys as _resetPersistedStoreKeys,
	buildStorePrePaintPayload as _buildStorePrePaintPayload,
	readPersistedStorage,
	writePersistedStorage,
	clearPersistedStorage,
} from './store-persistence.js';

/* ── types ─────────────────────────────────────────────────────────────── */

type Prev = [never, 0, 1, 2, 3, 4, 5, 6];

/**
 * Every statically-known path into `T`, as a dotted string with numeric
 * segments for array indices: `'user.name'`, `'items.0.done'`. Depth is capped
 * (default 6) to keep the union finite for recursive types.
 */
export type StorePath<T, D extends number = 6> = [D] extends [never]
	? never
	: T extends readonly unknown[]
		? `${number}` | `${number}.${StorePath<T[number], Prev[D]>}`
		: T extends object
			? {
					[K in keyof T & string]: T[K] extends object | readonly unknown[]
						? K | `${K}.${StorePath<T[K], Prev[D]>}`
						: K;
				}[keyof T & string]
			: never;

/** The value type at path `P` in `T`. */
export type StorePathValue<T, P extends string> = P extends `${infer K}.${infer R}`
	? K extends `${number}`
		? T extends readonly (infer U)[]
			? StorePathValue<U, R>
			: never
		: K extends keyof T
			? StorePathValue<T[K], R>
			: never
	: P extends `${number}`
		? T extends readonly (infer U)[]
			? U
			: never
		: P extends keyof T
			? T[P]
			: never;

/** A read/write handle for one path. `get()` subscribes; `set()` commits. */
export interface PathHandle<V> {
	readonly path: string;
	/** Reactive read — subscribes the surrounding reaction to this path. */
	get(): V;
	/** Commit a new value at this path (attributed to `action`). */
	set(value: V, action?: string): void;
	/** Commit `fn(current)` at this path. */
	update(fn: (current: V) => V, action?: string): void;
	/** Path-scoped subscription: only fires when this path's value changes. */
	subscribe(cb: (value: V) => void): () => void;
}

/** A read-only derived handle. Values are computed — there is no `set`. */
export interface DerivedHandle<V> {
	readonly path: string;
	/** The source paths the selector read on its last evaluation. */
	readonly deps: string[];
	/** Reactive read of the computed value. */
	get(): V;
	/** Fires only when the computed value changes. */
	subscribe(cb: (value: V) => void): () => void;
}

/** One changed path within a commit. */
export interface PathStoreChange {
	path: string;
	before: unknown;
	after: unknown;
}

/** One recorded commit, oldest first. */
export interface PathStoreEvent {
	version: number;
	action: string;
	at: number;
	changes: PathStoreChange[];
}

/** One link in a `why()` explanation. */
export interface PathExplanation {
	path: string;
	value: unknown;
	cause: 'initial' | 'action' | 'derived' | 'time-travel';
	action?: string;
	version?: number;
	/** For `cause: 'derived'`, the source paths the derived node read. */
	from?: PathExplanation[];
	/** For derived/time-travel nodes: the changes that actually triggered the last recompute. */
	changedBy?: PathExplanation[];
}

export interface PathStoreOptions {
	/** Persist state to localStorage and a server-readable cookie (guarded for SSR). */
	persist?: boolean;
	storageKey?: string;
	/** Max events retained in `events`/undo stack (default 500). */
	historyLimit?: number;
}

/* ── SSR persistence hooks (shared with createStore — see store-persistence.ts) ── */

/** Install server-side persistence hooks (adapter calls this; shared with
 *  `@vesk/runtime/store`). */
export const installPathStoreServerHooks = _installPersistedStoreServerHooks;

/** The cookie name a persisted store is mirrored to, for SSR continuity. */
export { persistedStoreCookieName };

/** The storage keys of persisted stores constructed in this server render. */
export const getPersistedStoreKeys = _getPersistedStoreKeys;

/** Clear the constructed-key registry (called per SSR request by the adapter). */
export const resetPersistedStoreKeys = _resetPersistedStoreKeys;

/** Plain-JS body the adapter serves at `/store-init.js?t=<token>` (CSP-safe,
 *  never inlined) to populate `window.__VESK_STORE_INIT__` before first paint. */
export { _buildStorePrePaintPayload as buildStorePrePaintPayload };

/* ── path + value helpers (character scanners — no regex) ──────────────── */

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object';
}

/** True when `s` is non-empty and made of decimal digits. */
function isDigits(s: string): boolean {
	if (s.length === 0) return false;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 48 || c > 57) return false;
	}
	return true;
}

/**
 * Parse a human path string into segments. `'items[0].done'` → `['items', 0,
 * 'done']`. A character loop, consistent with the runtime tokenizer style.
 */
export function parseStorePath(input: string): Segments {
	const tokens: Segments = [];
	let i = 0;
	const n = input.length;

	const readBracketed = (): void => {
		i++; // consume '['
		let start = i;
		while (i < n && input[i] >= '0' && input[i] <= '9') i++;
		if (start === i || input[i] !== ']') {
			throw new Error(`Path store: bad index in path "${input}"`);
		}
		tokens.push(Number(input.slice(start, i)));
		i++; // consume ']'
	};

	while (i < n) {
		const c = input[i];
		if (c === '.') {
			i++;
			continue;
		}
		if (c === '[') {
			readBracketed();
			continue;
		}
		let start = i;
		while (i < n && input[i] !== '.' && input[i] !== '[') i++;
		tokens.push(input.slice(start, i));
	}
	return tokens;
}

function pathKey(tokens: Segments): string {
	return tokens.join('\u0000');
}

function tokensOfKey(key: string): Segments {
	if (key === '') return [];
	return key.split('\u0000').map((t) => (isDigits(t) ? Number(t) : t));
}

function isPrefix(prefix: Segments, full: Segments): boolean {
	if (prefix.length > full.length) return false;
	for (let i = 0; i < prefix.length; i++) {
		if (String(prefix[i]) !== String(full[i])) return false;
	}
	return true;
}

function isStrictPrefix(prefix: Segments, full: Segments): boolean {
	return prefix.length > 0 && prefix.length < full.length && isPrefix(prefix, full);
}

/** Clone preserving prototypes: Date, RegExp, Map, Set, typed arrays, and
 *  plain objects/arrays. Other class instances are structured-cloned when
 *  possible and otherwise shared by reference (documented: exotic objects
 *  defined outside the store may be shared, never mutated by the store). */
function cloneValue<T>(value: T, seen?: Map<unknown, unknown>): T {
	if (value === null || typeof value !== 'object') return value;
	seen = seen ?? new Map();
	const existing = seen.get(value);
	if (existing !== undefined) return existing as T;
	if (value instanceof Date) {
		const d = new Date(value.getTime());
		seen.set(value, d);
		return d as unknown as T;
	}
	if (value instanceof RegExp) {
		const r = new RegExp(value.source, value.flags);
		seen.set(value, r);
		return r as unknown as T;
	}
	if (value instanceof Map) {
		const out = new Map<unknown, unknown>();
		seen.set(value, out);
		for (const [k, v] of value) out.set(cloneValue(k, seen), cloneValue(v, seen));
		return out as unknown as T;
	}
	if (value instanceof Set) {
		const out = new Set<unknown>();
		seen.set(value, out);
		for (const v of value) out.add(cloneValue(v, seen));
		return out as unknown as T;
	}
	if (Array.isArray(value)) {
		const out: unknown[] = [];
		seen.set(value, out);
		for (const item of value) out.push(cloneValue(item, seen));
		return out as unknown as T;
	}
	if (ArrayBuffer.isView(value)) {
		const out = (value as unknown as Uint8Array).slice();
		seen.set(value, out);
		return out as unknown as T;
	}
	const proto = Object.getPrototypeOf(value);
	if (proto === Object.prototype || proto === null) {
		const out: Record<string, unknown> = {};
		seen.set(value, out);
		for (const key of Object.keys(value)) {
			out[key] = cloneValue((value as Record<string, unknown>)[key], seen);
		}
		return out as unknown as T;
	}
	// Class instance or exotic host object: keep it intact (never mutated by
	// the store). structuredClone first, share by reference when it fails.
	seen.set(value, value);
	try {
		return structuredClone(value);
	} catch {
		return value;
	}
}

/** JSON-safe snapshot conversion for `toJSON`: Date→ISO string, Map/Set→
 *  arrays, other objects stay plain. Throws only on genuinely unserializable
 *  input (functions, cycles); callers guard with a JSON round-trip. */
function plainClone<T>(value: T, seen?: Set<unknown>): unknown {
	if (value === null || typeof value !== 'object') return value;
	seen = seen ?? new Set();
	if (seen.has(value)) throw new Error('Path store: toJSON() cannot serialize cyclic state');
	seen.add(value);
	if (value instanceof Date) return value.toISOString();
	if (value instanceof RegExp) return String(value);
	if (value instanceof Map) {
		const out: unknown[][] = [];
		for (const [k, v] of value) out.push([plainClone(k, seen), plainClone(v, seen)]);
		return out;
	}
	if (value instanceof Set) {
		const out: unknown[] = [];
		for (const v of value) out.push(plainClone(v, seen));
		return out;
	}
	if (Array.isArray(value)) {
		const out: unknown[] = [];
		for (const item of value) out.push(plainClone(item, seen));
		return out;
	}
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(value)) {
		out[key] = plainClone((value as Record<string, unknown>)[key], seen);
	}
	return out;
}

/** Leaf diff of two subtrees, rooted at `base`. Only paths whose *value*
 * identity differs are reported. */
function shallowDiff(
	before: unknown,
	after: unknown,
	base: Segments,
	out: PathStoreChange[]
): void {
	if (Object.is(before, after)) return;
	const beforeObj = isObject(before);
	const afterObj = isObject(after);
	if (!beforeObj || !afterObj || Array.isArray(before) !== Array.isArray(after)) {
		out.push({ path: pathKey(base), before, after });
		return;
	}
	const array = Array.isArray(before);
	const keys = new Set<string>([
		...Object.keys(before as object),
		...Object.keys(after as object),
	]);
	for (const key of keys) {
		const segment: string | number = array && isDigits(key) ? Number(key) : key;
		shallowDiff(
			(before as Record<string, unknown>)[key],
			(after as Record<string, unknown>)[key],
			[...base, segment],
			out
		);
	}
}

/* ── implementation ────────────────────────────────────────────────────── */

export function createPathStore<T extends object>(
	initial: T,
	options: PathStoreOptions = {}
) {
	const { persist = false, storageKey, historyLimit = 500 } = options;

	/* Initial state: prefer persisted value on the client (pre-paint or
	 * localStorage), SSR hook on the server, else the shipped seed. A shallow
	 * merge keeps fields added by newer app versions. */
	let state: T = cloneValue(initial);

	if (persist && storageKey) {
		const raw = readPersistedStorage(storageKey);
		if (raw) {
			try {
				const parsed = JSON.parse(raw) as unknown;
				if (parsed !== null && typeof parsed === 'object') {
					state = { ...state, ...cloneValue(parsed) } as T;
				}
			} catch {
				/* corrupt payload — fall back to the shipped seed */
			}
		}
	}

	const rootCell: Tracked<T> = track(state);

	/* Path cells live in a trie so a commit can reconcile only the touched
	 * spine and its descendants instead of walking every created cell. */
	interface CellNode {
		cell?: Tracked<unknown>;
		children?: Map<string, CellNode>;
	}
	const cellRoot: CellNode = {};

	function nodeFor(path: Segments, create: boolean): CellNode | null {
		let node = cellRoot;
		for (const seg of path) {
			const key = String(seg);
			let child = node.children?.get(key);
			if (!child) {
				if (!create) return null;
				child = {};
				if (!node.children) node.children = new Map();
				node.children.set(key, child);
			}
			node = child;
		}
		return node;
	}

	function cellFor(path: Segments): Tracked<unknown> {
		const node = nodeFor(path, true)!;
		if (!node.cell) {
			node.cell = track(getIn(state, path));
			setImprint(node, path);
		}
		return node.cell;
	}

	function collectCellNodes(node: CellNode | null): CellNode[] {
		const out: CellNode[] = [];
		if (!node) return out;
		const stack: CellNode[] = [node];
		while (stack.length > 0) {
			const n = stack.pop()!;
			if (n.cell) out.push(n);
			if (n.children) for (const child of n.children.values()) stack.push(child);
		}
		return out;
	}

	/** Nodes whose path is an ancestor of (or equal to, or under) `path`. */
	function cellsRelatedTo(path: Segments): CellNode[] {
		const out: CellNode[] = [];
		const tNode = nodeFor(path, false);
		out.push(...collectCellNodes(tNode));
		for (let i = path.length - 1; i > 0; i--) {
			const ancestor = nodeFor(path.slice(0, i), false);
			if (ancestor?.cell) out.push(ancestor);
		}
		return out;
	}

	function syncCell(node: CellNode, path: Segments): void {
		const cell = node.cell!;
		const next = getIn(state, path);
		if (!Object.is(cell.get(), next)) cell.set(next);
	}

	/** Reconcile cells after a commit. `touched` is the write's own path when
	 *  known — only that spine and its subtree are visited. */
	function syncPathCells(touched: Segments | null): void {
		if (touched === null) {
			// Whole-state write: every created cell re-reads from the new state.
			for (const node of collectCellNodes(cellRoot)) {
				if (node.cell) syncCell(node, nodePathOf(node));
			}
			return;
		}
		for (const node of cellsRelatedTo(touched)) {
			if (!node.cell) continue;
			syncCell(node, nodePathOf(node));
		}
	}

	/** Recover a node's path by walking its position in the trie parent map. */
	function nodePathOf(node: CellNode): Segments {
		return nodePathCache.get(node) ?? [];
	}

	/* Maintain a cheap parent→path imprint so `nodePathOf` is O(depth) without
	 * a second data structure detail leaking into recompute. Nodes are keyed by
	 * identity; `setImprint` runs when a cell is created. */
	const nodePathCache = new Map<CellNode, Segments>();
	function setImprint(node: CellNode, path: Segments): void {
		nodePathCache.set(node, path.slice());
	}

	interface DerivedDef {
		path: string;
		tokens: Segments;
		selector: (state: T) => unknown;
		equals: (a: unknown, b: unknown) => boolean;
		cell: Tracked<unknown>;
		deps: Segments[];
		/** The change paths that triggered the last recompute. */
		lastTrigger: Segments[] | null;
		lastTriggerVersion: number;
	}
	const derivedDefs = new Map<string, DerivedDef>();

	/* Dependency trie: defs are hung at the exact node of each of their deps,
	 * so a change path can collect related deriveds in O(depth + output). */
	interface DepNode {
		defs: Set<DerivedDef> | null;
		children?: Map<string, DepNode>;
	}
	const depRoot: DepNode = { defs: null };

	function depNodeFor(tokens: Segments, create: boolean): DepNode | null {
		let node = depRoot;
		for (const seg of tokens) {
			const key = String(seg);
			let child = node.children?.get(key);
			if (!child) {
				if (!create) return null;
				child = { defs: null };
				if (!node.children) node.children = new Map();
				node.children.set(key, child);
			}
			node = child;
		}
		return node;
	}

	function registerDep(def: DerivedDef, tokens: Segments): void {
		const node = depNodeFor(tokens, true)!;
		if (!node.defs) node.defs = new Set();
		node.defs.add(def);
	}

	function unregisterDep(def: DerivedDef, tokens: Segments): void {
		const node = depNodeFor(tokens, false);
		if (node?.defs) {
			node.defs.delete(def);
			if (node.defs.size === 0) node.defs = null;
		}
	}

	function registerDef(def: DerivedDef): void {
		for (const dep of def.deps) registerDep(def, dep);
	}

	function unregisterDef(def: DerivedDef): void {
		for (const dep of def.deps) unregisterDep(def, dep);
	}

	/** All deriveds whose deps are prefix/descendant-related to `path` — the
	 *  exact same relationship as `relate()` on the old flat scan. Fills `out`
	 *  (used for dedup across waves) and returns the collected defs. */
	function derivedsRelatedTo(path: Segments, out: Set<DerivedDef>): DerivedDef[] {
		const n = depNodeFor(path, false);
		if (n) {
			const stack: DepNode[] = [n];
			while (stack.length > 0) {
				const node = stack.pop()!;
				if (node.defs) for (const def of node.defs) out.add(def);
				if (node.children) for (const child of node.children.values()) stack.push(child);
			}
		}
		for (let i = path.length - 1; i > 0; i--) {
			const ancestor = depNodeFor(path.slice(0, i), false);
			if (ancestor?.defs) for (const def of ancestor.defs) out.add(def);
		}
		return Array.from(out);
	}

	/* ── derived evaluation with read-recording + array envelopes ── */

	const COLLAPSE_THRESHOLD = 8;

	/**
	 * Evaluate a derived selector ONCE: inside `untrack` (it must not inherit
	 * the caller's reactive scope), through a read-recording proxy. Array
	 * element reads and `.length` reads also record the owning array path as an
	 * "envelope" dependency, so aggregate derivatives re-run when the array's
	 * membership changes — the leaf-only recording could not see an append.
	 * When more than COLLAPSE_THRESHOLD leaves fall under one envelope, they
	 * collapse to the envelope alone (selectors that scan a big array depend on
	 * the whole array anyway).
	 */
	const proxyTargets = new WeakMap<object, unknown>();

	function evaluate<R>(selector: (s: T) => R): { value: R; deps: Segments[] } {
		return untrack(() => {
			const deps: Segments[] = [];
			const seen = new Set<string>();
			const envelopeLeaves = new Map<string, number>();
			const collapsed = new Set<string>();

			const recordLeaf = (path: Segments): void => {
				const k = pathKey(path);
				if (!seen.has(k)) {
					seen.add(k);
					deps.push(path);
				}
			};

			const recordEnvelope = (env: Segments): void => {
				if (env.length === 0) return;
				const k = pathKey(env);
				const count = (envelopeLeaves.get(k) ?? 0) + 1;
				envelopeLeaves.set(k, count);
				if (count >= COLLAPSE_THRESHOLD) collapsed.add(k);
				recordLeaf(env);
			};

			const isPlain = (value: unknown): boolean =>
				value !== null &&
				typeof value === 'object' &&
				(Array.isArray(value) ||
					Object.prototype.toString.call(value) === '[object Object]');

			const wrap = (value: unknown, base: Segments): unknown => {
				if (!isPlain(value)) return value;
				const proxy = new Proxy(value as object, {
					get(target, prop, receiver) {
						if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
						const array = Array.isArray(target);
						const segment =
							array && isDigits(String(prop)) ? Number(prop) : String(prop);
						const child = base.concat(segment);
						const v = Reflect.get(target, prop, receiver);
						if (isPlain(v)) return wrap(v, child);
						if (typeof v === 'function') return v;
						recordLeaf(child);
						// Element or `.length` reads cross the array membership: an
						// aggregate over the array depends on the array as a whole.
						if (array) recordEnvelope(base);
						return v;
					},
					set() {
						throw new Error('Path store: derived selectors must be pure — no writes.');
					},
				});
				proxyTargets.set(proxy, value);
				return proxy;
			};

			// Replace any recording proxy still embedded in the result with its
			// real target, rebuilding containers only when they held proxies.
			const unwrap = (value: unknown): unknown => {
				if (value === null || typeof value !== 'object') return value;
				const target = proxyTargets.get(value);
				if (target !== undefined) return unwrap(target);
				if (Array.isArray(value)) {
					let changed = false;
					const out: unknown[] = [];
					for (const item of value) {
						const next = unwrap(item);
						if (next !== item) changed = true;
						out.push(next);
					}
					return changed ? out : value;
				}
				let changed = false;
				const out: Record<string, unknown> = {};
				for (const key of Object.keys(value)) {
					const next = unwrap((value as Record<string, unknown>)[key]);
					if (next !== (value as Record<string, unknown>)[key]) changed = true;
					out[key] = next;
				}
				return changed ? out : value;
			};

			const result = selector(wrap(state, []) as T);

			const finalDeps =
				collapsed.size === 0
					? deps
					: deps.filter((d) => {
							for (const envKey of collapsed) {
								if (isStrictPrefix(tokensOfKey(envKey), d)) return false;
							}
							return true;
						});

			return { value: unwrap(result) as R, deps: finalDeps };
		});
	}

	function recomputeDerived(changes: PathStoreChange[], version: number): void {
		const queue: DerivedDef[] = [];
		const queued = new Set<DerivedDef>();
		// `derivedsRelatedTo` fills its own dedup set (so one path's related
		// defs are unique); enqueue through a separate set so a def collected
		// here is still eligible to be processed exactly once below.
		const collect = (tokens: Segments): void => {
			for (const def of derivedsRelatedTo(tokens, new Set())) {
				if (!queued.has(def)) {
					queued.add(def);
					queue.push(def);
				}
			}
		};
		for (const change of changes) collect(tokensOfKey(change.path));
		while (queue.length > 0) {
			const def = queue.pop()!;

			unregisterDef(def);
			const { value, deps } = evaluate(def.selector);
			def.deps = deps;
			registerDef(def);

			const before = def.cell.get();
			if (!def.equals(before, value)) {
				def.cell.set(value);
				def.lastTrigger = changes.map((c) => tokensOfKey(c.path));
				def.lastTriggerVersion = version;
				mergedDirty = true;
				const change: PathStoreChange = { path: def.path, before, after: value };
				changes.push(change);
				collect(def.tokens);
			}
		}
	}

	/* ── merged snapshot (derived values visible in get()/toJSON) ── */

	let mergedCache: T | null = null;
	let mergedDirty = true;

	function invalidateMerged(): void {
		mergedCache = null;
		mergedDirty = true;
	}

	function buildMerged(): T {
		if (!mergedDirty && mergedCache !== null) return mergedCache;
		const base = rootCell.get();
		if (derivedDefs.size === 0) {
			mergedCache = base;
			mergedDirty = false;
			return base;
		}
		let acc = base;
		for (const def of derivedDefs.values()) {
			acc = setIn(acc, def.tokens, def.cell.get()) as T;
		}
		mergedCache = acc;
		mergedDirty = false;
		return acc;
	}

	/* ── history / causality ── */

	const events: PathStoreEvent[] = [];
	let version = 0;
	let undoStack: T[] = [];
	let redoStack: T[] = [];
	/** Per-path last cause — survives the events cap, so `why` never
	 *  mislabels an old-but-written value as `initial`. */
	const lastCause = new Map<string, { action: string; version: number }>();

	function recordCause(changes: PathStoreChange[], action: string, atVersion: number): void {
		for (const change of changes) {
			lastCause.set(change.path, { action, version: atVersion });
		}
	}

	/* ── commit ── */

	function commit(next: T, action: string, touched: Segments | null): void {
		untrack(() => {
			if (Object.is(next, state)) return;

			const changes: PathStoreChange[] = [];
			if (touched !== null) {
				// Path-local write: diff only the touched subtree.
				shallowDiff(getIn(state, touched), getIn(next, touched), touched, changes);
			} else {
				shallowDiff(state, next, [], changes);
			}
			if (changes.length === 0) return;

			undoStack.push(state);
			if (undoStack.length > historyLimit) undoStack.shift();
			redoStack = [];

			state = next;
			rootCell.set(state);
			invalidateMerged();

			const nextVersion = version + 1;
			recordCause(changes, action, nextVersion);
			recomputeDerived(changes, nextVersion);
			syncPathCells(touched);
			dispatchAll();
			persistToStorage();

			version = nextVersion;
			events.push({ version, action, at: Date.now(), changes });
			if (events.length > historyLimit) events.shift();
		});
	}

	function restore(snapshot: T, action: string): PathStoreChange[] {
		const changes: PathStoreChange[] = [];
		untrack(() => {
			shallowDiff(state, snapshot, [], changes);
			state = snapshot;
			rootCell.set(state);
			invalidateMerged();
			const nextVersion = version + 1;
			recordCause(changes, action, nextVersion);
			recomputeDerived(changes, nextVersion);
			syncPathCells(null);
			if (changes.length > 0) dispatchAll();
			persistToStorage();
			version = nextVersion;
			events.push({ version, action, at: Date.now(), changes });
			if (events.length > historyLimit) events.shift();
		});
		return changes;
	}

	/* ── persistence ── */

	function persistToStorage(): void {
		if (!persist || !storageKey) return;
		try {
			writePersistedStorage(storageKey, JSON.stringify(state));
		} catch {
			/* storage/cookie blocked — the in-memory store still works */
		}
	}

	/* ── notifications ── */

	const subscribers = new Set<(state: T) => void>();
	const watchers = new Set<() => void>();

	function dispatchAll(): void {
		const current = buildMerged();
		for (const wrapper of subscribers) wrapper(current);
		for (const wrapper of watchers) wrapper();
	}

	/* ── why / explain ── */

	function whyAt(tokens: Segments, depth = 0, versionNow = version): PathExplanation {
		const path = pathKey(tokens);
		const value = getIn(state, tokens);
		if (depth > 64) return { path, value, cause: 'initial' };

		const def = derivedDefs.get(path);
		if (def) {
			const node: PathExplanation = {
				path,
				value: def.cell.get(),
				cause: 'derived',
				from: def.deps.map((dep) => whyAt(dep, depth + 1)),
			};
			if (def.lastTrigger) {
				node.changedBy = def.lastTrigger.map((trigger, i) => ({
					path: pathKey(trigger),
					value: getIn(state, trigger),
					cause: 'action' as const,
					action: i === 0 ? undefined : undefined, // filled below from events
					version: def.lastTriggerVersion,
				}));
				const first = def.lastTrigger[0];
				const ev = events
					.slice()
					.reverse()
					.find((e) => e.changes.some((c) => c.path === pathKey(first)));
				if (ev) {
					node.changedBy![0].action = ev.action;
					node.changedBy![0].version = ev.version;
					node.version = ev.version;
				}
			}
			void versionNow;
			return node;
		}

		const cause = lastCause.get(path);
		if (cause) {
			if (cause.action === 'undo' || cause.action === 'redo') {
				return { path, value, cause: 'time-travel', action: cause.action, version: cause.version };
			}
			return { path, value, cause: 'action', action: cause.action, version: cause.version };
		}
		return { path, value, cause: 'initial' };
	}

	function renderExplanation(node: PathExplanation, indent = 0): string {
		const pad = '  '.repeat(indent);
		const lines: string[] = [];
		const tag =
			node.cause === 'derived'
				? 'derived'
				: node.cause === 'action'
					? `${node.action ?? 'action'} \u00b7 v${node.version ?? '?'}`
					: node.cause === 'time-travel'
						? `time-travel \u00b7 v${node.version ?? '?'}`
						: 'initial';
		lines.push(`${pad}${node.path} = ${JSON.stringify(node.value)}  (${tag})`);
		if (node.changedBy && node.changedBy.length > 0) {
			lines.push(`${pad}  recomputed after:`);
			for (const change of node.changedBy) {
				lines.push(renderExplanation({ ...change, from: undefined }, indent + 2));
			}
		} else if (node.from && node.from.length > 0) {
			for (const child of node.from) lines.push(renderExplanation(child, indent + 1));
		}
		return lines.join('\n');
	}

	/* ── handles ── */

	function derivedHandle(def: DerivedDef, displayPath: string): DerivedHandle<unknown> {
		return {
			path: def.path,
			get deps() {
				return def.deps.map((dep) => dep.join('.'));
			},
			get() {
				return def.cell.get();
			},
			subscribe(cb) {
				let prev = def.cell.get();
				return store.subscribe(() => {
					const next = def.cell.get();
					if (!Object.is(prev, next)) {
						prev = next;
						(cb as (v: unknown) => void)(next);
					}
				});
			},
		};
		void displayPath;
	}

	const store = {
		/** Reactive whole-state read — re-runs on any commit. Includes derived
		 *  values at their registered paths (derived wins over a raw key). */
		get(): T {
			rootCell.get();
			return buildMerged();
		},

		/** A fine-grained, causally-aware handle for one nested path. When a
		 *  derived is registered at this path, the handle reads/writes the
		 *  derived (set/update then throw read-only). */
		at<P extends StorePath<T>>(path: P): PathHandle<StorePathValue<T, P>> {
			const tokens = parseStorePath(path as string);
			const key = pathKey(tokens);
			const def = derivedDefs.get(key);
			if (def) {
				const handle = derivedHandle(def, path as string);
				return {
					path: key,
					get: handle.get as () => StorePathValue<T, P>,
					set() {
						throw new Error(`Path store: derived path "${path as string}" is read-only.`);
					},
					update() {
						throw new Error(`Path store: derived path "${path as string}" is read-only.`);
					},
					subscribe: handle.subscribe as unknown as (
						cb: (value: StorePathValue<T, P>) => void
					) => () => void,
				};
			}
			return {
				path: key,
				get() {
					return cellFor(tokens).get() as StorePathValue<T, P>;
				},
				set(value, action = 'set') {
					commit(setIn(state, tokens, cloneValue(value)), action, tokens);
				},
				update(fn, action = 'update') {
					commit(updateIn(state, tokens, fn as (c: unknown) => unknown), action, tokens);
				},
				subscribe(cb) {
					let prev = cellFor(tokens).get();
					return store.subscribe(() => {
						const next = cellFor(tokens).get();
						if (!Object.is(prev, next)) {
							prev = next;
							(cb as (v: unknown) => void)(next);
						}
					});
				},
			};
		},

		/** Replace the whole state (attributed to `action`). */
		set(next: T, action = 'set'): void {
			commit(cloneValue(next), action, null);
		},

		/** Shallow merge a partial (or `(prev) => partial`) into the root. */
		update(patch: Partial<T> | ((prev: T) => Partial<T>), action = 'update'): void {
			const partial = typeof patch === 'function' ? patch(state) : patch;
			commit({ ...state, ...cloneValue(partial) }, action, null);
		},

		setIn(path: Segments | string, value: unknown, action = 'setIn'): void {
			const tokens = typeof path === 'string' ? parseStorePath(path) : path;
			commit(setIn(state, tokens, cloneValue(value)), action, tokens);
		},

		updateIn(
			path: Segments | string,
			fn: (current: unknown) => unknown,
			action = 'updateIn'
		): void {
			const tokens = typeof path === 'string' ? parseStorePath(path) : path;
			commit(updateIn(state, tokens, fn), action, tokens);
		},

		/**
		 * Register a derived node at `path`. The selector is evaluated inside
		 * `untrack` against a read-recording proxy, so its source paths are
		 * captured automatically — including array envelopes, which make
		 * aggregate deriveds re-run when the array's membership changes.
		 */
		derived<P extends StorePath<T>, V>(
			path: P,
			selector: (state: T) => V,
			equals: (a: V, b: V) => boolean = Object.is
		): DerivedHandle<V> {
			const tokens = parseStorePath(path as string);
			const key = pathKey(tokens);
			const first = evaluate(selector as (s: T) => unknown);
			const def: DerivedDef = {
				path: key,
				tokens,
				selector: selector as (state: T) => unknown,
				equals: equals as (a: unknown, b: unknown) => boolean,
				cell: track(first.value),
				deps: first.deps,
				lastTrigger: null,
				lastTriggerVersion: 0,
			};
			derivedDefs.set(key, def);
			registerDef(def);
			mergedDirty = true;
			return derivedHandle(def, path as string) as DerivedHandle<V>;
		},

		subscribe(
			fn: (state: T) => void,
			selector?: (state: T) => unknown,
			equals?: (a: unknown, b: unknown) => boolean
		): () => void {
			const eq = equals ?? Object.is;
			let hasPrev = false;
			let prev: unknown;
			const wrapper: (state: T) => void = selector
				? () => {
						const selected = selector(buildMerged());
						if (!hasPrev || !eq(selected, prev)) {
							hasPrev = true;
							prev = selected;
							fn(selected as T);
						}
					}
				: (current: T) => fn(current);
			subscribers.add(wrapper);
			wrapper(buildMerged());
			return () => {
				subscribers.delete(wrapper);
			};
		},

		watch<K>(selector: (state: T) => K, callback: (next: K, prev: K) => void): () => void {
			let prev = selector(buildMerged());
			const wrapper = () => {
				const next = selector(buildMerged());
				if (!Object.is(prev, next)) {
					const old = prev;
					prev = next;
					callback(next, old);
				}
			};
			watchers.add(wrapper);
			return () => {
				watchers.delete(wrapper);
			};
		},

		/** Causal explanation for the current value at `path`. */
		why<P extends StorePath<T>>(path: P): PathExplanation {
			return whyAt(parseStorePath(path as string));
		},

		/** A printable causal chain for devtools / tests. */
		explain<P extends StorePath<T>>(path: P): string {
			return renderExplanation(whyAt(parseStorePath(path as string)));
		},

		/** The recorded events, oldest first. */
		get events(): readonly PathStoreEvent[] {
			return events;
		},

		get version(): number {
			return version;
		},

		canUndo(): boolean {
			return undoStack.length > 0;
		},

		canRedo(): boolean {
			return redoStack.length > 0;
		},

		undo(): boolean {
			const prev = undoStack.pop();
			if (prev === undefined) return false;
			redoStack.push(state);
			restore(prev, 'undo');
			return true;
		},

		redo(): boolean {
			const next = redoStack.pop();
			if (next === undefined) return false;
			undoStack.push(state);
			restore(next, 'redo');
			return true;
		},

		/** A JSON-safe snapshot of the current merged state. */
		toJSON(): Record<string, unknown> {
			return plainClone(buildMerged()) as Record<string, unknown>;
		},
	};

	return store;
}

export type PathStore<T extends object> = ReturnType<typeof createPathStore<T>>;