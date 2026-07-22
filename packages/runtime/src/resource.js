import { track } from './track.js';

export function createResource(fn) {
  const state = track({ loading: true, error: null, data: undefined });

  fn().then(
    data => state.set({ loading: false, error: null, data }),
    error => state.set({ loading: false, error, data: undefined })
  );

  function resource() {
    return state.get().data;
  }
  Object.defineProperty(resource, 'loading', {
    get() { return state.get().loading; }
  });
  Object.defineProperty(resource, 'error', {
    get() { return state.get().error; }
  });

  return resource;
}
