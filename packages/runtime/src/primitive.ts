/**
 * `primitive` / `leaf` — the two authoring wrappers for the Vesk component ABI.
 *
 * Every component call in Vesk, including a bare `<Badge/>` with no
 * attributes, is invoked as `callee(props, __registry, __veskScope)`. The
 * compiler always passes an object literal at the call site (`{}` when there
 * are no attributes), so `props` is never nullish coming *from the framework*.
 *
 * The gap this module closes is the other direction: a component exported from
 * a module is an ordinary function, and an ordinary function can be called
 * with no arguments at all — `Badge()` from a helper, a test, a render
 * callback, or a manual `registry.get('Badge')!(undefined, reg, scope)` probe.
 * A hand-written `function Badge(props) { return props.children }` throws
 * `Cannot read properties of undefined` in that case. `primitive()` removes
 * that whole class of failure by normalizing nullish props to a frozen empty
 * object before the wrapped function ever sees them.
 *
 * `leaf()` is the behavioural counterpart: stateful widgets, own click
 * handlers, async components. They implement the `VeskLeafComponent` ABI
 * directly — the wrapper only stamps the marker so the two kinds can be told
 * apart at runtime.
 *
 * Both wrappers are pure: no `document`/`window` access, no top-level side
 * effects, safe to import from the client and server barrels alike.
 */

import type {
	VeskComponentRegistry,
	VeskLeafComponent,
	VeskPrimitiveComponent,
	VeskScope,
	VeskTaggedLeafComponent,
} from '@vesk/types';
import { get } from '@vesk/runtime/src/ripple-runtime';
import { effect } from '@vesk/runtime/src/ripple-blocks';

/**
 * Shared stand-in for "called with no props". Frozen so a primitive that
 * mutates `props` by mistake fails loudly in strict mode instead of leaking
 * state between unrelated zero-arg calls.
 */
const EMPTY_PROPS: Record<string, never> = Object.freeze({});

/**
 * The public marker properties are `readonly` so consumers cannot forge them by
 * assignment; internally they must be stamped once, at wrap time. This is the
 * mutable view of the same shape.
 */
type UnbrandedPrimitive = { -readonly [K in keyof VeskPrimitiveComponent]: VeskPrimitiveComponent[K] };
type UnbrandedLeaf = { -readonly [K in keyof VeskTaggedLeafComponent]: VeskTaggedLeafComponent[K] };

/**
 * Wrap a presentational component so it is safe to call with no arguments.
 *
 * The wrapped function is *not* a copy of `fn` — it forwards `props`,
 * `__registry` and the scope untouched, so identity-sensitive behavior
 * (scope preference, `__veskScope`) is unchanged. Only a nullish `props` is
 * substituted; a real props object is never cloned, merged or stripped, which
 * matters because on the client `props.children` can be a live reactive
 * container that must reach `fn` by reference.
 *
 * @param fn - The presentational component. Receives `(props, registry, scope)`.
 * @returns A {@link VeskPrimitiveComponent} callable as `Badge()` or `<Badge/>`.
 * @example
 * ```ts
 * const Badge = primitive((props) => `<span class="badge">${props.label ?? ''}</span>`);
 * Badge();                    // '' — no throw
 * Badge({ label: 'new' });    // '<span class="badge">new</span>'
 * ```
 */
export function primitive<P extends object = Record<string, unknown>>(
	fn: (props: P, registry?: VeskComponentRegistry, scope?: VeskScope) => unknown | Promise<unknown>,
): VeskPrimitiveComponent<P> {
	const wrapped = ((props?: P, registry?: VeskComponentRegistry, scope?: VeskScope) => {
		// Nullish-only guard: any other value is the caller's business. A frozen
		// singleton avoids an allocation per zero-arg call and keeps `Object.is`
		// stable for the common no-props case.
		return fn(props == null ? (EMPTY_PROPS as unknown as P) : props, registry, scope);
	}) as unknown as UnbrandedPrimitive;
	wrapped.__veskPrimitive = true;
	return wrapped as VeskPrimitiveComponent<P>;
}

/**
 * Tag a stateful/async component as a leaf so `isLeaf()` can identify it.
 *
 * Behaviourally a no-op — the function is returned as-is (plus the marker) so
 * the `__veskScope` property the SSR renderer assigns to compiled components
 * stays writable. Use it to document intent and to let tooling distinguish a
 * behavioural widget from a `primitive()` one; do not use it to give a
 * primitive extra behavior it cannot support.
 *
 * @param fn - The leaf component implementing `(props, registry, scope)`.
 * @returns The same function, tagged with `__veskLeaf`.
 * @example
 * ```ts
 * const Tabs = leaf((props, registry, scope) => {
 *   const &[open] = track(0);
 *   return `<div>${open}</div>`;
 * });
 * ```
 */
export function leaf<P extends object = Record<string, unknown>>(
	fn: VeskLeafComponent<P>,
): VeskTaggedLeafComponent<P> {
	(fn as unknown as UnbrandedLeaf).__veskLeaf = true;
	return fn as VeskTaggedLeafComponent<P>;
}

/** True when `value` was produced by {@link primitive}. */
export function isPrimitive(value: unknown): value is VeskPrimitiveComponent {
	return typeof value === 'function' && (value as VeskPrimitiveComponent).__veskPrimitive === true;
}

/** True when `value` was tagged by {@link leaf}. */
export function isLeaf(value: unknown): value is VeskTaggedLeafComponent {
	return typeof value === 'function' && (value as VeskTaggedLeafComponent).__veskLeaf === true;
}

/**
 * True when `value` is callable as a Vesk component — i.e. it is a function at
 * all. Every registry entry satisfies this; the distinction that matters for
 * authoring is {@link isPrimitive} vs {@link isLeaf}.
 */
export function isVeskComponent(value: unknown): value is VeskLeafComponent {
	return typeof value === 'function';
}

/**
 * Normalize a component call's return value into something the client renderer
 * can insert.
 *
 * A compiled `.vsk` component returns a DOM `Node`, and the runtime components
 * (`Image`, `Form`, `Md`, …) build one when `document` exists. A `primitive()`
 * or `leaf()` written as a template string has no such branch — it returns a
 * string on BOTH sides, because that is the whole point of the terse form. The
 * server concatenates it into the HTML; the client would otherwise hand a
 * string to `appendChild`/`replaceChild` and throw "parameter 1 is not of type
 * 'Node'", taking the page's error boundary with it.
 *
 * So: a `Node` passes through untouched, a string is parsed into its root
 * node(s), and every other value (including `null`/`undefined`/`false`, which
 * callers test for) is returned as-is. On the server there is nothing to
 * normalize into, so strings pass through unchanged.
 */
export function toDomNode<T>(value: T): T | Node | DocumentFragment {
	if (typeof document === 'undefined') return value;
	if (value == null || typeof value === 'boolean') return value;
	if (typeof (value as { nodeType?: unknown }).nodeType === 'number') {
		return value as unknown as Node;
	}
	if (typeof value !== 'string') return value;
	if (value === '') return document.createDocumentFragment();
	const template = document.createElement('template');
	template.innerHTML = value;
	const { content } = template;
	// A single root becomes that node; several roots stay a fragment so the
	// caller can splice them in without inventing a wrapper element that was
	// never in the SSR markup.
	if (content.childNodes.length === 1) {
		const only = content.firstChild as Node;
		// Detach before returning: a node still parented to the template's
		// content fragment reads as "already mounted" to the compiler's
		// hydrate guard (`value.parentNode == null`), so the fresh node would
		// never be inserted and the claimed SSR node would be retired instead.
		content.removeChild(only);
		return only;
	}
	return content;
}

/** True when `value` is a tracked cell (the shape `get`/`set` operate on). */
function isCell(value: unknown): value is { f: number } {
	return typeof value === 'object' && value !== null && typeof (value as { f?: unknown }).f === 'number';
}

/** Read a dep as the value a render would see: cells unwrap, literals pass. */
function readDep(dep: unknown): unknown {
	return isCell(dep) ? get(dep) : dep;
}

/**
 * Keep a rendered markup node in sync with the tracked values it was built
 * from, without re-invoking the component at mount.
 *
 * A `primitive()` or `leaf()` written as a template string is called once and
 * its result is converted to DOM once. Tracked values it READ (through the
 * `reactiveProps` proxy) therefore subscribe nobody: a later write updated the
 * cell and left the markup stale, so a leaf driven by a parent's counter never
 * moved. Compiled components avoid this because their bindings re-run; string
 * components have no bindings, so the runtime re-runs the call and swaps the
 * produced nodes in place.
 *
 * The dep list is read by the effect purely to SUBSCRIBE. The first effect run
 * therefore performs no re-render — it compares against the values captured at
 * mount, which also covers a write that lands between mount and the first
 * flush. Re-rendering is skipped when the node has been detached (its owner was
 * torn down), so a stale effect can never graft nodes back into the document.
 *
 * @param node - The node (or fragment) the mount already inserted.
 * @param deps - Tracked cells / values the markup was derived from.
 * @param call - Re-invokes the component and returns fresh markup.
 * @returns `node`, so the call can wrap the mount expression in place.
 */
export function rerenderNode<T>(node: T, deps: readonly unknown[], call: () => unknown): T {
	if (typeof document === 'undefined') return node;
	if (deps.length === 0) return node;
	// The markup this call site owns. A component that rendered several roots
	// hands them over as a list: the call site drains the fragment into the
	// mount point, so by the time this runs the fragment itself is detached and
	// useless as a handle. The list is followed as one range, which lets a
	// later render add, drop or reorder roots.
	let owned: Node[] | null = null;
	let current: Node | null = null;
	if (Array.isArray(node)) {
		const roots = (node as unknown as Node[]).filter((n) => n && typeof n.nodeType === 'number');
		owned = roots.length ? roots : null;
		current = owned ? owned[0] : null;
	} else if (node && typeof (node as { nodeType?: unknown }).nodeType === 'number') {
		current = node as unknown as Node;
	}
	if (!current) return node;
	const liveRange = (): Node[] | null => {
		if (owned) return owned;
		return current && current.parentNode ? [current] : null;
	};
	let seen = deps.map(readDep);
	effect(() => {
		const now = deps.map(readDep);
		if (now.length === seen.length && now.every((v, i) => Object.is(v, seen[i]))) return;
		seen = now;
		// Detachment is checked BEFORE re-invoking: once the owner is gone the
		// component must not run again (side effects, fetches) and its markup
		// must never be grafted back into the document.
		const old = liveRange();
		if (!old || !old[0].parentNode) return;
		const next = toDomNode(call()) as Node | null | undefined;
		if (!next || typeof next.nodeType !== 'number') return;
		// Snapshot the children before inserting: moving them out empties the
		// fragment, which is what tells us whether this render had several roots.
		const fresh = next.nodeType === 11 ? Array.from(next.childNodes) : [next];
		const parent = old[0].parentNode as Node;
		for (const freshNode of fresh) parent.insertBefore(freshNode, old[0]);
		for (const oldNode of old) if (oldNode.parentNode) oldNode.parentNode.removeChild(oldNode);
		owned = next.nodeType === 11 ? fresh : null;
		current = (fresh[0] as Node) ?? current;
	});
	return node;
}
