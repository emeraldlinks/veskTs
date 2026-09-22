import { get, scope, set_active_block } from '@vesk/runtime/src/ripple-runtime';
import { root } from '@vesk/runtime/src/ripple-blocks';



// Hydrators invoke user component functions outside the router. componentFn
// runs `track()`/`effect()` calls that attach to whatever block is active.
// With no active block, `schedule_update` walks an empty parent chain and
// queues a null root — the effects never flush. Establish a root block window
// (mirroring the router's runInBlockWindow) so effects created during
// hydration attach to a real root and run on the microtask flush.
function runInHydrateBlock<T>(fn: () => T): T {
	const previous = scope();
	const block = root(() => {});
	set_active_block(block);
	try {
		const result = fn();
		set_active_block(previous);
		return result;
	} catch (error) {
		set_active_block(previous);
		throw error;
	}
}

export interface HydrateClaim {
	el: Element;
}

export interface ClaimByKeyOptions {
	/**
	 * Adopt out of position: when the cursor's marker belongs to a different
	 * item, scan the whole region for `key`, adopt it where it stands, and
	 * move it to the cursor. Without this (default) only exact cursor-order
	 * claims adopt; divergence renders fresh at the region tail while the SSR
	 * twin rots.
	 */
	relocate?: boolean;
}

export interface HydrateWalker {
	root: HTMLElement | null;
	done(): boolean;
	nextElement(tag?: string): Element;
	/**
	 * Claim an element like `nextElement` but without stripping its direct text
	 * children. Used by static-component stubs whose SSR content is preserved
	 * as-is (no client-side re-creation of text nodes).
	 */
	claimOnly?(tag?: string): Element;
	/**
	 * Drop any remaining markers whose comment node is no longer attached to
	 * the document. Self-claiming runtime components (Link/NavLink/Md/Form/
	 * Field/LoadingIndicator) rebuild or wipe their SSR content on hydration,
	 * which can remove comment markers that the shared walker still holds; the
	 * sweep lets the cursor skip them so following sibling claims stay aligned.
	 */
	retireDetached?(): void;
	subWalker(rootEl: HTMLElement): HydrateWalker;
	/**
	 * Transfer ownership of an explicit marker subset out of this walk: the
	 * listed markers are marked claimed here (the cursor skips them) so a
	 * scoped walker built over the same comments owns them exclusively.
	 * Used by the layout slot contract (`layout.ts`), which scopes page
	 * claims to SSR slot boundaries instead of sharing the positional cursor
	 * with nav/footer claims. Optional — walkers that cannot transfer leave
	 * the markers in place and the caller falls back to the shared walk.
	 */
	takeMarkers?(comments: Comment[]): void;
	/**
	 * Claim the SSR element of a keyed list item whose `data-vsk-key` matches
	 * `key`. Consumes the item's root marker and stamps the element, but leaves
	 * the item's interior markers in place so the item's own render claims them
	 * positionally. Returns `null` when no matching SSR marker remains (the item
	 * is new client-side and is rendered fresh).
	 */
	claimByKey?(key: string, options?: ClaimByKeyOptions): HydrateClaim | null;
	/**
	 * Non-consuming variant of `claimByKey`, used to discover the DOM bounds of
	 * a keyed list region before anchoring it.
	 */
	peekKey?(key: string): Element | null;
	/**
	 * Anchor a dynamic-region fence comment at the walker's current SSR slot —
	 * immediately before the next unconsumed marker — so a conditional region
	 * with no SSR content mounts at its source-file position instead of being
	 * appended to the root by `__place`'s fallback (the "renders at the bottom
	 * of the page" drift). The marker is NOT consumed: it still belongs to its
	 * owner's following claim. Falls back to the walker root's end when there is
	 * no live marker (region is the last fragment child). Returns false when no
	 * host is available (detached subtree).
	 */
	insertBeforeNextClaim?(node: Node): boolean;
}

interface HydrateIdleOptions {
	chunkSize?: number;
	timeout?: number;
}

interface HydrateInteractionOptions {
	events?: string[];
}

interface HydrateCancelBase {
	cancel(): void;
}

interface HydrateCancel extends HydrateCancelBase {
	hydrateNow(): void;
}

/**
 * Wrap a props object in a Proxy so tracked values passed as props are read
 * reactively at use time (matching how the compiler passes cells down).
 */
export function reactiveProps<T extends Record<string, unknown>>(props: T): T {
	return new Proxy(props, {
		get(target, key) {
			const val = Reflect.get(target, key);
			if (typeof val === 'object' && val !== null && typeof (val as unknown as { f: unknown }).f === 'number') {
				return get(val);
			}
			return val;
		},
	});
}

// ---------------------------------------------------------------------------
// Dev-mode hydration-integrity canary (T1)
//
// Claiming the SSR DOM is inherently positional: a element claimed from the
// wrong slot fails silently in production (the SSR node is adopted as-is). To
// surface SSR/client divergence early, dev mode:
//   * stamps every adopted node with `data-vsk-claimed`,
//   * warns with the container fragment when a positional claim misses, and
//   * runs `assertFullyHydrated()` at the end of every full hydration so
//     unclaimed phantom markers are reported instead of rotting in the DOM.
// ---------------------------------------------------------------------------

let __hydrateDevMode = true;

const CLAIMED_ATTR = 'data-vsk-claimed';

export function setHydrateDevMode(enabled: boolean): void {
	__hydrateDevMode = enabled;
}

// ---------------------------------------------------------------------------
// Strict mode + mismatch telemetry (Hydrate-Todo A1).
//
// RULE: NO DUPLICATION, NO MISMATCH. Every claim miss funnels through
// `reportMiss`, which notifies the registered telemetry handler and (in dev)
// warns. Claim-time behavior never changes with strict mode: a tag-mismatch
// backoff must leave the SSR element for its real owner (the /store/widget
// lesson). Strict repair happens only at audit time, when every owner has had
// its chance and leftovers are genuine orphans.
// ---------------------------------------------------------------------------

export type HydrationIssueKind =
	| 'tag-mismatch'
	| 'exhausted'
	| 'leftover-marker'
	| 'twin'
	| 'key-reorder'
	| 'marker-skew'
	| 'untyped-marker';

export interface HydrationIssue {
	kind: HydrationIssueKind;
	detail: string;
}

export interface HydrationReport {
	ok: boolean;
	unclaimed: number;
	twins: number;
	issues: HydrationIssue[];
	sample: string;
}

export type HydrationMismatchHandler = (issue: HydrationIssue) => void;

let __hydrateStrict = false;
let __mismatchHandler: HydrationMismatchHandler | null = null;

export function setHydrateStrict(enabled: boolean): void {
	__hydrateStrict = enabled;
}

export function isHydrateStrict(): boolean {
	return __hydrateStrict;
}

export function onHydrationMismatch(handler: HydrationMismatchHandler | null): void {
	__mismatchHandler = handler;
}

export function reportHydrationIssue(issue: HydrationIssue): void {
	if (!__mismatchHandler) return;
	try {
		__mismatchHandler(issue);
	} catch {
		// Telemetry must never break rendering.
	}
}

function devWarn(message: string): void {
	if (__hydrateDevMode && typeof console !== 'undefined') {
		console.warn('[vesk-hydrate] ' + message);
	}
}

function reportMiss(kind: HydrationIssueKind, detail: string, loud: boolean): void {
	if (__mismatchHandler) {
		try {
			__mismatchHandler({ kind, detail });
		} catch {
			// Telemetry must never break rendering.
		}
	}
	if (loud) devWarn(`${kind}: ${detail}`);
}

function stampClaimed(el: Element): void {
	if (__hydrateDevMode) {
		try {
			el.setAttribute(CLAIMED_ATTR, '');
		} catch {
			// Some hosts restrict attribute writes on special nodes (SVG,
			// <template> children); claiming is still valid.
		}
	}
}

// Strip the direct text children of a claimed element. Static text inside a
// claimed subtree is re-created client-side as fresh text nodes, so the
// SSR-serialized text nodes are dropped to avoid duplicates. Before dropping,
// stash the concatenated text as `__vsk_ssrText`: hydrate-mode codegen
// initializes a sole dynamic text child from this snapshot, so a missed effect
// degrades to stale (visible) text instead of an empty element (Hydrate-Todo
// A5). Always set ('' when none) so consumers never branch on presence.
function stripDirectTextNodes(el: Element): void {
	let text = '';
	for (let i = el.childNodes.length - 1; i >= 0; i--) {
		const c = el.childNodes[i] as Element & { textContent?: unknown };
		if ((c as unknown as { nodeType: number }).nodeType === 3) {
			try {
				text = String(c.textContent ?? '') + text;
			} catch {
				// ignore unreadable nodes, still remove below
			}
			(c as unknown as { remove(): void }).remove();
		}
	}
	(el as unknown as { __vsk_ssrText?: string }).__vsk_ssrText = text;
}

// After a claim, a claimed element may still contain direct SSR element
// children: component-boundary wrappers (`display:contents` spans) and static
// markup that hydration skips. Fresh text/dynamic nodes re-created client-side
// must be inserted BEFORE these residues at their SSR positions — appending at
// the end would reorder mixed text + component children (e.g. a label that
// reads `<span>compiler-first framework · <VersionBadge /></span>`). Store the
// residue list (in DOM order) on the element so codegen can address it.
function captureSsrElementChildren(el: Element): void {
	(el as unknown as { __vsk_ssrEls?: Element[] }).__vsk_ssrEls = Array.prototype.slice.call(el.children);
}

function normText(el: Element): string {
	try {
		return ((el.textContent || '') as string).replace(/\s+/g, ' ').trim();
	} catch {
		return '';
	}
}

function collectElements(rootEl: Element): Element[] {
	const out: Element[] = [];
	(function walk(n: Element): void {
		const kids = n.childNodes;
		for (let i = 0; i < kids.length; i++) {
			const c = kids[i] as Element;
			if ((c as unknown as { nodeType: number }).nodeType === 1) {
				out.push(c);
				walk(c);
			}
		}
	})(rootEl);
	return out;
}

/**
 * Twin scan (heuristic): an adopted element sitting directly beside an
 * unadopted same-tag element with identical non-empty text is the signature of
 * a claim miss that twinned — the SSR node survived next to its fresh copy.
 * Either order (SSR-then-fresh or fresh-then-SSR) counts. Purely static
 * identical siblings (both unclaimed) are NOT twins; neither are two adopted
 * nodes.
 */
function scanTwins(container: HTMLElement): { count: number; samples: string[] } {
	let count = 0;
	const samples: string[] = [];
	for (const el of collectElements(container)) {
		const prev = el.previousElementSibling;
		if (!prev || prev.tagName !== el.tagName) continue;
		const t = normText(el);
		if (!t || t !== normText(prev)) continue;
		let a = false;
		let b = false;
		try {
			a = el.hasAttribute(CLAIMED_ATTR);
			b = prev.hasAttribute(CLAIMED_ATTR);
		} catch {
			continue;
		}
		if (a !== b) {
			count++;
			if (samples.length < 3) {
				try {
					samples.push(`<${el.tagName.toLowerCase()}> "${t.slice(0, 60)}"`);
				} catch {
					// ignore sample failures
				}
			}
		}
	}
	return { count, samples };
}

/**
 * Structured audit of the most recent full hydration pass over `container`.
 * Counts unclaimed `<!--vsk-->` markers (SSR regions the client never
 * rendered) and twin elements (SSR node surviving beside its fresh copy).
 * In strict mode, removes genuine orphans — marker plus its SSR element — now
 * that every owner had its chance to claim. Claim-time backoff is untouched:
 * mid-walk removal would steal elements from their real owners.
 */
export function auditHydration(container: HTMLElement): HydrationReport {
	let unclaimed = 0;
	let sample = '';
	const orphans: Comment[] = [];
	const orphanNames: string[] = [];
	const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
		acceptNode: (node) => (isVskMarkerText(node.textContent) ? _FILTER_ACCEPT : _FILTER_SKIP),
	});
	while (walker.nextNode()) {
		const c = walker.currentNode as Comment;
		const el = c.nextElementSibling;
		if (el && underClaimedAncestor(el, container)) continue;
		unclaimed++;
		orphans.push(c);
		// B1: name the orphan — typed component identity from the marker, or
		// the live element tag for bare markers.
		if (orphanNames.length < 5) {
			const parsed = parseVskMarker(c.textContent);
			const id = parsed && parsed.identity ? `<!--vsk:${parsed.identity}-->` : null;
			let tag = '';
			try {
				tag = el && el.tagName ? `<${el.tagName.toLowerCase()}>` : '(no element)';
			} catch {
				tag = '(unreadable)';
			}
			orphanNames.push(id ? `${id} before ${tag}` : `bare <!--vsk--> before ${tag} (untyped)`);
		}
		if (!sample && container.outerHTML) sample = String(container.outerHTML).slice(0, 800);
	}
	const twinRes = scanTwins(container);
	const issues: HydrationIssue[] = [];
	if (unclaimed > 0) {
		issues.push({
			kind: 'leftover-marker',
			detail:
				`${unclaimed} hydration marker${unclaimed === 1 ? '' : 's'} never claimed; ` +
				`SSR and client markup diverge. Orphans: ${orphanNames.join(', ')}.`,
		});
	}
	for (const s of twinRes.samples) {
		issues.push({ kind: 'twin', detail: `possible hydration twin: ${s}` });
	}
	if (twinRes.count > twinRes.samples.length) {
		issues.push({
			kind: 'twin',
			detail: `${twinRes.count - twinRes.samples.length} further possible twin(s) (samples capped)`,
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
				// Best-effort repair; the report above already recorded it.
			}
		}
	}
	if (__mismatchHandler) {
		for (const issue of issues) {
			try {
				__mismatchHandler(issue);
			} catch {
				// Telemetry must never break rendering.
			}
		}
	}
	return {
		ok: unclaimed === 0 && twinRes.count === 0,
		unclaimed,
		twins: twinRes.count,
		issues,
		sample,
	};
}

/**
 * Dev-mode check that every `<!--vsk-->` marker in `container` has been
 * claimed by the most recent full hydration pass. Markers that remain belong
 * to SSR regions the client never rendered (or rendered differently) — orphaned
 * phantom content that will never be cleaned up. Returns `false` and warns when
 * any such marker survives. Runs automatically at the end of `hydrate`,
 * `hydrateInitial`, and every hydration strategy's completion.
 */
export function assertFullyHydrated(container: HTMLElement): boolean {
	const report = auditHydration(container);
	if (!report.ok) {
		devWarn(
			`${report.unclaimed} hydration marker${report.unclaimed === 1 ? '' : 's'} never claimed; ` +
				`SSR and client markup diverge.` +
				(report.twins > 0 ? ` ${report.twins} possible twin(s) detected.` : '') +
				` Container fragment:\n${report.sample}`
		);
		return false;
	}
	return true;
}

function underClaimedAncestor(el: Element, container: HTMLElement): boolean {
	for (let n: Element | null = el; n && n !== container; n = n.parentElement) {
		if (n.nodeType === 1 && (n as Element).hasAttribute(CLAIMED_ATTR)) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Walker marker lifecycle state machine (T3)
//
// Each marker tracked by a walker passes through `unclaimed → claimed`.
// Claiming adopts the SSR element (and strips the marker from the live DOM so
// the canary above only ever sees genuine phantoms). `claimByKey` also moves
// the marker to `claimed` but does NOT advance the positional cursor: the
// item's interior markers are claimed by the item's own render immediately
// afterwards. `subWalker` TRANSFERS ownership (Hydrate-Todo B3): the child's
// markers are spliced out of the parent walk, so exactly one engine owns each
// marker and no cursor arithmetic can drift. A `done()` walker whose markers
// were never all consumed is that same miss surface — the canary reports it.
// ---------------------------------------------------------------------------

type MarkerState = 'unclaimed' | 'claimed';

interface TrackedMarker {
	comment: Comment;
	state: MarkerState;
	/** B1 identity from the marker text (`c:Name`), if the server typed it. */
	identity: string | null;
}

function markerIdentity(comment: Comment): string | null {
	try {
		const parsed = parseVskMarker(comment.textContent);
		return parsed ? parsed.identity : null;
	} catch {
		return null;
	}
}

function describeMarker(tm: TrackedMarker): string {
	return tm.identity ? `<!--vsk:${tm.identity}-->` : '<!--vsk-->';
}

const _SHOW_COMMENT = 128;
export const _FILTER_ACCEPT = 1;
export const _FILTER_SKIP = 2;

// Keyed marker identity (Hydrate-Todo B1 + keyed markers). Server codegen
// types every boundary: components (`<!--vsk:c:Name-->`), static subtrees
// (`<!--vsk:t:tag-->`). No regex here either (runtime text-processing rule):
// exact match or the `vsk:` prefix. Bare `<!--vsk-->` still adopts
// positionally but is reported as `untyped-marker` — no exceptions.
export function isVskMarkerText(text: string | null | undefined): boolean {
	if (text === 'vsk') return true;
	if (typeof text !== 'string' || text.length < 4) return false;
	return text.charAt(0) === 'v' && text.charAt(1) === 's' && text.charAt(2) === 'k' && text.charAt(3) === ':';
}

export function parseVskMarker(text: string | null | undefined): { identity: string | null } | null {
	if (text === 'vsk') return { identity: null };
	if (!isVskMarkerText(text)) return null;
	const rest = (text as string).slice(4);
	return { identity: rest === '' ? null : rest };
}

export function collectVskMarkers(container: HTMLElement): Comment[] {
	const markers: Comment[] = [];
	const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
		acceptNode: (node) => (isVskMarkerText(node.textContent) ? _FILTER_ACCEPT : _FILTER_SKIP),
	});
	while (walker.nextNode()) markers.push(walker.currentNode as Comment);
	return markers;
}

/**
 * Keyed-marker verification at adopt time. A `t:tag` marker must precede that
 * tag — anything else is SSR/HTML-parser skew (e.g. a `<p>` auto-close moving
 * the marker), reported deterministically instead of drifting. A bare marker
 * still adopts positionally but is reported: every emission site types its
 * markers, so bare means a missed site or stale output. No exceptions.
 */
function checkMarkerIdentity(marker: Comment, el: Element): void {
	let identity: string | null = null;
	try {
		const parsed = parseVskMarker(marker.textContent);
		identity = parsed ? parsed.identity : null;
	} catch {
		identity = null;
	}
	if (identity === null) {
		reportMiss(
			'untyped-marker',
			`adopted a bare <!--vsk--> marker before <${el.tagName.toLowerCase()}>; all emission sites must type their markers.`,
			__hydrateDevMode
		);
		return;
	}
	if (identity.charAt(0) === 't' && identity.charAt(1) === ':') {
		const expected = identity.slice(2).toLowerCase();
		if (expected !== '' && expected !== el.tagName.toLowerCase()) {
			reportMiss(
				'marker-skew',
				`marker <!--vsk:${identity}--> precedes <${el.tagName.toLowerCase()}> — SSR/HTML-parser skew; adopting the live element.`,
				__hydrateDevMode
			);
		}
	}
}

function adoptElement(marker: Comment, tag?: string): Element | null {
	const el = marker.nextElementSibling;
	if (!el) {
		marker.remove();
		return null;
	}
	// Tag mismatch: leave the marker and the SSR element fully intact so the
	// element's real owner can claim it. Consuming it here would strip the SSR
	// text and stamp a claim on a node this claim does not own, drifting every
	// later claim into fresh-node fallback (the empty `/store/widget` h1
	// defect: the layout's missing conditional span claim stole the h1 marker).
	if (tag && el.tagName.toLowerCase() !== tag) return null;
	checkMarkerIdentity(marker, el);
	marker.remove();
	stripDirectTextNodes(el);
	captureSsrElementChildren(el);
	stampClaimed(el);
	return el;
}

// Like adoptElement but preserves direct text children. Used by static-component
// stubs whose SSR content is kept as-is (no client-side re-rendering).
function adoptElementRaw(marker: Comment, tag?: string): Element | null {
	const el = marker.nextElementSibling;
	if (!el) {
		marker.remove();
		return null;
	}
	if (tag && el.tagName.toLowerCase() !== tag) return null;
	checkMarkerIdentity(marker, el);
	marker.remove();
	captureSsrElementChildren(el);
	stampClaimed(el);
	return el;
}

class WalkerEngine implements HydrateWalker {
	root: HTMLElement | null;
	private markers: TrackedMarker[];
	private idx = 0;
	// Elements already adopted by an earlier claim in this walk. Marker-only SSR
	// can leave TWO keyed marks on the same element (the call-site marker and
	// the callee's own root marker — e.g. Link self-prefixes `<!--vsk:c:Link-->`
	// and the shared walker claims its call-site marker), and a claim must never
	// adopt the same node twice: double-adoption strips its SSR text a second
	// time and shells the cursor so every later claim misses its element.
	private adopted = new WeakSet<Element>();

	constructor(root: HTMLElement | null, markers: Comment[]) {
		this.root = root;
		this.markers = markers.map((c) => ({ comment: c, state: 'unclaimed' as MarkerState, identity: markerIdentity(c) }));
	}

	done(): boolean {
		return this.idx >= this.markers.length;
	}

	// A marker whose `nextElementSibling` was already adopted is a dead alias of
	// a live claim point (double-marker collision). Retire it and move on so the
	// cursor never claims a node twice.
	private isAlreadyAdopted(tm: TrackedMarker, el: Element | null): boolean {
		if (el !== null && this.adopted.has(el)) {
			tm.state = 'claimed';
			this.idx++;
			// Physically retire the alias too: like `adoptElement`, a spent
			// marker never stays in the live DOM.
			tm.comment.remove();
			return true;
		}
		return false;
	}

	private recordAdopted(el: Element): void {
		this.adopted.add(el);
	}

	// Marker-only SSR can stack several keyed marks before ONE element
	// (call-site marker + the callee's own root marker). The FIRST claim adopts
	// the element; the alias markers that immediately follow it are dead — they
	// point at an already-claimed node and must be physically retired so the
	// canary never counts them and a trailing alias never lingers in the DOM.
	private retireAliases(el: Element): void {
		let i = this.idx;
		while (i < this.markers.length) {
			const tm = this.markers[i];
			if (tm.state === 'claimed') {
				i++;
				continue;
			}
			if (tm.comment.nextElementSibling === el) {
				tm.state = 'claimed';
				tm.comment.remove();
				i++;
				continue;
			}
			break;
		}
	}

	nextElement(tag?: string): Element {
		while (this.idx < this.markers.length) {
			const tm = this.markers[this.idx];
			if (tm.state === 'claimed') {
				this.idx++;
				continue;
			}
			const el = tm.comment.nextElementSibling as Element | null;
			if (this.isAlreadyAdopted(tm, el)) continue;
			// A component call-site marker (`<!--vsk:c:Name-->`) whose branch
			// rendered NO element (bare `return`, `null`, empty keyed region)
			// leaves an element-less marker at the cursor. It sits at the apex
			// of an empty component region — its child hydrator rendered nothing
			// to claim, so retire it and keep walking. Otherwise the parent's
			// next element claim hits `el === null`, falls out to a fresh-node
			// fallback, and every sibling after it nests under the previous
			// claim (guard `<p>` eating the next section).
			if (el === null && tm.identity !== null && tm.identity.charAt(0) === 'c') {
				tm.state = 'claimed';
				tm.comment.remove();
				this.idx++;
				continue;
			}
			if (tag && el && el.tagName.toLowerCase() !== tag) {
				// SSR rendered a different tag than this claim wants. Leave the
				// marker AND the element untouched and back off without moving
				// the cursor: the element's real owner may still claim it, and
				// consuming it here would strip its SSR text, stamp a claim on
				// a node this render does not own, and drift every later claim
				// into fresh-node fallback (the empty `/store/widget` h1).
				// The skipped marker's B1 identity names the divergence point.
				reportMiss(
					'tag-mismatch',
					`claim wanted <${tag}> but the cursor holds ${describeMarker(tm)} before <${el.tagName.toLowerCase()}>; backing off for its real owner.`,
					false
				);
				break;
			}
			this.idx++;
			const adopted = adoptElement(tm.comment, tag);
			if (adopted === null) {
				// SSR rendered no element after this marker. Fall out to a
				// fresh element instead of hunting through the remaining
				// markers: a hunt drains markers later claims still need, so
				// one divergence cascades every following claim into fresh-node
				// fallback and its elements drift into the walker's outer
				// fallback root.
				tm.state = 'claimed';
				break;
			}
			this.recordAdopted(adopted);
			this.retireAliases(adopted);
			// A nested (non-keyed) component call leaves its `<!--vsk:c:Name-->`
			// site marker immediately BEFORE the adopted element, i.e. behind the
			// cursor. `retireAliases` only sweeps forward from `idx`, so that
			// site marker would survive as junk at the cursor and misalign every
			// later claim. Sweep the whole walk like `adoptKeyedElement` does.
			this.retireAliasesOf(adopted);
			tm.state = 'claimed';
			return adopted;
		}
		// Every claim parked itself — either because the render asked for more
		// elements than SSR provided, or because the SSR element tag did not
		// match the claim. Best effort: build a fresh element and report.
		//
		// The report is scoped to walks that still hold unconsumed markers
		// (`this.idx < this.markers.length`): that is the signature of a real
		// SSR/client structural divergence — a marker is ahead of the cursor but
		// the claim could not adopt it (wrong tag). Once the walker is exhausted
		// every further `nextElement` is a post-hydration re-render (reactive
		// loop/if blocks re-running after the interval or an event) legitimately
		// building fresh nodes — telemetry-only, so a typing `for` loop does
		// not spam the console every tick. SPA/client-only renders keep empty
		// marker lists on temp roots and never warn.
		const hasUnconsumed = this.root !== null && this.idx < this.markers.length;
		// Name the skipped cursor marker (B1): the divergence point is no
		// longer anonymous.
		let skipped = '';
		if (hasUnconsumed) {
			for (let s = this.idx; s < this.markers.length; s++) {
				if (this.markers[s].state === 'claimed') continue;
				skipped = ` skipped ${describeMarker(this.markers[s])}`;
				break;
			}
		}
		reportMiss(
			hasUnconsumed ? 'tag-mismatch' : 'exhausted',
			`hydration claim missed <${tag || 'element'}> (${
				this.markers.length - this.idx
			} markers unconsumed${skipped}); the client rendered more or different content than SSR.` +
				(this.root && this.root.outerHTML ? ` Fragment:\n${String(this.root.outerHTML).slice(0, 800)}` : ''),
			hasUnconsumed && __hydrateDevMode
		);
		return document.createElement(tag || 'div');
	}

	claimOnly(tag?: string): Element {
		while (this.idx < this.markers.length) {
			const tm = this.markers[this.idx];
			if (tm.state === 'claimed') {
				this.idx++;
				continue;
			}
			const el = tm.comment.nextElementSibling as Element | null;
			if (this.isAlreadyAdopted(tm, el)) continue;
			// Same element-less component call-site skip as nextElement: an
			// empty child branch leaves its `<!--vsk:c:Name-->` marker with no
			// element to claim, so retire and keep walking instead of falling
			// back to a fresh node that swallows subsequent siblings.
			if (el === null && tm.identity !== null && tm.identity.charAt(0) === 'c') {
				tm.state = 'claimed';
				tm.comment.remove();
				this.idx++;
				continue;
			}
			if (tag && el && el.tagName.toLowerCase() !== tag) {
				reportMiss(
					'tag-mismatch',
					`static claim wanted <${tag}> but the cursor holds ${describeMarker(tm)} before <${el.tagName.toLowerCase()}>; backing off for its real owner.`,
					false
				);
				break;
			}
			this.idx++;
			const adopted = adoptElementRaw(tm.comment, tag);
			if (adopted === null) {
				tm.state = 'claimed';
				break;
			}
			this.recordAdopted(adopted);
			this.retireAliases(adopted);
			// See nextElement: sweep site-marker aliases that stack behind the
			// cursor (e.g. `<!--vsk:c:Name-->` before a static component root).
			this.retireAliasesOf(adopted);
			tm.state = 'claimed';
			return adopted;
		}
		// Static-stub fallback twins exactly like nextElement: the SSR node
		// stays while a fresh node is built. Same reporting contract.
		const hasUnconsumed = this.root !== null && this.idx < this.markers.length;
		reportMiss(
			hasUnconsumed ? 'tag-mismatch' : 'exhausted',
			`hydration static claim missed <${tag || 'element'}> (${
				this.markers.length - this.idx
			} markers unconsumed); the client rendered more or different content than SSR.`,
			hasUnconsumed && __hydrateDevMode
		);
		return document.createElement(tag || 'div');
	}

	retireDetached(): void {
		while (this.idx < this.markers.length) {
			const tm = this.markers[this.idx];
			if (tm.state === 'claimed') {
				this.idx++;
				continue;
			}
			const c = tm.comment;
			// A marker whose comment is no longer attached cannot belong to any
			// element this walker can claim, so its SSR content was removed by
			// the render (e.g. Link's replaceChildren). Skip it and keep the
			// cursor document-ordered for the next live marker.
			if (!c || !c.parentNode) {
				tm.state = 'claimed';
				this.idx++;
				continue;
			}
			break;
		}
	}

	subWalker(rootEl: HTMLElement): HydrateWalker {
		// Ownership TRANSFER (Hydrate-Todo B3): the child's markers are
		// spliced out of this walk — exactly one engine owns each marker, so
		// no cursor arithmetic can drift and no shared refs can double-claim.
		// The old `idx += count` assumed document order == marker order.
		const owned: TrackedMarker[] = [];
		const kept: TrackedMarker[] = [];
		for (const m of this.markers) {
			let mine = false;
			if (m.state !== 'claimed') {
				if (rootEl === (m.comment as unknown as HTMLElement)) mine = true;
				else if (rootEl && m.comment && typeof rootEl.contains === 'function') mine = rootEl.contains(m.comment);
			}
			if (mine) {
				m.state = 'claimed';
				owned.push(m);
			} else {
				kept.push(m);
			}
		}
		this.markers = kept;
		if (this.idx > this.markers.length) this.idx = this.markers.length;
		return new WalkerEngine(rootEl, owned.map((m) => m.comment));
	}

	// Ownership transfer for an explicit marker subset (layout slot contract).
	// The listed markers are marked claimed here without advancing the cursor:
	// positional claims skip them, and a scoped walker built over the same
	// comments owns them exclusively. Exactly one engine owns each marker.
	takeMarkers(comments: Comment[]): void {
		let owned: Set<Comment>;
		try {
			owned = new Set(comments);
		} catch {
			return;
		}
		if (owned.size === 0) return;
		for (const tm of this.markers) {
			if (tm.state !== 'claimed' && owned.has(tm.comment)) tm.state = 'claimed';
		}
	}

	// Retire every unclaimed marker in the whole walk that points at `el`.
	// Used after a cross-position adopt (relocate): the adopted node moves to
	// the cursor, so alias markers stacked at its old station would otherwise
	// dangle — pointing at its successor and misaligning later claims.
	private retireAliasesOf(el: Element): void {
		for (const tm of this.markers) {
			if (tm.state !== 'claimed' && tm.comment.nextElementSibling === el) {
				tm.state = 'claimed';
				tm.comment.remove();
			}
		}
	}

	private adoptKeyedElement(tm: TrackedMarker, el: Element): HydrateClaim {
		tm.state = 'claimed';
		this.recordAdopted(el);
		checkMarkerIdentity(tm.comment, el);
		tm.comment.remove();
		stripDirectTextNodes(el);
		captureSsrElementChildren(el);
		stampClaimed(el);
		return { el };
	}

	claimByKey(key: string, options?: ClaimByKeyOptions): HydrateClaim | null {
		const strKey = String(key);
		// Strict positional claim: the item claims the cursor's marker. Interior
		// markers of the previously-claimed item are consumed by that item's own
		// render, so by the time we get here the cursor points at this item's
		// SSR root. Only EXACT ordering SSR == client is claimed; divergence
		// renders the item fresh at the region tail (canary reports the ghost)
		// unless `relocate` upgrades the miss to adopt+move (Hydrate-Todo A4).
		for (let i = this.idx; i < this.markers.length; i++) {
			const tm = this.markers[i];
			if (tm.state === 'claimed') continue;
			const el = tm.comment.nextElementSibling;
			if (this.isAlreadyAdopted(tm, el)) continue;
			if (el && el.getAttribute('data-vsk-key') === strKey) {
				const claim = this.adoptKeyedElement(tm, el);
				this.retireAliases(el);
				return claim;
			}
			// First unclaimed marker is not this item — don't scan past it.
			if (options && options.relocate) {
				const moved = this.relocateByKey(strKey, tm);
				if (moved) return moved;
			}
			// If the key exists later in the region this is a genuine SSR↔client
			// reorder; without relocate the item renders fresh at the tail
			// while its SSR twin rots. Report it so reorder divergence is
			// visible instead of silent.
			if (this.peekKey(strKey) !== null) {
				reportMiss(
					'key-reorder',
					`keyed item "${strKey}" is not at the cursor; SSR order and client order diverge — item renders fresh, SSR twin orphaned.`,
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
	private relocateByKey(strKey: string, anchor: TrackedMarker): HydrateClaim | null {
		for (let j = this.idx; j < this.markers.length; j++) {
			const tm = this.markers[j];
			if (tm.state === 'claimed') continue;
			const el = tm.comment.nextElementSibling;
			if (!el || this.adopted.has(el)) continue;
			if (el.getAttribute('data-vsk-key') !== strKey) continue;
			const parent = el.parentNode;
			const anchorParent = anchor.comment.parentNode;
			if (!parent || parent !== anchorParent) continue;
			const claim = this.adoptKeyedElement(tm, el);
			this.retireAliasesOf(el);
			try {
				parent.insertBefore(el, anchor.comment);
			} catch {
				// A failed move must not strand an adopted node: the claim
				// stands (identity preserved) and order falls back to markers.
			}
			reportMiss(
				'key-reorder',
				`keyed item "${strKey}" adopted out of position and moved into place; SSR order and client order diverged.`,
				false
			);
			return claim;
		}
		return null;
	}

	peekKey(key: string): Element | null {
		const strKey = String(key);
		// Non-consuming scan across EVERY remaining unclaimed marker: used to
		// discover the containing region's DOM bounds before anchoring, so it
		// must find items regardless of their position in the region.
		for (let i = this.idx; i < this.markers.length; i++) {
			const tm = this.markers[i];
			if (tm.state === 'claimed') continue;
			const el = tm.comment.nextElementSibling;
			if (el && this.adopted.has(el)) continue;
			if (el && el.getAttribute('data-vsk-key') === strKey) return el;
		}
		return null;
	}

	insertBeforeNextClaim(node: Node): boolean {
		// Find the next marker the positional cursor would consume: exactly the
		// slot a region occupying this source position would have occupied in
		// the SSR DOM.
		let i = this.idx;
		while (i < this.markers.length && this.markers[i].state === 'claimed') i++;
		const next = i < this.markers.length ? this.markers[i] : null;
		const host = next && next.comment.parentNode ? next.comment.parentNode : this.root;
		if (host === null || host === undefined) return false;
		try {
			// Inserting in front of the marker keeps node order = source order;
			// the marker itself is untouched (the following claim still owns it).
			host.insertBefore(node, next ? next.comment : null);
			return true;
		} catch {
			return false;
		}
	}
}

export function createHydrateWalker(container: HTMLElement | null, markerList?: Comment[]): HydrateWalker {
	const markers = markerList || (container ? collectVskMarkers(container) : []);
	return new WalkerEngine(container, markers);
}

export function createHydrateChildWalker(parentEl: HTMLElement | null): HydrateWalker {
	let childIdx = 0;
	const children = parentEl ? parentEl.children : [];

	return {
		root: parentEl,
		done() {
			return childIdx >= children.length;
		},
		nextElement(tag?: string) {
			while (childIdx < children.length) {
				const child = children[childIdx++];
				if (!tag || child.tagName.toLowerCase() === tag) {
					stripDirectTextNodes(child);
					captureSsrElementChildren(child);
					stampClaimed(child);
					return child;
				}
			}
			return document.createElement(tag || 'div');
		},
		claimOnly(tag?: string) {
			while (childIdx < children.length) {
				const child = children[childIdx++];
				if (!tag || child.tagName.toLowerCase() === tag) {
					captureSsrElementChildren(child);
					stampClaimed(child);
					return child;
				}
			}
			return document.createElement(tag || 'div');
		},
		subWalker(rootEl: HTMLElement) {
			return createHydrateChildWalker(rootEl);
		},
		retireDetached() {
			// Child-walkers hold no marker list; nothing to sweep.
		},
		takeMarkers(_comments: Comment[]) {
			// Child-walkers hold no marker list; nothing to transfer. The
			// layout slot contract falls back to the shared walk.
		},
	};
}

export function hydrate(
	container: HTMLElement,
	componentFn: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown,
	props?: Record<string, unknown>,
): unknown {
	const walker = createHydrateWalker(container);
	const result = runInHydrateBlock(() => componentFn(props || {}, new Map(), walker));
	assertFullyHydrated(container);
	return result;
}

// ---------------------------------------------------------------------------
// Deferred-hydration liveness (Hydrate-Todo A3).
//
// RULE: never hydrate a dead page. A deferred batch (viewport/idle/
// interaction) may fire after an SPA navigation replaced the content it was
// meant to claim — running componentFn then mounts duplicate content and leaks
// effects into detached DOM. Every batch re-validates:
//   1. container still connected (`isConnected`),
//   2. no newer navigation happened since the strategy started (epoch compare),
//      unless the caller supplies its own `isCurrent` gate.
// The router bumps the epoch on every navigation (see `bumpNavEpoch`).
// ---------------------------------------------------------------------------

export interface DeferredHydrationOptions {
	/**
	 * Custom liveness gate. When provided it replaces the epoch compare
	 * (the `isConnected` check always runs). Return false to drop the batch.
	 */
	isCurrent?: () => boolean;
}

export function bumpNavEpoch(): number {
	try {
		const g = globalThis as Record<string, unknown>;
		const next = ((g.__vesk_nav_epoch as number) || 0) + 1;
		g.__vesk_nav_epoch = next;
		return next;
	} catch {
		return 0;
	}
}

function navEpoch(): number {
	try {
		return ((globalThis as Record<string, unknown>).__vesk_nav_epoch as number) || 0;
	} catch {
		return 0;
	}
}

function batchAlive(
	container: HTMLElement,
	epoch: number,
	isCurrent?: () => boolean,
): boolean {
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

// ---------------------------------------------------------------------------
// Viewport viewport hydration: markers below the fold are held until the
// observer reports them intersecting. The hold is tracked explicitly (no
// `vsk-hold` text mutation, no `_observed` monkey-patch) so the marker state
// machine stays unambiguous and `assertFullyHydrated` can count held markers.
// ---------------------------------------------------------------------------

export interface ViewportHydrationHandle extends Promise<void> {
	cancel(): void;
}

export function hydrateViewport(
	container: HTMLElement,
	componentFn: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown,
	props?: Record<string, unknown>,
	rootMargin = 500,
	options: DeferredHydrationOptions = {},
): ViewportHydrationHandle {
	const epoch = navEpoch();
	const isCurrent = options.isCurrent;
	let cancelled = false;
	let cancelFn: () => void = () => {};
	const promise = new Promise<void>((resolve) => {
		const finish = (): void => {
			cancelled = true;
			cancelFn = () => {};
			resolve();
		};
		cancelFn = finish;
		if (!batchAlive(container, epoch, isCurrent)) return finish();
		start();
		function start(): void {
			if (cancelled) return finish();
			if (document.readyState !== 'complete') {
				const onLoad = () => {
					window.removeEventListener('load', onLoad);
					if (cancelled || !batchAlive(container, epoch, isCurrent)) return finish();
					begin();
				};
				window.addEventListener('load', onLoad);
				return;
			}
			begin();
		}
		function begin(): void {
			const allMarkers = collectVskMarkers(container);

			const viewportMarkers: Comment[] = [];
			const deferredMarkers: Comment[] = [];
			for (const marker of allMarkers) {
				const el = marker.nextElementSibling;
				if (!el) { deferredMarkers.push(marker); continue; }
				const rect = el.getBoundingClientRect();
				if (rect.bottom < -rootMargin || rect.top > window.innerHeight + rootMargin) {
					deferredMarkers.push(marker);
				} else {
					viewportMarkers.push(marker);
				}
			}

			const held = new Set<Comment>(deferredMarkers);

			const viewportWalker = createHydrateWalker(container, viewportMarkers);
			runInHydrateBlock(() => componentFn(props || {}, new Map(), viewportWalker));

			if (deferredMarkers.length === 0) {
				assertFullyHydrated(container);
				return finish();
			}
			const observer = new IntersectionObserver((entries) => {
				if (!batchAlive(container, epoch, isCurrent)) {
					observer.disconnect();
					return finish();
				}
				const toHydrate: Comment[] = [];
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const el = entry.target;
						const siblings = el.parentNode ? Array.from(el.parentNode.childNodes) : [];
						const heldMarker = siblings.find(
							(n) => n.nodeType === 8 && held.has(n as Comment) && (n as Comment).nextElementSibling === el
						) as Comment | undefined;
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
					runInHydrateBlock(() => componentFn(props || {}, new Map(), w));
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
					// ignore disconnect failures
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

export interface IdleHydrationOptions extends HydrateIdleOptions, DeferredHydrationOptions {}

/**
 * Idle hydration (Hydrate-Todo B2): waits for the first idle window, then
 * hydrates the whole container in ONE full run and stops.
 *
 * A previous design re-invoked the component once per marker chunk. That is
 * irreparably unsafe without codegen yield points: every run claims its own
 * chunk but misses everything else, so each run twins out-of-chunk SSR content
 * with fresh nodes AND double-registers effects. Single-shot keeps the RULE
 * (no duplication); true intra-render time-slicing needs compiler support and
 * `chunkSize` is reserved for it (accepted, currently no effect).
 */
export function hydrateIdle(
	container: HTMLElement,
	componentFn: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown,
	props?: Record<string, unknown>,
	options: IdleHydrationOptions = {},
): HydrateCancelBase {
	const epoch = navEpoch();
	const isCurrent = options.isCurrent;
	const timeout = options.timeout || 3000;

	const rIC = window.requestIdleCallback || ((cb: IdleRequestCallback) => setTimeout(cb, 50));
	const cIC = window.cancelIdleCallback || clearTimeout;

	let rafId: number | null = null;
	let cancelled = false;
	let ran = false;

	function runOnce() {
		if (cancelled || ran) return;
		ran = true;
		// Liveness at fire time: an idle callback landing after navigation
		// must not hydrate replaced DOM.
		if (!batchAlive(container, epoch, isCurrent)) return;
		const walker = createHydrateWalker(container);
		runInHydrateBlock(() => componentFn(props || {}, new Map(), walker));
		assertFullyHydrated(container);
	}

	rafId = rIC(runOnce as IdleRequestCallback, { timeout });

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

export function needsHydration(container: HTMLElement): boolean {
	const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
		acceptNode: (node) => (isVskMarkerText(node.textContent) ? _FILTER_ACCEPT : _FILTER_SKIP),
	});
	return walker.nextNode() !== null;
}

export interface InteractionHydrationOptions extends HydrateInteractionOptions, DeferredHydrationOptions {}

export function hydrateOnInteraction(
	container: HTMLElement,
	componentFn: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown,
	props?: Record<string, unknown>,
	options: InteractionHydrationOptions = {},
): HydrateCancel {
	const epoch = navEpoch();
	const isCurrent = options.isCurrent;
	const events = options.events || ['click', 'touchstart', 'focus', 'mouseenter'];
	let hydrated = false;

	function trigger(_eventType: string) {
		if (hydrated) return;
		hydrated = true;

		for (const ev of events) {
			container.removeEventListener(ev, handler);
		}

		// An interaction that arrives after navigation must not hydrate the
		// previous page's markers into replaced content.
		if (!batchAlive(container, epoch, isCurrent)) return;

		const markers = collectVskMarkers(container);
		if (markers.length > 0) {
			const walker = createHydrateWalker(container, markers);
			runInHydrateBlock(() => componentFn(props || {}, new Map(), walker));
		}
		assertFullyHydrated(container);
	}

	const handler = (e: Event) => trigger(e.type);

	for (const ev of events) {
		container.addEventListener(ev, handler, { once: true });
	}

	return {
		cancel() { hydrated = true; for (const ev of events) container.removeEventListener(ev, handler); },
		hydrateNow() { trigger('manual'); },
	};
}

export function hydrationCount(container: HTMLElement): number {
	let count = 0;
	const walker = document.createTreeWalker(container, _SHOW_COMMENT, {
		acceptNode: (node) => {
			if (isVskMarkerText(node.textContent)) { count++; return _FILTER_ACCEPT; }
			return _FILTER_SKIP;
		},
	});
	while (walker.nextNode());
	return count;
}

export function hydrateInitial(
	container: HTMLElement,
	componentFn: (props: Record<string, unknown>, registry: Map<string, unknown>, walker: HydrateWalker) => unknown,
	props?: Record<string, unknown>,
): void {
	const walker = createHydrateWalker(container);
	runInHydrateBlock(() => componentFn(props || {}, new Map(), walker));
	assertFullyHydrated(container);
}