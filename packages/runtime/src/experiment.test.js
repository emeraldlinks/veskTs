import { Experiment } from './experiment.js';

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
  const self = {
    toBe(expected) {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
    },
    toContain(expected) {
      if (!actual.includes(expected)) throw new Error(`Expected "${actual}" to contain "${expected}"`);
    },
    toBeDefined() {
      if (actual == null) throw new Error('Expected value to be defined');
    },
    toBeNull() {
      if (actual !== null) throw new Error(`Expected null, got ${typeof actual}`);
    },
    toBeGreaterThan(expected) {
      if (actual <= expected) throw new Error(`Expected ${actual} > ${expected}`);
    },
  };
  return self;
}

describe('Experiment SSR', () => {
  it('returns selected variant content', () => {
    const result = Experiment({
      name: 'test-exp',
      variants: [
        { name: 'a', content: 'Variant A', weight: 1 },
        { name: 'b', content: 'Variant B', weight: 1 },
      ],
    });
    expect(result).toBe('Variant A');
  });

  it('picks non-zero weight variant', () => {
    const result = Experiment({
      name: 'pick-b',
      variants: [
        { name: 'a', content: 'A', weight: 0.0001 },
        { name: 'b', content: 'B', weight: 9999 },
      ],
    });
    expect(result).toBe('B');
  });

  it('supports children prop as content', () => {
    const result = Experiment({
      name: 'exp-children',
      variants: [
        { name: 'a', children: '<div>A</div>', weight: 0.0001 },
        { name: 'b', children: '<div>B</div>', weight: 9999 },
      ],
    });
    expect(result).toBe('<div>B</div>');
  });

  it('returns default when no variants', () => {
    const result = Experiment({
      name: 'exp-default',
      variants: [],
      default: 'Fallback Content',
    });
    expect(result).toBe('Fallback Content');
  });

  it('returns null default when not provided and no variants', () => {
    const result = Experiment({
      name: 'exp-null',
      variants: [],
    });
    expect(result).toBeNull();
  });

  it('deterministic — same name always yields same variant', () => {
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(Experiment({
        name: 'deterministic-test',
        variants: [
          { name: 'a', content: 'A', weight: 1 },
          { name: 'b', content: 'B', weight: 1 },
        ],
      }));
    }
    for (const r of results) expect(r).toBe(results[0]);
  });
});

describe('Experiment client-side', () => {
  const setup = () => {
    globalThis.document = { cookie: '' };
    globalThis.sessionStorage = {
      _data: {},
      getItem(k) { return this._data[k] || null; },
      setItem(k, v) { this._data[k] = v; },
    };
    globalThis.window = {};
  };
  const teardown = () => {
    delete globalThis.document;
    delete globalThis.sessionStorage;
    delete globalThis.window;
  };

  it('assigns sticky cookie on first visit', () => {
    setup();
    globalThis.document.cookie = '';
    const result = Experiment({
      name: 'client-exp',
      variants: [
        { name: 'a', content: 'A', weight: 1 },
        { name: 'b', content: 'B', weight: 1 },
      ],
      sticky: true,
    });
    expect(globalThis.document.cookie).toContain('vsk_exp_client-exp=');
    expect(result).toBeDefined();
    teardown();
  });

  it('reads sticky cookie on subsequent render', () => {
    setup();
    globalThis.document.cookie = 'vsk_exp_client-sticky=someVariant';
    const result = Experiment({
      name: 'client-sticky',
      variants: [
        { name: 'someVariant', content: 'Stuck', weight: 0.0001 },
        { name: 'other', content: 'Other', weight: 9999 },
      ],
      sticky: true,
    });
    expect(result).toBe('Stuck');
    teardown();
  });

  it('tracks experiment data on window.__vsk_experiments', () => {
    setup();
    globalThis.window.__vsk_experiments = [];
    Experiment({
      name: 'tracking-exp',
      variants: [
        { name: 'a', content: 'A', weight: 1 },
      ],
      track: true,
    });
    expect(globalThis.window.__vsk_experiments.length).toBeGreaterThan(0);
    expect(globalThis.window.__vsk_experiments[0].experiment).toBe('tracking-exp');
    teardown();
  });

  it('does not track when track is false', () => {
    setup();
    globalThis.window.__vsk_experiments = [];
    Experiment({
      name: 'no-track',
      variants: [{ name: 'a', content: 'A', weight: 1 }],
      track: false,
    });
    expect(globalThis.window.__vsk_experiments.length).toBe(0);
    teardown();
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
