/**
 * Vesk ISR (Incremental Static Regeneration) — cache for API responses.
 *
 *   import { isr, revalidatePath, revalidateTag } from '@vesk/runtime';
 *
 *   // Cache an API response with a tag + revalidate period
 *   const cached = await isr('/api/data', () => fetchData(), { tags: ['data'], revalidate: 60 });
 *
 *   // On-demand revalidation
 *   await revalidatePath('/api/data');
 *   await revalidateTag('data');
 */

/** @type {Map<string, { data: any, expiresAt: number, tags: string[] }>} */
const cache = new Map();

/** @type {Map<string, Set<string>>} */
const tagIndex = new Map();

/**
 * Get or set a cached value with ISR semantics.
 *
 * @param {string} key - cache key (typically the URL path)
 * @param {() => Promise<any>} fetcher - function to fetch fresh data
 * @param {object} [opts]
 * @param {string[]} [opts.tags] - cache tags for group invalidation
 * @param {number} [opts.revalidate] - TTL in seconds (default 0 = no cache)
 * @returns {Promise<{ data: any, stale: boolean }>}
 */
export async function isr(key, fetcher, opts = {}) {
	const { tags = [], revalidate = 0 } = opts;

	if (revalidate <= 0) {
		// No caching — fetch fresh every time
		return { data: await fetcher(), stale: false };
	}

	const now = Date.now();
	const entry = cache.get(key);

	if (entry && entry.expiresAt > now) {
		return { data: entry.data, stale: false };
	}

	// Stale or missing — fetch fresh data in background
	if (entry && entry.expiresAt <= now) {
		// Serve stale while revalidating (stale-while-revalidate)
		revalidateEntry(key, fetcher, tags, revalidate);
		return { data: entry.data, stale: true };
	}

	// No cache — fetch fresh synchronously
	const data = await fetcher();
	setCacheEntry(key, data, tags, revalidate);
	return { data, stale: false };
}

function setCacheEntry(key, data, tags, revalidate) {
	const entry = { data, expiresAt: Date.now() + revalidate * 1000, tags };
	cache.set(key, entry);
	for (const tag of tags) {
		if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
		tagIndex.get(tag).add(key);
	}
}

async function revalidateEntry(key, fetcher, tags, revalidate) {
	try {
		const data = await fetcher();
		setCacheEntry(key, data, tags, revalidate);
	} catch {
		// Revalidation failed — stale entry remains
	}
}

/**
 * Revalidate all cache entries matching a specific path.
 * @param {string} path
 */
export async function revalidatePath(path) {
	const normalized = path.replace(/\/+$/, '') || '/';
	// Direct match
	if (cache.has(normalized)) {
		cache.delete(normalized);
	}
	// Prefix match (for catch-all routes)
	for (const key of cache.keys()) {
		if (key.startsWith(normalized)) {
			cache.delete(key);
		}
	}
}

/**
 * Revalidate all cache entries tagged with a specific tag.
 * @param {string} tag
 */
export async function revalidateTag(tag) {
	const keys = tagIndex.get(tag);
	if (!keys) return;
	for (const key of keys) {
		cache.delete(key);
	}
	tagIndex.delete(tag);
}

/**
 * Clear the entire ISR cache (for testing or manual purge).
 */
export function clearIsrCache() {
	cache.clear();
	tagIndex.clear();
}
