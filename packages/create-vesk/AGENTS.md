# AGENTS.md — create-vesk

Module-specific rules for `packages/create-vesk/src/index.js`. Extends repo-level `/root/vesk/AGENTS.md`.

## Hard rules

1. **Zero dependencies.** Do not add npm dependencies to `package.json`. The scaffold must work in a fresh `npx create-vesk@latest` invocation without pre-installing anything.
2. **ESM-only.** `src/index.js` uses `import` and `process` — do not convert to CJS.
3. **Keep templates in sync with the actual framework surface.** If `vesk.config.ts` or `tsconfig.json` conventions change in the framework, update the scaffold templates.
4. **The release script patches hardcoded `^0.1.0` strings.** If you change the placeholder version in `src/index.js`, also update `scripts/release.mjs`'s `replaceAll(/\\^0\\.1\\.0/g, ...)`.

## Commands

```bash
cd /root/vesk/packages/create-vesk
npm run typecheck   # noop (no tsconfig)
npm run build       # noop (no build script)
```

## File responsibility map

| File | Responsibility |
|---|---|
| `src/index.js` | Entire scaffold logic: directory creation, file writing, success message. |
| `package.json` | Package metadata + bin. |

## Do / Don't

**Do**
- Keep the scaffold minimal and functional — the generated project should pass `npm install && npm run dev` immediately.
- Use `JSON.stringify(..., null, 2)` for generated JSON files.

**Don't**
- Don't add files that require additional dependencies beyond what's already scaffolded.
- Don't use syntax not supported in Node 20.
