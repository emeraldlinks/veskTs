# AGENTS.md — @vesk/plugin-tailwind

Module-specific rules for `packages/plugin-tailwind/src/index.ts`. Extends repo-level `/root/vesk/AGENTS.md`.

## Hard rules

1. **The plugin hook contract is defined by `VeskPlugin` in `@vesk/compiler/src/types.ts`.** The returned object MUST have `name`, `dependencies`, `onBuildStart`, `onCSS`, `onFileWatch` (matching the interface in `index.d.ts`). Missing hooks cause `validateConfig` to throw in the compiler.
2. **`onCSS` only fires for the configured entry file.** The plugin compares `filePath` to `options.entry` and returns `null` (pass-through) for everything else.
3. **`scanCandidates` uses regex (`CLASS_RE`)** — this is acceptable here because it's runtime CSS candidate scanning, NOT compiler source parsing. The AGENTS.md no-regex rule applies to `packages/compiler/src`, not to runtime/plugin modules.
4. **Keep `index.d.ts` in sync** with `src/index.ts` — the package ships types from `dist/index.d.ts`.

## Commands

```bash
cd /root/vesk/packages/plugin-tailwind
npx tsx src/index.test.ts
npm run typecheck
npm run build
```

## File responsibility map

| File | Responsibility |
|---|---|
| `src/index.ts` | Plugin factory, CSS directive extraction, candidate scanning, Tailwind compile invocation. |
| `src/index.d.ts` | Public type declarations. |
| `src/index.test.ts` | Unit tests for `extractTailwindDirectives` (6 cases). |
| `package.json` | Deps on `@tailwindcss/node` + `@tailwindcss/oxide`. |

## Do / Don't

**Do**
- Keep `extractTailwindDirectives` pure and well-tested (brace counting is tricky with strings/comments).
- Add tests for any new candidate-scanning logic.

**Don't**
- Don't move server-only logic into this plugin — it runs in the build/dev process only.
- Don't import `@vesk/runtime` or `@vesk/compiler` here.
