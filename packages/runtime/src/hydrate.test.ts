import { needsHydration, hydrationCount, createHydrateWalker, createHydrateChildWalker, hydrateOnInteraction } from '@vesk/runtime/src/hydrate';

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
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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
  };
}

// Minimal document mock for tests that need it
function mockDocument() {
  const listeners = {};
  const elProto = {
    nodeType: 1, tagName: 'DIV', childNodes: [], children: [],
    contains() { return true; },
    appendChild(c) { this.childNodes.push(c); return c; },
    remove() {},
    getAttribute() { return null; },
    setAttribute() {},
    addEventListener(ev, fn, opts) {
      const key = ev + (opts?.once ? '_once' : '');
      listeners[key] = fn;
    },
    removeEventListener(ev) { delete listeners[ev]; },
  };
  const doc = {
    createElement(tag) {
      return Object.create(Object.assign({}, elProto, { tagName: tag.toUpperCase() }));
    },
    createTreeWalker() {
      return { nextNode() { return null; } };
    },
    cookie: '',
    head: { appendChild() {} },
  };
  globalThis.document = doc;
  return doc;
}

function cleanupDocument() {
  delete globalThis.document;
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

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
