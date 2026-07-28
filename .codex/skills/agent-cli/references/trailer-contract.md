# agent-run trailer and exit-code contract

This is the caller-facing contract for
`.claude/skills/agent-cli/scripts/agent-run.sh`.

## Stream Model

The wrapper writes line-oriented records into the merged dispatch log:

```text
agent-run: <key>: <value>
```

Backend output may appear before, between, or after these records. Consumers
must parse anchored `^agent-run: <key>:` lines and tolerate unrelated log
content.

A wrapper dispatch attempt emits the launch header before any completion anchor.
A dispatch can still abort before `exec` (for example, if the shared-launch or
codex-launch path cannot record the backend pid); that case is represented by
`agent-run: backend-pid: none (...)`, finalizes as exit 1, and there is no
backend to orphan. A pre-launch wrapper rejection, such as usage failure or lock
failure, emits no launch header. Once fatal-signal traps are about to become
active, however, the wrapper has already emitted a pid-bearing `starting:`
breadcrumb; this is not a launch header or completion anchor.

Completion is anchored only by:

- `agent-run: worktree:`
- `agent-run: backend-exit:`

Do not treat the bare `agent-run: dispatched:` header, or any other
`agent-run:` line, as completion. Optional records can be omitted, and their
relative order is intentionally not a byte-exact golden contract.

## Launch Records

| Record | Requirement | Ordering | Meaning |
|---|---|---|---|
| `agent-run: starting:` | Required once fatal-signal handling begins | Before traps become active, `attempt:`, `branch:`, and `dispatched:` | Names the wrapper pid before any trap-managed pre-dispatch work. It lets waiters classify a death even if no answer attempt was claimed yet; it is neither a launch header nor a completion anchor. |
| `agent-run: branch:` | Optional | Before `dispatched:` when present | A `work --branch <name>` run created and switched to the named branch before backend launch. |
| `agent-run: attempt:` | Required for `consult`/`work` | Immediately after the active claim becomes durable; before `branch:` and `dispatched:` | Names the immutable attempt id, durable record path, and wrapper pid that own this answer-path run. Signal deferral spans the durable-claim-to-breadcrumb handoff, so any later handled pre-dispatch abort can be classified from the record. |
| `agent-run: transcript:` | Required for Copilot `consult`/`work` | After `attempt:` and before `dispatched:` | Names the exact transcript path and whether it is wrapper- or caller-owned. The identity/path pair stays unchanged through finalization. |
| `agent-run: dispatched:` | Required for every dispatch attempt that reaches the launch phase | Before `backend-pid:` and before completion anchors | Names the mode, agent, wrapper pid, and the canonical absolute answer path when the mode has one. `review codex` has no answer path. |
| `agent-run: backend-pid:` | Required for every dispatch attempt that emitted `dispatched:` | After `dispatched:` and before completion anchors | Names the backend pid. `none (...)` means no backend was exec'd — there is nothing to orphan, and the worktree lock releases with the wrapper. A `none` record never coexists with a live, lock-holding backend. |

## Attempt Bundle and Retry Contract

Every `consult`/`work` answer path has a separate ownership lock and durable
bundle beside its canonical path:

```text
<output>.agent-run.lock
<output>.agent-run.lock.identity # persistent hard-link pin for the locked inode
<output>.agent-run/
  lock-identity                # hard link to the owned lock inode
  last-sequence                # durable high-water mark for claimed attempts
  current
  attempt.<identity>/
    ownership                  # hard link to lock-identity
    record
    answer.tmp                 # present only while unsettled
    answer.publishing          # `finalizing` only: the completed candidate,
                               # held under this name while the public link is
                               # released; may be its only surviving copy
    transcript-path           # Copilot only
    transcript-identity       # caller-owned Copilot transcript, after finalization
    copilot-transcript.md      # wrapper-owned Copilot transcript only
```

`current` names the latest attempt directory. Each record has a fixed field
count and order with strict value validation, and each attempt is
hard-link-bound to the inode the wrapper actually locked. It allocates and
records each attempt directory before advancing `last-sequence`, so allocation
or pre-record setup failure cannot claim a sequence without a matching durable
record; the wrapper then validates that high-water mark along with the complete
sequence and predecessor chain across every `attempt.*` directory, not only the
directory named by `current`. An attempt made durable before a crash but not
yet published through `current` therefore remains visible and fail-closed, and
deleting that newer orphan cannot make the older lineage look complete again.
Each record fixes the attempt id and sequence, predecessor, owner pid,
mode/backend, transcript ownership, backend disposition, answer outcome,
session id, state, and finalization count. Legacy bundles may still contain an
ignored `bundle.key` and a syntactically valid ignored `record-seal=` line on
older records; new bundles and records create neither. For explicit output
paths, earlier attempt directories and wrapper-owned transcripts are retained.
Auto-generated paths reap the private bundle after ordinary finalization
(while keeping a published answer), but retain ambiguous or crashed attempts
for recovery. Copilot's
`transcript-path` is written before launch; it points either to the immutable
wrapper-owned file in that attempt directory or initially to the caller's
canonical `--share=<path>`. For a caller-owned transcript, the attempt retains
the canonical path plus the identity captured at claim and reverified at
finalization, but the external artifact remains caller-owned: deleting or
rotating it later does not invalidate the attempt bundle or block an answer
retry. A caller-owned share path must be
absent before every new run; any existing path, empty or nonempty, is rejected
before launch and is never retired, rebound, or recreated by the wrapper.
Caller-owned share paths also hold the same canonical path lock and persistent
inode pin used for public answers, preventing two runs with different outputs
from launching against one transcript even if the public lock pathname is
replaced. The exclusive share inode and its containing directory are synced
before launch, including when the share and answer live under different
parents. The canonical absolute share path is passed to Copilot and persisted
in `transcript-path`, so symlink repointing during that run and a later retry
from another working directory cannot redirect it. Retries instead use a fresh
caller share path or the fresh attempt-private wrapper-owned transcript; only
the `-o` answer path has finalized-no-answer reuse and retirement behavior.

States are fail-closed:

- `active` owns a live, starting, or crashed/unfinalized attempt.
- `finalizing` means answer publication or no-answer cleanup began but cannot
  be proved complete.
- `finalized` has `finalization-count=1` and a conclusive `answer` or
  `no-answer` outcome.

Only `finalized` + `no-answer`, with the public output still absent/empty,
allows a new attempt. A live lock, an opened lock whose pathname no longer
names the same inode, `active`/`finalizing` state, broken lineage, incomplete
bundle, malformed or ambiguous record, finalized answer, or public content
rejects before backend launch. An arbitrary empty file without this record is
not retryable, and deleting a successful public answer does not erase its
finalized ownership.

The backend writes `answer.tmp`, never public `-o`. Publication is decided by
the candidate, not by the backend disposition: whenever the parsed candidate is
complete and has content, the wrapper syncs it and atomically publishes it with
a same-filesystem no-clobber link, including when the run itself failed (a
non-zero backend exit, an `is_error` envelope, a no-final-answer report, or a
fatal signal). Only a settled run with no complete candidate removes the
candidate, syncs the absent/empty public state, and then finalizes `no-answer`.
An existing empty public-output predecessor is atomically renamed to a sibling
`.agent-run-retired.*` path while its path lock is held. Auto-generated output cleanup unlinks the retired path only when
it remains empty and still names the
inode the wrapper retired; a replaced path or content added through an already
open descriptor is preserved. Explicit-output runs retain the retired inode
under its non-colliding name. A predecessor already observed with content still
rejects. Caller-owned Copilot `--share` paths never enter this flow: any
existing caller share rejects before launch. Retired explicit-output artifacts
may accumulate and are intentionally outside automatic run cleanup; any sweep
must be an explicit, separate cleanup operation.
Content arriving during final publication leaves the attempt `finalizing` for
explicit recovery, with the completed private candidate preserved as
`answer.tmp` alongside the independently owned public content — or, when the
wrapper died or failed before it could rename that link back, as
`answer.publishing`.

## Explicit Attempt Recovery

Explicit recovery is an operator-controlled evidence and namespace transition,
not permission to make a damaged record look finalized. Never edit `record`,
`current`, `last-sequence`, or ownership links, and never delete one
`attempt.*` directory from a lineage. Those edits can hide an unsettled attempt
or create a sequence the wrapper cannot validate.

Before changing any answer artifact:

1. Resolve the exact canonical output from `agent-run: dispatched:` and locate
   its attempt from `agent-run: attempt:`. Do not infer either path from a
   similarly named file.
2. Stop the named wrapper and every backend process group first. For a dead-run
   orphan, follow the kill procedure below. Confirm the worktree is no longer
   changing.
3. If `<output>.agent-run.lock` and its `.identity` pin are regular files naming
   the same inode, take that lock non-blockingly and keep it held throughout
   inspection and archival. A busy lock means recovery must stop. If the two
   paths disagree, are missing, or are symlinks, provenance itself has failed:
   do not create or replace either path while another owner may exist.
4. Copy, without clobbering, the public output, every surviving `answer.tmp`
   and `answer.publishing`, records, transcripts, and the complete bundle to a
   separate recovery directory. `answer.publishing` is a completed answer that
   was mid-publication, and can be its only surviving copy, so treat it exactly
   like `answer.tmp` and never delete it.
   Record file hashes. Caller-owned Copilot `--share` artifacts are
   never moved, renamed, deleted, or replaced by this procedure; copy them only
   when the caller permits it.

Classify and reconcile the preserved evidence as follows:

| State | Safe operator action |
|---|---|
| `active` with a live wrapper/backend | Do not recover yet. Wait, or stop the complete backend process group and then treat it as a dead run. |
| Dead `active` | Preserve its bundle, transcript, session id, candidate, and worktree changes. Resume or salvage into a fresh output; do not mark the attempt finalized. |
| `finalizing` with both public content and `answer.tmp` (or `answer.publishing`) | Treat them as two independent answers. Copy and hash both, review them, and explicitly choose one or neither. The public file is not proof of publication, and the candidate must not be deleted merely because public content exists. |
| `finalizing` with only one answer, or with neither | Preserve what exists — a lone `answer.publishing` is a completed answer, not scratch. Publication/cleanup still cannot be proved, so do not infer `answer` or `no-answer` and do not retry through the same bundle. |
| Malformed/incomplete lineage or malformed/ambiguous record | Do not trust individual record fields, rewrite records, fill in `current`, or remove the unexpected child. Preserve and retire the whole bundle as one unit. |
| Lock/bundle provenance failure | Stop all possible owners and perform recovery under an external maintenance exclusion. Archive the output, bundle, lock, and identity pin together; none is safe to adopt independently. |
| Caller-transcript identity failure | Preserve the attempt and the recorded transcript path. Leave the caller-owned share exactly where it is; the caller decides its disposition. |

After evidence is preserved, choose one terminal recovery:

- To accept an answer, copy the explicitly selected preserved file to a fresh,
  absent destination with no-clobber semantics. If an operator instead installs
  it at the old public spelling, that file remains intentionally non-retryable;
  do not manufacture a finalized record for it.
- To dispatch again with the old output spelling, keep the valid answer-path
  lock held, move the public output (if any) and the **entire**
  `<output>.agent-run/` bundle to unique no-clobber names in the recovery
  directory, and leave the matching lock plus identity pin in place. Release
  the lock only after the old namespace is absent. The next wrapper run then
  creates a new lineage; it does not continue or relabel the archived one.
- When lock provenance failed, do not use that in-place transition. Under the
  external maintenance exclusion, archive all four sibling artifacts
  (`output`, bundle, lock, and identity pin) together, then use a fresh output
  path or deliberately establish a brand-new namespace.

These steps are intentionally stricter than deleting an empty output. Recovery
must retain enough evidence to explain the old attempt and must never silently
choose between caller content and a wrapper candidate.

KILL escalation never unlinks a surviving Git `index.lock`. Its diagnostic
distinguishes “no open holder found, likely stale” (inspect before using the
printed recovery command) from a live open-file holder, which is attributed by
pid/process and explicitly says not to remove the lock.

## Finalize Records

| Record | Requirement | Ordering | Meaning |
|---|---|---|---|
| `agent-run: backend-exit:` | Optional completion anchor | After the launch header | Preserves a non-zero backend exit code, records fatal-signal finalization such as `killed (SIGTERM, ...)`, records a post-launch wrapper artifact-sync or lock-identity failure as `wrapper-failure (...)`, or records `orphaned-children (...)` when a non-consult backend exited 0 but left a live process in its group (backgrounded work that dies at end-of-turn). Omitted when the backend exits 0 cleanly with no orphaned children and no killed-backend or anchored wrapper failure. These anchored failure cases exit 1. Parse failures, no-answer failures, and attempt-finalization publication/identity failures can exit 1 without this record. A consult that leaves an orphan does **not** emit this failure anchor — it is read-only, so a lingering child cannot be abandoned mutating work (a real mutation trips the drift check and exits 4 instead); see `orphaned-children-reaped`. |
| `agent-run: orphaned-children-reaped:` | Optional | After the launch header | Consult-only. Records that a read-only consult's backend exited 0 but left a live process in its group (commonly a backend's own lingering daemon, e.g. cursor's worker-server), which the wrapper reaped. It is informational, not a completion anchor and not a failure: the run stays exit 0 (the `worktree:` anchor finalizes it, and the no-answer check can still demote it to exit 1). |
| `agent-run: answer:` | Optional | After the launch header | Confirms that a non-empty answer file landed at the named canonical absolute path. Omitted for `review codex`, empty/missing answers, and many failed or killed runs. |
| `agent-run: session-id:` | Optional | After the launch header | Backend session id parsed from an anchored backend header or transcript header. codex logs it early — as soon as the `exec` header streams, before the wrapper waits — so a run killed before finalization (OOM/SIGKILL, which skip the fatal-signal trap) still records a resumable id. claude and cursor expose it from their final envelopes. Copilot exposes it from the per-attempt transcript; finalization writes the same id into the attempt record. A crash before extraction still leaves the early transcript path for inspection. |
| `agent-run: cost-usd:` | Optional | After the launch header | Claude-only cost and turn metadata. Informational; never required for control flow. |
| `agent-run: head:` | Optional | Before the `worktree:` outcome for `work` runs when git head can be read | Commit range summary for `work` runs. `(unchanged)` marks a no-op run. |
| `agent-run: worktree:` | Required completion anchor for finalized launched runs | After the launch header | Worktree outcome: `clean` (work only), `best-effort-clean` (read-only snapshot unchanged), `dirty (...)`, `DIRTY (...)`, or `unchecked (...)`. This is the normal completion anchor for successful runs. |
| `agent-run: drift-status:` | Optional | Immediately after a `worktree: DIRTY` line when status details are available | Count or state of uncommitted paths observed while reporting read-only drift. |
| `agent-run: drift:` | Optional | After `drift-status:` | One line per `git status --porcelain` detail for a read-only drift report. |

Read-only drift detection is deliberately not a raw-content identity guarantee.
The wrapper does not content-hash every tracked file, so an unchanged snapshot
is reported as `best-effort-clean`, never authoritative `clean`. Under default
Git configuration on filesystems with fine-grained timestamps, the composite
snapshot is expected to detect ordinary worktree, index, ref, config, and hook
changes. Staged and unstaged diffs disable textconv and external diff commands,
and the unstaged view forces ctime trust. Each tracked file/symlink also
contributes its device, inode, mode, size, and printed mtime/ctime identity.

Legitimate configuration and filesystem behavior can still collapse every
cheap signal: clean filters or text/EOL normalization can map distinct raw
bytes to one Git representation, while a coarse-granularity filesystem can
preserve the complete stat tuple across an equal-length same-inode rewrite.
Textconv, external diff, fsmonitor, index flags such as assume-unchanged or
skip-worktree, and `core.trustctime=false` are specifically handled where
practical, but repositories using those features remain outside an
authoritative content guarantee. Flagged paths are content-hashed as a narrow
exception set. Non-ignored untracked entries encode their filesystem object
type; regular files are content-hashed and symlinks hash their target spelling,
so those two forms cannot collide even when their checksums do. The overall
read-only result remains best-effort because ordinary tracked contents are not
all hashed.

## Exit Codes

| Exit | Owner | Meaning |
|---|---|---|
| 0 | Wrapper | Finalized success. For read-only modes, no drift was observed by the best-effort snapshot or drift was explicitly unchecked; for `work`, the backend completed and the worktree outcome was reported. |
| 1 | Wrapper | Run failure. This includes a non-zero backend exit, a launch abort before `exec`, a backend that produced no answer where one was required, parse/envelope failure, TERM/INT/HUP finalization, or a post-launch wrapper failure. Only post-launch artifact-sync and lock-identity failures emit a `backend-exit: wrapper-failure (...)` completion anchor. Attempt-finalization publication, ambiguity, candidate-identity, and caller-transcript-identity failures instead record their disposition in the attempt record and complete the log with the `worktree:` anchor. Backend codes never pass through raw; numeric backend status appears only in `agent-run: backend-exit:` when available. |
| 2 | Wrapper | Usage/recovery error before backend launch, including invalid arguments, stale or ambiguous attempt records, non-retryable answer paths, dirty `work` start without `--dirty-ok`, and invalid branch policy combinations. No launch header is emitted. |
| 3 | Wrapper | Pre-launch environment or ownership failure: missing/file-operand-incapable `sync`, busy answer-path/worktree lock, missing `flock`, or an unavailable lock path. No answer-path state is changed by the sync preflight, and no launch header is emitted. |
| 4 | Wrapper | A read-only run (`consult` or `review codex`) mutated the worktree. The log includes a `worktree: DIRTY (...)` completion anchor. Drift outranks backend failure, but the backend status is still preserved in `backend-exit:` when available. |

Codes 2, 3, and 4 always mean the wrapper, not the backend.

`agent-wait.sh` uses its own status codes: 10 means the named wrapper is still
running at the timeout; 20/21 are dead incomplete runs with a dead/live backend
respectively. Status 22 is narrower: the wrapper is dead, its durable attempt
is conclusively `finalized` + `no-answer`, and the log contains neither
`dispatched:` nor `backend-pid:` evidence. That is the handled
pre-dispatch-abort shape: an `attempt:` breadcrumb with wrapper pid may exist
without launch or completion anchors because the signal arrived after the
attempt was recorded but before the launch line was emitted, including during
branch creation, command construction, or runtime initialization.

## Dead-Run Signature

SIGKILL and external harness reaping cannot run the wrapper's fatal-signal
trap. In that case the log can contain a `starting:`/`attempt:` breadcrumb or
launch header but no completion anchor. The wrapper pid comes from
`dispatched:` when present, then `attempt:`, then `starting:`. If that pid is
dead and neither
`agent-run: worktree:` nor `agent-run: backend-exit:` exists, the attempt
record and launch evidence jointly decide the classification. `finalized` +
`no-answer` is the retryable pre-dispatch-abort status (waiter exit 22) only
when neither `dispatched:` nor `backend-pid:` appears. Once either launch record
exists, a missing completion anchor is exit 20 with a dead/unknown backend or
21 with a live backend, even if the answer record already finalized no-answer:
the backend may have committed or otherwise changed the worktree before the
wrapper died. An `active` or unreadable record uses the same 20/21 split. A
death after `starting:` but before `attempt:` is likewise classifiable as exit
20 rather than timing out with an unknown wrapper pid.

The `agent-run: backend-pid:` record then decides recovery shape: a live backend
is an orphan that still owns the answer path and may still hold the worktree
lock, while a dead backend means the wrapper died before its completion trailer.
`agent-wait.sh` reports those cases as dead-run statuses; consumers must not
infer completion from the launch header. The attempt record stays `active` and
therefore non-retryable in the ordinary crash case. A record that already
finalized no-answer can make its output pathname reusable, but launch evidence
still requires worktree inspection before the mission itself is retried.

Recovery:

- A still-alive backend pid is an orphan that may still be writing (a `work`
  orphan also still holds the worktree lock): kill its process group
  (`kill -- -<backend-pid>`) before taking the worktree over.
- Inspect the `agent-run: attempt:` record and, for Copilot, its early
  `agent-run: transcript:` path. Preserve that bundle: it is the attribution
  and session-recovery evidence even when public `-o` is absent.
- Recover the delegate's staged-but-uncommitted work with a fresh
  `work --dirty-ok` run told the staged diff is its own, or resume the session
  from its id: check the log for an `agent-run: session-id:` line (codex logs
  it early, so it usually survives a crash; the other backends log it only at
  finalization), and fall back to the backend's native session store
  (`~/.codex/sessions/`, `~/.claude/`, or per the backend reference).
- Do not rerun the same `-o`: a crashed `active` or interrupted `finalizing`
  attempt requires explicit recovery even when the public file is empty or
  absent. A conclusively finalized `no-answer` record makes the output spelling
  reusable, but if its log contains launch evidence, inspect the worktree and
  session evidence before deciding whether the mission may be repeated.
