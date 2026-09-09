# Vesk — Session Summary (2026-09-09, afternoon)

## RESOLVED — client-side wipe on nested-layout routes
The blocking browser hydration wipe is fixed and browser-verified.

**Root cause:** `hydrateInitial`'s `renderLayoutChain` in
`packages/runtime/src/router.ts` rendered each nested layout **eagerly,
inner-first**, so the innermost layout (docs) called `walker.nextElement(...)`
and claimed the OUTER (root-layout) SSR markers. The SSR markers are laid out
in DOM order (outermost-first), but claiming happened inner-first, so every
nested layout claimed the wrong element and fabricated fresh DOM, cascading a
marker-count mismatch across the entire `#root` and wiping all SSR content
through the error/fallback path (final DOM = dev shell with no `#root`).

**Fix:** `renderLayoutChain(i)` now returns a hydrator **function** that only
renders a layout when its enclosing layout's `{children}` slot invokes it (via
`props.children(walker.subWalker(...))`). Claims therefore run outermost →
innermost, matching document order, while the outer layout still wraps the
inner result. Invoked as `runInBlockWindow(() => renderLayoutChain(0)(walker))`.

**Verified (real chromium via puppeteer-core):**
- vesk-doc dev :3007 — `/docs`, `/docs/getting-started` (root+docs layout),
  `/`, `/blog`, `/blog/first-post` all keep `#root`, render the full chain
  (fonts/header/footer/sidebar/search), claim every `vsk` marker (0 leftover),
  zero console/page errors; SPA nav + hard reload survive.
- test-app — new `app/store/layout.vsk` nested fixture added; new
  **Test 19 (18 assertions)** in `tests/hydration-test.mjs` proves `#root`
  survives, all markers claimed, both layout levels + page render, SPA nav and
  hard reload work with zero errors. Full suite: **299 passed, 0 failed**.
- Unit: router 69, hydrate 13, client-codegen 207, integration 124. Typecheck clean.

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

6. **(RESOLVED this session)** Client-side wipe on nested-layout routes — see
   "RESOLVED" at the top. Root cause was inner-first marker claiming in
   `hydrateInitial`'s `renderLayoutChain`; fixed by deferring each inner layout
   to a hydrator function invoked from its enclosing layout's `{children}` slot.
7. `vesk-doc` prod `.vesk` build — not re-run this session (dev-path verified).

## Next steps (remaining)
1. Rebuild vesk-doc prod (`npm run build` + `npm run start`) and re-verify the
   prod hydration path, since only the dev path was re-run.
2. Note: `tests/dev-test.mjs` currently fails to boot because the loose
   `packages/adapter/dist/*.js` (built with `moduleResolution: bundler`) emits
   extensionless relative imports that raw Node ESM cannot resolve
   (`dist/dev-api.js` imports `./plugins`). This is pre-existing and independent
   of the hydration fix; the `vesk` CLI (bundled `dist/cli.js`) and all browser
   tests are unaffected. A durable fix = emit `.js` extensions in the adapter/
   compiler dist (e.g. `rewriteRelativeImportExtensions` / NodeNext).

## Root-cause clues (resolved)
- `createHydrateWalker.nextElement` removes the marker comment before mapping; on
  exhaustion it fabricates new elements. With nested layouts, `hydrateInitial`'s
  `renderLayoutChain` rendered inner layouts eagerly and called `nextElement`
  against the root walker in inner-first order, so each nested layout claimed the
  OUTER layout's markers and fabricated fresh DOM, cascading a marker-count
  mismatch across `#root` through the error/fallback path (dev-shell replacement).
  Fixing claim order (outermost→innermost, via function-style child hydrators)
  makes claims match document order and keeps claims inside each slot subtree.
- `client.js` (dev) end: match → `ensureChunk` per chain chunk → `createFileRouter`
  → `__router.start()`; hydrators live in `page-docs.js`/`page-index.js` chunks.

## Commit status
- Pushed this session: `router.ts` nested-layout hydration fix + test-app
  `store/layout.vsk` nested fixture + `tests/hydration-test.mjs` Test 19 (18
  assertions) + fresh CI tarball re-pins for test-app and vesk-doc.