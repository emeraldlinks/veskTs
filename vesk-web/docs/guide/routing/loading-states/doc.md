# Loading States

Two complementary layers: instant route-level placeholders during SPA
navigation, and the global progress bar.

## `loading.vsk`

A `loading.vsk` in any route directory renders **synchronously** the
moment an SPA navigation toward that subtree begins — before data fetches
and chunk loads finish.

```vsk
// app/posts/loading.vsk
component LoadingPosts(props: { params: Record<string, string> }) {
	<p>Loading…</p>
}
```

- Receives `{ params }`.
- The nearest `loading.vsk` up the tree wins.
- Replaced by the real page as soon as content + `X-Vesk-Data` payload
  settle; then hash anchors scroll into view.
- SSR responses are already complete — loading UI is client-navigation
  only.

## Progress bar

Every navigation also drives the [Loading Indicator](../loading-indicator/doc.md):
a top progress bar that appears after a short throttle (fast navigations
never flash), advances on an ease-out curve, and paints red on errors.

Read it reactively from any component:

```vsk
component Status() {
	const r = useRouter()

	return (
		<span>
			{r.isLoading ? 'Navigating…' : 'Idle'}
			{r.progress > 0 ? ` ${r.progress}%` : ''}
		</span>
	)
}
```

| Facade read | Meaning |
| --- | --- |
| `useRouter().isLoading` | navigation in flight |
| `useRouter().progress` | 0–100 estimate (0 when idle) |
| `useRouter().error` | last navigation finished with an error |

## Data-level loading

For fetch-driven UI inside a page, `useFetch` exposes reactive state:

```vsk
component Posts() {
	const res = useFetch('/api/posts', { key: 'posts' })

	{res.loading && <p>Loading posts…</p>}
	{res.error && <button onClick={() => res.refresh()}>Retry</button>}
	...
}
```

See [Data Fetching](../../data-fetching/doc.md).

## Layer interplay

1. Navigation starts → progress bar starts → `loading.vsk` mounts.
2. Chunks/data resolve → page swaps in → bar finishes → placeholder gone.
3. Failures → error/offline boundaries take over (bar paints error color).
