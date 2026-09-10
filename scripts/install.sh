#!/usr/bin/env bash
#
# Vesk language support installer for Vim and Neovim.
#
#   curl -fsSL https://raw.githubusercontent.com/emeraldlinks/veskTs/main/scripts/install.sh | bash
#
# Installs:
#   - Syntax highlighting for `.vsk` (components, JSX, <style>, reactive &[], intrinsics)
#   - Filetype detection + formatting options
#   - The vesk LSP server (bundled, so no build required) wired to Neovim's
#     built-in LSP client (complete/hover/goto/rename/diagnostics/format).
#   - For plain Vim: highlighting + filetype (Vim has no built-in LSP client;
#     use the bundled server with coc.nvim/vim-lsp if you want language features).
#
# Options (env vars):
#   VESK_REPO   git source (default: the veskTs monorepo)
#   VESK_DIR    install prefix  (default: "$HOME/.local/share/vesk")
#   VESK_SETUP  0 to skip touching your editor config (default: 1)
#   EDITOR      nvim|vim|vim too (default: auto-detect: nvim, then vim)
#
set -euo pipefail

REPO="${VESK_REPO:-https://github.com/emeraldlinks/veskTs.git}"
PREFIX="${VESK_DIR:-$HOME/.local/share/vesk}"
TOUCH_CONFIG="${VESK_SETUP:-1}"

log()  { printf '\033[1;36m[vesk]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[vesk]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[vesk]\033[0m ERROR: %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git is required to install vesk"

# ---- pick the editor -------------------------------------------------------
EDITOR_CHOICE="${EDITOR:-}"
if [[ -z "$EDITOR_CHOICE" ]]; then
  if command -v nvim >/dev/null; then EDITOR_CHOICE=nvim
  elif command -v vim  >/dev/null; then EDITOR_CHOICE=vim
  fi
fi
case "$EDITOR_CHOICE" in
  nvim) command -v nvim >/dev/null || die "EDITOR=nvim but nvim is not in PATH" ;;
  vim)  command -v vim  >/dev/null || die "vim is not in PATH" ;;
  *)    die "no editor found (install Neovim or Vim first), or set EDITOR=nvim/vim" ;;
esac

# ---- fetch extension --------------------------------------------------------
log "Fetching vesk extension from $REPO"
SRC="$PREFIX/src"
mkdir -p "$PREFIX"
if [[ -d "$SRC/.git" ]]; then
  # Force-sync the shallow clone to origin/main: a plain "pull --ff-only" and
  # "clone --depth 1" can diverge after multiple shallow fetches, silently
  # skipping updates. reset --hard always lands on the current upstream.
  git -C "$SRC" fetch --depth 1 --quiet origin main || true
  git -C "$SRC" reset --hard --quiet origin/main || true
else
  git clone --depth 1 --quiet "$REPO" "$SRC" || die "failed to fetch $REPO"
fi

NEOMATIVE="$SRC/extension/vsk-neovim"
[[ -d "$NEOMATIVE" ]] || die "extension/vsk-neovim missing from $REPO (check VESK_REPO)"

EXT="$PREFIX/extension"
rm -rf "$EXT"
mkdir -p "$PREFIX"
cp -R "$NEOMATIVE" "$EXT"

LSPSERVER="$EXT/lsp-server/index.mjs"
if [[ ! -s "$LSPSERVER" ]]; then
  warn "LSP server bundle missing — building requires the full monorepo; install failed partially."
fi

# ---- install for Neovim -----------------------------------------------------
if [[ "$EDITOR_CHOICE" == nvim ]]; then
  DATAROOT="${XDG_DATA_HOME:-$HOME/.local/share}"
  PACKDIR="$DATAROOT/nvim/site/pack/vesk/start"
  DEST="$PACKDIR/vesk.nvim"

  log "Installing Neovim plugin -> $DEST"
  mkdir -p "$PACKDIR"
  rm -rf "$DEST"
  cp -R "$EXT" "$DEST"
  rm -f "$DEST/lsp-server/index.mjs.map" "$DEST/scripts/build-lsp.cjs"
  if [[ -s "$EXT/lsp-server/index.mjs" ]]; then
    cp "$EXT/lsp-server/index.mjs" "$DEST/lsp-server/index.mjs"
  fi
  log "LSP server -> $DEST/lsp-server/index.mjs ($(${EDITOR_CHOICE} --version | head -1))"

  if [[ "$TOUCH_CONFIG" == 1 ]]; then
    # Find the user config: init.lua before init.vim.
    if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
      CFGDIR="$XDG_CONFIG_HOME/nvim"
    else
      CFGDIR="$HOME/.config/nvim"
    fi
    INIT_LUA="$CFGDIR/init.lua"
    INIT_VIM="$CFGDIR/init.vim"

    MARKER='-- [[vesk]]'
    ENDMARKER='-- [[/vesk]]'
    # packadd (not a bare require): the user config is sourced before nvim
    # auto-loads pack/*/start (and LazyVim never runs packloadall), so the
    # plugin dir must be put on the runtimepath explicitly or the require
    # throws "module 'vesk' not found" and aborts the editor bootstrap.
    # The block is idempotent: re-running the installer rewrites any previous
    # (older, bare-require) block into the canonical packadd form.
    block_file=""
    if [[ -f "$INIT_LUA" ]]; then block_file="$INIT_LUA"; fi
    if [[ -z "$block_file" && -f "$INIT_VIM" ]]; then block_file="$INIT_VIM"; fi
    if [[ -z "$block_file" ]]; then
      mkdir -p "$CFGDIR"
      touch "$INIT_LUA"
      block_file="$INIT_LUA"
    fi

    if grep -qF -- "$MARKER" "$block_file"; then
      if [[ "$block_file" == "$INIT_LUA" ]]; then
        awk -v m="$MARKER" -v e="$ENDMARKER" '
          $0==m && !done { print m; print "vim.opt.rtp:append(vim.fn.stdpath(\047data\047) .. \047/site/pack/vesk/start/vesk.nvim\047)"; print "require(\047vesk\047).setup {}"; print e; done=1; skip=1; next }
          $0==e && skip { skip=0; next }
          skip { next }
          { print }
        ' "$block_file" > "$block_file.tmp" && mv "$block_file.tmp" "$block_file"
        log "Updated vesk setup block in $block_file"
      else
        awk -v m="$MARKER" -v e="$ENDMARKER" '
          $0==m && !done { print "\" " m; print "let s:veskrtp = stdpath(\047data\047) .. \047/site/pack/vesk/start/vesk.nvim\047"; print "if isdirectory(s:veskrtp)"; print "  execute \047set runtimepath+=\047 . s:veskrtp"; print "endif"; print "lua require(\"vesk\").setup {}"; print "\" " e; done=1; skip=1; next }
          $0==e && skip { skip=0; next }
          skip { next }
          { print }
        ' "$block_file" > "$block_file.tmp" && mv "$block_file.tmp" "$block_file"
        log "Updated vesk setup block in $block_file"
      fi
    elif [[ "$block_file" == "$INIT_LUA" ]]; then
      printf '\n%s\n' "$MARKER" \
        "vim.opt.rtp:append(vim.fn.stdpath('data') .. '/site/pack/vesk/start/vesk.nvim')" \
        "require('vesk').setup {}" "$ENDMARKER" >> "$block_file"
      log "Added vesk setup block to $block_file"
    else
      printf '\n%s\n' "\" $MARKER" \
        "let s:veskrtp = stdpath('data') .. '/site/pack/vesk/start/vesk.nvim'" \
        "if isdirectory(s:veskrtp)" "  execute 'set runtimepath+=' . s:veskrtp" "endif" \
        'lua require("vesk").setup {}' "\" $ENDMARKER" >> "$block_file"
      log "Added vesk setup block to $block_file"
    fi
  fi

  log "Done. Open a .vsk file in Neovim."
  log "Tip: :LspInfo shows the running server; :VeskRestart restarts it."
fi

# ---- install for Vim --------------------------------------------------------
if [[ "$EDITOR_CHOICE" == vim ]]; then
  RTP="${VIMRUNTIME_HOME:-$HOME/.vim}"
  log "Installing Vim runtime files -> $RTP"
  mkdir -p "$RTP/syntax" "$RTP/ftdetect" "$RTP/ftplugin"

  cp "$EXT/syntax/vsk.vim" "$RTP/syntax/vsk.vim"
  cp "$EXT/ftdetect/vsk.vim" "$RTP/ftdetect/vsk.vim"

  # Vim does not load ftplugin/*.lua — provide the equivalent .vim file.
  if [[ ! -f "$RTP/ftplugin/vsk.vim" ]]; then
    cat > "$RTP/ftplugin/vsk.vim" <<'VIM'
if exists('b:did_ftplugin') | finish | endif
let b:did_ftplugin = 1
setlocal tabstop=2 shiftwidth=2 softtabstop=2 expandtab smartindent
VIM
  fi

  log "Syntax + filetype installed for Vim."
  warn "Plain Vim has no built-in LSP client. For language features use Neovim,"
  warn "or point coc.nvim / vim-lsp at: node $LSPSERVER"
fi

# ---- summary ---------------------------------------------------------
cat <<EOF

  vesk installed for $EDITOR_CHOICE.
  Extension: $EXT
  LSP  server: $LSPSERVER
  Source: $SRC

  To update later, re-run this installer (it pulls and reinstalls).
  To remove: delete $PREFIX and the pack/rc lines marked [[vesk]].
EOF