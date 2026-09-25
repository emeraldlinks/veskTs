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
# (antigravity), Cursor, Windsurf.
#
# Options:
#   VESK_REPO             git source used for the raw file base
#                         (default: the veskTs monorepo).
#   VESK_SKILL_PLATFORMS  comma-separated list to pin (e.g. opencode,cursor).
#                         Default: auto-detect platforms whose skill dir exists.
#   VESK_FORCE            1 to re-copy even if already installed.
#
# Flags:
#   --list   show target paths and exit
#   --all    provision every platform (even absent)
#   --force  re-copy installed skills
#
set -euo pipefail

REPO="${VESK_REPO:-https://github.com/emeraldlinks/veskTs.git}"
RAW_BASE="${VESK_RAW_BASE:-https://raw.githubusercontent.com/emeraldlinks/veskTs/main}"
PREFIX="${VESK_DIR:-$HOME}"
FORCE="${VESK_FORCE:-0}"

SKILLS=(vesk react-to-vesk nuxt-to-vesk bun-to-vesk)

log()  { printf '\033[1;36m[vesk-skills]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[vesk-skills]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[vesk-skills]\033[0m ERROR: %s\n' "$*" >&2; exit 1; }

# When run as a file from a checkout, copy from the repo; when piped through
# curl, fetch the raw files from GitHub. Both deliver identical content.
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && "${BASH_SOURCE[0]}" != "bash" ]]; then
  SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd || true)"
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
)

platform_dir() { printf '%s' "$1" | awk -F'|' '{print $3}'; }
platform_scope() { printf '%s' "$1" | awk -F'|' '{print $2}'; }
platform_name() { printf '%s' "$1" | awk -F'|' '{print $1}'; }

# ---- helpers ----------------------------------------------------------------
fetch_skill() {
  local name="$1" file="$2" dest="$3"
  if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/skills/$name/$file" ]]; then
    cp "$SCRIPT_DIR/skills/$name/$file" "$dest"
  else
    curl -fsSL "$RAW_BASE/skills/$name/$file" -o "$dest" || die "failed to fetch $name/$file from $RAW_BASE"
  fi
}

install_one() {
  local platform="$1" name="$2"
  local dir scope
  dir="$(platform_dir "$platform")"
  scope="$(platform_scope "$platform")"
  if [[ ! -d "$dir/$name" ]]; then
    mkdir -p "$dir/$name"
  elif [[ "$FORCE" != 1 ]]; then
    log "  $name already installed at $dir/$name (skip; --force to reinstall)"
    return
  fi
  fetch_skill "$name" SKILL.md "$dir/$name/SKILL.md"
  # Best-effort README, if the skill ships one.
  if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/skills/$name/README.md" ]]; then
    cp "$SCRIPT_DIR/skills/$name/README.md" "$dir/$name/README.md"
  else
    curl -fsSL "$RAW_BASE/skills/$name/README.md" -o "$dir/$name/README.md" 2>/dev/null || true
  fi
  log "  $name ($scope) -> $dir/$name/SKILL.md"
}

# ---- main -------------------------------------------------------------------
FLAG_LIST=0 FLAG_ALL=0
for argv in "$@"; do
  case "$argv" in
    --list) FLAG_LIST=1 ;;
    --all) FLAG_ALL=1 ;;
    --force) FORCE=1 ;;
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
elif [[ "$FLAG_ALL" == 1 ]]; then
  SELECTED=("${PLATFORMS[@]}")
else
  for p in "${PLATFORMS[@]}"; do
    [[ -d "$(platform_dir "$p")" ]] && SELECTED+=("$p")
  done
fi

if [[ "${#SELECTED[@]}" == 0 ]]; then
  warn "no AI tool skill directories detected."
  warn "Install to every tool with: curl -fsSL ...install-skills.sh | bash -s -- --all"
  warn "or pin a list: VESK_SKILL_PLATFORMS=opencode,cursor bash scripts/install-skills.sh"
  exit 0
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