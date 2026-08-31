import type { Tool } from './loop.js';

export type AgentMode = 'explore' | 'debug' | 'agent';

export type AgentCapability =
  | 'readFiles'
  | 'writeFiles'
  | 'deleteFiles'
  | 'executeCommands'
  | 'installPackages'
  | 'modifyConfig'
  | 'managePlugins'
  | 'runBuild'
  | 'runTests'
  | 'modifyAgentsMd'
  | 'createCheckpoint'
  | 'rollback';

const EXPLORE_CAPS: Set<AgentCapability> = new Set(['readFiles']);
const DEBUG_CAPS: Set<AgentCapability> = new Set(['readFiles', 'writeFiles', 'runBuild', 'runTests', 'createCheckpoint']);
const AGENT_CAPS: Set<AgentCapability> = new Set([
  'readFiles',
  'writeFiles',
  'deleteFiles',
  'executeCommands',
  'installPackages',
  'modifyConfig',
  'managePlugins',
  'runBuild',
  'runTests',
  'modifyAgentsMd',
  'createCheckpoint',
  'rollback',
]);

export const DEFAULT_PERMISSIONS: Record<AgentMode, Set<AgentCapability>> = {
  explore: EXPLORE_CAPS,
  debug: DEBUG_CAPS,
  agent: AGENT_CAPS,
};

// Tool -> capability map (server-enforced)
const TOOL_CAP: Record<string, AgentCapability> = {
  'vesk.inspectProject': 'readFiles',
  'vesk.inspectComponent': 'readFiles',
  'vesk.readConfig': 'readFiles',
  'vesk.updateConfig': 'modifyConfig',
  'vesk.getDiagnostics': 'readFiles',
  'vesk.getCompilerErrors': 'readFiles',
  'vesk.runBuild': 'runBuild',
  'vesk.runTests': 'runTests',
  'vesk.installPlugin': 'installPackages',
  'vesk.uninstallPlugin': 'installPackages',
  'vesk.enablePlugin': 'managePlugins',
  'vesk.disablePlugin': 'managePlugins',
  'vesk.createCheckpoint': 'createCheckpoint',
  'vesk.rollback': 'rollback',
  'filesystem.read': 'readFiles',
  'filesystem.write': 'writeFiles',
  'filesystem.delete': 'deleteFiles',
  'command.execute': 'executeCommands',
};

export class AgentCapabilityTable {
  readonly mode: AgentMode;
  private caps: Set<AgentCapability>;

  constructor(mode: AgentMode, overrides?: Partial<Record<AgentCapability, boolean>>) {
    this.mode = mode;
    const base = new Set(DEFAULT_PERMISSIONS[mode]);
    if (overrides) {
      for (const [k, v] of Object.entries(overrides) as [AgentCapability, boolean][]) {
        if (v) base.add(k);
        else base.delete(k);
      }
    }
    this.caps = base;
  }

  allows(cap: AgentCapability): boolean {
    return this.caps.has(cap);
  }

  isToolAllowed(toolName: string): boolean {
    const needed = TOOL_CAP[toolName];
    if (!needed) return true; // unknown tools — allow, but caller should validate
    return this.allows(needed);
  }
}

export function filterToolsByPermissions(tools: Tool[], table: AgentCapabilityTable): Tool[] {
  return tools.filter((t) => table.isToolAllowed(t.name));
}

export function isToolAllowed(toolName: string, table: AgentCapabilityTable): boolean {
  return table.isToolAllowed(toolName);
}
