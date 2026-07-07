# 10. Post-merge truth-up never escalates on the one case it exists for — semantically stale strict-min merges

Status: Done — implemented on fix/lint-ratchet-correctness-lane.
Lens: ratchet · Area: merge lane · Severity: high · Size: M · Confidence: high
Theme: merge-safety · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
The post-merge hook runs the full `lint:ratchet:check-baseline` only when the cheap
preflight fails or `MUSI_RATCHET_POSTMERGE=full` is set. The preflight is purely
structural: it parses the baseline, checks registry correspondence, hashes, and
deterministic re-serialization — it never compares counts against the merged
working tree. But the documented purpose of the truth-up is exactly the
strict-min case where the semantic merge kept the lower floor and the merged
*source tree* is worse (e.g. `main` drained a path to zero while the feature
branch still carries the violation). That baseline is structurally perfect, so
the default path silently skips the full check and the stale floor is only
caught later by CI or the next full verify.

## Evidence
- `scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh:22-44` — `run_full_check=1` only on `MUSI_RATCHET_POSTMERGE=full` or nonzero preflight. Verified 2026-07-04.
- `scripts/lint-ratchet/post-merge-baseline-preflight.ts:1-17` — preflight = `parseLintRatchetBaseline` only (structure, version, registry, hashes, determinism via `baseline-validation.ts:96-175`); no working-tree enumeration, no ESLint. Verified.
- `docs/guides/lint-ratchet.md:656-660` — "The post-merge truth-up is the local backstop for the strict-min case where the merged source tree is actually worse than the lower floor the driver preserved" — the implemented default cannot detect that case.

## Proposed direction
Make the escalation condition match the documented guarantee. Cheapest honest
option: have the merge driver drop a marker file (it knows when it performed a
semantic min-merge, and specifically when it took a lower floor from either
side) and have the post-merge hook escalate to `lint:ratchet:check-baseline`
exactly when the marker is present. Alternative: always run the full check when
the merge touched `lint-ratchet.baseline.json` (bounded by the merge frequency,
but pays a full ESLint collection per such merge). Either way, update
`docs/guides/lint-ratchet.md` so the stated backstop and the implemented
behavior agree.

## Scope / caveats
- The hook is deliberately advisory (prints, exits 0) with CI as the blocking
  backstop; this leaf tightens *when it looks*, not its advisory nature.
- Marker plumbing must work from linked worktrees (git common-dir resolution
  already exists in the driver installer).
- Known limitation: squash and octopus merges do not get a local truth-up
  because Git does not provide the `MERGE_HEAD` / post-merge hook path this
  marker lifecycle relies on; CI remains the blocking backstop.
- One commit: driver marker + hook escalation + a fixture test + doc line.
