# Keyed Reconciliation

Vesk provides `reconcile` for efficient keyed list updates without a
virtual DOM. It operates directly on the real DOM using comment markers.

## reconcile function

```ts
import { reconcile } from '@vesk/runtime';

const update = reconcile(
  anchor,          // start comment marker node
  endAnchor,       // end comment marker node
  items,           // initial items array
  (item) => item.id,  // key function
  (item, index, effects) => {
    // create DOM for this item
    const el = document.createElement('li');
    el.textContent = item.name;
    anchor.parentNode.insertBefore(el, endAnchor);
  }
);

// Later: call update with new items
update(newItems);
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `anchor` | `Node` | Start boundary comment marker |
| `endAnchor` | `Node` | End boundary comment marker |
| `items` | `T[]` | Initial items |
| `keyFn` | `(item: T) => string` | Function to extract unique key |
| `createItem` | `(item: T, index: number, effs: Block[]) => void` | DOM creation callback |

### Returns

A function `(newItems: T[]) => void` that efficiently patches the DOM
to match the new items.

## How it works

1. Comment markers (`<!--k:key-->`) are inserted into the DOM as
   boundaries.
2. On update, the reconciler diffs keys between old and new lists.
3. Matching keys: reuse existing DOM nodes.
4. New keys: create new DOM nodes via `createItem`.
5. Removed keys: destroy associated blocks and remove DOM nodes.
6. Reordered keys: move existing DOM nodes to correct positions.

This is a keyed reconciliation — it does **not** diff content, only
keys. This makes it O(n) for the common case.

## Usage in the compiler

The `For` headless component and `for` loops in statement mode both
compile to keyed reconciliation. You typically don't call `reconcile`
directly — it's used internally by the compiled output.

## Verified against

- `packages/runtime/src/reconcile.ts` — `reconcile` function
- `packages/runtime/src/index-client.ts` — `reconcile` export
