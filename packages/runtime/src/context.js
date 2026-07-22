const ctx = { current: null };

export function getActiveComponent() {
  return ctx.current ?? globalThis.__vesk_ctx ?? null;
}

export function setActiveComponent(value) {
  ctx.current = value;
}

export class Context {
  constructor(value) {
    this._v = value;
  }
  get() {
    let current = getActiveComponent();
    while (current) {
      if (current.c?.has(this)) return current.c.get(this);
      current = current.p;
    }
    return this._v;
  }
  set(value) {
    const component = getActiveComponent();
    if (component === null) throw new Error('No active component found, cannot set context');
    let map = component.c;
    if (map === null) map = component.c = new Map();
    map.set(this, value);
  }
}

export function createContext(value) {
  return new Context(value);
}
