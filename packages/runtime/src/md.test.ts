import { renderMarkdown, renderMarkdownEx, configureMd, getMdPolicy, drainMdHtmlWarnings, setMdConsoleWarnings, MD_DEFAULT_ALLOW_TAGS, Md, escapeHtml, highlightCode, sanitizeUrl, MD_BASE_CSS } from '@vesk/runtime/src/md';
import { clearSsrData, getSsrData } from '@vesk/runtime/src/resource';
import { track, get, set, run_block, flush_sync } from '@vesk/runtime/src/ripple-runtime';
import { root, destroy_block } from '@vesk/runtime/src/ripple-blocks';

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

describe('Links: titles, angle autolinks, intraword underscores', () => {
  it('double-quoted title becomes a title attribute, not part of the href', () => {
    const html = renderMarkdown('See [docs](https://x.com/a "The Docs") here');
    expect(html).toContain('<a href="https://x.com/a" title="The Docs">');
  });

  it("single-quoted title works too", () => {
    const html = renderMarkdown("See [docs](https://x.com/a 'Docs') here");
    expect(html).toContain('<a href="https://x.com/a" title="Docs">');
  });

  it('title content is escaped', () => {
    const html = renderMarkdown('[a](https://x.com "<b>x</b>")');
    expect(html).toContain('title="&lt;b&gt;x&lt;/b&gt;"');
  });

  it('escaped quote inside title does not end it early', () => {
    const html = renderMarkdown('[a](https://x.com "say \\"hi\\"")');
    expect(html).toContain('title="say &quot;hi&quot;"');
  });

  it('parenthesized title works', () => {
    const html = renderMarkdown('[a](https://x.com (nested))');
    expect(html).toContain('<a href="https://x.com" title="nested">');
  });

  it('links without titles are unchanged', () => {
    const html = renderMarkdown('[a](https://x.com)');
    expect(html).toBe('<p><a href="https://x.com">a</a></p>');
  });

  it('image with title gets the attribute', () => {
    const html = renderMarkdown('![pic](/p.png "the pic")');
    expect(html).toContain('alt="pic" title="the pic"');
  });

  it('angle autolink <https://…> renders a link when autolink is on', () => {
    const html = renderMarkdown('Visit <https://example.com/x> now', { autolink: true });
    expect(html).toContain('<a href="https://example.com/x">https://example.com/x</a>');
  });

  it('angle email autolink renders mailto:', () => {
    const html = renderMarkdown('Mail <me@example.com> ok', { autolink: true });
    expect(html).toContain('<a href="mailto:me@example.com">me@example.com</a>');
  });

  it('angle non-url stays escaped', () => {
    const html = renderMarkdown('x <not a url> y', { autolink: true });
    expect(html).toContain('&lt;not a url&gt;');
  });

  it('angle javascript-ish scheme is not linkified (escaped instead)', () => {
    const html = renderMarkdown('<javascript:alert(1)>', { autolink: true });
    expect(html).toBe('<p>&lt;javascript:alert(1)&gt;</p>');
  });

  it('quotes that are part of the URL stay in the destination', () => {
    const html = renderMarkdown('[x](https://a.test/?q="1")');
    expect(html).toContain('href="https://a.test/?q=&quot;1&quot;"');
  });

  it('intraword underscores do not emphasize (CommonMark flanking)', () => {
    const html = renderMarkdown('config uses some_var_with_underscores here');
    expect(html).toBe('<p>config uses some_var_with_underscores here</p>');
  });

  it('underscore emphasis still works at word boundaries', () => {
    const html = renderMarkdown('this is _real_ stuff');
    expect(html).toContain('<em>real</em>');
  });

  it('intraword asterisks still emphasize', () => {
    const html = renderMarkdown('a*mid*dle stays emphasized-capable: *yes*', { });
    expect(html).toContain('<em>yes</em>');
  });

  it('legacy renderMarkdown keeps angle brackets escaped without autolink opt-in', () => {
    const html = renderMarkdown('<https://example.com>');
    expect(html).toBe('<p>&lt;https://example.com&gt;</p>');
  });
});

describe('Reference links, setext headings, entities', () => {
  it('full reference form resolves with definition title', () => {
    const html = renderMarkdown('Read [the docs][1] now\n\n[1]: https://a.com "Docs"');
    expect(html).toContain('<a href="https://a.com" title="Docs">the docs</a>');
    expect(html).notToContain('[1]:');
  });

  it('collapsed [text][] resolves through the text', () => {
    const html = renderMarkdown('See [vesk][] here\n\n[vesk]: https://v.dev');
    expect(html).toContain('<a href="https://v.dev">vesk</a>');
  });

  it('shortcut [text] resolves when defined, stays literal otherwise', () => {
    const ok = renderMarkdown('go [home] now\n\n[home]: /');
    expect(ok).toContain('<a href="/">home</a>');
    const no = renderMarkdown('array[0] access');
    expect(no).toBe('<p>array[0] access</p>');
  });

  it('labels are case-insensitive', () => {
    const html = renderMarkdown('[Docs][DOCS]\n\n[docs]: https://d.io');
    expect(html).toContain('href="https://d.io"');
  });

  it('reference image works', () => {
    const html = renderMarkdown('![pic][p]\n\n[p]: /p.png');
    expect(html).toContain('<img src="/p.png" alt="pic"');
  });

  it('failed inline link is not hijacked as shortcut', () => {
    const html = renderMarkdown('[a](broken\n\n[home]: /');
    expect(html).notToContain('<a ');
  });

  it('angle-bracket destinations are supported', () => {
    const html = renderMarkdown('[x][r]\n\n[r]: <https://q.example/x> "T"');
    expect(html).toContain('<a href="https://q.example/x" title="T">x</a>');
  });

  it('setext h1 (=) and h2 (-) under a paragraph line', () => {
    const html = renderMarkdown('Title One\n=\n\nTitle Two\n-------\nbody');
    expect(html).toContain('<h1>Title One</h1>');
    expect(html).toContain('<h2>Title Two</h2>');
    expect(html).toContain('<p>body</p>');
  });

  it('standalone hr is unaffected by setext support', () => {
    const html = renderMarkdown('a\n\n---\n\nb');
    expect(html).toContain('<hr />');
  });

  it('named entities decode and re-escape safely', () => {
    const html = renderMarkdown('&copy; &amp; &lt;tag&gt;');
    expect(html).toContain('\u00a9');
    expect(html).toContain('&amp;');
    expect(html).toContain('&lt;tag&gt;');
  });

  it('numeric decimal and hex entities decode', () => {
    const html = renderMarkdown('&#169; &#xA9; &#8212;');
    expect(html).toContain('\u00a9 \u00a9 \u2014');
  });

  it('unknown entities stay literal', () => {
    const html = renderMarkdown('bad&nosuch; end');
    expect(html).toContain('bad&amp;nosuch;');
  });

  it('code spans/blocks do NOT decode entities', () => {
    const html = renderMarkdown('`&copy;`');
    expect(html).toContain('<code>&amp;copy;</code>');
  });
});

// ── Raw-HTML policy (md.html escape / allow / allowlist) ─────────

describe('Md raw HTML policy', () => {
  const SRC = '<a id="custom-target">d</a>\nThis is the paragraph you want to jump to.';

  it('default escapes raw HTML as visible text', () => {
    const html = renderMarkdown(SRC);
    expect(html).toContain('&lt;a id=&quot;custom-target&quot;&gt;');
    expect(html).notToContain('<a id=');
  });

  it('html:"allow" passes raw HTML through verbatim', () => {
    const { html, warnings } = renderMarkdownEx(SRC, { html: 'allow' });
    expect(html).toContain('<a id="custom-target">d</a>');
    expect(warnings.some(w => w.tag === 'a')).toBe(true);
  });

  it('html:"allowlist" renders allowed tags and escapes the rest', () => {
    const src = 'keep <em>emphasis</em> and <b>bold</b>, drop <script>x</script> and <div>blocks</div>';
    const { html } = renderMarkdownEx(src, { html: 'allowlist' });
    expect(html).toContain('<em>emphasis</em>');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('&lt;div&gt;blocks&lt;/div&gt;');
  });

  it('allowlist drops on* handlers and sanitizes href/src', () => {
    const src = '<a href="javascript:alert(1)" onclick="evil()" title="t">link</a>';
    const { html } = renderMarkdownEx(src, { html: 'allowlist' });
    expect(html).notToContain('onclick');
    expect(html).notToContain('javascript:');
    expect(html).toContain('title="t"');
    expect(html).toContain('<a href="#"');
  });

  it('allowlist keeps non-url attributes like id verbatim', () => {
    const { html } = renderMarkdownEx(SRC, { html: 'allowlist' });
    expect(html).toContain('<a id="custom-target">d</a>');
  });

  it('handles quoted attribute values containing > and self-closing tags', () => {
    const { html } = renderMarkdownEx('<span data-x="a > b" />next', { html: 'allow' });
    expect(html).toContain('data-x="a > b"');
    expect(html).toContain('/>next');
  });

  it('closing tags normalize under allowlist', () => {
    const { html } = renderMarkdownEx('<em>x</em>', { html: 'allowlist' });
    expect(html).toContain('<em>x</em>');
  });

  it('configureMd sets process-wide policy; props override it', () => {
    configureMd({ html: 'allowlist' });
    try {
      expect(getMdPolicy().html).toBe('allowlist');
      // default escape still applies when explicitly requested per instance
      const escaped = renderMarkdownEx(SRC, { html: 'escape' }).html;
      expect(escaped).toContain('&lt;a');
      const allowed = renderMarkdownEx(SRC).html;
      expect(allowed).toContain('<a id="custom-target">');
      // per-instance allowTags override
      const narrow = renderMarkdownEx('<em>e</em><b>b</b>', { allowTags: ['em'] }).html;
      expect(narrow).toContain('<em>e</em>');
      expect(narrow).toContain('&lt;b&gt;b&lt;/b&gt;');
    } finally {
      configureMd({ html: 'escape' });
    }
    expect(getMdPolicy().html).toBe('escape');
  });

  it('Md component honors the policy and warns on console', () => {
    configureMd({ html: 'allowlist' });
    let warned = '';
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => { warned = args.join(' '); };
    try {
      const html = Md({ content: SRC }) as string;
      expect(html).toContain('<a id="custom-target">');
      expect(warned).toContain('[vesk-md]');
      expect(warned).toContain('<a>');
    } finally {
      console.warn = origWarn;
      configureMd({ html: 'escape' });
    }
  });

  it('drainMdHtmlWarnings collects passthrough samples', () => {
    configureMd({ html: 'allow' });
    try {
      renderMarkdownEx(SRC, {});
      const drained = drainMdHtmlWarnings();
      expect(drained.some(w => w.tag === 'a')).toBe(true);
    } finally {
      configureMd({ html: 'escape' });
      drainMdHtmlWarnings();
    }
  });

  it('MD_DEFAULT_ALLOW_TAGS excludes script/iframe/img/div', () => {
    for (const t of ['script', 'iframe', 'img', 'div', 'style']) {
      if (MD_DEFAULT_ALLOW_TAGS.includes(t)) throw new Error('unsafe default tag: ' + t);
    }
  });
});

// ============================================================
// Runtime markdown-file loading (<Md content="/docs/x.md" />)
// ============================================================
let asyncChain = Promise.resolve();
function itAsync(name: string, fn: () => Promise<void>): void {
  asyncChain = asyncChain.then(async () => {
    try {
      await fn();
      passed++;
      console.log(`  \u2713 ${name}`);
    } catch (e) {
      failed++;
      console.log(`  \u2717 ${name}`);
      console.log(`    ${(e as Error).message}`);
    }
  });
}

const FILE_HOOK = (p: string) => (p === '/docs/guide.md' ? '# Guide\n\nBody text.' : null);

// Minimal client DOM mock (mirrors hydrate.test.ts).
function mockDocument() {
  const listeners: Record<string, Function> = {};
  const elProto = {
    nodeType: 1, tagName: 'DIV', childNodes: [], children: [],
    className: '', style: { cssText: '' }, innerHTML: '',
    contains() { return true; },
    addEventListener(ev: string, fn: Function) { listeners[ev] = fn; },
    querySelectorAll() { return []; },
  };
  const doc = {
    createElement(tag: string) {
      return Object.create(Object.assign({}, elProto, { tagName: tag.toUpperCase() }));
    },
    createDocumentFragment() { return { nodeType: 11 }; },
    createTreeWalker() { return { nextNode() { return null; } }; },
  };
  (globalThis as any).document = doc;
  return doc;
}

describe('Runtime markdown-file loading', () => {
  it('rejects non-public paths so they render as literal text (SSR)', () => {
    for (const literal of ['docs/guide.md', '/docs/guide.md?x=1', '/docs/guide.md#top', '/docs/a\\b.md', 'relative.md']) {
      const html = Md({ content: literal }) as string;
      if (!html.includes('vesk-md')) throw new Error(`expected a rendered literal, got: ${html}`);
      if (html.includes('<h1>')) throw new Error(`unexpected file render for "${literal}": ${html}`);
      if (getSsrData('md:' + literal) !== undefined) throw new Error(`must not stash "${literal}" as a file read`);
    }
  });

  it('SSR renders the public markdown file via the installed read hook', () => {
    clearSsrData();
    (globalThis as any).__vsk_md_read_file = FILE_HOOK;
    const html = Md({ content: '/docs/guide.md' }) as string;
    expect(html.includes('<h1>Guide</h1>') || html.includes('Guide')).toBe(true);
    expect(getSsrData('md:/docs/guide.md')).toBe('# Guide\n\nBody text.');
    clearSsrData();
  });

  it('SSR renders the literal path when the file does not exist', () => {
    clearSsrData();
    (globalThis as any).__vsk_md_read_file = FILE_HOOK;
    const html = Md({ content: '/docs/missing.md' }) as string;
    expect(html.includes('/docs/missing.md')).toBe(true);
    expect(html.includes('<h1>')).toBe(false);
    expect(getSsrData('md:/docs/missing.md')).toBe(undefined);
    clearSsrData();
  });

  it('SSR stacks the markdown source into serialized SSR data for hydration', () => {
    clearSsrData();
    (globalThis as any).__vsk_md_read_file = FILE_HOOK;
    Md({ content: '/docs/guide.md' }) as string;
    const data = getSsrData('md:/docs/guide.md');
    expect(data).toBe('# Guide\n\nBody text.');
    clearSsrData();
  });
});

describe('Md client path mode + streaming cells', () => {
  itAsync('renders literal path first, then upgrades once fetch resolves', async () => {
    clearSsrData();
    mockDocument();
    delete (globalThis as any).__vsk_md_read_file;
    const calls: unknown[] = [];
    const origFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = (url: string) => {
      calls.push(url);
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('# File loaded') });
    };
    let div: any;
    const block = root(() => {
      div = Md({ content: '/docs/one.md' });
    });
    expect(div.tagName).toBe('DIV');
    // literal path while the fetch is in flight
    expect(String(div.innerHTML).includes('/docs/one.md')).toBe(true);
    await new Promise(r => setTimeout(r, 30));
    flush_sync();
    expect(htmlOf(div)).toContain('File loaded');
    if (calls.length !== 1 || calls[0] !== '/docs/one.md') throw new Error(`expected single fetch of the path, got ${JSON.stringify(calls)}`);
    destroy_block(block as any);
    (globalThis as any).fetch = origFetch;
    delete (globalThis as any).document;
  });

  itAsync('re-renders when a streamed/tracked content cell updates', async () => {
    clearSsrData();
    mockDocument();
    const cell = track('');
    let div: any;
    const block = root(() => {
      div = Md({ content: cell });
    });
    expect(String(div.innerHTML).length < 10).toBe(true);
    set(cell, '## Live\nupdated');
    flush_sync();
    await new Promise(r => setTimeout(r, 0));
    expect(htmlOf(div)).toContain('Live');
    destroy_block(block as any);
    delete (globalThis as any).document;
  });
});

function htmlOf(el: any): string {
  return String(el && (el.innerHTML || ''));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
await asyncChain;
process.exit(failed > 0 ? 1 : 0);
