# Portal

Teleport rendered content to another DOM target — modals, tooltips,
toasts. SSR renders nothing (portals are client-only), so pair with a
`client` component or `{#client}` block.

```ts
/**
 * Move children into `target` (CSS selector or element) on the client.
 * SSR output is an empty string — wrap in an island for client-only UI.
 * Function children receive a fresh DocumentFragment to fill.
 * Renders a comment-node anchor in place.
 *
 * @example
 * component Modal() client {
 *   <Portal target="#modal-root">
 *     <div class="modal">…</div>
 *   </Portal>
 * }
 */
function Portal(props: {
	target: string | HTMLElement;
	children?: Node | ((frag: DocumentFragment) => void);
}): Node | string;
```

## Behavior

- **Server**: returns `''` — nothing renders, no hydration markers.
- **Client**:
  - selector resolved via `document.querySelector`;
  - missing target → comment node `portal: no target` (no crash);
  - a Node child appends directly; a function child is invoked with a new
    `DocumentFragment` appended to the target.

## Example: modal

```vsk
component ConfirmDelete() client {
	let &[open] = track(false)

	return (
		<>
			<button onClick={() => open.set(true)}>Delete…</button>
			{open && (
				<Portal target="body">
					<div class="overlay">
						<div class="dialog">
							<p>Are you sure?</p>
							<button onClick={() => open.set(false)}>Cancel</button>
						</div>
					</div>
				</Portal>
			)}
		</>
	)
}
```

Because the portal content lives under `<body>` (outside your app root),
styles must be global or injected by the component's `<style>` hoist.
