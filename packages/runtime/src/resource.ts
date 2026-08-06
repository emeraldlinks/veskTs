import { tracked, get, set, scope, on_destroy } from '@vesk/runtime/src/ripple-runtime';
import { is_destroyed } from '@vesk/runtime/src/ripple-blocks';
import type { Tracked } from '@vesk/runtime/src/ripple-runtime';

interface ResourceState<T> {
	loading: boolean;
	error: unknown;
	data: T | undefined;
}

export interface Resource<T> extends PromiseLike<T> {
	loading: boolean;
	error: unknown;
	data: T | undefined;
	_state?: Tracked;
	refresh: () => void;
	abort: () => void;
}

export interface UseFetchOptions<T> extends Omit<RequestInit, 'body'> {
	key?: string;
	into?: Tracked;
	body?: unknown;
	staleTime?: number;
	keepPreviousData?: boolean;
	retry?: number;
	retryDelay?: number;
	timeout?: number;
	enabled?: boolean;
	dedupe?: boolean;
}

export class HttpError extends Error {
	status: number;
	constructor(status: number, statusText: string) {
		super(`HTTP ${status}: ${statusText}`);
		this.status = status;
		this.name = 'HttpError';
	}
}

export class TimeoutError extends Error {
	constructor(timeout: number) {
		super(`Request timed out after ${timeout}ms`);
		this.name = 'TimeoutError';
	}
}

const g = (): Record<string, unknown> => globalThis as Record<string, unknown>;
const isServer = (): boolean => !!g().__vsk_ssr;

interface CacheEntry {
	data: unknown;
	fetchedAt: number;
}

interface ResourceHandle<T> {
	key: string;
	state: Tracked;
	into: Tracked | undefined;
	fetcher: (signal?: AbortSignal) => Promise<T>;
	options: UseFetchOptions<T>;
	block: ReturnType<typeof scope>;
	controller: AbortController | null;
	settled: Promise<void>;
	settleNotify: () => void;
}

function getClientCache(): Map<string, CacheEntry> {
	const value = g().__vsk_fetch_cache as Map<string, CacheEntry> | undefined;
	if (value) return value;
	const map = new Map<string, CacheEntry>();
	g().__vsk_fetch_cache = map;
	return map;
}

function getInflight(): Map<string, Promise<unknown>> {
	const value = g().__vsk_fetch_inflight as Map<string, Promise<unknown>> | undefined;
	if (value) return value;
	const map = new Map<string, Promise<unknown>>();
	g().__vsk_fetch_inflight = map;
	return map;
}

function getRegistry(): Map<string, Set<ResourceHandle<unknown>>> {
	const value = g().__vsk_fetch_registry as Map<string, Set<ResourceHandle<unknown>>> | undefined;
	if (value) return value;
	const map = new Map<string, Set<ResourceHandle<unknown>>>();
	g().__vsk_fetch_registry = map;
	return map;
}

function getSsrData(key: string): unknown {
	const store = g().__vsk_ssr_data as Record<string, unknown> | undefined;
	if (!store) return undefined;
	return store[key];
}

export function setSsrData(key: string, value: unknown): void {
	if (!g().__vsk_ssr_data) g().__vsk_ssr_data = {};
	(g().__vsk_ssr_data as Record<string, unknown>)[key] = value;
}

export function clearSsrData(): void {
	delete g().__vsk_ssr_data;
}

function setInto(into: Tracked, data: unknown): void {
	if (into && typeof into === 'object' && typeof (into as unknown as { f: unknown }).f === 'number') {
		set(into, data);
	}
}

function isAbortError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError') {
		return true;
	}
	return error instanceof Error && error.name === 'AbortError';
}

function makeAbortError(): Error {
	if (typeof DOMException !== 'undefined') return new DOMException('aborted', 'AbortError');
	const error = new Error('aborted');
	error.name = 'AbortError';
	return error;
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!headers) return out;
	if (typeof Headers !== 'undefined' && headers instanceof Headers) {
		headers.forEach((value, key) => (out[key] = value));
	} else if (Array.isArray(headers)) {
		for (const [key, value] of headers) out[key] = value;
	} else {
		Object.assign(out, headers);
	}
	return out;
}

function prepareBody(body: unknown, headers: Record<string, string>): { body?: BodyInit; headers: Record<string, string> } {
	if (body === undefined || body === null) return { headers };
	if (
		typeof body === 'string' ||
		typeof body === 'boolean' ||
		typeof body === 'number' ||
		(typeof FormData !== 'undefined' && body instanceof FormData) ||
		(typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
		(typeof Blob !== 'undefined' && body instanceof Blob) ||
		(typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body)))
	) {
		return { body: body as BodyInit, headers };
	}
	if (!headers['content-type'] && !headers['Content-Type']) {
		headers['Content-Type'] = 'application/json';
	}
	return { body: JSON.stringify(body), headers };
}

function buildRequestInit<T>(options: UseFetchOptions<T>): RequestInit {
	const {
		method, credentials, cache, mode, redirect, referrer, referrerPolicy, integrity, keepalive,
	} = options;
	const init: RequestInit = { method, credentials, cache, mode, redirect, referrer, referrerPolicy, integrity, keepalive };
	const prepared = prepareBody(options.body, normalizeHeaders(options.headers));
	init.headers = prepared.headers;
	if (prepared.body !== undefined) init.body = prepared.body;
	return init;
}

function resolveFetchUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return url;
  const reqUrl = (g().__vesk_request as Record<string, unknown> | undefined)?.url;
  const base = typeof reqUrl === 'string' && /^https?:\/\//i.test(reqUrl)
    ? reqUrl
    : (g().__vesk_ssr_base_url as string) || '';
  if (base) return new URL(url, base).href;
  return url;
}

function createFetcher<T>(url: string, options: UseFetchOptions<T>): (signal?: AbortSignal) => Promise<T> {
	const init = buildRequestInit(options);
	return async (signal?: AbortSignal) => {
		const res = await fetch(resolveFetchUrl(url), signal ? { ...init, signal } : init);
		if (!res.ok) throw new HttpError(res.status, res.statusText);
		return res.json() as Promise<T>;
	};
}

function linkSignal(userSignal: AbortSignal | null | undefined, controller: AbortController): void {
	if (!userSignal) return;
	if (userSignal.aborted) controller.abort();
	else userSignal.addEventListener('abort', () => controller.abort(), { once: true });
}

async function runFetcher<T>(handle: ResourceHandle<T>, timeout: number): Promise<T> {
	const { retry = 0, retryDelay = 1000, method, signal } = handle.options;
	const maxAttempts = retry + 1;
	const canRetry = !method || method.toUpperCase() === 'GET';
	let attempt = 0;
	let lastError: unknown;

	while (true) {
		if (handle.block !== null && is_destroyed(handle.block)) throw makeAbortError();

		const controller = new AbortController();
		handle.controller = controller;
		linkSignal(signal, controller);

		let timer: ReturnType<typeof setTimeout> | null = null;
		const timeoutPromise = new Promise<T>((_, reject) => {
			if (timeout <= 0) return;
			timer = setTimeout(() => {
				controller.abort();
				reject(new TimeoutError(timeout));
			}, timeout);
		});

		try {
			const result = await Promise.race<T>([handle.fetcher(controller.signal), timeoutPromise]);
			return result;
		} catch (error) {
			if (isAbortError(error)) throw error;
			lastError = error;
			const retriable =
				canRetry &&
				attempt < maxAttempts - 1 &&
				!(error instanceof HttpError && error.status >= 400 && error.status < 500);
			if (!retriable) throw error;
			if (retryDelay > 0) await sleep(retryDelay * Math.pow(2, attempt));
			attempt++;
		} finally {
			if (timer !== null) clearTimeout(timer);
			if (handle.controller === controller) handle.controller = null;
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function settle<T>(handle: ResourceHandle<T>, data: T): void {
	if (handle.block !== null && is_destroyed(handle.block)) return;
	if (handle.into) setInto(handle.into, data);
	const current = get(handle.state) as ResourceState<unknown>;
	if (!(current.data === data && !current.loading && current.error === null)) {
		set(handle.state, { loading: false, error: null, data });
	}
	handle.settleNotify();
}

function settleError<T>(handle: ResourceHandle<T>, error: unknown): void {
	if (handle.block !== null && is_destroyed(handle.block)) return;
	if (isAbortError(error)) {
		if (handle.controller !== null) return;
		const current = get(handle.state) as ResourceState<unknown>;
		if (current.loading) set(handle.state, { loading: false, error: null, data: current.data });
		handle.settleNotify();
		return;
	}
	const current = get(handle.state) as ResourceState<unknown>;
	set(handle.state, { loading: false, error, data: current.data });
	handle.settleNotify();
}

function markRefetching<T>(handle: ResourceHandle<T>): void {
	const current = get(handle.state) as ResourceState<unknown>;
	if (current.loading) return;
	set(handle.state, {
		loading: true,
		error: null,
		data: handle.options.keepPreviousData ? current.data : undefined,
	});
}

function attachSettle<T>(handle: ResourceHandle<T>, promise: Promise<unknown>): void {
	promise.then(
		data => settle(handle, data as T),
		error => settleError(handle, error),
	);
}

function writeCache(key: string, data: unknown): void {
	if (isServer()) return;
	const entry = getClientCache().get(key);
	if (!entry || entry.data !== data) getClientCache().set(key, { data, fetchedAt: Date.now() });
}

function trackSsrPromise(promise: Promise<unknown>): void {
	const tk = (g().__vsk_ssr_token as string) || '';
	const promisesKey = tk ? `__vsk_ssr_promises_${tk}` : '__vsk_ssr_promises';
	if (!g()[promisesKey]) g()[promisesKey] = [];
	(g()[promisesKey] as Promise<unknown>[]).push(promise);
}

function registerDestroyAbort(handle: ResourceHandle<unknown>): void {
	if (isServer() || handle.block === null) return;
	on_destroy(() => {
		if (is_destroyed(handle.block as never)) {
			handle.controller?.abort();
			const registry = getRegistry().get(handle.key);
			if (registry) registry.delete(handle as ResourceHandle<unknown>);
		}
	});
}

function startRequest<T>(handle: ResourceHandle<T>, skipCache: boolean): Promise<T> {
	const key = handle.key;
	const options = handle.options;

	if (isServer()) {
		const existing = getInflight().get(key);
		const prom = existing ?? runFetcher(handle, options.timeout || 0);
		if (!existing) {
			getInflight().set(key, prom);
			prom.then(
				data => {
					setSsrData(key, data);
					settle(handle, data as T);
				},
				error => settleError(handle, error),
			).finally(() => {
				if (getInflight().get(key) === prom) getInflight().delete(key);
			});
		} else {
			attachSettle(handle, prom);
		}
		trackSsrPromise(prom);
		return prom as Promise<T>;
	}

	if (!skipCache && options.staleTime && options.staleTime > 0) {
		const entry = getClientCache().get(key);
		if (entry && Date.now() - entry.fetchedAt < options.staleTime) {
			settle(handle, entry.data as T);
			return Promise.resolve(entry.data as T);
		}
	}

	if (options.dedupe !== false) {
		const existing = getInflight().get(key);
		if (existing) {
			attachSettle(handle, existing);
			return existing as Promise<T>;
		}
	}

	markRefetching(handle);

	const controller = new AbortController();
	handle.controller = controller;
	linkSignal(options.signal, controller);

	const prom = runFetcher(handle, options.timeout || 0);
	prom.then(
		data => {
			writeCache(key, data);
			settle(handle, data as T);
		},
		error => settleError(handle, error),
	).finally(() => {
		if (options.dedupe !== false && getInflight().get(key) === prom) getInflight().delete(key);
	});
	if (options.dedupe !== false) getInflight().set(key, prom);
	registerDestroyAbort(handle);
	return prom as Promise<T>;
}

function revalidate(handle: ResourceHandle<unknown>): void {
	if (!isServer()) {
		const registry = getRegistry().get(handle.key);
		if (registry && registry.size > 0) {
			const prev = getInflight().get(handle.key);
			if (prev) {
				getInflight().delete(handle.key);
				registry.forEach(h => h.controller?.abort());
			}
			registry.forEach(h => startRequest(h as ResourceHandle<unknown>, true));
			return;
		}
	}
	const prev = getInflight().get(handle.key);
	if (prev) getInflight().delete(handle.key);
	handle.controller?.abort();
	startRequest(handle, true);
}

export function mutate(key: string, data?: unknown): void {
	if (isServer()) return;
	const registry = getRegistry().get(key);
	const prev = getInflight().get(key);
	if (data !== undefined) {
		getClientCache().set(key, { data, fetchedAt: Date.now() });
		if (prev) {
			getInflight().delete(key);
			if (registry) registry.forEach(h => h.controller?.abort());
		}
		if (registry) {
			registry.forEach(h => {
				if (h.into) setInto(h.into, data);
				set(h.state, { loading: false, error: null, data });
			});
		}
		return;
	}
	if (registry && registry.size > 0) {
		if (prev) {
			getInflight().delete(key);
			registry.forEach(h => h.controller?.abort());
		}
		registry.forEach(h => startRequest(h as ResourceHandle<unknown>, true));
	}
}

function createResourceAccessor<T>(handle: ResourceHandle<T>): Resource<T> {
	const state = handle.state;
	const accessor: Record<string, unknown> = {};

	Object.defineProperty(accessor, 'loading', {
		get() { return (get(state) as ResourceState<T>).loading; },
	});
	Object.defineProperty(accessor, 'error', {
		get() { return (get(state) as ResourceState<T>).error; },
	});
	Object.defineProperty(accessor, 'data', {
		get() { return (get(state) as ResourceState<T>).data; },
	});
	accessor._state = state;

	const toData = async (): Promise<T> => {
		for (;;) {
			const s = get(state) as ResourceState<T>;
			if (!s.loading) {
				if (s.error) throw s.error;
				return s.data as T;
			}
			await handle.settled;
		}
	};

	accessor.then = (onFulfilled?: ((v: T) => unknown) | null, onRejected?: ((r: unknown) => unknown) | null): Promise<unknown> =>
		toData().then(onFulfilled, onRejected);
	accessor.catch = (onRejected?: ((r: unknown) => unknown) | null): Promise<unknown> =>
		toData().catch(onRejected);
	accessor.finally = (onFinally?: (() => void) | null): Promise<unknown> =>
		toData().finally(onFinally);

	accessor.refresh = () => revalidate(handle);
	accessor.abort = () => {
		if (!isServer()) handle.controller?.abort();
	};

	return accessor as unknown as Resource<T>;
}

export function createResource<T>(
	fn: () => Promise<T>,
	key?: string,
	into?: Tracked,
	options: UseFetchOptions<T> = {},
): Resource<T> {
	const resourceKey = key || options.key || (fn as unknown as Record<string, string>)._ssrKey || fn.toString().slice(0, 64);
	let notify = () => {};
	const handle: ResourceHandle<T> = {
		key: resourceKey,
		state: tracked({ loading: true, error: null, data: undefined }),
		into,
		fetcher: fn,
		options,
		block: scope(),
		controller: null,
		settled: new Promise<void>((res) => { notify = res; }),
		settleNotify: () => {
			notify();
			handle.settled = new Promise<void>((res) => { notify = res; });
		},
	};

	const accessor = createResourceAccessor<T>(handle);
	accessor.refresh = () => revalidate(handle);
	accessor.abort = () => {
		if (!isServer()) handle.controller?.abort();
	};

	if (options.enabled === false) {
		set(handle.state, { loading: false, error: null, data: undefined });
		return accessor;
	}

	if (!isServer()) {
		const registry = getRegistry();
		const set = registry.get(resourceKey) ?? new Set<ResourceHandle<unknown>>();
		set.add(handle as ResourceHandle<unknown>);
		registry.set(resourceKey, set);
		if (handle.block !== null) {
			on_destroy(() => {
				if (is_destroyed(handle.block as never)) {
					handle.controller?.abort();
					const current = getRegistry().get(resourceKey);
					if (current) current.delete(handle as ResourceHandle<unknown>);
				}
			});
		}
	}

	const ssrData = getSsrData(resourceKey);
	if (ssrData !== undefined) {
		settle(handle, ssrData as T);
		writeCache(resourceKey, ssrData);
		return accessor;
	}

	startRequest(handle, false);
	return accessor;
}

export function useFetch<T = unknown>(
	urlOrFn: string | (() => Promise<T>),
	options: UseFetchOptions<T> = {},
): Resource<T> {
	const fetcher = typeof urlOrFn === 'function'
		? urlOrFn
		: createFetcher<T>(urlOrFn, options);
	const key = options.key || (typeof urlOrFn === 'string' ? urlOrFn : undefined);
	const resource = createResource<T>(fetcher, key, options.into, options);
	return resource;
}

useFetch.text = <T = string>(url: string, options?: Omit<UseFetchOptions<T>, 'body'>): Resource<T> =>
	useFetch<T>(() => fetch(resolveFetchUrl(url), buildRequestInit(options ?? {})).then(r => r.text() as Promise<T>), {
		...options,
		key: options?.key ?? url,
	});
useFetch.json = <T = unknown>(url: string, options?: Omit<UseFetchOptions<T>, 'body'>): Resource<T> =>
	useFetch<T>(() => fetch(resolveFetchUrl(url), buildRequestInit(options ?? {})).then(r => r.json() as Promise<T>), {
		...options,
		key: options?.key ?? url,
	});
useFetch.arrayBuffer = <T = ArrayBuffer>(url: string, options?: Omit<UseFetchOptions<T>, 'body'>): Resource<T> =>
	useFetch<T>(() => fetch(resolveFetchUrl(url), buildRequestInit(options ?? {})).then(r => r.arrayBuffer() as Promise<T>), {
		...options,
		key: options?.key ?? url,
	});

export async function resolveSsrResources(): Promise<Record<string, unknown>> {
	const promises = (g().__vsk_ssr_promises || []) as Promise<unknown>[];
	if (promises.length === 0) return {};
	await Promise.allSettled(promises);
	const data = (g().__vsk_ssr_data || {}) as Record<string, unknown>;
	delete g().__vsk_ssr_promises;
	return data;
}
