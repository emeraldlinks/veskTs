# Changelog

All notable changes to Vesk. Versions follow [semver](https://semver.org/); `latest` only moves on a stable release, and `canary` tracks `main`.

## 0.2.92 — 2026-10-31

_No breaking changes._

### Fixes

- dev-script pair count mismatch — remove dev-config.js from DEV_SCRIPTS

## 0.2.91 — 2026-10-31

_No breaking changes._

### Fixes

- SSR relative fetch URLs + middleware top-level const declarations

## 0.2.90 — 2026-10-30

_No breaking changes._

### Fixes

- ensure redirect/permanentRedirect/notFound are always available in SSR component scope

### Other

- remove accidentally committed build output from test-app/.vesk2/

## 0.2.89 — 2026-10-30

_No breaking changes._

### Fixes

- catch middleware TypeErrors (ctx.cookies undefined) instead of crashing server

## 0.2.88 — 2026-10-30

_No breaking changes._

### Fixes

- prevent middleware redirect/throws from becoming 500/FUNCTION_INVOCATION_FAILED

## 0.2.87 — 2026-10-28

_No breaking changes._

### Fixes

- **adapter:** generated handler syntax + route specificity + param alignment
- **adapter:** static routes match before catch-all in generated handler

## 0.2.86 — 2026-10-28

_No breaking changes._

### Fixes

- **adapter:** align API param extraction with /api mount prefix

## 0.2.85 — 2026-10-28

_No breaking changes._

### Fixes

- **compiler:** include dir and deps in emitted module registry

## 0.2.84 — 2026-10-28

_No breaking changes._

### Fixes

- **adapter:** pass __veskModules registry to every hydratePrecompile call site
- **adapter:** deduplicate module source across SSR functions to fix cold-start OOM

### Tests

- **compiler:** update bundle-cache and workspace-resolution tests for module registry API

## 0.2.83 — 2026-10-28

_No breaking changes._

### Fixes

- **adapter:** only add createRequire banner for node targets
- **adapter:** bundle node packages, fix CJS require shim for builtins

### Tests

- **adapter:** assert packages are bundled, not externalized

## 0.2.82 — 2026-10-28

_No breaking changes._

### Fixes

- **adapter:** externalize packages in node platform bundles so CJS drivers load

## 0.2.81 — 2026-10-28

_No breaking changes._

### Fixes

- **compiler:** resolve @vesk/runtime imports during SSR hydrate from the loaded runtime, not the build-time path

## 0.2.80 — 2026-10-28

_No breaking changes._

### Other

- defer hydratePrecompile to first request to fix Vercel SSR cold-start OOM

## 0.2.78 — 2026-10-27

_No breaking changes._

### Other

- restore inline precompiled plans in SSR functions

## 0.2.77 — 2026-10-27

_No breaking changes._

### Fixes

- **adapter:** use relative file paths for SSR plan module imports
- **adapter:** import SSR plan modules instead of fetch()
- **adapter:** correct SSR plan URL path to /_vesk/static/ssr-plans/
- **adapter:** make SSR plan getters pure expressions via IIFE
- **adapter:** use const arrow functions for SSR plan getters
- **adapter:** scope SSR plan keys per route to prevent collisions
- **adapter:** externalize SSR precompiled plans to static files

## 0.2.76 — 2026-10-27

_No breaking changes._

### Fixes

- **adapter:** add VESK_CHUNK_CONCURRENCY env override for memory-constrained builds

## 0.2.74 — 2026-10-27

_No breaking changes._

### Features

- **cli:** typecheck before build

### Fixes

- **compiler,adapter,runtime:** package .vsk imports, shared runtime, API catch-all params
- **adapter:** load production API and SSR functions with project imports
- **cli,runtime:** non-blocking dev chunks and scoped file watcher
- **cli,runtime:** nearest-boundary dev 404s and stale-render guards
- **compiler,runtime,adapter:** hydration correctness and dev-server reliability
- **compiler:** build pure-static children when a fresh parent has no SSR residue

### Chores

- **perf:** re-baseline client budget after chunk reallocation

### Other

- prepare v0.2.73

## Unreleased

_No breaking changes._

### Features

- **compiler:** resolve bare `.vsk` component imports through package exports, so a library can ship `vesk-lib/components/Button.vsk` and an app can import it by name.

### Fixes

- **compiler:** a top-level `if` containing only statements no longer clears the markerless first-claim skip budget, which could make an island claim the preceding server element and leave its own SSR node stranded.
- **runtime:** `on_destroy()` no longer crashes cleanup code when `scope()` returns `undefined`.
- **adapter:** hoist non-`.vsk` modules that import `@vesk/runtime` into the shared client bundle instead of inlining a second runtime per chunk. Function exports work through the shared shim; value exports do not and must stay server-side.
- **adapter:** catch-all API routes now capture the whole remaining path (for example `signin/google`) instead of only the first segment.
- **adapter:** the production server builds request URLs from the `Host` header and, when `trustProxy` is enabled, `x-forwarded-host`/`x-forwarded-proto`. OAuth error redirects and same-origin checks no longer fall back to `localhost`.
- **runtime:** `useSearchParams()` reads the live location while hydration is still populating router state, so query parameters are available on the first render.

## 0.2.72 — 2026-10-17

_No breaking changes._

### Docs

- **adapter:** document the new transport/request-shim/server-only shapes

## 0.2.71 — 2026-10-17

_No breaking changes._

### Fixes

- **adapter:** uploads were inoperable — request.body was always null

## 0.2.70 — 2026-10-17

_No breaking changes._

### Fixes

- **adapter:** make nested error.vsk / not-found.vsk actually resolve in prod

## 0.2.69 — 2026-10-17

_No breaking changes._

### Features

- **adapter:** keep a database driver out of the browser bundle

## 0.2.68 — 2026-10-16

_No breaking changes._

### Features

- **adapter:** brotli/gzip, ETag/304 and /healthz in production

## 0.2.67 — 2026-10-16

_No breaking changes._

### Features

- **plugin-multipart:** streaming multipart/form-data with real File values

### Fixes

- **adapter:** make every <Image> srcset URL actually resolve

## 0.2.66 — 2026-10-16

_No breaking changes._

### Fixes

- **runtime,adapter:** make VeskRequest security overrides actually apply

## 0.2.65 — 2026-10-16

_No breaking changes._

### Fixes

- **adapter:** stop decapitating static API route function names
- **compiler,adapter:** alias-safe SSR imports, safe fallback, catch-all in prod
- **compiler,runtime,adapter:** store tree-shake/hydration, array seed, route matchers

### Chores

- add poc-ssr-fetch.ts (untracked since 2026-10-14)
- **perf:** adopt client budget for the store fix (+15.7 KB runtime)
- **test-app:** repin @vesk/* deps to freshly built CI tarballs

## 0.2.64 — 2026-10-14

_No breaking changes._

### Performance

- **dev:** persist the client bundle so restarts skip unchanged work

## 0.2.63 — 2026-10-14

_No breaking changes._

### Performance

- **dev:** parallelize chunk builds, defer route chunk bodies, memoize parse()

### Other

- parse() memoization (measured neutral, regressed the HMR hot path)

## 0.2.62 — 2026-10-13

_No breaking changes._

### Fixes

- **compiler:** don't hoist a TrackDecl above the binding its init reads

## 0.2.61 — 2026-10-13

_No breaking changes._

### Features

- **adapter,runtime:** styled built-in 404/error pages

### Fixes

- **compiler:** sibling indexed loops, loop control, guard-scoped track() + diagnostics

## 0.2.60 — 2026-10-12

_No breaking changes._

### Features

- **runtime:** SSR-persisted stores + path-store, fix cell imprint & derived recompute

### Fixes

- **parser:** handle JSX quotes in for clauses
- **ssr/orphan-root:** prevent effects from running during server rendering

### Other

- added tests files

## 0.2.59 — 2026-10-10

_No breaking changes._

### Fixes

- **hydration,codegen,bundler:** three bugs that made store-driven UI dead

## 0.2.58 — 2026-10-09

_No breaking changes._

### Fixes

- **codegen:** a claim-less component left its SSR root ownerless, and the next claim detached it

### Docs

- handoff for the app-driven bug hunt

## 0.2.57 — 2026-10-08

_No breaking changes._

### Fixes

- **router:** restore resolveComponentName lookup order; warn on ambiguity instead
- **codegen:** a route file with several components silently resolved to the wrong one

### Docs

- **todo:** record the app-driven bug hunt and the two corrections

## 0.2.56 — 2026-10-08

_No breaking changes._

### Fixes

- **router:** multi-token activeClass threw DOMException; warn on stale const bindings

## 0.2.55 — 2026-10-08

_No breaking changes._

### Tests

- **codegen:** correct a wrong claim about dropped siblings next to a bare slot

## 0.2.54 — 2026-10-08

_No breaking changes._

### Fixes

- **router:** chain order must be root -> group -> page, or dev SSR renders the wrong page

## 0.2.53 — 2026-10-08

_No breaking changes._

### Fixes

- **codegen:** a top-level {props.children} in a layout was silently dropped

## 0.2.52 — 2026-10-08

_No breaking changes._

### Fixes

- **router:** group layouts in the client chain, and the missing match pathname

## 0.2.51 — 2026-10-05

_No breaking changes._

### Other

- Icon patterns, lucide tree-shaking, TS-parsing and SSR/route bugs found converting a real app

## 0.2.50 — 2026-10-04

_No breaking changes._

### Features

- **runtime:** webhook() gains algorithm + signedPayload, so Paystack verifies
- **runtime:** a typed metadata API, and island data that stops holding the document
- **extension:** ship Vesk logo as .vsk file icon, package 0.3.15 VSIX
- **testing:** @vesk/testing — a component harness (no server, no browser)
- **compiler:** resolve workspace packages through their exports map
- **server:** an onError seam for production error reporting, with a build id
- **build:** content-hashed assets with SRI
- **cli:** vesk migrate — codemods, so breaking changes can fix your code

### Fixes

- **ci:** every green run on main publishes `latest` again
- **ssr:** For renders its rows on the server
- **compiler:** plain `const x = track()` took the whole page down on the server
- **seo:** vesk seo must accept the head style the docs recommend

### Tests

- A5 + A8 abuse matrices — 22 tests, and a diagnostic built then switched off
- **docs:** verify every docs example — and fix the 24 that were broken

### Docs

- **todo:** close 48 items that were already done, with evidence
- two stale bug reports closed by measurement, one namespace page added
- **todo:** correct the For/SSR diagnosis after the obvious fix failed
- **vesk-doc:** one page per concept, with every example verified
- **vesk-doc:** a /docs/metadata page for the metadata API and ssr: 'defer'
- record #6 and #9 as planned-not-shipped, with the shape each needs

### CI

- give the size budget a 2% drift allowance
- ratchet a client-bundle size budget

### Chores

- refresh test-app/vesk-doc CI tarball pins, collapse a duplicated TODO entry

### Other

- rebuild stale bundle, fix knowledge.ts hallucinations, remove dead semantic.ts
- remove hallucinated {#if} sigil, fix idle-hydration and security-field claims
- a train, so `latest` only moves when a human says so

## 0.2.48 — 2026-09-28

_No breaking changes._

### Fixes

- **router:** decode the head's HTML escaping when re-applying it
- **head:** give the SSR head pass the component's real frame
- **images:** make the image test backend-agnostic; memo actually memoizes
- **test-harness:** read every suite's summary line, and fix the image test
- **ssr:** one request-scope store per server bundle

### Performance

- **build:** cache the module bundle per file — vesk-doc 210s -> 37s
- **build:** 126.8s -> 16.4s on the 28-route test-app

### Docs

- record the SSR head-frame fix in TODO
- record the module-bundle caching and the final build numbers
- record the build-duration postmortem and the CI silent-pass hazards

### Other

- v0.2.47 [skip ci]
- v0.2.46 [skip ci]
- v0.2.45 [skip ci]
