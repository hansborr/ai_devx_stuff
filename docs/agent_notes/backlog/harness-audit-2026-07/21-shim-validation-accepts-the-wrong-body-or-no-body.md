# 21 — Shim validation accepts the wrong body—or no body

Status: Done
Track: T (tooling) · Priority: P2 · Size: M

> **Confirmed — 2026-07-13 adversarial triage.** The verifier confirmed both blind spots: Claude/Codex shims without an `exec` are skipped, and an arbitrary existing target is accepted; Copilot likewise proves only that some body is present.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/ai-hooks/README.md:7` — shared bodies are the declared authority behind thin harness shims.
- `scripts/ai-hooks/check-wiring.sh:19` and `scripts/ai-hooks/check-wiring.sh:35` — a shim with no `exec` is explicitly skipped via `grep '^exec ' || true`.
- `scripts/ai-hooks/check-wiring.sh:29` — any existing body target satisfies the adapter check.
- `scripts/ai-hooks/check-wiring.sh:49-69` — Copilot validation requires some body but not the canonical body for that event.
- `scripts/harness-check.ts:227-232` — `harness:check` treats this script as the structural wiring assurance.

Failure: A safety shim can become `exit 0` or point at an unrelated shared body while generated configs and `harness:check` remain green.

## Do

Model each adapter and canonical body explicitly, preferably from manifest wiring, and require exactly one matching edge. Reject zero-target, multi-target, wrong-target, and unreferenced adapters.

## Verify

```
bash scripts/ai-hooks/check-wiring.sh && bun run harness:check
```

## Acceptance

- Every wired shim resolves to exactly its declared canonical body.
- Zero-body and wrong-existing-body fixtures fail the structural check.
