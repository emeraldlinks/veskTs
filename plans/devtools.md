# Vesk DevTools — Product Notes

## Vision

Vesk DevTools is a browser-first development control center for Vesk projects. It should make the development environment, compiler, plugins, project configuration, AI agents, diagnostics, and project operations accessible from one integrated interface.

The Vesk Dev Server acts as the operating core behind these capabilities.

---

## Architecture Decision — Agent as Plugin (@vesk/agentic)

**Decision (2026-08-31): AI is an installable plugin `@vesk/agentic`, not built into Vesk core.**

Previously these notes described a built-in agentic AI framework. That is superseded: the
Vesk core and Dev Server remain lean and AI-free by default. All agent runtime, provider
abstraction, tools, context assembly, transactions/checkpoints, and permission enforcement
are implemented **inside the optional plugin `@vesk/agentic`**. The plugin is installed,
activated/deactivated, and versioned like any other Vesk plugin (Note 1).

Rationale:

- **Lean core / footprint audit gate.** Vendoring a 20.7kB zero-deps loop avoids the
  6MB+ hard-dependency bloat that failed the Pi audit (see AI Agent Runtime Integration
  Plan). Core ships no `openai`/`@anthropic-ai/sdk`/`@google/genai`/`@aws-sdk`.
- **Installable & toggleable.** Teams that want AI install `@vesk/agentic`; teams that
  don't pay zero cost. An inactive plugin is fully excluded from the build/bundle (same
  `filterActivePlugins` guarantee as Note 1).
- **Dev Server as backbone.** The plugin talks to the project only through the
  capability-gated Vesk Dev Server API (`createDevApiRouter` — config, file, command,
  diagnostics, build, checkpoints). No raw `child_process` or filesystem access from the
  browser/agent runtime.
- **Own the intelligence, rent the machinery.** `@vesk/agentic` vendors a zero-deps clone
  of `@narimangardi/agent-loop` as its generic machinery; Vesk owns the intelligence
  (Vesk-native tools, layered context, permissions, transactions, teaching surface).
- **Independent evolution.** Plugin versioning decouples AI iteration from compiler/runtime
  releases. Alternative agent plugins remain possible — the contract is the Dev Server API,
  not a built-in framework slot.

Consequences:

- `plans/devtools.md` references to "built-in AI" now mean "via `@vesk/agentic` when
  installed & active".
- B6 is `B6-plug` (plugin-scoped). B2 (Dev Server API) must expose AI-relevant
  capabilities (`ai`, `checkpoint`) so the plugin — not the core — can implement modes,
  tools, and history.
- Docs, `llm.txt`, and DevTools UI surface AI affordances conditionally on plugin
  presence/active state.

---

## Note 1 — Installable and Toggleable Vesk Plugins

Vesk DevTools should support plugin/module installation and management, similar to the Node.js package ecosystem.

Developers should be able to:

- Install Vesk plugins/packages.
- Uninstall plugins.
- Activate or deactivate installed plugins.
- See which plugins are currently active.
- Discover compatible Vesk plugins from npm.

### Build behavior

An **active** plugin participates in the Vesk build/compile process.

An **inactive** plugin remains installed but is completely excluded from the build pipeline:

- It is not bundled into the application.
- It does not affect the build.
- It does not become part of the generated application.

### Plugin manifest

Plugins should declare metadata such as:

- Vesk/compiler compatibility.
- Plugin capabilities.
- Configuration schema.
- Dependencies.
- Build hooks.

---

## Note 2 — Browser-Based Project Configuration

Vesk DevTools should allow developers to configure their entire Vesk application directly from the browser.

The DevTools should provide:

- Configuration panels.
- Toggle-based settings.
- Project/build configuration controls.
- Plugin configuration.
- Error and diagnostic views.
- A direct editor for `vesk.config.ts`.

Changes made through the browser should be persisted to the actual project configuration files.

### Vesk Dev Server API

The browser should communicate with the local development environment through the **Vesk Dev Server API**, rather than relying on unsafe direct browser filesystem access.

The Dev Server becomes the controlled bridge between:

**Browser DevTools → Dev Server API → Project Files / Build System**

---

## Note 3 — First-Class AI Integration (via @vesk/agentic — superseded built-in; see Architecture Decision)

> **Superseded:** AI is **not** built-in. This note now describes the surface of the
> installable plugin `@vesk/agentic` when installed & active. See Architecture Decision
> — Agent as Plugin (@vesk/agentic).

Vesk DevTools (with `@vesk/agentic` installed) should provide a minimal agentic AI framework
(via the plugin). Developers should be able to configure an AI provider directly from the
DevTools when the plugin is active.

Possible providers include:

- OpenAI
- Anthropic
- Google
- Other compatible model providers

The developer selects:

1. Provider.
2. Model.
3. API key.
4. AI permissions/settings.

The AI then works directly with the Vesk project through the Dev Server.

The goal is not simply an AI chat box. The AI should be able to understand and operate on the project.

---

## Note 4 — AI Permission Modes

The initial AI experience should provide three modes:

### Explore

Read-only access.

The AI can:

- Explore the codebase.
- Inspect files.
- Understand project structure.
- Inspect configuration.
- Detect potential problems.
- Explain errors.
- Analyze architecture.

It cannot modify the project.

### Debug

The AI can investigate problems and make controlled fixes.

It should focus on:

- Diagnosing errors.
- Identifying likely causes.
- Suggesting fixes.
- Applying appropriate debugging changes.

### Agent

Full agentic capability.

The AI can:

- Modify files.
- Create files.
- Delete files when permitted.
- Run commands.
- Install dependencies.
- Run tests.
- Build the project.
- Interact with the development environment.
- Perform multi-step development tasks.

The Agent mode should be governed by granular permissions.

---

## Note 5 — Layered AI Context

Vesk AI should have multiple sources of context.

### 1. Vesk Knowledge Base

Built-in framework knowledge containing:

- Vesk documentation.
- Tutorials.
- Examples.
- Best practices.
- Dos and don'ts.
- API references.
- Compiler behavior.
- Common errors.
- Patterns to avoid hallucinations.

Relevant resources may include:

- `llm.txt`
- `agents.md`
- Documentation
- Examples

### 2. Project Knowledge

Each Vesk project can contain its own `agents.md`.

This file describes project-specific:

- Rules.
- Architecture.
- Conventions.
- Constraints.
- Preferred patterns.
- Development instructions.

The AI can read this file but should not overwrite it by default.

Writing to or modifying `agents.md` requires explicit user permission.

### 3. Live Project Context

The AI should also understand the current state of the project:

- Files.
- Configuration.
- Dependencies.
- Compiler state.
- Build errors.
- Diagnostics.
- Git state.
- Active plugins.
- Running processes where permitted.

These three layers combine to give the AI framework knowledge, project knowledge, and live context.

---

## Note 6 — Granular Agent Permissions

Agent mode should expose an AI settings panel where users can control exactly what the AI is allowed to do.

Users should be able to enable/disable capabilities such as:

- Read files.
- Write files.
- Delete files.
- Run shell commands.
- Install packages.
- Modify configuration.
- Run development servers.
- Run tests.
- Build applications.
- Modify protected files.
- Modify `agents.md`.

The user remains in control of the agent.

---

## Note 7 — Vesk Dev Server as the Core Development Layer

The **Vesk Dev Server** should be the central operating layer connecting all development interfaces.

Potential clients include:

- Browser DevTools.
- Vesk CLI.
- IDE/editor extensions.
- AI agents.
- Plugin system.
- Build system.

Instead of every interface implementing its own logic, they communicate through shared Vesk Dev Server APIs.

This creates a common foundation for:

- Permissions.
- File operations.
- Commands.
- Plugin management.
- Configuration.
- Diagnostics.
- Build operations.
- AI actions.

---

## Note 8 — AI Teaching Assistant

Vesk AI should not only build applications. It should also teach developers.

The AI can explain:

- Why a particular Vesk pattern is used.
- How the compiler works.
- Why an error occurred.
- Why a build failed.
- How a component works.
- Why a particular implementation is recommended.
- What a developer should learn to solve the problem themselves.

This makes Vesk useful for both experienced developers and people learning the framework.

---

## Note 9 — AI Checkpoints and Change History

AI changes should be trackable.

The DevTools should provide a visual history of AI operations.

Developers should be able to see:

- What the AI changed.
- Which files were affected.
- What commands were executed.
- What dependencies were installed.
- What happened before and after the change.
- Whether the build/tests passed.

AI actions can create checkpoints that developers can inspect or restore.

---

## Note 10 — Compiler Extension Platform

Vesk should expose a proper extension platform around its compiler/build system.

Plugins should be able to integrate with appropriate compiler and build lifecycle hooks.

This creates an ecosystem where developers can extend Vesk without modifying the core framework.

The plugin platform should remain compatible with the Vesk Dev Server and DevTools.

---

## Note 11 — Predictive Development

Vesk should proactively identify potential problems before they become production issues.

Examples include:

- Performance bloat.
- Slow routes.
- Unnecessary dependencies.
- Large bundles.
- Potential CLS/performance issues.
- Conflicting plugins.
- Invalid configurations.
- Potential build failures.
- Suspicious architecture patterns.

The goal is to move from reactive debugging toward predictive development.

---

## Note 12 — Transaction-Based AI Actions

AI operations should behave like transactions.

Before executing significant changes, the DevTools can present a proposed operation for review.

The developer should be able to:

- Preview changes.
- Review affected files.
- Review commands.
- Review dependencies.
- Approve.
- Reject.
- Modify the proposed action.

This creates a safer agentic development experience.

---

## Note 13 — Rollback, History, and Replay

Vesk DevTools should provide robust rollback capabilities for AI and development operations.

Developers should be able to:

- Undo AI changes.
- Restore previous project states.
- Roll back failed operations.
- Replay previous AI tasks.
- Inspect historical operations.
- Return to a known-good checkpoint.

Combined with Note 12, this creates a transaction-oriented workflow:

**Propose → Preview → Approve → Execute → Validate → Checkpoint → Roll Back if Necessary**

---

# Overall Product Direction

Together, these ideas position Vesk DevTools as more than a conventional browser inspector.

Vesk becomes an **AI-native compiler and software development platform** with:

- Browser-first DevTools.
- A centralized development server.
- First-class plugin management (including AI).
- Browser-based project configuration.
- Optional AI plugin (`@vesk/agentic` — installable, toggleable; zero-deps loop) instead of built-in AI.
- Granular AI permissions (enforced via Dev Server when plugin is active).
- Framework and project-aware AI context (provided by the plugin).
- AI-assisted debugging and teaching (plugin surface).
- Compiler extensions.
- Predictive development.
- Transactional AI operations (plugin-mediated).
- Checkpoints, rollback, history, and replay (plugin + Dev Server).

## Architectural Principle

The Vesk Dev Server should be the backbone. AI is **not** a core layer — it is an
installable plugin `@vesk/agentic` that plugs into the same Dev Server capabilities as
any other plugin.

```text
                    Vesk DevTools
                         │
              ┌──────────┼──────────┐
              │          │          │
     @vesk/agentic    Plugins    Config
      (AI plugin)    (incl. AI)    │
              │          │          │
              └──────────┼──────────┘
                         │
                 Vesk Dev Server  ← capability-gated API
                         │           (config · file · command · diagnostics
                         │            · build · checkpoints · ai*)
        ┌────────────────┼────────────────┐
        │                │                │
   Project Files     Compiler          Commands
        │                │                │
        └────────────────┼────────────────┘
                         │
                    Vesk Project

  * ai/checkpoint capabilities are implemented by @vesk/agentic when installed;
    core ships the API surface, the plugin ships the runtime (vendored
    @narimangardi/agent-loop, 20.7kB zero-deps).
```

The same APIs should power the browser, CLI, IDE integrations, plugins, and (when
installed) the AI agent plugin.

The overarching goal is to make Vesk feel less like a framework developers configure manually and more like an intelligent development environment that understands, builds, explains, and safely operates their application.


---

# AI Agent Runtime Integration Plan

## Selected Runtime — Vendored zero-deps clone of @narimangardi/agent-loop (inside @vesk/agentic)

Vesk DevTools uses a lightweight, highly configurable agent runtime rather than implementing
the complete agent loop and model-provider abstraction from scratch.

**Selected:** a vendored, zero-dependency clone of `@narimangardi/agent-loop` — **20.7kB
zero-deps** (single package, no runtime deps) — embedded **inside the installable plugin
`@vesk/agentic`**. The plugin, not the Vesk core, owns the loop, provider wiring, tools,
permissions, context, and checkpoint/transaction integration via the Vesk Dev Server API.

**Rejected — Pi:**

- Bare names `pi-agent-core` / `pi-ai` resolve to **486B stub packages** (empty placeholders,
  no implementation) — not a runtime.
- Namespaced `@earendil-works/pi-agent-core` (**4.1MB**) + `@earendil-works/pi-ai`
  (**1.9MB**) **fail the footprint audit**: hard dependencies on `openai`,
  `@anthropic-ai/sdk`, `@google/genai`, `@aws-sdk` (and transitive SDK graphs) force
  ~6MB+ into the dependency tree even when only one provider is used, with Node-specific
  SDK code incompatible with browser/worker execution and no tree-shakeable provider split.
  They also couple the agent to a full coding-agent product surface otherwise unnecessary
  for Vesk's Dev Server-mediated tools/permissions model.

Do **not** integrate the full Pi coding-agent application or `@earendil-works/*`. Prefer
the smallest useful primitive so `@vesk/agentic` owns the UX, permissions, tools, project
context, and Dev Server integration; the vendored loop is generic machinery only.

## Mandatory Inspection Before Integration

Before vendoring `@narimangardi/agent-loop` into `@vesk/agentic` (and before any Vesk
core dependency change), inspect the upstream implementation and verify it meets Vesk's
resource and architectural requirements. The inspection must happen **before writing
integration code**; record results in `plans/devtools-agentic-audit.md` (successor to
`plans/devtools-pi-audit.md`).

Inspect and document:

### Dependency footprint

- Direct dependencies (target: **zero** — verified for `@narimangardi/agent-loop`).
- Transitive dependencies.
- Optional/peer dependencies.
- Runtime-only vs build-time dependencies.
- Node-specific or browser-incompatible dependencies.
- Contrast with rejected Pi footprint: 486B stubs vs 4.1MB+1.9MB + hard SDK deps.

### Runtime footprint

Measure or reasonably benchmark:

- Package/install size (20.7kB unpacked for the loop).
- Bundled size (plugin bundle impact; DevTools panel impact where applicable).
- Startup time.
- Baseline memory usage.
- Memory growth during an agent task.
- CPU usage during idle and active operation.

### Browser compatibility

Determine which parts can execute safely in:

- Browser environments.
- Web Workers.
- A browser-based Vesk DevTools client.
- The Vesk Dev Server (plugin host).

Identify anything that must remain server-side. The vendored loop must be browser-safe;
provider SDK calls stay server-side behind the Dev Server capability gate.

### Configurability

Determine whether `@vesk/agentic` (wrapping the vendored loop) can control:

- Model providers.
- Models.
- System prompts.
- Context.
- Tools.
- Tool schemas.
- Agent state.
- Streaming.
- Execution behavior.
- Permissions.
- Confirmation/approval behavior.
- Session history.

### Architecture compatibility

Determine whether the loop can be embedded as a library inside the plugin without forcing
Vesk (or the plugin host) to adopt:

- Its CLI.
- Its terminal UI.
- Its application-level UI.
- Its opinionated project structure.
- Unnecessary integrations.
- Unnecessary MCP infrastructure.
- Unnecessary agent features.

## Integration Rule

Only vendor the minimal `@narimangardi/agent-loop` primitives required after the
inspection confirms they satisfy Vesk's footprint, browser-compat, and configurability
requirements. Core Vesk gains **no** new AI dependency; `@vesk/agentic` depends only on
the vendored zero-deps loop plus the Dev Server API.

The goal is:

**Vesk owns the platform. @vesk/agentic owns the agent experience. The vendored
`@narimangardi/agent-loop` provides the minimal agent engine (20.7kB, zero-deps).**

Do not make Vesk core dependent on Pi, its stubs, or its heavy SDK-coupled packages.

---

# Vesk Agent Architecture

```text
                         Vesk DevTools
                              │
                ┌─────────────┼─────────────┐
                │             │             │
             AI Panel      Plugins       Config
             (plugin)        │             │
                │             │             │
                └─────────────┼─────────────┘
                              │
                     @vesk/agentic  ← installable AI plugin
                              │
              ┌───────────────┴───────────────┐
              │  vendored @narimangardi/agent-loop │
              │        20.7kB · zero-deps      │
              │  (rejected: pi-agent-core/pi-ai │
              │   486B stubs; @earendil-works/* │
              │   4.1MB+1.9MB + hard SDK deps) │
              └───────────────┬───────────────┘
                              │
                       Vesk Dev Server  ← capability gate
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
         Filesystem        Commands          Compiler
            │                 │                 │
            └─────────────────┼─────────────────┘
                              │
                         Vesk Project
```

## Vesk Agent Layer (inside @vesk/agentic)

Create a thin Vesk-owned abstraction around the vendored `@narimangardi/agent-loop`
clone. The abstraction lives **inside the plugin**, not in Vesk core, and prevents the
rest of Vesk (and the plugin's consumers) from becoming tightly coupled to the loop
implementation.

Conceptually (inside `@vesk/agentic`):

```ts
interface VeskAgent {
  explore(input: AgentInput): Promise<AgentResult>
  debug(input: AgentInput): Promise<AgentResult>
  run(input: AgentInput): Promise<AgentResult>
}
```

The implementation internally uses the vendored `@narimangardi/agent-loop` (20.7kB
zero-deps). Previous Pi candidates are rejected: bare `pi-agent-core`/`pi-ai` are 486B
stubs; `@earendil-works/*` variants fail the footprint audit (4.1MB+1.9MB, hard deps
`openai`/`@anthropic-ai/sdk`/`@google/genai`/`@aws-sdk`).

This allows `@vesk/agentic` to replace or evolve the underlying loop later without
redesigning DevTools or Vesk core; core Vesk never imports an agent runtime.

---

# Vesk-Native Agent Tools

The agent should operate through Vesk-aware tools rather than blindly manipulating the project.

Initial tool categories should include:

```text
vesk.inspectProject()
vesk.inspectComponent()
vesk.readConfig()
vesk.updateConfig()
vesk.getDiagnostics()
vesk.getCompilerErrors()
vesk.runBuild()
vesk.runTests()
vesk.installPlugin()
vesk.uninstallPlugin()
vesk.enablePlugin()
vesk.disablePlugin()
vesk.createCheckpoint()
vesk.rollback()
```

Additional generic tools may include:

```text
filesystem.read
filesystem.write
filesystem.delete
command.execute
```

These should be exposed only when the user's permissions allow them.

---

# Provider and Model Configuration

The AI panel should allow users to select:

- Provider.
- Model.
- API key.
- Agent mode.
- Tool permissions.
- Context settings.

Provider configuration should be independent of the agent runtime.

The system should make it possible to use different providers without changing Vesk's agent implementation.

---

# Agent Permission Model

Vesk owns the permission system.

## Explore

Read-only.

Allowed:

- Read project files.
- Inspect project structure.
- Inspect Vesk configuration.
- Inspect plugins.
- Inspect compiler diagnostics.
- Analyze errors.
- Explain code.

Not allowed:

- File modifications.
- Command execution.
- Package installation.
- Configuration changes.

## Debug

Controlled modification.

Allowed capabilities should be configurable by the user.

Typical capabilities:

- Read files.
- Analyze diagnostics.
- Modify relevant source files.
- Run tests.
- Run builds.

## Agent

Full agentic operation subject to granular user permissions.

Possible permissions:

```text
readFiles
writeFiles
deleteFiles
executeCommands
installPackages
modifyConfig
managePlugins
runBuild
runTests
modifyAgentsMd
createCheckpoint
rollback
```

The user can individually enable or disable these capabilities.

---

# Agent Context Pipeline

The agent context should be assembled from:

```text
Vesk Framework Knowledge
        +
Vesk Documentation
        +
llm.txt
        +
Vesk agents.md / framework agent instructions
        +
Project agents.md
        +
Project Files
        +
Project Configuration
        +
Plugin State
        +
Compiler State
        +
Diagnostics
        +
Current User Request
```

Project-level instructions must take precedence where appropriate, while protected project rules remain developer-controlled.

`agents.md` should be readable by the agent but protected from modification unless the user explicitly grants that permission.

---

# Agent Transactions and Checkpoints

Every significant agent operation should be capable of being treated as a transaction.

```text
User Request
     ↓
Agent Plan
     ↓
Preview
     ↓
Permission Check
     ↓
User Approval
     ↓
Execute
     ↓
Validate
     ↓
Checkpoint
```

Failed or unwanted operations should be reversible:

```text
Checkpoint
    ↓
Agent Changes
    ↓
Build/Test
    ↓
Success ─────→ Keep
    │
    └────────→ Rollback
```

The underlying checkpoint implementation may use the selected agent runtime where appropriate, but Vesk should expose its own stable checkpoint and rollback API.

---

# Browser / Server Boundary

The browser should not directly execute arbitrary host-system commands.

Use the Vesk Dev Server as the security and execution boundary:

```text
Browser
  │
  │ Vesk Dev Server API
  ▼
Vesk Dev Server
  │
  ├── Agent Runtime
  ├── Filesystem
  ├── Command Runner
  ├── Compiler
  ├── Plugin Manager
  └── Checkpoint Manager
```

For a browser-only environment, investigate WebContainers or an equivalent browser runtime as a separate execution layer.

The AI interface should remain usable on low-resource devices. Heavy computation should be delegated to the configured model provider and, where necessary, the Vesk Dev Server/browser runtime rather than requiring a large local model.

---

# Acceptance Criteria

The integration is successful only if:

- Vesk can select and configure multiple AI providers.
- The agent runtime can be used without adopting an entire external coding-agent application.
- Explore, Debug, and Agent modes are implemented by Vesk.
- Permissions are controlled by Vesk.
- Vesk-native tools can be registered with the agent.
- `agents.md` can be protected from modification.
- Agent actions can be previewed.
- Agent changes can be checkpointed.
- Changes can be rolled back.
- Vesk diagnostics and compiler state can become agent context.
- The implementation works with the Vesk Dev Server architecture.
- The dependency footprint is measured before integration.
- Browser compatibility is explicitly verified for every client-side dependency.
- Unnecessary dependencies and features are not introduced.

## Guiding Principle

> **Use open-source infrastructure for the generic agent machinery. Build the Vesk intelligence, controls, tools, compiler integration, and developer experience ourselves.**

The result should feel like a native Vesk capability, not an external AI coding tool embedded inside Vesk.

---

# Operational Status (append-only — keep in sync with TODO.md)

This section tracks what has been built vs. what remains. It exists so a fresh agent can
pick up the next slice of DevTools without re-reading the whole history.

## ✅ Covered by prompts already given (do NOT re-implement)

These were explicitly requested by the user and are either done or in flight:

1. **Themed tabbed devtool shell** — floating panel → tabbed panel (Overview / Errors /
   Plugins / Log / Settings) in `packages/runtime/src/hmr-client.ts`; light/dark/system
   themes via `--vk-*` custom properties + `data-theme`; left/right dock via `data-pos`;
   settings tab with THEME + PANEL POSITION; full `DevtoolState` persisted in localStorage
   (`DEV_STATE_KEY='veskDevPrefs'`: theme, pos, activeTab, open, w, h, maxed). DONE.
 2. **Devtool cosmetics** — remove the size readout in the status bar (`#__kp_statusms`,
    the "WxH / compile ms" line at the top); hide pane scrollbars; `scroll-behavior:smooth`
    at the top. DONE. **2026-08-30:** all native scrollbars removed across the devtools root
    (`#__vesk_dev`/`#__vesk_overlay` `scrollbar-width:none` + `::-webkit-scrollbar{display:none}`)
    while panes stay scrollable via `overflow-y:auto`. **2026-08-30 (scroll fixed):** the
    `#__kp_content` wrapper (a plain block child) never constrained the pane's height, so tall
    content (e.g. long plugin lists) overflowed and was clipped with **no** scrollbar; it is now
    a bounded flex column (`#__kp_content{flex:1;flex-direction:column;min-height:0}`) with the
    pane `min-height:0`, so every pane actually scrolls. The rail sidebar is a genuine two-column
    grid (`grid-template-areas:"head head" "tabs body"`, tabs left `52px` → `104px` on hover,
    content right), no longer a thin bar stacked on top of content.
3. **Plugin manager rebuild (no stubs)** — cards OR list view of plugins with metadata;
   real activate/deactivate/update/uninstall/install, all effectively working; deactivated
   plugins fully excluded from builds (enforced via `plugins.ts` `filterActivePlugins`,
   already wired into `index.ts` build); after any plugin event the dev server re-runs the
   build and the browser fully reloads; uninstall = real `npx npm uninstall`. IN FLIGHT.
4. **Plugin metadata & icons** — read `vesk.meta.json` first (author, description, license,
   homepage, repository, keywords, plus `icon.png`/`icon.ico` served by the dev server);
   fall back to the installed package's `package.json`; enrich with npm registry data (latest
   version, last-publish time, author, git url, license); default icon when nothing exists.
   IN FLIGHT.
5. **Install sub-tab** — browse npm for Vesk plugins (packages with `@vesk/*` scope or the
   `vesk` keyword / `@vesk/plugin-*` naming) proxied through the dev server, and install from
   the devtool. IN FLIGHT.
6. **Plugin introspection** — a "View exports / types" action per plugin exposing the plugin's
   public exports + `.d.ts` declarations (served by the dev server, rendered in the devtool).
   IN FLIGHT.
 7. **Sidebar rail mode** — tab bar can be an expandable sidebar or an icons-only rail with
    hover labels; user-pickable, persisted in `DevtoolState` (Settings → SIDEBAR MODE now labels
    them **top** / **sidebar**). DONE. The sidebar is a real two-column layout: `#__vesk_dev`
    switches to CSS grid in rail mode (`grid-template-areas:"head head" "tabs body"`), tabs as the
    left column (collapsed `52px` ≈ 90% content width, hover `104px` ≈ 80%) and tab content on
    the right filling the remaining width/height — not a bar stacked on top of the content.
 8. **Plugin UX fixes (2026-08-30)** — (a) **plugin detection** fixed in `packages/adapter/src/plugins.ts`
    `resolvePackage`: the walk-up-to-package.json guard previously used `cur.startsWith(appDir)`,
    which never matched packages resolving into the **project root** `node_modules` (outside
    `appDir`), so exports-mapped packages reported `installed:false`. Replaced with a bounded
    walk-up to the nearest `package.json` (stopping at the containing `node_modules` boundary /
    fs root, seen-set cycle guard). Verified live: `/__vesk/plugins` now reports
    `installed:true, active:true` with full metadata for `@vesk/plugin-tailwind`.
    (b) **Install progress/loading state** — `pluginInstalling` state disables the in-flight
    install button (guard against double-install) and renders an `installing...` + "please wait"
    hint. (c) **Pre-install plugin detail** — npm search results now have a `details` action
    (`data-search-pkg-open`) and row-click opens `renderSearchPluginDetail` (name, version,
    description, author, published date, keywords, install button), so a plugin can be
    inspected before installing; previously search-result rows had no click handler at all.
    Coverage: `packages/runtime/src/hmr-client.test.ts` 192/192.
 9. **Plugin UX fixes, round 2 (2026-08-30)** — (a) **installed status in search**: search
    rows + the npm detail now show an `installed` badge and disable the install button for
    already-installed packages (client compares against the installed `plugins[]` and passes the
    names into `renderPluginSearch`/`renderSearchPluginDetail`). (b) **search retry / "won't
    search again" fixed**: `fetchRegistryJson` in `packages/adapter/src/plugins.ts` was caching
    failed/`null` registry responses for 5 min — after one timeout the same query returned a
    stale empty result until TTL expiry; only successful responses are cached now, and the
    registry fetch timeout is raised 2500ms → 6000ms so npm search isn't so latency-flaky.
    (c) **scroll fix** (see item 2). Coverage: `hmr-client.test.ts` 206/206;
    `packages/adapter/src/plugins.test.ts` 101/101 (new regression: failed fetch is not cached,
    so the same query succeeds on retry).

In-flight work is split across subagents by package ownership (UI: `packages/runtime` —
`hmr-client.ts` + its test; Backend: `packages/adapter` — `plugins.ts`, `dev-server.ts`,
+ tests). See "In-flight API contract" below for the shared wire format.

## 🗂 Backlog — NOT covered by any prompt yet (pick up from here)

These come from the notes above + `plans/devtools-prompt.md`. They are ordered by how
ready they are to start. Each entry: scope, where it lives, acceptance.

### B1. Browser-based project configuration (Note 2, devtools-prompt §2) — ✅ IMPLEMENTED
- **Goal:** configure the Vesk app from the browser; changes persist to the real project
  files through the dev server API — no direct filesystem access from the browser.
- **Server:** extend the dev panel router with capabilities-scoped endpoints:
  `GET /__vesk/config` (the parsed `vesk.config.ts`) and `POST /__vesk/config` (write
  back to `vesk.config.ts`, preserving formatting/comments as much as feasible).
  Implemented: `readConfig`/`writeConfigSource`/`applyConfigToggle` in
  `packages/adapter/src/dev-config.ts`, exposed as `GET/POST /__vesk/config` on the
  unified router. Invalid source is validated and NEVER clobbers the on-disk file.
- **UI:** a "Config" tab (or route) with toggle-based settings for known options plus a
  direct `vesk.config.ts` editor (textarea + save + validation errors).
- **Acceptance:** toggling a config option is visible in `vesk.config.ts`; invalid config
  returns a clear error and does not clobber the file; reloads reflect the change.
  Coverage: `packages/adapter/src/dev-api.test.ts` config cases.
- **Depends on:** nothing currently in flight.

### B2. Dev Server API centralization + capability permissions (Note 7, devtools-prompt §1) — ✅ SERVER IMPLEMENTED
- **Goal:** one dependency-free API layer in the dev server organizing endpoints by
  capability (config, plugins, diagnostics, build, commands, AI, checkpoints) with
  server-side permission checks — the browser is NOT allowed raw `child_process`.
- **Server:** generalize the `createPluginStateRouter` pattern into a `createDevApiRouter`
  in `packages/adapter/src/dev-api.ts`; add a capability/permission table; add
  `POST /__vesk/build` (trigger a rebuild, stream result), `GET /__vesk/diagnostics`
  (snapshot of current compiler/build errors), a gated command runner
  (`POST /__vesk/command`, allowlist-by-default), and read-only file access
  (`GET /__vesk/file?path=` for config/plugin inspection).
  Implemented: `createDevApiRouter` in `packages/adapter/src/dev-api.ts` with a
  `CapabilityTable` (`DEFAULT_CAPABILITIES`: `command` off by default, others on),
  `DEFAULT_COMMAND_ALLOWLIST` (read/status-only commands), containment-checked read-only
  `file.read`, and `command` routed through an injectable `runCommand` hook — the server is
  the ONLY path (no raw `child_process` reach). Both the adapter dev server
  (`createPluginStateRouter` is now a thin delegate) and the CLI dev server
  (`packages/cli/src/dev-server.ts` `/__vesk/*` handler) route through it. Exported from
  the adapter public index (`createDevApiRouter`, `CapabilityTable`, `DEFAULT_CAPABILITIES`,
  `DEFAULT_COMMAND_ALLOWLIST`).
- **Acceptance:** every devtool action round-trips through the API; permission checks are
  enforced server-side (cannot be bypassed from the client); tests cover the gated command
  runner. Coverage: `packages/adapter/src/dev-api.test.ts` (27) + `packages/cli/src/dev-server.test.ts` (27).
- **Depends on:** B1 for shape conventions; independent otherwise.

### B3. Diagnostics + Predictive Development (Note 11) — 🔶 SERVER ENDPOINT DONE, UI + PRODUCERS PENDING
- **Goal:** move from reactive debugging to proactive diagnosis surfaced in the devtool.
- **Server:** new diagnostic producers in the adapter build/dev path: page-error counts,
  compile-time stats, large-bundle warnings, route weight hints, dependency-size notices,
  conflicting-plugin and invalid-config detectors. Emit as a structured diagnostics list
  (severity, code, file, message, hint) consumed by the Errors/Diagnostics tab.
  The transport is DONE: `GET /__vesk/diagnostics` on `createDevApiRouter` returns the
  injectable `getDiagnostics()` snapshot (`DiagnosticFinding[]`). The producers/aggregators
  and the UI tab remain.
- **UI:** a Diagnostics tab (or extend Errors tab) rendering severity-grouped, live-updating
  findings; click-through to file/line.
- **Acceptance:** realistic bad-app report includes at least bundle-size and conflicting-
  plugin signals; each finding has a fix hint; diagnostics survive HMR reloads.
- **Depends on:** B2 (diagnostics endpoint), plus a build-hook in the compiler/adapter.

### B4. Compiler extension platform + richer plugin manifest (Notes 1, 10)
- **Goal:** declare-and-enforce plugin capabilities: vesk/compiler compatibility, capabilities,
  config schema, dependencies, build hooks.
- **Server:** define the manifest additions (`vesk.meta.json` / package.json `exports`),
  validate compatibility at install time, and expose lifecycle hooks (config-resolve,
  markup-transform, css/theming, build-start/end, ssr) that plugins can register.
- **UI:** plugin detail shows capabilities, compat, deps, and config schema.
- **Acceptance:** a sample plugin demonstrating a lifecycle hook participates in the build
  only when active; incompatible-compat installs are rejected with a clear message.
- **Depends on:** in-flight plugin metadata work (this extends it); significant compiler
  work — needs its own plan before starting.

### B5. Per-plugin configuration UI
- **Goal:** configure each installed plugin from the devtool using its declared schema.
- **UI:** in the plugin management view, render a dynamic form from the plugin's config
  schema and persist the result into the project's plugin options (via B1 config write-back).
- **Acceptance:** editing a plugin's options regenerates the build config and the dev server
  picks it up without manual file edits.
- **Depends on:** B1 (config writeback) + B4 (schema declaration).

### B6-plug. AI integration as plugin @vesk/agentic (Notes 3–6, 8–9, 12–13; devtools-prompt §4–8)
> AI is **not** built-in. All items below are scoped to the installable plugin
> `@vesk/agentic` (vendored `@narimangardi/agent-loop`). Core Vesk ships no agent runtime.

The largest remaining chunk. Mandatory order — plugin-local, gated by footprint audit:
1. **Footprint audit first** — `plans/devtools-agentic-audit.md` (successor to
   `plans/devtools-pi-audit.md`) covering dependencies, install size, startup, memory,
   browser/worker compatibility, configurability, embeddability for the **vendored
   `@narimangardi/agent-loop` (20.7kB zero-deps)**. Document Pi rejection: bare
   `pi-agent-core`/`pi-ai` are **486B stubs**; `@earendil-works/pi-agent-core`
   (**4.1MB**) + `@earendil-works/pi-ai` (**1.9MB**) fail footprint audit due to hard
   deps `openai`/`@anthropic-ai/sdk`/`@google/genai`/`@aws-sdk`. Write BEFORE any
   integration code. If the vendored loop doesn't pass, report and stop — never ship a
   heavier agent framework; do not fall back to Pi.
2. **Plugin package + provider layer** — scaffold `packages/agentic` as `@vesk/agentic`;
   plugin manifest + activation lifecycle; provider/model/API-key config in the devtool
   (shown only when plugin is installed & active), provider-agnostic client abstraction;
   ≥2 providers from config alone without touching the vendored loop.
3. **Modes + permissions (server-enforced via Dev Server, implemented in plugin)** — Explore
   (read-only) / Debug (controlled fixes) / Agent (per-capability toggles: readFiles,
   writeFiles, deleteFiles, executeCommands, installPackages, modifyConfig, managePlugins,
   runBuild, runTests, modifyAgentsMd, createCheckpoint, rollback). `agents.md` readable
   by default, writable only on grant. Checks enforced through `createDevApiRouter`
   capabilities — browser cannot bypass.
4. **Layered context (assembled by plugin)** — framework knowledge (docs, `llm.txt`,
   framework agents.md) + project knowledge (project `agents.md`, rule precedence) + live
   project context (files, config, deps, compiler state, diagnostics, git state, active
   plugins, running processes where permitted) — injected via Dev Server reads.
5. **Vesk-native tools (exposed by plugin, gated by permissions, routed through Dev Server)**
   — `vesk.inspectProject`, `vesk.inspectComponent`, `vesk.readConfig`,
   `vesk.updateConfig`, `vesk.getDiagnostics`, `vesk.getCompilerErrors`, `vesk.runBuild`,
   `vesk.runTests`, `vesk.installPlugin`, `vesk.uninstallPlugin`, `vesk.enablePlugin`,
   `vesk.disablePlugin`, `vesk.createCheckpoint`, `vesk.rollback`; generic tools
   (`filesystem.*`, `command.execute`) gated behind permissions and routed through the dev
   server's allowlisted runner.
6. **Transactions + checkpoints + history + replay** — Preview → Approve → Execute → Validate
   → Checkpoint; every checkpoint records files/commands/deps/before-after/build-test
   outcome; rollback restores prior state, replay re-runs a task; a history UI shows it all
   (plugin panel, conditionally rendered).
7. **Teaching assistant surface (Note 8)** — the AI explains "why" (patterns, errors, build
   failures, components) alongside doing.
- **Acceptance:** plugin installs/activates/deactivates like any Vesk plugin (inactive ⇒ zero
  bundle/build impact); footprint audit (`devtools-agentic-audit.md`) committed before code
  and documents Pi rejection (486B stubs vs 4.1MB+1.9MB + SDK hard deps) and vendored loop
  20.7kB zero-deps; all three modes enforced server-side via Dev Server capabilities; every
  agent action checkpoints; rollback practically restores file state.
- **Depends on:** B2 (command runner, file access, diagnostics) — do B6-plug in phases,
  B1/B2/B3 can land first; no core Vesk dependency on `openai`/`@anthropic-ai/sdk`/
  `@google/genai`/`@aws-sdk`.

### B7. Full-page DevTools as a `.vsk` app (devtools-prompt §2)
- **Goal:** a dev-only route (e.g. `/__vesk`) serving the same DevTools as a full page built
  in `.vsk`, alongside the floating overlay.
- **Acceptance:** the page is a real Vesk project consuming the same API; overlay and page
  share state where sensible.
- **Depends on:** B1/B2 API surface; can be started after the floating panel work settles.

## In-flight API contract (single source of truth for the current sub-agent split)

Both the UI agent (`packages/runtime`) and the backend agent (`packages/adapter`) must
implement against this exact contract. Do not drift.

### Plugin record — `GET /__vesk/plugins` → `{ plugins: PluginRecord[] }`

```ts
interface PluginRecord {
  name: string;              // display name (package.json.name or local dir name)
  package: string;           // npm package spec (name for local plugins)
  path: string | null;       // resolved entry path
  active: boolean;           // RESOLVED build participation = (stateEntry.active ?? configDefault) && installed
  installed: boolean;        // resolvable in node_modules / local dir
  version: string | null;    // installed version from package.json
  latest: string | null;     // npm registry latest (null if registry unreachable)
  description: string | null;
  author: string | null;     // string name or "Name <email>"
  license: string | null;
  homepage: string | null;
  repository: string | null; // git URL
  updatedAt: string | null;  // last publish time (registry) — ISO or null
  keywords: string[];
  iconUrl: string | null;    // relative: '/__vesk/plugins/<enc-name>/icon' when a meta icon exists, else null
  metaSource: 'vesk.meta.json' | 'package.json' | 'none';
  source: 'config' | 'state';
  error: string | null;      // e.g. "may not be a Vesk plugin", "not installed"
}
```

**`active` resolution (fixes the "installed:false but active:true" bug):** a record is
`active:true` only when the plugin is installed AND the effective state entry says active
(config plugins default to active only while installed). The devtool must never show a
green/active badge next to `installed:false`.

### Endpoints (dev panel router — `createDevApiRouter`, `packages/adapter/src/dev-api.ts`)

All `/__vesk/*` endpoints are **capability-gated server-side** (`CapabilityTable`) and
served by BOTH the adapter dev server and the CLI dev server (`vesk dev`). `command` is
`false` by default; the browser cannot bypass these checks.

| Method & path | Body / query | Response |
|---|---|---|
| GET `/__vesk/config` | — | `{ path, exists, source, config }` |
| POST `/__vesk/config` | `{ source }` or `{ key, value }` | `{ ok, path, source, config }` (invalid source → 400, never clobbers) |
| GET `/__vesk/diagnostics` | — | `{ diagnostics: DiagnosticFinding[] }` |
| POST `/__vesk/build` | — | `{ ok, error, ms }` (503 when no `rebuild` hook) |
| GET `/__vesk/file?path=<rel>` | query `path` | `{ ok, path, directory:false, content }` / `{ ok, path, directory:true, entries }` (403 on escape) |
| POST `/__vesk/command` | `{ argv }` | `{ ok, code, stdout, stderr }` (403 when capability off or not allowlisted) |
| GET `/__vesk/plugins` | — | `{ plugins: PluginRecord[] }` |
| POST `/__vesk/plugins/activate` | `{ name }` | `{ ok: true, record: PluginRecord }` |
| POST `/__vesk/plugins/deactivate` | `{ name }` | `{ ok: true, record: PluginRecord }` |
| POST `/__vesk/plugins/install` | `{ package }` | `{ ok: true, record: PluginRecord }` (400/500 `{ error }`) |
| POST `/__vesk/plugins/uninstall` | `{ package }` | `{ ok: true }` |
| POST `/__vesk/plugins/update` | `{ package }` | `{ ok: true, record: PluginRecord }` |
| GET `/__vesk/plugins/<encoded-name>/exports` | — | `{ ok, name, entry: string\|null, packageJsonExports: Record<string,string>\|null, dtsPath: string\|null, dtsExports: string[] }` |
| GET `/__vesk/plugins/<encoded-name>/icon` | — | PNG (`image/png`) or ICO (`image/x-icon`); 404 `{ error }` if none |
| GET `/__vesk/plugins/search?q=<text>` | — | `{ results: { name, version, description, author, date, keywords, links }[] }` |

- `exports`: read resolved `.d.ts` (`package.json.types`/`typesVersions`, else skip) and
  parse top-level `export` declarations → names list; also surface package.json `exports`
  keys. Never import the plugin module.
- `icon`: from `vesk.meta.json`-declared `icon.png`/`icon.ico` next to the plugin entry
  path; serve with correct MIME, default icon only on the UI side (a favicon-style glyph or
  the letter, decided by the UI agent), not the server.
- `search`: proxy to `https://registry.npmjs.org/-/v1/search?text=<q>`; default browsing in
  the UI should surface `@vesk/*` scope + `@vesk/plugin-*` naming + `vesk` keyword results.
- Every mutation (activate/deactivate/install/uninstall/update) must, after persisting:
  (a) return the fresh record, and (b) call the router's `onPluginChange` hook so the dev
  server re-runs the affected build step and broadcasts a full-page reload to all HMR
  websocket clients. The UI does NOT self-reload from the mutation response alone — it relies
  on the server broadcast (same path as a normal full HMR reload), so no duplicate
  implementation.

### Wiring `createDevApiRouter` into a dev server

```ts
import { createDevApiRouter, CapabilityTable, DEFAULT_CAPABILITIES } from '@vesk/adapter';

const router = createDevApiRouter({
  appDir,                 // e.g. '<project>/app'
  veskDir,                // e.g. '<project>/.vesk'
  configPluginNames,      // names declared in vesk.config.ts `plugins`
  projectDir,             // where vesk.config.{ts,js} lives
  getHmrState: () => devState,
  onPluginChange: async () => { broadcast({ type: 'reload' }); },
  rebuild: async () => { await doRebuild(); return { ok: true, ms }; }, // POST /__vesk/build
  getDiagnostics: () => findings,           // GET /__vesk/diagnostics
  caps: DEFAULT_CAPABILITIES,                // `command` off by default; grant selectively
  commandAllowlist: DEFAULT_COMMAND_ALLOWLIST,
  runCommand: async (argv) => execAllowlisted(argv), // route through a gated runner only
});

// Per HTTP request:
const res = await router.route(method, pathname, body, search);
// res === null → not a /__vesk/* path; fall through to normal serving.
```

The router is deliberately pure (no socket/listener): the adapter dev server calls it
directly, and the CLI dev server wraps it in `routeDevPanel(req, res, url, deps)` in
`packages/cli/src/dev-server.ts`. Neither server exposes raw `child_process` to the browser —
`command` always goes through the allowlisted `runCommand` hook, and `file` is read-only and
containment-checked against `projectDir`.

`packages/cli/src/dev-server.ts` wires **live** hooks into its `startDevServer` router:
`rebuild` performs a full `scanRoutes` → client bundle → runtime → CSS rebuild and broadcasts
an HMR reload (returning `{ ok, ms }`); `getDiagnostics` returns a rolling 50-entry slate fed
by live HMR compile errors (`HMR_COMPILE`) and full-rebuild failures (`BUILD`); `getHmrState`
reflects the last build status/error. Unit coverage:
`packages/cli/src/dev-server.test.ts` (rebuild + diagnostics cases) and
`packages/adapter/src/dev-api.test.ts`.
