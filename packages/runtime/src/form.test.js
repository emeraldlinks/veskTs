import { Form, Field, required, email, minLength, maxLength, pattern, custom } from './form';

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
    toContain(sub) {
      if (!actual.includes(sub)) throw new Error(`Expected "${actual}" to contain "${sub}"`);
    },
    notToContain(sub) {
      if (typeof actual === 'string' && actual.includes(sub)) throw new Error(`Expected "${actual}" not to contain "${sub}"`);
    },
    toEqual(expected) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
  };
}

describe('Validation helpers', () => {
  it('required passes for non-empty value', () => {
    const r = required();
    expect(r.validate('hello')).toBe(true);
  });

  it('required fails for empty string', () => {
    const r = required();
    expect(r.validate('')).toBe(false);
  });

  it('required fails for null', () => {
    const r = required();
    expect(r.validate(null)).toBe(false);
  });

  it('required fails for undefined', () => {
    const r = required();
    expect(r.validate(undefined)).toBe(false);
  });

  it('required uses custom message', () => {
    const r = required('Fill this in');
    expect(r.message).toBe('Fill this in');
  });

  it('email passes valid email', () => {
    const r = email();
    expect(r.validate('test@example.com')).toBe(true);
  });

  it('email fails invalid email', () => {
    const r = email();
    expect(r.validate('not-an-email')).toBe(false);
  });

  it('email passes empty string (optional)', () => {
    const r = email();
    expect(r.validate('')).toBe(true);
  });

  it('minLength passes long enough', () => {
    const r = minLength(3);
    expect(r.validate('abc')).toBe(true);
    expect(r.validate('abcd')).toBe(true);
  });

  it('minLength fails too short', () => {
    const r = minLength(3);
    expect(r.validate('ab')).toBe(false);
  });

  it('maxLength passes short enough', () => {
    const r = maxLength(5);
    expect(r.validate('hello')).toBe(true);
  });

  it('maxLength fails too long', () => {
    const r = maxLength(5);
    expect(r.validate('hello!')).toBe(false);
  });

  it('pattern matches regex', () => {
    const r = pattern(/^[A-Z]+$/);
    expect(r.validate('ABC')).toBe(true);
    expect(r.validate('abc')).toBe(false);
  });

  it('pattern passes empty value', () => {
    const r = pattern(/^\d+$/);
    expect(r.validate('')).toBe(true);
  });

  it('custom validator works', () => {
    const r = custom((v) => v === 'secret', 'Wrong!');
    expect(r.validate('secret')).toBe(true);
    expect(r.validate('other')).toBe(false);
    expect(r.message).toBe('Wrong!');
  });
});

describe('Field SSR', () => {
  it('renders wrapper div with data-vsk-field', () => {
    const html = Field({ name: 'email', children: '<input name="email" />' });
    expect(html).toContain('data-vsk-field="email"');
  });

  it('renders label when provided', () => {
    const html = Field({ name: 'name', label: 'Your Name', children: '<input />' });
    expect(html).toContain('<label>Your Name</label>');
  });

  it('renders error placeholder hidden', () => {
    const html = Field({ name: 'x', children: '<input />' });
    expect(html).toContain('data-vsk-error');
    expect(html).toContain('display:none');
  });

  it('renders children inside', () => {
    const html = Field({ name: 'x', children: '<input type="text" />' });
    expect(html).toContain('<input type="text" />');
  });

  it('applies error class to error div', () => {
    const html = Field({ name: 'x', children: '', errorClass: 'text-red-500' });
    expect(html).toContain('class="text-red-500"');
  });

  it('passes through extra attributes', () => {
    const html = Field({ name: 'x', children: '', 'data-custom': 'val' });
    expect(html).toContain('data-custom="val"');
  });

  it('renders class on wrapper', () => {
    const html = Field({ name: 'x', class: 'field-wrapper', children: '' });
    expect(html).toContain('class="field-wrapper"');
  });

  it('renders style on wrapper', () => {
    const html = Field({ name: 'x', style: 'margin:8px', children: '' });
    expect(html).toContain('style="margin:8px"');
  });

  it('renders both class and errorClass separately', () => {
    const html = Field({ name: 'x', class: 'field', errorClass: 'err-red', children: '' });
    expect(html).toContain('class="field"');
    expect(html).toContain('class="err-red"');
  });
});

describe('Form SSR', () => {
  it('renders form element', () => {
    const html = Form({ children: '<input />' });
    expect(html.startsWith('<form')).toBe(true);
    expect(html.endsWith('</form>')).toBe(true);
  });

  it('includes action attribute', () => {
    const html = Form({ action: '/api/submit', children: '' });
    expect(html).toContain('action="/api/submit"');
  });

  it('includes method attribute (default POST)', () => {
    const html = Form({ children: '' });
    expect(html).toContain('method="POST"');
  });

  it('uses custom method', () => {
    const html = Form({ method: 'GET', children: '' });
    expect(html).toContain('method="GET"');
  });

  it('includes class attribute', () => {
    const html = Form({ class: 'my-form', children: '' });
    expect(html).toContain('class="my-form"');
  });

  it('includes style attribute', () => {
    const html = Form({ style: 'max-width:400px', children: '' });
    expect(html).toContain('style="max-width:400px"');
  });

  it('renders children', () => {
    const html = Form({ children: '<div>content</div>' });
    expect(html).toContain('<div>content</div>');
  });

  it('passes through rest attributes', () => {
    const html = Form({ children: '', 'data-test': 'yes', novalidate: '' });
    expect(html).toContain('novalidate=""');
    // novalidate with empty string is set as attribute value
  });
});

describe('Field + Form SSR integration', () => {
  it('Form renders nested Fields', () => {
    const html = Form({
      action: '/api/submit',
      children: Field({ name: 'email', label: 'Email', children: '<input name="email" />' }),
    });
    expect(html).toContain('data-vsk-field="email"');
    expect(html).toContain('<label>Email</label>');
    expect(html).toContain('action="/api/submit"');
  });

  it('multiple fields work', () => {
    const inner = Field({ name: 'a', children: '<input />' }) + Field({ name: 'b', children: '<input />' });
    const html = Form({ children: inner });
    expect(html).toContain('data-vsk-field="a"');
    expect(html).toContain('data-vsk-field="b"');
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
