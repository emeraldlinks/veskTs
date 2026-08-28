# TypeScript in `.vsk`

You never leave TypeScript while building a Vesk app. Props, state,
helpers, API responses — type them like any other TS project and your
editor plus the compiler keep you honest. `.vsk` files accept every
TypeScript construct, the compiler quietly removes type-only syntax from
what ships to browsers, and `vesk typecheck` gives the whole project a
strict, editor-grade check.

In other words: full TS safety in your components, zero TS cost in your
bundles.

## What works

```vsk
// interfaces & type aliases (top level and inside bodies)
interface Post {
	id: number;
	title: string;
}
type Filter = 'all' | 'done';

// typed props + destructuring + optional props
component Posts(props: { items: Post[]; filter?: Filter }) { … }

// generics on components
component List<T>(props: { items: T[]; render: (item: T) => any }) { … }

// tracked cells with type arguments
let &[posts] = track<Post[]>([])
const &[count] = track<number>(0)

// casts, assertions, non-null
const n = count as number;
const cfg = value satisfies Config;
const el = document.getElementById('x')!;

// enums, unions/intersections/mapped/conditional/utility types,
// keyof typeof, template literal types, optional chaining,
// destructuring, statement-mode casts
```

Limitations (same as TSX):

- Angle-bracket type assertion `<T>expr` is not available — use
  `expr as T`. Generic arrow functions need a trailing comma: `<T,>(x) => …`.

## Type-only imports

```vsk
import type { VeskRequest } from '@vesk/types';
import { type Todo } from './types';
import { TodoItem } from './TodoItem.vsk';   // component import
```

- `import type …` and inline `{ type A }` imports are dropped from both
  compiled bundles.
- They are never mistaken for `.vsk` component imports.

## Runtime type stripping

The compiler removes annotations, `as` / `satisfies` / `!` wrappers
(recursively — `a as unknown as B` strips fully), type arguments, and drops
type-only statements (interfaces, aliases, enums, `declare`) from emitted
JS. This runs through the AST/tokenizer — no regex — so formatting and
source maps stay intact.

## Typechecking

Two complementary commands:

```sh
npx tsc --noEmit          # standard project check via tsconfig
npx vesk typecheck        # tsc-in-.vsk language service (strict default)
```

How it works:

1. Each `.vsk` file is transformed to TSX (`vskToTsx`): `component`
   declarations become functions, TrackDecls become typed aliases,
   `<style>` blocks and the island modifier are stripped.
2. A matching `.d.ts` is generated (`generateVskDts`) preserving props
   types, imports and type declarations.
3. TypeScript checks everything in memory — no temp files on disk, like
   vue-tsc/Volar.

```sh
vesk typecheck --no-strict   # opt out of strict mode
```

Exit code 1 on errors; diagnostics print as
`file(line,col): TSCODE: message`.

### Ambient surface

Inside `.vsk` files these are ambiently declared for the checker:
auto-importable runtime helpers (`useFetch`, router hooks, `Link`,
`NavLink`, `Outlet`, `Form`/`Field` + validators, SEO schema helpers,
`redirect`/`notFound`/`NotFoundError`) plus framework types
(`Component`, `LayoutProps`).

## tsconfig for Vesk projects

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "ESNext",
		"moduleResolution": "bundler",
		"strict": true,
		"noEmit": true,
		"jsx": "preserve",
		"jsxImportSource": "@vesk/compiler",
		"lib": ["ES2022", "DOM", "DOM.Iterable"],
		"paths": {
			"@/*": ["./src/*"],
			"@app/*": ["./app/*"]
		}
	},
	"include": ["**/*.vsk", "**/*.js", "**/*.ts"],
	"exclude": ["node_modules", "dist"]
}
```
