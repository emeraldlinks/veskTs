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
	/** Identity of this context instance — a Map key in the provider chain. */
	readonly id: symbol;
	constructor(value: T) {
		this._v = value;
		this.id = Symbol('vesk-context');
	}
	/**
	 * Reads the nearest value set by an ancestor component, else the default.
	 * Typed as `T`, so a context created with a type carries that type all the
	 * way to every reader.
	 */
	get(): T {
		let current = getActiveComponent();
		while (current) {
			if (current.c?.has(this)) return current.c.get(this) as T;
			current = current.p;
		}
		return this._v;
	}
	/** Sets the value for this component and its descendants. Typed as `T`. */
	set(value: T): void {
		const component = getActiveComponent();
		if (component === null) throw new Error('No active component found, cannot set context');
		let map = component.c;
		if (map === null) map = component.c = new Map();
		map.set(this, value);
	}
}

/**
 * Creates a typed context. The `const` type parameter preserves the literal
 * type of the default, so `createContext('light')` is a `Context<'light'>`
 * rather than a widened `Context<string>`; pass the type argument explicitly
 * to widen it (`createContext<'light' | 'dark'>('light')`).
 */
export function createContext<const T>(value: T): Context<T> {
	return new Context(value);
}

/**
 * A typed key/value store for request-scoped values (middleware locals, event
 * payloads). Keys and values are linked through the shape `T`, so a value set
 * with one type can only be read back as that type.
 */
export interface Locals<T extends object> {
	set<K extends keyof T>(key: K, value: T[K]): void;
	get<K extends keyof T>(key: K): T[K];
	has<K extends keyof T>(key: K): boolean;
	delete<K extends keyof T>(key: K): void;
	/** Shallow copy of everything stored so far. */
	all(): T;
}

/** Creates a typed locals store. Declare the shape once: `createLocals<{ user: User }>()`. */
export function createLocals<T extends object = Record<string, unknown>>(): Locals<T> {
	const store: Partial<T> = {};
	return {
		set(key, value) { store[key] = value; },
		get(key) { return store[key] as T[typeof key]; },
		has(key) { return Object.prototype.hasOwnProperty.call(store, key); },
		delete(key) { delete store[key]; },
		all() { return { ...store } as T; },
	};
}
