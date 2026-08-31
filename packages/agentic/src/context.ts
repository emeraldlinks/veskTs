import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentMode } from './permissions.js';

export interface LiveProjectContext {
  files?: Array<{ path: string; content: string }>;
  config?: unknown;
  diagnostics?: unknown[];
  plugins?: unknown;
  git?: unknown;
  compilerState?: unknown;
}

export interface AgentContextLayers {
  framework: string;
  projectMd: string;
  live: LiveProjectContext;
}

export function loadFrameworkKnowledge(projectDir?: string): string {
  // Prefer llm.txt at project root or repo root, fallback to minimal built-in knowledge.
  const candidates = [
    projectDir ? resolve(projectDir, 'llm.txt') : null,
    resolve(process.cwd(), 'llm.txt'),
    resolve(process.cwd(), 'plans', 'devtools.md'),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try { if (existsSync(p)) return readFileSync(p, 'utf-8').slice(0, 8000); } catch {}
  }
  return [
    'Vesk is a compiler-first framework. Components use `component Name { ... }` with expression or statement mode.',
    'Reactivity: const &[count]=track(0), effect(), derived, islands via #client.',
    'Routing: app/ file-based, useFetch/stream, Md for markdown.',
    'Config: vesk.config.ts, plugins via @vesk/plugin-*, dev server is capability-gated.',
  ].join('\n');
}

export function loadProjectKnowledge(projectDir: string): string {
  const p = resolve(projectDir, 'agents.md');
  try { if (existsSync(p)) return readFileSync(p, 'utf-8').slice(0, 8000); } catch {}
  // Also try AGENTS.md
  const p2 = resolve(projectDir, 'AGENTS.md');
  try { if (existsSync(p2)) return readFileSync(p2, 'utf-8').slice(0, 8000); } catch {}
  return '';
}

export function assembleSystemPrompt(layers: AgentContextLayers, mode: AgentMode): string {
  const parts: string[] = [];
  parts.push('# Vesk Framework Knowledge');
  parts.push(layers.framework || '(no framework docs)');
  parts.push('\n# Project Knowledge (agents.md)');
  parts.push(layers.projectMd || '(no project agents.md)');
  if (layers.live) {
    parts.push('\n# Live Project Context');
    if (layers.live.config) parts.push(`Config: ${JSON.stringify(layers.live.config).slice(0, 2000)}`);
    if (layers.live.diagnostics) parts.push(`Diagnostics: ${JSON.stringify(layers.live.diagnostics).slice(0, 2000)}`);
    if (layers.live.plugins) parts.push(`Plugins: ${JSON.stringify(layers.live.plugins).slice(0, 2000)}`);
  }
  parts.push(`\n# Mode: ${mode}`);
  if (mode === 'explore') parts.push('You are in Explore (read-only). Do NOT modify files, run commands, or install packages. Explain and analyze only.');
  if (mode === 'debug') parts.push('You are in Debug. You may read and make controlled fixes to relevant source files and run build/tests, but respect permissions.');
  if (mode === 'agent') parts.push('You are in Agent. You may act fully within granted capabilities. Always respect the capability table; blocked tools will return errors.');
  parts.push('\nAlways use Vesk-native tools (vesk.*) when they apply; prefer them over raw filesystem writes.');
  return parts.join('\n');
}
