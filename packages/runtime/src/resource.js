import { tracked, get, set } from './ripple-runtime.js';

/**
 * Pre-fetched SSR data store.
 * Populated server-side via useFetch / createResource.
 * On client hydration, resources read from here first to avoid re-fetching.
 */
function getSsrData(key) {
	const store = globalThis.__vesk_ssr_data;
	if (!store) return undefined;
	return store[key];
}

export function setSsrData(key, value) {
	if (!globalThis.__vesk_ssr_data) globalThis.__vesk_ssr_data = {};
	globalThis.__vesk_ssr_data[key] = value;
}

export function clearSsrData() {
	delete globalThis.__vesk_ssr_data;
}

/**
 * useFetch — auto-imported reactive data fetcher.
 *
 * No import needed in .vsk files — the compiler injects it automatically.
 *
 * Usage:
 *   const posts = useFetch('/api/posts');
 *   const post  = useFetch(() => fetch(`/api/posts/${id}`).then(r => r.json()));
 *   const data  = useFetch('/api/data', { parse: (r) => r.text() });
 *
 * Returns a reactive object:
 *   .data     — resolved data (reactive, safe to use in template)
 *   .loading  — boolean, true while fetching
 *   .error    — error object if fetch failed
 *   .refresh() — re-fetch the same URL/fn
 *
 * SSR: fetches during render, data serialized into HTML automatically.
 * Hydration: reads pre-serialized data, no re-fetch on mount.
 */
export function useFetch(urlOrFn, options = {}) {
	const fetcher = typeof urlOrFn === 'function'
		? urlOrFn
		: () => {
			const url = typeof urlOrFn === 'string' ? urlOrFn : String(urlOrFn);
			return fetch(url).then(r => {
				if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
				return options.parse ? options.parse(r) : r.json();
			});
		};

	const resource = createResource(fetcher, options.key || (typeof urlOrFn === 'string' ? urlOrFn : undefined));
	resource.refresh = () => {
		fetcher().then(
			data => { const s = resource._state; if (s) set(s, { loading: false, error: null, data }); },
			error => { const s = resource._state; if (s) set(s, { loading: false, error, data: undefined }); }
		);
	};
	return resource;
}

/** @param {string} url */
useFetch.text = (url, options) => useFetch(url, { ...options, parse: r => r.text() });
/** @param {string} url */
useFetch.json = (url, options) => useFetch(url, { ...options, parse: r => r.json() });
/** @param {string} url */
useFetch.arrayBuffer = (url, options) => useFetch(url, { ...options, parse: r => r.arrayBuffer() });

/**
 * Create a reactive async resource (data fetcher).
 *
 * Usage:
 *   const data = createResource(() => fetch('/api/items').then(r => r.json()));
 *   {#if data.loading}
 *     <p>Loading...</p>
 *   {:else}
 *     {data().map(item => <li>{item.name}</li>)}
 *   {/if}
 *
 * During SSR, if the fetcher key matches pre-fetched data from the server,
 * the resource resolves immediately. Otherwise it fires the async function.
 *
 * @param {Function} fn - async function that returns the data
 * @param {string} [key] - optional key for SSR data hydration
 * @returns {Function & { loading: boolean, error: any }}
 */
export function createResource(fn, key) {
  const state = tracked({ loading: true, error: null, data: undefined });
  const resourceKey = key || (fn._ssrKey || fn.toString().slice(0, 64));

  // Check for pre-fetched SSR data (hydration path)
  const ssrData = getSsrData(resourceKey);
  if (ssrData !== undefined) {
    set(state, { loading: false, error: null, data: ssrData });
    return createResourceAccessor(state);
  }

  // Track in SSR mode for server-side collection
  if (globalThis.__vsk_ssr) {
    if (!globalThis.__vsk_ssr_promises) globalThis.__vsk_ssr_promises = [];
    const prom = fn().then(
      data => {
        // Store resolved data for serialization
        if (!globalThis.__vsk_ssr_data) globalThis.__vsk_ssr_data = {};
        globalThis.__vsk_ssr_data[resourceKey] = data;
        set(state, { loading: false, error: null, data });
        return data;
      },
      error => {
        set(state, { loading: false, error, data: undefined });
        throw error;
      }
    );
    globalThis.__vsk_ssr_promises.push(prom);
  } else {
    // Normal client-side behavior: fire immediately
    fn().then(
      data => set(state, { loading: false, error: null, data }),
      error => set(state, { loading: false, error, data: undefined })
    );
  }

  return createResourceAccessor(state);
}

function createResourceAccessor(state) {
  function resource() {
    return get(state).data;
  }
  Object.defineProperty(resource, 'loading', {
    get() { return get(state).loading; }
  });
  Object.defineProperty(resource, 'error', {
    get() { return get(state).error; }
  });
  resource._state = state;
  return resource;
}

/**
 * SSR data resolver — awaits all pending resource promises and returns
 * the collected data map. Used by the SSR pipeline after component render
 * to collect and serialize fetched data into the HTML.
 *
 * @returns {Promise<Record<string, any>>}
 */
export async function resolveSsrResources() {
  const promises = globalThis.__vsk_ssr_promises || [];
  if (promises.length === 0) return {};
  // Wait for all to settle
  await Promise.allSettled(promises);
  const data = globalThis.__vsk_ssr_data || {};
  delete globalThis.__vsk_ssr_promises;
  return data;
}
