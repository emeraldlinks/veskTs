#!/usr/bin/env node
/**
 * Vesk skill installer — agent-agnostic.
 *
 * Installs the `vesk` skill (skills/vesk/SKILL.md) into every major AI
 * coding tool's native skill-discovery location. One source file, many
 * agents. Zero dependencies, ESM-only (NetworkNode >= 20).
 *
 * Usage:
 *   node skills/install.js                # provision all detected platforms
 *   node skills/install.js <platform>     # provision one platform
 *   node skills/install.js --list         # show target paths
 *   node skills/install.js --all          # provision every platform (even absent)
 *
 * Platforms & their native discovery mechanisms (grounded in the Agent
 * Skills spec — https://agentskills.io):
 *   opencode       ~/.config/opencode/skills/<name>/SKILL.md          (global)
 *   claude-code    ~/.claude/skills/<name>/SKILL.md                   (global)
 *   copilot        ~/.copilot/skills/<name>/SKILL.md                  (global)
 *   codex          ~/.codex/skills/<name>/SKILL.md                    (global)
 *   antigravity    ~/.gemini/antigravity/skills/<name>/SKILL.md       (global; Gemini)
 *   cursor         .cursor/skills/<name>/SKILL.md                     (project)
 *   windsurf       .windsurf/skills/<name>/SKILL.md                   (project)
 *
 * Project-scoped tools are written into the current working directory so
 * the skill ships with the repo. Global-scoped tools use `$HOME`.
 */
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'vesk';
const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_SRC = join(HERE, NAME, 'SKILL.md');
const CWD = process.cwd();

/**
 * Each entry: how to locate the target directory (global vs project) and
 * where inside it the skill folder goes.
 */
const PLATFORMS = [
	{
		name: 'opencode',
		scope: 'global',
		dir: () => join(homedir(), '.config', 'opencode', 'skills'),
	},
	{
		name: 'claude-code',
		scope: 'global',
		dir: () => join(homedir(), '.claude', 'skills'),
	},
	{
		name: 'copilot',
		scope: 'global',
		dir: () => join(homedir(), '.copilot', 'skills'),
	},
	{
		name: 'codex',
		scope: 'global',
		dir: () => join(homedir(), '.codex', 'skills'),
	},
	{
		name: 'antigravity',
		scope: 'global',
		dir: () => join(homedir(), '.gemini', 'antigravity', 'skills'),
	},
	{
		name: 'cursor',
		scope: 'project',
		dir: () => join(CWD, '.cursor', 'skills'),
	},
	{
		name: 'windsurf',
		scope: 'project',
		dir: () => join(CWD, '.windsurf', 'skills'),
	},
];

function detectInstalled(platform) {
	try {
		return existsSync(platform.dir());
	} catch {
		return false;
	}
}

function install(platform, { force = false } = {}) {
	const targetDir = platform.dir();
	const skillDir = join(targetDir, NAME);
	if (!force && existsSync(skillDir)) {
		console.log(`  ${platform.name}: already installed at ${skillDir} (skip; --force to reinstall)`);
		return false;
	}
	mkdirSync(skillDir, { recursive: true });
	copyFileSync(SKILL_SRC, join(skillDir, 'SKILL.md'));
	console.log(`  ${platform.name} (${platform.scope}): ${join(skillDir, 'SKILL.md')}`);
	return true;
}

function main() {
	const args = process.argv.slice(2);
	const force = args.includes('--force');
	const list = args.includes('--list');
	const all = args.includes('--all');

	if (list) {
		console.log('Vesk skill targets:\n');
		for (const p of PLATFORMS) {
			const installed = detectInstalled(p);
			console.log(`  ${p.name.padEnd(12)} ${installed ? 'dir present' : 'dir absent '} -> ${p.dir()}`);
		}
		console.log(`\nSkill source: ${SKILL_SRC}`);
		return;
	}

	if (!existsSync(SKILL_SRC)) {
		console.error(`Skill not found at ${SKILL_SRC}. Run from the repo root.`);
		process.exit(1);
	}

	const targets = args.filter((a) => !a.startsWith('--'));
	let selected;
	if (targets.length === 1) {
		selected = PLATFORMS.filter((p) => p.name === targets[0]);
		if (selected.length === 0) {
			console.error(`Unknown platform "${targets[0]}". Valid: ${PLATFORMS.map((p) => p.name).join(', ')}`);
			process.exit(1);
		}
	} else if (targets.length > 1) {
		console.error('Pass at most one platform name (or none to auto-detect).');
		process.exit(1);
	} else {
		selected = all ? PLATFORMS : PLATFORMS.filter((p) => detectInstalled(p));
	}

	console.log(`Installing "${NAME}" skill:\n`);
	let count = 0;
	for (const p of selected) {
		if (install(p, { force })) count++;
	}

	console.log(`\n${count} platform(s) provisioned.`);
	console.log('Restart your AI tool so it re-scans skills at startup.');
	if (selected.length === 0) {
		console.log('\nNo platforms detected. Install to every tool with: node skills/install.js --all');
	}
}

main();
