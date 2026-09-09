# Markdown

Vesk includes a built-in `<Md>` component and `renderMarkdown()` function
for rendering Markdown content. The implementation is tokenizer-based (no
regex) and supports syntax highlighting, GFM, and configurable HTML
policies.

## Md component

```vsk
<Md content="# Hello\n\nThis is **bold**." />
```

### Content types

The `content` prop is polymorphic:

| Type | Behavior |
|------|----------|
| `string` | Literal markdown, rendered synchronously |
| `Tracked<string>` | Reactive — re-renders when the cell changes |
| `Resource<string>` / `useFetch.stream` | Streaming — progressively renders chunks |
| `"/path/to/*.md"` | Runtime-loaded from `public/` directory |

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `content` | `string \| Tracked<string>` | — | Markdown source |
| `class` | `string` | — | CSS class on wrapper |
| `css` | `boolean \| string` | `true` | Include built-in styles (`true`/`false`/custom CSS string) |
| `lineNumbers` | `boolean` | `false` | Show line numbers in code blocks |
| `copy` | `boolean` | `true` | Show copy button on code blocks |
| `highlight` | `number[]` | — | Line numbers to highlight |
| `hardBreaks` | `boolean` | `false` | Treat newlines as `<br>` |
| `html` | `'escape' \| 'allow' \| 'allowlist'` | `'escape'` | How to handle inline HTML |
| `theme` | `'light' \| 'dark'` | — | Syntax highlight theme |

### Examples

#### Static content

```vsk
component Docs() {
  return <Md content="## Installation\n\nRun `npm install`." />;
}
```

#### Reactive content

```vsk
component LiveEditor() {
  let &[source] = track('# Hello\n\nEdit me!');

  return (
    <div>
      <textarea value={source} onInput={(e) => source = e.target.value} />
      <Md content={source} />
    </div>
  );
}
```

#### From public directory

```vsk
<Md content="/docs/readme.md" />
```

#### Streaming

```vsk
component StreamDocs() {
  const resource = useFetch.stream('/api/docs', { into: content });
  let &[content] = track('');

  return <Md content={content} />;
}
```

## renderMarkdown function

For imperative use outside components:

```ts
import { renderMarkdown } from '@vesk/runtime';

const html = renderMarkdown('# Hello\n\nWorld', {
  chrome: true,
  lineNumbers: false,
  copy: true,
});
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `chrome` | `boolean` | Add code block chrome (filename bar, copy button) |
| `lineNumbers` | `boolean` | Show line numbers |
| `copy` | `boolean` | Show copy button |
| `ids` | `boolean` | Add `id` attributes to headings |
| `autolink` | `boolean` | Auto-link URLs |
| `hardBreaks` | `boolean` | Newlines become `<br>` |
| `html` | `MdHtmlMode` | HTML policy |
| `allowTags` | `string[]` | Allowed HTML tags (when mode is `'allowlist'`) |

## HTML policy

Inline HTML in markdown is controlled by the `html` option:

- `'escape'` (default) — all HTML is escaped, rendered as text
- `'allow'` — raw HTML passes through
- `'allowlist'` — only tags in `allowTags` are allowed; everything
  else is escaped

Configure globally:

```ts
import { configureMd } from '@vesk/runtime';

configureMd({ html: 'allowlist', allowTags: ['br', 'strong', 'em'] });
```

## Features

- GFM hard breaks
- Fenced code blocks with syntax highlighting
- Heading anchors (with `ids: true`)
- Autolinks
- Code block chrome (filename bar, copy button)
- Line highlighting
- Line numbers
- HTML escaping/allowlisting

## Verified against

- `packages/runtime/src/md.ts` — `Md`, `renderMarkdown`, `configureMd`
- `packages/runtime/src/index-client.ts` — `Md` export
