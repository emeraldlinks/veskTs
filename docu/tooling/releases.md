# Releases

How Vesk ships. The short version: **`latest` only moves when a human says so.**

## The train

| channel | published | npm dist-tag | version in the repo | when |
|---|---|---|---|---|
| `canary` | on every push to `main` that touches `packages/**` | `canary` | unchanged | automatic, after all four test jobs pass |
| `beta` | manual | `beta` | unchanged | `workflow_dispatch` with `channel: beta` |
| `stable` | manual | `latest` | bumped | `workflow_dispatch` with `channel: stable` |

```bash
npm i @vesk/runtime            # stable
npm i @vesk/runtime@canary     # whatever main is right now
```

A canary **never** touches `CHANGELOG.md`, the git tag, or the version committed
in the repo. That is the whole point: before the train, every merge to `main`
published a new version to `latest`, bumped every `package.json`, and committed
the bump — 38 releases in 400 commits. Nobody could pin a version, and "stable"
meant "whatever merged last".

A stable release **promotes a base that canaries already tested**: if canaries
for `0.2.48` are out, `stable` ships `0.2.48`, not a freshly cut `0.2.49`.

## Semver promises

- **patch** — bug fixes only. No behaviour change, no new API surface. This is
  the channel most adopters should take.
- **minor** — additive. New components, runtime APIs, compiler capabilities,
  deploy targets, config options. Anything already working keeps working, and
  generated output for the same input is byte-comparable except where a bug fix
  requires a change (those are listed in the changelog).
- **major** — only for changes that cannot be made compatible. In practice:
  removing a public export, changing the meaning of a language construct, or
  changing the SSR/hydration contract. Every major ships codemods (see
  `vesk migrate`).

**0.x note.** While the framework is pre-1.0, minor bumps may contain breaking
changes — that is the semver convention for `0.y.z`. The practical guarantee
for adopters today: pin an exact version, read the changelog section for it, and
expect patch releases to be safe.

## Deprecations

A public API is deprecated for **at least two minor releases** before it is
removed:

1. the release notes mark it `deprecated:` with the replacement,
2. the runtime prints a named deprecation warning (once per process, with the
   call site),
3. it keeps working, unchanged, for two more minors,
4. it is removed only in a major, with a codemod.

Nothing is removed silently. If a codemod cannot automate a change, the
migration guide says so explicitly.

## What a release does

`workflow_dispatch` → `stable`:

1. `scripts/next-version.mjs` computes the next version from the repo **and** the
   registry, so a published-but-uncommitted version is never recomputed;
2. `scripts/release.mjs <version> --channel stable` bumps every `package.json`,
   the inter-package dependency ranges and the `create-vesk` scaffold, builds
   every package in dependency order, and publishes with `--tag latest`;
3. `scripts/changelog.mjs <version>` writes `CHANGELOG.md` from the commits since
   the previous release tag, grouped by conventional-commit type, breaking
   changes first;
4. the version bump and changelog are committed as `release: vX.Y.Z [skip ci]`,
   tagged `vX.Y.Z`, and a GitHub release is created with the commit list.

The version rules and changelog renderer live in `scripts/release-plan.mjs` and
are covered by `packages/cli/src/release-plan.test.ts` — they decide what an
installer resolves, so they are asserted rather than trusted.

## Size budget

`npm run budget` (also run by `scripts/test.js`, so it gates CI) measures the
client JavaScript a production build emits and fails when it grows:

```
asset-budget: client runtime : 274.0 KB  (client.5ebf20b1ee.js)
asset-budget: route chunks   : 29 files, 453.8 KB total
asset-budget: largest chunk  : 55.1 KB  (page-portal.5beb2adfe7.js)
asset-budget: TOTAL client JS: 727.8 KB
```

The numbers live in `perf-budget.json` and the gate is a **ratchet**: a smaller
build tightens the budget automatically, so an improvement cannot be given back
by accident. Growing it needs `npm run budget -- <buildDir> --update` and a
sentence in the commit message explaining why the client now carries more.

Point it at any build output: `npm run budget -- path/to/.vesk`.

## Support matrix

| | supported |
|---|---|
| Node | 20, 22, 24 (ESM only) |
| Deploy targets | Node, Vercel (Node + edge), Netlify, Cloudflare Workers, Deno, AWS |
| Bundler | esbuild (native, with a WASM fallback on CPUs the native binary cannot run) |
| Package managers | npm, pnpm, yarn |

A Node version that leaves the support window gets a final patch, then the
matrix is updated here in the same release.

## Reporting a regression

Include the Vesk version (`vesk --version`), the Node version, the deploy
target, and the smallest `.vsk` file that reproduces it. A failing case in that
file, as a unit test, is worth more than any description.
