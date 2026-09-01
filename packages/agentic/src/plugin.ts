/**
 * @vesk/agentic — Agentic AI plugin for Vesk.
 *
 * Zero-deps agent loop, provider abstraction, permissions, tools, checkpoints.
 * Installable & toggleable: inactive ⇒ zero bundle/build cost. All AI
 * machinery (provider/model/key, modes, permissions, context, tools,
 * checkpoints) is owned by this plugin — core Vesk ships no agent runtime.
 *
 * @module agentic/plugin
 */

export interface AgenticOptions {
  /** LLM provider. Default 'openai'. */
  provider?: 'openai' | 'anthropic' | 'google' | 'ollama';
  /** Model name (e.g. gpt-4o-mini, claude-sonnet-4-6, gemini-2.0-flash, llama3.1). */
  model?: string;
  /** API key. Prefer env var VESK_AGENTIC_API_KEY — never commit to git. */
  apiKey?: string;
  /** Custom base URL for OpenAI-compatible providers or self-hosted Ollama. */
  baseUrl?: string;
  /** Max tokens for completion. */
  maxTokens?: number;
  /** Default agent mode (capability-gated via Dev Server). Default 'explore'. */
  mode?: 'explore' | 'debug' | 'agent';
  /** Max agent loop steps. Default 10. */
  maxSteps?: number;
}

// Type alias (not interface) so the object literal is assignable to
// VeskPlugin's `[k: string]: unknown` index signature in user configs.
type AgenticPlugin = {
  name: string;
  dependencies: Set<string>;
  onBuildStart: () => Promise<void>;
  onBuildEnd: () => Promise<void>;
  onFileWatch: (filePath: string) => Promise<{ handled: boolean }>;
};

export default function agenticPlugin(options: AgenticOptions = {}): AgenticPlugin {
  void options;
  return {
    name: '@vesk/agentic',
    dependencies: new Set<string>(),

    async onBuildStart(): Promise<void> {
      // No build-time transform: the agentic plugin is dev-server gated.
      // Capabilities (agent, checkpoints) are served via the Dev Server API
      // and rendered in the devtools AI panel when installed & active.
    },

    async onBuildEnd(): Promise<void> {
      // No-op: ensures validateConfig sees a recognized hook.
    },

    async onFileWatch(_filePath: string): Promise<{ handled: boolean }> {
      return { handled: false };
    },
  };
}
