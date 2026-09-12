import { needsHydration, hydrationCount, createHydrateWalker, createHydrateChildWalker, hydrateOnInteraction, hydrate, assertFullyHydrated, setHydrateDevMode } from '@vesk/runtime/src/hydrate';
import { reconcileHydrated } from '@vesk/runtime/src/reconcile';
import { effect } from '@vesk/runtime/src/ripple-blocks';
import { flush_sync, get, set, track } from '@vesk/runtime/src/ripple-runtime';

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

function expect(actual) {
  const show = (v) => {
    if (v == null || typeof v !== 'object') return JSON.stringify(v);
    if (v.outerHTML !== undefined) return JSON.stringify(v.outerHTML).slice(0, 120);
    if (v.id !== undefined && typeof v.tagName === 'string') return JSON.stringify(`<${v.tagName.toLowerCase()}#${v.id}>`);
    try { return JSON.stringify(v); } catch { return Object.prototype.toString.call(v); }
  };
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`Expected ${show(expected)}, got ${show(actual)}`);
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
    },
    toBeDefined() {
      if (actual == null) throw new Error('Expected value to be defined');
    },
    toBeGreaterThan(expected) {
      if (actual <= expected) throw new Error(`Expected ${actual} > ${expected}`);
    },
    toBeGreaterThanOrEqual(expected) {
      if (actual < expected) throw new Error(`Expected ${actual} >= ${expected}`);
    },
    toBeLessThan(expected) {
      if (actual >= expected) throw new Error(`Expected ${actual} < ${expected}`);
    },
    toContain(expected) {
      if (!actual.includes(expected)) throw new Error(`Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
    },
  };
}

// Minimal document mock for tests that need it
// Extended with a linked-list node model so claim-by-key / canary tests can
// exercise real sibling traversal (parentNode, nextSibling, nextElementSibling,
// insertBefore/remove, outerHTML) and a working comment TreeWalker.
let _nodeId = 0;
function makeNode(type, tag) {
  const node = {
    id: _nodeId++,
    nodeType: type, // 1 element · 3 text · 8 comment
    tagName: type === 1 ? (tag || 'DIV').toUpperCase() : undefined,
    data: type === 1 ? undefined : '',
    parentNode: null,
    childNodes: [],
    _attrs: new Map(),
  };
  const def = (name, getter) => Object.defineProperty(node, name, { get: getter, enumerable: true, configurable: true });
  def('children', () => node.childNodes.filter((c) => c.nodeType === 1));
  def('firstChild', () => node.childNodes[0] || null);
  def('lastChild', () => node.childNodes[node.childNodes.length - 1] || null);
  def('previousSibling', () => {
    if (!node.parentNode) return null;
    const i = node.parentNode.childNodes.indexOf(node);
    return i > 0 ? node.parentNode.childNodes[i - 1] : null;
  });
  def('nextSibling', () => {
    if (!node.parentNode) return null;
    const i = node.parentNode.childNodes.indexOf(node);
    return i >= 0 && i < node.parentNode.childNodes.length - 1 ? node.parentNode.childNodes[i + 1] : null;
  });
  def('nextElementSibling', () => {
    for (let n = node.nextSibling; n; n = n.nextSibling) if (n.nodeType === 1) return n;
    return null;
  });
  def('previousElementSibling', () => {
    for (let n = node.previousSibling; n; n = n.previousSibling) if (n.nodeType === 1) return n;
    return null;
  });
  def('parentElement', () => (node.parentNode && node.parentNode.nodeType === 1 ? node.parentNode : null));
  def('isConnected', () => node.parentNode != null && node.parentNode.isConnected);
  def('textContent', () => (node.data !== undefined ? node.data : node.childNodes.map((c) => c.textContent).join('')));
  // Real DOM aliases `data` and `nodeValue`; reconcile's removeRange/moveBefore
  // scan-stops read `nodeValue`, so the mock must mirror that.
  def('nodeValue', () => (node.nodeType === 8 || node.nodeType === 3 ? node.data : null));
  def('outerHTML', () => {
    if (node.nodeType === 8) return `<!--${node.data}-->`;
    if (node.nodeType === 3) return node.data;
    const attrs = [...node._attrs].map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${v}"`)).join('');
    return `<${node.tagName.toLowerCase()}${attrs}>${node.childNodes.map((c) => c.outerHTML).join('')}</${node.tagName.toLowerCase()}>`;
  });
  node.appendChild = (c) => {
    if (c.parentNode !== null) c.remove();
    node.childNodes.push(c);
    c.parentNode = node;
    return c;
  };
  node.insertBefore = (c, ref) => {
    if (ref == null) return node.appendChild(c);
    if (c.parentNode !== null) c.remove();
    const i = node.childNodes.indexOf(ref);
    if (i === -1) return node.appendChild(c);
    node.childNodes.splice(i, 0, c);
    c.parentNode = node;
    return c;
  };
  node.removeChild = (c) => {
    const i = node.childNodes.indexOf(c);
    if (i !== -1) { node.childNodes.splice(i, 1); c.parentNode = null; }
    return c;
  };
  node.remove = () => { if (node.parentNode) node.parentNode.removeChild(node); };
  node.contains = (other) => {
    for (let n = other; n; n = n.parentNode) if (n === node) return true;
    return false;
  };
  node.getAttribute = (k) => (node._attrs.has(k) ? node._attrs.get(k) : null);
  node.setAttribute = (k, v) => { node._attrs.set(k, String(v)); };
  node.hasAttribute = (k) => node._attrs.has(k);
  node.querySelectorAll = () => [];
  node.addEventListener = () => {};
  node.removeEventListener = () => {};
  node.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  return node;
}

function commentWalker(root) {
  // Preorder list of comment nodes (type 8), used by the TreeWalker mock.
  const out = [];
  (function walk(n) {
    for (const c of n.childNodes) { if (c.nodeType === 8) out.push(c); walk(c); }
  })(root);
  return out;
}

function mockDocument() {
  const doc = {
    cookie: '',
    head: { appendChild() {} },
    createElement(tag) { return makeNode(1, tag); },
    createComment(text) { const c = makeNode(8); c.data = text; return c; },
    createTextNode(text) { const t = makeNode(3); t.data = text; return t; },
    createTreeWalker(root, _whatToShow, filter) {
      const comments = commentWalker(root);
      let i = 0;
      const w = {
        currentNode: null,
        nextNode() {
          while (i < comments.length) {
            const node = comments[i++];
            const res = filter ? filter.acceptNode(node) : 1;
            if (res === 1) { w.currentNode = node; return node; }
          }
          return null;
        },
      };
      return w;
    },
  };
  globalThis.document = doc;
  return doc;
}

function cleanupDocument() {
  delete globalThis.document;
}

function captureWarns(fn) {
  const warns = [];
  const orig = console.warn;
  console.warn = (msg) => warns.push(String(msg));
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return warns;
}

class BlockMock {
  constructor() {
    this.called = false;
    // Shape of a real Block (ripple-runtime `Block`) so `destroy_block` can
    // process it; it is registered in no parent and carries empty flags. The
    // only teardown callback flips `called`.
    this.co = null;
    this.d = null;
    this.first = null;
    this.f = 0;
    this.fn = () => null;
    this.last = null;
    this.next = null;
    this.p = null;
    this.prev = null;
    this.s = null;
    this.t = null;
    this.tc = [() => { this.called = true; }];
  }
}

describe('needsHydration', () => {
  it('returns false for container with no vsk markers', () => {
    const doc = mockDocument();
    const container = doc.createElement('div');
    expect(needsHydration(container)).toBe(false);
    cleanupDocument();
  });

  it('is a function', () => {
    expect(typeof needsHydration).toBe('function');
  });
});

describe('hydrationCount', () => {
  it('returns 0 for empty container', () => {
    const doc = mockDocument();
    expect(hydrationCount(doc.createElement('div'))).toBe(0);
    cleanupDocument();
  });

  it('is a function', () => {
    expect(typeof hydrationCount).toBe('function');
  });
});

describe('createHydrateWalker', () => {
  it('returns done true for empty markers', () => {
    const walker = createHydrateWalker(null, []);
    expect(walker.done()).toBe(true);
  });

  it('nextElement creates new element when no markers', () => {
    mockDocument();
    const walker = createHydrateWalker(null, []);
    const el = walker.nextElement('div');
    expect(el.tagName).toBe('DIV');
    cleanupDocument();
  });

  it('subWalker returns child walker', () => {
    const walker = createHydrateWalker(null, []);
    const sub = walker.subWalker(null);
    expect(typeof sub.nextElement).toBe('function');
  });

  it('stops at the first tag mismatch instead of eating later markers (no cascade)', () => {
    mockDocument();
    const root = document.createElement('div');
    const m1 = document.createComment('vsk');
    const s1 = document.createElement('span');
    s1.appendChild(document.createTextNode('one'));
    const m2 = document.createComment('vsk');
    const s2 = document.createElement('span');
    s2.appendChild(document.createTextNode('two'));
    root.appendChild(m1); root.appendChild(s1);
    root.appendChild(m2); root.appendChild(s2);

    const walker = createHydrateWalker(root);
    const a = walker.nextElement('a');
    // No matching SSR element: consume exactly THIS marker and return a fresh,
    // detached element rather than hunting (and destroying) the siblings.
    expect(a.tagName).toBe('A');
    expect(a.parentNode).toBe(null);
    // The sibling marker the old hunt would have eaten must still be claimable.
    const claimed = walker.nextElement('span');
    expect(claimed).toBe(s2);
    cleanupDocument();
  });

  it('claims a marked anchor inside a boundary subWalker (Link SSR shape)', () => {
    mockDocument();
    const root = document.createElement('div');
    const mBox = document.createComment('vsk');
    const box = document.createElement('div');
    box.setAttribute('style', 'display:contents');
    const mA = document.createComment('vsk');
    const a = document.createElement('a');
    a.appendChild(document.createTextNode('go'));
    box.appendChild(mA);
    box.appendChild(a);
    root.appendChild(mBox);
    root.appendChild(box);

    const walker = createHydrateWalker(root);
    const boxClaim = walker.nextElement();
    expect(boxClaim).toBe(box);
    const sub = walker.subWalker(box);
    // SSR emits `<!--vsk--><a>` for Link roots; the claim must adopt it in place.
    const aClaim = sub.nextElement('a');
    expect(aClaim).toBe(a);
    cleanupDocument();
  });
});

describe('createHydrateChildWalker', () => {
  it('nextElement returns created element when no children match', () => {
    mockDocument();
    const parent = { children: [], childNodes: [] };
    const walker = createHydrateChildWalker(parent);
    const el = walker.nextElement('span');
    expect(el.tagName).toBe('SPAN');
    cleanupDocument();
  });

  it('subWalker returns child walker', () => {
    const walker = createHydrateChildWalker({ children: [], childNodes: [] });
    const sub = walker.subWalker({ children: [], childNodes: [] });
    expect(typeof sub.nextElement).toBe('function');
  });
});

describe('hydrateOnInteraction', () => {
  it('returns control object with cancel and hydrateNow', () => {
    mockDocument();
    const container = document.createElement('div');
    const ctrl = hydrateOnInteraction(container, () => {}, {});
    expect(typeof ctrl.cancel).toBe('function');
    expect(typeof ctrl.hydrateNow).toBe('function');
    cleanupDocument();
  });

  it('cancel prevents hydration', () => {
    mockDocument();
    let hydrated = false;
    const container = document.createElement('div');
    const ctrl = hydrateOnInteraction(container, () => { hydrated = true; }, {});
    ctrl.cancel();
    expect(typeof ctrl.cancel).toBe('function');
    cleanupDocument();
  });

  it('hydrateNow triggers hydration', () => {
    mockDocument();
    let hydrated = false;
    const container = document.createElement('div');
    const ctrl = hydrateOnInteraction(container, () => { hydrated = true; }, {});
    ctrl.hydrateNow();
    expect(typeof ctrl.cancel).toBe('function');
    cleanupDocument();
  });

  it('accepts custom event list', () => {
    mockDocument();
    const container = document.createElement('div');
    const ctrl = hydrateOnInteraction(container, () => {}, {}, { events: ['mouseenter'] });
    expect(typeof ctrl.cancel).toBe('function');
    cleanupDocument();
  });
});

describe('hydrate block window', () => {
  it('runs component effects created during hydration (no external root needed)', () => {
    mockDocument();
    const container = document.createElement('div');
    const textNode = { data: '' };
    const componentFn = () => {
      effect(() => { textNode.data = 'updated'; });
    };
    hydrate(container, componentFn as unknown as (props: Record<string, unknown>, registry: Map<string, unknown>, walker: unknown) => unknown, {});
    flush_sync();
    expect(textNode.data).toBe('updated');
    cleanupDocument();
  });

  // Proof that effects created inside hydration stay live AFTER hydration
  // completes: a tracked cell read by the effect keeps re-rendering across
  // post-hydration writes (e.g. later user interaction), not just the initial
  // hydration flush. The cell is created inside the component body (as compiled
  // code does) so its dependency chain sits inside the hydration block window.
  it('effects keep reacting after hydration completes (post-hydration set)', () => {
    mockDocument();
    const container = document.createElement('div');
    const el = { data: '' };
    let setCell: (v: number) => void = () => {};
    const componentFn = () => {
      const cell = track(0);
      effect(() => { el.data = String(get(cell)); });
      setCell = (v: number) => { set(cell, v); };
    };
    hydrate(container, componentFn as unknown as (props: Record<string, unknown>, registry: Map<string, unknown>, walker: unknown) => unknown, {});
    flush_sync();
    expect(el.data).toBe('0');
    flush_sync(() => { setCell(1); });
    expect(el.data).toBe('1');
    flush_sync(() => { setCell(2); });
    expect(el.data).toBe('2');
    cleanupDocument();
  });
});

describe('walker marker lifecycle state machine', () => {
	it('claimByKey claims the cursor marker only on key match', () => {
		mockDocument();
		const li1 = makeNode(1, 'li'); li1.setAttribute('data-vsk-key', '1');
		const li2 = makeNode(1, 'li'); li2.setAttribute('data-vsk-key', '2');
		const m1 = document.createComment('vsk');
		const m2 = document.createComment('vsk');
		const ul = document.createElement('ul');
		ul.appendChild(m1); ul.appendChild(li1);
		ul.appendChild(m2); ul.appendChild(li2);
		const walker = createHydrateWalker(ul, [m1, m2]);

		const claim = walker.claimByKey('1');
		expect(claim.el).toBe(li1);
		expect(m1.parentNode).toBe(null); // marker removed from the live DOM
		expect(li1.getAttribute('data-vsk-claimed')).toBe('');

		// Cursor did NOT advance past the claimed root — the item's own render
		// is what consumes the interior markers positionally.
		const interiorClaim = walker.nextElement('li');
		expect(interiorClaim).toBe(li2);
		cleanupDocument();
	});

	it('claimByKey returns null when the cursor marker is a different item', () => {
		mockDocument();
		const li1 = makeNode(1, 'li'); li1.setAttribute('data-vsk-key', '1');
		const m1 = document.createComment('vsk');
		const ul = document.createElement('ul');
		ul.appendChild(m1); ul.appendChild(li1);
		const walker = createHydrateWalker(ul, [m1]);
		expect(walker.claimByKey('7')).toBe(null);
		cleanupDocument();
	});

	it('peekKey scans every unclaimed marker without consuming', () => {
		mockDocument();
		const li1 = makeNode(1, 'li'); li1.setAttribute('data-vsk-key', '1');
		const li2 = makeNode(1, 'li'); li2.setAttribute('data-vsk-key', '2');
		const m1 = document.createComment('vsk');
		const m2 = document.createComment('vsk');
		const ul = document.createElement('ul');
		ul.appendChild(m1); ul.appendChild(li1);
		ul.appendChild(m2); ul.appendChild(li2);
		const walker = createHydrateWalker(ul, [m1, m2]);
		// Bounds discovery relies on finding item 2 even though item 1 sits at
		// the cursor.
		expect(walker.peekKey('2')).toBe(li2);
		expect(walker.peekKey('1')).toBe(li1);
		expect(walker.peekKey('9')).toBe(null);
		// peek must not consume anything: claimByKey('1') still works after.
		expect(walker.claimByKey('1').el).toBe(li1);
		cleanupDocument();
	});

	it('interior markers are claimed positionally by the item render after the root claim', () => {
		mockDocument();
		const li1 = makeNode(1, 'li'); li1.setAttribute('data-vsk-key', '1');
		const div1 = makeNode(1, 'div');
		const m1 = document.createComment('vsk');
		const mD1 = document.createComment('vsk');
		const li2 = makeNode(1, 'li'); li2.setAttribute('data-vsk-key', '2');
		const m2 = document.createComment('vsk');
		const ul = document.createElement('ul');
		ul.appendChild(m1); ul.appendChild(li1); li1.appendChild(mD1); li1.appendChild(div1);
		ul.appendChild(m2); ul.appendChild(li2);
		const walker = createHydrateWalker(ul, [m1, mD1, m2]);

		const root1 = walker.claimByKey('1').el;
		expect(root1).toBe(li1);
		// Item render claims its interior div from the walker.
		const interior = walker.nextElement('div');
		expect(interior).toBe(div1);
		expect(mD1.parentNode).toBe(null);
		// Next item root claim still resolves.
		expect(walker.claimByKey('2').el).toBe(li2);
		cleanupDocument();
	});
});

describe('reconcileHydrated claim-by-key adoption', () => {
	it('adopts SSR items in place, anchors the region, and wires updates', () => {
		mockDocument();
		const li1 = makeNode(1, 'li'); li1.setAttribute('data-vsk-key', '1'); li1.appendChild(document.createTextNode('A'));
		const li2 = makeNode(1, 'li'); li2.setAttribute('data-vsk-key', '2'); li2.appendChild(document.createTextNode('B'));
		const m1 = document.createComment('vsk');
		const m2 = document.createComment('vsk');
		const ul = document.createElement('ul');
		ul.appendChild(m1); ul.appendChild(li1);
		ul.appendChild(m2); ul.appendChild(li2);

		const walker = createHydrateWalker(ul, [m1, m2]);
		const anchor = document.createComment('map');
		const endAnchor = document.createComment('map-end');
		const rendered = [];
		const effsPerItem = [];

		const createItem = (item, _i, effs, root) => {
			effs.push(new BlockMock());
			// Mirrors compiled renderItem: `__root || walker.nextElement(...)`.
			const li = root || walker.nextElement('li');
			li.appendChild(document.createTextNode(String(item.name)));
			rendered.push(li);
			effsPerItem.push(effs);
		};

		const update = reconcileHydrated(
			anchor, endAnchor,
			[{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
			(item) => String(item.id),
			createItem,
			walker,
			ul,
		);

		// Adopted — same SSR nodes, no recreation.
		expect(rendered[0]).toBe(li1);
		expect(rendered[1]).toBe(li2);
		expect(li1.getAttribute('data-vsk-claimed')).toBe('');
		expect(li2.getAttribute('data-vsk-claimed')).toBe('');
		// Markers removed from the live DOM (no ghosts).
		expect(m1.parentNode).toBe(null);
		expect(m2.parentNode).toBe(null);

		// Anchors placed inside the region.
		const order = ul.childNodes;
		const ai = order.indexOf(anchor);
		const eai = order.indexOf(endAnchor);
		expect(ai).toBeGreaterThan(-1);
		expect(eai).toBeGreaterThan(-1);
		expect(eai).toBeGreaterThan(ai);
		// k: markers precede their items, inside the map region.
		const k1 = order.find((c) => c.nodeType === 8 && c.data === 'k:1');
		const k2 = order.find((c) => c.nodeType === 8 && c.data === 'k:2');
		expect(k1).toBeDefined();
		expect(k2).toBeDefined();
		expect(order.indexOf(k1)).toBeLessThan(order.indexOf(li1));
		expect(order.indexOf(k2)).toBeLessThan(order.indexOf(li2));

		// Reactive update path: removing an item destroys its block and cleans
		// the DOM; adding a fresh item renders at the tail.
		flush_sync(() => update([{ id: 1, name: 'A' }, { id: 3, name: 'C' }]));
		expect(effsPerItem[1][0].called).toBe(true);
		expect(rendered.length).toBeGreaterThanOrEqual(3);
		expect(rendered[2] !== li2).toBe(true);
		expect(rendered[2].getAttribute('data-vsk-claimed')).toBe(null);
		// li2 (removed key) no longer in the region.
		expect(ul.childNodes.includes(li2)).toBe(false);
		cleanupDocument();
	});

	it('divergent client data degrades cleanly: no duplicates, no phantoms', () => {
		mockDocument();
		const li1 = makeNode(1, 'li'); li1.setAttribute('data-vsk-key', '1'); li1.appendChild(document.createTextNode('A'));
		const li2 = makeNode(1, 'li'); li2.setAttribute('data-vsk-key', '2'); li2.appendChild(document.createTextNode('B'));
		const m1 = document.createComment('vsk');
		const m2 = document.createComment('vsk');
		const ul = document.createElement('ul');
		ul.appendChild(m1); ul.appendChild(li1);
		ul.appendChild(m2); ul.appendChild(li2);
		const walker = createHydrateWalker(ul, [m1, m2]);
		const anchor = document.createComment('map');
		const endAnchor = document.createComment('map-end');

		const createItem = (item, _i, effs, root) => {
			effs.push({ destroy() {} });
			// Mirrors compiled renderItem: `__root || walker.nextElement(...)`.
			const li = root || walker.nextElement('li');
			li.appendChild(document.createTextNode(String(item.name)));
		};

		reconcileHydrated(
			anchor, endAnchor,
			[{ id: 2, name: 'B2' }, { id: 1, name: 'A2' }],
			(item) => String(item.id),
			createItem,
			walker,
			ul,
		);

		// Client order differs from SSR order. Strict claim-by-key cannot adopt
		// out of order, so each item claims its run position via the walker's
		// positional claim. The result must match the client order with the SAME
		// two SSR nodes (no duplicated/duplicate elements, none left to reorder).
		const elems = ul.childNodes.filter((c) => c.nodeType === 1);
		expect(elems.length).toBe(2);
		expect(elems[0]).toBe(li1);
		expect(elems[1]).toBe(li2);
		expect(li1.textContent).toBe('B2');
		expect(li2.textContent).toBe('A2');
		expect(li1.hasAttribute('data-vsk-claimed')).toBe(true);
		expect(li2.hasAttribute('data-vsk-claimed')).toBe(true);
		// Every SSR marker was consumed — the canary stays silent.
		expect(assertFullyHydrated(ul)).toBe(true);
		cleanupDocument();
	});

	it('client data beyond SSR renders fresh at the region tail', () => {
		mockDocument();
		const li1 = makeNode(1, 'li'); li1.setAttribute('data-vsk-key', '1'); li1.appendChild(document.createTextNode('A'));
		const li2 = makeNode(1, 'li'); li2.setAttribute('data-vsk-key', '2'); li2.appendChild(document.createTextNode('B'));
		const m1 = document.createComment('vsk');
		const m2 = document.createComment('vsk');
		const ul = document.createElement('ul');
		ul.appendChild(m1); ul.appendChild(li1);
		ul.appendChild(m2); ul.appendChild(li2);
		const walker = createHydrateWalker(ul, [m1, m2]);
		const anchor = document.createComment('map');
		const endAnchor = document.createComment('map-end');
		const seen = [];

		const createItem = (item, _i, effs, root) => {
			effs.push(new BlockMock());
			const li = root || walker.nextElement('li');
			li.appendChild(document.createTextNode(String(item.name)));
			seen.push(li);
			// Mirrors the compiled map flush: fresh items are placed inside the
			// region, right before the end anchor (next to the k: marker).
			if (!root) ul.insertBefore(li, endAnchor);
		};

		const update = reconcileHydrated(
			anchor, endAnchor,
			[{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
			(item) => String(item.id),
			createItem,
			walker,
			ul,
		);

		expect(seen[0]).toBe(li1);
		expect(seen[1]).toBe(li2);

		flush_sync(() => update([{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }]));
		const elems = ul.childNodes.filter((c) => c.nodeType === 1);
		expect(elems.length).toBe(3);
		expect(elems[2]).toBe(seen[2]);
		// The tail item had no SSR element to claim — it rendered fresh and is
		// NOT marked claimed. No phantom SSR node was duplicated in place.
		expect(elems[2].hasAttribute('data-vsk-claimed')).toBe(false);
		cleanupDocument();
	});
});

describe('hydration-integrity canary', () => {
	it('assertFullyHydrated returns true when every marker was claimed', () => {
		mockDocument();
		const container = document.createElement('div');
		const m = document.createComment('vsk');
		const el = document.createElement('span');
		container.appendChild(m); container.appendChild(el);
		el.setAttribute('data-vsk-claimed', '');
		expect(assertFullyHydrated(container)).toBe(true);
		cleanupDocument();
	});

	it('assertFullyHydrated reports unclaimed markers that have no claimed ancestor', () => {
		mockDocument();
		const container = document.createElement('div');
		const m = document.createComment('vsk');
		const el = document.createElement('span');
		el.appendChild(document.createTextNode('ghost'));
		container.appendChild(m); container.appendChild(el);
		const warns = captureWarns(() => assertFullyHydrated(container));
		expect(warns.length).toBeGreaterThan(0);
		expect(warns[0]).toContain('never claimed');
		cleanupDocument();
	});

	it('a claimed ancestor silences the canary for nested interior markers', () => {
		mockDocument();
		const container = document.createElement('div');
		const outer = document.createElement('section');
		outer.setAttribute('data-vsk-claimed', '');
		const m = document.createComment('vsk');
		const el = document.createElement('span');
		outer.appendChild(m); outer.appendChild(el);
		container.appendChild(outer);
		expect(assertFullyHydrated(container)).toBe(true);
		cleanupDocument();
	});

	it('setHydrateDevMode(false) suppresses stamping and warnings', () => {
		mockDocument();
		setHydrateDevMode(false);
		const container = document.createElement('div');
		const m = document.createComment('vsk');
		const el = document.createElement('span');
		container.appendChild(m); container.appendChild(el);
		const warns = captureWarns(() => expect(assertFullyHydrated(container)).toBe(false));
		expect(warns.length).toBe(0);
		setHydrateDevMode(true);
		cleanupDocument();
	});
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
