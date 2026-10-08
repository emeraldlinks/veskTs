# Changelog

All notable changes to Vesk. Versions follow [semver](https://semver.org/); `latest` only moves on a stable release, and `canary` tracks `main`.

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
