# Lint Messaging 2026-07-05 — Sources and Verdicts

How this pack was produced, which claims were verified, and what was
deliberately not promoted. Read before promoting any leaf.

## Method

Five parallel Sonnet exploration agents, one per messaging surface, each
instructed to inventory verbatim message text with file:line refs and
assess clarity/actionability for an unattended AI agent:

- **Rules** — all 23 registered `local/*` rules in `eslint-rules/`
  (`meta.messages`, suggestions, `meta.docs`, the message-guidance contract
  test).
- **Envelope/hooks** — `scripts/lint-agent*`, `generate-lint-guidance.ts`,
  `scripts/ai-hooks/` (tidy, lint-coverage-check, ratchet-regression-check,
  failure-guidance), hook wiring via `harness.controls.json`.
- **Ratchet** — `scripts/lint-ratchet/` diagnostics, baseline-update
  outcomes, registry preflight, merge driver, debt accounting,
  zero-baseline lifecycle.
- **Gates** — `.husky/*` hooks, `scripts/verify*`, wrapper scripts
  (lint/format/typecheck/suppression registers), the Claude commit-output
  layer.
- **Sensors** — coverage-map checks, knip baseline, freshness sensors,
  path-policy, audit-lane scripts (`licenses`, `logs-audit`, `blob-size`,
  sunset watchdogs, `migration-safety-scan`, `doctor`).

Synthesis by Fable, with spot-verification of the highest-impact claims
before the pack was written.

## Verified against HEAD (2026-07-05)

- `eslint-rules/concurrency-guard.js` — message text names
  `docs/CONCURRENCY.md` (line 165) while `pairedGuide` (line 159) is
  `docs/guides/add-race-sensitive-mutation.md`. Confirmed by grep → leaf 12.
- `scripts/ai-hooks/commit-output.sh` and `git-commit-quiet.sh` contain no
  fast-commit awareness (negative-evidence grep for `fast.commit`), so the
  agent-facing success summary cannot mention skipped slots → leaf 10.
- `scripts/lint-shell.sh:136` hardcodes `apt install shellcheck`; the dev
  container is Fedora → leaf 46.
- `.husky/pre-commit:185-192` — generated-surface staleness checks are
  `warn_if_generated_surface_stale` (advisory) and fire only when files
  matching `generated_pattern` are staged.
- `scripts/tests/test-test-scripts.sh:92` — the scripts slot compares live
  smoke-test discovery against the generated
  `scripts/fixtures/test-scripts/all-smoke-tests.txt` fixture (see the
  corrected claim below).

Everything else is report-sourced (Confidence: med in the leaves);
reconfirm before editing.

## Corrected claim

The sensors agent claimed new-smoke-test registration drift "passes every
local gate and only surfaces in CI". Wrong as stated:
`test-test-scripts.sh` fails the local `scripts` slot when the
`all-smoke-tests.txt` fixture is stale. The accurate residual gaps are
narrower: (a) the seven generated-surface freshness checks in pre-commit
are non-blocking WARNs gated on the generated files themselves being
staged, with full `harness:check` only in CI — a deliberate advisory-first
choice, parked; and (b) fast-commit mode skips the `scripts` slot entirely,
which is leaf 10's problem, not a registration problem.

## Strengths deliberately preserved (do not "fix" these)

Given the public harness-reference goal, these are the exemplars the pack
must not regress while editing nearby text:

- `eslint-rules/message-guidance.test.js` — every rule message is
  contract-tested for shape, caps, and action verbs. Leaves 20/24/47/48
  extend or work within it, never around it.
- Single-sourced recovery-command constants
  (`scripts/lint-ratchet/recovery-command.ts`) reused across diagnostics,
  report footer, and update refusals.
- The `status\tmessage` tab contract shared by `dependency-freshness.sh`,
  `prisma-client-freshness.sh`, `test-dist-preflight.sh`.
- The `"<tool> found drift:"` + grouped-bullets family
  (`lint-coverage-map-check`, `harness-check`).
- The sunset watchdogs (`check-fast-uri-override.sh`,
  `check-eslint-react-peer-exception.sh`) that enumerate every cleanup step
  including their own deletion.
- `ratchet-manifest-message.ts` — all registration sites enumerated in one
  failure; the bar the weaker registration messages are held to.
- `verify-logs --json`'s harness-diagnostics envelope — the most
  agent-friendly output in the gate stack.

## Deliberately not promoted

See "Considered, not promoted" in [`00-index.md`](./00-index.md) — each
entry there records the reason (deliberate design, needs a prior decision,
out of messaging scope, or unverified).
