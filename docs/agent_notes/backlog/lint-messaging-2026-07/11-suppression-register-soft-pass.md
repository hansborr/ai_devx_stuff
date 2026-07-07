# 11. Suppression registers: an unrun check must not read as a pass

Status: Done — implemented 2026-07-05; both suppression registers now fail with exit 2 when they cannot verify a git repository.
Lens: gates · Area: truthfulness · Severity: med-high · Size: S · Confidence: med
Theme: silent-skip · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

## Problem
Both `scripts/suppression-register.sh` and `scripts/eslint-disable-register.sh`
exit 0 with a `WARN:` line when not inside a git repository. A check that
could not run is indistinguishable (by exit code) from a clean pass, so any
caller treating exit 0 as "suppressions are accounted for" is silently
wrong in that environment.

## Evidence
- `scripts/suppression-register.sh` — "not inside a git repository" branch
  warns and `exit 0` (report-sourced; locate with
  `rg -n "git repository" scripts/suppression-register.sh`).
- `scripts/eslint-disable-register.sh` — same pattern.

## Proposed direction
Decide the semantics first: if these scripts are only ever invoked from
inside the repo (verify slots, pre-commit), the branch is defensive
dead code — make it a hard failure (`exit 2` with "cannot check: not a git
repository") so misconfiguration surfaces loudly. If there is a legitimate
out-of-repo invocation (e.g. doctor from a copied tree), emit a
distinguishable `SKIP:` status and make gate callers treat SKIP as failure
while manual callers may accept it.

## Scope / caveats
- Grep all call sites (`rg -n "suppression-register|eslint-disable-register"
  scripts/ .husky/ package.json`) before changing exit semantics; a caller
  may currently rely on the soft pass.
- Keep the two scripts' behavior identical — they are siblings and drift
  here is exactly the kind of inconsistency this pack exists to remove.
