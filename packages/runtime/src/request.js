/**
 * Vesk request hooks — cookies() and headers(), matching Next.js App Router API.
 *
 * SSR: reads from globalThis.__vesk_request (set by dev server before renderPage)
 * API: reads from globalThis.__vesk_request (set by executeApiRoute)
 * Client: cookies() reads document.cookie, headers() returns empty
 */

function getRequest() {
	return globalThis.__vesk_request || null;
}

/**
 * Get the current request's cookies.
 *
 * Returns a store-like object with:
 *   .get(name)     → value or undefined
 *   .getAll()      → [{ name, value }]
 *   .toString()    → raw Cookie header
 *   [name]         → direct access
 *
 * In SSR/API: reads from the incoming request's Cookie header.
 * On client: reads from document.cookie (synchronous snapshot).
 */
export function cookies() {
	const req = getRequest();
	let jar = {};

	if (req && req.cookies) {
		jar = { ...req.cookies };
	} else if (typeof document !== 'undefined') {
		for (const pair of document.cookie.split(';')) {
			const eq = pair.indexOf('=');
			if (eq === -1) continue;
			const k = pair.slice(0, eq).trim();
			const v = pair.slice(eq + 1).trim();
			if (k) jar[k] = decodeURIComponent(v);
		}
	}

	return new Proxy(jar, {
		get(target, prop) {
			if (prop === 'get') return (name) => target[name] || undefined;
			if (prop === 'getAll') return () => Object.entries(target).map(([name, value]) => ({ name, value }));
			if (prop === 'toString') return () => Object.entries(target).map(([k, v]) => `${k}=${v}`).join('; ');
			if (prop in target) return target[prop];
			return undefined;
		},
	});
}

/**
 * Get the current request's headers.
 *
 * Returns a store-like object with:
 *   .get(name)     → value or null (case-insensitive)
 *   .has(name)     → boolean
 *   .entries()     → [name, value][] iterator
 *   [name]         → direct access (lowercase)
 *
 * In SSR/API: reads from the incoming request's headers.
 * On client: returns empty store (no server headers in browser).
 */
/**
 * Get the current request's locals — mutable context shared between middleware
 * and page/API handlers. Set by middleware, read by pages/APIs.
 *
 * SSR/API: reads from globalThis.__vesk_request.locals
 * Client: returns empty object
 */
export function locals() {
	const req = getRequest();
	if (req && req.locals) return req.locals;
	return {};
}

export function headers() {
	const req = getRequest();
	let map = new Map();

	if (req && req.headers) {
		for (const [k, v] of Object.entries(req.headers)) {
			map.set(k.toLowerCase(), Array.isArray(v) ? v.join(', ') : String(v));
		}
	}

	return new Proxy({}, {
		get(_target, prop) {
			if (prop === 'get') return (name) => map.get(name.toLowerCase()) || null;
			if (prop === 'has') return (name) => map.has(name.toLowerCase());
			if (prop === 'entries') return () => map.entries();
			if (typeof prop === 'string') return map.get(prop.toLowerCase()) ?? undefined;
			return undefined;
		},
		ownKeys() {
			return [...map.keys()];
		},
		getOwnPropertyDescriptor() {
			return { enumerable: true, configurable: true };
		},
	});
}
