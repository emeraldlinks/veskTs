/**
 * Vesk Reactive Runtime — Fine-Grained Reactivity Without VDOM
 *
 * Each `track()` call creates a reactive cell. Effects auto-track
 * which cells they read. When a cell changes, only the specific
 * effects that read it re-run, updating only the DOM nodes they touch.
 *
 * No virtual DOM. No diffing. No scheduling overhead.
 */

/** @type {Effect | null} */
let currentEffect = null;

/** @type {Set<Cell> | null} */
let currentDeps = null;

/** @type {number} */
let batchDepth = 0;

/** @type {Set<Effect>[]} */
const batchQueue = [];

/**
 * A reactive cell wrapping a value with subscriber tracking.
 * @template T
 */
export class Cell {
	/** @type {T} */
	#value;

	/** @type {Set<Effect>} */
	#subscribers = new Set();

	/**
	 * @param {T} initialValue
	 */
	constructor(initialValue) {
		this.#value = initialValue;
	}

	/**
	 * Read the cell's value. If an effect is running, register it as a subscriber.
	 * @returns {T}
	 */
	get() {
		if (currentEffect) {
			this.#subscribers.add(currentEffect);
			currentDeps?.add(this);
		}
		return this.#value;
	}

	/**
	 * Read the value without tracking dependencies.
	 * @returns {T}
	 */
	peek() {
		return this.#value;
	}

	/**
	 * Set a new value. If changed, notify all subscribers.
	 * @param {T} newValue
	 * @returns {boolean} whether the value actually changed
	 */
	set(newValue) {
		if (Object.is(this.#value, newValue)) return false;
		this.#value = newValue;
		this.#notify();
		return true;
	}

	/**
	 * Update via callback. Notifies only if value changed.
	 * @param {(current: T) => T} fn
	 * @returns {boolean}
	 */
	update(fn) {
		return this.set(fn(this.#value));
	}

	/**
	 * Remove an effect from this cell's subscriber set.
	 * @param {Effect} effect
	 */
	unsubscribe(effect) {
		this.#subscribers.delete(effect);
	}

	/**
	 * Notify all subscribers. Respects batching.
	 * Snapshots the subscriber set before iterating to avoid infinite loops
	 * when effects re-subscribe during re-run.
	 */
	#notify() {
		if (batchDepth > 0) {
			batchQueue[batchQueue.length - 1].add(...this.#subscribers);
			return;
		}
		// Snapshot: effect.run() unsubscribes then re-subscribes, which would
		// cause the iterator to revisit the same element in an infinite loop.
		const subs = Array.from(this.#subscribers);
		for (const effect of subs) {
			effect.run();
		}
	}
}

/**
 * An effect that auto-tracks reactive dependencies.
 * When any cell it reads changes, it re-runs.
 */
export class Effect {
	/** @type {() => void} */
	#fn;

	/** @type {Set<Cell>} */
	#deps = new Set();

	/** @type {boolean} */
	#active = false;

	/**
	 * @param {() => void} fn
	 */
	constructor(fn) {
		this.#fn = fn;
		this.run();
	}

	/** Run the effect, re-tracking dependencies. */
	run() {
		if (!this.#active && batchDepth > 0) {
			batchQueue[batchQueue.length - 1].add(this);
			return;
		}

		// Unsubscribe from old deps
		for (const cell of this.#deps) {
			cell.unsubscribe(this);
		}

		// Track new deps
		const prev = currentEffect;
		const prevDeps = currentDeps;
		currentEffect = this;
		currentDeps = new Set();

		try {
			this.#fn();
		} finally {
			this.#deps = currentDeps;
			currentEffect = prev;
			currentDeps = prevDeps;
		}

		this.#active = true;
	}

	/** Stop this effect from re-running. */
	destroy() {
		for (const cell of this.#deps) {
			cell.unsubscribe(this);
		}
		this.#deps.clear();
		this.#active = false;
	}
}

/**
 * Create a reactive cell.
 * @template T
 * @param {T} initialValue
 * @returns {Cell<T>}
 */
export function track(initialValue) {
	return new Cell(initialValue);
}

/**
 * Create an effect that auto-tracks dependencies.
 * @param {() => void} fn
 * @returns {Effect}
 */
export function effect(fn) {
	return new Effect(fn);
}

/**
 * Batch multiple updates into a single effect re-run cycle.
 * Effects triggered during the batch are deferred until the batch ends.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function batch(fn) {
	batchDepth++;
	batchQueue.push(new Set());
	try {
		return fn();
	} finally {
		const pending = batchQueue.pop();
		batchDepth--;
		if (batchDepth === 0 && pending) {
			for (const e of pending) {
				e.run();
			}
		}
	}
}

/**
 * Create a derived (computed) cell that updates when its dependencies change.
 * @template T
 * @param {() => T} fn
 * @returns {Cell<T>}
 */
export function derived(fn) {
	const cell = track(undefined);
	effect(() => {
		cell.set(fn());
	});
	return cell;
}
