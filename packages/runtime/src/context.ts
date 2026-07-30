interface ComponentCtx {
	current: Component | null;
}

interface Component {
	p: Component | null;
	c: Map<Context<unknown>, unknown> | null;
}

const ctx: ComponentCtx = { current: null };

export function getActiveComponent(): Component | null {
	return ctx.current ?? (globalThis as Record<string, unknown>).__vesk_ctx as Component | null ?? null;
}

export function setActiveComponent(value: Component | null): void {
	ctx.current = value;
}

export class Context<T> {
	_v: T;
	constructor(value: T) {
		this._v = value;
	}
	get(): T {
		let current = getActiveComponent();
		while (current) {
			if (current.c?.has(this)) return current.c.get(this) as T;
			current = current.p;
		}
		return this._v;
	}
	set(value: T): void {
		const component = getActiveComponent();
		if (component === null) throw new Error('No active component found, cannot set context');
		let map = component.c;
		if (map === null) map = component.c = new Map();
		map.set(this, value);
	}
}

export function createContext<T>(value: T): Context<T> {
	return new Context(value);
}
