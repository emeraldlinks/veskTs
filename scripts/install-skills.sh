#!/usr/bin/env bash
#
# Vesk AI-agent skill installer.
#
#   curl -fsSL https://raw.githubusercontent.com/emeraldlinks/veskTs/main/scripts/install-skills.sh | bash
#
# Installs all maintained Vesk migration skills (skills/<name>/SKILL.md)
# into every AI coding tool that speaks Agent Skills, so agents load the
# *current* authoritative copy of the Vesk API reference instead of whatever
# was in their training data. One source file, every tool's native skill
# discovery location: opencode, Claude Code, Copilot, Codex, Gemini
# (antigravity), Cursor, Windsurf, Pi, Kilo Code.
#
# Options:
#   VESK_REPO             git source used for the raw file base
#                         (default: the veskTs monorepo).
#   VESK_SKILL_PLATFORMS  comma-separated list to pin (e.g. opencode,cursor).
#                         Default: every platform listed below.
#   VESK_FORCE            accepted for backwards compatibility; installs are
#                         always overwriting, so it is a no-op.
#
# Installs are ALWAYS overwriting and ALWAYS target every platform: an existing
# skill directory is refreshed with the current source, never skipped, and a
# missing one is created. Re-running this script is the supported way to install
# and to update skills, so there is no stale-copy and no missing-tool failure mode.
#
# Flags:
#   --list   show target paths and exit
#   --all    accepted, no-op (every platform is installed by default)
#   --force  accepted, no-op (installs always overwrite)
#
set -euo pipefail

REPO="${VESK_REPO:-https://github.com/emeraldlinks/veskTs.git}"
RAW_BASE="${VESK_RAW_BASE:-https://raw.githubusercontent.com/emeraldlinks/veskTs/main}"
PREFIX="${VESK_DIR:-$HOME}"


SKILLS=(vesk react-to-vesk nuxt-to-vesk bun-to-vesk)

log()  { printf '\033[1;36m[vesk-skills]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[vesk-skills]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[vesk-skills]\033[0m ERROR: %s\n' "$*" >&2; exit 1; }

# When run as a file from a checkout, copy from the repo; when piped through
# curl, fetch the raw files from GitHub. Both deliver identical content.
#
# SCRIPT_DIR is the `scripts/` directory; SKILLS_DIR is the repo root beside it.
# Looking for `scripts/skills/<name>/SKILL.md` never matches, which silently
# made a checkout install re-download the PUBLISHED skill and clobber local
# edits to it — the exact thing a fresh `main` checkout is supposed to avoid.
SCRIPT_DIR=""
SKILLS_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && "${BASH_SOURCE[0]}" != "bash" ]]; then
  SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd || true)"
  if [[ -n "$SCRIPT_DIR" && -d "$SCRIPT_DIR/../skills" ]]; then
    SKILLS_DIR="$(cd -- "$SCRIPT_DIR/../skills" >/dev/null 2>&1 && pwd || true)"
  fi
fi

# ---- platforms --------------------------------------------------------------
# Each entry: display name, global-vs-project scope, and the skill dir.
PLATFORMS=(
  "opencode|global|$PREFIX/.config/opencode/skills"
  "claude-code|global|$PREFIX/.claude/skills"
  "copilot|global|$PREFIX/.copilot/skills"
  "codex|global|$PREFIX/.codex/skills"
  "antigravity|global|$PREFIX/.gemini/antigravity/skills"
  "cursor|project|$PWD/.cursor/skills"
  "windsurf|project|$PWD/.windsurf/skills"
  "pi|global|$PREFIX/.pi/skills"
  "kilocode|global|$PREFIX/.kilo/skills"
)

platform_dir() { printf '%s' "$1" | awk -F'|' '{print $3}'; }
platform_scope() { printf '%s' "$1" | awk -F'|' '{print $2}'; }
platform_name() { printf '%s' "$1" | awk -F'|' '{print $1}'; }

# ---- helpers ----------------------------------------------------------------
fetch_skill() {
  local name="$1" file="$2" dest="$3"
  if [[ -n "$SKILLS_DIR" && -f "$SKILLS_DIR/$name/$file" ]]; then
    cp "$SKILLS_DIR/$name/$file" "$dest"
  else
    curl -fsSL "$RAW_BASE/skills/$name/$file" -o "$dest" || die "failed to fetch $name/$file from $RAW_BASE"
  fi
}

install_one() {
  local platform="$1" name="$2"
  local dir scope
  dir="$(platform_dir "$platform")"
  scope="$(platform_scope "$platform")"
  local refreshed="installed"
  if [[ -f "$dir/$name/SKILL.md" ]]; then
    refreshed="refreshed"
  fi
  mkdir -p "$dir/$name"
  fetch_skill "$name" SKILL.md "$dir/$name/SKILL.md"
  # Best-effort README, if the skill ships one.
  if [[ -n "$SKILLS_DIR" && -f "$SKILLS_DIR/$name/README.md" ]]; then
    cp "$SKILLS_DIR/$name/README.md" "$dir/$name/README.md"
  else
    curl -fsSL "$RAW_BASE/skills/$name/README.md" -o "$dir/$name/README.md" 2>/dev/null || true
  fi
  log "  $name ($scope, $refreshed) -> $dir/$name/SKILL.md"
}

# ---- main -------------------------------------------------------------------
FLAG_LIST=0 FLAG_ALL=0
for argv in "$@"; do
  case "$argv" in
    --list) FLAG_LIST=1 ;;
    --all) FLAG_ALL=1 ;;
    --force) ;; # installs always overwrite; flag kept for compatibility
    *) die "unknown flag: $argv" ;;
  esac
done

if [[ "$FLAG_LIST" == 1 ]]; then
  echo "Vesk skill targets:"
  for p in "${PLATFORMS[@]}"; do
    dir="$(platform_dir "$p")"
    printf '  %-12s %-8s -> %s\n' "$(platform_name "$p")" "$(platform_scope "$p")" "$dir"
  done
  echo "  skills: ${SKILLS[*]}"
  echo "  source: $RAW_BASE"
  exit 0
fi

# Select platforms: explicit env, --all, or auto-detect by existing dir.
SELECTED=()
if [[ -n "${VESK_SKILL_PLATFORMS:-}" ]]; then
  IFS=',' read -r -a parts <<< "$VESK_SKILL_PLATFORMS"
  for want in "${parts[@]}"; do
    found=""
    for p in "${PLATFORMS[@]}"; do
      if [[ "$(platform_name "$p")" == "$want" ]]; then found="$p"; break; fi
    done
    [[ -n "$found" ]] && SELECTED+=("$found") || warn "unknown platform \"$want\", ignoring"
  done
else
  # Default: every platform. Skill dirs are created if missing, so there is no
  # reason to guess which tools are installed.
  SELECTED=("${PLATFORMS[@]}")
fi

if [[ "${#SELECTED[@]}" == 0 ]]; then
  die "no platforms selected — pin a list with VESK_SKILL_PLATFORMS (see --list)"
fi

echo "Installing Vesk skills:"
for p in "${SELECTED[@]}"; do
  for name in "${SKILLS[@]}"; do
    install_one "$p" "$name"
  done
done

cat <<EOF

  Skills installed: ${SKILLS[*]}
  Source: $RAW_BASE

  Restart your AI coding tool so it re-scans skills at startup.
  To update later, re-run this installer.
EOF