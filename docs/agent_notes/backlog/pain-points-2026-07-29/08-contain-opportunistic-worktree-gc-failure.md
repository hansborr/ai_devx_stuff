# Contain Opportunistic Worktree GC and Fix Peer Checker Resolution

Status: Implemented
Date: 2026-07-29
Priority: P1
Size: M
Source: `worktree-provisioning-and-isolation.md` — “One unprovisioned peer can
block initialization”

## Problem

`worktree:init` labels its garbage collection opportunistic and calls
`cmd_gc || true` at `scripts/worktree-db.sh:1226-1227`. That boundary is
ineffective when `cmd_gc` reaches `die`, because `die` exits the current shell
rather than returning through the `||`.

The unsafe path is live. Template discovery fingerprints every registered
worktree and returns failure for one unreadable or unprovisioned peer
(`scripts/worktree-db.sh:2052-2065`). `cmd_gc` correctly converts an incomplete
live set into a fail-closed template-GC error at
`scripts/worktree-db.sh:2440-2446`. During `worktree:init`, however, that safety
failure aborts provisioning of the current, otherwise valid worktree.

The archived reproduction's second defect is also still live, contrary to the
original leaf. `hash_fingerprint_inputs` changes into the peer before invoking
the digest producer (`scripts/worktree-db.sh:522-529`), while
`validate_seed_runtime_import_closure` resolves the checker lazily from the
possibly relative `${BASH_SOURCE[0]}` (`scripts/worktree-db.sh:429-447`). At
HEAD, this cheap probe exits 1 with `cd: scripts: No such file or directory`:

```bash
bash -c '. scripts/worktree-db.sh; cd /tmp; validate_seed_runtime_import_closure'
```

`git blame` also shows that the relative expression at line 433 is the original
one from `9ca30f826`; no later fix changed it. An unprovisioned peer can
therefore fail either because its fingerprint inputs are genuinely incomplete
or because the caller loses its own checker path after changing directory.

## Scope

- In `scripts/worktree-db.sh`, resolve the script's own directory to an
  absolute path before any fingerprint helper changes directory. Use that
  stable directory for the default
  `MUSI_SEED_IMPORT_CLOSURE_CHECKER` path while retaining the environment
  override.
- Run the opportunistic `cmd_gc` call from `cmd_init` inside a child-shell
  containment boundary that survives `die`/`exit` and explicitly enables
  `errexit` inside the child. Capture its status outside an `||` condition; on
  failure print one warning that opportunistic GC did not complete, point to
  `bun run worktree:gc` for diagnosis, and continue provisioning the current
  worktree.
- Keep direct `bun run worktree:gc` behavior fail-closed when the live template
  set is incomplete.
- In `scripts/tests/test-worktree-db.sh`, add:
  - a relative-source/different-cwd regression with `CDPATH` set, proving peer
    fingerprinting invokes the checker from the caller's script tree, not the
    peer;
  - a `cmd_init` orchestration fixture whose stub `cmd_gc` runs an ordinary
    failing command before a sentinel, proving the child stops, the warning is
    emitted, and later initialization still runs;
  - a direct `cmd_gc` fixture proving the same incomplete-live-set failure
    remains nonzero and reaches no template listing, template tombstone, or
    template deletion.
- Do not skip the bad peer and proceed with a partial template live set.
- Verify with `bash scripts/tests/test-worktree-db.sh`.

## Acceptance

- One registered peer that cannot be fingerprinted does not abort
  `worktree:init` in another worktree.
- A relative `bash scripts/worktree-db.sh init` invocation can fingerprint a
  peer after changing into that peer without resolving the checker beneath the
  peer or requiring the peer's `node_modules`.
- An incomplete live-template set reaches no template listing, template
  tombstone, or template deletion, and the contained caller emits an
  actionable warning.
- The current worktree continues through dependency, shared-output, and
  database provisioning.
- Direct `worktree:gc` still exits nonzero rather than risking cleanup from an
  incomplete live set.

## Resolved decisions

- Abandon template GC when any registered peer cannot be fingerprinted; do not
  skip that peer. `list_live_template_dbs` deliberately returns failure for an
  incomplete set (`scripts/worktree-db.sh:2052-2065`), and the existing shell
  regression pins that invariant
  (`scripts/tests/test-worktree-db.sh:1589-1614`). Treating the partial set as
  complete could classify a live template as orphaned.
- Resolve the checker from the invoking script tree before the peer-directory
  transition. The live probe above refutes the earlier “fixed” claim, and the
  archived incident established that pointing
  `MUSI_SEED_IMPORT_CLOSURE_CHECKER` at the provisioned caller's absolute
  checker fixes this half of the failure.
- Contain only the opportunistic call from `cmd_init`; do not weaken `cmd_gc`.
  A second cheap probe with a stub `cmd_gc() { die fixture; }` confirms that the
  live `cmd_gc || true` exits 1 before subsequent init work, while the direct
  command's fail-closed behavior is the safety boundary to preserve.
- Do not place the child-shell call on the left of `||`: Bash disables
  `errexit` throughout that conditional command, allowing an ordinary failure
  inside `cmd_gc` to be hidden by later successful cleanup.

## Open questions

None.
