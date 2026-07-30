import { tracked, get, set } from './ripple-runtime';
import type { Tracked } from './ripple-runtime';

interface ResourceState<T> {
	loading: boolean;
	error: unknown;
	data: T | undefined;
}

interface ResourceAccessor<T> {
	(): T | undefined;
	loading: boolean;
	error: unknown;
	_state?: Tracked;
	refresh?: () => void;
}

function getSsrData(key: string): unknown {
	const store = (globalThis as Record<string, unknown>).__vesk_ssr_data as Record<string, unknown> | undefined;
	if (!store) return undefined;
	return store[key];
}

export function setSsrData(key: string, value: unknown): void {
	if (!(globalThis as Record<string, unknown>).__vesk_ssr_data) (globalThis as Record<string, unknown>).__vesk_ssr_data = {};
	((globalThis as Record<string, unknown>).__vesk_ssr_data as Record<string, unknown>)[key] = value;
}

export function clearSsrData(): void {
	delete (globalThis as Record<string, unknown>).__vesk_ssr_data;
}

export function useFetch<T = unknown>(
	urlOrFn: string | (() => Promise<T>),
	options: { parse?: (r: Response) => Promise<T>; key?: string } = {},
): ResourceAccessor<T> {
	const fetcher = typeof urlOrFn === 'function'
		? urlOrFn
		: () => {
			const url = typeof urlOrFn === 'string' ? urlOrFn : String(urlOrFn);
			return fetch(url).then(r => {
				if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
				return options.parse ? options.parse(r) : r.json() as Promise<T>;
			});
		};

	const resource = createResource<T>(fetcher, options.key || (typeof urlOrFn === 'string' ? urlOrFn : undefined));
	resource.refresh = () => {
		fetcher().then(
			data => { const s = resource._state; if (s) set(s as Tracked, { loading: false, error: null, data }); },
			error => { const s = resource._state; if (s) set(s as Tracked, { loading: false, error, data: undefined }); }
		);
	};
	return resource;
}

useFetch.text = (url: string, options?: { key?: string }) => useFetch(url, { ...options, parse: r => r.text() });
useFetch.json = (url: string, options?: { key?: string }) => useFetch(url, { ...options, parse: r => r.json() });
useFetch.arrayBuffer = (url: string, options?: { key?: string }) => useFetch(url, { ...options, parse: r => r.arrayBuffer() });

export function createResource<T>(
	fn: () => Promise<T>,
	key?: string,
): ResourceAccessor<T> {
	const state = tracked({ loading: true, error: null, data: undefined });
	const resourceKey = key || ((fn as unknown as Record<string, string>)._ssrKey || fn.toString().slice(0, 64));

	const ssrData = getSsrData(resourceKey) as T | undefined;
	if (ssrData !== undefined) {
		set(state, { loading: false, error: null, data: ssrData });
		return createResourceAccessor(state);
	}

	if ((globalThis as Record<string, unknown>).__vsk_ssr) {
		if (!(globalThis as Record<string, unknown>).__vsk_ssr_promises) (globalThis as Record<string, unknown>).__vsk_ssr_promises = [];
		const prom = fn().then(
			data => {
				if (!(globalThis as Record<string, unknown>).__vsk_ssr_data) (globalThis as Record<string, unknown>).__vsk_ssr_data = {};
				((globalThis as Record<string, unknown>).__vsk_ssr_data as Record<string, unknown>)[resourceKey] = data;
				set(state, { loading: false, error: null, data });
				return data;
			},
			error => {
				set(state, { loading: false, error, data: undefined });
				throw error;
			}
		);
		((globalThis as Record<string, unknown>).__vsk_ssr_promises as Promise<unknown>[]).push(prom);
	} else {
		fn().then(
			data => set(state, { loading: false, error: null, data }),
			error => set(state, { loading: false, error, data: undefined })
		);
	}

	return createResourceAccessor(state);
}

function createResourceAccessor<T>(state: object): ResourceAccessor<T> {
	function resource(): T | undefined {
		return (get(state) as ResourceState<T>).data;
	}
	Object.defineProperty(resource, 'loading', {
		get() { return (get(state) as ResourceState<T>).loading; }
	});
	Object.defineProperty(resource, 'error', {
		get() { return (get(state) as ResourceState<T>).error; }
	});
	(resource as unknown as Record<string, unknown>)._state = state;
	return resource as unknown as ResourceAccessor<T>;
}

export async function resolveSsrResources(): Promise<Record<string, unknown>> {
	const promises = ((globalThis as Record<string, unknown>).__vsk_ssr_promises || []) as Promise<unknown>[];
	if (promises.length === 0) return {};
	await Promise.allSettled(promises);
	const data = ((globalThis as Record<string, unknown>).__vsk_ssr_data || {}) as Record<string, unknown>;
	delete (globalThis as Record<string, unknown>).__vsk_ssr_promises;
	return data;
}
