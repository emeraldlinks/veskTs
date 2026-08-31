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

### 4. AI integration (own the intelligence, rent the agent machinery)
- Integrate `pi-agent-core` + `pi-ai` **only** after measuring footprint (dependencies,
  install/bundle size, startup, memory, browser/worker compatibility, configurability,
  embeddability). Document findings in `plans/devtools-pi-audit.md` **before** writing
  integration code. If they don't meet requirements, stop and report — do not ship a heavier
  agent framework.
- Vesk owns: provider/model/key config (provider-agnostic), the three modes (Explore /
  Debug / Agent), the permission system, tools, context assembly, transactions and checkpoints.
- Provider abstraction so switching models never touches Vesk's agent implementation.

### 5. AI modes + granular permissions
- **Explore**: read-only (files, structure, config, plugins, diagnostics, errors, architecture
  explanations). No writes, no commands.
- **Debug**: inspect + controlled fixes; user-configurable capability set (read, analyze
  diagnostics, edit relevant sources, run tests/builds).
- **Agent**: full operation gated by per-capability toggles (readFiles, writeFiles,
  deleteFiles, executeCommands, installPackages, modifyConfig, managePlugins, runBuild,
  runTests, modifyAgentsMd, createCheckpoint, rollback).
- `agents.md`: readable by default, writable only with explicit permission.

### 6. Layered AI context
- Framework knowledge (bundled Vesk docs, tutorials, examples, API refs, compiler behavior,
  common errors, `llm.txt`, framework `agents.md`) + project knowledge (`agents.md` at
  project root, project-rule precedence) + live project context (files, config, deps,
  compiler state, build errors, diagnostics, git state, active plugins, running processes
  where permitted).

### 7. Vesk-native tools
- `vesk.inspectProject`, `vesk.inspectComponent`, `vesk.readConfig`, `vesk.updateConfig`,
  `vesk.getDiagnostics`, `vesk.getCompilerErrors`, `vesk.runBuild`, `vesk.runTests`,
  `vesk.installPlugin`, `vesk.uninstallPlugin`, `vesk.enablePlugin`, `vesk.disablePlugin`,
  `vesk.createCheckpoint`, `vesk.rollback`.
- Generic tools (`filesystem.read/write/delete`, `command.execute`) exposed only when the
  active permissions allow them. `command.execute` must route through the Dev Server's
  command runner — never directly from the browser/agent runtime.

### 8. Transactions, checkpoints, history, replay
- Present significant operations as proposals: **Preview → Approve → Execute → Validate →
  Checkpoint**, with reject/modify before approval.
- Every checkpoint records: files changed, commands run, dependencies installed, before/
  after state, build/test outcome. Rollback restores a known-good state; replay re-runs a task.
- Vesk exposes its own stable checkpoint/rollback API on top of the agent runtime.

---

## Acceptance criteria

- `vesk dev` serves DevTools; every UI action round-trips through the Dev Server API, never
  direct filesystem access from the browser.
- Plugin activate/deactivate demonstrably includes/excludes the plugin in the build output
  (verify with tests on both expression and statement mode).
- AI integration: footprint audit document exists and was written before integration code;
  the same agent loop works with ≥2 providers from config alone; all three modes enforced
  server-side (permissions can't be bypassed from the client).
- Explore/Debug/Agent permission enforcement lives server-side; no mode allows what its
  permission set forbids.
- Every agent action records a checkpoint; rollback actually restores prior file state;
  history UI shows what/commands/deps/build result.
- All new features covered by tests; reactivity/DevTools behavior verified against the
  hydration harness (`node tests/hydration-test.mjs`) where it touches component/hydration
  behavior. Compiler edits followed by `npx tsx packages/cli/src/build-packages.ts`;
  run suites individually while iterating.
- Keep total-weight-lean: no agent-lite bloat; if a dependency fails the footprint audit,
  do not integrate it and document the blocker.

## Deliverables

1. `plans/devtools-pi-audit.md` — Pi footprint/compat/configurability audit (written first).
2. Dev Server API module(s) with tests.
3. Browser DevTools UI (`.vsk` panels) wired to the API.
4. Plugin manager (install/uninstall/activate/deactivate/status/discover) with build-pipeline
   activation, tested.
5. Agent layer: Vesk abstraction over the audited runtime, three modes, permission-gated
   tools, layered context, transactions + checkpoints + rollback + replay.
6. Tests at every layer + `TODO.md` updated + docs in `/docu/`.