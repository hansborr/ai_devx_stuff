# Make Bun Cache Identity and Artifacts Coherent

Status: Proposed — revise P1 coherence core; park P2 retention follow-up
Date: 2026-07-21
Priority: P1

## Problem

`ai_bun_argv_fingerprint` sorts every token after `--`, but `bun run --`
forwards arbitrary ordered arguments. Semantically different commands can
share a marker. Markers are argv-scoped while logs remain `<script>.log`, so a
later argv overwrites the evidence replayed for an earlier cached failure.

Confirmed collision: swapping the values of `--input` and `--output` for
`mutation:survivors` produces the same fingerprint. Confirmed replay: A fails,
B passes, then cached A reports exit 1 with B's clean log.

## Scope

- Hash the exact normalized argv tail in original order. Keep the existing
  16-hex digest unless a collision-budget analysis demonstrates a need for a
  longer local one-hour cache key; do not guess which operands are unordered.
- Give every execution attempt an immutable log identity composed from the
  argv fingerprint plus a generation/run ID. Publish a versioned marker that
  references that exact completed log; never stream a rerun into an artifact
  still reachable through an older marker.
- Keep a per-script latest pointer for `verify:logs` and Stop consumers. Publish
  the immutable completed attempt first, then replace each coherent reference
  atomically. Do not claim two independent files can be published atomically as
  one operation; use one atomic index if readers require a single commit point.
- Define a producer/consumer migration matrix covering Claude, Codex, Copilot,
  transient pre/post correlation state, `verify:logs`, and Stop. Codex/Copilot
  must carry one generated attempt identity from pre-hook to post-hook rather
  than reconstructing paths independently.
- Replace the existing cache fixture that deliberately expects reordered argv
  operands to collide, and update cache, verify-log, Stop, Codex, and Copilot
  wiring fixtures for the versioned marker/log contract.
- Version the marker namespace/schema and invalidate all pre-change markers for
  cache decisions. Old sorted-tail hashes cannot be distinguished reliably,
  and even old no-arg failures can point at a shared log overwritten by another
  argv. Legacy artifacts may remain observability-only.
- If immutable generations land in the first slice, add a minimal age-based
  cleanup that protects referenced attempts while removing expired orphan
  temporaries. A broader observability-retention policy is a separate P2
  decision, not part of the P1 cache fix.

## Acceptance

- The exact ordered argv bytes feed the digest, and tested semantic argv
  permutations receive distinct identities without intentional normalization
  aliases.
- A-fail -> B-run -> cached-A shows only A evidence and A's log path.
- While a same-argv rerun is in flight, readers continue to see the prior
  complete attempt; they never observe partial new output through an old marker.
- Latest readers select a coherent marker/log pair for B.
- Fresh no-arg caching remains covered; no legacy evidence can satisfy a new
  command-specific cache hit or overwrite the coherent latest pair.
- Generation cleanup, if included, distinguishes referenced, expired, and
  orphaned attempts without introducing an independent retention framework.
