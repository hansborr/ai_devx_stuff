# ai-hooks suite is not safe to run concurrently with itself

Status: Ready — low urgency; decide scope before any parallel-suite use.
Date: 2026-07-19
Source: parallel-instance determinism runs while draining the
commit-queue-test-load-flake note (landed via fix/commit-queue-test-flake;
note removed 2026-07-19 — git history).
Size: S (document) to M (isolate).

## Evidence

Running three full instances of `bash scripts/ai-hooks/test.sh`
concurrently in the same checkout (2026-07-19): one instance passed,
two failed in the protected-files tests long before the later
commit-queue tests ran —

- `FAIL: expected [reason=protected-files: Protected file: do not
  hand-edit lint-ratchet.baseline.json. …] to contain
  [advisory=protected-files: Repo-wide]`
- `FAIL: expected [] to contain [.allow-protected-edits]`

Mechanism: `policy_only_probe` (scripts/ai-hooks/test.sh:99–117) rm's,
conditionally touches, then rm's `$REPO_ROOT/.allow-protected-edits` —
a REPO-ROOT path shared by every instance, unlike the per-suite mktemp
`$TMP_ROOT` everything else uses — and test.sh:1612–1632 touches/rm's
the same path directly. The marker-DEPENDENT assertions race
bidirectionally: the probe assertions at test.sh:1597–1610 (first FAIL
above is :1609 — a peer rm'd the marker between the probe's touch and
its policy evaluation, so the expected downgrade-to-advisory came back
as a block; the marker-absent probe races the other way) and the
direct-marker assertions at test.sh:1614–1631 (second FAIL is :1622 —
`ai_policy_bash_protected_file_advisory` gates on marker existence, so
a peer's rm empties the context). Note the marker-touching-command
advisories at test.sh:456–467 do NOT race: `ai_policy_advisory_context`
returns the static `AI_POLICY_ALLOW_PROTECTED_EDITS_ADVISORY` string
for those regardless of marker state (policy.sh:978–983). Each suite
instance is internally correct; only cross-instance interleaving
breaks.

Impact today is low: no repo gate runs the suite in parallel with
itself (verify/test:scripts run it once per invocation). It bit only an
agent deliberately using N parallel suite instances as synthetic load —
where the failures also masquerade as protected-files regressions.

## Options (scope honestly before picking)

Suite-level non-self-concurrency may be fine to keep; present, don't
prescribe:

1. Wontfix-cheap: add a header comment in test.sh (and/or
   scripts/ai-hooks/README.md) stating the suite is single-instance-
   per-checkout because policy fixtures use the real repo-root marker;
   parallel determinism runs should use CPU load or isolated-function
   extraction instead. Zero risk, costs one paragraph.
2. Private marker: let the marker path be overridable (env var read by
   `protected-files.sh`, defaulted to the repo root) so
   `policy_only_probe` can point it under `$TMP_ROOT`. Makes the suite
   self-concurrent but adds a test-only knob to a production policy
   surface — the marker is repo-root-by-design, so review whether the
   knob weakens the protected-files story.
3. Cross-instance serialization: wrap the marker-dependent block in an
   flock keyed on the repo root. Keeps production surfaces untouched;
   adds fixture complexity and still serializes (slower parallel runs).

## Non-goals

Do not change production protected-files semantics (where the marker
lives, what it allows, its advisory text) to make tests parallel; any
override must default to today's behavior.
