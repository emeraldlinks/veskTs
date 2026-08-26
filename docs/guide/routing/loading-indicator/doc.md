# Loading Indicator

A global top-of-page progress bar driven by SPA navigations — plus a
reactive API you can drive yourself.

## Automatic behavior

During every client-side navigation:

1. `loadingStart()` fires synchronously at navigate start.
2. The bar appears after the **throttle** window (default 200 ms) — fast
   navigations never flash.
3. Progress advances on an ease-out (atan back-off) curve toward
   `duration` (default 2000 ms).
4. `loadingFinish()` runs when content + route data settle; failures paint
   the **error color** and set `useRouter().error`.
5. After `hideDelay` the bar hides, then resets to 0 after `resetDelay`.

## Reactive state

```vsk
component Status() {
	const r = useRouter()
	{#if r.isLoading}
		<span>Navigating… {r.progress}%</span>
	{/if}
}
```

- `useRouter().isLoading` / `.progress` / `.error` read the same singleton
  cells.

## Component

```vsk
import { LoadingIndicator } from '@vesk/runtime/router';

component App() {
	<LoadingIndicator height={3} position="top" />
	…
}
```

Renders a fixed bar (`data-vesk-loading-indicator`) with a default
indigo→sky gradient; SSR emits a hidden snapshot so there is no layout
shift.

```ts
/**
 * Fixed-position loading bar bound to the global navigation progress.
 * Set color:false to style it yourself via CSS classes.
 */
function LoadingIndicator(props?: {
	duration?: number;          // total animation ms. Default 2000
	throttle?: number;          // delay before visible. Default 200
	hideDelay?: number;         // completed-bar visible ms. Default 500
	resetDelay?: number;        // reset-to-0 delay after hide. Default 400
	color?: string | false;     // default gradient; false disables styling
	errorColor?: string;        // default red gradient
	height?: number | string;   // default 3 (px)
	position?: 'top' | 'bottom';// default 'top'
	zIndex?: number;            // default 999999
	class?: string;
	style?: string;
	children?: unknown;         // custom inner content replaces the bar
}): Node | string;
```

## Imperative API

The same singleton can drive any long task (uploads, polling):

```ts
import {
	loadingStart, loadingSet, loadingFinish,
	useLoadingIndicator, configureLoadingIndicator, getLoadingState,
} from '@vesk/runtime';

loadingStart();
await upload();
loadingFinish();

// manual control
loadingStart({ force: true });   // skip throttle
loadingSet(50);                  // pin progress

// component-level handle with reactive cells
const li = useLoadingIndicator({ duration: 5000 });
effect(() => console.log(li.progress.get(), li.isLoading.get()));
li.start(); li.set(80); li.finish({ error: true }); li.clear();

// raw cells
const { progress, isLoading, error } = getLoadingState();

// tune defaults globally
configureLoadingIndicator({ throttle: 100 });
```

```ts
/** Merge overrides into the global indicator config. */
function configureLoadingIndicator(opts?: LoadingIndicatorOptions): void;

/** Begin a load. force:true shows instantly (skips throttle). */
function loadingStart(opts?: { force?: boolean }): void;

/** Pin progress to a 0–100 value. */
function loadingSet(at?: number, opts?: { force?: boolean }): void;

/** Complete. error:true paints errorColor; force resets instantly. */
function loadingFinish(opts?: { force?: boolean; error?: boolean }): void;

/** Cancel pending appearance/animation timers (does not change cells). */
function loadingClear(): void;

/** Handle with reactive cells + manual methods (per-instance options). */
function useLoadingIndicator(options?: LoadingIndicatorOptions): {
	progress: Tracked<number>;
	isLoading: Tracked<boolean>;
	error: Tracked<boolean>;
	start(opts?): void;
	set(value: number, opts?): void;
	finish(opts?): void;
	clear(): void;
};

function getLoadingProgress(): number;
function isLoadingActive(): boolean;
function getLoadingError(): boolean;
function getLoadingState(): { progress: Tracked<number>; isLoading: Tracked<boolean>; error: Tracked<boolean> };

const LOADING_INDICATOR_DEFAULT_COLOR: string;
const LOADING_INDICATOR_DEFAULT_ERROR_COLOR: string;
```

## Styling

Target `[data-vesk-loading-indicator]` or pass `class`. With
`color: false` the element has no inline gradient — apply your own:

```css
[data-vesk-loading-indicator] {
	background: linear-gradient(90deg, lime, teal);
}
```
