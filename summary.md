# Vesk Standalone Layout Implementation — Session Summary

## Goal
Implement standalone layout support so routes with `export const standalone = true` or `props: { standalone: boolean }` in their `layout.vsk` skip the root `app/layout.vsk` nesting, while all other routes inherit the root layout.

## Completed

### Compiler — `packages/compiler/src/router.ts`
- Added `isStandaloneLayoutFile()` — AST-based detection (no regex) for:
  - `export const standalone = true` / `export let standalone = true`
  - `export standalone = true`
  - `component Layout(props: { standalone })` (no type annotation)
  - `component Layout(props: { standalone: boolean })`
  - `component Layout(props: { standalone: true })`
- `scanDirectory()` now sets `standalone: true` on nodes whose `layout.vsk` passes the check
- `matchUrl()` uses `pushWithStandalone()` helper that clears the accumulated `chain` then pushes the node when `standalone` is true
- `generateRouteManifest()` emits `standalone: true` in node JSON
- Fixed `/` matching root page instead of first child page (`requestedPath`/`fullPath` comparison gate)
- Fixed trailing segment matching for static and dynamic routes (`remaining.length === 0 && node.page` check before recursing children)

### Runtime — `packages/runtime/src/router-match.ts`
- Added `standalone?: boolean` to `RouteNode` type
- `flattenLayoutChain()`: on a standalone node, `result.length = 0` (clears ancestor chain) before pushing
- `collectLayouts()`: on a standalone matched node, `layouts.length = 0` before pushing

### Runtime — `packages/runtime/src/router.ts`
- `buildRouteTree()` passes `standalone` through from `def` on parent and child nodes

### Types — `packages/types/src/index.ts`
- `RouteNode` interface gains optional `standalone?: boolean`

### Prior fixes carried forward in this branch
- `packages/adapter/src/hmr.ts` — resolves `absSourceDir` and triggers `doFullBuild()` + `broadcast('reload')` for new `page.vsk` / `layout.vsk` files
- `packages/adapter/src/dev-server.ts` — `doBuild` now broadcasts `error` via `buildErrorPayload` and replays `pendingInitialError` after `createHmrServer`
- `packages/runtime/src/hmr-client.ts` — acorn parse errors surface raw message (`'Parse error — ' + raw`), `handleError` pushes to `log` + `console.error`
- `vesk-doc` marketing pages created (compiler, features, native, vesk, showcase, examples, api-docs, community/*, contact, comparison)
- `Footer.vsk` / `Showcase.vsk` — replaced `#top` placeholders with real `href`s
- `DocsSidebar.vsk` — search now filters with `derived()` reactively
- `vesk-doc/app/showcase/aurora/page.vsk` + `fieldbook/page.vsk` — wrapped literal `{`/`}` code blocks in single template strings to avoid SSR `{...}` interpretation

## Works
- `standalone` flag detected from both `export const standalone = true` and `props: { standalone }` forms
- `flattenLayoutChain()` and `collectLayouts()` drop ancestor layouts for standalone nodes
- `matchUrl()` (compiler) returns only the standalone node + its children, no root layout
- `/` matches root page only
- `/docs` static paths match their page correctly (fixed by trailing-segment gate)
- All packages build: `npx tsx packages/cli/src/build-packages.ts`

## Does Not Work / Known Issues
- **Adapter SSR/dev-server (`packages/adapter/src/index.ts`)** has NOT been updated to respect `standalone` — SSR generation may still wrap standalone routes with ancestor layouts
- Server-side E2E verification with a real dev server is untested (unit-level `matchRoute`/`matchUrl` checks pass)
- `collectLayouts()` still iterates ALL siblings and pushes all sibling layouts in its raw traversal — callers must consume the flattened `matchChain`, not the raw `collectLayouts` output; `collectLayouts` is not currently consumed by any production runtime path matching (only `flattenLayoutChain` is), so impact is documentation-level, not a rendering bug

## Next
1. Wire `standalone` through `packages/adapter/src/index.ts` SSR generation (`collectAncestorLayouts`/render pipeline) so SSR does not wrap standalone routes with `app/layout.vsk`
2. Add standalone layout test coverage (`packages/runtime/src/router.test.ts` and/or compiler router test) and hydrate a standalone route E2E
3. Run `node tests/hydration-test.mjs` after any hydration-path change per `packages/runtime/AGENTS.md`
4. Mark `standalone` in `docs.md` / `llms.txt` after verification
5. Remove test scaffolding (`app/standalone-test`, `app/standalone-props-test`) or promote to real examples before merge
