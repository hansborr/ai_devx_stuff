# 16. The typed `report-only`/`ratchet-down` modes are rejected at runtime — implement report-only (plus a `--propose` dry-run) or delete the vocabulary

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: ratchet · Area: cli · Severity: med · Size: S-M · Confidence: high
Theme: mode-vocabulary · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
`LintRatchetMode` is typed as `"no-new" | "ratchet-down" | "report-only"`, the `mode` and `target` fields are parsed from the baseline, hashed into `configHash`, and re-validated — but registry validation hard-rejects everything except `"no-new"` with "mode X is reserved but not implemented". An adopter (this design is explicitly packaged for reuse via `docs/guides/lint-ratchet-adoption.md`, which tells adopters to keep the exported types) who writes `mode: "report-only"` gets a clean typecheck and a runtime registry failure. Similarly `target` is validated as a non-negative integer but nothing ever reads it for gating — every current entry says `target: 0` and the value is inert. Reserved vocabulary that typechecks but explodes at runtime is a trap; either make report-only real (it is genuinely useful: a "candidate ratchet scout" that measures a rule's debt without gating) or remove the words.

Correction found during verification: the adoption guide itself does NOT advertise these modes — its examples all use `mode: "no-new"` (`lint-ratchet-adoption.md:107`) and the words `report-only`/`ratchet-down` appear nowhere in either guide. The trap lives purely in the exported type union and the baseline schema, not in the docs. The leaf stands, but the "adopters following the guide" framing from the review was wrong.

## Evidence
- `/workspace/scripts/lint-ratchet/lint-ratchet-config.ts:17` — `export type LintRatchetMode = "no-new" | "ratchet-down" | "report-only";`; `:47-48` — `mode`/`target` on every entry.
- `/workspace/scripts/lint-ratchet/registry-validation.ts:20` — `IMPLEMENTED_MODES = new Set<LintRatchetMode>(["no-new"])`; `:263-264` — `mode ${ratchet.mode} is reserved but not implemented` (the "~line 263" citation holds exactly).
- `/workspace/scripts/lint-ratchet/baseline-hash.ts:113,116` — `mode` and `target` participate in `configHash`, so implementing them later churns every baseline hash *only* for entries that change mode — safe.
- `/workspace/scripts/lint-ratchet/registry-validation.ts:280-283` — `target` validated but never consumed by the comparator (`lint-ratchet-baseline-compare.ts` has no reference).
- CLI extension seams for the dry-run: `cli.ts:39-48` (mode flag map), `:128-134` (value-consuming flags).

## Proposed direction
Pick one, in this order of preference:
1. Implement `report-only` (S-M): entries with this mode are collected like any other (reusing `collectCurrentById`) but are excluded from regression/improvement gating and from the committed baseline; the default run prints their per-ratchet totals and emits them as `info`-severity findings in the harness-diagnostics envelope, never failing the run. That gives teams a zero-risk way to watch a rule's debt for a few weeks before flooring it. Leave `ratchet-down` rejected (its semantics — scheduled decreasing targets consuming `target` — are a bigger design) but downgrade the message to say which modes ARE implemented.
2. If not implementing: delete `"ratchet-down" | "report-only"` from the union and the `IMPLEMENTED_MODES` indirection so the type system carries the truth.
Independently useful either way: `lint:ratchet -- --propose <ruleId> <glob...>` — a dry-run that builds an ad-hoc single-entry config, runs one collection, and prints the would-be baseline (file count, total findings, top offending files) WITHOUT touching the registry or baseline. Restrict v1 to core and local rules (third-party needs allowlist/pluginModule input; accept an optional `--plugin <module>` later).

## Scope / caveats
- Report-only entries must not create baseline `tests` entries, or the strict registry↔baseline bijection (`baseline-validation.ts:119-123` requires every registry id in the baseline) needs a carve-out — decide explicitly and test both directions.
- `--propose` and the mode work are two separate commits; each is small. If option 2 (delete) is chosen, it is a one-commit type/validation/docs cleanup.
- Whichever option lands, update `docs/guides/lint-ratchet.md` Commands and the adoption guide so the exported vocabulary and the runtime agree.
