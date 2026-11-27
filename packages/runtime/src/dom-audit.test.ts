import { parseHTML } from 'linkedom';
import { reconcile } from '@vesk/runtime/src/reconcile';
import { DESTROYED } from '@vesk/runtime/src/ripple-constants';
import { effect, destroy_block, root } from '@vesk/runtime/src/ripple-blocks';
import { flush_sync, get, set, track } from '@vesk/runtime/src/ripple-runtime';

let passed = 0;
let failed = 0;

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

function it(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: unknown) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${(e as Error).message}`);
  }
}

function expectValue(value: unknown) {
  return {
    toBe(expected: unknown): void {
      if (value !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
      }
    },
    toBeTruthy(): void {
      if (!value) throw new Error(`Expected truthy, got ${JSON.stringify(value)}`);
    },
  };
}

interface Item {
  id: number;
  label: string;
}

function makeList(): {
  parent: any;
  anchor: any;
  endAnchor: any;
  update: (items: Item[]) => void;
  elements: Map<number, any>;
  insertCount: () => number;
  resetInserts: () => void;
} {
  const { document } = parseHTML('<div id="list"><!--map--><!--end--></div>');
  (globalThis as any).document = document;
  const parent = document.querySelector('#list') as any;
  const anchor = parent.childNodes[0];
  const endAnchor = parent.childNodes[1];
  const elements = new Map<number, any>();
  let inserts = 0;
  const originalInsertBefore = parent.insertBefore.bind(parent);
  parent.insertBefore = (node: any, ref: any) => {
    inserts++;
    return originalInsertBefore(node, ref);
  };
  const update = reconcile(
    anchor,
    endAnchor,
    [{ id: 1, label: 'A' }, { id: 2, label: 'B' }],
    (item) => String(item.id),
    (item, _index, _effs, _root) => {
      const el = document.createElement('li');
      el.textContent = item.label;
      parent.insertBefore(el, endAnchor);
      elements.set(item.id, el);
      return (next: Item) => {
        el.textContent = next.label;
      };
    },
  );
  return {
    parent,
    anchor,
    endAnchor,
    update,
    elements,
    insertCount: () => inserts,
    resetInserts: () => {
      inserts = 0;
    },
  };
}

describe('DOM audit regressions', () => {
  it('destroy_block is idempotent', () => {
    const b = effect(() => {});
    destroy_block(b);
    destroy_block(b);
    expectValue((b.f & DESTROYED) !== 0).toBeTruthy();
  });

  it('region re-render disposes child effects instead of leaking them', () => {
    let show: any = null;
    let tick: any = null;
    let runs = 0;

    root(() => {
      show = track(0);
      tick = track(0);
      effect(() => {
        get(show);
        effect(() => {
          get(tick);
          runs++;
        });
      });
    });

    flush_sync();
    expectValue(runs).toBe(1);
    set(show, 1);
    flush_sync();
    expectValue(runs).toBe(2);
    set(tick, 1);
    flush_sync();
    expectValue(runs).toBe(3);
  });

  it('one failing root does not drop another root update', () => {
    let failingCell: any = null;
    let healthyCell: any = null;
    let failingRuns = 0;
    let healthyRuns = 0;
    let error: unknown = null;

    root(() => {
      failingCell = track(0);
      effect(() => {
        const v = get(failingCell);
        failingRuns++;
        if (v === 1) throw new Error('block failed');
      });
    });
    root(() => {
      healthyCell = track(0);
      effect(() => {
        get(healthyCell);
        healthyRuns++;
      });
    });

    flush_sync();
    expectValue(failingRuns).toBe(1);
    expectValue(healthyRuns).toBe(1);

    set(failingCell, 1);
    set(healthyCell, 1);
    try {
      flush_sync();
    } catch (e: unknown) {
      error = e;
    }
    expectValue(error).toBeTruthy();
    expectValue(healthyRuns).toBe(2);
  });

  it('no-op keyed update performs no DOM insertions', () => {
    const list = makeList();
    list.resetInserts();
    list.update([{ id: 1, label: 'A' }, { id: 2, label: 'B' }]);
    expectValue(list.insertCount()).toBe(0);
  });

  it('same key with changed item updates existing row', () => {
    const list = makeList();
    list.update([{ id: 1, label: 'A' }, { id: 2, label: 'B2' }]);
    expectValue(list.elements.get(2).textContent).toBe('B2');
  });

  it('nested keyed region stays with its row when rows reorder', () => {
    const { document } = parseHTML('<div id="list"><!--map--><!--end--></div>');
    (globalThis as any).document = document;
    const parent = document.querySelector('#list') as any;
    const anchor = parent.childNodes[0];
    const endAnchor = parent.childNodes[1];
    const rows = new Map<number, { el: any; updateNested: (items: Array<{ label: string }>) => void }>();

    const updateRoot = reconcile(
      anchor,
      endAnchor,
      [{ id: 1 }, { id: 2 }],
      (item) => String(item.id),
      (item) => {
        const el = document.createElement('li') as any;
        const nestedAnchor = document.createComment('map');
        const nestedEnd = document.createComment('map-end');
        el.appendChild(nestedAnchor);
        el.appendChild(nestedEnd);
        parent.insertBefore(el, endAnchor);
        const updateNested = reconcile(
          nestedAnchor,
          nestedEnd,
          [{ label: `${item.id}-child` }],
          (nested) => nested.label,
          (nested) => {
            const span = document.createElement('span') as any;
            span.textContent = nested.label;
            nestedAnchor.parentNode.insertBefore(span, nestedEnd);
            return (next: { label: string }) => {
              span.textContent = next.label;
            };
          },
        );
        rows.set(item.id, { el, updateNested });
        return (next: { id: number }) => {
          rows.get(item.id)?.updateNested([{ label: `${next.id}-child` }]);
        };
      },
    );

    updateRoot([{ id: 2 }, { id: 1 }]);

    const elements = Array.from(parent.childNodes).filter((n: any) => n.nodeType === 1) as any[];
    expectValue(elements.length).toBe(2);
    expectValue(elements[0].textContent).toBe('2-child');
    expectValue(elements[1].textContent).toBe('1-child');
    expectValue(rows.get(1)!.el.parentNode === parent).toBeTruthy();
    expectValue(rows.get(2)!.el.parentNode === parent).toBeTruthy();
  });

  it('duplicate keys warn', () => {
    const list = makeList();
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      list.update([{ id: 1, label: 'A' }, { id: 2, label: 'B' }, { id: 2, label: 'dup' }]);
    } finally {
      console.warn = originalWarn;
    }
    expectValue(warnings.some((w) => w.includes('duplicate') || w.includes('Duplicate'))).toBeTruthy();
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
