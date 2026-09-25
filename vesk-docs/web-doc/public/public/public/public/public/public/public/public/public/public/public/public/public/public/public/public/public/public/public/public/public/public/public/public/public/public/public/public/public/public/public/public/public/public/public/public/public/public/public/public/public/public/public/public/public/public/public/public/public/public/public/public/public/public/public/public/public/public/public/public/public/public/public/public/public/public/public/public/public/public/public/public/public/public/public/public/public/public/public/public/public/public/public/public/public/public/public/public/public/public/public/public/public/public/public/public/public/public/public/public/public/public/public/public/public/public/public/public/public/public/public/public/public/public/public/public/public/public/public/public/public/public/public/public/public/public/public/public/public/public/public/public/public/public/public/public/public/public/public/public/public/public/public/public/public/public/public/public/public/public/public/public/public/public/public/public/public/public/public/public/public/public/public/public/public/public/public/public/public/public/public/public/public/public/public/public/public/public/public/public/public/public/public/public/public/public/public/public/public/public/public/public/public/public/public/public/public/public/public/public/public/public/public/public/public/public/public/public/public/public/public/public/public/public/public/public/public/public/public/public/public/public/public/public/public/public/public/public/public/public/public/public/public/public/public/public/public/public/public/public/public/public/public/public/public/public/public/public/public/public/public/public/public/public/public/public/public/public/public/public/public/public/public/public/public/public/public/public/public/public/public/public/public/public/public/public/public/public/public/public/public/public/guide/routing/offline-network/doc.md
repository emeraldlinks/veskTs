# Offline & Network Boundaries

When an SPA navigation fails because of lost connectivity, Vesk shows a
dedicated offline experience — **never** the 404 page and never a raw
`TypeError`. The displayed boundary re-renders live as connectivity
changes, and the app auto-recovers when the browser comes back online.

## Precedence

On an offline navigation failure the router picks the first available:

1. **`offline.vsk`** (nearest in the route tree) — mounted only when the
   browser is actually offline.
2. **`network.vsk`** (nearest) — for any connectivity failure, including
   degraded connections.
3. **Router option `offline`** — a component or raw HTML string.
4. **Nearest `error.vsk`** — invoked with `{ offline: true,
   networkState }`, so existing error boundaries can style the offline
   case.
5. **Built-in panel** — "📡 You're offline" with a Retry button.

## `offline.vsk`

```vsk
// app/offline.vsk
component Offline(props: {
	url: string;      // target pathname of the failed navigation
	params: Record<string, string>;
	retry(): void;
	online: boolean;
}) {
	<div class="offline">
		<h1>You're offline</h1>
		<p>Couldn't reach {props.url}.</p>
		<button onClick={() => props.retry()}>Retry</button>
	</div>
}
```

## `network.vsk`

Receives the live Network Information API state (degrades to nulls where
unsupported):

```vsk
// app/network.vsk
component Network(props: {
	url: string;
	params: Record<string, string>;
	retry(): void;
	online: boolean;
	effectiveType: 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';
	downlink: number | null;   // Mbps estimate
	rtt: number | null;        // ms estimate
	saveData: boolean;
}) {
	if (!props.online) {
		<div class="offline">
			<h1>You're offline</h1>
			<p>Couldn't reach {props.url}.</p>
			<button onClick={() => props.retry()}>Retry</button>
		</div>
	} else if (props.saveData) {
		<p>Data saver on — showing light version.</p>
	} else {
		<p>Connection: {props.effectiveType}</p>
	}
}
```

## Router option

```ts
createFileRouter(tree, {
	offline: (props /* { url, params, retry } */) => `<h1>Offline</h1>`,
});
```

Accepts a component function or an HTML string. Omit it to get the
built-in default panel.

## Live updates & recovery

- While any of these boundaries is visible, the router subscribes via
  `watchNetwork()` and re-renders it as connectivity changes (e.g. 3g →
  offline → online). The subscription self-cancels on the next navigation.
- A window `online` event re-navigates the current URL automatically —
  the page recovers without user action.
- `retry()` is debounced (300 ms) to prevent render loops.
- A route whose JS chunk failed to load is classified offline (via an
  active connectivity probe) while `navigator.onLine === false`; otherwise
  it surfaces that route's error page — never a 404, never an uncaught
  exception.

## Network utilities

```ts
import { getNetworkState, watchNetwork } from '@vesk/runtime';
// exported from the client barrel

/**
 * Snapshot of current connectivity. Unsupported browsers yield
 * effectiveType:'unknown', downlink/rtt:null, saveData:false.
 */
function getNetworkState(): {
	online: boolean;
	effectiveType: 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';
	downlink: number | null;
	rtt: number | null;
	saveData: boolean;
};

/**
 * Subscribe to connectivity changes (window online/offline + navigator
 * connection change when available). No-op safe on server.
 * Returns unsubscribe.
 */
function watchNetwork(cb: (state: NetworkState) => void): () => void;
```

> These are **client-bundle APIs** — they don't exist on the server, so
> gate them behind a `client` island's `{#client}` block and show a
> placeholder until state arrives:

```vsk
component ConnectionBadge() client {
	let &[state] = track<any>(null)

	{#client}
		effect(() => {
			state.set(getNetworkState())
			return watchNetwork((s: any) => state.set(s))
		})
	{/client}

	if (state && !state.online) {
		<span class="badge offline">offline · {state.effectiveType}</span>
	} else if (state) {
		<span class="badge">online</span>
	} else {
		<span class="badge">…</span>
	}
}
```
