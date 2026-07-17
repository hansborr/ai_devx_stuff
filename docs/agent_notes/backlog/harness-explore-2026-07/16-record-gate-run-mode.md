# 16 — Gate outcome (real/bridged/skipped) is not recorded in run metadata

Status: Done
Track: T (tooling) · Priority: P3 · Size: S

## Evidence (verified 2026-07-11, adversarial triage pass; re-verify before implementing)

- `scripts/lib/verify-metadata.sh:594` (`musi_try_verify_marker_bridge`) and
  the pre-commit marker short-circuit (`.husky/pre-commit:297-320`, bridge
  call at `:316`) — when either fires, the gate exits 0 with only a stdout
  line and writes **no run metadata at all** for that gate conclusion (it
  exits before `rm -rf "$LOG_DIR"` at `.husky/pre-commit:331`, so the
  previous run's `wrapper.json` survives untouched).
- A `mode` field already exists in `wrapper.json`
  (`musi_write_wrapper_meta`, `verify-metadata.sh:798`; values
  `parallel-precommit` from `.husky/pre-commit` and
  `serial-verify`/`parallel-verify`/`parallel-verify-changed` from
  `scripts/verify.sh:97-109`). The gap is narrower than "no mode": the
  short-circuit paths persist nothing, and fast-commit pre-commit runs are
  labeled `parallel-precommit` identically to full runs — skipped slots are
  silently `continue`d with no step fragment
  (`scripts/verify/steps-lib.sh:144-152, 227-229`).
- Constraint the fix must respect: `.husky/pre-push:76` reads
  `<verify-log-dir>/meta/wrapper.json` as its verify-evidence fallback, and
  `musi_restamp_verify_wrapper` (`verify-metadata.sh:837`) only accepts
  passing `serial-verify`/`parallel-verify` wrappers. The bridge path
  preserves that evidence precisely *because* it writes nothing — so the
  short-circuit record must not clobber the live `wrapper.json`.
- The fingerprint already folds fast-commit presence in
  (`ai_precommit_fingerprint`, `verify-metadata.sh:371-382`), so reuse
  safety is fine — only auditability is missing. The fast-commit pending
  marker (`.husky/pre-commit:101-113`) records provenance for `land.sh` but
  is a single consumable marker, not an audit trail.

## Do

Two small, independent recordings — neither touches the live `wrapper.json`
on a short-circuit:

1. Bridge/short-circuit paths: when the marker short-circuit or
   `musi_try_verify_marker_bridge` admits a commit, append a minimal entry
   to the existing history dir (`musi_persist_run_meta_history` naming
   scheme, e.g. `<epoch>-precommit-bridged-0.json` /
   `<epoch>-precommit-marker-0.json`) recording head, fingerprint, and
   which marker satisfied the gate. Do not write `LOG_DIR/meta/wrapper.json`.
2. Fast-commit runs: when `musi_fast_commit_enabled` skips slots for the
   `pre_commit` consumer, label the run distinctly (e.g. wrapper mode
   `parallel-precommit-fast`). This is safe: pre-push evidence and
   `musi_restamp_verify_wrapper` only match the verify modes, and the
   history filename embeds the mode, so bridged/fast landings become
   greppable after the fact.

## Verify

```
bun run verify:changed
bun run test:scripts:changed
# stage a trivial change, run verify:changed, then commit within 120s and
# inspect the history dir for the bridged/marker entry; repeat with the
# fast-commit marker present and confirm the -fast mode in the history
# filename. Confirm .husky/pre-push evidence fallback still passes after a
# bridged commit (wrapper.json untouched).
```

## Acceptance

Every gate conclusion leaves persisted metadata saying whether steps ran or
which short-circuit fired, without disturbing the pre-push verify-evidence
`wrapper.json` on short-circuit paths.
