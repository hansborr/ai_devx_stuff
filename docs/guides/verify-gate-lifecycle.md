# Commit-Gate Lifecycle

This walkthrough follows one source-relevant edit through Musi's normal commit
gate. It describes the maintained wiring for visitors; the hook, generated
steps, manifest, and diagnostics schema remain the authorities.

The full path below runs when the staged source change has no fresh matching
verification marker. Documentation-only commits can skip source checks, and a
fresh fingerprint-matched marker can safely reuse prior results.

```text
edit + stage
    → Husky pre-commit policy adapter
    → verify-engine gate lifecycle
    → generated pre-commit slots
    → per-slot log + diagnostics envelope
    → failure excerpt with repair text
    → fix, stage, and retry
```

### Where each mechanism lives

Every gate script reaches this shared metadata API by sourcing the single
aggregator [`scripts/lib/verify-metadata.sh`](../../scripts/lib/verify-metadata.sh);
it defines nothing itself and sources six single-concern leaf libs beside it.
Use this map to jump from a stage described below to the file that implements
it — but keep sourcing the aggregator, never a leaf.

| Concern | Lib | Sections |
| --- | --- | --- |
| Repo/worktree identity, fingerprints, the `musi_standard_*` state/log/lock paths and the pre-commit marker, the `MUSI_GATE_*` timing budgets | [`verify-state-paths.sh`](../../scripts/lib/verify-state-paths.sh) | [1](#1-edit-and-stage), [4](#4-read-the-failure-as-feedback), [5](#5-classify-timing-before-setting-a-budget) |
| Waiter tickets on the shared commit-queue lock | [`verify-commit-queue.sh`](../../scripts/lib/verify-commit-queue.sh) | [1](#1-edit-and-stage), [5](#5-classify-timing-before-setting-a-budget) |
| Fast-commit provenance log, pending marker, toggle tripwire | [`verify-fast-commit.sh`](../../scripts/lib/verify-fast-commit.sh) | [1](#1-edit-and-stage) |
| Success-marker codec, the `verify:changed` and full verify marker paths, land-time re-stamp, verify → pre-commit bridge | [`verify-markers.sh`](../../scripts/lib/verify-markers.sh) | [1](#1-edit-and-stage), [4](#4-read-the-failure-as-feedback) |
| Path-policy query bridge, staged classification, staged/pre-commit fingerprints | [`verify-path-policy.sh`](../../scripts/lib/verify-path-policy.sh) | [1](#1-edit-and-stage) |
| Run-meta shims over the TS codec: step/wrapper fragments, history, combine | [`verify-run-meta.sh`](../../scripts/lib/verify-run-meta.sh) | [2](#2-follow-generated-authority) |

## 1. Edit and stage

The gate evaluates the staged change. Before running checks,
[`.husky/pre-commit`](../../.husky/pre-commit) rejects source-relevant unstaged
or untracked work so the verified tree cannot differ silently from the intended
commit. It also reads every source-relevant staged add, copy, modify, or rename
blob directly from the index and rejects literal NUL bytes before source-skip
or verification-marker shortcuts. Both selections — and the definition of
"source-relevant" they share with the path policy — come from
[`verify-path-policy.sh`](../../scripts/lib/verify-path-policy.sh).

Running `git commit` invokes that Husky hook. The hook takes the verification
and shared commit-queue locks, checks whether a recent success marker matches
the current HEAD plus staged-content fingerprint, and starts the gate when no
safe marker can be reused. The lock and marker paths are worktree-keyed by
[`verify-state-paths.sh`](../../scripts/lib/verify-state-paths.sh) (the
commit-queue lock deliberately keys off the Git common dir instead, so every
worktree of a repo queues against the same lock), the waiter tickets that let a
queued lane report its depth come from
[`verify-commit-queue.sh`](../../scripts/lib/verify-commit-queue.sh), and the
marker read/match/write codec is
[`verify-markers.sh`](../../scripts/lib/verify-markers.sh).

The hook remains the policy adapter: it visibly owns protected-branch policy,
advisories, changed-input preflight, fast-commit provenance, and the bounded
30-second memory-deferral policy. It passes a named policy map to
[`musi_verify_run_gate`](../../scripts/lib/verify-engine.sh), which owns the
shared lock, marker, bridge, log, signal, slot-dispatch, aggregation, metadata,
and finalization lifecycle. [`scripts/verify.sh`](../../scripts/verify.sh) is
the manual policy adapter for the same entry point; it selects full, parallel,
or changed mode and supplies the corresponding generated consumer and identity
providers.

When the shared fast-commit marker is active, a source-relevant commit has one
additional admission step. The shared state behind that mode — the
cross-worktree provenance log of commits made with slow slots deferred, the
per-worktree pending marker, and the tripwire that makes the hand-managed
toggle's disappearances attributable — is
[`verify-fast-commit.sh`](../../scripts/lib/verify-fast-commit.sh). After the
unstaged/untracked rejection and source selection, the engine takes its normal
locks and snapshots fast mode once. That snapshot controls admission,
fingerprint identity, slow-slot resolution, and fast-debt provenance even if
another worktree changes the shared marker while the gate is running. The
engine then initializes the log directory, fingerprint, signal cleanup, and
watchdog, and runs `bun run harness:registration:check` with a 45-second
default sub-timeout.
`MUSI_PRECOMMIT_REGISTRATION_TIMEOUT` accepts a positive whole-second override
as bare digits without a suffix or leading zero (for example, `30`); invalid
values exit 2 before gate dispatch. The
registration command is non-spawning: it checks manifest/package/verify/lint/
doctor/generated-surface/skill structure through the same typed collector used
by full `harness:check`. A stable successful fingerprint is required before
either a native pre-commit marker or a manual-verify bridge can short-circuit.
Failure is reported once through `registration.log`; that log is admission
evidence, not a behavioral verify slot, and does not change fast-commit debt
provenance. Normal mode and documentation-only fast commits do not run the
admission command. Before admission clears the live log directory, the engine
backs up its complete prior contents. Marker and bridge hits, admission
failures, and admission-time signal/timeout exits restore all prior slot logs,
metadata, timings, and diagnostics while retaining the current
`registration.log`; only a real behavioral run replaces that evidence.

## 2. Follow generated authority

The hook sources
[`scripts/verify/steps.generated.sh`](../../scripts/verify/steps.generated.sh)
and runs its `MUSI_PRE_COMMIT_STEPS` set in parallel. That file is generated
from verify-slot controls in [`harness.controls.json`](../../harness.controls.json);
do not copy a slot list into contributor documentation. The manifest's ordered
catalog and gate profiles own which slots exist, their consumer-specific
commands, and the reasoned differences between pre-commit, manual changed
verification, and full verification; the generator validates and renders that
declaration.

Ordering between slots is declared the same way. A catalog entry may name a
build artifact it `produces`, and another may name the artifact it
`requiresArtifact`; the parallel runner probes each required artifact once
before launch and holds the requiring slots only while that artifact is
actually missing from the tree, releasing them as soon as its producer
succeeds. There is no slot-to-slot `dependsOn` and no scheduler graph: slots
name artifacts, never each other, so a gate that omits or replaces a slot
cannot invent an ordering edge. Artifact metadata affects parallel scheduling
only — the sequential runner consumes none of it and does not reorder slots to
honor an edge (`lint` runs long before `typecheck` in `MUSI_VERIFY_STEPS`), so
a requiring command must stay independently safe when run sequentially. Here
lint's own preflight in
[`lint-dist-preflight.sh`](../../scripts/lib/lint-dist-preflight.sh) is what
supplies that: it builds the dist outputs itself when they are absent.
Artifact ids are a closed repo-side vocabulary in
[`verify-step-artifacts.ts`](../../scripts/harness/verify-step-artifacts.ts),
which binds each id to a hand-written shell probe exactly the way dynamic
resolver ids bind to resolver functions, and rejects at generation time an
unknown id, a required artifact no slot in that program produces, two
producers for one artifact, a slot requiring what it produces, a slot that
produces one artifact while requiring another (edges are one conditional hop,
never a chain), and a producer the gate's fast-commit mode would skip. The edge
lives on the catalog entry rather than a command body, so a changed-mode
replacement or a gate override cannot silently drop a slot out of the deferral
set — restating it in a body is a generation-time failure. A copy of this
harness that declares no artifact edges generates empty maps and never enters
the deferral path at all; an *absent* map is a different thing entirely, so
`steps-lib.sh` refuses to source against a `steps.generated.sh` that predates
artifact edges rather than reading it as "no edges declared". If a declared
edge cannot be honored at runtime — no probe function bound, or the bound
function missing from the sourced libraries — the runner aborts before any slot
launches and the engine fails the gate on that status; a regeneration problem
never becomes a green gate that ran nothing.

Each slot writes a named log under the verification log directory. The ratchet
slot additionally sets `HARNESS_DIAGNOSTICS_OUTPUT` to
`ratchet-diagnostics.json`, so its machine-readable result and its ordinary log
describe the same run. Alongside the logs, each slot and the wrapper write
run-meta fragments that are combined into `run-meta.json` at the end of the run;
those shims — and the pruned per-run history behind `verify:logs` — are
[`verify-run-meta.sh`](../../scripts/lib/verify-run-meta.sh), a thin bash layer
over the TS codec
[`verify-metadata-core.ts`](../../scripts/lib/verify-metadata-core.ts).

## 3. One real control ID

Consider control ID
[`ratchet/local-no-arbitrary-tailwind-value-client`](../generated/harness-controls.md#ratchetlocal-no-arbitrary-tailwind-value-client).
Its registry entry freezes the accepted count of arbitrary Tailwind bracket
values in client source. A new matching value reaches the generated `ratchet`
slot, which invokes `bun run lint:ratchet` during pre-commit.

The resulting [`HarnessDiagnostics`](../../tools/harness-diagnostics/src/schema.ts)
envelope identifies that exact control and includes the source path, rule ID,
baseline and current counts, `why`, `howToFix`, and `repairKind`. The schema
requires repair text for every finding; a codemod repair must also carry its
command.

For this manual-repair control, the local rule supplies a concrete replacement
hint—for example, use a Tailwind scale step or named `@theme` token—and the
ratchet appends the baseline recovery step. The generated controls reference
links the same control to its principle, guide, invocation, and repair kind.

## 4. Read the failure as feedback

When verification blocks, pre-commit separates completed `Passed:` slots,
unsuccessful `Failed:` gate work, and `Not run:` slots stopped by memory
admission before launch; either of the latter two categories blocks the gate.
Raw terminal excerpts cover `Failed:` slots only; `Not run:` diagnostics remain
in their per-slot logs and are surfaced by agent adapters.
Ratchet failures are excerpted from `ratchet-diagnostics.json`, preserving the
control ID and human-readable repair instead of reducing the result to an exit
code. Runtime-activated failures surface a start-of-run load/core sample in
terminal and agent summaries when capture succeeds; it is diagnostic evidence
only, never input to admission, budgets, slot classification, or the gate
verdict.

From the repository root, resolve the same worktree-scoped directory used by
the gate — `musi_standard_verify_log_dir` is one of the `musi_standard_*` path
helpers in [`verify-state-paths.sh`](../../scripts/lib/verify-state-paths.sh),
reached through the aggregator. Read the raw slot log directly, or render its
structured envelope as Markdown:

```sh
VERIFY_LOG_DIR="${MUSI_VERIFY_LOG_DIR:-$(bash -c \
  '. scripts/lib/verify-metadata.sh; musi_standard_verify_log_dir "$PWD"')}"
cat "$VERIFY_LOG_DIR/ratchet.log"
bun run lint:ratchet:report < "$VERIFY_LOG_DIR/ratchet-diagnostics.json"
```

Apply the stated repair, stage it, and retry the commit. If the added debt is
intentional, use only the reasoned acceptance command printed by the ratchet;
that updates the committed baseline and append-only debt log for review. A
successful retry writes a pre-commit marker that an identical near-term commit
attempt may reuse.

The manual-verification bridge flows in the other direction: when a fresh
`verify:changed` or full `verify` marker matches the current state, pre-commit
accepts that evidence and writes its own pre-commit marker. Manual verification
does not read or consume the pre-commit marker. The bridge predicate reports
three outcomes to the engine: hit, ordinary miss, or operational failure. An
operational fingerprint or marker-write failure stops the gate rather than
being treated as a cache miss. That predicate, and the land-time re-stamp that
carries a passing full-verify marker onto a `--no-ff` merge commit with an
identical tree, are `musi_try_verify_marker_bridge` and
`musi_restamp_verify_marker` in
[`verify-markers.sh`](../../scripts/lib/verify-markers.sh).

`bun run verify:changed` follows the same generated changed-mode authority when
you need a manual, staged pre-commit check without making a commit. It is a
fallback and troubleshooting entry point, not a second lifecycle.

## 5. Classify timing before setting a budget

This guide is the canonical timing doctrine for the gate. Implementation
comments record seam-specific evidence and budgets; see the
[`resolvedConfigTestTimeoutMs`](../../eslint-rules/eslint-config-resolution-timeout.js)
comment for an example. The four budgets shared across the gates — marker
freshness, the interactive watchdog default, the pre-push evidence window, and
the pre-commit registration hang guard — have a single definition as the
`MUSI_GATE_*` constants in
[`verify-state-paths.sh`](../../scripts/lib/verify-state-paths.sh); change a
window there, not at a call site.

- A **performance observation** may inform tuning or warn. Use elapsed time in
  a verdict only in an isolated, documented fixture where bounded completion is
  the contract, never as a proxy for non-timing correctness.
- A **hang guard** bounds work that may be deadlocked or looping. Calibrate it
  from representative same-gate measurements within a stated load envelope;
  record the measurements, envelope, and chosen margin. Keep it fixed,
  diagnostic, and inside the outer watchdog.
- A **resource-admission deadline** is queue/fairness policy, not an expected
  runtime. The hook's 30-second memory wait is intentionally shorter than the
  manual gate's 120-second wait because pre-commit holds the shared commit
  queue — the waiter tickets that make that queue's depth observable are in
  [`verify-commit-queue.sh`](../../scripts/lib/verify-commit-queue.sh).

The owner treats many simultaneous manual `verify` runs across worktrees as a
tolerated workload, not a supported one, because it can exhaust container
memory. Under that premise, memory admission declining to launch is protective
rather than merely inconvenient.

Synthetic-load probes must terminate themselves (for example, via `timeout` or
a bounded worker) rather than depend on a later cleanup command.

The review classified [leaf 03](../agent_notes/backlog/pain-points-2026-07-29/03-remove-load-sensitive-queue-timing-assertion.md)
as a performance proxy, [leaf 04](../agent_notes/backlog/pain-points-2026-07-29/04-retune-registration-admission-timeout.md)
as insufficient margin over cold/standalone observations, and
[leaf 05](../agent_notes/backlog/pain-points-2026-07-29/05-retune-actionlint-timeout.md)
as legitimate intra-gate contention. Orphaned synthetic-load spinners also
contaminated leaf 03. Memory admission already staggers heavy slots; adaptive
deadlines instead make the ceiling host-state-dependent and can prolong
orphan-load or CPU-burning failures. These incidents do not warrant CPU
arbitration or load-adaptive budgets; the failure-only starting-load line
records evidence without making any budget or deadline load-adaptive.
