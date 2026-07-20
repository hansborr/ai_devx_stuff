# Make lib/git.ts the git-exec seam — grow, ratchet, then migrate opportunistically

Status: Done — implemented 2026-07-19 (phase 1; remaining caller migrations stay opportunistic).
Date: 2026-07-19
Source: 2026-07-19 harness architecture review, candidate 5 (session
artifact; claims verified against HEAD 544a9d06 the same day); design
calls consulted with Fable 5 + Codex 2026-07-19 — both ruled "split it",
rulings folded in below.
Size: S-M (phase 1, scheduled); phase 2 is opportunistic drain-lane work.

## Evidence

`scripts/lib/git.ts` is 205 lines with 9 exports and only 4 importers,
while 22 script files spawn `git` directly. The clearest duplication:
`git show HEAD:<path>` is implemented 3 times (the `lib/git.ts`
consumers, baseline-io, and the drift-ai birth-size-delta). The module
fails the deletion test today — deleting it would barely dent the
repo's git-exec surface, because most callers never route through it.

The 22-vs-4 count is precisely why "migrate everything" is the wrong
shape and why the seam needs a regression guard: without one, the seam
erodes faster than any scheduled migration fills it; with one, the bulk
migration can safely be opportunistic.

## Phase 1 (scheduled)

1. **Semantic caller inventory FIRST** (Codex ruling). Classify the 22
   direct-spawn call sites by semantics, not raw count:
   - UTF-8 text output vs buffer/binary output;
   - throw-on-failure vs nullable/status-returning failure contract;
   - cwd behavior;
   - test-fixture git setup;
   - deliberately injected `GitRunner` adapters.

   The last two categories **stay off the seam**: test-fixture setup and
   injectable `GitRunner` adapters are legitimate at their own seam and
   must not be forced through a string-returning, throwing wrapper
   merely to improve an importer count.

2. **Grow the seam with proven primitives only**: ref/blob read
   (`git show HEAD:<path>`), changed-scope helpers, and the duplicated
   default-runner shapes the inventory surfaces.

3. **Retire the duplicate git-show copies** — baseline-io and the
   drift-ai birth-size-delta — plus a few representative production
   callers, so the seam has real consumers before phase 2 starts.

4. **Acceptance criterion** (Fable ruling): a no-new-bypassers tripwire
   in the repo's lint-ratchet idiom — a ratcheted count of direct `git`
   spawns under `scripts/` outside `lib/git.ts`. This is an acceptance
   criterion for phase 1, not a follow-up: the repo's own idiom converts
   "migrate once" into "migrate once and can't regress".

## Phase 2 (opportunistic)

The remaining mechanical migrations are drain-lane fodder: migrate a
caller when a lane is already touching that file. This is explicitly
NOT a bulk sweep — the ratchet makes bulk timing unimportant.

Explicitly out of scope in both phases: a generic "run arbitrary git
argv" wrapper. It would relocate complexity into the seam rather than
deepen it (Codex ruling); the seam grows named, typed primitives only.

## Constraints

- The baseline-io migration swaps the git call ONLY. Its neighborhood
  is the contested near-duplicates baseline merge
  (arch-plans-2026-07/04-sensor-baseline-single-shape.md — Proposed,
  codex reject dissent recorded, deliberately not scheduled). Do not
  restructure the module or reopen that merge by stealth.
- file:line and count facts above verified 2026-07-19 at HEAD 544a9d06;
  they drift fast — re-verify before coding.

## Phase-1 implementation inventory (re-verified 2026-07-19)

At `341505fc`, 23 TypeScript files under `scripts/` directly call a Node
child-process API with literal `"git"`; excluding `scripts/lib/git.ts` leaves
the specified 22 bypassing files. Their semantic contracts are:

| Contract | Files | Disposition |
| --- | --- | --- |
| UTF-8, throwing, cwd-bound injectable runners (some with per-call caps or larger buffers) | `drift-ai/{bounded-full-history,coldspots-blame,hotspots-history,suppressions}.ts` | Keep the injectable adapter seam; do not force these through the basic string runner. The birth-blob caller may still consume the named ref/blob primitive. |
| Buffer/binary, throwing, cwd-bound injectable runner | `drift-ai/current-inventory.ts` | Keep the binary adapter seam; a string-returning runner would corrupt its NUL-delimited inventory contract. |
| UTF-8 status/nullable production probes | `drift-triage/drift-triage-packet-io.ts`, `drift-ai/harness-freshness-io.ts` | Preserve the explicit status/error contracts; do not replace them with the throwing runner. |
| UTF-8 or buffer production commands that catch/map failures locally | `backlog-lint.ts`, `logs-audit/logs-audit-latest.ts`, `sensor-blob-size.ts`, `sensor-near-duplicates-{baseline-io,core}.ts` | Eligible for named seam primitives when their current cwd, output, and failure mapping remain intact. |
| Test-fixture repository setup or committed-fixture inspection | `drift-ai/{current-inventory,near-duplicates,prototype-subcommands}.test.ts`, `drift-triage/drift-triage.test.ts`, `lint-coverage-map-check.test.ts`, `lint-ratchet/{baseline,check-registry,output}.test.ts`, `sensor-blob-size.test.ts`, `test-support/tmp-repo.test-helper.ts` | Keep direct fixture git setup/inspection; the ratchet freezes these accepted bypasses but migration is not required. |

This classification is by caller contract rather than raw process-call count:
several files contain multiple direct calls, and `sensor-blob-size.ts` contains
both a buffer read and a UTF-8 scalar read. The phase-1 ratchet therefore uses
per-file message counts, so either a new bypassing file or another direct spawn
in an accepted file is a regression.
