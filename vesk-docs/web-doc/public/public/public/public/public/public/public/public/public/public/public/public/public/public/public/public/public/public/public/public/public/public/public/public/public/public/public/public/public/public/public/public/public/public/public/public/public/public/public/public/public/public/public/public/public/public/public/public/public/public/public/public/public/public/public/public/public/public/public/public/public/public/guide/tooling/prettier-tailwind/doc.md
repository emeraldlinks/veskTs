# Prettier Plugin

Consistent formatting shouldn't stop at `.ts` files. This Prettier plugin
understands `.vsk` natively — statement-mode bodies, track declarations,
key/index loop clauses — because it formats with the real compiler parser
rather than guessing at syntax.

`@vesk/prettier-plugin` requires Prettier 3.

## Setup

Requires Prettier 3:

```sh
npm install -D prettier @vesk/prettier-plugin
```

`.prettierrc`:

```json
{
	"plugins": ["@vesk/prettier-plugin"]
}
```

## Usage

```sh
npx prettier --write app/**/*.vsk
```

## What it understands

- Registers language `vesk` (extensions `.vsk`, VS Code language id
  `vsk`, tmScope `source.vsk`)
- Parses with the actual Vesk parser (`createBaseParser` +
  `preprocessForClauses`) — not a regex rewriter — so every grammar
  feature formats correctly:
  - `component` declarations (incl. `client`, generics, async)
  - `let &[count, cell] = track(0)` track declarations
  - statement-mode bodies: bare JSX, `if`/`for`/`switch`/`try`
  - `for (const x of xs; key x.id; index i)` key/index clauses
    (hoisted before parse, spliced back after print)
  - `empty {}` loop alternates
  - `{#client}` / `{#server}` blocks
  - `<style>` elements
- Comments are collected from the AST and preserved

## Tailwind plugin pairing

The Prettier plugin only formats; class sorting inside `class` attributes
is not part of it. Combine with your usual Tailwind tooling for that.
