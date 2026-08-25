import { renderMarkdown, Md, escapeHtml, highlightCode, sanitizeUrl, MD_BASE_CSS } from '@vesk/runtime/src/md';

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
    toBeTruthy() { if (!actual) throw new Error(`expected truthy, got ${actual}`); },
    toBeLessThan(expected) { if (!(actual < expected)) throw new Error(`expected ${actual} < ${expected}`); },
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
    expect(renderMarkdown('![alt text](https://a.test/p.png)')).toBe('<p><img src="https://a.test/p.png" alt="alt text" loading="lazy" /></p>');
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
    expect(html).toBe('<div class="vesk-md"><h1 id="hello">Hello</h1></div>');
  });

  it('applies class and style', () => {
    const html = Md({ content: 'text', class: 'md prose', style: 'color:red' });
    expect(html).toBe('<div class="vesk-md md prose" style="color:red"><p>text</p></div>');
  });

  it('prefers className over class', () => {
    const html = Md({ content: 'x', class: 'a', className: 'b' });
    expect(html).toBe('<div class="vesk-md b"><p>x</p></div>');
  });

  it('handles empty content', () => {
    expect(Md({ content: '' })).toBe('<div class="vesk-md"></div>');
    expect(Md({})).toBe('<div class="vesk-md"></div>');
  });

  it('escapes class attribute', () => {
    const html = Md({ content: 'x', class: 'a"onload="evil' });
    expect(html).toBe('<div class="vesk-md a&quot;onload=&quot;evil"><p>x</p></div>');
  });
});

// ── Advanced rendering ────────────────────────────────────────

describe('Tables (GFM)', () => {
  it('renders a basic table', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>2</td>');
    expect(html).notToContain('<p>');
  });

  it('applies alignment styles from delimiter row', () => {
    const html = renderMarkdown('| l | c | r |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
    expect(html).toContain('<th style="text-align:left">');
    expect(html).toContain('<th style="text-align:center">');
    expect(html).toContain('<th style="text-align:right">');
  });

  it('renders inline markdown inside cells', () => {
    const html = renderMarkdown('| k | v |\n|---|---|\n| `x` | **b** |');
    expect(html).toContain('<td><code>x</code></td>');
    expect(html).toContain('<td><strong>b</strong></td>');
  });

  it('escapes pipes in cells', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| x \\| y | z |');
    expect(html).toContain('<td>x | y</td>');
  });

  it('does not treat mismatched delimiter count as table', () => {
    const html = renderMarkdown('a | b\n---\nmore text');
    expect(html).notToContain('<table');
  });
});

describe('Syntax highlighting', () => {
  it('highlights keywords, strings, numbers in ts via highlightCode', () => {
    const html = highlightCode("const x: number = 'hi';", 'ts');
    expect(html).toContain('<span class="tok-kw">const</span>');
    expect(html).toContain('<span class="tok-str">\'hi\'</span>');
    expect(html).toContain('<span class="tok-kw">number</span>');
  });

  it('escapes HTML inside highlighted code', () => {
    const html = highlightCode('<script>alert(1)</script>', 'ts');
    expect(html).notToContain('<script>');
    expect(html).toContain('&lt;');
  });

  it('line comments tokenize as comments', () => {
    const html = highlightCode('// note\nlet a = 1;', 'js');
    expect(html).toContain('<span class="tok-com">// note</span>');
  });

  it('python hash comments and literals', () => {
    const html = highlightCode('# c\nif x == True:\n    pass', 'py');
    expect(html).toContain('<span class="tok-com"># c</span>');
    expect(html).toContain('<span class="tok-lit">True</span>');
  });

  it('css mode separates selectors, props, values', () => {
    const html = highlightCode('.btn { color: #ff0000; }', 'css');
    expect(html).toContain('<span class="tok-sel">btn</span>');
    expect(html).toContain('<span class="tok-prop">color</span>');
    expect(html).toContain('<span class="tok-num">#ff0000</span>');
  });

  it('diff mode classifies add/del lines', () => {
    const html = highlightCode('+added\n-removed\n context', 'diff');
    expect(html).toContain('tok-add">+added</span>');
    expect(html).toContain('tok-del">-removed</span>');
  });

  it('falls back to plain escape for unknown languages', () => {
    const html = highlightCode('?? unknown ??', 'wobble');
    expect(html).toBe('?? unknown ??');
  });

  it('Md renders chrome with lang badge + copy button by default', () => {
    const html = Md({ content: '```ts\nconst a = 1;\n```' }) as string;
    expect(html).toContain('<div class="md-code" data-lang="ts">');
    expect(html).toContain('data-md-copy');
    expect(html).toContain('md-code-lang">ts<');
    expect(html).toContain('<span class="tok-kw">const</span>');
    expect(html).toContain('<pre><code class="language-ts">');
  });

  it('Md lineNumbers wraps rendered lines', () => {
    const html = Md({ content: '```js\nlet a;\nlet b;\n```', lineNumbers: true }) as string;
    expect(html).toContain('md-lines');
    expect(html).toContain('tok-line');
  });

  it('copy can be disabled', () => {
    const html = Md({ content: '```\nx\n```', copy: false }) as string;
    expect(html).notToContain('data-md-copy');
  });

  it('highlight/chrome can be disabled to get legacy output', () => {
    const html = Md({ content: '```js\nconst x = 1;\n```', highlight: false }) as string;
    expect(html).toContain('<pre><code class="language-js">const x = 1;</code></pre>');
    expect(html).notToContain('data-md-copy');
  });
});

describe('Task lists', () => {
  it('renders checked and unchecked boxes', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('<li class="md-task"><input type="checkbox" checked disabled class="md-task-box" />done</li>');
    expect(html).toContain('<li class="md-task"><input type="checkbox" disabled class="md-task-box" />todo</li>');
  });
});

describe('Ordered list start', () => {
  it('emits start attribute when first number is not 1', () => {
    const html = renderMarkdown('3. three\n4. four');
    expect(html).toContain('<ol start="3">');
  });
  it('omits start when numbering begins at 1', () => {
    const html = renderMarkdown('1. one\n2. two');
    expect(html).notToContain('start=');
  });
});

describe('Heading anchors', () => {
  it('adds slug ids with dedup suffixes (opt-in)', () => {
    const html = renderMarkdown('# Setup\n\n## Setup\n\n# Setup!', { ids: true });
    expect(html).toContain('<h1 id="setup">');
    expect(html).toContain('<h2 id="setup-2">');
    expect(html).toContain('<h1 id="setup-3">');
  });
  it('legacy output has no ids without option', () => {
    const html = renderMarkdown('# Hello');
    expect(html).toBe('<h1>Hello</h1>');
  });
});

describe('Autolinks', () => {
  it('linkifies bare https URLs (opt-in)', () => {
    const html = renderMarkdown('see https://example.com/x now', { autolink: true });
    expect(html).toContain('<a href="https://example.com/x">https://example.com/x</a> now');
  });
  it('excludes trailing punctuation', () => {
    const html = renderMarkdown('go https://example.com.', { autolink: true });
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('</a>.');
  });
  it('prefixes www. with https', () => {
    const html = renderMarkdown('at www.example.com end', { autolink: true });
    expect(html).toContain('href="https://www.example.com"');
  });
});

describe('Hard breaks', () => {
  it('two trailing spaces become <br />', () => {
    const html = renderMarkdown('one  \ntwo', { hardBreaks: true });
    expect(html).toBe('<p>one<br />\ntwo</p>');
  });
  it('backslash becomes <br />', () => {
    const html = renderMarkdown('one\\\ntwo', { hardBreaks: true });
    expect(html).toBe('<p>one<br />\ntwo</p>');
  });
  it('off by default (soft wrap)', () => {
    const html = renderMarkdown('one  \ntwo');
    expect(html).toBe('<p>one two</p>');
  });
});

describe('URL safety', () => {
  it('sanitizeUrl allows safe schemes and relatives', () => {
    expect(sanitizeUrl('https://x.com')).toBe('https://x.com');
    expect(sanitizeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(sanitizeUrl('/local')).toBe('/local');
    expect(sanitizeUrl('#frag')).toBe('#frag');
  });
  it('neutralizes dangerous schemes', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('#');
    expect(sanitizeUrl('data:text/html,<b>x</b>')).toBe('#');
    expect(sanitizeUrl('vbscript:x')).toBe('#');
  });
  it('links with javascript: hrefs render # in markdown', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).toContain('href="#"');
    expect(html).notToContain('javascript:');
  });
  it('images get lazy loading', () => {
    const html = renderMarkdown('![alt](/img.png)');
    expect(html).toContain('<img src="/img.png" alt="alt" loading="lazy" />');
  });
});

describe('Base CSS', () => {
  it('MD_BASE_CSS contains token + boundary classes', () => {
    expect(MD_BASE_CSS).toContain('.vesk-md .md-code');
    expect(MD_BASE_CSS).toContain('.tok-kw');
    expect(MD_BASE_CSS).toContain('.md-table');
    expect(MD_BASE_CSS).toContain('li.md-task');
  });
  it('Md injects stylesheet when css=true', () => {
    const html = Md({ content: 'x', css: true }) as string;
    expect(html).toContain('<style data-vesk-md-css>');
    expect(html).toContain('class="vesk-md"');
  });
  it('custom css string is injected verbatim', () => {
    const html = Md({ content: 'x', css: '.custom{}' }) as string;
    expect(html).toContain('.custom{}');
  });
});

describe('Tracked-cell content', () => {
  it('unwraps a cell for rendering (SSR)', () => {
    const cell = { get: () => '# from cell' };
    const html = Md({ content: cell as never }) as string;
    expect(html).toContain('<h1 id="from-cell">from cell</h1>');
    expect(html).notToContain('[object Object]');
  });

  it('renderMarkdown still rejects non-strings gracefully', () => {
    const html = renderMarkdown(null as never);
    expect(html).toBe('');
  });
});

describe('Fence meta params', () => {
  it('bg=none strips the background', () => {
    const html = Md({ content: '```javascript bg=none\nconst a = 1;\n```' }) as string;
    expect(html).toContain('data-lang="javascript"');
    expect(html).toContain('--md-code-bg:transparent');
    expect(html).toContain('<span class="tok-kw">const</span>');
  });

  it('bg accepts hex, names and rgb()', () => {
    const hex = Md({ content: '```js bg=#0b1220\nx\n```' }) as string;
    expect(hex).toContain('--md-code-bg:#0b1220');
    const named = Md({ content: '```js bg=mistyrose\nx\n```' }) as string;
    expect(named).toContain('--md-code-bg:mistyrose');
    const fn = Md({ content: '```js bg=rgba(12,34,56,.7)\nx\n```' }) as string;
    expect(fn).toContain('--md-code-bg:rgba(12,34,56,.7)');
  });

  it('fg sets the code text color variable', () => {
    const html = Md({ content: '```js fg=navy bg=white\nx\n```' }) as string;
    expect(html).toContain('--md-code-fg:navy');
    expect(html).toContain('--md-code-bg:white');
  });

  it('unsafe values are dropped', () => {
    const html = Md({ content: '```js bg=url(evil)\nx\n```' }) as string;
    expect(html).notToContain('url(');
  });

  it('default theme stays light when no params given', () => {
    const html = Md({ content: '```js\nx\n```' }) as string;
    expect(html).notToContain('--md-code-bg');
  });
});

describe('Component-level code theming', () => {
  it('codeBg/codeFg set wrapper vars inherited by blocks', () => {
    const html = Md({ content: '```js\nx\n```', codeBg: 'green', codeFg: 'navy' }) as string;
    expect(html).toContain('--md-code-bg:green');
    expect(html).toContain('--md-code-fg:navy');
    expect(html).toContain('class="vesk-md');
  });

  it('theme=dark adds the dark scope class', () => {
    const html = Md({ content: '```js\nx\n```', theme: 'dark' }) as string;
    expect(html).toContain('vesk-md-dark');
    expect(MD_BASE_CSS).toContain('.vesk-md-dark { --md-code-bg: #0d1117');
  });

  it('fence bg= overrides component codeBg (content wins)', () => {
    const html = Md({ content: '```js bg=red\nx\n```', codeBg: 'green' }) as string;
    expect(html).toContain('--md-code-bg:red');   // per-block
    expect(html).toContain('--md-code-bg:green'); // wrapper default still there
    const blockStyle = html.slice(html.indexOf('<div class="md-code"'));
    const perBlockWins = blockStyle.indexOf('--md-code-bg:red') !== -1
      && blockStyle.indexOf('--md-code-bg:red') < blockStyle.indexOf('md-code-bar');
    expect(perBlockWins).toBeTruthy();
  });

  it('unsafe codeBg prop is dropped', () => {
    const html = Md({ content: 'x', codeBg: 'url(evil)' }) as string;
    expect(html).notToContain('url(');
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
