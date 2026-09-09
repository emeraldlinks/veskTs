# Vesk — Session Summary (2026-09-09, afternoon)

## Goal
Fix the framework so nested route layouts compose fully on the server, matching
the client — specifically `/docs/[slug]` must receive the **docs layout AND the
root layout** (fonts/favicon/header/sidebar), not just the innermost ancestor.
Then complete the vesk-doc docs-layout refactor and browser-verify.

## WORKING (verified)

1. **SSR full layout-chain composition** — `packages/adapter/src/ssr-function.ts`
   (prod) and `packages/adapter/src/hmr.ts` (dev `regenerateSsrFunction`) now build
   `layoutStack = [...ancestorLayouts(outermost-first), ...ownLayout]` and emit
   `_layoutSrcList/_layoutCompList/_layoutPathList/_layoutCompiledList`. The html
   path renders inner→outer via `renderPage` then `renderFullPage(_layoutSrcList[0],…,pageHead)`;
   the data head loop and `__registerActions` walk the full list. Root layout `<Head>`
   (fonts/favicon) is preserved on nested routes.
   - Adapter typecheck + build clean (`npx tsc -p packages/adapter/tsconfig.build.json`).
   - New `packages/adapter/src/ssr-function.test.ts`: **14 assertions, all pass**
     (dynamic page emits `_layoutSrcList`; root-before-docs ordering; inner-first wrap
     loop; data head loop; `renderFullPage` outer call; own-layout after ancestor;
     no-layout stream path unchanged).
2. **vesk-doc SSR broken imports fixed**: `app/components/docs/DocsSidebar.vsk`
   `../../src/content/docs` → `../../../src/content/docs`; `DocsHeader.vsk`
   `./docs/DocsSidebar.vsk` → `./DocsSidebar.vsk`. (Extensionless `.ts` resolves via
   `resolveSsrModule`/`probeFile`.)
3. **SSR verification (curl, dev :3007)**: `/docs` and `/docs/getting-started` →
   HTTP 200; `Search docs` (sidebar), header, `back to vesk.dev`, and `fonts.googleapis`
   ×3 (root layout) all present. No `vesk-ssr-error`.
4. Non-docs routes hydrate correctly in a real browser: `/`, `/blog`, `/about`,
   `/posts` keep `#root` + render h1 (puppeteer-core, chromium).
5. Prior session states intact: lazy SSR barrel loading, hash-mode routing, tailwind
   theme fix, fragment-parser fix, tarballs re-pinned to
   `0.2.16-ci.1788930419437` in vesk-doc.

## BROKEN (blocking)

6. **Client-side wipe on nested-layout routes (dev browser, puppeteer-core)**:
   `/docs` + `/docs/getting-started` SSR correctly, but after client JS runs the
   **entire `#root` and all SSR content disappear**; the final DOM is the dev
   server's *shell variant* — module scripts + `#__vesk_dev` widget +
   `<head>`-injected `page-index.js`/`page-docs.js` preloads — with **no** `#root`
   and **no** `<!--vsk-->` markers. Zero page/console errors, HTTP 200 both loads,
   `<title>` + fonts persist.
   - Raw HTTP response (23,391 B) HAS `#root` + SSR content and NO dev widget;
     final outerHTML (26,990 B) has the widget + injected head chunks and NO `#root`.
   - Bisection (block individual scripts): block `client.js` → page intact (SSR stays);
     block `page-docs.js` → `#root` survives + pageerror `node.layout is not a function`
     (docs layout chunk missing, error boundary renders). So the wipe happens through
     the client hydration path **with the docs layout chunk present**.
   - Not HMR: WebSocket neutered + `location.*` patched → wipe persists, zero
     `location.replace/assign/reload` calls, zero DOM mutations observed
     (observer on `document.documentElement` subtree saw nothing → the document is
     replaced internally, detaching the observed tree — e.g.
     `document.replaceChild(docElement, …)` — or a second server response is committed).
   - Prime suspect: nested-layout hydration claim in `packages/runtime/src/router.ts`
     `renderLayoutChain` (≈:1070–1098) + `packages/runtime/src/hydrate.ts`
     `createHydrateWalker` marker ordering for nested slot trees, plus the dev-server
     shell-fallback decision (the `__vesk_dev` widget exists only in the shell
     template, never in the SSR page).
7. `vesk-doc` prod `.vesk` build is stale (pre-chain layout format) — needs a fresh
   `npm run build` + `npm run start` once the browser hydration issue is closed.

## Next steps
1. Trace the shell: in puppeteer log **every** network request/response while loading
   `/docs` — confirm whether a second GET `/docs` returns the widget-shell (a server
   response difference) or the document is replaced client-side. Grep the dev server
   bundle for the `__vesk_dev` injection site (only the shell template contains it).
2. Fix the hydration claim for nested layouts in `router.ts`/`hydrate.ts` (walker
   subWalker ordering across nested `{children}` slots; keep claims/removals to the
   slot subtree only, never touch `#root` or the outer document).
3. Rebuild packages (`npx tsx packages/cli/src/build-packages.ts`), refresh vesk-doc
   tarballs (`node scripts/refresh-testapp-deps.mjs vesk-doc`), verify with puppeteer:
   full page + hard reload → `#root` survives, sidebar/header/content render, hydration
   markers → 0, zero errors, on `/docs` and `/docs/[slug]`. Then `node tests/hydration-test.mjs`.
4. Rebuild vesk-doc prod (`npm run build` + `npm run start`), re-verify, then clean up
   `probe-*.mjs` throwaways and update TODO.md.

## Root-cause clues (gathered)
- `createHydrateWalker.nextElement` removes the marker comment before mapping; on
  exhaustion it fabricates new elements — a nested-chain marker-count mismatch makes
  claims degrade silently, then the error/fallback path re-renders and the dev shell
  replaces everything. Hydration catch in `matchHydrate` falls back to `renderMatch`
  (container only) — so the wipe is likely a higher-level document replacement, not
  that catch path.
- `client.js` (dev) end: match → `ensureChunk` per chain chunk → `createFileRouter`
  → `__router.start()`; hydrators live in `page-docs.js`/`page-index.js` chunks.

## Commit status
- Pushed: adapter full-chain SSR fix + `ssr-function.test.ts` + vesk-doc docs layout/
  components/import fixes + tarball re-pin. Browser hydration wipe still open — see
  "Broken".