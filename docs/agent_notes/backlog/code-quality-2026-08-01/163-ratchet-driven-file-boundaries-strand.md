# 163. A line-cap extraction strands generic repository behavior behind a sensor-specific module

Status: Landed on fix/cq-163
Theme: cohesive repository adapters · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`harness-freshness-io.ts` says it was extracted to keep another file below a
line limit, but the resulting boundary is not cohesive. It combines
harness-freshness-specific path collection with a generic `git check-ignore`
adapter and generic normalization helpers. A second analyzer reaches through
that sensor-specific module to reuse the Git behavior.

The shared adapter still hard-codes `harness-freshness` into both failure
messages. A `module-doc-paths` failure can therefore name the wrong analyzer,
sending a contributor to the wrong owner while debugging. The split also
duplicates reader and path-probe contracts that already have a neutral home and
creates a type-only dependency from the extracted module back into the sensor
that imports it.

The reusable Knip subprocess runner repeats the same ownership leak. Its
generic warning callback emits two messages hard-coded as `drift:ai`, so the
standalone unused-exports sensor has to parse and rewrite the human-facing
text. A wording or prefix change in the runner can leak the wrong command
identity or silently defeat that anchored replacement. The runner header also
still names only the original orphan-files adapter even though multiple
production callers now use it.

## Evidence

- `scripts/drift-ai/harness-freshness-io.ts:1-15` states that the file exists to keep the main module below an effective-line limit, imports types back from `harness-freshness.ts`, and re-exports generic defaults from `repo-io.ts`.
- `scripts/drift-ai/harness-freshness-io.ts:17-49` owns path normalization, trailing-slash handling, and the `git check-ignore` process; its error paths at `:38` and `:43` hard-code `harness-freshness`.
- `scripts/drift-ai/module-doc-paths.ts:20-30` imports `defaultPathIgnored` through the harness-freshness module while separately declaring `RepoFileReader`, `RepoPathProbe`, and `RepoPathIgnored`.
- `scripts/drift-ai/module-doc-paths.ts:147-153` calls that shared default for module-document candidates, so a Git failure from this path receives the harness-freshness label.
- `scripts/drift-ai/repo-io.ts:1-8` is already a neutral repository adapter defining `RepoFileReader`, `DirectoryListing`, `PathProbe`, and `PathExists`; `:14-63` provides the corresponding injectable default factories.
- `scripts/drift-ai/harness-freshness.ts:8-17` imports values from `harness-freshness-io.ts`, while `harness-freshness-io.ts:7` imports `BacktickPathReference` and `PathIgnored` back as types, leaving ownership circular even though the reverse edge is erased at runtime.
- `eslint-config/rule-groups.js:26-30` keeps the live repository-wide `local/max-lines` error floor at 300 effective lines, so any attempt to dissolve the extraction must account for the original size pressure.
- `scripts/drift-ai/knip-runner.ts:176-203` accepts a generic warning callback but hard-codes `drift:ai` into both the pre-spawn heartbeat and timeout explanation.
- `scripts/sensor-knip-unused-exports-core.ts:234-268` wraps that callback with an anchored `^drift:ai:` replacement to recover the standalone sensor’s command identity.
- `scripts/drift-ai/knip-runner.ts:1-3` still describes the runner as belonging to the orphan-files adapter even though it is also imported by the standalone sensor.

## Proposed direction

Move the generic ignore-probe behavior to a neutral repository adapter.
`defaultPathIgnored`, `parseIgnoredPaths`, `normalizeConfiguredPath`,
`stripTrailingSlash`, and the `PathIgnored` function type can join
`scripts/drift-ai/repo-io.ts`. Because that file currently wraps filesystem
operations only, a small flat sibling such as `repo-ignore.ts` is also an
acceptable owner for the Git subprocess boundary.

Make diagnostic identity a caller-supplied argument or option. The
harness-freshness caller should pass `harness-freshness`; the module-doc caller
should pass `module-doc-paths`, so both Git startup and nonzero-status failures
identify the analyzer that initiated them.

Apply the same caller-context contract to `defaultKnipRunner`. Require each
production caller to supply its command label, interpolate that label into the
existing start and timeout messages, and remove
`sensor-knip-unused-exports-core.ts`’s anchored `formatRunnerWarning` rewrite.
Refresh the runner header to describe the shared Knip subprocess boundary.
Preserve the silent default when no warning sink is supplied, the current
start-before-spawn ordering, timeout explanation, warning cadence, run result,
and memoization behavior.

Import the neutral `RepoFileReader`, `PathProbe`, and `PathIgnored` contracts in
`module-doc-paths.ts` instead of redeclaring them. Remove the extracted module’s
type-only import from `harness-freshness.ts`. Keep
`backtickPathIgnoreCandidates` sensor-side because it operates on
`BacktickPathReference`, a harness-freshness domain type.

Pin the adapter contracts with focused tests for ignored-path normalization and
both ignore-probe caller labels. Preserve the existing real-Git module-doc
coverage at `scripts/drift-ai/module-doc-paths.test.ts:212-231` and the
harness-freshness path semantics at
`scripts/drift-ai/harness-freshness.test.ts:172-183`. Extend the Knip runner and
standalone sensor coverage to assert both caller labels without coupling the
sensor to the runner’s complete message text.

## Scope / caveats

- Do not mandate deleting `harness-freshness-io.ts`. It may remain as a thin
  sensor-specific shim if the 300-line floor leaves insufficient headroom;
  otherwise it can disappear once only neutral imports remain. Follow
  [the lint-ratchet guide](../../../guides/lint-ratchet.md) before changing any
  ratcheted policy or baseline to accommodate the move.
- CQ25-146 requires `scripts/drift-ai/` to remain flat. Extending `repo-io.ts` or
  adding one flat `repo-ignore.ts` sibling complies; creating adapter
  subdirectories would reopen the rejected restructuring in
  [28-PLAN.md](../code-quality-2026-07-25/28-PLAN.md).
- Preserve `git check-ignore --stdin -v`, candidate deduplication and sorting,
  exit-status handling, trailing-slash normalization, and ignore decisions.
  This leaf changes ownership and diagnostic context, not sensor findings.
- If `repo-io.ts` remains intentionally filesystem-only, prefer the neutral
  sibling rather than obscuring that boundary with a child-process dependency.
- There is no `MODULE.md` or `*-MODULE.md` under `scripts/drift-ai/` at the pin today. Prior-pack [28-PLAN.md](../code-quality-2026-07-25/28-PLAN.md) slice 28.2 is scheduled to add `scripts/drift-ai/MODULE.md`; if that slice lands first, refresh the module document as part of this relocation.
- Prior-pack CQ25-41’s sensor-family move in
  [28-PLAN.md](../code-quality-2026-07-25/28-PLAN.md) preserves the public
  `sensor-knip-unused-exports` facade but does not correct the imported runner’s
  label. Coordinate the internal sensor edit with that move and retain the
  facade.
- [137-knip-check-reparses-same-cached-report.md](./137-knip-check-reparses-same-cached-report.md)
  also edits `knip-runner.ts`. There is no logical ordering dependency, but do
  not work the two concurrently; apply caller-neutral diagnostics to the
  runner surface left by whichever change lands first.
- Keep `scripts/drift-ai/` flat and preserve the shared-to-server-to-client
  package flow. Caller-neutral formatting must not grow into directory
  restructuring, Knip cache changes, or warning-policy changes.
