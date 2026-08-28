# Vesk — agent-agnostic skill

An advanced, framework-grounded skill for building with
[Vesk](https://vesk.dev), the compiler-first post-VDOM framework. Covers the
full documented surface: `.vsk` components, both body modes, `track()`
reactivity, file-based routing, data fetching, forms/actions, API routes,
server helpers, middleware, security, SSG/ISR, configuration, and the CLI.

Every claim is grounded in the official guide
(`vesk-docs/public/docs/guide/`) — no invented APIs. `SKILL.md` follows the
[Agent Skills spec](https://agentskills.io) (YAML frontmatter + markdown
body), so it works with any agent that can read a `SKILL.md`.

## Quick install (all detected tools)

```sh
node skills/install.js
```

Detects which AI coding tools are installed and provisions the `vesk` skill
to each. Target one tool, provision everything, or inspect:

```sh
node skills/install.js <platform>     # one platform
node skills/install.js --all          # every platform, even if absent
node skills/install.js --list         # show target paths
node skills/install.js --force        # overwrite an existing vesk skill
```

Then **restart your AI tool** so it re-scans skills at startup.

## Platforms & where the skill lands

| Platform | Scope | Discovery location |
| --- | --- | --- |
| opencode | global | `~/.config/opencode/skills/vesk/SKILL.md` |
| Claude Code | global | `~/.claude/skills/vesk/SKILL.md` |
| GitHub Copilot | global | `~/.copilot/skills/vesk/SKILL.md` |
| Codex | global | `~/.codex/skills/vesk/SKILL.md` |
| Antigravity (Gemini) | global | `~/.gemini/antigravity/skills/vesk/SKILL.md` |
| Cursor | project | `.cursor/skills/vesk/SKILL.md` |
| Windsurf | project | `.windsurf/skills/vesk/SKILL.md` |

Project-scoped tools are written into the current working directory so the
skill ships with the repository. Global-scoped tools use `$HOME`.

## Manual install

Copy `SKILL.md` into your tool's skills directory (see the table above). For
example, opencode:

```sh
mkdir -p ~/.config/opencode/skills/vesk && \
cp skills/vesk/SKILL.md ~/.config/opencode/skills/vesk/SKILL.md
```

## How it's used

When a task matches the `vesk` name/description, the agent loads
`SKILL.md`'s instructions through its native skill mechanism. The skill
bears a generic `description` that triggers on `.vsk` work across agents.

## Layout

```
skills/
  vesk/SKILL.md     # canonical skill (Agent Skills spec)
  install.js        # agent-agnostic installer (zero-dependency Node/ESM)
  README.md         # this file
```
