# lucide-vesk

Lucide icons for [Vesk](https://github.com/emeraldlinks/veskTs) — same props as `lucide-react`, fully typed, covers every Lucide icon, never scoped.

- **Same props as `lucide-react`** — `size`, `color`, `strokeWidth`, `absoluteStrokeWidth`, `class` / `className`, `style`, `aria-*`, `title`, `ref`, plus any SVG attribute.
- **Fully typed** — `LucideProps`, `IconNode`, `LucideIcon` exported from the same package; every icon is typed.
- **Covers all icons** — 1594 primary icons plus 205 aliases = 1799 exported names (lucide v0.511.0).
- **Never scoped** — no `<style>` tag, no Vesk scoped CSS, just an `<svg>` with Lucide defaults.

## Install

```bash
npm install lucide-vesk
```

## Usage in Vesk (.vsk)

```vsk
import { House, Search, Circle } from 'lucide-vesk'
import { createLucideIcon } from 'lucide-vesk'

component Page {
  <div>
    <House size={32} color="red" />
    <Circle size={16} color="blue" strokeWidth={1} />
    <Search size={48} absoluteStrokeWidth strokeWidth={2} className="opacity-50" />
  </div>
}
```

Works in both **statement mode** (bare JSX) and **expression mode** (`return <House />`).

```vsk
// expression mode
import { House } from 'lucide-vesk'
export component PageExpr(props: { n: number }) {
  return <div><House size={props.n} /></div>
}
```

## Props parity with lucide-react

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `string \| number` | `24` | Width and height |
| `color` | `string` | `"currentColor"` | Stroke color |
| `strokeWidth` | `string \| number` | `2` | Stroke width |
| `absoluteStrokeWidth` | `boolean` | `false` | Recalculate strokeWidth as `strokeWidth * 24 / size` |
| `class` / `className` | `string` | `""` | Merged with `lucide` and `lucide-{name}` |
| `style` | `string` | — | Inline style |
| `title` | `string` | — | Rendered as `<title>` for a11y |
| `aria-*`, `role` | — | — | If none present and no title/children, `aria-hidden="true"` is set |

All other SVG attributes (`fill`, `stroke`, `onClick`, etc.) are forwarded. Event handlers (`on*`) are excluded from SSR HTML (Vesk convention) and wired via `addEventListener` on the client.

```vsk
import { House } from 'lucide-vesk'
component Demo {
  <House size={24} color="red" strokeWidth={1.5} absoluteStrokeWidth className="my-class" aria-label="home" onClick={() => console.log("clicked")} />
}
```

## Generic Icon and Custom Icons

```ts
import { Icon, createLucideIcon } from 'lucide-vesk'
import type { IconNode } from 'lucide-vesk'

const MyIcon = createLucideIcon("my-icon", [["path", { d: "M0 0 L10 10" }]])
MyIcon({ size: 20, color: "green" }) // -> SVG string (server) or SVGSVGElement (client)
```

`Icon` is the primitive used by every generated icon — you can also render any `IconNode` directly:

```vsk
import { Icon } from 'lucide-vesk'
import { House } from 'lucide-vesk'
component Demo {
  // House.__iconNode is the raw IconNode
  <Icon iconNode={House.__iconNode} size={24} />
}
```

## Tree-shaking

Import per-icon via the barrel (tree-shakable) or via subpath:

```ts
import { House } from 'lucide-vesk'
import { House } from 'lucide-vesk/icons/House'
```

## Never Scoped

lucide-vesk never emits `<style>` and never uses Vesk's scoped CSS. Icons are unstyled except for Lucide's `defaultAttributes` (`xmlns`, `viewBox`, `fill="none"`, `stroke="currentColor"`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`). You can style them via `class`/`style` or global CSS.

```ts
import { House } from 'lucide-vesk'
// no style tag is emitted — check dist files contain no "<style"
```

## Coverage

- 1594 primary icons from `lucide@0.511.0`
- 205 aliases (e.g. `AlarmCheck` for `AlarmClockCheck`, `ArrowDownAz` for `ArrowDownAZ`, `SortDesc` for `ArrowDownWideNarrow`)
- Total 1799 exported names — run `npx tsx scripts/generate.ts` to regenerate from the installed `lucide` package.

## Types

```ts
import type { LucideProps, IconNode, LucideIcon } from 'lucide-vesk'

const props: LucideProps = { size: 24, color: "red", absoluteStrokeWidth: true }
const node: IconNode = [["path", { d: "M0 0" }]]
const Comp: LucideIcon = createLucideIcon("test", node)
```

## License

ISC — same as [Lucide](https://github.com/lucide-icons/lucide).
