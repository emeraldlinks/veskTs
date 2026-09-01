/**
 * Slash command parser for devtool agentic tab.
 * Pure string ops, no regex.
 */

export type SlashCmd =
  | 'provider'
  | 'model'
  | 'models'
  | 'tools'
  | 'commands'
  | 'tool'
  | 'mode'
  | 'clear'
  | 'help'
  | 'history'
  | 'rollback'
  | 'config'
  | 'checkpoint';

export const SLASH_COMMANDS: Array<{ name: string; description: string; usage: string }> = [
  { name: '/provider', description: 'switch provider', usage: '/provider <openai|anthropic|google|ollama>' },
  { name: '/model', description: 'switch or list models', usage: '/model [name]  (no arg = list)' },
  { name: '/models', description: 'list models for current provider', usage: '/models' },
  { name: '/tools', description: 'list available tools', usage: '/tools' },
  { name: '/tool', description: 'show tool details', usage: '/tool <name>' },
  { name: '/commands', description: 'list slash commands', usage: '/commands' },
  { name: '/mode', description: 'switch mode', usage: '/mode <explore|debug|agent>' },
  { name: '/clear', description: 'clear chat', usage: '/clear' },
  { name: '/help', description: 'show help', usage: '/help' },
  { name: '/history', description: 'show checkpoints', usage: '/history' },
  { name: '/rollback', description: 'rollback to checkpoint', usage: '/rollback <id>' },
  { name: '/checkpoint', description: 'create checkpoint', usage: '/checkpoint [message]' },
  { name: '/config', description: 'show agentic config', usage: '/config' },
];

export function parseSlash(input: string): { cmd: SlashCmd; args: string[]; raw: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const spaceIdx = trimmed.indexOf(' ');
  let cmdStr: string;
  let rest: string;
  if (spaceIdx === -1) { cmdStr = trimmed.slice(1); rest = ''; }
  else { cmdStr = trimmed.slice(1, spaceIdx); rest = trimmed.slice(spaceIdx + 1).trim(); }
  const cmd = cmdStr.toLowerCase() as SlashCmd;
  const known: string[] = SLASH_COMMANDS.map(c => c.name.slice(1));
  if (!known.includes(cmd)) return { cmd: cmd as SlashCmd, args: [], raw: trimmed };
  const args: string[] = [];
  if (rest) {
    let cur = '';
    let inQuote = false;
    let quoteChar = '';
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (!inQuote && (ch === '"' || ch === "'")) { inQuote = true; quoteChar = ch; continue; }
      if (inQuote && ch === quoteChar) { inQuote = false; continue; }
      if (!inQuote && ch === ' ') { if (cur) { args.push(cur); cur = ''; } continue; }
      cur += ch;
    }
    if (cur) args.push(cur);
  }
  return { cmd, args, raw: trimmed };
}

export function helpText(): string {
  let out = 'Available slash commands:\n';
  for (const c of SLASH_COMMANDS) out += `${c.name.padEnd(14)} ${c.description}  (${c.usage})\n`;
  return out;
}

export function isSlash(input: string): boolean {
  return input.trim().startsWith('/');
}
