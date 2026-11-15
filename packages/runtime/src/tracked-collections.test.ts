/**
 * Reactive collections — TrackedArray / TrackedObject / TrackedMap / TrackedSet.
 *
 * Ported from Ripple's `{array,object,map,set,proxy}.js`. Each collection is a
 * drop-in built-in whose reads subscribe the surrounding reactive context and
 * whose writes schedule it. The important invariants:
 *
 *  - element/property granularity: writing one index must not re-run an effect
 *    that only read a different index;
 *  - iteration, `length`/`size`, `has`, and `Array`/`Map`/`Set` prototype
 *    methods all subscribe;
 *  - `snapshot()` detaches without subscribing;
 *  - the server barrel aliases the native constructors.
 *
 * Run with: npx tsx packages/runtime/src/tracked-collections.test.ts
 */
import { flush_sync } from '@vesk/runtime/src/ripple-runtime';
import { effect, root } from '@vesk/runtime/src/ripple-blocks';
import {
	TrackedArray,
	TrackedMap,
	TrackedObject,
	TrackedSet,
	snapshot,
} from '@vesk/runtime/src/index-client';
import {
	TrackedArray as ServerTrackedArray,
	TrackedMap as ServerTrackedMap,
	TrackedObject as ServerTrackedObject,
	TrackedSet as ServerTrackedSet,
	snapshot as serverSnapshot,
} from '@vesk/runtime/src/index-server';

let passed = 0;
let failed = 0;
const pending: Promise<void>[] = [];

function describe(name: string, fn: () => void): void {
	console.log(`\n${name}`);
	fn();
}

function it(name: string, fn: () => void | Promise<void>): void {
	const run = Promise.resolve()
		.then(fn)
		.then(
			() => {
				passed++;
				console.log(`  ✓ ${name}`);
			},
			(e: unknown) => {
				failed++;
				console.log(`  ✗ ${name}`);
				console.log(`    ${(e as Error).message}`);
			},
		);

	pending.push(run);
}

function expect(value: unknown) {
	return {
		toBe(expected: unknown) {
			if (value !== expected) {
				throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
			}
		},
		toEqual(expected: unknown) {
			const a = JSON.stringify(value);
			const b = JSON.stringify(expected);
			if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
		},
		toHaveLength(n: number) {
			const length = (value as { length: number }).length;
			if (length !== n) throw new Error(`Expected length ${n}, got ${length}`);
		},
		toThrow() {
			let threw = false;
			try {
				(value as () => void)();
			} catch {
				threw = true;
			}
			if (!threw) throw new Error('Expected function to throw, but it did not');
		},
	};
}

describe('TrackedArray', () => {
	it('behaves like an array', () => {
		const arr = new TrackedArray<number>(1, 2, 3);
		arr.push(4);
		arr[0] = 0;
		arr.splice(1, 1);
		expect([...arr]).toEqual([0, 3, 4]);
		expect(arr.length).toBe(3);
		expect(arr instanceof Array).toBe(true);
	});

	it('subscribes to the elements an effect actually reads', () => {
		const arr = new TrackedArray('a', 'b', 'c');
		const seen: string[] = [];
		let runs = 0;
		root(() => {
			effect(() => {
				runs++;
				seen.push(arr[1] as string);
			});
		});
		flush_sync();
		arr[0] = 'z';
		flush_sync();
		expect(runs).toBe(1);
		arr[1] = 'y';
		flush_sync();
		expect(runs).toBe(2);
		expect(seen).toEqual(['b', 'y']);
	});

	it('subscription survives push, pop, splice and length writes', () => {
		const arr = new TrackedArray<number>(1);
		const lengths: number[] = [];
		root(() => {
			effect(() => {
				lengths.push(arr.length);
			});
		});
		flush_sync();
		arr.push(2);
		flush_sync();
		arr.splice(0, 1, 9, 10);
		flush_sync();
		arr.length = 1;
		flush_sync();
		expect(lengths).toEqual([1, 2, 3, 1]);
	});

	it('map/filter/slice return tracked arrays', () => {
		const arr = new TrackedArray(1, 2, 3);
		const doubled = arr.map((n) => n * 2);
		expect(doubled instanceof Array).toBe(true);
		doubled.push(8);
		expect([...doubled]).toEqual([2, 4, 6, 8]);
		expect([...arr]).toEqual([1, 2, 3]);
	});

	it('iteration and keys track length', () => {
		const arr = new TrackedArray('x');
		const seen: string[] = [];
		root(() => {
			effect(() => {
				seen.push([...arr].join(','));
			});
		});
		flush_sync();
		arr.push('y');
		flush_sync();
		expect(seen).toEqual(['x', 'x,y']);
	});

	it('from / of / fromAsync build tracked arrays', async () => {
		const from = TrackedArray.from([1, 2], (n) => n + 1);
		const of = TrackedArray.of('a', 'b');
		expect([...from]).toEqual([2, 3]);
		expect([...of]).toEqual(['a', 'b']);

		async function* gen() {
			yield 1;
			yield 2;
		}

		const async = await TrackedArray.fromAsync(gen(), (n) => n * 10);
		expect([...async]).toEqual([10, 20]);
	});

	it('snapshot detaches without subscribing', () => {
		const arr = new TrackedArray(1, 2, 3);
		const copy = snapshot(arr);
		arr.push(4);
		expect([...copy]).toEqual([1, 2, 3]);
		expect(arr.length).toBe(4);
	});
});

describe('TrackedObject', () => {
	it('behaves like a plain object', () => {
		const obj = new TrackedObject({ a: 1, b: 2 });
		obj.a = 10;
		delete obj.b;
		expect({ ...obj }).toEqual({ a: 10 });
		expect('b' in obj).toBe(false);
	});

	it('subscribes per property', () => {
		const obj = new TrackedObject({ a: 0, b: 0 });
		const seen: number[] = [];
		let runs = 0;
		root(() => {
			effect(() => {
				runs++;
				seen.push(obj.a);
			});
		});
		flush_sync();
		obj.b = 1;
		flush_sync();
		expect(runs).toBe(1);
		obj.a = 2;
		flush_sync();
		expect(runs).toBe(2);
		expect(seen).toEqual([0, 2]);
	});

	it('serialization tracks every value it reads (adds are seen once a key is read)', () => {
		// Parity with Ripple: `ownKeys` cannot subscribe to keys that do not
		// exist yet, so adding `b` alone does not re-run. `JSON.stringify`
		// then *reads* every key, so after a re-run the new key is tracked.
		const obj = new TrackedObject({ a: 1 });
		const seen: string[] = [];
		root(() => {
			effect(() => {
				seen.push(JSON.stringify(obj));
			});
		});
		flush_sync();
		obj.b = 2;
		flush_sync();
		delete obj.a;
		flush_sync();
		obj.b = 5;
		flush_sync();
		expect(seen).toEqual(['{"a":1}', '{"b":2}', '{"b":5}']);
	});

	it('reflects writes in JSON.stringify', () => {
		const obj = new TrackedObject({ a: 1 });
		obj.b = 2;
		expect(JSON.stringify(obj)).toBe('{"a":1,"b":2}');
	});

	it('rejects prototype mutation', () => {
		const obj = new TrackedObject({ a: 1 });
		expect(() => Object.setPrototypeOf(obj, {})).toThrow();
	});

	it('passes non-plain objects through untouched', () => {
		class Point {
			x = 1;
		}
		const point = new Point();
		expect(new TrackedObject(point)).toBe(point);
	});
});

describe('TrackedMap', () => {
	it('behaves like a map', () => {
		const map = new TrackedMap<string, number>([['a', 1]]);
		map.set('b', 2).set('a', 10);
		expect(map.get('a')).toBe(10);
		expect(map.has('b')).toBe(true);
		expect(map.size).toBe(2);
		map.delete('b');
		expect(map.size).toBe(1);
		expect(map.toJSON()).toEqual([['a', 10]]);
	});

	it('get subscribes per key', () => {
		const map = new TrackedMap([['a', 1], ['b', 2]]);
		const seen: Array<number | undefined> = [];
		let runs = 0;
		root(() => {
			effect(() => {
				runs++;
				seen.push(map.get('a'));
			});
		});
		flush_sync();
		map.set('b', 3);
		flush_sync();
		expect(runs).toBe(1);
		map.set('a', 4);
		flush_sync();
		expect(runs).toBe(2);
		expect(seen).toEqual([1, 4]);
	});

	it('size and iteration subscribe to add/delete/clear', () => {
		const map = new TrackedMap<string, number>();
		const sizes: number[] = [];
		const entries: string[] = [];
		root(() => {
			effect(() => {
				sizes.push(map.size);
			});
			effect(() => {
				entries.push([...map.keys()].join(','));
			});
		});
		flush_sync();
		map.set('a', 1);
		flush_sync();
		map.set('b', 2);
		flush_sync();
		map.clear();
		flush_sync();
		expect(sizes).toEqual([0, 1, 2, 0]);
		expect(entries).toEqual(['', 'a', 'a,b', '']);
	});

	it('forEach and values subscribe', () => {
		const map = new TrackedMap([['a', 1]]);
		const seen: number[][] = [];
		root(() => {
			effect(() => {
				const values: number[] = [];
				map.forEach((v) => values.push(v));
				seen.push(values);
			});
		});
		flush_sync();
		map.set('b', 2);
		flush_sync();
		expect(seen).toEqual([[1], [1, 2]]);
	});

	it('has subscribes to the key and to size for unknown keys', () => {
		const map = new TrackedMap<string, number>();
		const states: boolean[] = [];
		root(() => {
			effect(() => {
				states.push(map.has('a'));
			});
		});
		flush_sync();
		map.set('a', 1);
		flush_sync();
		expect(states).toEqual([false, true]);
	});
});

describe('TrackedSet', () => {
	it('behaves like a set', () => {
		const set = new TrackedSet<number>([1, 2]);
		set.add(3);
		set.delete(1);
		expect([...set]).toEqual([2, 3]);
		expect(set.size).toBe(2);
		expect(set.toJSON()).toEqual([2, 3]);
	});

	it('has and size subscribe', () => {
		const set = new TrackedSet<string>();
		const states: boolean[] = [];
		const sizes: number[] = [];
		root(() => {
			effect(() => {
				states.push(set.has('a'));
			});
			effect(() => {
				sizes.push(set.size);
			});
		});
		flush_sync();
		set.add('a');
		flush_sync();
		set.delete('a');
		flush_sync();
		expect(states).toEqual([false, true, false]);
		expect(sizes).toEqual([0, 1, 0]);
	});

	it('iteration subscribes to add and delete', () => {
		const set = new TrackedSet<number>([1]);
		const seen: number[][] = [];
		root(() => {
			effect(() => {
				seen.push([...set]);
			});
		});
		flush_sync();
		set.add(2);
		flush_sync();
		set.delete(1);
		flush_sync();
		expect(seen).toEqual([[1], [1, 2], [2]]);
	});

	it('ES2025 set algebra works and stays reactive', () => {
		const a = new TrackedSet([1, 2, 3]);
		const b = new TrackedSet([3, 4]);

		expect([...a.union(b)]).toEqual([1, 2, 3, 4]);
		expect([...a.intersection(b)]).toEqual([3]);
		expect([...a.difference(b)]).toEqual([1, 2]);
		expect([...a.symmetricDifference(b)]).toEqual([1, 2, 4]);
		expect(a.isSubsetOf(new Set([1, 2, 3, 9]))).toBe(true);
		expect(a.isSupersetOf(new Set([1, 2]))).toBe(true);
		expect(a.isDisjointFrom(new Set([7]))).toBe(true);

		const seen: number[][] = [];
		root(() => {
			effect(() => {
				seen.push([...a.union(b)]);
			});
		});
		flush_sync();
		b.add(5);
		flush_sync();
		expect(seen).toEqual([[1, 2, 3, 4], [1, 2, 3, 4, 5]]);
	});
});

describe('orphan scope', () => {
	it('collections created outside a component still notify readers', () => {
		const arr = new TrackedArray(7, 8);
		const seen: number[] = [];
		root(() => {
			effect(() => {
				seen.push(arr[0] as number);
			});
		});
		flush_sync();
		arr[0] = 9;
		flush_sync();
		expect(seen).toEqual([7, 9]);
	});
});

describe('server barrel', () => {
	it('aliases the native constructors', () => {
		expect(ServerTrackedArray).toBe(Array);
		expect(ServerTrackedObject).toBe(Object);
		expect(ServerTrackedMap).toBe(Map);
		expect(ServerTrackedSet).toBe(Set);
	});

	it('snapshot is a shallow plain copy', () => {
		const nested = { deep: true };
		const copy = serverSnapshot({ a: nested, arr: [1, 2] });
		expect(copy).toEqual({ a: nested, arr: [1, 2] });
		expect(copy.a).toBe(nested);
	});
});

console.log(`\n${'='.repeat(50)}`);
await Promise.all(pending);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
	process.exit(1);
} else {
	console.log('All tests passed!');
}
