# Prompt — Build Vesk DevTools

You are implementing the **Vesk DevTools** described in `plans/devtools.md` (read it fully first).
This is a greenfield feature in the Vesk monorepo. Work incrementally, keep every change
shipped with tests, and respect the repo conventions in `AGENTS.md` (AST-only compiler
transformations — no regex in `packages/compiler/src`, statement mode is first-class,
`.vsk` stays a superset of TS, auto-imports for runtime helpers).

---

## What to build

A **browser-first development control center** for Vesk projects, powered by the **Vesk Dev
Server** as the single operating core. It must cover, in order:

### 1. Vesk Dev Server API layer
- A dependency-free API server embedded in the existing `vesk dev` flow (extend
  `packages/cli/src/dev-server.ts` and/or `packages/adapter/src/dev-server.ts` — reuse the
  existing request plumbing, auth/CSRF/privacy defaults already shipped).
- Endpoints organized by capability: project config, plugins, diagnostics, build, commands,
  AI actions, checkpoints.
- The Dev Server is the **only** path from browser → project files / build system. No direct
  filesystem access from the browser; no raw `child_process` reachable from the client.
- Permission checks per capability, enforced server-side.

### 2. Browser DevTools UI
- A standalone dev page served at a dev-only route (e.g. `/__vesk`), built in `.vsk`.
- Panels: **Project Config** (toggle-based settings, direct `vesk.config.ts` editor),
  **Plugins** (install/uninstall/activate/deactivate/status, npm discovery),
  **Diagnostics** (compiler/build errors, live-updating), **AI** (provider/model/key, mode,
  permissions, session), **Activity History** (checkpoints, rollback/replay).
- Browser edits persist to the real project files through the Dev Server API.
- Keep it usable on low-resource devices.

### 3. Plugin management
- Active plugins participate in the build; inactive ones are installed but fully excluded
  from the bundle/build.
- Plugin manifest declares: vesk/compiler compatibility, capabilities, config schema,
  dependencies, build hooks.
- Runtime API: install, uninstall, activate, deactivate, list, discover (npm search).
- Wire activation state into the existing plugin loading in the compiler/adapter build path.

### 4. AI integration as installable plugin @vesk/agentic (own the intelligence, rent the agent machinery)
- AI is **not built-in** — it is the installable plugin `@vesk/agentic`. Inside the plugin,
  vendor a zero-deps clone of `@narimangardi/agent-loop` (**20.7kB zero-deps**, no runtime
  deps) as the generic machinery. **Only** proceed after measuring footprint (dependencies,
  install/bundle size, startup, memory, browser/worker compatibility, configurability,
  embeddability). Document findings in `plans/devtools-agentic-audit.md` (successor to
  `plans/devtools-pi-audit.md`) **before** writing integration code. Document Pi rejection:
  bare `pi-agent-core`/`pi-ai` are **486B stubs**; `@earendil-works/pi-agent-core`
  (**4.1MB**) + `@earendil-works/pi-ai` (**1.9MB**) fail the audit due to hard deps
  `openai`/`@anthropic-ai/sdk`/`@google/genai`/`@aws-sdk`. If the vendored loop doesn't
  meet requirements, stop and report — do not ship a heavier agent framework and do not
  fall back to Pi.
- `@vesk/agentic` owns (not Vesk core): provider/model/key config (provider-agnostic), the
  three modes (Explore / Debug / Agent), the permission system, tools, context assembly,
  transactions and checkpoints — all mediated through the Vesk Dev Server capability-gated API.
- Provider abstraction so switching models never touches the plugin's agent implementation
  or Vesk core. Core Vesk gains no dependency on `openai`/`@anthropic-ai/sdk`/`@google/genai`/`@aws-sdk`.

### 5. AI modes + granular permissions (implemented by @vesk/agentic, enforced via Dev Server)
- **Explore**: read-only (files, structure, config, plugins, diagnostics, errors, architecture
  explanations). No writes, no commands.
- **Debug**: inspect + controlled fixes; user-configurable capability set (read, analyze
  diagnostics, edit relevant sources, run tests/builds).
- **Agent**: full operation gated by per-capability toggles (readFiles, writeFiles,
  deleteFiles, executeCommands, installPackages, modifyConfig, managePlugins, runBuild,
  runTests, modifyAgentsMd, createCheckpoint, rollback).
- `agents.md`: readable by default, writable only with explicit permission.
- All checks are server-side through the Dev Server capability gate; the `@vesk/agentic`
  plugin cannot bypass them from the browser/runtime.

### 6. Layered AI context (assembled by @vesk/agentic via Dev Server)
- Framework knowledge (bundled Vesk docs, tutorials, examples, API refs, compiler behavior,
  common errors, `llm.txt`, framework `agents.md`) + project knowledge (`agents.md` at
  project root, project-rule precedence) + live project context (files, config, deps,
  compiler state, build errors, diagnostics, git state, active plugins, running processes
  where permitted) — collected through Dev Server reads, not direct filesystem access.

### 7. Vesk-native tools (exposed by @vesk/agentic, gated by permissions)
- `vesk.inspectProject`, `vesk.inspectComponent`, `vesk.readConfig`, `vesk.updateConfig`,
  `vesk.getDiagnostics`, `vesk.getCompilerErrors`, `vesk.runBuild`, `vesk.runTests`,
  `vesk.installPlugin`, `vesk.uninstallPlugin`, `vesk.enablePlugin`, `vesk.disablePlugin`,
  `vesk.createCheckpoint`, `vesk.rollback` — all provided by the plugin, capability-checked
  on the Dev Server.
- Generic tools (`filesystem.read/write/delete`, `command.execute`) exposed only when the
  active permissions allow them. `command.execute` must route through the Dev Server's
  command runner — never directly from the browser/agent runtime or the vendored
  `@narimangardi/agent-loop` itself.

### 8. Transactions, checkpoints, history, replay (plugin-mediated, via Dev Server)
- Present significant operations as proposals: **Preview → Approve → Execute → Validate →
  Checkpoint**, with reject/modify before approval.
- Every checkpoint records: files changed, commands run, dependencies installed, before/
  after state, build/test outcome. Rollback restores a known-good state; replay re-runs a task.
- `@vesk/agentic` exposes the stable checkpoint/rollback API on top of the vendored
  `@narimangardi/agent-loop`; the Dev Server persists the `ai`/`checkpoint` capability
  surface so alternative plugins could interop.

---

## Acceptance criteria

- `vesk dev` serves DevTools; every UI action round-trips through the Dev Server API, never
  direct filesystem access from the browser.
- Plugin activate/deactivate demonstrably includes/excludes the plugin in the build output
  (verify with tests on both expression and statement mode) — including `@vesk/agentic`
  (inactive ⇒ zero AI bundle/build cost).
- AI integration is **plugin-scoped** (`@vesk/agentic`, installable/toggleable): footprint
  audit `plans/devtools-agentic-audit.md` (vendored `@narimangardi/agent-loop` 20.7kB
  zero-deps; Pi rejection documented: bare `pi-agent-core`/`pi-ai` 486B stubs,
  `@earendil-works/*` 4.1MB+1.9MB + hard deps `openai`/`@anthropic-ai/sdk`/`@google/genai`/
  `@aws-sdk`) exists and was written before integration code; the same vendored loop works
  with ≥2 providers from config alone; all three modes enforced server-side via Dev Server
  capabilities (permissions can't be bypassed from the client).
- Explore/Debug/Agent permission enforcement lives server-side (Dev Server capability gate,
  implemented by `@vesk/agentic`); no mode allows what its permission set forbids.
- Every agent action records a checkpoint; rollback actually restores prior file state;
  history UI shows what/commands/deps/build result (plugin panel).
- All new features covered by tests; reactivity/DevTools behavior verified against the
  hydration harness (`node tests/hydration-test.mjs`) where it touches component/hydration
  behavior. Compiler edits followed by `npx tsx packages/cli/src/build-packages.ts`;
  run suites individually while iterating.
- Keep total-weight-lean: no agent-lite bloat; core Vesk ships no `openai`/
  `@anthropic-ai/sdk`/`@google/genai`/`@aws-sdk`; if a dependency fails the footprint audit,
  do not integrate it and document the blocker (Pi is the documented failure case).

## Deliverables

1. `plans/devtools-agentic-audit.md` — footprint/compat/configurability audit of the vendored
   `@narimangardi/agent-loop` clone (20.7kB zero-deps) + documented Pi rejection (bare
   `pi-agent-core`/`pi-ai` 486B stubs; `@earendil-works/*` 4.1MB+1.9MB + hard deps
   `openai`/`@anthropic-ai/sdk`/`@google/genai`/`@aws-sdk`) — written first, before
   integration code (successor to `plans/devtools-pi-audit.md`).
2. Dev Server API module(s) with tests (including `ai`/`checkpoint` capabilities consumed by
   `@vesk/agentic`).
3. Browser DevTools UI (`.vsk` panels) wired to the API — AI surfaces shown only when
   `@vesk/agentic` is installed & active.
4. Plugin manager (install/uninstall/activate/deactivate/status/discover) with build-pipeline
   activation, tested — `@vesk/agentic` toggles like any plugin (inactive ⇒ fully excluded).
5. Agent plugin `@vesk/agentic`: vendored `@narimangardi/agent-loop` abstraction, three
   modes, permission-gated Vesk-native + generic tools (all routed through Dev Server),
   layered context, transactions + checkpoints + rollback + replay + teaching surface. Core
   Vesk remains AI-free.
6. Tests at every layer + `TODO.md` updated + docs in `/docu/` (plugin install/usage documented).