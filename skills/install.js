#!/usr/bin/env node
/**
 * Vesk skill installer — agent-agnostic.
 *
 * One source file, every major AI coding tool's native skill-discovery
 * location. Installs the `vesk`, `react-to-vesk`, and `nuxt-to-vesk` skills
 * (skills/<name>/SKILL.md) so every agent loads the *current* authoritative
 * copy (including Recipe G's VeskRequest/VeskResponse API conversions).
 * Zero dependencies, ESM-only (Node >= 20, no `node:` imports needed).
 *
 * Usage:
 *   node skills/install.js                # provision all detected platforms
 *   node skills/install.js <platform>     # provision one platform
 *   node skills/install.js --list         # show target paths
 *   node skills/install.js --all          # provision every platform (even absent)
 *   node skills/install.js --force        # re-copy even if already present
 *
 * Platforms & their native skill-discovery mechanisms (grounded in the
 * Agent Skills spec — https://agentskills.io):
 *   opencode       ~/.config/opencode/skills/<name>/SKILL.md          (global)
 *   claude-code    ~/.claude/skills/<name>/SKILL.md                   (global)
 *   copilot        ~/.copilot/skills/<name>/SKILL.md                  (global)
 *   codex          ~/.codex/skills/<name>/SKILL.md                    (global)
 *   antigravity    ~/.gemini/antigravity/skills/<name>/SKILL.md       (global; Gemini)
 *   cursor         .cursor/skills/<name>/SKILL.md                     (project)
 *   windsurf       .windsurf/skills/<name>/SKILL.md                   (project)
 *   pi             ~/.pi/skills/<name>/SKILL.md                       (global)
 *   kilocode       ~/.kilo/skills/<name>/SKILL.md                     (global)
 *
 * Project-scoped skills are written into the current working directory so
 * the skill ships with the repo. Global-scoped skills use `$HOME`.
 */
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = [
	{ name: 'vesk', src: 'skills/vesk/SKILL.md' },
	{ name: 'react-to-vesk', src: 'skills/react-to-vesk/SKILL.md' },
	{ name: 'nuxt-to-vesk', src: 'skills/nuxt-to-vesk/SKILL.md' },
];
const HERE = dirname(fileURLToPath(import.meta.url));
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
	{
		name: 'pi',
		scope: 'global',
		dir: () => join(homedir(), '.pi', 'skills'),
	},
	{
		name: 'kilocode',
		scope: 'global',
		dir: () => join(homedir(), '.kilo', 'skills'),
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
	let installedAny = false;
	for (const skill of SKILLS) {
		const skillDir = join(platform.dir(), skill.name);
		if (!force && existsSync(skillDir)) {
			console.log(`  ${platform.name}: ${skill.name} already installed at ${skillDir} (skip; --force to reinstall)`);
			continue;
		}
		mkdirSync(skillDir, { recursive: true });
		copyFileSync(skill.src, join(skillDir, 'SKILL.md'));
		console.log(`  ${platform.name} (${platform.scope}): ${join(skillDir, 'SKILL.md')}`);
		installedAny = true;
	}
	return installedAny;
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
		console.log(`\nSkill source: ${SKILLS.map((s) => s.name).join(', ')}`);
		return;
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

	console.log(`Installing Vesk skills:\n`);
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
