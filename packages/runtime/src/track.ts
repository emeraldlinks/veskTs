let currentEffect: Effect | null = null;
let currentDeps: Set<Cell<unknown>> | null = null;
let batchDepth = 0;
const batchQueue: Set<Effect>[] = [];

export class Cell<T> {
	#value: T;
	#subscribers = new Set<Effect>();

	constructor(initialValue: T) {
		this.#value = initialValue;
	}

	get(): T {
		if (currentEffect) {
			this.#subscribers.add(currentEffect);
			currentDeps?.add(this);
		}
		return this.#value;
	}

	peek(): T {
		return this.#value;
	}

	set(newValue: T): boolean {
		if (Object.is(this.#value, newValue)) return false;
		this.#value = newValue;
		this.#notify();
		return true;
	}

	update(fn: (current: T) => T): boolean {
		return this.set(fn(this.#value));
	}

	unsubscribe(effect: Effect): void {
		this.#subscribers.delete(effect);
	}

	#notify(): void {
		if (batchDepth > 0) {
			const queue = batchQueue[batchQueue.length - 1];
			for (const sub of this.#subscribers) {
				queue.add(sub);
			}
			return;
		}
		const subs = Array.from(this.#subscribers);
		for (const effect of subs) {
			effect.run();
		}
	}
}

export class Effect {
	#fn: () => void;
	#deps = new Set<Cell<unknown>>();
	#active = false;
	#destroyed = false;

	constructor(fn: () => void) {
		this.#fn = fn;
		this.run();
	}

	run(): void {
		if (this.#destroyed) return;
		if (!this.#active && batchDepth > 0) {
			batchQueue[batchQueue.length - 1].add(this);
			return;
		}

		for (const cell of this.#deps) {
			cell.unsubscribe(this);
		}

		const prev = currentEffect;
		const prevDeps = currentDeps;
		currentEffect = this;
		currentDeps = new Set();

		try {
			this.#fn();
		} finally {
			this.#deps = currentDeps as Set<Cell<unknown>>;
			currentEffect = prev;
			currentDeps = prevDeps;
		}

		this.#active = true;
	}

	destroy(): void {
		for (const cell of this.#deps) {
			cell.unsubscribe(this);
		}
		this.#deps.clear();
		this.#active = false;
		this.#destroyed = true;
	}
}

export function track<T>(initialValue: T): Cell<T> {
	return new Cell(initialValue);
}

export function effect(fn: () => void): Effect {
	return new Effect(fn);
}

export function batch<T>(fn: () => T): T {
	batchDepth++;
	batchQueue.push(new Set());
	try {
		return fn();
	} finally {
		const pending = batchQueue.pop()!;
		batchDepth--;
		if (batchDepth === 0 && pending) {
			for (const e of pending) {
				e.run();
			}
		} else if (batchDepth > 0 && pending) {
			const parentQueue = batchQueue[batchQueue.length - 1];
			for (const e of pending) {
				parentQueue.add(e);
			}
		}
	}
}

export function derived<T>(fn: () => T): Cell<T> {
	const cell = track(undefined as unknown as T);
	effect(() => {
		cell.set(fn());
	});
	return cell;
}
