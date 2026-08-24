/**
 * Browser network-state tracking for connectivity-aware boundaries
 * (`offline.vsk` / `network.vsk`) and the router's fallback UI.
 *
 * Degrades gracefully where the Network Information API is missing
 * (Safari/Firefox): those fields become null and consumers fall back to
 * the `online` flag alone.
 */

export type EffectiveType = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';

export interface NetworkState {
	online: boolean;
	effectiveType: EffectiveType;
	/** Estimated downlink in Mbps, or null when unsupported. */
	downlink: number | null;
	/** Estimated round-trip time in ms, or null when unsupported. */
	rtt: number | null;
	saveData: boolean;
}

type NetworkListener = (state: NetworkState) => void;

const listeners = new Set<NetworkListener>();
let installed = false;

function readConnection(): Record<string, unknown> | null {
	if (typeof navigator === 'undefined' || !navigator) return null;
	const navAny = navigator as unknown as Record<string, unknown>;
	return (navAny.connection || navAny.mozConnection || navAny.webkitConnection) as Record<string, unknown> | null;
}

export function getNetworkState(): NetworkState {
	const conn = readConnection();
	let online = true;
	if (typeof navigator !== 'undefined' && navigator && typeof navigator.onLine === 'boolean') {
		online = navigator.onLine;
	}
	const rawType = typeof conn?.effectiveType === 'string' ? (conn.effectiveType as string) : '';
	const effectiveType: EffectiveType =
		rawType === 'slow-2g' || rawType === '2g' || rawType === '3g' || rawType === '4g'
			? (rawType as EffectiveType)
			: 'unknown';
	return {
		online,
		effectiveType,
		downlink: typeof conn?.downlink === 'number' ? (conn.downlink as number) : null,
		rtt: typeof conn?.rtt === 'number' ? (conn.rtt as number) : null,
		saveData: conn?.saveData === true,
	};
}

function notify(): void {
	const state = getNetworkState();
	for (const fn of [...listeners]) {
		try { fn(state); } catch { /* listener errors must not break the router */ }
	}
}

function install(): void {
	if (installed || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
	installed = true;
	window.addEventListener('online', notify);
	window.addEventListener('offline', notify);
	const conn = readConnection() as { addEventListener?: (t: string, f: () => void) => void } | null;
	conn?.addEventListener?.('change', notify);
}

/**
 * Subscribes to connectivity changes (online/offline flips plus
 * Network Information API changes where supported). Returns an
 * unsubscribe function. No-op-safe on the server.
 */
export function watchNetwork(cb: NetworkListener): () => void {
	install();
	listeners.add(cb);
	return () => { listeners.delete(cb); };
}
