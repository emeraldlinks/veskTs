import { needsHydration, hydrationCount, createHydrateWalker, createHydrateChildWalker, hydrateOnInteraction, hydrateIdle, hydrate, assertFullyHydrated, auditHydration, setHydrateDevMode, setHydrateStrict, onHydrationMismatch, bumpNavEpoch, isVskMarkerText, parseVskMarker } from '@vesk/runtime/src/hydrate';
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
  node.replaceChild = (c, old) => { node.insertBefore(c, old); node.removeChild(old); return c; };
  node.remove = () => { if (node.parentNode) node.parentNode.removeChild(node); };
  node.contains = (other) => {
    for (let n = other; n; n = n.parentNode) if (n === node) return true;
    return false;
  };
  node.getAttribute = (k) => (node._attrs.has(k) ? node._attrs.get(k) : null);
  node.setAttribute = (k, v) => { node._attrs.set(k, String(v)); };
  node.hasAttribute = (k) => node._attrs.has(k);
  def('style', () => {
    const raw = node._attrs.get('style') || '';
    const style = {};
    for (const part of raw.split(';')) {
      const i = part.indexOf(':');
      if (i === -1) continue;
      style[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return style;
  });
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
    // No matching SSR element: back off without consuming the marker and
    // return a fresh, detached element rather than hunting (and destroying)
    // the siblings.
    expect(a.tagName).toBe('A');
    expect(a.parentNode).toBe(null);
    // The mismatched marker and SSR element stay intact for their real owner.
    expect(root.contains(m1)).toBe(true);
    expect(s1.textContent).toBe('one');
    expect(root.contains(m2)).toBe(true);
    expect(s2.textContent).toBe('two');
    // The next claim that genuinely wants that element adopts it in place.
    const claimed = walker.nextElement('span');
    expect(claimed).toBe(s1);
    expect(root.contains(m1)).toBe(false);
    cleanupDocument();
  });

  it('mismatched nested-layout claim no longer steals the page marker (store/widget empty h1)', () => {
    mockDocument();
    const root = document.createElement('div');
    const mH = document.createComment('vsk');
    const h1 = document.createElement('h1');
    h1.appendChild(document.createTextNode('Item: widget'));
    const mP = document.createComment('vsk');
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('id: 1'));
    root.appendChild(mH); root.appendChild(h1);
    root.appendChild(mP); root.appendChild(p);

    const walker = createHydrateWalker(root);
    // Layout header claim (conditional span): SSR rendered the FALSE branch so
    // no marker exists; this claim lands on the page h1's marker. It must NOT
    // consume it — the page h1 claim still owns it.
    const span = walker.nextElement('span');
    expect(span.tagName).toBe('SPAN');
    expect(span.parentNode).toBe(null);
    expect(root.contains(mH)).toBe(true);
    expect(h1.textContent).toBe('Item: widget');
    // Page h1 claim adopts the real SSR h1 in place (text remounted by the
    // compiled hydrator) instead of appending a stray duplicate to #root.
    const h1Claim = walker.nextElement('h1');
    expect(h1Claim).toBe(h1);
    expect(root.contains(mH)).toBe(false);
    const pClaim = walker.nextElement('p');
    expect(pClaim).toBe(p);
    // Every marker claimed: nothing left for the canary to flag.
    const leftover = (root.childNodes).filter((n) => n.nodeType === 8);
    expect(leftover.length).toBe(0);
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

  it('claims a plain JS component root on the shared walker (lucide SSR shape)', () => {
    mockDocument();
    const root = document.createElement('div');
    const m = document.createComment('vsk');
    const svg = document.createElement('header');
    svg.setAttribute('class', 'lucide lucide-menu');
    root.appendChild(m);
    root.appendChild(svg);

    const walker = createHydrateWalker(root);
    // Plain JS components emit no interior markers; the callsite's replacement
    // guard adopts the SSR root via claimOnly() and swaps the fresh node in.
    const fresh = document.createElement('nav');
    const sr = walker.claimOnly();
    expect(sr).toBe(svg);
    expect(svg.hasAttribute('data-vsk-claimed')).toBe(true);
    expect(svg.parentNode).toBe(root);
    root.replaceChild(fresh, sr);
    expect(root.contains(fresh)).toBe(true);
    expect(root.contains(svg)).toBe(false);
    const leftover = root.childNodes.filter((n) => n.nodeType === 8);
    expect(leftover.length).toBe(0);
    cleanupDocument();
  });

  it('claims sibling roots on the same shared walker after a plain JS component', () => {
    mockDocument();
    const root = document.createElement('div');
    const m1 = document.createComment('vsk');
    const a = document.createElement('div');
    const m2 = document.createComment('vsk');
    const b = document.createElement('div');
    root.appendChild(m1);
    root.appendChild(a);
    root.appendChild(m2);
    root.appendChild(b);

    const walker = createHydrateWalker(root);
    // First root taken by the plain component's claimOnly guard…
    expect(walker.claimOnly()).toBe(a);
    // …the next sibling component claims its own root positionally.
    expect(walker.claimOnly()).toBe(b);
    expect(root.childNodes.filter((n) => n.nodeType === 8).length).toBe(0);
    cleanupDocument();
  });

  it('fresh-creates when an empty boundary subWalker has nothing to claim', () => {
    mockDocument();
    const root = document.createElement('div');
    const mBox = document.createComment('vsk');
    const box = document.createElement('span');
    box.setAttribute('style', 'display:contents');
    root.appendChild(mBox);
    root.appendChild(box);

    const walker = createHydrateWalker(root);
    walker.nextElement();
    const sub = walker.subWalker(box);
    const el = sub.nextElement('section');
    expect(el.tagName).toBe('SECTION');
    expect(el.parentNode).toBe(null);
    cleanupDocument();
  });

  it('exhausted walker builds fresh nodes silently on post-hydration re-renders (no warn spam)', () => {
    mockDocument();
    const root = document.createElement('div');
    const m1 = document.createComment('vsk');
    const s1 = document.createElement('div');
    s1.setAttribute('data-vsk-claimed', '');
    root.appendChild(m1); root.appendChild(s1);

    const walker = createHydrateWalker(root, [m1]);
    // First claim consumes the only marker.
    const first = walker.nextElement('div');
    expect(first).toBe(s1);
    // SSR rendered the loop empty (shown=0) so there is nothing else to claim.
    const warns = captureWarns(() => {
      // Reactive re-render of the loop after hydration: exhausted walker must
      // fall back to fresh nodes silently, not warn on every interval tick.
      const a = walker.nextElement('div');
      const b = walker.nextElement('div');
      expect(a.tagName).toBe('DIV');
      expect(b.tagName).toBe('DIV');
    });
    expect(warns.length).toBe(0);
    cleanupDocument();
  });

  it('unconsumed-marker mismatch still warns in dev', () => {
    mockDocument();
    const root = document.createElement('div');
    const m1 = document.createComment('vsk');
    const s1 = document.createElement('div');
    root.appendChild(m1); root.appendChild(s1);

    const walker = createHydrateWalker(root);
    const warns = captureWarns(() => {
      // Claim wants a tag SSR never rendered while a marker still sits ahead.
      const el = walker.nextElement('span');
      expect(el.tagName).toBe('SPAN');
    });
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain('claim missed');
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

describe('SSR element residue capture (text/component ordering)', () => {
  it('adoptElement captures direct SSR element children on the claimed element', () => {
    mockDocument();
    const root = document.createElement('div');
    const mLbl = document.createComment('vsk');
    const label = document.createElement('span');
    label.appendChild(document.createTextNode('compiler-first framework \u00B7 '));
    const mW = document.createComment('vsk');
    const badge = document.createElement('span');
    badge.appendChild(document.createTextNode('v0.2.25'));
    label.appendChild(mW);
    label.appendChild(badge);
    root.appendChild(mLbl);
    root.appendChild(label);

    const walker = createHydrateWalker(root);
    const claim = walker.nextElement('span');
    expect(claim).toBe(label);
    // SSR text stripped, residue captured in DOM order.
    expect((label.childNodes).filter((n) => n.nodeType === 3).length).toBe(0);
    const residue = label.__vsk_ssrEls;
    expect(residue.length).toBe(1);
    expect(residue[0]).toBe(badge);
    // The codegen re-creates the text node and slots it BEFORE the residue.
    const freshText = document.createTextNode('compiler-first framework \u00B7 ');
    if (0 < residue.length) label.insertBefore(freshText, residue[0]); else label.appendChild(freshText);
    // Component claim keeps the residue root in place.
    const badgeClaim = walker.nextElement('span');
    expect(badgeClaim).toBe(badge);
    expect(badgeClaim.hasAttribute('data-vsk-claimed')).toBe(true);
    // Final order: text first, badge root second (the label-order bug).
    const kinds = (label.childNodes).map((n) => (n.nodeType === 3 ? 'T' : n.nodeType === 1 ? 'E' : 'C'));
    expect(kinds.join('')).toBe('TE');
    cleanupDocument();
  });

  it('interleaved text slots between multiple residues in source order', () => {
    mockDocument();
    const root = document.createElement('div');
    const mP = document.createComment('vsk');
    const p = document.createElement('p');
    p.appendChild(document.createTextNode('a '));
    const b = document.createElement('b');
    b.appendChild(document.createTextNode('bold'));
    p.appendChild(b);
    p.appendChild(document.createTextNode(' c '));
    const mW = document.createComment('vsk');
    const badge = document.createElement('span');
    badge.appendChild(document.createTextNode('v0.2.25'));
    p.appendChild(mW);
    p.appendChild(badge);
    p.appendChild(document.createTextNode(' d'));
    root.appendChild(mP);
    root.appendChild(p);

    const walker = createHydrateWalker(root);
    const claim = walker.nextElement('p');
    expect(claim).toBe(p);
    const residue = p.__vsk_ssrEls;
    expect(residue.length).toBe(2);
    expect(residue[0]).toBe(b);
    expect(residue[1]).toBe(badge);

    const kind = (n) => (n.nodeType === 3 ? 'T' : n.nodeType === 1 ? 'E' : 'C');
    const insert = (text, idx) => {
      const fresh = document.createTextNode(text);
      if (typeof idx === 'number' && idx < residue.length) p.insertBefore(fresh, residue[idx]); else p.appendChild(fresh);
    };
    insert('a ', 0);
    insert(' c ', 1);
    insert(' d', undefined);
    // Claiming the badge root consumes its preceding SSR marker.
    const badgeClaim2 = walker.nextElement('span');
    expect(badgeClaim2).toBe(badge);
    expect(p.childNodes.filter((n) => n.nodeType === 8).length).toBe(0);
    expect((p.childNodes).map(kind).join('')).toBe('TETET');
    expect((p.childNodes).filter((n) => n.nodeType === 3).map((n) => n.data).join('')).toBe('a  c  d');
    cleanupDocument();
  });

  it('createHydrateChildWalker captures residues when claiming wrapper children', () => {
    mockDocument();
    const parent = { children: [], childNodes: [] };
    const wrap = document.createElement('span');
    const inner = document.createElement('span');
    inner.appendChild(document.createTextNode('v0.2.25'));
    wrap.appendChild(inner);
    parent.children.push(wrap);

    const walker = createHydrateChildWalker(parent);
    const claimed = walker.nextElement('span');
    expect(claimed).toBe(wrap);
    expect(wrap.__vsk_ssrEls.length).toBe(1);
    expect(wrap.childNodes.filter((n) => n.nodeType === 3).length).toBe(0);
    cleanupDocument();
  });
});

describe('retireDetached sweeps wiped markers', () => {
  it('skips a detached marker so the next claim stays aligned', () => {
    mockDocument();
    const root = document.createElement('div');
    const m1 = document.createComment('vsk');
    const a = document.createElement('div');
    const m2 = document.createComment('vsk');
    const b = document.createElement('div');
    const m3 = document.createComment('vsk');
    const c = document.createElement('div');
    root.appendChild(m1); root.appendChild(a);
    root.appendChild(m2); root.appendChild(b);
    root.appendChild(m3); root.appendChild(c);

    const walker = createHydrateWalker(root);
    expect(walker.claimOnly()).toBe(a);

    // A wipe-style component (Link) removed my interior marker from the DOM.
    m2.remove();

    // Without the sweep this claim would adopt nothing and build fresh;
    // retireDetached lets the cursor skip the orphaned marker.
    walker.retireDetached();
    const claimedC = walker.claimOnly();
    expect(claimedC).toBe(c);
    expect(claimedC.hasAttribute('data-vsk-claimed')).toBe(true);
    expect(root.childNodes.filter((n) => n.nodeType === 8).length).toBe(0);
    cleanupDocument();
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

	it('insertBeforeNextClaim puts a region fence before the next unconsumed marker', () => {
		mockDocument();
		const header = makeNode(1, 'header');
		const flex = makeNode(1, 'div');
		const mH = document.createComment('vsk');
		const mF = document.createComment('vsk');
		const root = document.createElement('div');
		root.setAttribute('class', 'min-h-screen');
		root.appendChild(mH); root.appendChild(header);
		root.appendChild(mF); root.appendChild(flex);
		const walker = createHydrateWalker(root, [mH, mF]);

		// The DocsHeader claims `<header>`, then its `if (open)` region builds —
		// the cursor now points at the flex marker (the region's following
		// sibling in source order).
		expect(walker.nextElement('header')).toBe(header);
		const openAnchor = document.createComment('if');
		const openEnd = document.createComment('if-end');
		// Simulate the codegen order: anchor THEN end, nextElement non-consuming.
		expect(walker.insertBeforeNextClaim(openAnchor)).toBe(true);
		expect(walker.insertBeforeNextClaim(openEnd)).toBe(true);

		// Both fences sit immediately before the flex marker, NOT at root end.
		expect(mF.previousSibling).toBe(openEnd);
		expect(openEnd.previousSibling).toBe(openAnchor);
		expect(openAnchor.previousSibling).toBe(header);
		// Element children order stays header-then-flex (comments excluded).
		expect(Array.from(root.children).indexOf(flex)).toBe(1);

		// The marker must survive for its owner: the next sibling claim still adopts.
		expect(walker.nextElement('div')).toBe(flex);
		cleanupDocument();
	});

	it('insertBeforeNextClaim falls back to the root end when the walker is exhausted', () => {
		mockDocument();
		const root = document.createElement('div');
		const walker = createHydrateWalker(root, []);
		const a = document.createComment('if');
		const b = document.createComment('if-end');
		expect(walker.insertBeforeNextClaim(a)).toBe(true);
		expect(walker.insertBeforeNextClaim(b)).toBe(true);
		expect(root.firstChild).toBe(a);
		expect(root.lastChild).toBe(b);
		cleanupDocument();
	});

	it('insertBeforeNextClaim returns false when detached (no root, no markers)', () => {
		mockDocument();
		const walker = createHydrateWalker(null, []);
		expect(walker.insertBeforeNextClaim(document.createComment('if'))).toBe(false);
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

	it('double markers on the same element retire: a second claim never adopts a claimed node', () => {
		mockDocument();
		// Marker-only SSR can leave TWO `<!--vsk-->` marks before one element
		// (the call-site marker + the runtime callee's own root marker, e.g.
		// Link self-prefixes `<!--vsk-->`). The first claim adopts the element;
		// the dead alias must be retired WITHOUT re-adopting (double-adoption
		// strips SSR text a second time and desyncs every later claim).
		const a1 = makeNode(1, 'a');
		const a2 = makeNode(1, 'a');
		const mCall1 = document.createComment('vsk');
		const mLink1 = document.createComment('vsk');
		const mCall2 = document.createComment('vsk');
		const root = document.createElement('nav');
		root.appendChild(mCall1); root.appendChild(mLink1); root.appendChild(a1);
		root.appendChild(mCall2); root.appendChild(a2);
		const walker = createHydrateWalker(root, [mCall1, mLink1, mCall2]);

		// First link claims its anchor via the call-site marker.
		const first = walker.nextElement('a');
		expect(first).toBe(a1);
		expect(a1.getAttribute('data-vsk-claimed')).toBe('');
		// The callee's own marker still points at the SAME anchor: it must be
		// retired, not adopted again.
		const second = walker.nextElement('a');
		expect(second).toBe(a2);
		expect(a2.getAttribute('data-vsk-claimed')).toBe('');
		// Canary: the dead alias is gone (no unclaimed marker survives on a1).
		expect(mLink1.parentNode).toBe(null);
		cleanupDocument();
	});

	it('claimOnly also retires dead alias markers behind an adopted element', () => {
		mockDocument();
		const div1 = makeNode(1, 'div');
		const div2 = makeNode(1, 'div');
		const mCall = document.createComment('vsk');
		const mSelf = document.createComment('vsk');
		const mNext = document.createComment('vsk');
		const root = document.createElement('main');
		root.appendChild(mCall); root.appendChild(mSelf); root.appendChild(div1);
		root.appendChild(mNext); root.appendChild(div2);
		const walker = createHydrateWalker(root, [mCall, mSelf, mNext]);

		const claimed = walker.claimOnly('div');
		expect(claimed).toBe(div1);
		// Dead alias retired; next claim advances to the real sibling.
		expect(walker.claimOnly('div')).toBe(div2);
		cleanupDocument();
	});

	it('a trailing alias marker is swept so it never lingers in the DOM', () => {
		mockDocument();
		// Last link in a loop: its call-site marker is claimed, and its own
		// marker aliases the same anchor with no further claim to retire it.
		// The sweep after adoption must remove it immediately.
		const a = makeNode(1, 'a');
		const mCall = document.createComment('vsk');
		const mLink = document.createComment('vsk');
		const root = document.createElement('nav');
		root.appendChild(mCall); root.appendChild(mLink); root.appendChild(a);
		const walker = createHydrateWalker(root, [mCall, mLink]);

		expect(walker.nextElement('a')).toBe(a);
		expect(mCall.parentNode).toBe(null);
		expect(mLink.parentNode).toBe(null); // trailing alias swept, not left behind
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

		// Client order differs from SSR order. Relocate adopts each item by
		// key and moves it into client order with node identity preserved —
		// no content swapping, no fresh twins, no ghosts.
		const elems = ul.childNodes.filter((c) => c.nodeType === 1);
		expect(elems.length).toBe(2);
		expect(elems[0]).toBe(li2);
		expect(elems[1]).toBe(li1);
		expect(li2.textContent).toBe('B2');
		expect(li1.textContent).toBe('A2');
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

describe('A4: keyed relocate adopts out of order and moves into place', () => {
  it('claimByKey relocate moves a later item to the cursor, cursor still claims the rest', () => {
    mockDocument();
    const ul = document.createElement('ul');
    const m1 = document.createComment('vsk');
    const li1 = makeNode(1, 'li'); li1.setAttribute('data-vsk-key', '1'); li1.appendChild(document.createTextNode('A'));
    const m2 = document.createComment('vsk');
    const li2 = makeNode(1, 'li'); li2.setAttribute('data-vsk-key', '2'); li2.appendChild(document.createTextNode('B'));
    ul.appendChild(m1); ul.appendChild(li1);
    ul.appendChild(m2); ul.appendChild(li2);
    const walker = createHydrateWalker(ul, [m1, m2]);

    const moved = walker.claimByKey('2', { relocate: true });
    expect(moved.el).toBe(li2);
    // li2 now stands at the cursor (before m1's marker); li1 untouched.
    expect(ul.childNodes.indexOf(li2)).toBeLessThan(ul.childNodes.indexOf(m1));
    const mine = walker.claimByKey('1', { relocate: true });
    expect(mine.el).toBe(li1);
    expect(li1.getAttribute('data-vsk-claimed')).toBe('');
    expect(li2.getAttribute('data-vsk-claimed')).toBe('');
    expect(assertFullyHydrated(ul)).toBe(true);
    cleanupDocument();
  });

  it('relocate with a genuinely missing key returns null without moving anything', () => {
    mockDocument();
    const ul = document.createElement('ul');
    const m1 = document.createComment('vsk');
    const li1 = makeNode(1, 'li'); li1.setAttribute('data-vsk-key', '1');
    ul.appendChild(m1); ul.appendChild(li1);
    const before = ul.childNodes.slice();
    const walker = createHydrateWalker(ul, [m1]);
    expect(walker.claimByKey('9', { relocate: true })).toBe(null);
    expect(ul.childNodes.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) expect(ul.childNodes[i]).toBe(before[i]);
    cleanupDocument();
  });

  it('three-item reverse adopts all three in client order with zero fresh nodes', () => {
    mockDocument();
    const ul = document.createElement('ul');
    const lis = [];
    const ms = [];
    for (let k = 1; k <= 3; k++) {
      const m = document.createComment('vsk');
      const li = makeNode(1, 'li');
      li.setAttribute('data-vsk-key', String(k));
      li.appendChild(document.createTextNode('n' + k));
      ul.appendChild(m); ul.appendChild(li);
      ms.push(m); lis.push(li);
    }
    const walker = createHydrateWalker(ul, ms);
    const anchor = document.createComment('map');
    const endAnchor = document.createComment('map-end');
    const seen = [];
    const createItem = (item, _i, effs, root) => {
      effs.push(new BlockMock());
      const li = root || walker.nextElement('li');
      seen.push(li);
    };
    reconcileHydrated(
      anchor, endAnchor,
      [{ id: 3 }, { id: 2 }, { id: 1 }],
      (item) => String(item.id),
      createItem,
      walker,
      ul,
    );
    expect(seen.length).toBe(3);
    expect(seen[0]).toBe(lis[2]);
    expect(seen[1]).toBe(lis[1]);
    expect(seen[2]).toBe(lis[0]);
    const elems = ul.childNodes.filter((c) => c.nodeType === 1);
    expect(elems.length).toBe(3);
    expect(elems[0]).toBe(lis[2]);
    expect(elems[1]).toBe(lis[1]);
    expect(elems[2]).toBe(lis[0]);
    expect(assertFullyHydrated(ul)).toBe(true);
    cleanupDocument();
  });
});

describe('A5: SSR text stashed for snapshot init', () => {
  it('claim stashes concatenated direct text and still strips it', () => {
    mockDocument();
    const root = document.createElement('div');
    const m = document.createComment('vsk');
    const h1 = document.createElement('h1');
    h1.appendChild(document.createTextNode('Hel'));
    h1.appendChild(document.createTextNode('lo'));
    root.appendChild(m); root.appendChild(h1);
    const walker = createHydrateWalker(root, [m]);
    const el = walker.nextElement('h1');
    expect(el).toBe(h1);
    expect(h1.__vsk_ssrText).toBe('Hello');
    expect(h1.childNodes.length).toBe(0);
    cleanupDocument();
  });

  it('elements without direct text stash an empty snapshot', () => {
    mockDocument();
    const root = document.createElement('div');
    const m = document.createComment('vsk');
    const h1 = document.createElement('h1');
    const inner = document.createElement('span');
    h1.appendChild(inner);
    root.appendChild(m); root.appendChild(h1);
    const walker = createHydrateWalker(root, [m]);
    walker.nextElement('h1');
    expect(h1.__vsk_ssrText).toBe('');
    expect(h1.childNodes.length).toBe(1);
    cleanupDocument();
  });
});

describe('B1: typed marker identity pinpoints divergence', () => {
  it('isVskMarkerText accepts bare and typed markers only', () => {
    expect(isVskMarkerText('vsk')).toBe(true);
    expect(isVskMarkerText('vsk:c:StoreItem')).toBe(true);
    expect(isVskMarkerText('vsk:t:div')).toBe(true);
    expect(isVskMarkerText('vsk:')).toBe(true);
    expect(isVskMarkerText('vesk-ssr-error')).toBe(false);
    expect(isVskMarkerText('vsk-hold')).toBe(false);
    expect(isVskMarkerText('')).toBe(false);
    expect(isVskMarkerText(null)).toBe(false);
    expect(isVskMarkerText(undefined)).toBe(false);
  });

  it('parseVskMarker extracts identity or null', () => {
    expect(parseVskMarker('vsk').identity).toBe(null);
    expect(parseVskMarker('vsk:c:StoreItem').identity).toBe('c:StoreItem');
    expect(parseVskMarker('nope')).toBe(null);
  });

  it('typed component markers are collected and adopted like bare ones', () => {
    mockDocument();
    const root = document.createElement('div');
    const m = document.createComment('vsk:c:Helper');
    const box = document.createElement('div');
    root.appendChild(m); root.appendChild(box);
    expect(needsHydration(root)).toBe(true);
    expect(hydrationCount(root)).toBe(1);
    const walker = createHydrateWalker(root);
    expect(walker.nextElement('div')).toBe(box);
    expect(box.getAttribute('data-vsk-claimed')).toBe('');
    expect(assertFullyHydrated(root)).toBe(true);
    cleanupDocument();
  });

  it('backoff names the skipped typed marker; audit names the orphan', () => {
    mockDocument();
    const seen = [];
    onHydrationMismatch((issue) => seen.push(issue));
    const root = document.createElement('div');
    const m = document.createComment('vsk:c:StoreItem');
    const h1 = document.createElement('h1');
    root.appendChild(m); root.appendChild(h1);
    const walker = createHydrateWalker(root);
    captureWarns(() => { walker.nextElement('span'); });
    expect(seen.some((i) => i.detail.includes('vsk:c:StoreItem'))).toBe(true);
    const report = auditHydration(root);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.detail.includes('vsk:c:StoreItem'))).toBe(true);
    onHydrationMismatch(null);
    cleanupDocument();
  });
});

describe('B1b: element-less component site markers retire (guard clause)', () => {
  it('a bare-return component marker no longer forces the next claim to fresh fallback', () => {
    mockDocument();
    const root = document.createElement('div');
    const rootP = document.createElement('p'); rootP.className = 'guarded-hidden';
    rootP.appendChild(document.createComment('vsk:c:GuardBadge'));
    rootP.appendChild(document.createTextNode('  '));
    const rootPMarker = document.createComment('vsk:t:p');
    const shownP = document.createElement('p'); shownP.className = 'guarded-shown';
    shownP.appendChild(document.createComment('vsk:c:GuardBadge'));
    shownP.appendChild(document.createComment('vsk:t:span'));
    const badge = document.createElement('span'); badge.className = 'badge-shown';
    badge.appendChild(document.createTextNode('v0.2.33'));
    shownP.appendChild(badge);
    const shownPMarker = document.createComment('vsk:t:p');
    root.appendChild(rootPMarker); root.appendChild(rootP);
    root.appendChild(shownPMarker); root.appendChild(shownP);

    const walker = createHydrateWalker(root);
    const warns = captureWarns(() => {
      const first = walker.nextElement('p');
      expect(first.className).toBe('guarded-hidden');
      const second = walker.nextElement('p');
      // The element-less `<!--vsk:c:GuardBadge-->` at the cursor must be
      // retired so the SECOND p claim lands on the real `.guarded-shown`.
      expect(second).toBe(shownP);
      const badgeClaim = walker.nextElement('span');
      expect(badgeClaim).toBe(badge);
    });
    // The bare-return site marker must be physically gone from the DOM.
    const leftover = [];
    const scan = (n) => { for (const c of n.childNodes) { if (c.nodeType === 8) leftover.push(c); else scan(c); } };
    scan(root);
    expect(leftover.length).toBe(0);
    expect(warns.filter((w) => /mismatch|miss/.test(w))).toEqual([]);
    expect(assertFullyHydrated(root)).toBe(true);
    cleanupDocument();
  });

  it('claimOnly retires an element-less component marker before a static claim', () => {
    mockDocument();
    const root = document.createElement('div');
    const rootP = document.createElement('p'); rootP.className = 'guarded-hidden';
    rootP.appendChild(document.createComment('vsk:c:GuardBadge'));
    rootP.appendChild(document.createTextNode('  '));
    const rootPMarker = document.createComment('vsk:t:p');
    const shownP = document.createElement('p'); shownP.className = 'guarded-shown';
    shownP.appendChild(document.createComment('vsk:c:GuardBadge'));
    shownP.appendChild(document.createComment('vsk:t:span'));
    const badge = document.createElement('span'); badge.className = 'badge-shown';
    badge.appendChild(document.createTextNode('v0.2.33'));
    shownP.appendChild(badge);
    const shownPMarker = document.createComment('vsk:t:p');
    root.appendChild(rootPMarker); root.appendChild(rootP);
    root.appendChild(shownPMarker); root.appendChild(shownP);

    const walker = createHydrateWalker(root);
    const warns = captureWarns(() => {
      walker.nextElement('p');
      const second = walker.claimOnly('p');
      expect(second).toBe(shownP);
      expect(walker.nextElement('span')).toBe(badge);
    });
    const leftover = [];
    const scan = (n) => { for (const c of n.childNodes) { if (c.nodeType === 8) leftover.push(c); else scan(c); } };
    scan(root);
    expect(leftover.length).toBe(0);
    expect(warns.filter((w) => /mismatch|miss/.test(w))).toEqual([]);
    expect(assertFullyHydrated(root)).toBe(true);
    cleanupDocument();
  });
});

describe('C1: in-element region nodes never disappear (icon swap)', () => {
  it('an in-element region claims its SSR node through the shared walker and re-renders stay inside the element', () => {
    mockDocument();
    const root = document.createElement('div');
    const btnMarker = document.createComment('vsk:t:button');
    const btn = document.createElement('button'); btn.setAttribute('id', 'icon-btn');
    // The icon region lives INSIDE the button: its SSR marker and element sit
    // between the button's own tags, so the shared walker must claim them in
    // place — never fall back to the page root (the "disappearing icon" bug).
    const iconMarker = document.createComment('vsk:if');
    const icon = document.createElement('em'); icon.className = 'icon-x';
    icon.appendChild(document.createTextNode('X'));
    btn.appendChild(iconMarker);
    btn.appendChild(icon);
    root.appendChild(btnMarker);
    root.appendChild(btn);

    const walker = createHydrateWalker(root);
    const warns = captureWarns(() => {
      expect(walker.nextElement('button')).toBe(btn);

      // Emitted icon region: claim the SSR icon via the SHARED walker (its
      // marker is inside the button) and swap in the client-side node.
      const sr = walker.claimOnly();
      expect(sr).toBe(icon);
      const clientIcon = document.createElement('em'); clientIcon.className = 'icon-y';
      clientIcon.appendChild(document.createTextNode('Y'));
      sr.parentNode.replaceChild(clientIcon, sr);

      // The client icon must live INSIDE the claimed button, never appended to
      // the page root's end.
      expect(btn.contains(clientIcon)).toBe(true);
      expect(btn.childNodes.length).toBe(1);
      expect(btn.firstChild).toBe(clientIcon);
      expect(root.childNodes.length).toBe(1);
      expect(root.firstChild).toBe(btn);
    });

    const clientIcon2 = document.createElement('em'); clientIcon2.className = 'icon-z';
    clientIcon2.appendChild(document.createTextNode('Z'));
    let n = btn.firstChild;
    while (n) {
      const next = n.nextSibling;
      if (n.nodeType === 1) btn.removeChild(n);
      n = next;
    }
    btn.insertBefore(clientIcon2, iconMarker.nextSibling);

    // A re-render must also stay in the element and never escape to the root.
    expect(btn.contains(clientIcon2)).toBe(true);
    expect(root.childNodes.length).toBe(1);
    expect(root.firstChild).toBe(btn);
    expect(warns.filter((w) => /mismatch|miss/.test(w))).toEqual([]);
    expect(assertFullyHydrated(root)).toBe(true);
    cleanupDocument();
  });

  it('a following region anchors at its SSR slot once earlier regions are claimed, not at an earlier element', () => {
    mockDocument();
    const root = document.createElement('div');
    const btnMarker = document.createComment('vsk:t:button');
    const btn = document.createElement('button'); btn.setAttribute('id', 'icon-btn');
    const iconMarker = document.createComment('vsk:if');
    const icon = document.createElement('em'); icon.className = 'icon-x';
    icon.appendChild(document.createTextNode('X'));
    btn.appendChild(iconMarker);
    btn.appendChild(icon);
    // The panel region's OWN slot: after the button, at the page level.
    const panelIf = document.createComment('vsk:if');
    const p = document.createElement('p'); p.className = 'panel';
    p.appendChild(document.createTextNode('menu'));
    const panelIfEnd = document.createComment('vsk:if-end');
    root.appendChild(btnMarker);
    root.appendChild(btn);
    root.appendChild(panelIf);
    root.appendChild(p);
    root.appendChild(panelIfEnd);

    const walker = createHydrateWalker(root);
    expect(walker.nextElement('button')).toBe(btn);
    // In emitted order the icon region runs first and consumes its marker…
    const sr = walker.claimOnly();
    expect(sr).toBe(icon);

    // …so when the panel region anchors at the walker's slot it must land in
    // ITS position (page level, immediately before the panel's own SSR `vsk:if`
    // marker) — never back inside the button at the icon's position.
    const start = document.createComment('if');
    const end = document.createComment('if-end');
    expect(walker.insertBeforeNextClaim(start)).toBe(true);
    expect(walker.insertBeforeNextClaim(end)).toBe(true);
    expect(start.parentNode).toBe(root);
    expect(start.nextSibling).toBe(end);
    expect(end.nextSibling).toBe(panelIf);
    expect(p.parentNode).toBe(root);
    expect(panelIf.parentNode).toBe(root);
    expect(btn.childNodes.length).toBe(1);
    cleanupDocument();
  });
});

describe('B3: subWalker transfers ownership (no shared refs, no cursor drift)', () => {
  it('split splices owned markers out; parent and child claim independently', () => {
    mockDocument();
    const root = document.createElement('div');
    const mOut = document.createComment('vsk');
    const outEl = document.createElement('p');
    const section = document.createElement('section');
    const mIn = document.createComment('vsk');
    const inEl = document.createElement('span');
    section.appendChild(mIn); section.appendChild(inEl);
    root.appendChild(mOut); root.appendChild(outEl); root.appendChild(section);
    const walker = createHydrateWalker(root);
    const sub = walker.subWalker(section);
    // Child owns exactly the interior marker.
    expect(sub.done()).toBe(false);
    expect(sub.nextElement('span')).toBe(inEl);
    expect(sub.done()).toBe(true);
    // Parent still owns the outer marker and claims it after the split.
    expect(walker.done()).toBe(false);
    expect(walker.nextElement('p')).toBe(outEl);
    expect(walker.done()).toBe(true);
    expect(assertFullyHydrated(root)).toBe(true);
    cleanupDocument();
  });

  it('consuming in the child never disturbs the parent cursor', () => {
    mockDocument();
    const root = document.createElement('div');
    const m1 = document.createComment('vsk');
    const e1 = document.createElement('div');
    const section = document.createElement('section');
    const m2 = document.createComment('vsk');
    const e2 = document.createElement('em');
    section.appendChild(m2); section.appendChild(e2);
    root.appendChild(m1); root.appendChild(e1); root.appendChild(section);
    const walker = createHydrateWalker(root);
    expect(walker.nextElement('div')).toBe(e1);
    const sub = walker.subWalker(section);
    expect(sub.nextElement('em')).toBe(e2);
    expect(walker.done()).toBe(true);
    expect(assertFullyHydrated(root)).toBe(true);
    cleanupDocument();
  });
});

describe('keyed markers: skew and untyped adoption are reported, never silent', () => {
  it('t:tag marker preceding a different tag reports marker-skew and still adopts', () => {
    mockDocument();
    const seen = [];
    onHydrationMismatch((issue) => seen.push(issue));
    const root = document.createElement('div');
    const m = document.createComment('vsk:t:div');
    const span = document.createElement('span');
    root.appendChild(m); root.appendChild(span);
    const walker = createHydrateWalker(root);
    const warns = captureWarns(() => {
      expect(walker.nextElement('span')).toBe(span);
    });
    expect(seen.some((i) => i.kind === 'marker-skew' && i.detail.includes('vsk:t:div'))).toBe(true);
    expect(warns.some((w) => w.includes('marker-skew'))).toBe(true);
    onHydrationMismatch(null);
    cleanupDocument();
  });

  it('bare marker adoption reports untyped-marker', () => {
    mockDocument();
    const seen = [];
    onHydrationMismatch((issue) => seen.push(issue));
    const root = document.createElement('div');
    const m = document.createComment('vsk');
    const div = document.createElement('div');
    root.appendChild(m); root.appendChild(div);
    const walker = createHydrateWalker(root);
    captureWarns(() => {
      expect(walker.nextElement('div')).toBe(div);
    });
    expect(seen.some((i) => i.kind === 'untyped-marker')).toBe(true);
    onHydrationMismatch(null);
    cleanupDocument();
  });

  it('audit flags bare leftover markers as untyped', () => {
    mockDocument();
    const container = document.createElement('div');
    container.appendChild(document.createComment('vsk'));
    container.appendChild(document.createElement('section'));
    const report = auditHydration(container);
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.detail.includes('untyped'))).toBe(true);
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

describe('A1: mismatch telemetry + strict audit (NO DUPLICATION, NO MISMATCH)', () => {
  it('tag-mismatch miss notifies the hook once and keeps the single dev warn', () => {
    mockDocument();
    const seen = [];
    onHydrationMismatch((issue) => seen.push(issue));
    const root = document.createElement('div');
    const m1 = document.createComment('vsk');
    const s1 = document.createElement('div');
    root.appendChild(m1); root.appendChild(s1);
    const walker = createHydrateWalker(root);
    const warns = captureWarns(() => {
      const el = walker.nextElement('span');
      expect(el.tagName).toBe('SPAN');
    });
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain('claim missed');
    // Two telemetry events: the silent backoff (names the skipped marker)
    // plus the fallback that built the fresh node.
    expect(seen.length).toBe(2);
    expect(seen[0].kind).toBe('tag-mismatch');
    expect(seen[1].kind).toBe('tag-mismatch');
    onHydrationMismatch(null);
    cleanupDocument();
  });

  it('exhausted fallback notifies the hook as exhausted and stays console-silent', () => {
    mockDocument();
    const seen = [];
    onHydrationMismatch((issue) => seen.push(issue));
    const walker = createHydrateWalker(null, []);
    const warns = captureWarns(() => {
      const el = walker.nextElement('div');
      expect(el.tagName).toBe('DIV');
    });
    expect(warns.length).toBe(0);
    expect(seen.length).toBe(1);
    expect(seen[0].kind).toBe('exhausted');
    onHydrationMismatch(null);
    cleanupDocument();
  });

  it('auditHydration returns a structured report for orphans', () => {
    mockDocument();
    const container = document.createElement('div');
    const m = document.createComment('vsk');
    const el = document.createElement('span');
    el.appendChild(document.createTextNode('ghost'));
    container.appendChild(m); container.appendChild(el);
    const report = auditHydration(container);
    expect(report.ok).toBe(false);
    expect(report.unclaimed).toBe(1);
    expect(report.twins).toBe(0);
    expect(report.issues.some((i) => i.kind === 'leftover-marker')).toBe(true);
    // Non-strict: report without touching the DOM.
    expect(container.childNodes.length).toBe(2);
    cleanupDocument();
  });

  it('strict audit removes genuine orphans; second audit is clean', () => {
    mockDocument();
    setHydrateStrict(true);
    const container = document.createElement('div');
    const m = document.createComment('vsk');
    const el = document.createElement('span');
    el.appendChild(document.createTextNode('ghost'));
    container.appendChild(m); container.appendChild(el);
    const first = auditHydration(container);
    expect(first.ok).toBe(false);
    expect(first.unclaimed).toBe(1);
    expect(container.childNodes.length).toBe(0);
    const second = auditHydration(container);
    expect(second.ok).toBe(true);
    expect(second.unclaimed).toBe(0);
    setHydrateStrict(false);
    cleanupDocument();
  });

  it('twin scan flags an adopted node beside an identical unadopted twin', () => {
    mockDocument();
    const container = document.createElement('div');
    const adopted = document.createElement('div');
    adopted.setAttribute('data-vsk-claimed', '');
    adopted.appendChild(document.createTextNode('same'));
    const twin = document.createElement('div');
    twin.appendChild(document.createTextNode('same'));
    container.appendChild(adopted); container.appendChild(twin);
    const report = auditHydration(container);
    expect(report.twins).toBe(1);
    expect(report.issues.some((i) => i.kind === 'twin')).toBe(true);
    expect(report.ok).toBe(false);
    cleanupDocument();
  });

  it('twin scan ignores identical static siblings that are both unclaimed', () => {
    mockDocument();
    const container = document.createElement('div');
    for (let i = 0; i < 2; i++) {
      const s = document.createElement('div');
      s.appendChild(document.createTextNode('same'));
      container.appendChild(s);
    }
    const report = auditHydration(container);
    expect(report.twins).toBe(0);
    cleanupDocument();
  });

  it('key reorder (key present later) reports key-reorder; absent key stays silent', () => {
    mockDocument();
    const seen = [];
    onHydrationMismatch((issue) => seen.push(issue));
    const root = document.createElement('div');
    const m1 = document.createComment('vsk');
    const e1 = document.createElement('div');
    e1.setAttribute('data-vsk-key', '2');
    const m2 = document.createComment('vsk');
    const e2 = document.createElement('div');
    e2.setAttribute('data-vsk-key', '1');
    root.appendChild(m1); root.appendChild(e1);
    root.appendChild(m2); root.appendChild(e2);
    const walker = createHydrateWalker(root);
    expect(walker.claimByKey('1')).toBe(null);
    expect(seen.length).toBe(1);
    expect(seen[0].kind).toBe('key-reorder');
    expect(walker.claimByKey('9')).toBe(null);
    expect(seen.length).toBe(1);
    onHydrationMismatch(null);
    cleanupDocument();
  });
});

describe('A3: deferred hydration never hydrates a dead page', () => {
  function mockWindow() {
    const timers = [];
    globalThis.window = {
      innerHeight: 800,
      addEventListener() {},
      removeEventListener() {},
    };
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn) => { timers.push(fn); return timers.length; });
    return {
      timers,
      drain() { while (timers.length > 0) timers.shift()(); },
      restore() {
        globalThis.setTimeout = realSetTimeout;
        delete globalThis.window;
      },
    };
  }

  function connectedContainer() {
    const container = document.createElement('div');
    container.parentNode = { isConnected: true };
    return container;
  }

  it('hydrateIdle skips every chunk when the container is detached', () => {
    mockDocument();
    const w = mockWindow();
    try {
      let runs = 0;
      const container = document.createElement('div');
      // Detached by construction: parentNode null → isConnected false.
      const m = document.createComment('vsk');
      const el = document.createElement('div');
      container.appendChild(m); container.appendChild(el);
      hydrateIdle(container, () => { runs++; }, {}, { chunkSize: 1, timeout: 1 });
      w.drain();
      expect(runs).toBe(0);
    } finally {
      w.restore();
    }
    cleanupDocument();
  });

  it('hydrateIdle runs once on idle; a navigation before fire cancels the run', () => {
    mockDocument();
    const w = mockWindow();
    try {
      let runs = 0;
      const container = connectedContainer();
      for (let i = 0; i < 3; i++) {
        container.appendChild(document.createComment('vsk'));
        container.appendChild(document.createElement('div'));
      }
      hydrateIdle(container, () => { runs++; }, {}, { timeout: 100000 });
      bumpNavEpoch();
      w.drain();
      expect(runs).toBe(0);
    } finally {
      w.restore();
    }
    cleanupDocument();
  });

  it('B2: hydrateIdle runs exactly once no matter how many idle windows fire', () => {
    mockDocument();
    const w = mockWindow();
    try {
      let runs = 0;
      const container = connectedContainer();
      for (let i = 0; i < 5; i++) {
        container.appendChild(document.createComment('vsk'));
        container.appendChild(document.createElement('div'));
      }
      hydrateIdle(container, () => { runs++; }, {}, { timeout: 100000 });
      w.drain();
      w.drain();
      expect(runs).toBe(1);
    } finally {
      w.restore();
    }
    cleanupDocument();
  });

  it('hydrateIdle cancel() prevents the pending run', () => {
    mockDocument();
    const w = mockWindow();
    try {
      let runs = 0;
      const container = connectedContainer();
      container.appendChild(document.createComment('vsk'));
      const handle = hydrateIdle(container, () => { runs++; }, {}, { timeout: 100000 });
      handle.cancel();
      w.drain();
      expect(runs).toBe(0);
    } finally {
      w.restore();
    }
    cleanupDocument();
  });

  it('hydrateOnInteraction trigger stands down after navigation', () => {
    mockDocument();
    let runs = 0;
    const listeners = {};
    const container = connectedContainer();
    container.addEventListener = (ev, fn) => { listeners[ev] = fn; };
    container.removeEventListener = (ev) => { delete listeners[ev]; };
    container.appendChild(document.createComment('vsk'));
    hydrateOnInteraction(container, () => { runs++; }, {});
    bumpNavEpoch();
    listeners.click({ type: 'click' });
    expect(runs).toBe(0);
    cleanupDocument();
  });

  it('custom isCurrent gate overrides the epoch compare', () => {
    mockDocument();
    const listeners = {};
    const c2 = connectedContainer();
    c2.addEventListener = (ev, fn) => { listeners[ev] = fn; };
    c2.removeEventListener = (ev) => { delete listeners[ev]; };
    c2.appendChild(document.createComment('vsk'));
    let runs2 = 0;
    hydrateOnInteraction(c2, () => { runs2++; }, {}, { isCurrent: () => true });
    bumpNavEpoch();
    listeners.click({ type: 'click' });
    expect(runs2).toBe(1);

    const listenersB = {};
    const c3 = connectedContainer();
    c3.addEventListener = (ev, fn) => { listenersB[ev] = fn; };
    c3.removeEventListener = (ev) => { delete listenersB[ev]; };
    c3.appendChild(document.createComment('vsk'));
    let runs3 = 0;
    hydrateOnInteraction(c3, () => { runs3++; }, {}, { isCurrent: () => false });
    listenersB.click({ type: 'click' });
    expect(runs3).toBe(0);
    cleanupDocument();
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
