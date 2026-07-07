# 31. Audit-lane remedy-text batch (4 small fixes)

Status: Done — implemented 2026-07-05; audit-lane diagnostics now include the missing remedy details for logs-audit, blob-size, coverage-map suggestions, and knip baseline improvements.
Lens: sensors · Area: actionability · Severity: low-med · Size: S · Confidence: med
Theme: finding-without-remedy · Source: Musi lint-messaging review 2026-07-05 (5 Sonnet agents + Fable verification)

Four independent one-edit fixes; land as one commit or split freely.

## (a) logs-audit: name the fix, not just the violation
`scripts/logs-audit/logs-audit-format.ts:19-23` — `ERROR` lines say e.g.
"sensitive field 'password' is not redacted" with file:line, but never name
the redaction helper to apply. Locate the canonical redaction util in the
server logging module and name it in the message ("wrap with `<helper>` or
add the field to the redaction list at `<path>`").

## (b) sensor-blob-size: echo the malformed allowlist line
`scripts/sensor-blob-size.ts:226-232` — allowlist parse errors give
file:line and the expected format (`'<relative-path> # reason'`) but not
the offending line's content. Echo the raw line in the error so the fix is
a glance, not a file trip.

## (c) coverage-map suggest: hint the placeholder choice
`scripts/lint-coverage-map-check-suggest.ts:76-78` — when a file is neither
ESLint-reachable nor ratchet-covered, the suggested row carries a
`<excluded|not-code|proposed>` placeholder with no guidance on choosing.
Add one line defining the three statuses (or point at the coverage-map
doc's status-legend section if one exists).

## (d) knip baseline: explain why a decrease fails
`scripts/sensor-knip-unused-exports-baseline.ts:78-88` — the "count
decreased" branch says only to run `--update`; unlike the "grew" branch it
never explains *why* an improvement fails (the baseline only ratchets
downward via an explicit update, locking the win in). Mirror the ratchet
improvement message's framing: "current tree is better than the baseline;
lock it in."

## Scope / caveats
- Message-text only; update any snapshot/fixture tests
  (`scripts/*.test.ts` beside each).
- (a) requires finding the real helper name — verify it exists and is the
  sanctioned path before naming it (recalled-memory rule: don't recommend
  a symbol without checking it's current).
