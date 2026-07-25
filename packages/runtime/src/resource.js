import { tracked, get, set } from './ripple-runtime.js';

export function createResource(fn) {
  const state = tracked({ loading: true, error: null, data: undefined });

  fn().then(
    data => set(state, { loading: false, error: null, data }),
    error => set(state, { loading: false, error, data: undefined })
  );

  function resource() {
    return get(state).data;
  }
  Object.defineProperty(resource, 'loading', {
    get() { return get(state).loading; }
  });
  Object.defineProperty(resource, 'error', {
    get() { return get(state).error; }
  });

  return resource;
}
