# Markdown (`<Md>`)

The `<Md>` component renders markdown with a tokenizer-based engine (no
regex): GFM tables, task lists, syntax highlighting, heading anchors,
autolinks. XSS-safe by default because **raw HTML is escaped**.

> Import explicitly: `import { Md } from '@vesk/runtime'` — it is not on
> the auto-import list.

```vsk
import { Md } from '@vesk/runtime';

component Docs() {
	<Md content={mdSource} />
}
```

## Props

```ts
/**
 * Markdown renderer. SSR renders <div class="vesk-md">…</div>; on the
 * client it hydrates in place and re-renders when `content` is a tracked
 * cell. Defaults differ from raw renderMarkdown(): highlight/ids/autolink
 * default ON here.
 */
function Md(props: {
	content?: string | { get(): string }; // string or tracked cell (reactive)
	theme?: 'light' | 'dark';             // dark adds .vesk-md-dark
	codeBg?: string;                      // default code bg (fence bg= wins)
	codeFg?: string;                      // default code fg (fence fg= wins)
	css?: boolean | string;               // true → inject MD_BASE_CSS;
	                                      // string → inject verbatim
	highlight?: boolean;                  // default true
	ids?: boolean;                        // heading anchors. Default true
	autolink?: boolean;                   // linkify URLs. Default true
	lineNumbers?: boolean;                // default false
	copy?: boolean;                       // code copy button. Default true
	hardBreaks?: boolean;                 // two-space/backslash <br>. Default false
	html?: 'escape' | 'allow' | 'allowlist'; // per-instance policy override
	allowTags?: string[];
	class?: string; className?: string; style?: string;
}): Node | string;
```

Reactive content — live re-render per keystroke:

```vsk
let &[src] = track("# Hello")
<Md content={src} theme="dark" />
```

## Feature tour

| Feature | Syntax | Notes |
| --- | --- | --- |
| ATX + Setext headings | `# H1` / `Title\n===` | anchors with `ids` |
| Fenced code | ```ts … ``` or `~~~` | 20+ language profiles; unknown → escaped plain |
| Fence params | ```` ```ts bg=#0d1117 fg=#c9d1d9 ```` | first token = lang; safe color values only |
| Indented code | 4 spaces | tabs expand at 4 |
| Lists | `-`, `*`, `+`, `1.` | nesting by indent; non-1 `start` honored |
| Task lists | `- [x] done` | disabled checkboxes, `.md-task` classes |
| Tables | `\| a \| b \|` + `:--`/`:-:`/`--:` | alignment; `\|` escapes; malformed → paragraph |
| Bold/italic | `**b**`, `*i*`, `_i_` | CommonMark flanking: intraword `_` never emphasizes |
| Strikethrough | `~~x~~` | GFM |
| Inline code | `` `x` `` | matched backtick runs; always escaped |
| Links/images | `[t](url "title")`, `![alt](src)` | titles escaped into attrs; images get `loading="lazy"` |
| Reference links | `[t][ref]`, collapsed `[t][]`, shortcut `[t]` | definitions `[ref]: url "title"` collected outside fences; case-insensitive labels |
| Autolinks (opt-in) | bare URLs, `<https://…>`, `<user@host>` | trailing punctuation excluded; `<Md>` default on |
| Entities | `&copy;`, `&#169;`, `&#xA9;` | ~50 named + numeric; decoded then re-escaped so visible text is correct; code spans untouched |
| Hard breaks (opt-in) | two trailing spaces / backslash | → `<br />` |

## Code chrome

With highlight enabled (default in `<Md>`), fenced blocks render inside
`.md-code` with a language badge and Copy button (`data-md-copy`) that
activates after hydration:

````md
```ts bg=#0d1117 fg=#c9d1d9
const x: number = 1;
```
````

- `bg=`/`fg=` set per-block CSS custom properties; `bg=none` transparent.
- Values validated for safety (length/charset; function calls restricted
  to color functions like `rgb()` — anything else, e.g. `url(…)`, drops).
- Component-level `codeBg`/`codeFg` provide inherited defaults.
- `lineNumbers` emits per-line spans for CSS counters.

## Raw HTML policy

| Mode | Behavior |
| --- | --- |
| `'escape'` *(default)* | Every tag-like construct renders as visible escaped text; zero HTML passes |
| `'allowlist'` | Only allowed tags pass; attributes filtered — `on*` dropped, URL attrs (`href`, `src`, `xlink:href`, `poster`, `formaction`) sanitized via `sanitizeUrl`; comments never allowed |
| `'allow'` | Well-formed tags pass verbatim (comments, quoted attrs with `>`, self-closing); every passthrough warned |

Global config (see [Configuration](../../configuration/doc.md)):

```ts
md: { html: 'allowlist', allowTags: ['a', 'em', 'strong', 'code'] }
```

Per-instance overrides win: `<Md html="allow" />`.

Tags that actually **pass through** emit a deduped `[vesk-md]` warning
(collected via `renderMarkdownEx().warnings` / `drainMdHtmlWarnings()`);
`vesk build` prints a one-time summary. Disallowed tags are silently
escaped — escaping needs no warning. Prefer `'allowlist'`.

## Raw renderer API

For non-component use (build scripts, email templates):

```ts
/**
 * Render markdown to HTML. Legacy byte-stable defaults: no highlight,
 * no ids, no autolink unless asked; html policy 'escape'.
 */
function renderMarkdown(md: string, options?: MarkdownOptions): string;

/** Same, plus collected warnings: { html, warnings: [{ tag, sample }] }. */
function renderMarkdownEx(md: string, options?: MarkdownOptions):
	{ html: string; warnings: Array<{ tag: string; sample: string }> };

interface MarkdownOptions {
	highlight?: boolean; chrome?: boolean; lineNumbers?: boolean;
	copy?: boolean; ids?: boolean; autolink?: boolean; hardBreaks?: boolean;
	html?: 'escape' | 'allow' | 'allowlist'; allowTags?: string[];
}

/** Process-wide policy (fed from vesk.config md key). */
function configureMd(policy?: { html?: MdHtmlMode; allowTags?: string[] }): void;

/** Effective policy snapshot. */
function getMdPolicy(): { html: MdHtmlMode; allowTags: string[] };

/** Silence '[vesk-md]' console warnings (test hook). */
function setMdConsoleWarnings(enabled: boolean): void;

/** Drain bounded session warning collector (≤500 unique tags). */
function drainMdHtmlWarnings(): Array<{ tag: string; sample: string }>;

/** Escape & < > " to entities. */
function escapeHtml(s: string): string;

/** Allow http(s)/mailto/tel + relative; everything else becomes '#'. */
function sanitizeUrl(url: string): string;

/** Built-in stylesheet for .vesk-md (+ token colors + dark theme). */
const MD_BASE_CSS: string;
```

Styling: pass `css` to inject `MD_BASE_CSS` (or your own stylesheet
string) alongside the rendered markup.
