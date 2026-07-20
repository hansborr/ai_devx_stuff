# Merge-driver driverless-window guard (low-priority / optional)

Status: Done — landed 2026-07-19 (wave-1 ready-2026-07 drain; doc paragraph in `docs/guides/lint-ratchet-merges.md`).
Date: 2026-07-16
Source: the merge-driver field exercise (drain
leaf 2.2; the exercise and findings notes were closed Done and removed at
the 2026-07-19 triage — recoverable from git history).
Size: S.

## Evidence

A fresh `git clone` of this repo carries the tracked `.gitattributes` mapping
`/lint-ratchet.baseline.json merge=lint-ratchet-baseline`, but the driver
*definition* (`[merge "lint-ratchet-baseline"] driver = …`) lives only in local
`.git/config`, installed by the package `prepare` script on the first
`bun install`. Until then the named driver is undefined, and **Git silently
falls back to its built-in text merge** — it has no native "hard-fail when a
mapped merge driver is undefined."

Observed in a pristine clone (no `bun install`): merging two branches that both
edited overlapping regions of `lint-ratchet.baseline.json` wrote Git conflict
markers *into the generated JSON*, breaking it as valid JSON. Disjoint edits
text-merge "cleanly" but without any semantic guarantee or truth-up marker.

The window is: **clone → merge/rebase/cherry-pick a baseline-touching change
before the first `bun install`.** Rare for a human (who installs deps before
working), but reachable by automation — a CI auto-merge bot, a scripted rebase,
or a tool operating in a fresh checkout.

## Current mitigation (already adequate for most cases)

- **Reactive tripwire:** `parseLintRatchetBaselineStructure`'s
  `CONFLICT_MARKER_TRIPWIRE` rejects a marker-containing baseline on the next
  `check-baseline`/preflight and prints the exact recovery recipe (install the
  driver, `baseline:restore-stage --ours`, regenerate; never hand-merge).
- **CI backstop:** `lint:ratchet` on PRs/pushes blocks a marker-corrupted or
  silently mis-merged baseline before it lands on `main`.

So a bad driverless merge cannot silently reach `main`; it fails loudly at the
next check. The residual gap is only that the failure is *reactive* (post-merge)
rather than *at merge time*.

## Options (pick at most one; none is urgent)

1. **Documentation only (cheapest, recommended):** add an explicit note to
   `docs/guides/lint-ratchet-merges.md` that the semantic driver is
   inactive in a fresh clone until `bun install`/`bun run prepare` runs, so any
   merge/rebase/cherry-pick of the baseline must happen *after* install. For a
   public harness reference this is the honest, copyable framing of a Git
   limitation.
2. **Proactive check in an existing entry point:** have `bun run doctor` (which
   already reports merge-driver drift) or a pre-merge advisory warn when a
   baseline-touching merge is attempted with the driver unconfigured. Note this
   cannot be a tracked Git hook that fires *before* the text merge — Git offers
   no pre-content-merge hook — so it would be advisory only.
3. **No code change:** accept the reactive tripwire + CI as sufficient and close
   this as won't-do with the evidence recorded.

## Recommendation

Option 1 (a doc note). The driver itself is sound; the only gap is a fresh-clone
timing window that Git's model cannot close proactively, and the reactive
guards already prevent corruption from landing. Escalate to option 2 only if an
automated driverless merge is ever observed in practice.
