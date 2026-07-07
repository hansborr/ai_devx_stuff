# 20. Heap policy lives in verify.sh only — pre-commit still runs the same slots at default V8 heap, and stale guidance tells humans to hand-set it

Status: Done — implemented on 2026-07-04 with shared `scripts/lib/gate-env.sh` sourced by local gates and exported through `$GITHUB_ENV` for CI gate steps.
Lens: pipeline · Area: gate environment · Severity: high · Size: M · Confidence: high
Theme: performance-reliability · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
`verify.sh` self-applies `NODE_OPTIONS=--max-old-space-size=6144` (all three
modes) and `.husky/pre-push` sets it explicitly — but `.husky/pre-commit`
sets nothing, so its parallel slots (including a config-triggered full-scan
escalation of `lint:changed` to `eslint .`, concurrent with tests and
typecheck) run at the default heap. That is precisely the recorded field
failure: full ESLint OOMing at ~4GB during a concurrent gate, worked around
by hand-exported NODE_OPTIONS. Meanwhile `scripts/ai-hooks/failure-guidance.sh`
still tells the operator to hand-set the variable, cementing the workaround
instead of fixing the policy.

## Evidence
- `scripts/verify.sh:57-69` — self-applied heap for verify modes. Verified 2026-07-04 (Explore trace).
- `.husky/pre-commit` — no NODE_OPTIONS anywhere (grep-verified); parallel slot launch at `:363-393`; full-scan escalation path `scripts/lint-changed.sh:38-51,102-105`.
- `.husky/pre-push:128-130`, `scripts/land.sh:38-42` — per-site duplication of the setting.
- `scripts/ai-hooks/failure-guidance.sh:133-134` — stale hand-set advice. Verified (Codex lane C + verification agent).

## Proposed direction
Create one sourced helper (e.g. `scripts/lib/gate-env.sh`) that computes and
exports the gate NODE_OPTIONS (respecting a caller's larger explicit value,
as verify.sh already does) and source it from `.husky/pre-commit`,
`verify.sh`, `.husky/pre-push`, `land.sh`, and the async-verify wrapper.
Update failure-guidance.sh to say the heap is managed and point at the
helper. Consider sizing down for changed-mode (small file sets don't need
6GB) only if measurement shows memory pressure from parallel slots.

## Scope / caveats
- CI: check whether the workflow needs the same export for `bun run lint` on
  its runner class; keep the value in exactly one file either way.
- Follow-through: the recorded full-gate field pain includes two flaky steps
  (`eslint-config-plugin`, `test-dependency-freshness`) alongside the OOM;
  after landing, re-run that combo and either declare the flakes subsumed
  (memory-pressure symptoms) or file them as their own leaf.
- One commit: helper + call sites + guidance text.
