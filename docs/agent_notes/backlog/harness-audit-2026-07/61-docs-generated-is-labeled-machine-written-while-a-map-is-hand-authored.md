# 61 — `docs/generated/` is labeled machine-written while a load-bearing map is hand-authored

Status: Done
Track: DOC (docs) · Priority: P2 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** The landing-page contract directly contradicts the map’s self-description. This extends the existing generation leaf rather than creating a second implementation path.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `docs/README.md:34-35` — the generated directory is described as machine-written and never hand-edited.
- `docs/generated/lint-coverage-map.md:13-18` — the load-bearing coverage map says it is hand-derived from `git ls-files` and discusses a future generator.

Failure: Readers treat the directory as safely regeneratable truth while one of its central maps still depends on manual updates.

## Do

Land this contract correction with [harness-explore leaf 13](../harness-explore-2026-07/13-generate-lint-coverage-map.md): generate the map, move it out of `docs/generated/`, or explicitly list it as a hand-maintained exception until generation lands.

## Verify

```
bun run docs:lint-guidance:check && bun run docs:lint-coverage-map:check
```

## Acceptance

- The directory contract and map authorship no longer contradict each other.
- The index links the existing generator leaf as the implementation owner.
