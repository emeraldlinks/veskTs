# @vesk/agentic

Agentic AI plugin for Vesk — zero-deps agent loop, provider abstraction, permissions, tools, checkpoints. Vendored clone of `@narimangardi/agent-loop` (20.7kB, zero deps) — core Vesk ships no agent runtime.

## Install

```sh
npm install @vesk/agentic
```

## Usage — add to `vesk.config.ts`

```ts
// vesk.config.ts
import { defineConfig } from '@vesk/compiler';
import agentic from '@vesk/agentic/src/plugin.js';

export default defineConfig({
  plugins: [
    agentic({
      provider: 'openai',          // 'openai' | 'openai-compatible' | 'anthropic' | 'google' | 'ollama'
      model: 'gpt-4o-mini',
      // apiKey: process.env.VESK_AGENTIC_API_KEY,
      mode: 'explore',             // 'explore' | 'debug' | 'agent'
      maxSteps: 10,
    }),
  ],
});
```

- `provider`/`model`/`apiKey`/`baseUrl` are provider-agnostic — switching models never touches the agent implementation.
- `mode` selects the default permission set (`explore`=read-only, `debug`=controlled fixes, `agent`=per-capability toggles). All checks are server-enforced via the Dev Server capability gate.
- When the plugin is inactive (toggled off in the devtool or not listed), it is fully excluded from the build — zero bundle/build cost.

## DevTools AI panel

When `@vesk/agentic` is installed & active, `vesk dev` exposes the **AI** panel in the devtools overlay:

- Provider / model / key config (shown only when the plugin is active)
- Mode + granular permissions (`readFiles`, `writeFiles`, `deleteFiles`, `executeCommands`, `installPackages`, `modifyConfig`, `managePlugins`, `runBuild`, `runTests`, `modifyAgentsMd`, `createCheckpoint`, `rollback`)
- Layered context (framework knowledge + project `agents.md` + live project state via Dev Server)
- Vesk-native tools (`vesk.inspectProject`, `vesk.readConfig`, `vesk.runBuild`, `vesk.createCheckpoint`, etc.) gated by permissions
- Checkpoints / history / rollback — every agent action checkpoints; rollback restores prior file state

Inactive ⇒ the AI panel is hidden and no agent code is bundled.

## Zero dependencies

No runtime deps on `openai`, `@anthropic-ai/sdk`, `@google/genai`, or `@aws-sdk`. Each provider is a fetch-only adapter; bring your own key.

## License

MIT
