# 209. Remove the unused repository-root parameter from blame parsing

Status: Landed on fix/cq-209
Theme: Blame parsing threads an unused repository-root dependency · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The stale-marker blame parser requires callers to provide both an injected Git
runner and a repository root even though parsing and invocation use only the
runner and path. Repository anchoring therefore appears to be shared between
two parameters when it is actually owned entirely by construction of the
default runner.

This false dependency adds noise to every call and test fixture and makes the
parser's execution boundary harder to see. A future caller can reasonably
assume `blameLineIntroductions` uses or validates the supplied root when it
silently ignores it.

The adjacent coldspot aggregation has the same kind of unread state:
`FileAggregate` accumulates added lines and an oldest-touch bound even though
the coldspot calculation consumes neither. Those writes obscure the two
distinct dates the lens actually needs: `newestTouchMs` for age and `birthMs`
for earliest-commit selection.

## Evidence

- `scripts/drift-ai/coldspots-blame.ts:29-36` — `defaultBlameGitRunner`
  captures `repoRoot` as the subprocess `cwd`, which is the actual repository
  anchoring boundary.
- `scripts/drift-ai/coldspots-blame.ts:45-49` —
  `BlameLineIntroductionsOptions` nevertheless requires `repoRoot` beside the
  Git runner and path.
- `scripts/drift-ai/coldspots-blame.ts:53-68` — the public function delegates
  to `runBlame`, which reads only `options.git` and `options.path`; the root is
  never consumed.
- `scripts/drift-ai/coldspots-stale-markers.ts:122-129` — the stale-marker
  reducer passes both its already anchored Git runner and the redundant root
  into `blameLineIntroductions`.
- `scripts/drift-ai/coldspots-aggregate.ts:10-20` — `FileAggregate` declares
  both `added` and `oldestTouchMs` alongside the live `newestTouchMs` and
  `birthMs` fields.
- `scripts/drift-ai/coldspots-aggregate.ts:23-58` — aggregation initializes both
  unread fields; the first occurrence of each path in a record calls
  `updateTouchDates`, and every file row increments `added`.
- `scripts/drift-ai/coldspots-coldspot.ts:81-84` — the population age
  calculation reads `newestTouchMs`, not `oldestTouchMs`.
- `scripts/drift-ai/coldspots-coldspot.ts:138-174` — row qualification and
  output again use `newestTouchMs`; surfaced rows expose revisions and churn,
  not `added` or `oldestTouchMs`.
- `scripts/drift-ai/coldspots-aggregate.ts:61-76` — earliest-commit selection
  is independently represented by `birthMs` and must remain intact.
- Measured with
  `git grep -n -E 'aggregate\.(added|oldestTouchMs)\b' ebf096580b31f604861fadb3d4cbd4079da4f017 -- 'scripts/drift-ai/coldspots-*.ts'`:
  the only direct access is the `aggregate.added` write at
  `coldspots-aggregate.ts:41`; neither field has a downstream direct read.

## Proposed direction

Remove `repoRoot` from `BlameLineIntroductionsOptions` and from every
`blameLineIntroductions` object literal. The public parser should accept only
the injected `git` runner and repository-relative `path`.

Retain `repoRoot` on `defaultBlameGitRunner(repoRoot)`, where it is needed to
construct the subprocess runner with the correct `cwd`. Update nearby comments
so they identify runner construction, rather than the parser call, as the
anchoring step.

Also remove `FileAggregate.added` and `FileAggregate.oldestTouchMs` from the
type, initializer, and per-row aggregation.
Because the shared `updateTouchDates` helper requires both bounds, replace its
coldspot call with a newest-only update that retains the current finite-date
check and maximum-timestamp behavior. Do not weaken the shared helper used by
the thrash lens.

Keep `newestTouchMs` as the age input and preserve `birthMs`,
`birthFileCount`, and `birthLinesAdded` as the earliest-commit state. Adjust
coldspot tests to cover age and birth selection across multiple timestamps.

Adjust the coldspots blame and stale-marker tests to omit the dead fixture
field. Preserve their assertions over the exact blame arguments, porcelain
parsing, metadata reuse, and empty-map degradation when Git throws.

## Scope / caveats

- Do not move subprocess execution into the parser or replace the injected
  `GitRunner` seam; this proposal only removes a parameter the parser does not
  read.
- Preserve the `--line-porcelain`, `HEAD`, `--`, and repository-relative path
  arguments, the enlarged buffer, stderr suppression, and the current
  failure-to-empty-map behavior.
- Leave the stale-marker cost and blobless-clone gates unchanged. They decide
  whether the already anchored runner is invoked and are unrelated to the
  redundant option field.
- Do not remove or change `hotspots-history.ts`'s shared
  `oldestTouchMs`/`newestTouchMs` fold: the coldspot aggregate should stop using
  it, while other lenses that read both bounds retain their current behavior.
- Preserve coldspot age, birth-burst, churn, qualification, and output
  semantics; only unread aggregate state and its writes are in scope.
- No prior-pack record covers either dead-state residual.
