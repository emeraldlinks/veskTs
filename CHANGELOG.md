# Changelog

All notable changes to Vesk. Versions follow [semver](https://semver.org/); `latest` only moves on a stable release, and `canary` tracks `main`.

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
