/**
 * @vesk/agentic — Vesk agentic plugin
 *
 * Zero-deps agent loop, provider abstraction, permissions, tools, checkpoints.
 * Installable plugin — core Vesk ships with zero AI deps.
 * @module agentic
 */

export { default } from './plugin.js';
export { default as agenticPlugin } from './plugin.js';
export type { AgenticOptions } from './plugin.js';

// Core loop (vendored @narimangardi/agent-loop)
export { Agent, MaxStepsExceededError, defineTool } from './loop.js';
export type { AgentOptions, AgentResult, Provider, Tool, ToolCall, CompletionRequest, CompletionResponse } from './loop.js';

// Providers (fetch-only, zero SDKs)
export { openAiProvider } from './providers/openai.js';
export { anthropicProvider } from './providers/anthropic.js';
export { googleProvider } from './providers/google.js';
export { ollamaProvider } from './providers/ollama.js';
export type { ProviderConfig, ProviderName } from './providers/types.js';

// Permissions
export { AgentCapabilityTable, DEFAULT_PERMISSIONS, filterToolsByPermissions, isToolAllowed } from './permissions.js';
export type { AgentMode, AgentCapability } from './permissions.js';

// Context & checkpoints
export { loadFrameworkKnowledge, loadProjectKnowledge, assembleSystemPrompt } from './context.js';
export { CheckpointManager } from './checkpoints.js';
export type { Checkpoint } from './checkpoints.js';

// Dev API
export { createAgentRouter } from './dev-api.js';
export type { AgentRouter, AgentRouterOptions } from './dev-api.js';
