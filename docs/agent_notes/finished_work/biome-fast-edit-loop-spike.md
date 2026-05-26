# Biome Fast Edit-Loop Spike

Date: 2026-05-26
Branch: `spike/biome-fast-edit-loop`
Source task:
`docs/agent_notes/backlog/lint-system-improvements/18-fast-edit-loop-linter-spike.md`

## Outcome

Installed `@biomejs/biome@2.4.15` and completed the measured spike. Decision:
keep ESLint authoritative. Biome is fast enough for a future narrow advisory
lint-only tier, but should not be wired into CI, ratchets, formatting, or
import sorting yet.

## Evidence

- Direct `biome migrate eslint` failed against the current flat config because
  the loaded `eslint-plugin-regexp` object is circular. A scratch sanitized
  config preserving `files`, `ignores`, and `rules` produced inventory data.
- Sanitized migrator inventory: 746 ESLint rule entries; 345 fully covered
  including formatter coverage; 188 direct rule migrations; 259 not
  implemented; 77 unknown-source entries.
- Warm timing sample:
  - single TSX file: ESLint 2,591 ms, Biome lint 51 ms;
  - current post-edit sequence: Prettier 286 ms plus ESLint fix 2,829 ms,
    Biome lint write 50 ms;
  - five-file changed slice: cached ESLint 760 ms, Biome lint 53 ms;
  - path-policy lintable list: cached ESLint 3,655 ms, Biome lint 638 ms over
    1,851 files.
- Diff churn: `biome lint --write` made no safe-fix changes on the
  representative files, but `biome check --write` after Prettier migration
  reordered imports in two files and ESLint `--fix` reversed both changes.
- Divergences: Biome defaults flagged current passing code for React hook
  dependencies and a literal `${...}` guidance string. Full path-policy default
  lint reported 77 errors, 737 warnings, and 258 infos.

## Verification

- `node_modules/.bin/biome --version`
- Scratch `biome migrate eslint` direct and sanitized runs.
- Timing and churn commands recorded in `docs/guides/biome-lint-adoption.md`.
- `bun run lint -- --max-warnings=0`
- `bun run format:changed:check`
- `bun run typecheck`

`bun run verify:changed` was blocked by its staged-worktree guard because the
intended package/doc changes were unstaged. `bun run verify` passed lint,
ratchet, zero-baseline, and coverage-map, then failed at repository-wide
`format:check` on pre-existing unrelated Prettier drift.
