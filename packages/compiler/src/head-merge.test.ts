import { mergeHeadHtml } from '@vesk/compiler/src/server-codegen';

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

const expect = {
  that(actual) {
    return {
      toBe(expected) {
        if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      },
      toEqual(expected) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        }
      },
      toContain(sub) {
        if (!actual.includes(sub)) throw new Error(`Expected "${actual}" to contain "${sub}"`);
      },
      notToContain(sub) {
        if (actual.includes(sub)) throw new Error(`Expected "${actual}" not to contain "${sub}"`);
      },
    };
  },
};

describe('mergeHeadHtml', () => {
  it('merges layout head with no page head', () => {
    const result = mergeHeadHtml('', '<title>Layout Title</title>');
    expect.that(result.html).toContain('Layout Title');
    expect.that(result.conflicts.length).toBe(0);
  });

  it('merges page head with no layout head', () => {
    const result = mergeHeadHtml('<title>Page Title</title>', '');
    expect.that(result.html).toContain('Page Title');
    expect.that(result.conflicts.length).toBe(0);
  });

  it('page title overrides layout title', () => {
    const result = mergeHeadHtml('<title>Page Title</title>', '<title>Layout Title</title>');
    expect.that(result.html).toContain('Page Title');
    expect.that(result.html).notToContain('Layout Title');
    expect.that(result.conflicts.length).toBe(0);
  });

  it('page meta[name] overrides layout meta[name]', () => {
    const result = mergeHeadHtml(
      '<meta name="description" content="Page desc" />',
      '<meta name="description" content="Layout desc" />'
    );
    expect.that(result.html).toContain('Page desc');
    expect.that(result.html).notToContain('Layout desc');
  });

  it('page meta[property] overrides layout meta[property]', () => {
    const result = mergeHeadHtml(
      '<meta property="og:title" content="Page OG" />',
      '<meta property="og:title" content="Layout OG" />'
    );
    expect.that(result.html).toContain('Page OG');
    expect.that(result.html).notToContain('Layout OG');
  });

  it('warns on sibling conflict (two page tags with same key)', () => {
    const result = mergeHeadHtml(
      '<title>A</title><title>B</title>',
      ''
    );
    expect.that(result.conflicts.length).toBe(1);
    expect.that(result.conflicts[0].key).toBe('title');
  });

  it('layout and page entries combine without conflict for different keys', () => {
    const result = mergeHeadHtml(
      '<meta name="description" content="Page desc" />',
      '<title>Layout Title</title>'
    );
    expect.that(result.html).toContain('Layout Title');
    expect.that(result.html).toContain('Page desc');
    expect.that(result.conflicts.length).toBe(0);
  });

  it('orders tags: title, base, meta, link, script, style', () => {
    const result = mergeHeadHtml(
      '<link rel="stylesheet" href="/a.css" /><title>T</title>',
      '<meta name="x" content="y" /><base href="/" />'
    );
    const t = result.html;
    const titleIdx = t.indexOf('<title>');
    const baseIdx = t.indexOf('<base');
    const metaIdx = t.indexOf('<meta');
    const linkIdx = t.indexOf('<link');
    expect.that(titleIdx < baseIdx).toBe(true);
    expect.that(baseIdx < metaIdx).toBe(true);
    expect.that(metaIdx < linkIdx).toBe(true);
  });

  it('pages with no overlapping keys produce no conflicts', () => {
    const result = mergeHeadHtml(
      '<meta name="description" content="desc" />',
      '<title>Layout Title</title><meta charset="utf-8" />'
    );
    expect.that(result.conflicts.length).toBe(0);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
