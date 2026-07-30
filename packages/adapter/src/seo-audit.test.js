import { runSeoAudit } from './seo-audit';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';

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
    toBeGreaterThan(expected) {
      if (actual <= expected) throw new Error(`Expected ${actual} > ${expected}`);
    },
    toBeGreaterThanOrEqual(expected) {
      if (actual < expected) throw new Error(`Expected ${actual} >= ${expected}`);
    },
    toBeLessThanOrEqual(expected) {
      if (actual > expected) throw new Error(`Expected ${actual} <= ${expected}`);
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
    },
  };
}

function tmpApp(subdir) {
  const dir = resolve(tmpdir(), 'vesk-test-' + subdir + '-' + Date.now());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writePage(dir, name, content, layout) {
  writeFileSync(resolve(dir, 'page.vsk'), content);
  if (layout) writeFileSync(resolve(dir, 'layout.vsk'), layout);
}

describe('SEO Audit', () => {
  it('reports missing title and h1', () => {
    const dir = tmpApp('seo-missing');
    writePage(dir, 'page', `<p>Hello</p>`);
    const result = runSeoAudit(dir);
    expect(result.errors).toBeGreaterThan(0);
    expect(result.warnings).toBeGreaterThanOrEqual(0);
  });

  it('passes clean page with title and h1', () => {
    const dir = tmpApp('seo-clean');
    writePage(dir, 'page', `
      <Head>
        <title>Test Page</title>
        <meta name="description" content="A test page" />
        <meta property="og:title" content="Test OG" />
        <meta property="og:description" content="OG desc" />
        <meta property="og:image" content="https://example.com/og.jpg" />
      </Head>
      <h1>Welcome</h1>
      <p>Content</p>
    `);
    const result = runSeoAudit(dir);
    expect(result.errors).toBe(0);
  });

  it('detects missing alt text on img', () => {
    const dir = tmpApp('seo-alt');
    writePage(dir, 'page', `
      <Head><title>Page</title></Head>
      <h1>Images</h1>
      <img src="/photo.jpg" />
    `);
    const result = runSeoAudit(dir);
    expect(result.errors).toBeGreaterThan(0);
  });

  it('passes when img has alt', () => {
    const dir = tmpApp('seo-alt-ok');
    writePage(dir, 'page', `
      <Head><title>Page</title></Head>
      <h1>Images</h1>
      <img src="/photo.jpg" alt="A photo" />
    `);
    const result = runSeoAudit(dir);
    expect(result.errors).toBe(0);
  });

  it('detects missing alt on Image component', () => {
    const dir = tmpApp('seo-image-alt');
    writePage(dir, 'page', `
      <Head><title>Page</title></Head>
      <h1>Images</h1>
      <Image src="/photo.jpg" />
    `);
    const result = runSeoAudit(dir);
    expect(result.errors).toBeGreaterThan(0);
  });

  it('passes when Image has alt', () => {
    const dir = tmpApp('seo-image-alt-ok');
    writePage(dir, 'page', `
      <Head><title>Page</title></Head>
      <h1>Images</h1>
      <Image src="/photo.jpg" alt="A photo" />
    `);
    const result = runSeoAudit(dir);
    expect(result.errors).toBe(0);
  });

  it('warns on multiple h1', () => {
    const dir = tmpApp('seo-multi-h1');
    writePage(dir, 'page', `
      <Head><title>Page</title></Head>
      <h1>First</h1>
      <h1>Second</h1>
    `);
    const result = runSeoAudit(dir);
    // Multiple h1 is a warning, not an error
    expect(result.errors).toBe(0);
    expect(result.warnings).toBeGreaterThan(0);
  });

  it('warns on heading order skip', () => {
    const dir = tmpApp('seo-heading-skip');
    writePage(dir, 'page', `
      <Head><title>Page</title></Head>
      <h1>Title</h1>
      <h3>Skip</h3>
    `);
    const result = runSeoAudit(dir);
    expect(result.warnings).toBeGreaterThan(0);
  });

  it('does not report viewport as missing (auto-inserted)', () => {
    const dir = tmpApp('seo-viewport');
    writePage(dir, 'page', `
      <Head><title>Page</title></Head>
      <h1>Test</h1>
    `);
    const result = runSeoAudit(dir);
    // Should NOT have viewport-related errors/warnings
    const output = [];
    const origLog = console.error;
    console.error = (...args) => output.push(args.join(' '));
    runSeoAudit(dir);
    console.error = origLog;
    expect(output.some(l => l.includes('viewport'))).toBe(false);
  });

  it('layout contributes head props so page is clean', () => {
    const dir = tmpApp('seo-layout-head');
    writePage(dir, 'page', `
      <h1>Page Content</h1>
    `, `
      <Head>
        <title>Layout Title</title>
        <meta name="description" content="From layout" />
      </Head>
      <div>{children}</div>
    `);
    const result = runSeoAudit(dir);
    // Title and description come from layout, page has h1 — should pass
    expect(result.errors).toBe(0);
  });

  it('reports missing OG tags', () => {
    const dir = tmpApp('seo-og-missing');
    writePage(dir, 'page', `
      <Head><title>Page</title></Head>
      <h1>Test</h1>
    `);
    const result = runSeoAudit(dir);
    // OG tags are warnings, not errors
    // With no layout and simple page, title exists but OG doesn't
    const output = [];
    const origLog = console.error;
    console.error = (...args) => output.push(args.join(' '));
    runSeoAudit(dir);
    console.error = origLog;
    expect(output.some(l => l.includes('og:title'))).toBe(true);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
