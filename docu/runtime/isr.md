# Incremental Static Regeneration

ISR lets you render pages and components as static HTML while keeping
them up-to-date with time-based revalidation.

## Page-level ISR

Cache a full page's HTML:

```ts
import { pageIsr } from '@vesk/runtime';

export async function Loader() {
  return pageIsr(
    'homepage',
    async () => {
      const data = await fetchData();
      return { html: renderHome(data) };
    },
    { tags: ['home'], revalidate: 60 }
  );
}
```

### pageIsr options

| Option | Type | Description |
|--------|------|-------------|
| `tags` | `string[]` | Tags for targeted invalidation |
| `revalidate` | `number` | Seconds before entry is stale |

Returns `{ html, headers, stale }`.

## Component-level ISR

Cache individual component output:

```ts
import { componentIsr } from '@vesk/runtime';

const html = componentIsr(
  'sidebar',
  () => renderSidebar(),
  { tags: ['sidebar'], revalidate: 120 }
);
```

## Data-level ISR

Cache arbitrary data with stale-while-revalidate:

```ts
import { isr } from '@vesk/runtime';

const { data, stale } = await isr(
  'product-list',
  async () => {
    const res = await fetch('https://api.store.com/products');
    return res.json();
  },
  { tags: ['products'], revalidate: 300 }
);
```

## Revalidation

### Revalidate by path

```ts
import { revalidatePath } from '@vesk/runtime';

await revalidatePath('/products');
```

### Revalidate by tag

```ts
import { revalidateTag } from '@vesk/runtime';

await revalidateTag('products');
```

### Revalidate a component

```ts
import { revalidateComponent } from '@vesk/runtime';

revalidateComponent('sidebar');
```

### Clear all ISR caches

```ts
import { clearIsrCache } from '@vesk/runtime';

clearIsrCache();
```

## How it works

1. On first request, the `fetcher`/`renderFn` runs and the result is
   cached.
2. Subsequent requests serve the cached version immediately.
3. After `revalidate` seconds, the next request serves the stale version
   while regenerating in the background (stale-while-revalidate).
4. Tags allow targeted invalidation without clearing the entire cache.

## Verified against

- `packages/runtime/src/isr.ts` — `isr`, `pageIsr`, `componentIsr`,
  `revalidatePath`, `revalidateTag`, `revalidateComponent`,
  `clearIsrCache`
- `packages/runtime/src/index-server.ts` — ISR exports
