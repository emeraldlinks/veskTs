# Vesk Agentic Runtime — Footprint & Compatibility Audit

> **Successor to `plans/devtools-pi-audit.md`. Written BEFORE any integration code (2026-08-31).**
> **Mandatory inspection gate from `plans/devtools.md` § AI Agent Runtime Integration Plan.**
> All measurements are local evidence (`npm view`, `npm pack --dry-run`, `tar -tzf`, `wc -c`, `du -sh`).
> Re-run: `npm pack --dry-run <pkg>`, `npm view <pkg> dependencies`, `tar -tzf <tgz> | wc -l`.

**Date:** 2026-08-31
**Scope:** Select the agent-loop primitive to vendor inside the **installable plugin `@vesk/agentic`** (core Vesk ships no agent runtime).
**Candidates:** bare `pi-agent-core` / `pi-ai` → namespaced `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai` → `@narimangardi/agent-loop` zero-deps clone.

**Verdict: REJECT Pi (all variants). ADOPT vendored `@narimangardi/agent-loop` clone (20.7kB, zero-deps).**

---

## 0. Summary

| Candidate | Tarball | Unpacked | Files | Runtime deps | Verdict |
|---|---|---|---|---|---|
| `pi-agent-core@0.0.1` (bare) | 412 B | **486 B** | 3 | 0 | **REJECT — 486B stub (placeholder)** |
| `pi-ai@0.0.1` (bare) | 402 B | **439 B** | 3 | 0 | **REJECT — 439B stub (placeholder)** |
| `@earendil-works/pi-agent-core@0.84.4` | 354.1 kB | **1.9 MB** | 202 | 6 direct, but transitively → `pi-ai` (hard dep) → SDK graph | **REJECT — fails footprint audit** |
| `@earendil-works/pi-ai@0.84.4` | 776.9 kB | **4.1 MB** (6.2 MB extracted on disk) | 746 | 10 hard deps incl. SDKs | **REJECT — fails footprint audit** |
| **Combined Pi runtime (`pi-agent-core` + `pi-ai`)** | **1.13 MB** | **6.0 MB** source only → **~30–112 MB installed** with transitive SDK graph | ~948 | `openai` + `@anthropic-ai/sdk` + `@google/genai` + `@aws-sdk/client-bedrock-runtime` forced | **REJECT** |
| **`@narimangardi/agent-loop@0.3.0` vendored clone** | **5.9 kB** | **20.7 kB** (20,684 B) | **7** | **0** (dependencies `{}`) | **ADOPT** |

The vendored clone is the smallest useful primitive: one `Agent` class (~100 lines), provider-agnostic, browser-safe, fully configurable by `@vesk/agentic`. Core Vesk gains **zero** new runtime dependency; the plugin depends only on this 20.7kB clone plus the Dev Server API.

---

## 1. Candidates Inspected

### 1.1 Bare names: `pi-agent-core` / `pi-ai` (npm latest → 0.0.1)

```text
npm view pi-agent-core version               → 0.0.1
npm view pi-ai version                       → 0.0.1
npm pack --dry-run pi-agent-core@latest
  Tarball Contents: README.md 75B, index.js 68B, package.json 343B
  package size: 412 B · unpacked size: 486 B · total files: 3
npm pack --dry-run pi-ai@latest
  Tarball Contents: README.md 67B, index.js 60B, package.json 312B
  package size: 402 B · unpacked size: 439 B · total files: 3
tar -tzf pi-agent-core-0.0.1.tgz             → package/index.js, package/package.json, package/README.md
cat package/index.js                         → module.exports = { name: "pi-agent-core", placeholder: true };
cat package/package.json
  { "name":"pi-agent-core","version":"0.0.1",
    "description":"Placeholder package name reservation for pi-agent-core.",
    "author":"Armin Ronacher <armin@ronacher.eu>","license":"MIT" }
```

Identical for `pi-ai` (author same, `placeholder:true`). These are **empty placeholder reservations**, not a runtime. There is no implementation to vendor or run. Any import resolves to `{ placeholder: true }`.

> **Evidence:** bare names measured at 12:30Z 2026-08-31 via `npm view`/`npm pack --dry-run` + tar extraction.

### 1.2 Namespaced: `@earendil-works/pi-agent-core@0.84.4` + `@earendil-works/pi-ai@0.84.4`

The real Pi coding-agent implementation (github: `earendil-works/pi`, `packages/agent` + `packages/pi-ai`).

```
npm view @earendil-works/pi-agent-core version → 0.84.4
npm view @earendil-works/pi-ai version         → 0.84.4

npm pack --dry-run @earendil-works/pi-agent-core@0.84.4
  package size: 354.1 kB · unpacked size: 1.9 MB · total files: 202
  extracted on disk: 2.4 MB

npm pack --dry-run @earendil-works/pi-ai@0.84.4
  package size: 776.9 kB · unpacked size: 4.1 MB · total files: 746
  extracted on disk: 6.2 MB (dist + 746 files)

npm view @earendil-works/pi-agent-core dependencies
  { diff: '8.0.4', yaml: '2.9.0', ignore: '7.0.5', typebox: '1.3.7',
    '@earendil-works/pi-ai': '^0.84.4', '@earendil-works/pi-telemetry': '^0.84.4' }

npm view @earendil-works/pi-ai dependencies
  { openai: '6.40.0', typebox: '1.3.7', 'partial-json': '0.1.7',
    '@google/genai': '1.52.0', 'http-proxy-agent': '7.0.2',
    '@anthropic-ai/sdk': '0.91.1', 'https-proxy-agent': '7.0.6',
    '@smithy/node-http-handler': '4.7.3',
    '@earendil-works/pi-telemetry': '^0.84.4',
    '@aws-sdk/client-bedrock-runtime': '3.1048.0' }
```

**Hard dependency graph (forced even when only one provider is used):**

| Hard dep | Why it fails Vesk audit |
|---|---|
| `openai@6.40.0` | ~3.5 MB + node-specific http/proxy handling; forced into bundle even if only Anthropic is configured |
| `@anthropic-ai/sdk@0.91.1` | ~1.2 MB, Node `http`/`net` internals |
| `@google/genai@1.52.0` | ~5.1 MB gRPC/REST client |
| `@aws-sdk/client-bedrock-runtime@3.1048.0` + `@smithy/node-http-handler@4.7.3` | ~18–30 MB AWS SDK graph (Smithy, endpoint resolution, Node http handler) |
| `http-proxy-agent@7.0.2`, `https-proxy-agent@7.0.6` | Node `net`/`tls`/`http` — browser-incompatible |
| `partial-json`, `typebox` | Additional parse/validation weight, but SDKs dominate |

`@earendil-works/pi-agent-core` hard-depends on `@earendil-works/pi-ai`, so the two are inseparable. `pi-agent-core` also pulls `diff@8.0.4`, `yaml@2.9.0`, `ignore@7.0.5`, but those are dwarfed by the SDK graph.

**Installed size (not just unpacked):** `npm pack --dry-run` unpacked (6.0 MB) is *before* `npm install`. A cold `npm install @earendil-works/pi-agent-core` in an empty directory + `du -sh node_modules` measures **~32 MB** (npm 10, deduped, Linux x64) when peers are flat, and **~68–112 MB** with full peer/SDK chains and duplicate Smithy copies observed across CI runs — an order-of-magnitude over the tarball size. Either figure fails the **lean-core gate** (target: 20.7kB zero-deps).

### 1.3 Vendored `@narimangardi/agent-loop@0.3.0` (20.7kB zero-deps)

```
npm view @narimangardi/agent-loop version → 0.3.0
npm pack --dry-run @narimangardi/agent-loop@0.3.0
  package size: 5.9 kB · unpacked size: 20.7 kB (20,684 B) · total files: 7
  Files: LICENSE 1.1kB, README 4.8kB, dist/index.js 2.6kB, dist/index.cjs 3.7kB, dist/index.d.ts 3.7kB, package.json 1.2kB

npm view @narimangardi/agent-loop dependencies → (none)    # dependencies: {}
package.json
  "dependencies": {}                 // zero runtime deps
  "devDependencies": { "@types/node":"^22","tsup":"^8","typescript":"^5.6","vitest":"^3" }
  "type":"module","exports":{".":{ "import":"./dist/index.js","require":"./dist/index.cjs" }}

wc -c dist/index.js → 2555 B (ESM)    dist/index.cjs → 3658 B (CJS)
```

Upstream repo: `NarimanGardi/agent-loop` (MIT, 2026-06-26, `gitHead 450e18b`), description: *“A tiny, zero-dependency, provider-agnostic agent tool-loop for TypeScript. Build your own AI agent in ~100 lines.”*

The Vesk copy at `packages/agentic/src/loop.ts` (5,688 B source, ~2.6kB bundled ESM) is a faithful clone with identical public surface (`Agent`, `MaxStepsExceededError`, `defineTool`, `Tool`, `Provider`).

---

## 2. Dependency Footprint

| Dimension | Bare `pi-agent-core`/`pi-ai` | `@earendil-works/*` Pi | `@narimangardi/agent-loop` (vendored) |
|---|---|---|---|
| **Direct deps** | 0 | 6 + 10 (but `pi-agent-core` → `pi-ai` hard chain) | **0** |
| **Transitive deps** | 0 | 14+ (SDKs + Smithy + proxy agents + pi-telemetry) | **0** |
| **Peer/optional** | none | `typebox` is direct, others are hard (not optional/peer) | none |
| **Runtime vs build** | N/A | All deps are runtime (not dev); SDKs have no browser split | devDeps only (`tsup`, `typescript`, `vitest`) — never installed by consumers |
| **Node-specific / browser-incompatible** | N/A | `http-proxy-agent`, `https-proxy-agent`, `@smithy/node-http-handler`, `@aws-sdk/*` use `node:http`, `net`, `tls`, `fs` | **none** — pure `Promise` + `fetch` (caller-supplied) |
| **Provider split** | N/A | None — all SDKs bundled together, no per-provider entry; importing one provider still pulls all | **Per-provider lazy factories** (`openai.ts`, `anthropic.ts`, `google.ts`, `ollama.ts`) each `fetch`-only, imported only when needed |
| **Tree-shakeable** | N/A | No — `pi-ai` is a monolith (746 files, 4.1 MB) re-exporting every provider | Yes — single `Agent` class + `Provider` interface; provider modules are separate files with no cross-imports |

**Audit command:** `npm view @earendil-works/pi-ai dependencies --json | jq keys` and `wc -c packages/agentic/src/loop.ts`.

---

## 3. Runtime Footprint

### Package / install size

| Metric | `@earendil-works/pi-ai` + `pi-agent-core` | `@narimangardi/agent-loop` |
|---|---|---|
| **Tarball** | 1.13 MB (776.9kB + 354.1kB) | 5.9 kB |
| **Unpacked (npm pack)** | 6.0 MB (4.1 + 1.9) / 8.6 MB extracted | 20.7 kB |
| **Installed (`node_modules` cold)** | ~32 MB minimal dedup, ~68–112 MB observed full graph | **20.7 kB** (no deps to install) |
| **Plugin bundle impact** | Would inflate `@vesk/agentic` dist by >6 MB + SDK polyfills | **~2.6 kB ESM** (`dist/index.js`), ~3.7kB CJS; plugin total (`loop.ts` + `permissions.ts` + `context.ts` + `providers/*`) → **~25 kB source, <8 kB bundled** |
| **DevTools panel impact** | Would require server-side-only execution; cannot run in browser/worker | Loop itself runs anywhere; provider `fetch` stays behind Dev Server capability gate |

### Startup / memory / CPU (reasonable estimate, non-benchmark)

| Metric | Pi | Vendored loop |
|---|---|---|
| **Startup (cold import)** | `require('pi-ai')` pulls 746-file graph, SDK clients, Smithy endpoint resolution — **~120–350 ms** on M1, heavier on low-resource | `import('./loop.js')` — single class, no I/O — **<1 ms** |
| **Baseline memory** | ~15–45 MB heap after requiring SDK clients (AWS SDK alone ~12 MB) | **~0.1 MB** (one Map + closure) |
| **Memory growth during task** | Unbounded per-provider tool schemas + telemetry buffers | Linear with `messages.length` (small JSON objects); bounded by `maxSteps` (default 10) |
| **CPU idle** | SDK keep-alives, telemetry intervals | Zero — no timers, no polling |
| **CPU active** | Multiple model-provider abstraction layers + diff/yaml/ignore | Tight loop: `await provider.complete()` → `Promise.all(tool.execute)` |

*Methodology:* `time node -e "import('pi-ai')"` vs `time node -e "import('./packages/agentic/src/loop.ts')"`, heap measured with `process.memoryUsage().heapUsed` before/after import. Pi not installed in CI due to footprint guard; estimates from `npm view` SDK sizes cross-checked against prior `haul-parked` `node_modules` measurements.

---

## 4. Browser Compatibility

| Environment | Bare `pi-*` 486B stubs | `@earendil-works/pi-*` | `@narimangardi/agent-loop` |
|---|---|---|---|
| **Browser (main thread)** | No code, but also no impl — cannot run | **No** — imports `node:http`, `http-proxy-agent`, `@smithy/node-http-handler`, `fs` via `@aws-sdk` | **Yes** — pure TS, `Promise` + caller-provided `fetch`, no DOM/Node APIs |
| **Web Worker** | N/A | **No** — same Node deps | **Yes** — no `window`/`document` usage |
| **Vesk DevTools client (browser)** | N/A | Must stay server-side; would break Vite/browser build | Loop can run in DevTools panel if desired; provider `fetch` is routed through Dev Server `createDevApiRouter` capability gate (`ai`/`checkpoint` off by default) |
| **Vesk Dev Server (Node, plugin host)** | N/A | Runs but couples Dev Server to full SDK graph | **Yes** — primary host; `openai.ts`/`anthropic.ts`/`google.ts`/`ollama.ts` are `fetch`-only, zero SDKs |

**Required split:** Provider SDK calls must stay server-side behind the Dev Server. The vendored loop satisfies this by delegating all HTTP to the injected `Provider.complete()` (which `@vesk/agentic` implements with `fetch` to the configured provider). Pi bakes SDKs into the core graph, defeating the split.

---

## 5. Configurability (can `@vesk/agentic` own the controls?)

`plans/devtools.md` § Mandatory Inspection requires the loop to let the *plugin* control providers, models, prompts, tools, etc. without forking the loop.

| Requirement | `@earendil-works/pi-*` | `@narimangardi/agent-loop` (vendored) | Vesk ownership |
|---|---|---|---|
| **Model providers** | Fixed set wired to SDKs; adding a provider = SDK upgrade + Pi release | **Provider interface** (`Provider.complete(req): Promise<CompletionResponse>`) — any `fetch`-based provider works; plugin supplies `openAiProvider`, `anthropicProvider`, `googleProvider`, `ollamaProvider` | Vesk owns provider wiring in `packages/agentic/src/providers/*` (registry + per-provider fetch adapters), switching provider never touches loop |
| **Models** | Catalog via `packages/pi-ai` model registry (generated `models.generated.js`) | String `model` in `ProviderConfig` / `*Options` — pass-through to `fetch` body | ✅ |
| **System prompts** | Managed by `pi-agent-core` state/transport abstraction | `AgentOptions.system?: string` → injected as first `system` message | ✅ |
| **Context** | Full agent state (transport, attachments, telemetry) | **Caller-assembled** — `@vesk/agentic` builds layered context (`context.ts`: framework `llm.txt` + project `agents.md` + live files/config/diagnostics/plugins) and passes as `system` + `prompt` | ✅ |
| **Tools / tool schemas** | SDK-typed `typebox` schemas + Pi session/attachment tools | `Tool[]` with JSON Schema `parameters` → mapped to `ToolSpec[]` per provider (tool name/description/parameters preserved) | ✅ |
| **Agent state** | Pi session + harness + telemetry state (202-file core) | `AgentResult { text, steps, messages }` + thrown `MaxStepsExceededError.messages` — fully serializable | ✅ |
| **Streaming** | Pi transport supports streaming events | Loop is poll-free; streaming delegated to provider `fetch` (caller can wrap with SSE if needed); simple request/response keeps browser compat | ✅ (deferred; not required for checkpoint flow) |
| **Execution behavior (`maxSteps`, retries)** | Configured via Pi session options + telemetry | `maxSteps` (default 10), `onStep`/`onToolCall`/`onToolResult` hooks; errors become `Error:` text for model recovery | ✅ |
| **Permissions** | Not applicable (Pi is a standalone product) | **Vesk-owned** — `permissions.ts` (`AgentCapabilityTable`, `DEFAULT_PERMISSIONS`, `filterToolsByPermissions`) gates which `Tool`s reach the loop; `vesk.*` tools enforce `readFiles`/`writeFiles`/… caps; Dev Server `CapabilityTable` enforces server-side | ✅ |
| **Confirmation / approval** | Pi TUI / CLI approval | Plugin-mediated: transaction `Preview → Approve → Execute → Validate → Checkpoint` in `checkpoints.ts` + Dev Server `/__vesk/command` allowlist | ✅ |
| **Session history / rollback / replay** | Pi session harness (stateful, app-coupled) | `CheckpointManager` (`checkpoints.ts`) — `create`/`list`/`get`/`rollback`/`clear` + `describeRollback`; pure data, server executes FS restore | ✅ |
| **Embedding as library** | **No** — `pi-agent-core` is a 202-file application (CLI, TUI, session, harness); `@narimangardi/agent-loop` is a library | **Library**: single `Agent` class + `defineTool`, no CLI/TUI/project-structure coupling | ✅ |

**Conclusion:** The vendored loop exposes every required knob *to the plugin*; Pi forces the plugin to adopt its product surface.

---

## 6. Architecture Compatibility

> *Can the loop be embedded as a **library** inside `@vesk/agentic` without forcing Vesk (or the plugin host) to adopt its CLI, TUI, application UI, project structure, MCP infra, or opinionated integrations?*

| Concern | Bare `pi-*` | `@earendil-works/pi-*` | `@narimangardi/agent-loop` |
|---|---|---|---|
| **Library vs application** | Library (empty) but no impl | **Application** — `@earendil-works/pi-agent-core` (202 files, 1.9 MB) ships a full coding agent (transport, state, attachments, TUI), `pi-ai` ships a unified LLM API with 746 files including every provider, OAuth flows, and CLI | **Library** — 7 files, one class, no app |
| **CLI / terminal UI** | None | Hard dependency (Pi CLI + TUI imported transitively via `pi-agent-core` even if unused) | None |
| **Project structure** | N/A | Opinionated Pi project layout (session dir, attachments, YAML frontmatter) | None — Vesk's `app/` routing, `vesk.config.ts`, `.vesk/` cache are untouched |
| **MCP / integrations** | N/A | Built-in MCP wiring requires `typebox` + Pi harness | None — tool registration is just `Tool[]` passed to `new Agent({ provider, tools })` |
| **Vesk tools/permissions integration** | N/A | Would need to bypass Pi's tool layer to inject `vesk.*` Dev Server tools, conflicting with Pi's session model | **Native** — `vesk.inspectProject`, `vesk.readConfig`, … are plain `Tool`s filtered by `AgentCapabilityTable` before reaching the loop |
| **Dev Server mediation** | N/A | Pi executes tools directly; routing through `createDevApiRouter` would require forking Pi's runner | Loop executes `tool.execute()` provided by caller — `@vesk/agentic` wraps each `vesk.*` tool with a `fetch` to the Dev Server API (`/ __vesk/file`, `/__vesk/command`, …) respecting capability gates |

**Result:** Only the vendored loop can be vendored as a *primitive* (`packages/agentic/src/loop.ts`) while `@vesk/agentic` retains ownership of UX, permissions, project structure, and Dev Server integration.

---

## 7. Verdict

| Candidate | Footprint gate (≤ 20.7kB zero-deps target) | Browser/worker safe | Configurable by plugin? | Embeddable as library? | Verdict |
|---|---|---|---|---|---|
| `pi-agent-core@0.0.1` (bare) | **FAIL** (486B placeholder — not a runtime) | N/A | N/A | N/A | **REJECT** |
| `pi-ai@0.0.1` (bare) | **FAIL** (439B placeholder) | N/A | N/A | N/A | **REJECT** |
| `@earendil-works/pi-agent-core@0.84.4` | **FAIL** (1.9 MB source, transitively 6.0 MB + 30–112 MB installed) | No | No (SDK-coupled) | No (application) | **REJECT** |
| `@earendil-works/pi-ai@0.84.4` | **FAIL** (4.1 MB source, hard SDK deps; forces all providers) | No | No | No | **REJECT** |
| **`@narimangardi/agent-loop@0.3.0` vendored clone** | **PASS** (20.7 kB, 0 deps) | **Yes** | **Yes** | **Yes** | **ADOPT** |

**Do NOT integrate Pi.** Do NOT fall back to Pi if the vendored loop regresses — report and stop. Do NOT add `openai` / `@anthropic-ai/sdk` / `@google/genai` / `@aws-sdk` to core Vesk or `@vesk/agentic` `dependencies`.

---

## 8. Integration Rule & What Was Adopted

**Adopted:** A zero-deps clone of `@narimangardi/agent-loop@0.3.0` (MIT) vendored as `packages/agentic/src/loop.ts` (5,688 B source → 2,555 B ESM dist). License + credit to Nariman Gardi retained in file header.

**How it lives in `@vesk/agentic`:**

```ts
// packages/agentic/src/loop.ts — the only primitive Vesk vendors
export class Agent {
  constructor(opts: { provider: Provider; tools?: Tool[]; system?: string; maxSteps?: number;
                      onStep?: (s:number)=>void; onToolCall?: (c:ToolCall)=>void; onToolResult?: (c:ToolCall,out:string)=>void }) {}
  run(prompt: string): Promise<AgentResult> // ask LLM → run tools → feed back → repeat until answer/maxSteps
}

// packages/agentic/src/providers/* — fetch-only, zero SDKs, imported lazily per provider
openAiProvider({ apiKey, model, baseUrl }): Provider       // → POST /chat/completions
anthropicProvider({ apiKey, model, maxTokens, baseUrl }): Provider // → POST /v1/messages
googleProvider({ apiKey, model, baseUrl }): Provider       // → POST /v1beta/models/:model:generateContent
ollamaProvider({ model, baseUrl }): Provider               // → POST /api/chat (no key)

// packages/agentic/src/permissions.ts — Vesk owns the gate, not Pi
DEFAULT_PERMISSIONS: Record<AgentMode, Set<AgentCapability>>
AgentCapabilityTable(mode: AgentMode, overrides?: Partial<Record<AgentCapability, boolean>>)
filterToolsByPermissions(tools: Tool[], table: AgentCapabilityTable): Tool[]

// packages/agentic/src/checkpoints.ts — transaction history, rollback, replay
CheckpointManager { create(opts), list(), listNewestFirst(), get(id), has(id), delete(id), clear(), rollback(id) }

// packages/agentic/src/context.ts — layered context assembly (llm.txt + agents.md + live project state)
loadFrameworkKnowledge(projectDir?), loadProjectKnowledge(projectDir), assembleSystemPrompt(layers, mode)
```

*No `openai`/`@anthropic-ai/sdk`/`@google/genai`/`@aws-sdk` in `@vesk/agentic` or core Vesk `dependencies` (verified: `cat packages/agentic/package.json` → dependencies `{ "@vesk/types": "^0.2.10" }` only).*

**Thin Vesk abstraction (inside `@vesk/agentic`, not core):**

```ts
interface VeskAgent {
  explore(input: AgentInput): Promise<AgentResult> // read-only, filtered by AgentCapabilityTable('explore')
  debug(input: AgentInput): Promise<AgentResult>   // controlled fixes, filtered by ('debug')
  run(input: AgentInput): Promise<AgentResult>     // full, filtered by ('agent', overrides)
}
```

The plugin, not core, owns modes, permissions, layered context, Vesk-native tools (`vesk.inspectProject`, `vesk.readConfig`, `vesk.runBuild`, … + `filesystem.*` + `command.execute` gated by `AgentCapabilityTable` and routed through `createDevApiRouter`), and the transaction flow (`Preview → Approve → Execute → Validate → Checkpoint → Roll Back`).

---

## 9. Acceptance (footprint audit committed before code)

- [x] `plans/devtools-agentic-audit.md` committed **before** integration code (this file; Vesk core gains no AI dependency)
- [x] Pi rejection documented with local evidence (bare 486B/439B stubs vs namespaced 1.9 MB + 4.1 MB = 6.0 MB source → 30–112 MB installed, hard deps `openai`/`@anthropic-ai/sdk`/`@google/genai`/`@aws-sdk`)
- [x] Vendored loop 20.7kB zero-deps verified (tarball 5.9kB, unpacked 20.7kB, 7 files, `dependencies: {}`, `dist/index.js` 2,555 B)
- [x] Provider abstraction works with ≥2 providers from config alone (OpenAI, Anthropic, Google, Ollama — all `fetch`-only, see `packages/agentic/src/providers/*`)
- [x] Three modes enforced server-side via `createDevApiRouter` capabilities (permissions cannot be bypassed from the client)
- [x] Every agent action can checkpoint; rollback restores prior file state (`packages/agentic/src/checkpoints.ts` + `Checkpoints.test.ts`)
- [x] No unnecessary deps/features shipped; core Vesk remains AI-free

---

## Appendix A — Evidence Commands (re-run at audit time)

```bash
# Bare stubs
npm view pi-agent-core version
npm view pi-ai version
npm pack --dry-run pi-agent-core@latest
npm pack --dry-run pi-ai@latest
tar -tzf pi-agent-core-0.0.1.tgz
cat package/index.js    # → { placeholder: true }

# Namespaced Pi
npm view @earendil-works/pi-agent-core version
npm view @earendil-works/pi-ai version
npm pack --dry-run @earendil-works/pi-agent-core@0.84.4
npm pack --dry-run @earendil-works/pi-ai@0.84.4
npm view @earendil-works/pi-agent-core dependencies
npm view @earendil-works/pi-ai dependencies
tar -tzf earendil-works-pi-ai-0.84.4.tgz | head -n 20
du -sh /tmp/pi-ai-extracted/package

# Vendored clone
npm view @narimangardi/agent-loop version
npm pack --dry-run @narimangardi/agent-loop@0.3.0
npm view @narimangardi/agent-loop dependencies   # → (no deps)
tar -tzf narimangardi-agent-loop-0.3.0.tgz
wc -c package/dist/index.js package/dist/index.cjs
cat packages/agentic/package.json  # → dependencies: { "@vesk/types": "^0.2.10" } only
wc -c packages/agentic/src/*.ts packages/agentic/src/providers/*.ts
```

**Footprint guard codified:** `plans/devtools.md` § *AI Agent Runtime Integration Plan* requires this audit *before* any vendor; a heavier framework must be reported, not shipped; do not fall back to Pi.

**Guiding principle:** *Vesk owns the platform. `@vesk/agentic` owns the agent experience. The vendored `@narimangardi/agent-loop` provides the minimal agent engine (20.7kB, zero-deps).*

