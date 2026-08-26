/**
 * LoadingIndicator — a Nuxt-style page-navigation progress bar.
 *
 * A global singleton driven by the router: `loadingStart()` fires when an SPA
 * navigation begins and `loadingFinish()` when its content (and route data)
 * has settled. `<LoadingIndicator/>` renders the bar anywhere in a layout;
 * `useLoadingIndicator()` exposes the reactive state for fully custom UIs.
 *
 * Progress backs off as it approaches 100% (atan curve) so long loads never
 * prematurely complete; short navigations stay invisible thanks to `throttle`.
 * State lives in tracked cells so any `effect()`-driven UI updates live.
 */

import { tracked, get, set } from '@vesk/runtime/src/ripple-runtime';
import type { Tracked } from '@vesk/runtime/src/ripple-runtime';
import { effect } from '@vesk/runtime/src/ripple-blocks';
import { __isHydrating } from '@vesk/runtime/src/router-components';

// ── Options ──────────────────────────────────────────────────

export interface LoadingIndicatorOptions {
	/** Total duration of the progress animation, ms. Default 2000. */
	duration?: number;
	/** Delay before the bar appears/starts animating, ms. Default 200. */
	throttle?: number;
	/** How long the completed bar stays visible before hiding, ms. Default 500. */
	hideDelay?: number;
	/** How long after hiding before progress resets to 0, ms. Default 400. */
	resetDelay?: number;
	/**
	 * Custom progress estimator receiving `(duration, elapsedMs)` and
	 * returning 0–100. Defaults to an atan back-off curve.
	 */
	estimatedProgress?: (duration: number, elapsed: number) => number;
}

interface ResolvedIndicatorOpts {
	duration: number;
	throttle: number;
	hideDelay: number;
	resetDelay: number;
	estimatedProgress: (duration: number, elapsed: number) => number;
}

function defaultEstimatedProgress(duration: number, elapsed: number): number {
	const completionPercentage = (elapsed / duration) * 100;
	return ((2 / Math.PI) * 100) * Math.atan(completionPercentage / 50);
}

const globalOpts: ResolvedIndicatorOpts = {
	duration: 2000,
	throttle: 200,
	hideDelay: 500,
	resetDelay: 400,
	estimatedProgress: defaultEstimatedProgress,
};

/** Merges option overrides into the global singleton (used by the component's props). */
export function configureLoadingIndicator(opts?: LoadingIndicatorOptions): void {
	if (!opts) return;
	if (typeof opts.duration === 'number' && opts.duration > 0) globalOpts.duration = opts.duration;
	if (typeof opts.throttle === 'number' && opts.throttle >= 0) globalOpts.throttle = opts.throttle;
	if (typeof opts.hideDelay === 'number' && opts.hideDelay >= 0) globalOpts.hideDelay = opts.hideDelay;
	if (typeof opts.resetDelay === 'number' && opts.resetDelay >= 0) globalOpts.resetDelay = opts.resetDelay;
	if (typeof opts.estimatedProgress === 'function') globalOpts.estimatedProgress = opts.estimatedProgress;
}

// ── Reactive state ───────────────────────────────────────────

const progressCell = tracked(0);
const loadingCell = tracked(false);
const errorCell = tracked(false);

function isServer(): boolean {
	// Gated on the SSR-render flag (resource-module convention): during an
	// actual server render no timers should ever be scheduled, while plain
	// Node consumers (unit tests, scripts) get the full client behavior.
	return !!(globalThis as Record<string, unknown>).__vsk_ssr;
}

function now(): number {
	if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
	return Date.now();
}

let rafId: ReturnType<typeof setTimeout> | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let resetTimer: ReturnType<typeof setTimeout> | null = null;
let animating = false;

function clearAnim(): void {
	animating = false;
	if (throttleTimer !== null) { clearTimeout(throttleTimer); throttleTimer = null; }
	if (rafId !== null) { clearTimeout(rafId); rafId = null; }
}

function clearTimers(): void {
	if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
	if (resetTimer !== null) { clearTimeout(resetTimer); resetTimer = null; }
}

/**
 * Runs the estimator loop from 0 elapsed. The loop stops whenever anything
 * else takes control of progress (`loadingSet`, `loadingFinish`, `loadingClear`).
 */
function startProgress(): void {
	animating = true;
	let startTimeStamp: number | null = null;

	const step = (): void => {
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

/** Makes the bar visible immediately or after the throttle window. */
function present(opts?: { force?: boolean }): void {
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

/**
 * Starts the loading animation from 0%. Without `{ force: true }` the bar
 * waits `throttle` ms before becoming visible, so fast navigations never flash.
 */
export function loadingStart(opts?: { force?: boolean }): void {
	clearTimers();
	clearAnim();
	set(errorCell, false);
	set(progressCell, 0);
	present(opts);
	startProgress();
}

/**
 * Jumps the bar to a specific progress value (0–100). Values ≥ 100 finish.
 * A manual set takes control: the automatic estimation stops until the next
 * `start()`, so the value sticks instead of being overwritten by a frame.
 */
export function loadingSet(at?: number, opts?: { force?: boolean }): void {
	if (__isHydrating) return;
	if ((at ?? 0) >= 100) return loadingFinish({ force: opts?.force });
	clearAnim();
	clearTimers();
	set(progressCell, Math.max(0, at ?? 0));
	present(opts);
}

function hide(): void {
	hideTimer = setTimeout(() => {
		hideTimer = null;
		set(loadingCell, false);
		resetTimer = setTimeout(() => {
			resetTimer = null;
			set(progressCell, 0);
		}, globalOpts.resetDelay);
	}, globalOpts.hideDelay);
}

/**
 * Completes the animation at 100%. With `{ error: true }` the bar switches to
 * the error color while hiding; with `{ force: true }` it resets instantly.
 */
export function loadingFinish(opts?: { force?: boolean; error?: boolean }): void {
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

/** Cancels the pending appearance timer and animation frame without changing state. */
export function loadingClear(): void {
	clearAnim();
}

export interface LoadingIndicatorHandle {
	/** Tracked cell — current progress 0–100. Read inside effect()/get(). */
	progress: Tracked<number>;
	/** Tracked cell — true once the bar is visible. */
	isLoading: Tracked<boolean>;
	/** Tracked cell — true when the last load finished with an error. */
	error: Tracked<boolean>;
	start(opts?: { force?: boolean }): void;
	set(value: number, opts?: { force?: boolean }): void;
	finish(opts?: { force?: boolean; error?: boolean }): void;
	clear(): void;
}

const handle: LoadingIndicatorHandle = {
	progress: progressCell,
	isLoading: loadingCell,
	error: errorCell,
	start: loadingStart,
	set: loadingSet,
	finish: loadingFinish,
	clear: loadingClear,
};

/**
 * Accesses the shared loading-indicator singleton. Call this (or render
 * `<LoadingIndicator/>`) once per app — every call returns the same state,
 * so programmatic `start()`/`finish()` drive the same bar the router does.
 */
export function useLoadingIndicator(options?: LoadingIndicatorOptions): LoadingIndicatorHandle {
	configureLoadingIndicator(options);
	return handle;
}

export function getLoadingProgress(): number {
	return get(progressCell) as number;
}

export function isLoadingActive(): boolean {
	return get(loadingCell) === true;
}

export function getLoadingError(): boolean {
	return get(errorCell) === true;
}

// ── Component ────────────────────────────────────────────────

export const LOADING_INDICATOR_DEFAULT_COLOR =
	'repeating-linear-gradient(to right,#38bdf8 0%,#6366f1 50%,#8b5cf6 100%)';

export const LOADING_INDICATOR_DEFAULT_ERROR_COLOR =
	'repeating-linear-gradient(to right,#f87171 0%,#ef4444 100%)';

export interface LoadingIndicatorProps extends LoadingIndicatorOptions {
	/** Bar background (CSS color/gradient). `false` disables explicit styling so CSS classes take over. */
	color?: string | false;
	/** Background used while the error flag is set. */
	errorColor?: string;
	/** Bar height — number (px) or any CSS length. Default 3. */
	height?: number | string;
	/** Edge to pin the bar to. Default 'top'. */
	position?: 'top' | 'bottom';
	/** Stacking context for the fixed bar. Default 999999. */
	zIndex?: number;
	class?: string;
	className?: string;
	style?: string;
	/** Custom inner content replacing the default bar element. */
	children?: unknown;
	[k: string]: unknown;
}

const INDICATOR_ATTR = 'data-vesk-loading-indicator';

function heightCss(height: number | string | undefined): string {
	if (typeof height === 'number') return `${height}px`;
	if (typeof height === 'string' && height.trim() !== '') return height;
	return '3px';
}

function escapeAttr(v: string): string {
	let out = '';
	for (const ch of v) {
		if (ch === '&') out += '&amp;';
		else if (ch === '"') out += '&quot;';
		else if (ch === '<') out += '&lt;';
		else out += ch;
	}
	return out;
}

function baseStyleEntries(props: LoadingIndicatorProps): [string, string][] {
	const top = props.position !== 'bottom';
	const entries: [string, string][] = [
		['position', 'fixed'],
		[top ? 'top' : 'bottom', '0'],
		['right', '0'],
		['left', '0'],
		['pointer-events', 'none'],
		['width', 'auto'],
		['height', heightCss(props.height)],
		['z-index', String(props.zIndex != null ? props.zIndex : 999999)],
		['transform-origin', 'left'],
		['transition', 'transform 0.1s, height 0.4s, opacity 0.4s'],
	];
	return entries;
}

function styleToString(entries: [string, string][], extra: Record<string, string>): string {
	const parts = entries.map(([k, v]) => `${k}:${v}`);
	for (const [k, v] of Object.entries(extra)) parts.push(`${k}:${v}`);
	return parts.join(';');
}

function applyState(props: LoadingIndicatorProps): Record<string, string> {
	const progress = get(progressCell) as number;
	const isLoading = get(loadingCell) === true;
	const errored = get(errorCell) === true;
	const bg = errored
		? (props.errorColor || LOADING_INDICATOR_DEFAULT_ERROR_COLOR)
		: (props.color === false ? undefined : (props.color || LOADING_INDICATOR_DEFAULT_COLOR));
	const extra: Record<string, string> = {
		opacity: isLoading ? '1' : '0',
		transform: `scaleX(${progress}%)`,
	};
	if (bg !== undefined) extra.background = bg;
	if (progress > 0 && bg !== undefined) {
		extra['background-size'] = `${(100 / Math.min(progress, 100)) * 100}% auto`;
	}
	return extra;
}

function wire(el: HTMLElement, props: LoadingIndicatorProps, userStyle?: string): void {
	const base = baseStyleEntries(props);
	const paint = (): void => {
		el.style.cssText = styleToString(base, applyState(props)) + (userStyle ? ';' + userStyle : '');
	};
	paint();
	effect(paint);
}

function appendChildren(el: HTMLElement, children: unknown): void {
	if (children == null) return;
	if (typeof children === 'string' || typeof children === 'number') {
		el.appendChild(document.createTextNode(String(children)));
		return;
	}
	if ((children as Node).nodeType) {
		el.appendChild(children as Node);
		return;
	}
	if (Array.isArray(children)) {
		for (const c of children) appendChildren(el, c);
	}
}

type HydrateWalker = { nextElement?: (tag?: string) => Element; root?: HTMLElement | null };

/**
 * Renders the navigation progress bar. On the server it emits a hidden div
 * snapshot (never flashes on first paint); on the client it claims that node
 * during hydration or builds a fresh one for SPA mounts, then keeps its style
 * in sync with the shared indicator state via an effect.
 *
 * Customize with `color`, `errorColor`, `height`, `duration`, `throttle`,
 * `hideDelay`, `resetDelay`, `estimatedProgress`, `position`, `zIndex`,
 * `class`/`style` — or pass `children` to replace the bar entirely and drive
 * your own UI through `useLoadingIndicator()`.
 */
export function LoadingIndicator(
	props: LoadingIndicatorProps = {},
	_registry?: Map<string, unknown>,
	hydrate?: HydrateWalker,
): Node | string {
	configureLoadingIndicator(props);
	const classNameRaw = props.className != null ? String(props.className) : props.class != null ? String(props.class) : '';
	const userStyle = props.style != null ? String(props.style) : '';

	// Rendering-mode check: no document means the HTML-string branch, even
	// outside a live SSR render (unit tests). State-machine gating uses
	// __vsk_ssr instead — see isServer() above.
	if (typeof document === 'undefined') {
		const attrs = [
			INDICATOR_ATTR,
			classNameRaw ? `class="${escapeAttr(classNameRaw)}"` : '',
		].filter(Boolean).join(' ');
		const styleAttr = escapeAttr(styleToString(baseStyleEntries(props), applyState(props)) + (userStyle ? ';' + userStyle : ''));
		return `<div ${attrs} aria-hidden="true" role="presentation" style="${styleAttr}"></div>`;
	}

	let el: HTMLElement;
	if (hydrate && typeof hydrate.nextElement === 'function') {
		el = hydrate.nextElement('div') as HTMLElement;
		if (el && !(el as Node).parentNode && hydrate.root) {
			const existing = hydrate.root.querySelector(`[${INDICATOR_ATTR}]`);
			if (existing) el = existing as HTMLElement;
		}
	} else {
		el = document.createElement('div');
	}
	el.setAttribute(INDICATOR_ATTR, '');
	if (classNameRaw) el.className = classNameRaw;
	appendChildren(el, props.children);
	wire(el, props, userStyle);

	if ((el as Node).parentNode) return document.createDocumentFragment();
	return el;
}
