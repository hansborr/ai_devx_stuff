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

## 1. Edit and stage

The gate evaluates the staged change. Before running checks,
[`.husky/pre-commit`](../../.husky/pre-commit) rejects source-relevant unstaged
or untracked work so the verified tree cannot differ silently from the intended
commit.

Running `git commit` invokes that Husky hook. The hook takes the verification
and shared commit-queue locks, checks whether a recent success marker matches
the current HEAD plus staged-content fingerprint, and starts the gate when no
safe marker can be reused.

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
additional admission step. After the unstaged/untracked rejection and source
selection, the engine takes its normal locks and snapshots fast mode once. That
snapshot controls admission, fingerprint identity, slow-slot resolution, and
fast-debt provenance even if another worktree changes the shared marker while
the gate is running. The engine then initializes the log directory,
fingerprint, signal cleanup, and watchdog, and runs
`bun run harness:registration:check` with a five-second sub-timeout. The
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
do not copy a slot list into contributor documentation. The generator owns
which slots exist, their consumer-specific commands, and the allowed differences
between pre-commit, manual changed verification, and full verification.

Each slot writes a named log under the verification log directory. The ratchet
slot additionally sets `HARNESS_DIAGNOSTICS_OUTPUT` to
`ratchet-diagnostics.json`, so its machine-readable result and its ordinary log
describe the same run.

## 3. One real control ID

Consider control ID
[`ratchet/local-no-arbitrary-tailwind-value-client`](../generated/harness-controls.md#ratchetlocal-no-arbitrary-tailwind-value-client).
Its registry entry freezes the accepted count of arbitrary Tailwind bracket
values in client source. A new matching value reaches the generated `ratchet`
slot, which invokes `bun run lint:ratchet` during pre-commit.

The resulting [`HarnessDiagnostics`](../../packages/shared/src/schemas/harness-diagnostics.ts)
envelope identifies that exact control and includes the source path, rule ID,
baseline and current counts, `why`, `howToFix`, and `repairKind`. The schema
requires repair text for every finding; a codemod repair must also carry its
command.

For this manual-repair control, the local rule supplies a concrete replacement
hint—for example, use a Tailwind scale step or named `@theme` token—and the
ratchet appends the baseline recovery step. The generated controls reference
links the same control to its principle, guide, invocation, and repair kind.

## 4. Read the failure as feedback

When any slot fails, pre-commit prints the passed and failed slot names, the
relevant log path, and a bounded excerpt. Ratchet failures are excerpted from
`ratchet-diagnostics.json`, preserving the control ID and human-readable repair
instead of reducing the result to an exit code.

From the repository root, resolve the same worktree-scoped directory used by
the gate. Read the raw slot log directly, or render its structured envelope as
Markdown:

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
being treated as a cache miss.

`bun run verify:changed` follows the same generated changed-mode authority when
you need a manual, staged pre-commit check without making a commit. It is a
fallback and troubleshooting entry point, not a second lifecycle.
