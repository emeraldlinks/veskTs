# 000 — Fork Source

## Decision

Vesk forks from Ripple at tag `ripple@0.3.13`, commit `cdc71485` ("Version Packages (#861)").

## Verification

- `ripple@0.3.13` resolves to `cdc71485`
- The very next commit is `228f1bb3` ("Abstract Ripple compiler into `@tsrx/core` and `@tsrx/ripple` (#866)")
- No commits exist between them: `git log cdc71485..228f1bb3` returns exactly that one commit
- This is the commit immediately preceding the TSRX restructuring

## License

**MIT**, Copyright (c) 2025 Dominic Gannaway

Confirmed at commit `cdc71485` via `LICENSE` file in repository root. Full text retained in the scratch clone at `/home/joe/vesk/ripple-fork-source/LICENSE`.

## Scratch Clone

The full Ripple codebase at this commit is preserved at `/home/joe/vesk/ripple-fork-source/` for reference during analysis (Phase 0, Step 0.2). This is not the Vesk repo — Vesk is a fresh project, not a git fork/rebase. Ripple's git history will not be carried into the Vesk repo.
