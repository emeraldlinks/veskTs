# Incremental Static Regeneration (ISR)

Some pages are too expensive to render on every request but too dynamic to
freeze forever. ISR gives you a middle ground: the first visitor pays for
the render, everyone else gets the cached result instantly, and the cache
refreshes itself in the background after a TTL you choose.

Vesk implements this as a stale-while-revalidate cache used automatically
by the production server for SSR pages, and available directly for data
and component fragments.

## Semantics

- `revalidate` is in **seconds**. `revalidate <= 0` (default) disables
  caching entirely.
- Fresh hit → cached value, `stale: false`.
- Expired entry → **stale value returned immediately**, background refresh
  kicked off; a failed refresh leaves the stale entry intact.
- Tags index keys; `revalidateTag` invalidates every key tagged with it.

## Page-level ISR

In any `page.vsk`, export revalidation config:

```vsk
export const revalidate = 60          // seconds
export const isrTags = ['posts']

component Post(props) { … }
```

The build scans page sources for these exports and records
`revalidate`/`tags` in the route manifest; the production server and
platform handlers then wrap SSR through `pageIsr()` / an in-memory cache
automatically.

```ts
/** Read revalidate from a number or { revalidate } config object. */
function isrConfigToRevalidate(config: unknown): number;
```

## API reference

All exported from `@vesk/runtime/server`:

```ts
/**
 * Cached async data fetch with stale-while-revalidate semantics.
 * opts.revalidate — TTL seconds (0 = no cache). opts.tags — invalidation tags.
 * Returns { data, stale }.
 */
function isr(key: string, fetcher: () => Promise<unknown>,
             opts?: { tags?: string[]; revalidate?: number }): Promise<{ data: unknown; stale: boolean }>;

/**
 * Cache a full page render ({ html, headers }) under a path key.
 */
function pageIsr(path: string,
                 renderFn: () => Promise<{ html: string; headers?: Record<string, string> }>,
                 opts?: { tags?: string[]; revalidate?: number }): Promise<{ html: string; headers: Record<string, string>; stale: boolean }>;

/**
 * Cache a rendered component fragment (string) under a key.
 * Tag index entries are namespaced comp:<key>.
 */
function componentIsr(key: string,
                      renderFn: () => string | Promise<string>,
                      opts?: { tags?: string[]; revalidate?: number }): Promise<string>;

/** Invalidate a path key AND any keys prefixed by it. Trailing slashes collapse. */
function revalidatePath(path: string): Promise<void>;

/** Invalidate every entry tagged with tag (shared across all three caches). */
function revalidateTag(tag: string): Promise<void>;

/** Invalidate one component-fragment cache entry (sync). */
function revalidateComponent(key: string): void;

/** Clear the data + page + component caches and the tag index. */
function clearIsrCache(): void;
```

## Usage examples

### Data ISR + tags

```ts
import { isr, revalidateTag } from '@vesk/runtime/server';

const { data, stale } = await isr(`post:${slug}`, () => fetchPost(slug), {
	revalidate: 300,
	tags: ['posts'],
});
```

Onward write path (e.g. an API route):

```ts
export async function POST(req) {
	await updatePost(await req.json());
	await revalidateTag('posts');
	return VeskResponse.json({ ok: true });
}
```

### Component fragment

```ts
import { componentIsr, revalidateComponent } from '@vesk/runtime/server';

const html = await componentIsr('sidebar', renderSidebar, {
	revalidate: 600, tags: ['sidebar'],
});
revalidateComponent('sidebar');   // force next render fresh
```

### On-demand path revalidation

```ts
await revalidatePath('/blog');        // '/blog' and '/blog/*'
await revalidatePath('/blog/hello');
```
