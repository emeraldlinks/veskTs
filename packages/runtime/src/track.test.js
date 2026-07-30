/**
 * Vesk Runtime Tests — Ripple Reactivity System
 *
 * Run with: node --experimental-vm-modules packages/runtime/src/track.test.js
 */
import { track, get, set, untrack, derived, flush_sync, tick } from './ripple-runtime';
import { effect, destroy_block, root } from './ripple-blocks';

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
// Tracked basics
// ============================================================
describe('Tracked', () => {
	it('stores initial value', () => {
		root(() => {
			const t = track(42);
			expect(get(t)).toBe(42);
		});
	});

	it('set() updates value', () => {
		root(() => {
			const t = track(0);
			set(t, 10);
			expect(get(t)).toBe(10);
		});
	});

	it('.value property reads and writes', () => {
		root(() => {
			const t = track(5);
			expect(t.value).toBe(5);
			t.value = 20;
			expect(get(t)).toBe(20);
		});
	});

	it('peek reads without tracking', () => {
		root(() => {
			const t = track(5);
			expect(untrack(() => get(t))).toBe(5);
		});
	});
});

// ============================================================
// Effect tracking
// ============================================================
describe('Effect', () => {
	it('re-runs when dependency changes', () => {
		root(() => {
			const count = track(0);
			let runs = 0;
			flush_sync(() => {
				effect(() => {
					get(count);
					runs++;
				});
			});
			expect(runs).toBe(1);
			set(count, 1);
			flush_sync();
			expect(runs).toBe(2);
			set(count, 2);
			flush_sync();
			expect(runs).toBe(3);
		});
	});

	it('only re-runs affected effects', () => {
		root(() => {
			const a = track(0);
			const b = track(0);
			let runsA = 0;
			let runsB = 0;
			flush_sync(() => {
				effect(() => { get(a); runsA++; });
				effect(() => { get(b); runsB++; });
			});
			expect(runsA).toBe(1);
			expect(runsB).toBe(1);
			set(a, 1);
			flush_sync();
			expect(runsA).toBe(2);
			expect(runsB).toBe(1);
			set(b, 1);
			flush_sync();
			expect(runsA).toBe(2);
			expect(runsB).toBe(2);
		});
	});

	it('does not re-run when unrelated cell changes', () => {
		root(() => {
			const a = track(0);
			const b = track(0);
			let runs = 0;
			flush_sync(() => {
				effect(() => {
					get(a); // only depends on a
					runs++;
				});
			});
			expect(runs).toBe(1);
			set(b, 1); // change b — should not trigger
			flush_sync();
			expect(runs).toBe(1);
		});
	});

	it('tracks multiple dependencies in one effect', () => {
		root(() => {
			const a = track(1);
			const b = track(2);
			let sum = 0;
			flush_sync(() => {
				effect(() => {
					sum = get(a) + get(b);
				});
			});
			expect(sum).toBe(3);
			set(a, 10);
			flush_sync();
			expect(sum).toBe(12);
			set(b, 20);
			flush_sync();
			expect(sum).toBe(30);
		});
	});

	it('unsubscribes from old deps on re-run', () => {
		root(() => {
			const flag = track(true);
			const a = track(1);
			const b = track(2);
			let runs = 0;
			flush_sync(() => {
				effect(() => {
					if (get(flag)) {
						get(a);
					} else {
						get(b);
					}
					runs++;
				});
			});
			expect(runs).toBe(1);
			set(a, 10); // should trigger
			flush_sync();
			expect(runs).toBe(2);
			set(b, 20); // should NOT trigger (effect reads a, not b)
			flush_sync();
			expect(runs).toBe(2);
			set(flag, false); // switch to b
			flush_sync();
			expect(runs).toBe(3);
			set(b, 30); // now should trigger
			flush_sync();
			expect(runs).toBe(4);
			set(a, 100); // should NOT trigger (effect reads b, not a)
			flush_sync();
			expect(runs).toBe(4);
		});
	});
});

// ============================================================
// Derived
// ============================================================
describe('Derived', () => {
	it('creates a computed value', () => {
		root(() => {
			const count = track(5);
			const doubled = derived(() => get(count) * 2);
			expect(get(doubled)).toBe(10);
		});
	});

	it('updates when dependencies change', () => {
		root(() => {
			const count = track(5);
			const doubled = derived(() => get(count) * 2);
			expect(get(doubled)).toBe(10);
			set(count, 10);
			expect(get(doubled)).toBe(20);
		});
	});

	it('chains derived values', () => {
		root(() => {
			const a = track(1);
			const b = derived(() => get(a) + 1);
			const c = derived(() => get(b) + 1);
			expect(get(c)).toBe(3);
			set(a, 10);
			expect(get(c)).toBe(12);
		});
	});
});

// ============================================================
// Integration: DOM-like pattern
// ============================================================
describe('DOM-like integration', () => {
	it('simulates fine-grained text update', () => {
		root(() => {
			const textNode = { data: '' };
			const count = track(0);
			flush_sync(() => {
				effect(() => {
					textNode.data = String(get(count));
				});
			});
			expect(textNode.data).toBe('0');
			set(count, 5);
			flush_sync();
			expect(textNode.data).toBe('5');
			set(count, 42);
			flush_sync();
			expect(textNode.data).toBe('42');
		});
	});

	it('simulates attribute update', () => {
		root(() => {
			const el = { className: '' };
			const active = track('btn');
			flush_sync(() => {
				effect(() => {
					el.className = get(active);
				});
			});
			expect(el.className).toBe('btn');
			set(active, 'btn-active');
			flush_sync();
			expect(el.className).toBe('btn-active');
		});
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
