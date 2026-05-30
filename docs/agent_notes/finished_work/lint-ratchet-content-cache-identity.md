# Lint Ratchet Content Cache Identity

Date: 2026-05-29

Implemented `/home/node/lint-merge-debt/02-ratchet-regression-content-cache-identity.md`.

Notes:

- `--edit-check-targets` appends a cache identity per target, computed inside the ratchet TypeScript boundary from the committed baseline test payload, live config hash, and live rule-source hash.
- `ratchet-regression-check.sh` uses that identity set with the file content hash for its advisory content cache token.
- Content-cache paths include a repo-root hash to avoid collisions between worktrees sharing the same temp state root.
- Verification run: `bash scripts/ai-hooks/test.sh`; `bash scripts/test-lint-ratchet.sh`; `FORCE_VERIFY=1 bun run verify:changed`.
