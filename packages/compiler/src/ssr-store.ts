import { AsyncLocalStorage } from 'node:async_hooks';
import { setSsrSink, type SsrDataSink } from '@vesk/runtime/src/index-server';

const storage = new AsyncLocalStorage<Record<string, unknown>>();

export function withSsrStore<T>(fn: () => T): T {
  const existing = storage.getStore();
  if (existing) return fn();
  return storage.run({}, fn);
}

export const ssrSink: SsrDataSink = {
  set: (key, value) => {
    const store = storage.getStore();
    if (store) store[key] = value;
  },
  get: (key) => {
    const store = storage.getStore();
    return store ? store[key] : undefined;
  },
  snapshot: () => ({ ...(storage.getStore() ?? {}) }),
  clear: () => {
    const store = storage.getStore();
    if (store) {
      for (const key of Object.keys(store)) delete store[key];
    }
  },
};

setSsrSink(ssrSink);
