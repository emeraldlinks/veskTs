# @vesk/plugin-tailwind — Documentation

> Tailwind CSS v4 plugin for Vesk. Scans `.vsk`/`.ts`/`.tsx`/`.js`/`.jsx` files for class
> attributes, builds a candidate list, runs the Tailwind compiler, and reports dependencies for
> HMR/watch rebuilds.

- **Language:** TypeScript (ESM)
- **Dependencies:** `@tailwindcss/node`, `@tailwindcss/oxide`
- **Version:** 0.1.3

## Public API

```ts
import tailwindcss from '@vesk/plugin-tailwind';

tailwindcss({ entry: 'src/global.css', appDir: 'app' })
// → { name, dependencies, onBuildStart, onCSS, onFileWatch }
```

### `TailwindOptions`

- `entry?: string` — path to the CSS entry file (default `'src/global.css'`).
- `appDir?: string` — directory to scan for class candidates (default `'app'`).

### `TailwindPlugin` (returned object)

- `name: string` — always `'@vesk/plugin-tailwind'`.
- `dependencies: Set<string>` — populated during `onCSS` with files the Tailwind compiler reads.
- `onBuildStart(): Promise<void>` — resets `dependencies` to a new empty set.
- `onCSS(content: string, filePath: string): Promise<string | null>` — called by the Vesk build/dev pipeline for each CSS file. Only processes the configured `entry` file; returns `null` for others (pass-through). Extracts Tailwind directives (`@import`, `@theme`, `@layer`, `@utility`, `@source`), compiles them via `@tailwindcss/node` (fallback: `tailwindcss`), scans the project for class candidates, and returns the final CSS.
- `onFileWatch(filePath: string): Promise<{ handled: boolean }>` — returns `{ handled: true }` when the changed file is in `dependencies`; otherwise `{ handled: false }`.

### `extractTailwindDirectives(css: string): { directives: string; userCSS: string }`

Exported helper. Splits a CSS source into Tailwind directives and user CSS, handling braces inside strings and comments correctly.

## How it works

1. `onCSS` is called with the content of `src/global.css` (or the configured entry).
2. `extractTailwindDirectives` separates `@import 'tailwindcss'`, `@theme { ... }`, `@layer ...`, `@utility ...`, `@source ...` from user CSS.
3. `@tailwindcss/node`'s `compile(directives, opts)` generates the Tailwind CSS.
4. `scanCandidates(baseDir)` walks `appDir` (skipping `node_modules`, `dist`, `.vesk`, `.vercel`, `.git`), reads every `.vsk`/`.js`/`.ts`/`.jsx`/`.tsx` file, and extracts class names from `class="..."` / `class='...'` attributes using `CLASS_RE`.
5. `result.build(candidates)` produces the final CSS.

## Common mistakes + fixes

| Mistake | Fix |
|---|---|
| Plugin does nothing in dev | Ensure `vesk.config.ts` includes `plugins: [tailwindcss({ entry: 'src/global.css', appDir: 'app' })]`. The `onCSS` hook only fires for the configured entry file. |
| Classes not detected | `scanCandidates` only reads `class="..."`/`class='...'` attributes. Dynamic class bindings (e.g. `class={condition ? 'a' : 'b'}`) are NOT scanned. |
| HMR not triggered for CSS deps | The plugin populates `dependencies` during `onCSS` via `onDependency`. If Tailwind reads a file (e.g. `@source`), changes to that file return `{ handled: true }` and trigger a rebuild. |
| Build fails with `@tailwindcss/node` import error | The plugin falls back to `tailwindcss` if `@tailwindcss/node` is unavailable. Ensure `@tailwindcss/oxide` native binary is installed for your platform. |

## Testing

```bash
cd /root/vesk/packages/plugin-tailwind
npx tsx src/index.test.ts    # 6 tests (extractTailwindDirectives only)
```
