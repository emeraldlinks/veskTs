# haul — the native vesk engine and CLI

> **PARKED:** haul is unplugged from the framework. The full source lives on
> the `haul-parked` branch (`git checkout haul-parked`); main ships the
> pure-TS pipeline with esbuild + esbuild-wasm fallback. This doc is kept for
> historical/design reference.

**Status:** parked (was: proposal)
**Owner:** vesk core
**Depends on:** Phase 0 (optional deps + esbuild-wasm fallback)

## TL;DR

`haul` is a single static Go binary that replaces both esbuild **and** the JavaScript
`vesk` CLI. It is the vesk analogue of Next.js + Turbopack: a native build engine with
incremental persistent caching, parallel compilation, lazy dev builds, real
tree-shaking and minification, and a hardening layer. The JS compiler survives only as
a narrow sidecar for `.vsk`-specific transforms and `typecheck`.

---

## 1. Why

### 1.1 The failure that started this

`vesk build` fails on some devices with `illegal hardware instruction` (SIGILL). Root
cause: npm ships precompiled native binaries (esbuild's Go binary, sharp's libvips),
and when the binary's instruction baseline doesn't match the device CPU the OS kills
the process. A JS `try/catch` cannot catch a signal. The lockfile floats esbuild
`^0.25.0` to `0.28.1`, so the binary changed under us.

### 1.2 esbuild is overkill for vesk

Audit of the six call sites (client-bundle, runtime-bundle, api-function, two
dev-servers, cli/build):

| esbuild capability | vesk uses it? |
|---|---|
| `transformSync` (TS erasure) | yes, ×4 — but vesk **already ships its own** in `strip-ts.ts` |
| ESM bundling | 3 artifacts, **2 of which are first-party static graphs** (`@vesk/runtime`) |
| Minification / tree-shaking | yes — **non-negotiable, cannot be compromised** |
| CSS pipeline | **no** — vesk has its own (`stripTailwindDirectives`) |
| plugins / loaders / JSX / CJS interop | no |
| format conversion / source maps | partly (maps are cheap to add ourselves) |

So ~90% of esbuild's machinery is dead weight for vesk, but the 10% that matters —
tree-shaking and minification of arbitrary user code — is exactly the part that is
genuinely hard to hand-roll correctly.

### 1.3 The principle

> **Do the hard things once, correctly. Remove everything else.**

Turbopack does not hand-roll a parser either — it embeds SWC (Rust). `haul` does the
same: it embeds esbuild's proven Go bundling core **only** for tree-shaking and
minification, and is vesk-native everywhere else.

---

## 2. Design principles

1. **One static Go binary.** No Node runtime required to run `haul build`/`dev`.
2. **Tree-shaking and minification are non-negotiable.** Quality and correctness
   parity with esbuild, proven by differential testing, not vibes.
3. **No dead machinery.** CSS, plugins, JSX, transform-API, format conversion — out.
4. **The JS compiler stays the source of truth for `.vsk` transforms** until a native
   port is proven (Phase 4).
5. **Persistent, content-addressed cache.** Compile once, reuse everywhere; dev and
   build share the same `.vesk-cache/`.
6. **Security is a feature, not an afterthought.** Import allowlists, hashed assets +
   SRI, eval-free output, hardened dev server, dependency scoping.
7. **No install-time hard failure.** Native binaries ship as optional deps; a WASM/JS
   fallback exists for unsupported CPUs (the Next.js/SWC model).

---

## 3. haul replaces the CLI

The `vesk` npm package keeps its name; its `bin` becomes a ~5-line launcher that execs
the `haul` binary for the current platform (resolved like `@next/swc-*`). Every command
is implemented natively in Go:

| Command | Today (JS CLI) | haul |
|---|---|---|
| `vesk build` | JS orchestrates esbuild | `haul build` — native |
| `vesk dev` | JS dev server, esbuild HMR | `haul dev` — native HTTP server, watcher, HMR |
| `vesk start` | JS preview | `haul start` — native static+server preview |
| `vesk seo` | JS | `haul seo` — native |
| `vesk typecheck` | JS `tsc`-in-`.vsk` | `haul typecheck` — **sidecar** (TS semantics are a JS/TS problem) |
| config loading | JS `import()` of `vesk.config.*` | JS sidecar eval (config is arbitrary JS) |
| `.vsk` compile | acorn + visitors | **sidecar** — vesk IR transforms |
| `vesk scan` | JS | sidecar (plugin/analysis, low-volume) |

The Node sidecar (`vesk-compiler`) is spawned lazily, kept alive, batched over JSON-RPC,
and only asked to do the two things only it can: `.vsk`→JS IR transforms and `typecheck`.
Every hot path — strip, bundle, tree-shake, minify, CSS, watch, serve, cache — is Go.

---

## 4. Architecture

```
┌──────────────────────────  haul (Go static binary)  ──────────────────────────┐
│                                                                               │
│  haul <build|dev|start|seo>                                                   │
│   ┌──────────────────────────────────────────────────────────────────────┐    │
│   │ Orchestrator — command parsing, build graph, parallelism, pipeline   │    │
│   │   · module graph: parallel parse/resolve/dedupe (goroutine pool)     │    │
│   │   · persistent cache: content-addressed, shared dev/build (.vesk-cache)│  │
│   │   · lazy dev compilation: only the requested route/module on demand  │    │
│   └───────────────┬──────────────────────────────┬───────────────────────┘    │
│                   ▼                              ▼                            │
│   ┌─────────────────────────────┐   ┌────────────────────────────────────┐    │
│   │ Bundler core (client only)  │   │ vesk-native services               │    │
│   │  · esbuild-Go engine:       │   │  · TS stripper (Go) — routes, api, │    │
│   │    tree-shake (side-effect  │   │    HMR content                      │    │
│   │    analysis) + minify +     │   │  · runtime artifacts — prebuilt at  │    │
│   │    shared-chunk code-split  │   │    @vesk/runtime publish time       │    │
│   │  · conservative GOAMD64/    │   │  · CSS pipeline (Go minify/dedup)   │    │
│   │    GOARM build — no SIGILL  │   │  · watcher (fsnotify) + HMR         │    │
│   └─────────────────────────────┘   │  · asset hashing + SRI manifest     │    │
│                   │                  │  · image pipeline (sharp optional) │    │
│                   │                  └──────────────┬─────────────────────┘    │
│                   │                                 ▼                           │
│                   │                  ┌──────────────────────────────┐          │
│                   ▼                  │ Node sidecar (vesk-compiler)│          │
│            build manifest            │  · .vsk IR transforms       │          │
│            (adapter consumes)        │  · typecheck                │          │
│                                       │  · config eval              │          │
│                                       └──────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Artifact strategy — the load we remove

| Artifact today | Produced by | haul produces it |
|---|---|---|
| Server runtime (`server/runtime.js`) | esbuild `build()` at build time | **prebuilt artifact** in `@vesk/runtime`; per-app entry is a ~10-line generated wrapper |
| Tree-shaken client runtime | esbuild per-build | **prebuilt slices** per export, concatenated natively; or existing JS concat logic ported to Go |
| Client bundle (user code) | esbuild | **Bundler core** — the only real bundle |
| `transformSync` output | esbuild ×4 | native Go TS stripper |
| CSS | vesk JS | native Go (tdewolff) |
| CLI itself | esbuild (`cli/build.ts`) | **never bundled** — haul is compiled Go |

Result: esbuild is removed from the dependency tree entirely. The only native binary
is `haul` (compiled by us, conservatively) plus optional sharp.

---

## 5. Tree-shaking and minification — the non-negotiable

These are the two things that cannot be "compromised" (per project directive). We treat
them as correctness invariants:

1. **Engine**: `haul`'s bundler core embeds `github.com/evanw/esbuild`'s Go tree-shaker
   and minifier (the same code that ships in esbuild today — same output, same quality),
   compiled from source with `GOAMD64=v1` / `GOARM=7` so the binary runs on the CPUs
   that currently SIGILL.
2. **Scope**: the engine sees *only* the client bundle of user code — the one place
   arbitrary input demands a real bundler. Server/runtime artifacts are prebuilt
   first-party graphs.
3. **Differential gate**: a fuzz harness compares `haul` output against the
   current esbuild-wasm fallback on a corpus of real vesk apps + generated programs.
   Ship Phase 1 only when tree-shake/minify outputs are byte-identical or a recorded
   diff is reviewed.
4. **Optional future**: Phase 4 may replace the engine with a vesk-owned tree-shaker
   and minifier — **only** once the differential harness proves parity. Until then the
   embedded engine stays. This is the Turbopack/SWC model: reuse the proven native
   compiler, don't gamble on a from-scratch one.

---

## 6. Optimization (Turbopack-grade)

- **Persistent incremental cache** — content-addressed `.vesk-cache/`, shared across
  dev/build/CI. A change to one file recompiles one file.
- **Parallel module graph** — goroutine pool over parse/resolve/transform; no JS event
  loop single-threading.
- **Lazy dev compilation** — `haul dev` compiles only the requested route/module on
  first request; the rest is cached until needed.
- **Shared-chunk code splitting** — islands and cross-route imports split into
  shared chunks with deterministic hashed filenames (cache busting).
- **Real minification** for prod; **no minify, inline source maps** in dev.
- **Tree-shaking with side-effect analysis** on user code (see §5).
- **CSS**: minify + dedupe natively; tailwind directives handled by the existing vesk
  pipeline (ported to Go).
- **Image pipeline**: sharp when present, native copy-only otherwise; resized+hashed
  outputs cached in `.vesk-cache`.
- **Cold-start** fast: single static binary, ~ms startup, no Node boot.

---

## 7. Security (Turbopack-level hardening)

- **Import allowlist** — client bundles refuse absolute paths, `node:*` imports, and
  specifiers outside declared dependencies. Fail loudly, not silently.
- **Server-external allowlist** — only known `node:`/npm modules may be externalized to
  the server runtime; everything else is bundled or rejected (no accidental
  node-builtin leaks into client bundles).
- **Hashed assets + SRI** — every script/link gets a content hash; the adapter emits
  `integrity` attributes. Integrity manifest written to `static/`.
- **Eval-free output** — emitted JS contains no `eval`/`new Function`; verified by a
  post-build scanner that fails the build on violations.
- **`haul audit`** — command that scans the bundle manifest for eval/`new Function`,
  remote `https:` imports, and undeclared deps; exits non-zero on findings.
- **Dev-server hardening** — path-traversal-proof static serving, symlink-safe watcher,
  no directory listing, sensible CSP/Security headers, host allowlist.
- **Dependency scoping** — duplicate/suspicious package resolution is surfaced as
  build warnings; dependency graphs are recorded in the manifest for review.
- **Secret hygiene** — log redaction for configs and env (mirrors existing
  `redactLogs` behavior) in the native logger.
- **Supply chain** — per-platform binaries are checksum-pinned in the lockfile; the
  launcher verifies the binary hash before exec.

---

## 8. Distribution & platform strategy

- `@vesk/haul-<os>-<arch>` optionalDependencies (darwin/linux/windows × arm64/x64;
  musl variants where needed). Install never hard-fails.
- The `vesk` bin is a tiny launcher: resolve the platform package → verify hash →
  exec `haul`. Unsupported platform or failed exec → **fallback mode** (esbuild-wasm +
  JS pipeline) with a clear warning. This is the exact SWC→Babel escape-hatch model.
- Binaries compiled conservatively: older Go toolchain, `GOAMD64=v1`, `GOARM=7`,
  `CGO_ENABLED=0` (fully static). A `linux/arm` (armv7) package is shipped to cover
  the old-CPU class that currently dies.
- sharp remains optional (`@img/*` prebuilds); degraded copy-only path stays.
- Go→WASM build of `haul` is an additional fallback tier on top of esbuild-wasm.

---

## 9. Roadmap

| Phase | Scope | Acceptance |
|---|---|---|
| **0** | `esbuild` + `sharp` → optionalDependencies; esbuild-wasm fallback wiring; friendly fallback warnings | `npm install` never fails with "illegal hardware"; full suite green on fallback path |
| **1** | `haul` binary: native CLI (build/dev/start/seo), Go TS stripper, prebuilt runtime artifacts, bundler core (esbuild-Go engine) for client bundle, fallback resolver | 6 esbuild call sites gone; 279 hydration tests + adapter suites green on `haul`; differential fuzz: tree-shake/minify parity recorded |
| **2** | Persistent `.vesk-cache/`, parallel graph, lazy dev, shared-chunk code-split, hashed assets + SRI | cold rebuild ≈ warm rebuild; dev first-request latency < today |
| **3** | Security layer (§7): allowlists, audit, dev-server hardening, integrity manifest, secret redaction | `haul audit` + allowlist tests; pentest-style fixtures pass |
| **4** | Native `.vsk` parser/IR port (drop the sidecar for transforms); optional vesk-owned tree-shaker/minifier behind the differential gate | full suite green with sidecar off; parity gate green |

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Bundler parity (user code edge cases) | esbuild-Go is the same engine as today — risk is ~zero for correctness; fallback mode remains |
| Sidecar latency (.vsk transforms) | long-lived batched worker + content-hash cache; Phase 4 removes it |
| Dual ownership (JS compiler vs Go pipeline) | JS compiler remains source of truth until Phase 4; IR/output tests are shared |
| Distribution matrix complexity | optional-deps pattern (proven by SWC/esbuild); checksum pinning |
| Go CPU-baseline regression | conservative build flags + armv7 package + WASM fallback tier |

---

## 11. Name

**`haul`** — a fast native hauler that carries your modules into a vessel. Short,
action verb, Go-native. The CLI stays `vesk build` / `vesk dev` on the surface; `haul`
is the engine (and the binary).

*Alt: `wake`, `skiff`, `tack`, `vepack`.*
