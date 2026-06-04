# drift-ai next-items inventory second pass

Date: 2026-06-02

Reviewed `docs/agent_notes/backlog/drift-ai-next-items/` against the live
`drift:ai`/diagnostics code, the prior brainstorm, current findings, and harness
docs. The pack was already broadly well organized; this pass tightened hidden
multi-surface tasks and added a few missing operational leaves.

Durable changes:

- Added task 10a for a sidecar-only diagnostics writer helper. `lint:ratchet`'s
  existing helper writes diagnostics to stdout too, so `drift:ai` and
  `logs:audit` need a small shared sidecar helper before tasks 11 and 12.
- Split coverage work into parser/config evidence (42a), standalone advisory
  rendering (42c), and unused-export correlation (42b).
- Split env/feature-flag work into evaluator calibration (43a) and advisory
  integration (43).
- Split never-instantiated class work into class construction evidence inventory
  (48a) and advisory integration (48).
- Added governance/operator leaves for portable JSON contract fixtures (53),
  effective config inspection (54), and field-run calibration cadence (55).
- Updated the index, recommended order, shared context, and live-seams note so
  future agents see the one-session split points before implementation.

Validation: docs-only change; `git diff --check`.
