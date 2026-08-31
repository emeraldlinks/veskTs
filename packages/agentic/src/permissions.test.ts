/**
 * @vesk/agentic — permissions.test.ts
 *
 * Zero-deps, no vitest. Runnable via: npx tsx packages/agentic/src/permissions.test.ts
 * Throws on failure. Validates mode/capability matrix and tool gating.
 */
import { AgentCapabilityTable, DEFAULT_PERMISSIONS, filterToolsByPermissions, isToolAllowed } from './permissions.js';
import type { AgentCapability } from './permissions.js';
import type { Tool } from './loop.js';

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.log(`  ✗ ${msg}`);
  }
}

console.log('\n═══ @vesk/agentic — Permissions tests ═══\n');

// Helpers
function toolNames(tools: Tool[]): string[] {
  return tools.map((t) => t.name);
}

function fakeTool(name: string): Tool {
  return { name, description: name, parameters: {}, execute: async () => 'ok' };
}

// ── DEFAULT_PERMISSIONS sets ─────────────────────────────────────────────────
{
  const explore = DEFAULT_PERMISSIONS.explore;
  assert(explore.has('readFiles'), 'explore includes readFiles');
  assert(!explore.has('writeFiles'), 'explore excludes writeFiles');
  assert(!explore.has('deleteFiles'), 'explore excludes deleteFiles');
  assert(!explore.has('executeCommands'), 'explore excludes executeCommands');
  assert(!explore.has('installPackages'), 'explore excludes installPackages');
  assert(explore.size === 1, 'explore has exactly 1 capability');

  const debug = DEFAULT_PERMISSIONS.debug;
  assert(debug.has('readFiles'), 'debug includes readFiles');
  assert(debug.has('writeFiles'), 'debug includes writeFiles');
  assert(debug.has('runBuild'), 'debug includes runBuild');
  assert(debug.has('runTests'), 'debug includes runTests');
  assert(debug.has('createCheckpoint'), 'debug includes createCheckpoint');
  assert(!debug.has('deleteFiles'), 'debug excludes deleteFiles');
  assert(!debug.has('executeCommands'), 'debug excludes executeCommands');
  assert(!debug.has('installPackages'), 'debug excludes installPackages');
  assert(!debug.has('rollback'), 'debug excludes rollback');

  const agent = DEFAULT_PERMISSIONS.agent;
  const all: AgentCapability[] = [
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
  ];
  for (const cap of all) assert(agent.has(cap), `agent includes ${cap}`);
  assert(agent.size === all.length, 'agent has all capabilities');
}

// ── AgentCapabilityTable mode isolation ─────────────────────────────────────
{
  const t = new AgentCapabilityTable('explore');
  assert(t.allows('readFiles'), 'explore table allows readFiles');
  assert(!t.allows('writeFiles'), 'explore table blocks writeFiles');
  assert(!t.allows('executeCommands'), 'explore table blocks executeCommands');
  assert(t.mode === 'explore', 'table exposes mode');
}

{
  const t = new AgentCapabilityTable('debug');
  assert(t.allows('readFiles'), 'debug allows readFiles');
  assert(t.allows('writeFiles'), 'debug allows writeFiles');
  assert(t.allows('runBuild'), 'debug allows runBuild');
  assert(t.allows('runTests'), 'debug allows runTests');
  assert(t.allows('createCheckpoint'), 'debug allows createCheckpoint');
  assert(!t.allows('deleteFiles'), 'debug blocks deleteFiles');
  assert(!t.allows('executeCommands'), 'debug blocks executeCommands');
  assert(!t.allows('installPackages'), 'debug blocks installPackages');
  assert(!t.allows('modifyConfig'), 'debug blocks modifyConfig');
  assert(!t.allows('rollback'), 'debug blocks rollback');
}

{
  const t = new AgentCapabilityTable('agent');
  assert(t.allows('deleteFiles'), 'agent allows deleteFiles');
  assert(t.allows('executeCommands'), 'agent allows executeCommands');
  assert(t.allows('modifyAgentsMd'), 'agent allows modifyAgentsMd');
  assert(t.allows('rollback'), 'agent allows rollback');
}

// ── Overrides ───────────────────────────────────────────────────────────────
{
  const t = new AgentCapabilityTable('explore', { writeFiles: true, executeCommands: true });
  assert(t.allows('writeFiles'), 'override grants writeFiles to explore');
  assert(t.allows('executeCommands'), 'override grants executeCommands to explore');
  assert(t.allows('readFiles'), 'override keeps base caps');
}

{
  const t = new AgentCapabilityTable('agent', { rollback: false, modifyAgentsMd: false });
  assert(!t.allows('rollback'), 'override revokes rollback from agent');
  assert(!t.allows('modifyAgentsMd'), 'override revokes modifyAgentsMd from agent');
  assert(t.allows('readFiles'), 'override keeps other caps');
}

{
  const t = new AgentCapabilityTable('debug', { deleteFiles: true, installPackages: true });
  assert(t.allows('deleteFiles'), 'debug override grants deleteFiles');
  assert(t.allows('installPackages'), 'debug override grants installPackages');
  assert(!t.allows('executeCommands'), 'debug override does not grant unrelated cap');
}

// ── Tool → capability mapping ──────────────────────────────────────────────
{
  const explore = new AgentCapabilityTable('explore');
  assert(explore.isToolAllowed('vesk.inspectProject'), 'explore allows inspectProject (readFiles)');
  assert(explore.isToolAllowed('vesk.readConfig'), 'explore allows readConfig');
  assert(explore.isToolAllowed('vesk.getDiagnostics'), 'explore allows getDiagnostics');
  assert(explore.isToolAllowed('vesk.getCompilerErrors'), 'explore allows getCompilerErrors');
  assert(explore.isToolAllowed('filesystem.read'), 'explore allows filesystem.read');
  assert(!explore.isToolAllowed('filesystem.write'), 'explore blocks filesystem.write');
  assert(!explore.isToolAllowed('filesystem.delete'), 'explore blocks filesystem.delete');
  assert(!explore.isToolAllowed('vesk.updateConfig'), 'explore blocks updateConfig (modifyConfig)');
  assert(!explore.isToolAllowed('command.execute'), 'explore blocks command.execute');
  assert(!explore.isToolAllowed('vesk.runBuild'), 'explore blocks runBuild');
  assert(!explore.isToolAllowed('vesk.createCheckpoint'), 'explore blocks createCheckpoint');
  assert(!explore.isToolAllowed('vesk.rollback'), 'explore blocks rollback');
}

{
  const debug = new AgentCapabilityTable('debug');
  assert(debug.isToolAllowed('filesystem.read'), 'debug allows filesystem.read');
  assert(debug.isToolAllowed('filesystem.write'), 'debug allows filesystem.write');
  assert(debug.isToolAllowed('vesk.runBuild'), 'debug allows runBuild');
  assert(debug.isToolAllowed('vesk.runTests'), 'debug allows runTests');
  assert(debug.isToolAllowed('vesk.createCheckpoint'), 'debug allows createCheckpoint');
  assert(!debug.isToolAllowed('filesystem.delete'), 'debug blocks filesystem.delete');
  assert(!debug.isToolAllowed('command.execute'), 'debug blocks command.execute');
  assert(!debug.isToolAllowed('vesk.installPlugin'), 'debug blocks installPlugin');
  assert(!debug.isToolAllowed('vesk.rollback'), 'debug blocks rollback');
  assert(!debug.isToolAllowed('vesk.updateConfig'), 'debug blocks updateConfig');
}

{
  const agent = new AgentCapabilityTable('agent');
  const allTools = [
    'vesk.inspectProject',
    'vesk.inspectComponent',
    'vesk.readConfig',
    'vesk.updateConfig',
    'vesk.getDiagnostics',
    'vesk.getCompilerErrors',
    'vesk.runBuild',
    'vesk.runTests',
    'vesk.installPlugin',
    'vesk.uninstallPlugin',
    'vesk.enablePlugin',
    'vesk.disablePlugin',
    'vesk.createCheckpoint',
    'vesk.rollback',
    'filesystem.read',
    'filesystem.write',
    'filesystem.delete',
    'command.execute',
  ];
  for (const name of allTools) assert(agent.isToolAllowed(name), `agent allows ${name}`);
}

// Unknown tools are allowed (caller validates separately)
{
  const t = new AgentCapabilityTable('explore');
  assert(t.isToolAllowed('unknown.tool'), 'unknown tool allowed in explore');
  assert(t.isToolAllowed('myCustomTool'), 'custom tool allowed');
}

// agents.md protection
{
  const explore = new AgentCapabilityTable('explore');
  // modifyAgentsMd maps to no built-in tool currently, but direct capability check:
  assert(!explore.allows('modifyAgentsMd'), 'explore cannot modifyAgentsMd');
  const debug = new AgentCapabilityTable('debug');
  assert(!debug.allows('modifyAgentsMd'), 'debug cannot modifyAgentsMd');
  const agent = new AgentCapabilityTable('agent');
  assert(agent.allows('modifyAgentsMd'), 'agent can modifyAgentsMd');
  const agentRevoked = new AgentCapabilityTable('agent', { modifyAgentsMd: false });
  assert(!agentRevoked.allows('modifyAgentsMd'), 'revoked agent cannot modifyAgentsMd');
}

// ── isToolAllowed helper ────────────────────────────────────────────────────
{
  const t = new AgentCapabilityTable('explore');
  assert(isToolAllowed('vesk.readConfig', t) === true, 'helper delegates to table');
  assert(isToolAllowed('command.execute', t) === false, 'helper respects blocks');
}

// ── filterToolsByPermissions ────────────────────────────────────────────────
{
  const tools: Tool[] = [
    fakeTool('filesystem.read'),
    fakeTool('filesystem.write'),
    fakeTool('filesystem.delete'),
    fakeTool('command.execute'),
    fakeTool('vesk.readConfig'),
    fakeTool('vesk.updateConfig'),
    fakeTool('vesk.runBuild'),
    fakeTool('unknown.tool'),
  ];

  const explore = new AgentCapabilityTable('explore');
  const exploreFiltered = filterToolsByPermissions(tools, explore);
  const en = toolNames(exploreFiltered);
  assert(en.includes('filesystem.read'), 'explore filter keeps read');
  assert(en.includes('vesk.readConfig'), 'explore filter keeps readConfig');
  assert(en.includes('unknown.tool'), 'explore filter keeps unknown tool');
  assert(!en.includes('filesystem.write'), 'explore filter drops write');
  assert(!en.includes('filesystem.delete'), 'explore filter drops delete');
  assert(!en.includes('command.execute'), 'explore filter drops command');
  assert(!en.includes('vesk.updateConfig'), 'explore filter drops updateConfig');
  assert(!en.includes('vesk.runBuild'), 'explore filter drops runBuild');

  const agent = new AgentCapabilityTable('agent');
  const agentFiltered = filterToolsByPermissions(tools, agent);
  assert(agentFiltered.length === tools.length, 'agent filter keeps all tools');

  const debug = new AgentCapabilityTable('debug');
  const debugFiltered = filterToolsByPermissions(tools, debug);
  const dn = toolNames(debugFiltered);
  assert(dn.includes('filesystem.write'), 'debug filter keeps write');
  assert(dn.includes('vesk.runBuild'), 'debug filter keeps runBuild');
  assert(!dn.includes('filesystem.delete'), 'debug filter drops delete');
  assert(!dn.includes('command.execute'), 'debug filter drops command');
}

// ── Granular permission matrix per spec (readFiles/writeFiles/deleteFiles/etc) ──
{
  // Verify the exact per-capability spec mapping implied by devtools.md
  // readFiles → readTools, writeFiles → filesystem.write, etc.
  const readTools = ['vesk.inspectProject', 'vesk.inspectComponent', 'vesk.readConfig', 'vesk.getDiagnostics', 'vesk.getCompilerErrors', 'filesystem.read'];
  const explore = new AgentCapabilityTable('explore');
  for (const n of readTools) assert(explore.isToolAllowed(n), `explore allows ${n} via readFiles`);

  // command.execute requires executeCommands only
  assert(!new AgentCapabilityTable('explore').isToolAllowed('command.execute'), 'command.execute blocked without executeCommands');
  assert(new AgentCapabilityTable('agent').isToolAllowed('command.execute'), 'command.execute allowed with executeCommands');
  assert(new AgentCapabilityTable('explore', { executeCommands: true }).isToolAllowed('command.execute'), 'command.execute allowed when executeCommands overridden');
}

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
if (failed > 0) throw new Error(`${failed} tests failed`);
