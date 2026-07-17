# 64 — Authoritative harness map is still “awaiting owner sign-off”

Status: Done
Track: DOC (docs) · Priority: P3 · Size: XS

> **Confirmed — 2026-07-13 adversarial triage.** The public map and arch-review leaf carry the same draft marker. This leaf is public-facing hygiene that rides the existing substrate-ruling decision rather than reopening it.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `docs/ai-harness.md:151-153` — the substrate ruling is labeled drafted and awaiting owner sign-off.
- `docs/agent_notes/backlog/arch-review-2026-07/13-substrate-ruling-bash-vs-ts.md:3-5` — owner sign-off is the existing leaf’s completion signal.
- `docs/README.md:13-15` — `ai-harness.md` is presented as the authoritative harness map.

Failure: An unresolved draft marker inside the authoritative public inventory makes settled guidance look provisional.

## Do

Complete the owner decision in [arch-review leaf 13](../arch-review-2026-07/13-substrate-ruling-bash-vs-ts.md), then remove the draft banner from the public map; if sign-off remains unavailable, move the ruling out of the authoritative section.

## Verify

```
rg -n "Substrate Ruling|awaiting owner sign-off|Status: drafted" docs/ai-harness.md docs/agent_notes/backlog/arch-review-2026-07/13-substrate-ruling-bash-vs-ts.md
```

## Acceptance

- The public map contains either a signed-off ruling or no provisional ruling.
- The arch-review leaf and public status agree.
