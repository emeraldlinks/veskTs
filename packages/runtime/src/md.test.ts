import { renderMarkdown, Md, escapeHtml } from '@vesk/runtime/src/md';

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
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \u2717 ${name}`);
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
  };
}

describe('escapeHtml', () => {
  it('escapes special characters', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

describe('Headings', () => {
  it('renders h1-h6', () => {
    expect(renderMarkdown('# One\n\n## Two\n\n### Three')).toBe('<h1>One</h1>\n<h2>Two</h2>\n<h3>Three</h3>');
  });

  it('does not treat # without space as heading', () => {
    expect(renderMarkdown('#nospace')).toBe('<p>#nospace</p>');
  });
});

describe('Paragraphs', () => {
  it('renders a single paragraph', () => {
    expect(renderMarkdown('hello world')).toBe('<p>hello world</p>');
  });

  it('joins consecutive lines into one paragraph', () => {
    expect(renderMarkdown('first line\nsecond line')).toBe('<p>first line second line</p>');
  });

  it('splits paragraphs on blank lines', () => {
    expect(renderMarkdown('para one\n\npara two')).toBe('<p>para one</p>\n<p>para two</p>');
  });
});

describe('Emphasis', () => {
  it('renders bold with **', () => {
    expect(renderMarkdown('a **bold** b')).toBe('<p>a <strong>bold</strong> b</p>');
  });

  it('renders italic with *', () => {
    expect(renderMarkdown('a *italic* b')).toBe('<p>a <em>italic</em> b</p>');
  });

  it('renders italic with _', () => {
    expect(renderMarkdown('a _italic_ b')).toBe('<p>a <em>italic</em> b</p>');
  });

  it('leaves unmatched * as literal', () => {
    expect(renderMarkdown('a * b * c')).toBe('<p>a * b * c</p>');
  });
});

describe('Inline code', () => {
  it('renders code spans', () => {
    expect(renderMarkdown('use `track(0)` here')).toBe('<p>use <code>track(0)</code> here</p>');
  });

  it('escapes code content', () => {
    expect(renderMarkdown('`<script>`')).toBe('<p><code>&lt;script&gt;</code></p>');
  });
});

describe('Links', () => {
  it('renders links', () => {
    expect(renderMarkdown('[docs](https://vesk.dev)')).toBe('<p><a href="https://vesk.dev">docs</a></p>');
  });

  it('escapes link URLs', () => {
    expect(renderMarkdown('[x](https://a.test/?q="1")')).toContain('href="https://a.test/?q=&quot;1&quot;"');
  });

  it('renders images', () => {
    expect(renderMarkdown('![alt text](https://a.test/p.png)')).toBe('<p><img src="https://a.test/p.png" alt="alt text" /></p>');
  });
});

describe('Lists', () => {
  it('renders unordered list', () => {
    expect(renderMarkdown('- a\n- b\n- c')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n<li>c</li>\n</ul>');
  });

  it('renders ordered list', () => {
    expect(renderMarkdown('1. one\n2. two')).toBe('<ol>\n<li>one</li>\n<li>two</li>\n</ol>');
  });

  it('renders nested unordered list', () => {
    expect(renderMarkdown('- a\n  - b\n  - c\n- d')).toBe(
      '<ul>\n<li>a\n<ul>\n<li>b</li>\n<li>c</li>\n</ul></li>\n<li>d</li>\n</ul>'
    );
  });

  it('supports inline formatting in items', () => {
    expect(renderMarkdown('- **bold** item')).toBe('<ul>\n<li><strong>bold</strong> item</li>\n</ul>');
  });
});

describe('Blockquotes', () => {
  it('renders blockquote', () => {
    expect(renderMarkdown('> quoted text')).toBe('<blockquote><p>quoted text</p></blockquote>');
  });

  it('renders nested blockquote', () => {
    expect(renderMarkdown('> outer\n> > inner')).toBe('<blockquote><p>outer</p>\n<blockquote><p>inner</p></blockquote></blockquote>');
  });
});

describe('Code blocks', () => {
  it('renders fenced code', () => {
    expect(renderMarkdown('```js\nconst x = 1;\n```')).toBe('<pre><code class="language-js">const x = 1;</code></pre>');
  });

  it('renders fenced code without language', () => {
    expect(renderMarkdown('```\nplain\n```')).toBe('<pre><code>plain</code></pre>');
  });

  it('escapes code block content', () => {
    expect(renderMarkdown('```\n<a>&"\n```')).toBe('<pre><code>&lt;a&gt;&amp;&quot;</code></pre>');
  });

  it('renders indented code block', () => {
    expect(renderMarkdown('    const y = 2;')).toBe('<pre><code>const y = 2;</code></pre>');
  });
});

describe('Horizontal rule', () => {
  it('renders hr', () => {
    expect(renderMarkdown('a\n\n---\n\nb')).toBe('<p>a</p>\n<hr />\n<p>b</p>');
  });
});

describe('Raw HTML is never passed through', () => {
  it('escapes inline raw html', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('escapes tag-like text in paragraphs', () => {
    expect(renderMarkdown('use <div>')).toBe('<p>use &lt;div&gt;</p>');
  });
});

describe('Escapes', () => {
  it('escapes a literal backslash character', () => {
    expect(renderMarkdown('\\*not italic\\*')).toBe('<p>*not italic*</p>');
  });
});

describe('Strikethrough', () => {
  it('renders del', () => {
    expect(renderMarkdown('~~gone~~ here')).toBe('<p><del>gone</del> here</p>');
  });
});

describe('Md component (SSR)', () => {
  it('wraps rendered markdown in a div', () => {
    const html = Md({ content: '# Hello' });
    expect(html).toBe('<div><h1>Hello</h1></div>');
  });

  it('applies class and style', () => {
    const html = Md({ content: 'text', class: 'md prose', style: 'color:red' });
    expect(html).toBe('<div class="md prose" style="color:red"><p>text</p></div>');
  });

  it('prefers className over class', () => {
    const html = Md({ content: 'x', class: 'a', className: 'b' });
    expect(html).toBe('<div class="b"><p>x</p></div>');
  });

  it('handles empty content', () => {
    expect(Md({ content: '' })).toBe('<div></div>');
    expect(Md({})).toBe('<div></div>');
  });

  it('escapes class attribute', () => {
    const html = Md({ content: 'x', class: 'a"onload="evil' });
    expect(html).toBe('<div class="a&quot;onload=&quot;evil"><p>x</p></div>');
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
