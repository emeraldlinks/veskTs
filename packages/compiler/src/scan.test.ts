import {
  skipString,
  skipComment,
  findBalancedEnd,
  splitTopLevel,
  unwrapTrackCall,
  stripTrackGeneric,
  cssBlockEnd,
  htmlTagEnd,
  htmlTagName,
} from '@vesk/compiler/src/scan';

let passed = 0;
let failed = 0;

function describe(name, fn) { console.log(`\n${name}`); fn(); }

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
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeNull() {
      if (actual !== null) throw new Error(`Expected null, got ${JSON.stringify(actual)}`);
    },
  };
}

describe('scan — findBalancedEnd', () => {
  it('finds matching close paren with nested parens', () => {
    const text = 'for (x of arr.map(y => y.id)) tail';
    const end = findBalancedEnd(text, 4);
    expect(text[end]).toBe(')');
    expect(text.slice(4, end + 1)).toBe('(x of arr.map(y => y.id))');
  });

  it('ignores parens inside strings', () => {
    const text = 'fn("a)b", x)';
    expect(findBalancedEnd(text, 2)).toBe(text.length - 1);
  });

  it('ignores parens inside comments', () => {
    const text = 'fn(/* ) */ x)';
    expect(findBalancedEnd(text, 2)).toBe(text.length - 1);
  });

  it('handles template literal with ${} nesting', () => {
    const text = 'fn(`a${(1)}b`, x)';
    expect(findBalancedEnd(text, 2)).toBe(text.length - 1);
  });

  it('handles braces and brackets', () => {
    const text = '{ a: [1, { b: 2 }] }';
    expect(findBalancedEnd(text, 0)).toBe(text.length - 1);
  });

  it('returns text.length for unterminated blocks', () => {
    expect(findBalancedEnd('(a(b', 0)).toBe(4);
  });
});

describe('scan — splitTopLevel', () => {
  it('splits on separator at depth 0 only', () => {
    const parts = splitTopLevel('const [a, b] of arr.map(x => x of y)', /\s+of\s+/);
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe('const [a, b]');
    expect(parts[1]).toBe('arr.map(x => x of y)');
  });

  it('does not split inside strings', () => {
    const parts = splitTopLevel(`x of 'a of b'`, /\s+of\s+/);
    expect(parts.length).toBe(2);
    expect(parts[1]).toBe(`'a of b'`);
  });

  it('does not split inside comments', () => {
    const parts = splitTopLevel('x of /* a of b */ y', /\s+of\s+/);
    expect(parts.length).toBe(2);
    expect(parts[1]).toBe('/* a of b */ y');
  });

  it('splits on in at depth 0', () => {
    const parts = splitTopLevel('const k in obj.filter(x => x in y)', /\s+in\s+/);
    expect(parts.length).toBe(2);
    expect(parts[1]).toBe('obj.filter(x => x in y)');
  });

  it('returns whole text when no separator', () => {
    const parts = splitTopLevel('abc def', /\s+of\s+/);
    expect(parts.length).toBe(1);
    expect(parts[0]).toBe('abc def');
  });
});

describe('scan — unwrapTrackCall', () => {
  it('unwraps a plain track call', () => {
    expect(unwrapTrackCall('track(() => 5)')).toBe('() => 5');
  });

  it('unwraps with nested parens in the argument', () => {
    expect(unwrapTrackCall('track(sum([1, 2], f(x)))')).toBe('sum([1, 2], f(x))');
  });

  it('unwraps nested generics', () => {
    expect(unwrapTrackCall('track<Map<string, number>>(() => m)')).toBe('() => m');
  });

  it('unwraps when expression has trailing whitespace', () => {
    expect(unwrapTrackCall('  track( x )  ')).toBe(' x ');
  });

  it('returns input unchanged when not a whole track call', () => {
    expect(unwrapTrackCall('track(1) + 1')).toBe('track(1) + 1');
  });

  it('returns input unchanged when not a track call', () => {
    const init = 'x + 1';
    expect(unwrapTrackCall(init)).toBe(init);
  });
});

describe('scan — stripTrackGeneric', () => {
  it('strips nested generic args', () => {
    expect(stripTrackGeneric('track<Array<number>>(x)')).toBe('track(x)');
  });

  it('leaves plain track calls untouched', () => {
    const init = 'track(x)';
    expect(stripTrackGeneric(init)).toBe(init);
  });

  it('leaves non-track expressions untouched', () => {
    const init = 'x < 5 ? a : b';
    expect(stripTrackGeneric(init)).toBe(init);
  });
});

describe('scan — cssBlockEnd', () => {
  it('matches braces ignoring braces inside strings', () => {
    const css = '@theme { --img: url("data:image/svg+xml,{a}"); --x: 1 }';
    expect(cssBlockEnd(css, 8)).toBe(css.length);
  });

  it('matches braces ignoring braces inside comments', () => {
    const css = '@layer base { /* } { */ p { color: red } }';
    expect(cssBlockEnd(css, 12)).toBe(css.length);
  });

  it('returns css.length for unterminated blocks', () => {
    expect(cssBlockEnd('@theme { a: 1', 7)).toBe(13);
  });

  it('handles nested blocks', () => {
    const css = '@layer components { .card { .inner { a: b } } } .other {}';
    const end = cssBlockEnd(css, 18);
    expect(css.slice(end, end + 8)).toBe(' .other ');
  });
});

describe('scan — htmlTagEnd / htmlTagName', () => {
  it('does not stop at > inside quoted attributes', () => {
    const html = '<img alt="a > b" src="x.png">';
    expect(html.slice(0, htmlTagEnd(html, 0))).toBe(html);
  });

  it('stops at > after an unquoted attribute', () => {
    const html = '<div data-x=1>text</div>';
    expect(htmlTagEnd(html, 0)).toBe(14);
  });

  it('reads tag names', () => {
    expect(htmlTagName('<div>')).toBe('div');
    expect(htmlTagName('</span>')).toBe('span');
    expect(htmlTagName('<my-el attr="x">')).toBe('my-el');
    expect(htmlTagName('<!-- comment -->')).toBeNull();
  });

  it('returns -1 for unterminated tags', () => {
    expect(htmlTagEnd('<div class="x', 0)).toBe(-1);
  });
});

describe('scan — skipString / skipComment', () => {
  it('skips escaped quotes', () => {
    const text = `"a\\"b" c`;
    expect(skipString(text, 0)).toBe(6);
  });

  it('skips line comments to end of line', () => {
    const text = '// note )\ncode';
    expect(skipComment(text, 0)).toBe(9);
  });

  it('skips block comments', () => {
    const text = '/* ) } */code';
    expect(skipComment(text, 0)).toBe(9);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
