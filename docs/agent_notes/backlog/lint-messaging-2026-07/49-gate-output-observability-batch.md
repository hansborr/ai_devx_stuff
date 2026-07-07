# 49. Gate-output observability batch (verify-logs, steps-lib)

Status: Done — implemented on lane/lint-msg-envelope-fix; verify-log summaries use distinct unconfirmed-state tokens and steps-lib invariant errors point at verify-step regeneration.
Lens: gates · Area: consistency · Severity: low · Size: S · Confidence: med
Theme: self-explanatory-output · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

Two independent fixes; one commit is fine.

## (a) verify-logs summary: disambiguate the `-` state
`scripts/verify-logs.sh:597-677` — the summary table's `-` symbol
conflates "failed", "in-flight", and "stale/unconfirmable", explained only
in a separate Legend paragraph. Use distinct short tokens (e.g. `FAIL`,
`RUN?`, `STALE`) so a row is readable without cross-referencing the
legend. Keep the legend for the tokens' definitions; the `--json` envelope
already distinguishes these states — this is display-only.

## (b) steps-lib internal errors: point at the regen path
`scripts/verify/steps-lib.sh` — internal-invariant failures ("unknown
slot …", "generated command array is missing …") leave the agent with a
bare assertion. Append the existing regen/check pointer the pre-commit
staleness warnings already use (`bun run harness:wiring:check` /
`generate-verify-steps`, cf. `.husky/pre-commit:189-192`) so the recovery
is one command away.

## Scope / caveats
- (a) may have fixture/smoke coverage asserting table output — update.
- (b): these errors indicate a broken generated file, so the pointer must
  not assume `bun run` works from a half-broken tree; name the direct
  script path as fallback.
