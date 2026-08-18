---
name: vesk-docs
description: Write and maintain comprehensive Vesk framework documentation (docu/, README, llms.txt) that is accurate, easy to understand for humans, and machine-findable for AI agents and search engines. Use when writing, updating, or auditing any Vesk documentation page, when asked to "document vesk", "write the docs", "update the README", regenerate llms.txt, or fix stale/incorrect documentation.
---

# Vesk Documentation

Write the Vesk framework's documentation for three audiences at once:

1. **Humans** — app developers and contributors who read narrative docs.
2. **AI agents** — LLMs that ingest docs to code against Vesk.
3. **Search engines** — crawlers that index the docs site.

Every page must satisfy all three. A page that reads well but makes claims an
agent cannot verify is broken. A page that is machine-accurate but unreadable
is broken. Fix both.

## Doc tree (source of truth)

The index is `docu/README.md`. Keep it updated whenever pages are added,
renamed, or removed.

```
docu/
├── README.md                  # index — keep links and one-line blurbs current
├── language/
│   ├── component.md           # component declarations, async/client modifiers
│   ├── reactivity.md          # track(), &[] destructure, derived, effect, untrack, peek, tick, flushSync
│   ├── statement-mode.md      # bare if/for/while/switch/try, JSX-as-statement, guard clauses
│   ├── expression-mode.md     # return <jsx>, .map()/ternary rules
│   ├── client-boundary.md     # `client` keyword, server-only-by-default, {#client}/{#server}
│   ├── defer.md               # streaming boundaries
│   ├── styles.md              # component-level style scoping
│   └── not-in-the-grammar.md  # explicit non-features
├── compiler/
│   ├── pipeline-overview.md   # acorn → parser → IR → codegen
│   ├── ir-format.md           # the IR node shape (packages/compiler/src/ir.ts)
│   ├── static-codegen.md      # static DOM patching / Future-A
│   └── client-reachability.md # how client/server boundary is traced
├── runtime/
│   ├── reactive-core.md       # runtime track() semantics, batching, derived
│   ├── hydration.md           # server-to-client handoff
│   └── deployment-targets.md  # Node-standard server by default
└── cli/
    ├── commands.md            # every `vesk` and `haul` command, flags, exit codes
    └── vite-adapter.md        # how the vite plugin works
```

Supporting artifacts, updated in the same pass:

- `README.md` (repo root) — quick start, package table, architecture diagram.
- `packages/cli/llms.txt` — the only llms.txt today; extend the convention to
  other packages and add a root `llms.txt` when the docs site ships.
- `FEATURES.md` — internal feature inventory vs React/Qwik/Astro. It is a seed
  for doc content, NOT doc prose: rework its claims into docu/ pages, never
  link to it from public docs.

## Hard rule: source of truth is the source

Never write a doc page from memory, from TODO.md, or from FEATURES.md alone.
Every claim must be traced to the implementation before it is written:

| Topic | Anchor files (read these first) |
| --- | --- |
| Grammar, keywords, reserved words | `packages/compiler/src/tokens.ts`, `vesk-plugin.ts`, `parser.ts`, `acorn-ts-plugin/` |
| IR | `packages/compiler/src/ir.ts`, `ir-generator.ts` |
| Codegen | `server-codegen.ts`, `client-codegen.ts`, `track-codegen.test.ts` |
| SSR behavior | `server-render.ts`, `server-jsgen.ts`, `server-utils.ts` |
| Config | `packages/compiler/src/config.ts` + `config.test.ts` |
| CLI | `packages/cli/src/index.ts`, `dev-server.ts`, `action-handler.ts` |
| Runtime reactivity | `packages/runtime/src/track.ts` (+ `track.test.ts`) |
| Hydration | `packages/runtime/src/hydrate.ts` + `hydration-test.mjs` (root) |
| Router/actions/ISR/SEO | `router.ts`, `action.ts`, `isr.ts`, `seo.ts` in compiler/runtime |
| Haul engine | `docs/haul.md`, `packages/haul/` (Go) |

Tests are spec: when source and a test disagree, the test documents intent —
resolve the discrepancy before writing, and report it. Treat status markers
like "Phase 1", "not yet supported", or "coming soon" with suspicion: check
the current source. Stale status lines are documentation bugs (see
`component.md` history).

### Verification workflow (per page)

1. Read the anchor files for the page's topic. Extract facts: signatures,
   keywords, syntax, default values, error messages, flag names.
2. Write the page, marking every claim with its source (internal comments or
   a "Verified against:" footer listing files + commit).
3. For component-body features, verify BOTH modes: statement mode and
   expression mode. A page that documents a body feature in only one mode is
   incomplete (AGENTS.md: statement mode is first-class).
4. Grep the source for the exact names you document (e.g. `flushSync`,
   `on_destroy`, `{#server}`) to confirm they exist and are spelled right.
5. Update `docu/README.md` index and any llms.txt files touched.
6. `git diff` the page; re-read for stale claims before finishing.

## Writing for humans

- Code-first: show a working example before explaining rules.
- Progressive disclosure: quick example → rule → edge cases → internals.
- One idea per section; short sections; headers that summarize.
- Use the actual Vesk syntax in all examples: `component Name() {}`,
  `const &[count] = track(0)`, `{expr}`, `class:name={bool}`, `on:click`.
- Every code sample must be plausible against the grammar: JSX in statement
  position is legal, `component` is reserved, `batch` does not exist.
- Prefer prose that explains WHY a rule exists (e.g. server-only-by-default
  rationale) — agents cannot infer motivation from code.

## Writing for AI agents

- Be unambiguous and machine-verifiable: exact function names, signatures,
  argument order, defaults, and error messages — no paraphrase of APIs.
- Keep a "Verified against:" footer on each page: files + commit hash of the
  verification pass (check `git rev-parse --short HEAD`).
- Follow the llms.txt convention (`llmstxt.org`): every package that ships a
  public surface gets `llms.txt` with package identity (name, version, ESM,
  Node range), entry points, command dispatch, config algorithm, and a
  "Verified against source at commit <hash>" line. Update the hash whenever
  the file changes.
- State negative facts explicitly (what does NOT exist: `batch`,
  `useState`, virtual DOM) — agents need the negation, not just the positive.
- Do not write "simple", "obvious", "just", or "as you know". Agents take
  claims literally.
- Keep the glossary of framework terms in one place (docu/README.md or a
  glossary page): component, island, cell, block, hydration, statement mode,
  expression mode — define each once, link everywhere.

## Writing for search engines

- Exactly one H1 per page; title matches the page's core query (e.g.
  "Vesk Reactivity: track, derived, effect" not "Part 2").
- Descriptive H2/H3 headings that contain the terms people search for
  (`track()`, `statement mode`, `hydration`).
- Language-tagged code fences (` ```vsk `, ` ```ts `, ` ```sh `) — never
  untagged.
- Internal links between related pages (language ↔ runtime ↔ compiler).
- No duplicated content across pages: state a fact once, link to it.
- If a docs site is served: canonical URLs, sitemap, and a root `llms.txt`
  + `llms-full.txt` at the site root.

## Completeness checklist

- [ ] All 15 docu/ pages exist, no broken links in `docu/README.md`
- [ ] Every page has a "Verified against:" footer (files + commit)
- [ ] Component-body features documented in statement mode AND expression mode
- [ ] No "Phase 1"/"coming soon" markers that contradict source
- [ ] `packages/cli/llms.txt` commit hash current; other packages' llms.txt
      added where the surface is public
- [ ] Examples use real grammar: `&[]`, `track`, `on:click`, `{#server}`
- [ ] `README.md` quick start works end-to-end (run it if unsure)
- [ ] Negative facts present: `batch` doesn't exist, no VDOM, `component`
      reserved, `on*` attrs excluded from SSR HTML
- [ ] No regex or non-standard syntax in docs' code samples (`.vsk` is a
      TS superset — every sample must survive `vskToTsx`)

## Working style

- Imperative mood, no second person, no emojis, no marketing superlatives.
- When a page contradicts source, the source wins; fix the page and note the
  change in the commit message.
- Batch related pages (all language, then all compiler, then runtime, then
  CLI) so verification reads are shared.