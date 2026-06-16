# drift:ai detector noise-tuning (optional)

Status: Advisory — NOT one of the actionable code issues in this folder.
Created: 2026-06-13

These are recurring false-positive / low-signal classes the widest-net audit
surfaced. They do not change product or tooling code; they tune the **drift:ai
detectors / target configs** so future runs are higher-signal. Apply only if you
agree with the framing — several are judgement calls.

> Detector *engine* work (new behavior, calibration) has its own backlog in
> [`../drift-ai-next-items/`](../drift-ai-next-items/00-index.md); the two starred
> items below are engine improvements that could be filed there.

## Proposed config suppressions

### `duplicate-schemas` — excludeGlobs

Deliberate nominal SRD reference types ({id,name,description}) interleaved with legitimately-diverging siblings; flagging them as duplicates is noise. Exclude the file (or bump minKeys above 3) to suppress next run.

Suggested value: `packages/shared/src/schemas/srd-reference.ts`

### `duplicate-types` — minProps

Several true-positive duplicate-types hits here are 3-property bags (BranchPointFunction, AssertTurnOpts). Keep the 4-field ones but a minProps bump would still catch them while dropping the lowest-signal 3-field nominal pairs; tune only if 3-field nominal types become a recurring false-positive class.

Suggested value: `raise from default to 4`

> Parallel-review caution (Codex): do **not** raise `minProps` to 4 blindly — it would
> suppress real 3-field findings like 14 (`BranchPointFunction`) and 28
> (`AssertTurnOpts`), both confirmed true positives and fixed. Only consider it if
> 3-field nominal pairs become a recurring false-positive class.

### `class-construction` — treat-test-fixtures

FakeTRPCError was reported as a zero-`new` candidate (dead-code signal) but is constructed 5x per file inside rejecting mutationFns; the detector's construction scan missed the call sites, producing a misleading dead-code framing on a real duplication finding.

Suggested value: `scan `new <Class>` across the whole file before reporting zero-construction`

### `near-duplicates` — report-granularity

The coldspots/hotspots family produced 4+ separate function-granularity findings (appendRowContext, loadBaseline, withContext, updateTouchDates) that are one logical 'share cross-family helpers' refactor; clustering near-duplicate functions within a sibling-module family would cut triage volume and avoid the synthesis-side re-merge.

Suggested value: `cluster by call-family / directory`

### `unused-exports` — knip.config.ts ignoreIssues

These modules carry explicit 'public facade'/'public surface' header comments, mirroring the packages/shared and components/ui ignoreIssues precedent. If the decision is to keep them as facades (route all consumers through the barrel), add the ignore to stop knip re-flagging the intentional re-export surface every run. If the decision is to trim, do NOT add the ignore — fix the code instead. The config.ts and lint-ratchet/codemod/check-metadata findings are genuine dead code and should never be ignore-listed.

Suggested value: `add 'scripts/drift-ai/{ghost-files,class-construction,birth-size-delta-advisory,dolos-runner}.ts': ['exports','types'] ONLY IF the team commits to the documented-facade direction`

### `module-doc-paths` — resolveRelativeImports

Lens caught a wrong relative depth; keep enabled and verify resolved path exists.

Suggested value: `true`


## Notes

- The `unused-exports` / knip suggestion is **conditional**: only ignore-list the
  modules you decide to keep as public facades. The `config.ts`, `lint-ratchet`,
  `codemod`, and `check-metadata` dead-code findings (issues 03, 11, 12, 15, 20) are
  **genuine dead code** — fix the code, do not ignore-list them.
- ★ `class-construction — treat-test-fixtures` and ★ `near-duplicates —
  report-granularity` are really **drift:ai engine improvements** (a missed
  construction-scan call-site producing a misleading dead-code framing, and
  function-granularity findings that should cluster per sibling-module family).
  Consider filing them in `drift-ai-next-items/` rather than treating them as config.
