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
  startsWithIdentifier,
  stripDeclKeyword,
  stripTrailingSemicolons,
  containsForOfIn,
  collapseNewlineWhitespace,
  blankComments,
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
    const parts = splitTopLevel('const [a, b] of arr.map(x => x of y)', 'of');
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe('const [a, b]');
    expect(parts[1]).toBe('arr.map(x => x of y)');
  });

  it('does not split inside strings', () => {
    const parts = splitTopLevel(`x of 'a of b'`, 'of');
    expect(parts.length).toBe(2);
    expect(parts[1]).toBe(`'a of b'`);
  });

  it('does not split inside comments', () => {
    const parts = splitTopLevel('x of /* a of b */ y', 'of');
    expect(parts.length).toBe(2);
    expect(parts[1]).toBe('/* a of b */ y');
  });

  it('splits on in at depth 0', () => {
    const parts = splitTopLevel('const k in obj.filter(x => x in y)', 'in');
    expect(parts.length).toBe(2);
    expect(parts[1]).toBe('obj.filter(x => x in y)');
  });

  it('does not split mid-identifier', () => {
    expect(splitTopLevel('info oof xof', 'of').length).toBe(1);
    expect(splitTopLevel('x of y', 'of').length).toBe(2);
  });

  it('splits when separator touches a bracket', () => {
    const parts = splitTopLevel('const x of[a, b]', 'of');
    expect(parts.length).toBe(2);
    expect(parts[1]).toBe('[a, b]');
  });

  it('returns whole text when no separator', () => {
    const parts = splitTopLevel('abc def', 'of');
    expect(parts.length).toBe(1);
    expect(parts[0]).toBe('abc def');
  });
});

describe('scan — startsWithIdentifier / stripDeclKeyword', () => {
  it('matches a leading whole identifier', () => {
    expect(startsWithIdentifier('track(x)', 'track')).toBe(true);
    expect(startsWithIdentifier('  for (x of y)', 'for')).toBe(true);
    expect(startsWithIdentifier('forbidden', 'for')).toBe(false);
    expect(startsWithIdentifier('x for', 'for')).toBe(false);
  });

  it('strips declaration keywords', () => {
    expect(stripDeclKeyword('const items')).toBe('items');
    expect(stripDeclKeyword(' let x')).toBe('x');
    expect(stripDeclKeyword('var y')).toBe('y');
    expect(stripDeclKeyword('constant')).toBe('constant');
  });

  it('strips trailing semicolons', () => {
    expect(stripTrailingSemicolons('let x = 1;;')).toBe('let x = 1');
    expect(stripTrailingSemicolons('a; b;')).toBe('a; b');
  });
});

describe('scan — containsForOfIn', () => {
  it('detects of/in at depth 0', () => {
    expect(containsForOfIn('const x of y')).toBe(true);
    expect(containsForOfIn('const k in obj')).toBe(true);
    expect(containsForOfIn('const x of arr.map(a => a of b)')).toBe(true);
    expect(containsForOfIn('let i = 0; i < 5; i++')).toBe(false);
    expect(containsForOfIn('const x ofw = 1')).toBe(false);
    expect(containsForOfIn('const info = 1')).toBe(false);
  });

  it('ignores strings and comments', () => {
    expect(containsForOfIn(`x of 'in'`)).toBe(true);
    expect(containsForOfIn(`'a of b'`)).toBe(false);
    expect(containsForOfIn(`/* of */`)).toBe(false);
  });
});

describe('scan — collapseNewlineWhitespace', () => {
  it('collapses newline runs to a single space', () => {
    expect(collapseNewlineWhitespace('a\n  b')).toBe('a b');
    expect(collapseNewlineWhitespace('a\n\nb')).toBe('a b');
    expect(collapseNewlineWhitespace('a\r\n b')).toBe('a\r b');
    expect(collapseNewlineWhitespace('a b')).toBe('a b');
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

describe('scan — blankComments', () => {
  it('blanks a line-leading // comment', () => {
    expect(blankComments('// gone\nkept')).toBe('       \nkept');
  });

  it('blanks an indented line-leading // comment', () => {
    expect(blankComments('\t\t// gone\n\t\tkept')).toBe('\t\t       \n\t\tkept');
  });

  it('preserves length and every offset', () => {
    const src = 'a\n// note\nb';
    expect(blankComments(src).length).toBe(src.length);
  });

  it('preserves newlines inside a blanked line so line numbers hold', () => {
    const src = '// one\n// two\ncode';
    const out = blankComments(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out.endsWith('code')).toBe(true);
  });

  it('leaves a trailing // comment after code alone (acorn ignores it)', () => {
    expect(blankComments('const n = 1 // note')).toBe('const n = 1 // note');
  });

  it('leaves a mid-line // in JSX text alone', () => {
    expect(blankComments('<p>ratio 1//2</p>')).toBe('<p>ratio 1//2</p>');
  });

  it('never blanks // inside a double-quoted string', () => {
    expect(blankComments('<a href="https://x.dev/a//b">x</a>')).toBe('<a href="https://x.dev/a//b">x</a>');
  });

  it('never blanks // inside a single-quoted string', () => {
    expect(blankComments("const s = 'a//b'")).toBe("const s = 'a//b'");
  });

  it('never blanks // inside a template literal', () => {
    const src = 'const t = `one\n// literal\ntwo`';
    expect(blankComments(src)).toBe(src);
  });

  it('never blanks // inside a template ${} interpolation', () => {
    const src = 'const t = `${x}//y`';
    expect(blankComments(src)).toBe(src);
  });

  it('leaves escaped slashes in a regex alone', () => {
    expect(blankComments('const re = /https:\\/\\//')).toBe('const re = /https:\\/\\//');
  });

  it('blanks a comment line that follows a multi-line string', () => {
    const out = blankComments('const t = `a\nb`\n// gone\ncode');
    expect(out.endsWith('\ncode')).toBe(true);
    expect(out.includes('// gone')).toBe(false);
  });

  it('leaves a mid-line block comment alone (acorn already ignores it)', () => {
    expect(blankComments('const n = /* five */ 5;')).toBe('const n = /* five */ 5;');
  });

  it('blanks a line-leading block comment before code', () => {
    expect(blankComments('/* note */\nconst n = 5;')).toBe('          \nconst n = 5;');
  });

  it('leaves /* with no terminator untouched instead of blanking to EOF', () => {
    // Regression: a runaway scan for a missing `*/` blanked the rest of the
    // file. JSX text legitimately contains `/*`-looking runs.
    expect(blankComments('/* never closed')).toBe('/* never closed');
  });

  it('does not swallow JSX text containing a /*-looking run (app/api/**/route.ts)', () => {
    // Real vesk-doc source: <code>app/api/**/route.ts</code> and <code>/api/**</code>.
    const src = '<p>File <code>app/api/**/route.ts</code> at <code>/api/**</code>.</p>';
    expect(blankComments(src)).toBe(src);
  });

  it('preserves a /*-looking run inside a JSX attribute value', () => {
    const src = '<meta name="d" content="app/api/**/route.ts, GET" />';
    expect(blankComments(src)).toBe(src);
  });

  it('blanks a multi-line block comment but keeps its newlines', () => {
    const src = '/* one\ntwo */\ncode';
    const out = blankComments(src);
    expect(out.includes('one')).toBe(false);
    expect(out.includes('two')).toBe(false);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out.endsWith('code')).toBe(true);
  });

  it('preserves length for a multi-line block comment', () => {
    const src = 'a\n/* x\ny */\nb';
    expect(blankComments(src).length).toBe(src.length);
  });

  it('never blanks a block-comment marker inside a string', () => {
    expect(blankComments("const s = '/* keep */'")).toBe("const s = '/* keep */'");
  });

  it('never blanks a block-comment marker inside a template literal', () => {
    const src = 'const t = `a /* b */ c`';
    expect(blankComments(src)).toBe(src);
  });

  it('handles a line comment nested inside a block comment', () => {
    const out = blankComments('/*\n// inner\n*/\ncode');
    expect(out.includes('inner')).toBe(false);
    expect(out.endsWith('code')).toBe(true);
  });

  it('preserves the {/* */} JSX idiom verbatim (acorn strips it in the container)', () => {
    expect(blankComments('<div>{/* gone */}</div>')).toBe('<div>{/* gone */}</div>');
  });

  it('blanks each line of a multi-line commented-out JSX block', () => {
    const src = '//<div>\n//  <span>x</span>\n//</div>\n<p>kept</p>';
    const out = blankComments(src);
    expect(out.includes('<span>')).toBe(false);
    expect(out.includes('<p>kept</p>')).toBe(true);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
