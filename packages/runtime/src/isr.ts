interface CacheEntry {
	data: unknown;
	expiresAt: number;
	tags: string[];
}

interface IsrResult {
	data: unknown;
	stale: boolean;
}

interface IsrOptions {
	tags?: string[];
	revalidate?: number;
}

interface PageCacheEntry {
	html: string;
	headers: Record<string, string>;
	expiresAt: number;
	tags: string[];
}

interface PageIsrResult {
	html: string;
	headers: Record<string, string>;
	stale: boolean;
}

interface PageRenderResult {
	html: string;
	headers?: Record<string, string>;
}

const cache = new Map<string, CacheEntry>();
const tagIndex = new Map<string, Set<string>>();

export async function isr(
	key: string,
	fetcher: () => Promise<unknown>,
	opts: IsrOptions = {},
): Promise<IsrResult> {
	const { tags = [], revalidate = 0 } = opts;

	if (revalidate <= 0) {
		return { data: await fetcher(), stale: false };
	}

	const now = Date.now();
	const entry = cache.get(key);

	if (entry && entry.expiresAt > now) {
		return { data: entry.data, stale: false };
	}

	if (entry && entry.expiresAt <= now) {
		revalidateEntry(key, fetcher, tags, revalidate);
		return { data: entry.data, stale: true };
	}

	const data = await fetcher();
	setCacheEntry(key, data, tags, revalidate);
	return { data, stale: false };
}

function setCacheEntry(key: string, data: unknown, tags: string[], revalidate: number): void {
	const entry: CacheEntry = { data, expiresAt: Date.now() + revalidate * 1000, tags };
	cache.set(key, entry);
	for (const tag of tags) {
		if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
		tagIndex.get(tag)!.add(key);
	}
}

async function revalidateEntry(key: string, fetcher: () => Promise<unknown>, tags: string[], revalidate: number): Promise<void> {
	try {
		const data = await fetcher();
		setCacheEntry(key, data, tags, revalidate);
	} catch {
		// Revalidation failed — stale entry remains
	}
}

export async function revalidatePath(path: string): Promise<void> {
	const normalized = path.replace(/\/+$/, '') || '/';
	if (cache.has(normalized)) {
		cache.delete(normalized);
	}
	for (const key of cache.keys()) {
		if (key.startsWith(normalized)) {
			cache.delete(key);
		}
	}
}

export async function revalidateTag(tag: string): Promise<void> {
	const keys = tagIndex.get(tag);
	if (!keys) return;
	for (const key of keys) {
		cache.delete(key);
	}
	tagIndex.delete(tag);
}

export function clearIsrCache(): void {
	cache.clear();
	tagIndex.clear();
	pageCache.clear();
	componentCache.clear();
}

export function revalidateComponent(key: string): void {
	componentCache.delete(key);
}

const pageCache = new Map<string, PageCacheEntry>();

export async function pageIsr(
	path: string,
	renderFn: () => Promise<PageRenderResult>,
	opts: IsrOptions = {},
): Promise<PageIsrResult> {
	const { tags = [], revalidate = 0 } = opts;
	const key = path.replace(/\/+$/, '') || '/';

	if (revalidate <= 0) {
		const result = await renderFn();
		return { html: result.html, headers: result.headers || {}, stale: false };
	}

	const now = Date.now();
	const entry = pageCache.get(key);

	if (entry && entry.expiresAt > now) {
		return { html: entry.html, headers: entry.headers, stale: false };
	}

	if (entry && entry.expiresAt <= now) {
		revalidatePage(key, renderFn, tags, revalidate);
		return { html: entry.html, headers: entry.headers, stale: true };
	}

	const result = await renderFn();
	setPageCache(key, result.html, result.headers || {}, tags, revalidate);
	return { html: result.html, headers: result.headers || {}, stale: false };
}

function setPageCache(key: string, html: string, headers: Record<string, string>, tags: string[], revalidate: number): void {
	pageCache.set(key, { html, headers, expiresAt: Date.now() + revalidate * 1000, tags });
	for (const tag of tags) {
		if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
		tagIndex.get(tag)!.add(key);
	}
}

async function revalidatePage(key: string, renderFn: () => Promise<PageRenderResult>, tags: string[], revalidate: number): Promise<void> {
	try {
		const result = await renderFn();
		setPageCache(key, result.html, result.headers || {}, tags, revalidate);
	} catch {
		// Revalidation failed — stale entry remains
	}
}

interface ComponentCacheEntry {
	html: string;
	expiresAt: number;
	tags: string[];
}

const componentCache = new Map<string, ComponentCacheEntry>();

export async function componentIsr(
	key: string,
	renderFn: () => string | Promise<string>,
	opts: IsrOptions = {},
): Promise<string> {
	const { tags = [], revalidate = 0 } = opts;

	if (revalidate <= 0) {
		return await renderFn();
	}

	const now = Date.now();
	const entry = componentCache.get(key);

	if (entry && entry.expiresAt > now) {
		return entry.html;
	}

	if (entry && entry.expiresAt <= now) {
		revalidateComponentEntry(key, renderFn, tags, revalidate);
		return entry.html;
	}

	const html = await renderFn();
	componentCache.set(key, { html, expiresAt: now + revalidate * 1000, tags });
	for (const tag of tags) {
		if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
		tagIndex.get(tag)!.add(`comp:${key}`);
	}
	return html;
}

function revalidateComponentEntry(key: string, renderFn: () => string | Promise<string>, tags: string[], revalidate: number): void {
	Promise.resolve(renderFn()).then(html => {
		componentCache.set(key, { html, expiresAt: Date.now() + revalidate * 1000, tags });
	}).catch(() => {});
}

export function isrConfigToRevalidate(config: unknown): number {
	if (!config) return 0;
	if (typeof config === 'number') return config;
	if ((config as { revalidate?: number }).revalidate) return (config as { revalidate: number }).revalidate;
	return 0;
}
