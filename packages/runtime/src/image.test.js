import { Image } from './image';

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
    toContain(expected) {
      if (!actual.includes(expected)) throw new Error(`Expected "${actual}" to contain "${expected}"`);
    },
    not: {
      toContain(expected) {
        if (actual.includes(expected)) throw new Error(`Expected "${actual}" not to contain "${expected}"`);
      },
    },
  };
}

describe('Image SSR', () => {
  it('renders img tag with src and alt', () => {
    const result = Image({ src: '/photo.jpg', alt: 'A photo' });
    expect(result).toContain('<img');
    expect(result).toContain('src="/photo.jpg"');
    expect(result).toContain('alt="A photo"');
  });

  it('includes lazy loading by default', () => {
    const result = Image({ src: '/photo.jpg', alt: 'x' });
    expect(result).toContain('loading="lazy"');
    expect(result).toContain('decoding="async"');
    expect(result).toContain('fetchpriority="auto"');
  });

  it('uses eager loading when priority is set', () => {
    const result = Image({ src: '/hero.jpg', alt: 'x', priority: true });
    expect(result).toContain('loading="eager"');
    expect(result).toContain('decoding="sync"');
    expect(result).toContain('fetchpriority="high"');
  });

  it('generates srcset with default widths', () => {
    const result = Image({ src: '/photo.jpg', alt: 'x' });
    expect(result).toContain('srcset="');
    expect(result).toContain('/photo-640w.jpg 640w');
    expect(result).toContain('/photo-1280w.jpg 1280w');
    expect(result).toContain('/photo-1536w.jpg 1536w');
  });

  it('uses custom widths when provided', () => {
    const result = Image({ src: '/img.png', alt: 'x', widths: [300, 600] });
    expect(result).toContain('/img-300w.png 300w');
    expect(result).toContain('/img-600w.png 600w');
    expect(result).not.toContain('/img-640w');
  });

  it('includes sizes attribute', () => {
    const result = Image({ src: '/a.jpg', alt: 'x', sizes: '(max-width: 768px) 100vw, 50vw' });
    expect(result).toContain('sizes="(max-width: 768px) 100vw, 50vw"');
  });

  it('sets width and height when provided', () => {
    const result = Image({ src: '/a.jpg', alt: 'x', width: 800, height: 600 });
    expect(result).toContain('width="800"');
    expect(result).toContain('height="600"');
    expect(result).toContain('<span style=');
  });

  it('includes custom class and style', () => {
    const result = Image({ src: '/a.jpg', alt: 'x', class: 'rounded', style: 'border:1px solid red' });
    expect(result).toContain('class="rounded"');
    expect(result).toContain('style="border:1px solid red"');
  });

  it('handles placeholder style', () => {
    const result = Image({ src: '/a.jpg', alt: 'x', width: 100, height: 100, placeholder: '#eee' });
    expect(result).toContain('background:#eee');
  });

  it('passes through additional attributes', () => {
    const result = Image({ src: '/a.jpg', alt: 'x', loading: 'lazy', fetchpriority: 'low' });
    expect(result).toContain('loading="lazy"');
    expect(result).toContain('fetchpriority="low"');
  });

  it('renders wrapper span with correct dimensions', () => {
    const result = Image({ src: '/a.jpg', alt: 'x', width: 400, height: 300 });
    expect(result).toContain('width:400px');
    expect(result).toContain('height:300px');
    expect(result).toContain('overflow:hidden');
  });
});

describe('Image with no extension', () => {
  it('generates srcset for extensionless URL', () => {
    const result = Image({ src: '/api/image/abc123', alt: 'x' });
    expect(result).toContain('/api/image/abc123-640w 640w');
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
