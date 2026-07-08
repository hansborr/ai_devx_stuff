# 17. Verify/env legacy retirements + db-status duplicate

Status: Done — implemented 2026-07-07.
Commits: `ea6d5fff` (`fix(harness): retire legacy verify timeout aliases`);
`65819772` (`fix(harness): retire duplicate db status shell wrapper`).
Size: S · Severity: low
Source: 00-report.md Tier 3 (the verify/env-owned items; see
01-promotion-map.md for where the rest of Tier 3 went)

## Scope

- Retire the `.no-stop-verify` legacy kill-switch alias (`stop-policy.sh:14`)
  and the `MUSI_VERIFY_TIMEOUT` back-compat env (3 files) — first confirm no
  worktree or doc still carries them (grep worktrees + docs before deleting).
- `db-status.sh` vs `db-status.ts` — pick one (the substrate ruling in leaf
  13 says analytical logic lives in TS; if that ruling lands first, keep the
  TS one and fold any shell-only behavior in), delete the other, update
  references.

## Verification

- `bun run doctor` still passes; `bun run harness:check` green; reference
  sweep (`rg`) for the retired names comes back empty.
