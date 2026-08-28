# Maintainers

Internal documentation for Vesk framework maintainers. User-facing docs
live in [`docs/guide/`](../guide/index.md); the older verified reference
pages live in `docu/` at the repo root.

## Contents

| Path | Contents |
| --- | --- |
| [analysis/](analysis/) | Engineering analyses: parser, compiler pipeline, reactivity runtime, LSP Volar migration, reusable-vs-discard decisions |
| [decisions/](decisions/) | Architecture decision records: 000 fork source, 001 IR format |
| [haul.md](haul.md) | The parked native Go engine (haul). **Do not build or ship from main** — lives on the `haul-parked` branch only |

## Also essential (repo root)

- `AGENTS.md` — hard rules for every change (no regex in compiler, statement-mode parity, tests required, rebuild command)
- `scripts/AGENTS.md` — ports, release order, sentinel formats
- `packages/runtime/AGENTS.md` — barrel split rules, no-batch rule
- `docu/compiler/` — IR format, pipeline overview, static codegen, client reachability (verified against source)
- `docu/cli/plugin-api.md`, `docu/runtime/*` — verified per-module notes
- `llms.txt` + per-package `llms.txt` — machine-readable surface maps
- `TODO.md` — living task tracker; read at session start, update after work

## Non-negotiables when changing this framework

1. **Never use regex in the compiler/codegen.** All source manipulation goes through the tokenizer/AST (`acorn` + acorn-ts-plugin + vesk-plugin.ts).
2. **Every feature works in both body modes** (expression + statement) and is tested in both.
3. **Every job ships with tests** — unit suites plus the production hydration path (`node hydration-test.mjs`).
4. **Rebuild after compiler edits**: `npx tsx packages/cli/src/build-packages.ts`.
5. **All public types live in `@vesk/types`.**
6. **haul is parked** on `haul-parked`; do not reference it from main.
7. Docs edits follow `docu/` conventions: verify against source, both body modes, "Verified against" footer.
