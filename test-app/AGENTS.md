# AGENTS.md — test-app/

Module-specific rules for `/root/vesk/test-app/`. Extends repo-level `/root/vesk/AGENTS.md`.

## Hard rules

1. **This is a fixture, not a library.** Do not "clean up" or refactor the demo pages arbitrarily — they exist to exercise specific compiler/runtime features (statement mode, async load, map, hydration, error boundaries, middleware, API routes, server actions).
2. **Dependencies are pinned to local tarballs.** `package.json` uses `file:./tarballs/vesk-*.tgz`. Do not change to registry versions without regenerating the tarballs (`npm run release` or `npm pack` per package).
3. **The `.vesk/` directory is build output.** It is gitignored in real projects but present here for E2E tests. Do not commit generated `.vesk/` changes that aren't part of a build-output fix.
4. **Keep the route inventory in sync.** If you add/remove pages, update `app/layout.vsk` navigation AND the route table in `llms.txt`.

## Commands

```bash
cd /root/vesk/test-app
npm install                # installs from local tarballs
npm run dev                # http://localhost:3000
npm run build              # → .vesk/
npm run start              # serve .vesk/
npm run typecheck          # tsc --noEmit
```

## File responsibility map

| File/dir | Responsibility |
|---|---|
| `vesk.config.ts` | Framework config (security, plugins, ssg). |
| `app/` | Route files, middleware, API routes. |
| `src/global.css` | Tailwind CSS entry. |
| `public/` | Static assets. |
| `tarballs/` | Local package tarballs for `npm install`. |

## Do / Don't

**Do**
- Run `npm run build` and `npm run start` after changes to verify SSR output.
- Run `node hydration-test.mjs` from the repo root after reactivity/hydration changes.

**Don't**
- Don't remove demo pages without confirming no test references them.
- Don't upgrade framework dependencies without regenerating tarballs and running the full E2E suite.
