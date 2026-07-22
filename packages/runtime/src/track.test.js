/**
 * Vesk Runtime Tests — Fine-Grained Reactivity
 *
 * Run with: node --experimental-vm-modules packages/runtime/src/track.test.js
 */
import { track, effect, batch, derived, Cell, Effect } from './track.js';

let passed = 0;
let failed = 0;

function describe(name, fn) {
	console.log(`\n${name}`);
	fn();
}

function it(name, fn) {
	try {
		fn();
		passed++;
		console.log(`  ✓ ${name}`);
	} catch (e) {
		failed++;
		console.log(`  ✗ ${name}`);
		console.log(`    ${e.message}`);
	}
}

function expect(value) {
	return {
		toBe(expected) {
			if (value !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
		},
		toEqual(expected) {
			const a = JSON.stringify(value);
			const b = JSON.stringify(expected);
			if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
		},
		toHaveLength(n) {
			if (value.length !== n) throw new Error(`Expected length ${n}, got ${value.length}`);
		},
	};
}

// ============================================================
// Cell basics
// ============================================================
describe('Cell', () => {
	it('stores initial value', () => {
		const cell = track(42);
		expect(cell.get()).toBe(42);
	});

	it('set() updates value', () => {
		const cell = track(0);
		cell.set(10);
		expect(cell.get()).toBe(10);
	});

	it('set() returns true when value changed', () => {
		const cell = track(0);
		expect(cell.set(1)).toBe(true);
	});

	it('set() returns false when value unchanged', () => {
		const cell = track(0);
		expect(cell.set(0)).toBe(false);
	});

	it('peek() reads without tracking', () => {
		const cell = track(5);
		expect(cell.peek()).toBe(5);
	});

	it('update() applies callback', () => {
		const cell = track(10);
		cell.update(v => v * 2);
		expect(cell.get()).toBe(20);
	});
});

// ============================================================
// Effect tracking
// ============================================================
describe('Effect', () => {
	it('runs immediately on creation', () => {
		let ran = false;
		effect(() => { ran = true; });
		expect(ran).toBe(true);
	});

	it('re-runs when dependency changes', () => {
		const count = track(0);
		let runs = 0;
		effect(() => {
			count.get();
			runs++;
		});
		expect(runs).toBe(1);
		count.set(1);
		expect(runs).toBe(2);
		count.set(2);
		expect(runs).toBe(3);
	});

	it('only re-runs affected effects', () => {
		const a = track(0);
		const b = track(0);
		let runsA = 0;
		let runsB = 0;
		effect(() => { a.get(); runsA++; });
		effect(() => { b.get(); runsB++; });
		expect(runsA).toBe(1);
		expect(runsB).toBe(1);
		a.set(1);
		expect(runsA).toBe(2);
		expect(runsB).toBe(1);
		b.set(1);
		expect(runsA).toBe(2);
		expect(runsB).toBe(2);
	});

	it('does not re-run when unrelated cell changes', () => {
		const a = track(0);
		const b = track(0);
		let runs = 0;
		effect(() => {
			a.get(); // only depends on a
			runs++;
		});
		expect(runs).toBe(1);
		b.set(1); // change b — should not trigger
		expect(runs).toBe(1);
	});

	it('tracks multiple dependencies in one effect', () => {
		const a = track(1);
		const b = track(2);
		let sum = 0;
		effect(() => {
			sum = a.get() + b.get();
		});
		expect(sum).toBe(3);
		a.set(10);
		expect(sum).toBe(12);
		b.set(20);
		expect(sum).toBe(30);
	});

	it('destroy() stops re-runs', () => {
		const count = track(0);
		let runs = 0;
		const e = effect(() => { count.get(); runs++; });
		expect(runs).toBe(1);
		e.destroy();
		count.set(1);
		expect(runs).toBe(1); // no re-run
	});

	it('unsubscribes from old deps on re-run', () => {
		const flag = track(true);
		const a = track(1);
		const b = track(2);
		let runs = 0;
		effect(() => {
			if (flag.get()) {
				a.get();
			} else {
				b.get();
			}
			runs++;
		});
		expect(runs).toBe(1);
		a.set(10); // should trigger
		expect(runs).toBe(2);
		b.set(20); // should NOT trigger (effect reads a, not b)
		expect(runs).toBe(2);
		flag.set(false); // switch to b
		expect(runs).toBe(3);
		b.set(30); // now should trigger
		expect(runs).toBe(4);
		a.set(100); // should NOT trigger (effect reads b, not a)
		expect(runs).toBe(4);
	});
});

// ============================================================
// Batch
// ============================================================
describe('Batch', () => {
	it('defers effects until batch ends', () => {
		const a = track(0);
		const b = track(0);
		let runs = 0;
		effect(() => { a.get(); b.get(); runs++; });
		expect(runs).toBe(1);
		batch(() => {
			a.set(1);
			b.set(1);
			expect(runs).toBe(1); // not yet
		});
		expect(runs).toBe(2); // re-ran once after batch
	});

	it('does not re-run if no values changed', () => {
		const a = track(0);
		let runs = 0;
		effect(() => { a.get(); runs++; });
		expect(runs).toBe(1);
		batch(() => {
			a.set(0); // same value
		});
		expect(runs).toBe(1); // no re-run
	});

	it('returns the batch function return value', () => {
		const result = batch(() => 42);
		expect(result).toBe(42);
	});
});

// ============================================================
// Derived
// ============================================================
describe('Derived', () => {
	it('creates a computed cell', () => {
		const count = track(5);
		const doubled = derived(() => count.get() * 2);
		expect(doubled.get()).toBe(10);
	});

	it('updates when dependencies change', () => {
		const count = track(5);
		const doubled = derived(() => count.get() * 2);
		expect(doubled.get()).toBe(10);
		count.set(10);
		expect(doubled.get()).toBe(20);
	});

	it('chains derived cells', () => {
		const a = track(1);
		const b = derived(() => a.get() + 1);
		const c = derived(() => b.get() + 1);
		expect(c.get()).toBe(3);
		a.set(10);
		expect(c.get()).toBe(12);
	});
});

// ============================================================
// Integration: DOM-like pattern
// ============================================================
describe('DOM-like integration', () => {
	it('simulates fine-grained text update', () => {
		// Simulate DOM: text node with data property
		const textNode = { data: '' };

		const count = track(0);
		effect(() => {
			textNode.data = String(count.get());
		});

		expect(textNode.data).toBe('0');
		count.set(5);
		expect(textNode.data).toBe('5');
		count.set(42);
		expect(textNode.data).toBe('42');
	});

	it('simulates conditional rendering', () => {
		const container = { children: [] };
		const show = track(true);
		let span = null;

		effect(() => {
			if (show.get()) {
				if (!span) {
					span = { tag: 'span', text: 'Visible' };
					container.children.push(span);
				}
			} else {
				if (span) {
					container.children = container.children.filter(c => c !== span);
					span = null;
				}
			}
		});

		expect(container.children).toHaveLength(1);
		expect(container.children[0].tag).toBe('span');
		show.set(false);
		expect(container.children).toHaveLength(0);
		show.set(true);
		expect(container.children).toHaveLength(1);
	});

	it('simulates attribute update', () => {
		const el = { className: '' };
		const active = track('btn');
		effect(() => {
			el.className = active.get();
		});
		expect(el.className).toBe('btn');
		active.set('btn-active');
		expect(el.className).toBe('btn-active');
	});
});

// ============================================================
// Results
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
	process.exit(1);
} else {
	console.log('All tests passed!');
}
