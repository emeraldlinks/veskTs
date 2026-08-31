/**
 * @vesk/agentic — command tool
 *
 * Zero-deps. Single tool `command.execute` that is allowlist-checked before
 * delegating to the injected `runCommand` runner. Every `execute` returns a
 * JSON string and never throws.
 */

import type { Tool } from '../loop.js';

export function createCommandTools(
  allowlist: RegExp[],
  runCommand: (argv: string[]) => Promise<{ stdout: string; stderr: string; code: number }>,
): Tool[] {
  const tool: Tool = {
    name: 'command.execute',
    description: 'Execute a shell command via the allowlisted runner. The command is checked against the allowlist before execution.',
    parameters: {
      type: 'object',
      properties: {
        argv: {
          type: 'array',
          description: 'Command and arguments as an array (e.g. ["npm","run","build"])',
          items: { type: 'string' },
        },
      },
      required: ['argv'],
      additionalProperties: false,
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const raw = (args as { argv?: unknown }).argv;
      if (!Array.isArray(raw) || raw.length === 0) {
        return JSON.stringify({ ok: false, error: 'missing required "argv" parameter (expected non-empty string[])' });
      }
      const argv = raw.filter((v): v is string => typeof v === 'string');
      if (argv.length !== raw.length) {
        return JSON.stringify({ ok: false, error: '"argv" must be an array of strings' });
      }
      if (argv.length === 0) {
        return JSON.stringify({ ok: false, error: 'missing required "argv" parameter (expected non-empty string[])' });
      }

      // Allowlist check — join with space to match the dev-api convention.
      const joined = argv.join(' ');
      const allowed = allowlist.some((re) => re.test(joined));
      if (!allowed) {
        return JSON.stringify({ ok: false, error: 'command not in allowlist', argv });
      }

      try {
        const result = await runCommand(argv);
        const stdout = typeof result.stdout === 'string' ? result.stdout : String(result.stdout ?? '');
        const stderr = typeof result.stderr === 'string' ? result.stderr : String(result.stderr ?? '');
        const code = typeof result.code === 'number' ? result.code : Number(result.code) || 0;
        return JSON.stringify({ ok: true, argv, stdout, stderr, code });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e), argv });
      }
    },
  };

  return [tool];
}
